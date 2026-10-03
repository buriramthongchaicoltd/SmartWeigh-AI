import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import {
  SUPABASE_SQL_DDL_SCHEMA,
  mapOrderToSupabase,
  mapSupabaseToOrder,
  mapPOToSupabase,
  mapSupabaseToPO,
  mapStoreToSupabase,
  mapSupabaseToStore,
  mapProjectToSupabase,
  mapSupabaseToProject,
  mapBillingNoteToSupabase,
  mapSupabaseToBillingNote
} from './src/utils/supabaseClient';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable reverse proxy trust behind Cloud Run / AI Studio load balancers
app.set('trust proxy', 1);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-memory rate limiting to prevent Denial-of-Service and Gemini API quota exhaustion
const scanRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const SCAN_WINDOW_MS = 60 * 1000; // 1-minute sliding window
const MAX_SCANS_PER_WINDOW = 20; // 20 requests per minute per IP

// Periodically purge expired rate-limit records every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of scanRateLimitMap.entries()) {
    if (now > record.resetTime) {
      scanRateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

const rateLimitScan = (req: Request, res: Response, next: () => void) => {
  const clientIp = req.ip || (typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const record = scanRateLimitMap.get(clientIp);

  if (!record || now > record.resetTime) {
    scanRateLimitMap.set(clientIp, { count: 1, resetTime: now + SCAN_WINDOW_MS });
    return next();
  }

  if (record.count >= MAX_SCANS_PER_WINDOW) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
    return res.status(429).json({
      success: false,
      isTransient: true,
      error: `ระบบจำกัดการสแกนเอกสารไม่เกิน ${MAX_SCANS_PER_WINDOW} ครั้งต่อนาทีต่อผู้ใช้งาน กรุณารอ ${retryAfterSec} วินาทีแล้วลองใหม่อีกครั้ง`
    });
  }

  record.count++;
  next();
};

// Shared Gemini client instance
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// Locked strictly to the 'flash-lite' family using Google's rolling alias 'gemini-flash-lite-latest'
// (with 'gemini-3.1-flash-lite' as same-family fallback) so the system automatically updates when a newer
// flash-lite version is released while keeping 100% consistent flash-lite extraction behavior.
const FLASH_LITE_MODELS = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];

/**
 * Executes a Gemini request strictly using the 'flash-lite' model family ('gemini-flash-lite-latest')
 * with automatic retry and timeout protection so extraction results remain 100% consistent.
 */
async function callGeminiWithResilience(ai: GoogleGenAI, requestPayload: any, overallTimeoutMs = 32000) {
  let lastError: any = null;
  const overallStartTime = Date.now();

  for (const model of FLASH_LITE_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - overallStartTime > overallTimeoutMs) {
        throw new Error('การประมวลผล Gemini Flash-Lite หมดเวลา (Request Timeout) กรุณาลองใหม่อีกครั้ง');
      }

      try {
        console.log(`[Gemini] Calling model ${model} (attempt ${attempt + 1}/2)...`);

        // Enforce 16s per-attempt timeout using Promise.race
        const attemptCall = ai.models.generateContent({
          ...requestPayload,
          model: model
        });

        const attemptTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout: โมเดล ${model} ใช้เวลาเกิน 16 วินาที`)), 16000);
        });

        const response = await Promise.race([attemptCall, attemptTimeout]);
        return { response, usedModel: model };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || JSON.stringify(err);
        const isRetryable =
          errMsg.includes('503') ||
          errMsg.includes('high demand') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('429') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('Timeout');

        console.log(`[Gemini] ${model} attempt ${attempt + 1} transient delay, retrying...`);

        if (isRetryable && attempt === 0 && (Date.now() - overallStartTime + 2000 < overallTimeoutMs)) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          break;
        }
      }
    }
  }

  throw lastError;
}

// Health & Status endpoint
app.get('/api/status', (req: Request, res: Response) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5);
  res.json({
    status: 'ok',
    hasKey,
    model: FLASH_LITE_MODELS[0],
    timestamp: new Date().toISOString()
  });
});

// Bill & Order Scan Endpoint using Gemini 3.8 Flash Vision
app.post('/api/scan-bill', rateLimitScan, async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType = 'image/png', targetDocType = 'auto' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาส่งข้อมูลรูปภาพเอกสาร (imageBase64)'
      });
    }

    const ai = getGeminiClient();

    if (!ai) {
      return res.status(500).json({
        success: false,
        error: 'ระบบไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์ กรุณาตรวจสอบการตั้งค่า'
      });
    }

    // Clean base64 header if present
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');

    let specificTargetInstructions = '';
    if (targetDocType && targetDocType !== 'auto') {
      if (targetDocType === 'purchase_order') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุอย่างชัดเจนว่านี่คือ "ใบสั่งซื้อสินค้า (purchase_order / PO)":
- บังคับเด็ดขาดให้ตั้งค่า docType = 'purchase_order'
- โฟกัสสูงสุดที่:
  * col4: เลขที่ใบสั่งซื้อ (PO No.) **หากในเอกสารมีทั้ง "เล่มที่" และ "เลขที่" ให้รวมเป็นรูปแบบ "เล่มที่/เลขที่" เสมอ (เช่น เล่มที่ 02 เลขที่ 0045 -> 02/0045)**
  * bookNo: เล่มที่ของเอกสาร (หากมีระบุบนบิล เช่น 02)
  * col7: วันที่ออก PO (YYYY-MM-DD)
  * col8: ชื่อร้านค้า / ผู้จำหน่าย (Vendor)
  * col9: ผู้สั่งซื้อ / โครงการ (Buyer)
  * col11: รายการสินค้าหลัก
  * col12: สเปก / Code
  * col22: จำนวนสั่งซื้อ
  * col23: หน่วยนับ (ชิ้น, เส้น, ถุง, ถัง, แผ่น, กล่อง, ม้วน, ชุด)
  * col24: ราคาต่อหน่วย
  * col25: รวมค่าสินค้า
  * col29: ยอดรวมทั้งสิ้น
  * col30: เครดิตเทอม / เงื่อนไขชำระเงิน
  * lineItems: รายการสินค้าสั่งซื้อทั้งหมดใน PO
  * โซน 3 และ 4 (น้ำหนักชั่งรถ): ใส่ 0`;
      } else if (targetDocType === 'weighbridge') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุว่านี่คือ "ตั๋วชั่งน้ำหนักรถบรรทุก (weighbridge)":
- บังคับให้ตั้งค่า docType = 'weighbridge'
- โฟกัสสูงสุดที่:
  * col13: น้ำหนักหนักต้นทาง / รถรวมสินค้า (Gross Weight กก.) **ต้องเป็นตัวเลขที่มากกว่าเสมอ (ระวัง: โรงโม่ต้นทางมักพิมพ์บรรทัดแรกว่า "น้ำหนักเข้า" ซึ่งเป็นรถเปล่า ห้ามนำน้ำหนักรถเปล่ามาใส่ col13 เด็ดขาด)**
  * col14: น้ำหนักเบาต้นทาง / รถเปล่า (Tare Weight กก.) **ต้องเป็นตัวเลขที่น้อยกว่าเสมอ**
  * col15: น้ำหนักสุทธิ (Net = col13 หนัก - col14 เบา) กก.
  * col10: ทะเบียนรถบรรทุก (เช่น 70-1234, 82-5678)
  * col8: โรงโม่หิน / ลานทราย / ผู้จำหน่าย
  * col11: รายการสินค้า (เช่น หินคลุก, หิน 1, หิน 2, ทรายหยาบ, ดินถม)
  * col22: ปริมาณเป็นตัน (แปลงจาก col15 กก. / 1000)
  * col23: หน่วย 'ตัน'
  * col6: เลขที่ตั๋วชั่ง
  * referenceDocNo: เลขที่ใบส่งของ (DO) ที่ตั๋วชั่งนี้อ้างอิงถึง (ตรวจหาอย่างละเอียด ไม่ว่าจะเป็นตัวพิมพ์ในช่องฟอร์ม เช่น เลขที่ DO/บิลส่งของ, บันทึกไว้ในช่องหมายเหตุ, หรือเขียนด้วยลายมือปากกาตรงไหนสักที่บนตั๋วชั่ง)
  * col4: เลขที่ใบสั่งซื้อ (PO หากมีระบุหรือเขียนลายมือไว้บนตั๋วชั่ง)
  * referenceSource: ระบุแหล่งที่พบเลขอ้างอิง ('form_field', 'notes', หรือ 'handwritten')
  * col38: หมายเหตุ (บันทึกข้อความอ้างอิงหรือลายมือที่พบบนตั๋วชั่ง)
  * col24, col25, col27, col28, col29: ราคา/ค่าบรรทุก (เฉพาะกรณีมีพิมพ์หรือเขียนระบุจริงบนตั๋วชั่ง หากไม่ระบุให้ใส่ 0 เพราะการคิดราคาจะคำนวณในระบบ RR)
  * โซน 6 (การชำระเงิน col30 - col36): ตั๋วชั่งเป็นเอกสารหน้างานไม่มีข้อมูลการเงิน ให้ใส่ 0 ทั้งหมด และ col30 ให้ใส่ '-'
  * โซน 4 (น้ำหนักปลายทาง col16, col17, col18, col19, col20, col21): ให้ใส่ 0 ทั้งหมด ห้ามคัดลอกตัวเลขจากโซน 3 มาใส่เด็ดขาด`;
      } else if (targetDocType === 'dest_weighbridge') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุว่านี่คือ "ตั๋วชั่งน้ำหนักรถบรรทุกปลายทาง (dest_weighbridge)":
- บังคับให้ตั้งค่า docType = 'dest_weighbridge'
- เอกสารนี้คือตั๋วชั่งน้ำหนักหน้างานปลายทาง เพื่อนำไปจับคู่ลง [โซน 4]
- โฟกัสสูงสุดที่:
  * col17: เลขที่ตั๋วชั่งปลายทาง
  * col16: วันที่ชั่งปลายทาง (YYYY-MM-DD)
  * col18: น้ำหนักชั่งเข้าปลายทาง (Gross ปลายทาง) กก.
  * col19: น้ำหนักชั่งออกปลายทาง (Tare ปลายทาง) กก.
  * col20: น้ำหนักสุทธิปลายทาง (Net ปลายทาง = col18 - col19) กก.
  * col10: ทะเบียนรถบรรทุก (สำคัญมาก ใช้สำหรับจับคู่กับเที่ยวรถต้นทาง)
  * referenceDocNo: เลขที่ใบส่งของ หรือ เลขที่ตั๋วชั่งต้นทางที่อ้างอิงถึง
  * col6: เลขที่ตั๋วปลายทางนี้ (ใส่เลขเดียวกันกับ col17)
  * col7: วันที่ชั่ง (ใส่วันที่เดียวกันกับ col16)
  * col8: ผู้จำหน่าย / แหล่งสินค้าต้นทาง
  * col11: รายการสินค้า
  * col37: สถานที่ชั่งปลายทาง / ไซต์งาน
  * col38: หมายเหตุบนตั๋วชั่งปลายทาง
  * โซน 3 (col13, col14, col15): ใส่ 0 (เพราะเป็นตั๋วปลายทาง ไม่ใช่ต้นทาง)
  * โซน 5 และ 6: ใส่ 0`;
      } else if (targetDocType === 'delivery_order' || targetDocType === 'weighbridge') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุว่านี่คือ "ใบส่งของ / ใบส่งสินค้า (DO) จากร้านค้า/โรงโม่/ท่าทราย/แพลนท์คอนกรีต (delivery_order)":
- บังคับให้ตั้งค่า docType = 'delivery_order'
- เอกสารนี้ครอบคลุมทั้ง: (1) ใบส่งสินค้าวัสดุก่อสร้างทั่วไป, (2) ใบส่งคอนกรีตผสมเสร็จ, และ (3) ใบส่งของ/ตั๋วชั่งต้นทางจากโรงโม่หินหรือท่าทรายของร้านค้าที่มีน้ำหนักชั่งรถบรรทุก
- โฟกัสสูงสุดที่:
  * col6: เลขที่ใบส่งของ / เลขที่ DO / เลขที่ตั๋วต้นทางจากร้านค้า **หากในเอกสารมีทั้ง "เล่มที่ (Book/Vol.)" และ "เลขที่ (No.)" ให้รวมเป็นรูปแบบ "เล่มที่/เลขที่" เสมอ (เช่น เล่มที่ 03 เลขที่ 0125 -> 03/0125)**
  * bookNo: เล่มที่ของใบส่งของ (หากมีพิมพ์แยกช่องบนหัวบิล เช่น 03)
  * col4: เลขที่ใบสั่งซื้อ (PO ที่อ้างถึง - ตรวจหาอย่างละเอียด: ไม่ว่าจะเป็นตัวพิมพ์ในช่องฟอร์ม PO, บันทึกไว้ในช่องหมายเหตุ, หรือเขียนด้วยลายมือปากกาตรงไหนสักที่บนใบส่งของ หากมีทั้งเล่มที่และเลขที่ให้ใช้รูปแบบ เล่มที่/เลขที่)
  * referenceDocNo: บันทึกเลขที่ PO ที่อ้างถึงนี้ด้วย
  * referenceSource: ระบุแหล่งที่พบเลขอ้างอิง ('form_field', 'notes', หรือ 'handwritten')
  * col7: วันที่ส่งมอบ (YYYY-MM-DD)
  * col8: ผู้จำหน่าย / ร้านค้า / โรงโม่หิน / ท่าทราย / แพลนท์คอนกรีต
  * col9: ผู้รับสินค้า / ผู้ซื้อ / โครงการ
  * col10: ทะเบียนรถบรรทุก / เบอร์รถโม่ (หากมี)
  * col11: รายการสินค้าหลัก (เช่น หินคลุก, ทรายหยาบ, เหล็ก, ปูน, คอนกรีตผสมเสร็จ, ท่อ, สี)
  * col12: สเปก / ขนาด / KSC / Slump (หากมี)
  * โซน 3 (น้ำหนักชั่งต้นทางจากร้านค้า col13, col14, col15):
    - หากเป็นสินค้าทั่วไปที่ไม่ชั่งน้ำหนักรถบรรทุก ให้ใส่ 0
    - หากในใบส่งของ/ตั๋วต้นทางจากร้านค้านี้มีตัวเลขชั่งน้ำหนักรถบรรทุกพิมพ์อยู่ ให้สกัดลง col13, col14, col15 ทันทีโดยยึดกฎเหล็กว่า:
      * col13 = น้ำหนักหนัก / น้ำหนักรถรวมสินค้า (Gross กก. — ตัวเลขที่มากกว่าเสมอ! แม้ในบิลโรงโม่ต้นทางจะพิมพ์ว่า "ชั่งออก/น้ำหนักออก" ก็ต้องนำมาใส่ col13)
      * col14 = น้ำหนักเบา / น้ำหนักรถเปล่า (Tare กก. — ตัวเลขที่น้อยกว่าเสมอ! แม้ในบิลโรงโม่ต้นทางจะพิมพ์ว่า "ชั่งเข้า/น้ำหนักเข้า" เพราะรถวิ่งเข้าโรงโม่ตัวเปล่า ก็ต้องนำมาใส่ col14)
      * col15 = น้ำหนักสุทธิ (Net กก. = col13 - col14)
      * และหากเป็นบิลชั่งน้ำหนักหิน/ดิน/ทราย ให้แปลงน้ำหนักสุทธิเป็นตัน (col15 / 1000) ใส่ใน col22 และใส่หน่วย col23 = 'ตัน'
  * col22: ปริมาณสินค้า (เช่น จำนวนตันจากน้ำหนักสุทธิ / 1000, หรือจำนวนเส้น, ถุง, คิว m3)
  * col23: หน่วยนับจริง (ตัน, คิว, เส้น, ถุง, ถัง, แผ่น, กล่อง, ม้วน, ชุด)
  * col24: ราคาต่อหน่วย (หากมีพิมพ์ในบิลส่งของ)
  * col25: รวมค่าสินค้า (หากมี)
  * col29: รวมทั้งสิ้น (หากมี)
  * col38: หมายเหตุ (บันทึกข้อความอ้างอิงหรือลายมือที่พบ)
  * lineItems: รายการสินค้าทั้งหมดในใบส่งของ
  * โซน 6 (การชำระเงิน col30 - col36): ให้ใส่ 0 ทั้งหมด (เว้นแต่เป็นใบเสร็จรับเงิน/บิลเงินสดที่มีการชำระเงินแล้วจริง)
  * โซน 4 (น้ำหนักปลายทาง col16 - col21): ใส่ 0 เสมอ ห้ามคัดลอกน้ำหนักต้นทางจากโซน 3 มาใส่เด็ดขาด`;
      } else if (targetDocType === 'concrete') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุว่านี่คือ "ใบส่งคอนกรีตผสมเสร็จ (delivery_order)":
- บังคับให้ตั้งค่า docType = 'delivery_order'
- โฟกัสสูงสุดที่:
  * col8: แพลนท์คอนกรีต / ผู้ผลิต (เช่น ซีแพค CPAC, นครหลวง, ทีพีไอ TPI)
  * col6: เลขที่ตั๋วคอนกรีต / DO
  * col10: ทะเบียนรถโม่ปูน / เบอร์รถ
  * col11: รายการคอนกรีตผสมเสร็จ
  * col12: กำลังอัด KSC (Cube/Cylinder) และค่ายุบตัว (Slump เช่น 10±2.5 ซม.)
  * col22: ปริมาณคอนกรีตเที่ยวนี้ (ตัวเลขเป็นคิว / m3)
  * col23: หน่วย ให้ใส่ 'คิว'
  * col24, col25, col29: ราคาต่อคิวและยอดเงินรวม (หากมี)
  * col37: ไซต์งาน / จุดเทคอนกรีต
  * โซน 3 และ 4: ใส่ 0`;
      } else if (targetDocType === 'tax_invoice') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุว่านี่คือ "ใบเสร็จรับเงิน / ใบกำกับภาษี (tax_invoice)":
- บังคับให้ตั้งค่า docType = 'tax_invoice'
- โฟกัสสูงสุดที่:
  * col6: เลขที่ใบเสร็จ / เลขที่ใบกำกับภาษี
  * col7: วันที่ออกเอกสาร
  * col8: ชื่อบริษัทผู้ขาย / ร้านค้า
  * storeSuggestion.taxId: เลขประจำตัวผู้เสียภาษี 13 หลักของผู้ขาย
  * col11: รายการสินค้า/บริการ
  * col25: มูลค่าสินค้าก่อนภาษี (Subtotal)
  * col28: ค่าขนส่ง (หากมี)
  * col29: ยอดเงินรวมทั้งสิ้น (Grand Total รวม VAT)
  * col30: วิธีชำระเงิน (เงินสด/โอนเงิน/เช็ค)
  * col31: ยอดเงินที่ชำระแล้ว
  * col36: ยอดค้าง (หากยังไม่ชำระ)`;
      } else if (targetDocType === 'full_logistics') {
        specificTargetInstructions = `
[คำสั่งพิเศษจากผู้ใช้งาน]: ผู้ใช้ระบุว่านี่คือ "เอกสารโลจิสติกส์ 39 คอลัมน์เต็ม":
- บังคับให้ตั้งค่า docType = 'full_logistics'
- กรุณาสกัดข้อมูลครบถ้วนทั้ง 7 โซน (1 - 38)`;
      }
    }

    const promptText = `คุณคือผู้เชี่ยวชาญระดับสูงในการอ่านและสกัดข้อมูลเอกสารงานจัดซื้อและก่อสร้างของไทยทุกประเภท ทั้งสินค้าทั่วไปและสินค้าชั่งน้ำหนัก
${specificTargetInstructions}

${!specificTargetInstructions ? `กรุณาตรวจสอบรูปภาพเอกสารนี้อย่างละเอียด และระบุประเภทเอกสาร (docType) ให้ถูกต้อง:
- 'delivery_order': ใบส่งสินค้า / ใบส่งของทั่วไป (สินค้าจัดซื้อทั่วไปที่ไม่ชั่งน้ำหนัก เช่น เหล็ก, ท่อ, ปูนถุง, สี, ไม้, อุปกรณ์ช่าง, สายไฟ, กระเบื้อง, สุขภัณฑ์, อะไหล่ มีหน่วยนับเป็น เส้น/ท่อน/ถุง/ถัง/แผ่น/กล่อง/ม้วน/ชิ้น/ชุด)
- 'weighbridge': ตั๋วชั่งน้ำหนักรถบรรทุก (สินค้าเทกอง เช่น หิน, ดิน, ทราย, ยางมะตอย ที่มีตัวเลขน้ำหนัก Gross หนัก / Tare เบา / Net สุทธิ กก.)
- 'concrete': ใบส่งคอนกรีตผสมเสร็จ (ระบุเกรดคอนกรีต KSC, Slump, ปริมาณเป็นคิว/m3)
- 'tax_invoice': ใบเสร็จรับเงิน / ใบกำกับภาษีซื้อ (มีเลขผู้เสียภาษี 13 หลัก, ตาราง VAT 7%)
- 'purchase_order': ใบสั่งซื้อสินค้า (PO / Purchase Order ออกโดยฝ่ายจัดซื้อ มีตารางรายการสั่งซื้อ เงื่อนไขชำระ และช่องอนุมัติ)
- 'full_logistics': ตั๋วขนส่ง 39 คอลัมน์ชั่งต้นทาง-ปลายทาง` : ''}

จากนั้นสกัดข้อมูลตามคอลัมน์ที่เกี่ยวข้อง:
โซน 1: เอกสารอ้างอิงหลัก (col1: เลข TR, col2: โครงการ, col3: หมวดหมู่วัสดุ/งานก่อสร้าง [จัดหมวดหมู่อัตโนมัติให้ครอบคลุมงานรับเหมาก่อสร้าง งานถนน งานสะพาน กรมทางหลวง (ทล.) และกรมทางหลวงชนบท (ทช.) เช่น 'หิน/ดิน/ทราย (ชั้นทาง & พื้นทาง)', 'ยางมะตอย & ผิวทางลาดยาง (ทล./ทช.)', 'คอนกรีตผสมเสร็จ & ผิวทางคอนกรีต', 'งานสะพาน & คอนกรีตอัดแรง', 'เหล็กเส้น & เหล็กโครงสร้างสะพาน/ถนน', 'งานท่อระบายน้ำ & รางระบายน้ำ', 'งานอำนวยความปลอดภัย & จราจร (ทล./ทช.)', 'งานป้องกันการกัดเซาะ & กำแพงกันดิน', 'ปูนซีเมนต์ & เคมีภัณฑ์ก่อสร้าง', 'ไม้แบบ นั่งร้าน & วัสดุสิ้นเปลือง', 'เครื่องจักรกลหนัก & น้ำมันเชื้อเพลิง', 'งานขนส่ง & โลจิสติกส์', 'ระบบไฟฟ้า & ประปาสนาม', หรือ 'วัสดุก่อสร้างทั่วไป'], col4: เลขที่ PO ที่อ้างถึง, col5: เลขที่ RR, col6: เลขที่ DO / เลขที่ใบส่งของ)
**กฎเหล็กการอ่านเลขที่เอกสาร (PO / DO / ใบเสร็จ):**
- กรณีเอกสารมีทั้ง "เล่มที่ (Book No. / Vol.)" และ "เลขที่ (No.)" แยกกันบนหัวบิล ให้สกัดและจัดเก็บเป็นรูปแบบ 'เล่มที่/เลขที่' เสมอ (เช่น บนบิลพิมพ์ 'เล่มที่ 02 เลขที่ 0045' ให้บันทึกเป็น '02/0045' โดยนำ เล่มที่ ไว้หน้า '/' และนำ เลขที่ ไว้หลัง '/' พร้อมระบุค่าเล่มที่ลงในฟิลด์ bookNo)
- กรณีเอกสารไม่มี "เล่มที่" (มีเฉพาะเลขที่เอกสารอย่างเดียว เช่น 'PO-2026-001' หรือ 'DO-8891') ให้อ่านตามที่ปรากฏตรงๆ ห้ามเติมหรือสลับ '/' เองเด็ดขาด
โซน 2: วันที่ คู่ค้า & สินค้า (col7: วันที่ส่งของ YYYY-MM-DD, col8: ผู้จำหน่าย/ร้านค้า, col9: ผู้รับสินค้า/โครงการ, col10: ทะเบียนรถ (หากมี), col11: รายการสินค้าหลัก (หรือสรุปรายการทั้งหมด), col12: สเปก/Code)
โซน 3: น้ำหนักต้นทาง (col13: น้ำหนักหนักต้นทาง/รถรวมสินค้า Gross กก. [ค่าที่มากกว่าเสมอ], col14: น้ำหนักเบาต้นทาง/รถเปล่า Tare กก. [ค่าที่น้อยกว่าเสมอ], col15: สุทธิต้นทาง กก. = col13 - col14) **ระวัง: บิลโรงโม่ต้นทางมักชั่งรถเปล่าตอนขาเข้า ("น้ำหนักเข้า" = เบา Tare -> ใส่ col14) และชั่งรถที่มีของตอนขาออก ("น้ำหนักออก" = หนัก Gross -> ใส่ col13) ห้ามใส่สลับกันเด็ดขาด**
โซน 4: ปลายทาง & ผลต่าง (col16: วันที่ปลายทาง, col17: ตั๋วปลายทาง, col18: หนักเข้าปลายทาง Gross กก. [ค่าที่มากกว่าเสมอ], col19: เบาออกปลายทาง Tare กก. [ค่าที่น้อยกว่าเสมอ], col20: สุทธิปลายทาง กก. = col18 - col19, col21: ผลต่าง กก.) **สำหรับตั๋วชั่งปลายทาง (dest_weighbridge) ให้ใส่ข้อมูลน้ำหนักลงใน col18, col19, col20 เสมอ**
โซน 5: คิดเงิน & ปริมาณ (col22: ปริมาณสินค้าที่ส่งมอบ, col23: หน่วยนับจริง เช่น เส้น, ท่อน, ถุง, ถัง, แผ่น, กล่อง, ม้วน, ชุด, คิว, ตัน, col24: ราคาต่อหน่วย, col25: รวมค่าสินค้า = ปริมาณ * ราคา, col26: ประเภทรถ, col27: ค่าบรรทุก/หน่วย, col28: รวมค่าขนส่ง, col29: รวมทั้งสิ้น = ค่าสินค้า + ค่าขนส่ง)
โซน 6: การชำระเงิน (col30: รูปแบบจ่าย เช่น โอนเงิน/เงินสด/เครดิต 30 วัน, col31: จ่ายแล้ว, col32: ค้างผู้ขาย, col33: จ่ายขนส่งแล้ว, col34: ค้างขนส่ง, col35: ชำระแล้วรวม, col36: ยอดค้างรวม)
โซน 7: สถานที่ & หมายเหตุ (col37: สถานที่ส่ง/หน้างาน, col38: หมายเหตุ)

หากใบส่งของมีหลายรายการสินค้า ให้สกัดลงใน lineItems: [{ itemDescription, specCode, qty, unit, unitPrice, totalAmount }]
พร้อมสรุป storeSuggestion (ข้อมูลร้านค้า/คู่ค้า): name, category, taxId, phone, address, creditTerms

หมายเหตุสำคัญ:
- สินค้าทั่วไปที่ไม่มีการชั่งน้ำหนัก (เช่น ปูนถุง, เหล็ก, ท่อ, สี, สายไฟ) ให้ใส่หน่วยนับจริงใน col23 และใส่ค่าน้ำหนักในโซน 3 และ 4 เป็น 0 เสมอ
- ตรวจสอบความถูกต้องของการคำนวณราคาและยอดรวม`;

    const { response, usedModel } = await callGeminiWithResilience(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64
            }
          },
          {
            text: promptText
          }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            docType: { 
              type: Type.STRING, 
              description: "ประเภทเอกสาร: 'delivery_order' (ใบส่งของสินค้าทั่วไปไม่ชั่งน้ำหนัก), 'weighbridge' (ตั๋วชั่งน้ำหนักหินดินทราย), 'concrete' (คอนกรีตผสมเสร็จ), 'tax_invoice' (ใบกำกับภาษี), 'purchase_order' (ใบสั่งซื้อ), หรือ 'full_logistics'" 
            },
            referenceDocNo: {
              type: Type.STRING,
              description: "เลขที่เอกสารอ้างอิง เช่น ตั๋วชั่งอ้างถึง DO เลขอะไร หรือ DO อ้างถึง PO เลขอะไร (ตรวจหาจากฟอร์มพิมพ์, ช่องหมายเหตุ หรือที่เขียนด้วยลายมือ)"
            },
            referenceSource: {
              type: Type.STRING,
              description: "แหล่งที่พบเลขอ้างอิง: 'form_field', 'notes', หรือ 'handwritten'"
            },
            bookNo: {
              type: Type.STRING,
              description: "เล่มที่ของเอกสาร (Book No. / Vol.) หากมีระบุบนบิล เช่น '02' หรือ '15' (หากไม่มีให้เว้นว่าง)"
            },
            col1: { type: Type.STRING, description: "1. เลข TR" },
            col2: { type: Type.STRING, description: "2. โครงการ" },
            col3: { type: Type.STRING, description: "3. หมวดหมู่" },
            col4: { type: Type.STRING, description: "4. เลขที่ PO (หากมีทั้งเล่มที่และเลขที่ ให้ใช้รูปแบบ เล่มที่/เลขที่ เช่น 02/0045)" },
            col5: { type: Type.STRING, description: "5. RR" },
            col6: { type: Type.STRING, description: "6. เลขที่ DO / ใบส่งของ / ตั๋ว (หากมีทั้งเล่มที่และเลขที่ ให้ใช้รูปแบบ เล่มที่/เลขที่ เช่น 03/0125)" },
            col7: { type: Type.STRING, description: "7. วันที่ YYYY-MM-DD" },
            col8: { type: Type.STRING, description: "8. ผู้จำหน่าย / ร้านค้า" },
            col9: { type: Type.STRING, description: "9. ผู้รับเหมา / ผู้ซื้อ" },
            col10: { type: Type.STRING, description: "10. ทะเบียนรถ" },
            col11: { type: Type.STRING, description: "11. รายการสินค้า" },
            col12: { type: Type.STRING, description: "12. สเปก / Code" },
            col13: { type: Type.NUMBER, description: "13. หนักต้นทาง" },
            col14: { type: Type.NUMBER, description: "14. เบาต้นทาง" },
            col15: { type: Type.NUMBER, description: "15. สุทธิต้นทาง" },
            col16: { type: Type.STRING, description: "16. วันที่ปลายทาง" },
            col17: { type: Type.STRING, description: "17. ตั๋วปลายทาง" },
            col18: { type: Type.NUMBER, description: "18. หนักปลายทาง" },
            col19: { type: Type.NUMBER, description: "19. เบาปลายทาง" },
            col20: { type: Type.NUMBER, description: "20. สุทธิปลายทาง" },
            col21: { type: Type.NUMBER, description: "21. ผลต่าง กก." },
            col22: { type: Type.NUMBER, description: "22. ปริมาณ" },
            col23: { type: Type.STRING, description: "23. หน่วยนับจริง เช่น เส้น, ท่อน, ถุง, ถัง, แผ่น, กล่อง, ม้วน, ชุด, คิว, ตัน" },
            col24: { type: Type.NUMBER, description: "24. ราคา/หน่วย" },
            col25: { type: Type.NUMBER, description: "25. รวมค่าสินค้า" },
            col26: { type: Type.STRING, description: "26. ประเภทรถ" },
            col27: { type: Type.NUMBER, description: "27. ค่าบรรทุก/หน่วย" },
            col28: { type: Type.NUMBER, description: "28. รวมค่าขนส่ง" },
            col29: { type: Type.NUMBER, description: "29. รวมทั้งสิ้น" },
            col30: { type: Type.STRING, description: "30. รูปแบบจ่าย" },
            col31: { type: Type.NUMBER, description: "31. จ่ายผู้ขายแล้ว" },
            col32: { type: Type.NUMBER, description: "32. ค้างผู้ขาย" },
            col33: { type: Type.NUMBER, description: "33. จ่ายขนส่งแล้ว" },
            col34: { type: Type.NUMBER, description: "34. ค้างขนส่ง" },
            col35: { type: Type.NUMBER, description: "35. ชำระแล้วรวม" },
            col36: { type: Type.NUMBER, description: "36. ยอดค้างรวม" },
            col37: { type: Type.STRING, description: "37. สถานที่ส่ง/กม." },
            col38: { type: Type.STRING, description: "38. หมายเหตุ" },
            lineItems: {
              type: Type.ARRAY,
              description: "รายการสินค้าแต่ละรายการในใบส่งสินค้าหรือใบสั่งซื้อ",
              items: {
                type: Type.OBJECT,
                properties: {
                  itemDescription: { type: Type.STRING, description: "ชื่อสินค้า" },
                  specCode: { type: Type.STRING, description: "สเปก / ขนาด" },
                  qty: { type: Type.NUMBER, description: "จำนวน" },
                  unit: { type: Type.STRING, description: "หน่วยนับ" },
                  unitPrice: { type: Type.NUMBER, description: "ราคาต่อหน่วย" },
                  totalAmount: { type: Type.NUMBER, description: "จำนวนเงิน" }
                }
              }
            },
            storeSuggestion: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                category: { type: Type.STRING },
                taxId: { type: Type.STRING },
                phone: { type: Type.STRING },
                address: { type: Type.STRING },
                creditTerms: { type: Type.STRING }
              }
            }
          },
          required: ["col8", "col11"]
        }
      }
    });

    const textOutput = response.text || "{}";
    const parsedData = JSON.parse(textOutput);

    // Helper to deterministically format book number + document number as "เล่มที่/เลขที่"
    const formatDocNoWithBook = (rawDoc?: string, rawBook?: string): string => {
      if (!rawDoc && !rawBook) return '';
      const docStr = (rawDoc || '').trim();
      const bookStr = (rawBook || '')
        .replace(/^(?:เล่มที่|เล่ม|book\s*no\.?|book|vol\.?)\s*[:#.]?\s*/i, '')
        .trim();

      // Case 1: String explicitly contains Thai labels "เล่ม..." and "เลข..."
      if (/เล่ม/i.test(docStr) && /เลข/i.test(docStr)) {
        const bMatch = /เล่ม(?:ที่)?\s*[:#.]?\s*([A-Za-z0-9\-_]+)/i.exec(docStr);
        const nMatch = /เลข(?:ที่)?\s*[:#.]?\s*([A-Za-z0-9\-_]+)/i.exec(docStr);
        if (bMatch?.[1] && nMatch?.[1]) {
          return `${bMatch[1]}/${nMatch[1]}`;
        }
      }

      const cleanDoc = docStr
        .replace(/^(?:เลขที่|เลข|no\.?)\s*[:#.]?\s*/i, '')
        .trim();

      if (!bookStr || bookStr === '-' || bookStr === '0') {
        return cleanDoc;
      }

      if (!cleanDoc) return bookStr;

      // Check if cleanDoc already contains slash
      if (cleanDoc.includes('/')) {
        const parts = cleanDoc.split('/').map(s => s.trim());
        if (parts.length === 2) {
          // If AI accidentally formatted as "เลขที่/เล่มที่" (bookStr is on the right), flip to "เล่มที่/เลขที่"
          if (parts[1] === bookStr && parts[0] !== bookStr) {
            return `${parts[1]}/${parts[0]}`;
          }
          return `${parts[0]}/${parts[1]}`;
        }
        return cleanDoc;
      }

      return `${bookStr}/${cleanDoc}`;
    };

    if (parsedData.bookNo || /เล่ม/i.test(parsedData.col6 || '') || /เล่ม/i.test(parsedData.col4 || '')) {
      if (parsedData.docType === 'purchase_order') {
        parsedData.col4 = formatDocNoWithBook(parsedData.col4 || parsedData.col6, parsedData.bookNo);
      } else {
        if (parsedData.col6) {
          parsedData.col6 = formatDocNoWithBook(parsedData.col6, parsedData.bookNo);
        }
        if (/เล่ม/i.test(parsedData.col4 || '')) {
          parsedData.col4 = formatDocNoWithBook(parsedData.col4, '');
        }
      }
    }

    // Auto-calculate any un-calculated values & enforce physical invariant: Gross >= Tare
    let col13 = Number(parsedData.col13) || 0;
    let col14 = Number(parsedData.col14) || 0;
    if (col13 > 0 && col14 > 0 && col13 < col14) {
      // Origin DOs/tickets often print Tare first ("น้ำหนักเข้า" = empty truck) and Gross second ("น้ำหนักออก" = loaded truck).
      // Swap so col13 is always Gross (heavy) and col14 is always Tare (light).
      const tmp = col13;
      col13 = col14;
      col14 = tmp;
      parsedData.col13 = col13;
      parsedData.col14 = col14;
    }
    if (col13 > 0 && col14 > 0) {
      parsedData.col15 = col13 - col14;
    }

    // If DO has origin net weight (col15 > 0) and col22 is missing or still in raw kg (> 500 when unit is tons), convert to tons automatically
    if (Number(parsedData.col15) > 0 && parsedData.docType !== 'dest_weighbridge') {
      if (!parsedData.col23 || parsedData.col23 === 'รายการ' || parsedData.col23 === 'กก.' || parsedData.col23 === 'กิโลกรัม') {
        parsedData.col23 = 'ตัน';
      }
      if ((parsedData.col23 || '').includes('ตัน')) {
        const currentQty = Number(parsedData.col22) || 0;
        if (currentQty === 0 || currentQty === Number(parsedData.col15)) {
          parsedData.col22 = Number((Number(parsedData.col15) / 1000).toFixed(2));
        }
      }
    }

    let col18 = Number(parsedData.col18) || 0;
    let col19 = Number(parsedData.col19) || 0;
    if (col18 > 0 && col19 > 0 && col18 < col19) {
      const tmp = col18;
      col18 = col19;
      col19 = tmp;
      parsedData.col18 = col18;
      parsedData.col19 = col19;
    }
    if (col18 > 0 && col19 > 0) {
      parsedData.col20 = col18 - col19;
    }
    if (parsedData.col15 && parsedData.col20) {
      parsedData.col21 = Number(parsedData.col15) - Number(parsedData.col20);
    }

    const qty = Number(parsedData.col22) || 0;
    const price = Number(parsedData.col24) || 0;
    if (!parsedData.col25 && qty && price) {
      parsedData.col25 = qty * price;
    }
    const freightRate = Number(parsedData.col27) || 0;
    if (!parsedData.col28 && qty && freightRate) {
      parsedData.col28 = qty * freightRate;
    }
    if (!parsedData.col29) {
      parsedData.col29 = (Number(parsedData.col25) || 0) + (Number(parsedData.col28) || 0);
    }

    // Strictly enforce user's selected document type over any AI hallucination/guessing
    // Unify origin store weighbridge ('weighbridge') and 'concrete' into 'delivery_order' (DO)
    if (targetDocType && targetDocType !== 'auto') {
      parsedData.docType = (targetDocType === 'concrete' || targetDocType === 'weighbridge') ? 'delivery_order' : targetDocType;
    } else if (parsedData.docType === 'weighbridge' || parsedData.docType === 'concrete') {
      parsedData.docType = 'delivery_order';
    }

    // Capture rawAiSnapshot BEFORE clearing Zone 3 or Zone 4 so switching docType in VerifyModal never loses scale weights
    const rawGrossSnapshot = Number(parsedData.col13) || Number(parsedData.col18) || 0;
    const rawTareSnapshot = Number(parsedData.col14) || Number(parsedData.col19) || 0;
    const rawNetSnapshot =
      Number(parsedData.col15) ||
      Number(parsedData.col20) ||
      (rawGrossSnapshot > 0 && rawTareSnapshot > 0 ? Math.abs(rawGrossSnapshot - rawTareSnapshot) : 0);

    parsedData.rawAiSnapshot = {
      rawDocNo: parsedData.col17 || parsedData.col6 || '',
      rawRefPoNo: parsedData.col4 || '',
      rawRefDoNo: parsedData.referenceDocNo || '',
      referenceSource: parsedData.referenceSource || 'form_field',
      rawDate: parsedData.col7 || parsedData.col16 || '',
      rawStoreName: parsedData.col8 || '',
      rawCategory: parsedData.col3 || '',
      rawLicensePlate: parsedData.col10 || '',
      rawVehicleType: parsedData.col26 || '',
      rawItemDescription: parsedData.col11 || '',
      rawSpecCode: parsedData.col12 || '',
      rawGrossWeightKg: rawGrossSnapshot,
      rawTareWeightKg: rawTareSnapshot,
      rawNetWeightKg: rawNetSnapshot,
      rawQty: Number(parsedData.col22) || 0,
      rawUnit: parsedData.col23 || '',
      rawUnitPrice: Number(parsedData.col24) || 0,
      rawGoodsAmount: Number(parsedData.col25) || 0,
      rawGrandTotal: Number(parsedData.col29) || 0
    };

    // Prevent Zone 4 (destination scale) from duplicating Zone 3 origin weights
    if (parsedData.docType !== 'full_logistics' && parsedData.docType !== 'dest_weighbridge') {
      parsedData.col16 = '';
      parsedData.col17 = '';
      parsedData.col18 = 0;
      parsedData.col19 = 0;
      parsedData.col20 = 0;
      parsedData.col21 = 0;
    } else if (parsedData.docType === 'dest_weighbridge') {
      // Fallback: if AI placed destination weights into col13-15 by mistake, shift them to col18-20
      if ((!Number(parsedData.col18) && !Number(parsedData.col20)) && (Number(parsedData.col13) > 0 || Number(parsedData.col15) > 0)) {
        let g = Number(parsedData.col13) || 0;
        let t = Number(parsedData.col14) || 0;
        if (g > 0 && t > 0 && g < t) {
          const tmp = g;
          g = t;
          t = tmp;
        }
        parsedData.col18 = g;
        parsedData.col19 = t;
        parsedData.col20 = (g > 0 && t > 0) ? (g - t) : (Number(parsedData.col15) || 0);
      }
      if (!Number(parsedData.col20) && Number(parsedData.col22) > 0 && (parsedData.col23 || '').includes('ตัน')) {
        parsedData.col20 = Math.round(Number(parsedData.col22) * 1000);
      }
      if (!parsedData.col16 && parsedData.col7) parsedData.col16 = parsedData.col7;
      if (!parsedData.col17 && parsedData.col6) parsedData.col17 = parsedData.col6;
      parsedData.col13 = 0;
      parsedData.col14 = 0;
      parsedData.col15 = 0;
      parsedData.col21 = 0;
    }

    // Ensure reference consistency for DO and Weighbridge
    if (parsedData.docType === 'delivery_order') {
      if (!parsedData.col4 && parsedData.referenceDocNo) {
        parsedData.col4 = parsedData.referenceDocNo;
      }
      if (!parsedData.col4 && parsedData.col38) {
        const poMatch = /(?:PO|ใบสั่งซื้อ|สั่งซื้อ|P[/.]?O[.]?|Ref(?:\s*PO)?|อ้างอิง(?:\s*PO)?|ตาม(?:\s*PO)?|สัญญา)\s*[:#№.\s-]*([A-Za-z0-9\-_/]+)/i.exec(parsedData.col38);
        if (poMatch && poMatch[1]) {
          parsedData.col4 = poMatch[1].trim();
          parsedData.referenceDocNo = poMatch[1].trim();
          if (!parsedData.referenceSource) parsedData.referenceSource = 'notes';
        }
      }
    } else if (parsedData.docType === 'weighbridge') {
      if (!parsedData.referenceDocNo && parsedData.col38) {
        const doMatch = /(?:DO|ใบส่งของ|บิลส่งของ|D[/.]?O[.]?|บิลเลขที่|บิล|Ref(?:\s*DO)?|อ้างอิง(?:\s*DO)?|ส่งตาม(?:\s*DO)?)\s*[:#№.\s-]*([A-Za-z0-9\-_/]+)/i.exec(parsedData.col38);
        if (doMatch && doMatch[1]) {
          parsedData.referenceDocNo = doMatch[1].trim();
          if (!parsedData.referenceSource) parsedData.referenceSource = 'notes';
        }
        const poMatch = /(?:PO|ใบสั่งซื้อ|สั่งซื้อ|P[/.]?O[.]?|Ref(?:\s*PO)?|อ้างอิง(?:\s*PO)?|ตาม(?:\s*PO)?|สัญญา)\s*[:#№.\s-]*([A-Za-z0-9\-_/]+)/i.exec(parsedData.col38);
        if (poMatch && poMatch[1]) {
          if (!parsedData.col4) parsedData.col4 = poMatch[1].trim();
          if (!parsedData.referenceSource) parsedData.referenceSource = 'notes';
        }
      }
      // If referenceDocNo starts with PO, also set col4
      if (parsedData.referenceDocNo && /^PO[\s\-_/]/i.test(parsedData.referenceDocNo) && !parsedData.col4) {
        parsedData.col4 = parsedData.referenceDocNo;
      }
    }

    // Sanitize col11 and lineItems: Separate any inline remarks/notes mixed into product names into col38 (หมายเหตุ)
    const pureRemarkRowRegex = /^(?:หมายเหตุ|Note|Remark|เงื่อนไข|ส่งที่|สถานที่ส่ง|จัดส่งที่|ติดต่อ|โทร\.?|Tel\.?|\*+|ป\.ล\.|ราคานี้|ราคาดังกล่าว|เครดิต|กรุณาส่ง|ส่งหน้างาน)/i;
    const unpaidRemarkKeywordsRegex = /(?:หมายเหตุ|ติดต่อ|โทร\.?|ส่งที่|สถานที่ส่ง|รวมค่าขนส่ง|ไม่รวมค่าขนส่ง|เครดิต|วางบิล|ใบกำกับภาษี)/i;
    const inlineRemarkSplitRegex = /^(.*?)(?:\s+[-–—|/]+\s*|\s*[(（]\s*|\s+)(?:(หมายเหตุ|Remark|Note|เงื่อนไข(?:การส่ง|ราคา)?|สถานที่ส่ง|จัดส่งที่|ติดต่อ(?:หน้างาน)?)\s*[:：-]?\s*(.+?))[)）]?$/i;

    const extractedBillNotes: string[] = [];

    if (parsedData.col11 && typeof parsedData.col11 === 'string') {
      const m = inlineRemarkSplitRegex.exec(parsedData.col11.trim());
      if (m && m[1] && m[1].trim().length >= 2) {
        parsedData.col11 = m[1].trim();
        const noteLabel = m[2] ? `${m[2]}: ` : '';
        const noteBody = (m[3] || '').replace(/[)）]$/, '').trim();
        if (noteBody) {
          extractedBillNotes.push(`${noteLabel}${noteBody}`.replace(/^หมายเหตุ\s*:\s*/i, ''));
        }
      }
    }

    if (Array.isArray(parsedData.lineItems) && parsedData.lineItems.length > 0) {
      const cleanedLineItems: any[] = [];
      for (const li of parsedData.lineItems) {
        let desc = (li.itemDescription || '').toString().trim();
        const q = Number(li.qty) || 0;
        const p = Number(li.unitPrice) || 0;
        const tot = Number(li.totalAmount) || (q * p);
        if (!desc) continue;

        if (pureRemarkRowRegex.test(desc) || (p === 0 && tot === 0 && unpaidRemarkKeywordsRegex.test(desc))) {
          extractedBillNotes.push(desc.replace(/^(?:หมายเหตุ|Note|Remark)\s*[:：-]?\s*/i, '').trim());
          continue;
        }

        const inlineMatch = inlineRemarkSplitRegex.exec(desc);
        if (inlineMatch && inlineMatch[1] && inlineMatch[1].trim().length >= 2) {
          desc = inlineMatch[1].trim();
          const noteLabel = inlineMatch[2] ? `${inlineMatch[2]}: ` : '';
          const noteBody = (inlineMatch[3] || '').replace(/[)）]$/, '').trim();
          if (noteBody) {
            extractedBillNotes.push(`${noteLabel}${noteBody}`.replace(/^หมายเหตุ\s*:\s*/i, ''));
          }
        }

        cleanedLineItems.push({
          ...li,
          itemDescription: desc
        });
      }
      parsedData.lineItems = cleanedLineItems;
    }

    if (extractedBillNotes.length > 0) {
      const existingNotes = (parsedData.col38 || '').trim();
      const joinedNotes = extractedBillNotes.filter(Boolean).join(' | ');
      parsedData.col38 = existingNotes
        ? (existingNotes.includes(joinedNotes) ? existingNotes : `${existingNotes} | ${joinedNotes}`)
        : joinedNotes;
    }

    return res.json({
      success: true,
      data: parsedData,
      storeSuggestion: parsedData.storeSuggestion,
      modelUsed: usedModel,
      notes: `สกัดข้อมูลสำเร็จผ่าน ${usedModel}`,
      confidence: 0.98
    });

  } catch (error: any) {
    console.error('Gemini Scan Error:', error);
    const errText = error?.message || JSON.stringify(error);
    const isOverloaded = errText.includes('503') || errText.includes('high demand') || errText.includes('UNAVAILABLE') || errText.includes('429');

    return res.status(isOverloaded ? 503 : 500).json({
      success: false,
      isTransient: isOverloaded,
      error: isOverloaded
        ? 'ขณะนี้เซิร์ฟเวอร์ AI ของ Google มีผู้ใช้งานหนาแน่นชั่วคราว (503 High Demand) กรุณากดปุ่ม "ลองใหม่อีกครั้ง"'
        : `การประมวลผล Gemini ผิดพลาด: ${error.message || 'ไม่สามารถวิเคราะห์ภาพได้'}`
    });
  }
});

// Purchase Order (ใบสั่งซื้อ / PO) Scan Endpoint
app.post('/api/scan-po', rateLimitScan, async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType = 'image/png' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาส่งข้อมูลรูปภาพเอกสารใบสั่งซื้อ (imageBase64)'
      });
    }

    const ai = getGeminiClient();

    if (!ai) {
      return res.status(500).json({
        success: false,
        error: 'ระบบไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์ กรุณาตรวจสอบการตั้งค่า'
      });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');

    const poPromptText = `คุณคือผู้เชี่ยวชาญการอ่านเอกสารใบสั่งซื้อ (Purchase Order / PO) ของไทย
กรุณาตรวจสอบเอกสารใบสั่งซื้อนี้ และสกัดข้อมูลออกมาเป็น JSON อย่างละเอียด:
1. poNumber: เลขที่ใบสั่งซื้อ (รองรับทุกรูปแบบในหน้างานจริง เช่น รูปแบบสมุดฉีก "257/12850", รูปแบบรหัสระบบ "PO6900276", หรือเลขที่บิลเดี่ยว "12855") **สำคัญมากสำหรับใบสั่งซื้อแบบสมุดฉีก: กรุณากวาดสายตาดูมุมบนซ้ายและมุมบนขวาของกระดาษอย่างละเอียด มักจะมีคำว่า "เล่มที่ (Book No. / Vol.)" คู่กับ "เลขที่ (No.)" (เช่น เล่มที่ 257 เลขที่ 12855) หากพบทั้งเล่มที่และเลขที่ ให้รวมเป็นรหัสเดียวกันในรูปแบบ "เล่มที่/เลขที่" เสมอ (เช่น "257/12855") แต่หากเป็นใบสั่งซื้อพิมพ์จากระบบคอมพิวเตอร์ที่ไม่มีเล่มที่ (เช่น "PO6900276") หรือมีเฉพาะเลขที่อย่างเดียว ให้สกัดตามที่ปรากฏจริง**
2. bookNo: เล่มที่ของใบสั่งซื้อ (กวาดสายตาดูช่อง "เล่มที่ / Book No." บนหัวบิลอย่างละเอียด เช่น "257" หรือ "02" หากไม่มีจริงๆ ให้เว้นว่าง)
3. orderDate: วันที่สั่งซื้อ (รูปแบบ YYYY-MM-DD)
4. deliveryDueDate: กำหนดส่งมอบของ (รูปแบบ YYYY-MM-DD หากมี)
5. projectId: ชื่อโครงการ หรือหน่วยงานที่สั่งซื้อ
6. storeName: ชื่อผู้จำหน่าย / ผู้ขาย / ร้านค้า
7. category: หมวดหมู่วัสดุ (เช่น งานหิน/ทราย, งานเหล็ก, งานคอนกรีต, วัสดุก่อสร้างทั่วไป)
8. items: รายการสินค้าในตารางสั่งซื้อ (เฉพาะตัวสินค้า/วัสดุจริงที่มีการสั่งซื้อเท่านั้น) ประกอบด้วย:
   - itemDescription: ชื่อรายการสินค้า/วัสดุเพียวๆ เท่านั้น (เช่น "หินคลุก", "ทรายหยาบ", "ปูนซีเมนต์ปอร์ตแลนด์", "เหล็กข้ออ้อย DB16") **กฎเหล็กสำคัญมาก: ในใบสั่งซื้อ (PO) มักมีการเขียนหมายเหตุ เงื่อนไขการส่ง สถานที่จัดส่ง ชื่อผู้ติดต่อ เบอร์โทร หรือเงื่อนไขราคา ไว้ในบรรทัดว่างของตารางสินค้า หรือเขียนต่อท้ายชื่อสินค้า ห้ามนำข้อความหมายเหตุเหล่านั้นมารวมไว้ใน itemDescription หรือสร้างเป็นแถวสินค้าใน items เด็ดขาด! ให้แยกเฉพาะชื่อสินค้าไว้ใน itemDescription และย้ายข้อความหมายเหตุ/เงื่อนไขทั้งหมดไปใส่ในช่อง notes หรือ deliveryLocation เสมอ**
   - specCode: สเปก หรือรหัสสินค้า
   - orderedQty: ปริมาณที่สั่งซื้อ (ตัวเลข)
   - unit: หน่วยนับ (เช่น ตัน, คิว, เส้น, แผ่น, ชุด)
   - unitPrice: ราคาต่อหน่วย (บาท)
   - totalAmount: รวมเงินรายการนี้ (orderedQty * unitPrice)
9. totalAmount: ยอดเงินรวมทั้งสิ้นตามใบสั่งซื้อ
10. creditTerms: เงื่อนไขการชำระเงิน (เช่น เครดิต 30 วัน, เงินสด, โอนเงิน)
11. deliveryLocation: สถานที่จัดส่งสินค้า / ไซต์งาน
12. orderedBy: ผู้เปิดใบสั่งซื้อ / ผู้สั่ง
13. approvedBy: ผู้อนุมัติใบสั่งซื้อ
14. notes: เงื่อนไขหรือหมายเหตุเพิ่มเติม (รวมถึงข้อความหมายเหตุที่เขียนแทรกอยู่ในตารางรายการสินค้าด้วย)`;

    const { response, usedModel } = await callGeminiWithResilience(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64
            }
          },
          {
            text: poPromptText
          }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            poNumber: { type: Type.STRING, description: "เลขที่ PO (หากมีทั้งเล่มที่และเลขที่ ให้จัดรูปแบบเป็น เล่มที่/เลขที่ เช่น 02/0045)" },
            bookNo: { type: Type.STRING, description: "เล่มที่ของใบสั่งซื้อ หากมีระบุบนบิล (เช่น 02)" },
            orderDate: { type: Type.STRING, description: "วันที่สั่งซื้อ YYYY-MM-DD" },
            deliveryDueDate: { type: Type.STRING, description: "กำหนดส่งมอบ" },
            projectId: { type: Type.STRING, description: "โครงการ" },
            storeName: { type: Type.STRING, description: "ชื่อผู้จำหน่าย / ร้านค้า" },
            category: { type: Type.STRING, description: "หมวดหมู่วัสดุ" },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  itemDescription: { type: Type.STRING },
                  specCode: { type: Type.STRING },
                  orderedQty: { type: Type.NUMBER },
                  unit: { type: Type.STRING },
                  unitPrice: { type: Type.NUMBER },
                  totalAmount: { type: Type.NUMBER }
                },
                required: ["itemDescription", "orderedQty"]
              }
            },
            totalAmount: { type: Type.NUMBER, description: "ยอดเงินรวมทั้งสิ้น" },
            creditTerms: { type: Type.STRING, description: "เงื่อนไขชำระเงิน" },
            deliveryLocation: { type: Type.STRING, description: "สถานที่จัดส่ง" },
            orderedBy: { type: Type.STRING, description: "ผู้สั่งซื้อ" },
            approvedBy: { type: Type.STRING, description: "ผู้อนุมัติ" },
            notes: { type: Type.STRING, description: "หมายเหตุ" }
          },
          required: ["poNumber", "storeName"]
        }
      }
    });

    const parsedPO = JSON.parse(response.text || "{}");

    // Format bookNo + poNumber into "เล่มที่/เลขที่" if bookNo is present
    if (parsedPO.bookNo || /เล่ม/i.test(parsedPO.poNumber || '')) {
      const rawDoc = (parsedPO.poNumber || '').trim();
      const rawBook = (parsedPO.bookNo || '')
        .replace(/^(?:เล่มที่|เล่ม|book\s*no\.?|book|vol\.?)\s*[:#.]?\s*/i, '')
        .trim();

      if (/เล่ม/i.test(rawDoc) && /เลข/i.test(rawDoc)) {
        const bMatch = /เล่ม(?:ที่)?\s*[:#.]?\s*([A-Za-z0-9\-_]+)/i.exec(rawDoc);
        const nMatch = /เลข(?:ที่)?\s*[:#.]?\s*([A-Za-z0-9\-_]+)/i.exec(rawDoc);
        if (bMatch?.[1] && nMatch?.[1]) {
          parsedPO.poNumber = `${bMatch[1]}/${nMatch[1]}`;
        }
      } else if (rawBook && rawBook !== '-' && rawBook !== '0') {
        const cleanDoc = rawDoc.replace(/^(?:เลขที่|เลข|no\.?)\s*[:#.]?\s*/i, '').trim();
        if (cleanDoc.includes('/')) {
          const parts = cleanDoc.split('/').map((s: string) => s.trim());
          if (parts.length === 2 && parts[1] === rawBook && parts[0] !== rawBook) {
            parsedPO.poNumber = `${parts[1]}/${parts[0]}`;
          } else {
            parsedPO.poNumber = cleanDoc;
          }
        } else if (cleanDoc) {
          parsedPO.poNumber = `${rawBook}/${cleanDoc}`;
        }
      }
    }

    // Sanitize items: Separate any remarks/notes mixed into item rows or appended to itemDescription
    let totalQty = 0;
    let sumAmount = 0;
    const extractedNotesFromItems: string[] = [];
    const cleanedItems: any[] = [];

    const pureRemarkRowRegex = /^(?:หมายเหตุ|Note|Remark|เงื่อนไข|ส่งที่|สถานที่ส่ง|จัดส่งที่|ติดต่อ|โทร\.?|Tel\.?|\*+|ป\.ล\.|ราคานี้|ราคาดังกล่าว|เครดิต|กรุณาส่ง|ส่งหน้างาน)/i;
    const unpaidRemarkKeywordsRegex = /(?:หมายเหตุ|ติดต่อ|โทร\.?|ส่งที่|สถานที่ส่ง|รวมค่าขนส่ง|ไม่รวมค่าขนส่ง|เครดิต|วางบิล|ใบกำกับภาษี)/i;
    const inlineRemarkSplitRegex = /^(.*?)(?:\s+[-–—|/]+\s*|\s*[(（]\s*|\s+)(?:(หมายเหตุ|Remark|Note|เงื่อนไข(?:การส่ง|ราคา)?|สถานที่ส่ง|จัดส่งที่|ติดต่อ(?:หน้างาน)?)\s*[:：-]?\s*(.+?))[)）]?$/i;

    for (const rawIt of (parsedPO.items || [])) {
      let desc = (rawIt.itemDescription || '').toString().trim();
      const q = Number(rawIt.orderedQty) || 0;
      const p = Number(rawIt.unitPrice) || 0;
      const tot = rawIt.totalAmount ? Number(rawIt.totalAmount) : (q * p);

      if (!desc) continue;

      // Case 1: The entire row is actually a note/remark line written in the table
      if (pureRemarkRowRegex.test(desc) || (p === 0 && tot === 0 && unpaidRemarkKeywordsRegex.test(desc))) {
        extractedNotesFromItems.push(desc.replace(/^(?:หมายเหตุ|Note|Remark)\s*[:：-]?\s*/i, '').trim());
        continue;
      }

      // Case 2: Inline note appended at the end of itemDescription (e.g. "หินคลุก 3/4 หมายเหตุ: ส่งหน้างาน...")
      const inlineMatch = inlineRemarkSplitRegex.exec(desc);
      if (inlineMatch && inlineMatch[1] && inlineMatch[1].trim().length >= 2) {
        desc = inlineMatch[1].trim();
        const noteLabel = inlineMatch[2] ? `${inlineMatch[2]}: ` : '';
        const noteBody = (inlineMatch[3] || '').replace(/[)）]$/, '').trim();
        if (noteBody) {
          extractedNotesFromItems.push(`${noteLabel}${noteBody}`.replace(/^หมายเหตุ\s*:\s*/i, ''));
        }
      }

      totalQty += q;
      sumAmount += tot;
      cleanedItems.push({
        id: `poi-${Date.now()}-${cleanedItems.length}`,
        itemDescription: desc || 'รายการสินค้า',
        specCode: rawIt.specCode || '',
        orderedQty: q,
        unit: rawIt.unit || 'หน่วย',
        unitPrice: p,
        totalAmount: tot
      });
    }

    if (extractedNotesFromItems.length > 0) {
      const existingNotes = (parsedPO.notes || '').trim();
      const joinedExtracted = extractedNotesFromItems.filter(Boolean).join(' | ');
      parsedPO.notes = existingNotes
        ? (existingNotes.includes(joinedExtracted) ? existingNotes : `${existingNotes} | ${joinedExtracted}`)
        : joinedExtracted;
    }

    parsedPO.items = cleanedItems;
    parsedPO.totalQty = totalQty;
    if (!parsedPO.totalAmount || parsedPO.totalAmount === 0) {
      parsedPO.totalAmount = sumAmount;
    }

    return res.json({
      success: true,
      data: parsedPO,
      modelUsed: usedModel,
      notes: `สกัดข้อมูลใบสั่งซื้อสำเร็จผ่าน ${usedModel}`
    });

  } catch (error: any) {
    console.error('Gemini PO Scan Error:', error);
    const errText = error?.message || JSON.stringify(error);
    const isOverloaded = errText.includes('503') || errText.includes('high demand') || errText.includes('UNAVAILABLE') || errText.includes('429');

    return res.status(isOverloaded ? 503 : 500).json({
      success: false,
      isTransient: isOverloaded,
      error: isOverloaded
        ? 'ขณะนี้เซิร์ฟเวอร์ Gemini มีผู้ใช้งานหนาแน่นชั่วคราว (503 High Demand) กรุณากดปุ่ม "ลองใหม่อีกครั้ง"'
        : `การอ่านใบสั่งซื้อล้มเหลว: ${error.message || 'ไม่สามารถวิเคราะห์ข้อมูลเอกสารได้'}`
    });
  }
});

// ============================================================================
// PART 2: LINE OA BOT WEBHOOK, QUEUE-FIRST INBOX & ZERO-QUOTA QUOTE REPLY
// ============================================================================

interface ServerLineBotConfig {
  enabled: boolean;
  channelAccessToken: string;
  channelSecret: string;
  autoQuoteReply: boolean;
  replyOnDuplicate: boolean;
  replyOnUnclearImage: boolean;
  filterNonBillImages: boolean;
  strictZeroPushQuota: boolean;
  allowedGroupNames: string[];
}

let lineBotConfig: ServerLineBotConfig = {
  enabled: true,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
  autoQuoteReply: true,
  replyOnDuplicate: true,
  replyOnUnclearImage: true,
  filterNonBillImages: true,
  strictZeroPushQuota: true, // Strictly use replyToken + quoteToken only (0 monthly quota used)
  allowedGroupNames: []
};

// In-memory queue for bills arriving via real LINE Webhook before browser syncs them to localStorage
const lineWebhookInboxQueue: any[] = [];
const MAX_WEBHOOK_QUEUE_SIZE = 200;

function normalizeDocNoServer(val?: string): string {
  if (!val) return '';
  return val
    .toString()
    .trim()
    .toUpperCase()
    .replace(/^(?:PO|DO|WB|INV|TAX|BILL|NO\.?|เลขที่)\s*[-:.#]?\s*/i, '')
    .replace(/[\s\-_]/g, '');
}

function isServerDocMatch(a?: string, b?: string): boolean {
  const na = normalizeDocNoServer(a);
  const nb = normalizeDocNoServer(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tailA = na.includes('/') ? na.split('/').pop()! : na;
  const tailB = nb.includes('/') ? nb.split('/').pop()! : nb;
  if ((!na.includes('/') || !nb.includes('/')) && tailA.length >= 3 && tailA === tailB) {
    return true;
  }
  return false;
}

function getDocTypeThaiLabel(docType?: string): string {
  switch (docType) {
    case 'dest_weighbridge':
      return 'ตั๋วชั่งน้ำหนักปลายทาง';
    case 'tax_invoice':
      return 'ใบเสร็จ/ใบกำกับภาษี';
    case 'purchase_order':
      return 'ใบสั่งซื้อ (PO)';
    case 'delivery_order':
    default:
      return 'ใบส่งของ (DO)';
  }
}

/**
 * Builds the exact Quote Reply message referencing the submitted bill photo in LINE Group.
 * Uses LINE's replyToken + quoteToken -> 100% FREE, consumes 0 monthly push quota.
 */
function buildLineQuoteReplyText(params: {
  isBillDocument: boolean;
  billNo?: string;
  docType?: string;
  storeName?: string;
  senderName: string;
  isDuplicate?: boolean;
  duplicateMatchedCode?: string;
  scanFailed?: boolean;
}): string {
  const {
    billNo,
    docType,
    storeName,
    senderName,
    isDuplicate,
    duplicateMatchedCode,
    scanFailed
  } = params;

  const cleanBillNo = (billNo || '').trim();
  const cleanStore = (storeName || '').trim() || 'ไม่ระบุร้านค้า';
  const docLabel = getDocTypeThaiLabel(docType);

  if (isDuplicate && cleanBillNo) {
    return [
      `⚠️ แจ้งเตือนบิลซ้ำ!`,
      `• บิลเลขที่: ${cleanBillNo}`,
      `• ร้านค้า: ${cleanStore}`,
      `• สถานะ: เคยส่งเข้าระบบแล้ว${duplicateMatchedCode ? ` (${duplicateMatchedCode})` : ''} ไม่ต้องส่งซ้ำครับ`
    ].join('\n');
  }

  if (scanFailed || !cleanBillNo) {
    return [
      `📥 เก็บรูปบิลเข้าระบบรอตรวจสอบแล้ว`,
      `• สถานะ: รอแอดมินตรวจสอบเลขที่บิล`,
      `• ผู้ส่ง: ${senderName}`
    ].join('\n');
  }

  return [
    `✅ บิลเลขที่ ${cleanBillNo} เก็บเข้าระบบรอตรวจสอบแล้ว`,
    `• ประเภท: ${docLabel}`,
    `• ร้านค้า: ${cleanStore}`,
    `• ผู้ส่ง: ${senderName}`
  ].join('\n');
}

/**
 * Sends a FREE Quote Reply back to the LINE chat/group using replyToken + quoteToken.
 * NEVER uses Push Message API so it NEVER deducts from the LINE OA monthly message quota.
 */
async function sendLineFreeQuoteReply(
  replyToken: string | undefined,
  quoteToken: string | undefined,
  text: string
): Promise<boolean> {
  if (!replyToken || !lineBotConfig.channelAccessToken || !lineBotConfig.autoQuoteReply) {
    return false;
  }
  try {
    const messagePayload: Record<string, any> = {
      type: 'text',
      text
    };
    if (quoteToken) {
      messagePayload.quoteToken = quoteToken;
    }

    const resp = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lineBotConfig.channelAccessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [messagePayload]
      })
    });
    return resp.ok;
  } catch (err) {
    console.warn('LINE Reply API warning:', err);
    return false;
  }
}

/**
 * Fetches Sender Display Name & Group Name from LINE API (Free GET calls, 0 quota used)
 */
async function resolveLineSenderAndGroup(userId?: string, groupId?: string): Promise<{
  senderName: string;
  senderAvatar?: string;
  groupName: string;
}> {
  let senderName = userId ? `พนักงาน LINE (${userId.slice(-4)})` : 'พนักงานหน้างาน';
  let senderAvatar: string | undefined;
  let groupName = groupId ? `กลุ่มรับบิล (${groupId.slice(-4)})` : 'แชทตรง LINE OA';

  if (!lineBotConfig.channelAccessToken) {
    return { senderName, senderAvatar, groupName };
  }

  const headers = { Authorization: `Bearer ${lineBotConfig.channelAccessToken}` };

  // 1. Resolve Group Name if sent inside a LINE Group
  if (groupId) {
    try {
      const groupResp = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, { headers });
      if (groupResp.ok) {
        const gData: any = await groupResp.json();
        if (gData?.groupName) groupName = gData.groupName;
      }
    } catch {
      // ignore
    }
  }

  // 2. Resolve Sender Display Name
  if (userId) {
    try {
      const profileUrl = groupId
        ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
        : `https://api.line.me/v2/bot/profile/${userId}`;
      const profResp = await fetch(profileUrl, { headers });
      if (profResp.ok) {
        const pData: any = await profResp.json();
        if (pData?.displayName) senderName = pData.displayName;
        if (pData?.pictureUrl) senderAvatar = pData.pictureUrl;
      }
    } catch {
      // ignore
    }
  }

  return { senderName, senderAvatar, groupName };
}

/**
 * Comprehensive AI Scanner for LINE Bill Inbox:
 * - Filters out non-bill images (site photos, stickers, selfies)
 * - Extracts ALL zones into `rawAiSnapshot` so the verifier can switch document types in 0 seconds without re-scanning
 * - Keeps `col2` (ชื่อโครงการ) strictly EMPTY so `lineGroupName` is NEVER auto-bound to `col2`
 */
async function analyzeLineBillWithGemini(
  base64Image: string,
  mimeType: string,
  senderName: string,
  groupName: string
): Promise<{
  isBillDocument: boolean;
  nonBillReason?: string;
  detectedDocType: 'delivery_order' | 'dest_weighbridge' | 'tax_invoice' | 'purchase_order';
  extractedData: Record<string, any>;
  rawAiSnapshot: Record<string, any>;
  storeSuggestion?: Record<string, any>;
  confidence: number;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับวิเคราะห์เอกสาร');
  }
  const cleanBase64 = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
  const today = new Date().toISOString().split('T')[0];

  const prompt = `คุณคือผู้เชี่ยวชาญระดับสูงในการอ่านและสกัดข้อมูลเอกสารงานจัดซื้อและก่อสร้างของไทยทุกประเภท ทั้งสินค้าทั่วไปและสินค้าชั่งน้ำหนัก
งานของคุณคือวิเคราะห์ภาพที่ส่งเข้ามาในกลุ่ม LINE:
1. ตรวจสอบก่อนว่าภาพนี้เป็น "เอกสารบิล/ตั๋วชั่ง/ใบส่งของ/ใบเสร็จ/ใบสั่งซื้อ" จริงหรือไม่ (isBillDocument: true/false)
   - ถ้าเป็นรูปถ่ายหน้างานก่อสร้างทั่วไป รูปคน เซลฟี่ รูปอาหาร สติกเกอร์ หรือแชท ให้ตั้งค่า isBillDocument = false และระบุเหตุผลใน nonBillReason
2. ถ้าเป็นเอกสารบิล (isBillDocument = true):
   - จำแนกประเภทเอกสาร (docType):
     * 'delivery_order': ใบส่งของ / ใบส่งสินค้า / บัตรชั่งน้ำหนักต้นทางจากร้านค้าหรือโรงโม่ / ใบส่งคอนกรีต
     * 'dest_weighbridge': ตั๋วชั่งน้ำหนักปลายทางของไซต์งานเรา (เพื่อนำมาชนกับ DO)
     * 'tax_invoice': ใบเสร็จรับเงิน / ใบกำกับภาษี
     * 'purchase_order': ใบสั่งซื้อสินค้า (PO)
   - กฎเหล็กการอ่านเลขที่เอกสาร (PO / DO / ใบเสร็จ):
     * กรณีเอกสารมีทั้ง "เล่มที่ (Book No. / Vol.)" และ "เลขที่ (No.)" แยกกันบนหัวบิล ให้สกัดและจัดเก็บเป็นรูปแบบ 'เล่มที่/เลขที่' เสมอ (เช่น บนบิลพิมพ์ 'เล่มที่ 02 เลขที่ 0045' ให้บันทึกเป็น '02/0045' พร้อมระบุเล่มที่ใน bookNo)
     * กรณีไม่มีเล่มที่ ให้อ่านตามที่ปรากฏตรงๆ
   - กฎเหล็กน้ำหนักชั่งรถบรรทุก (Gross / Tare / Net):
     * GrossWeightKg = น้ำหนักหนัก / รถรวมสินค้า (ค่าที่มากกว่าเสมอ แม้บิลโรงโม่ต้นทางพิมพ์ว่าน้ำหนักออก)
     * TareWeightKg = น้ำหนักเบา / รถเปล่า (ค่าที่น้อยกว่าเสมอ แม้บิลโรงโม่ต้นทางพิมพ์ว่าน้ำหนักเข้า)
     * NetWeightKg = GrossWeightKg - TareWeightKg
   - จัดหมวดหมู่วัสดุ (category) ตามมาตรฐานงานโยธา/ทล./ทช. เช่น 'หิน/ดิน/ทราย (ชั้นทาง & พื้นทาง)', 'ยางมะตอย & ผิวทางลาดยาง (ทล./ทช.)', 'คอนกรีตผสมเสร็จ & ผิวทางคอนกรีต', 'งานสะพาน & คอนกรีตอัดแรง', 'เหล็กเส้น & เหล็กโครงสร้างสะพาน/ถนน', 'งานท่อระบายน้ำ & รางระบายน้ำ', 'งานอำนวยความปลอดภัย & จราจร (ทล./ทช.)', 'งานป้องกันการกัดเซาะ & กำแพงกันดิน', 'ปูนซีเมนต์ & เคมีภัณฑ์ก่อสร้าง', 'ไม้แบบ นั่งร้าน & วัสดุสิ้นเปลือง', 'เครื่องจักรกลหนัก & น้ำมันเชื้อเพลิง', 'งานขนส่ง & โลจิสติกส์', 'ระบบไฟฟ้า & ประปาสนาม', หรือ 'วัสดุก่อสร้างทั่วไป'
   - ห้ามเดาชื่อโครงการ (col2) จากชื่อกลุ่ม LINE เด็ดขาด และแยกข้อความหมายเหตุออกจากชื่อสินค้าหลักเสมอ`;

  const { response } = await callGeminiWithResilience(ai, {
    contents: {
      parts: [
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: cleanBase64 } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isBillDocument: { type: Type.BOOLEAN, description: 'true หากเป็นเอกสารบิล/ตั๋วชั่ง/ใบส่งของ/ใบเสร็จ/PO, false หากเป็นรูปถ่ายทั่วไปที่ไม่ใช่บิล' },
          nonBillReason: { type: Type.STRING, description: 'เหตุผลกรณีไม่ใช่เอกสารบิล เช่น รูปถ่ายหน้างานทั่วไป' },
          docType: {
            type: Type.STRING,
            enum: ['delivery_order', 'dest_weighbridge', 'tax_invoice', 'purchase_order']
          },
          bookNo: { type: Type.STRING, description: 'เล่มที่ของบิล (ถ้ามี)' },
          docNumber: { type: Type.STRING, description: 'เลขที่เอกสารหลักบนหัวบิล (เลข DO / เลขตั๋วชั่ง / เลขใบเสร็จ / เลข PO)' },
          referencePoNo: { type: Type.STRING, description: 'เลขที่ใบสั่งซื้อ (PO) ที่อ้างอิงในบิล (ถ้ามี)' },
          referenceDoNo: { type: Type.STRING, description: 'เลขที่ใบส่งของ (DO) ที่อ้างอิงในบิล (ถ้ามี)' },
          referenceSource: { type: Type.STRING, enum: ['form_field', 'notes', 'handwritten'] },
          docDate: { type: Type.STRING, description: 'วันที่ในเอกสาร YYYY-MM-DD' },
          storeName: { type: Type.STRING, description: 'ชื่อร้านค้า / ผู้จำหน่าย / โรงโม่' },
          storeTaxId: { type: Type.STRING },
          storePhone: { type: Type.STRING },
          storeAddress: { type: Type.STRING },
          category: { type: Type.STRING, description: 'หมวดหมู่วัสดุ เช่น งานหิน/ทราย, งานคอนกรีต, งานเหล็ก' },
          licensePlate: { type: Type.STRING, description: 'ทะเบียนรถบรรทุก' },
          vehicleType: { type: Type.STRING, description: 'ประเภทรถบรรทุก' },
          itemDescription: { type: Type.STRING, description: 'ชื่อสินค้าหลักเพียวๆ ห้ามปนหมายเหตุ' },
          specCode: { type: Type.STRING, description: 'สเปกหรือรหัสสินค้า' },
          GrossWeightKg: { type: Type.NUMBER, description: 'น้ำหนักรถหนัก (Gross Weight) กก.' },
          TareWeightKg: { type: Type.NUMBER, description: 'น้ำหนักรถเบา (Tare Weight) กก.' },
          NetWeightKg: { type: Type.NUMBER, description: 'น้ำหนักสุทธิ (Net Weight) กก.' },
          qty: { type: Type.NUMBER, description: 'ปริมาณสินค้า' },
          unit: { type: Type.STRING, description: 'หน่วยนับ เช่น ตัน, คิว, ชิ้น, ถุง' },
          unitPrice: { type: Type.NUMBER, description: 'ราคาต่อหน่วย' },
          goodsAmount: { type: Type.NUMBER, description: 'รวมเงินค่าสินค้าก่อนภาษี/ค่าขนส่ง' },
          grandTotal: { type: Type.NUMBER, description: 'ยอดเงินรวมสุทธิทั้งสิ้น' },
          paymentTerms: { type: Type.STRING, description: 'รูปแบบการชำระเงิน เช่น เครดิต 30 วัน, เงินสด, โอนเงิน' },
          deliveryLocation: { type: Type.STRING, description: 'สถานที่ส่งมอบ / จุดเท / กม.' },
          notes: { type: Type.STRING, description: 'หมายเหตุหรือข้อความเพิ่มเติมบนบิล' },
          lineItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                itemDescription: { type: Type.STRING },
                specCode: { type: Type.STRING },
                qty: { type: Type.NUMBER },
                unit: { type: Type.STRING },
                unitPrice: { type: Type.NUMBER },
                totalAmount: { type: Type.NUMBER }
              }
            }
          },
          confidence: { type: Type.NUMBER }
        },
        required: ['isBillDocument']
      }
    }
  });

  const raw = JSON.parse(response.text || '{}');
  if (raw.isBillDocument === false) {
    return {
      isBillDocument: false,
      nonBillReason: raw.nonBillReason || 'ภาพถ่ายทั่วไปในกลุ่ม LINE (ไม่ใช่เอกสารบิล)',
      detectedDocType: 'delivery_order',
      extractedData: {},
      rawAiSnapshot: {},
      confidence: Number(raw.confidence) || 90
    };
  }

  const detectedDocType: 'delivery_order' | 'dest_weighbridge' | 'tax_invoice' | 'purchase_order' =
    raw.docType && ['delivery_order', 'dest_weighbridge', 'tax_invoice', 'purchase_order'].includes(raw.docType)
      ? raw.docType
      : 'delivery_order';

  // Format bookNo + docNumber into "เล่มที่/เลขที่" if bookNo is present
  let formattedDocNo = (raw.docNumber || '').toString().trim();
  const rawBook = (raw.bookNo || '')
    .toString()
    .replace(/^(?:เล่มที่|เล่ม|book\s*no\.?|book|vol\.?)\s*[:#.]?\s*/i, '')
    .trim();
  if (rawBook && rawBook !== '-' && rawBook !== '0' && formattedDocNo && !formattedDocNo.includes('/')) {
    formattedDocNo = `${rawBook}/${formattedDocNo.replace(/^(?:เลขที่|เลข|no\.?)\s*[:#.]?\s*/i, '').trim()}`;
  }

  // Normalize weights (Gross >= Tare)
  let grossKg = Number(raw.GrossWeightKg) || 0;
  let tareKg = Number(raw.TareWeightKg) || 0;
  if (grossKg > 0 && tareKg > 0 && grossKg < tareKg) {
    const tmp = grossKg;
    grossKg = tareKg;
    tareKg = tmp;
  }
  const netKg = grossKg > 0 && tareKg > 0 ? grossKg - tareKg : (Number(raw.NetWeightKg) || 0);

  const unitStr = (raw.unit || (netKg > 0 ? 'ตัน' : 'รายการ')).toString().trim();
  const effectiveQty = Number(raw.qty) > 0
    ? Number(raw.qty)
    : (netKg > 0 && unitStr.includes('ตัน') ? Number((netKg / 1000).toFixed(2)) : 1);

  const unitPrice = Number(raw.unitPrice) || 0;
  const goodsAmount = Number(raw.goodsAmount) || Number((effectiveQty * unitPrice).toFixed(2));
  const grandTotal = Number(raw.grandTotal) || goodsAmount;

  // Build comprehensive rawAiSnapshot (keeps all fields across all zones for 0-second document type switching)
  const rawAiSnapshot: Record<string, any> = {
    docType: detectedDocType,
    rawDocNo: formattedDocNo,
    rawBookNo: rawBook,
    rawRefPoNo: (raw.referencePoNo || '').toString().trim(),
    rawRefDoNo: (raw.referenceDoNo || '').toString().trim(),
    referenceSource: raw.referenceSource || 'form_field',
    rawDate: raw.docDate || today,
    rawStoreName: (raw.storeName || '').toString().trim(),
    rawCategory: (raw.category || 'วัสดุก่อสร้างทั่วไป').toString().trim(),
    rawLicensePlate: (raw.licensePlate || '').toString().trim(),
    rawVehicleType: (raw.vehicleType || '').toString().trim(),
    rawItemDescription: (raw.itemDescription || 'วัสดุก่อสร้าง').toString().trim(),
    rawSpecCode: (raw.specCode || '').toString().trim(),
    rawGrossWeightKg: grossKg,
    rawTareWeightKg: tareKg,
    rawNetWeightKg: netKg,
    rawQty: effectiveQty,
    rawUnit: unitStr,
    rawUnitPrice: unitPrice,
    rawGoodsAmount: goodsAmount,
    rawGrandTotal: grandTotal,
    rawPaymentTerms: (raw.paymentTerms || '').toString().trim(),
    rawDeliveryLocation: (raw.deliveryLocation || '').toString().trim(),
    rawNotes: (raw.notes || '').toString().trim(),
    lineItems: Array.isArray(raw.lineItems) ? raw.lineItems : []
  };

  // Build extractedData strictly keeping col2 (Project Name) EMPTY so lineGroupName is never mixed into col2!
  const isDestWB = detectedDocType === 'dest_weighbridge';
  const extractedData: Record<string, any> = {
    docType: detectedDocType,
    col1: `TR-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    col2: '', // STRICT RULE: Never auto-fill col2 from LINE Group Name! Verifier must select/input Project Name before saving.
    col3: rawAiSnapshot.rawCategory,
    col4: detectedDocType === 'purchase_order' ? formattedDocNo : rawAiSnapshot.rawRefPoNo,
    col5: '',
    col6: isDestWB ? rawAiSnapshot.rawRefDoNo : formattedDocNo,
    col7: rawAiSnapshot.rawDate,
    col8: rawAiSnapshot.rawStoreName,
    col9: '',
    col10: rawAiSnapshot.rawLicensePlate,
    col11: rawAiSnapshot.rawItemDescription,
    col12: rawAiSnapshot.rawSpecCode,
    col13: isDestWB ? 0 : grossKg,
    col14: isDestWB ? 0 : tareKg,
    col15: isDestWB ? 0 : netKg,
    col16: isDestWB ? rawAiSnapshot.rawDate : '',
    col17: isDestWB ? formattedDocNo : '',
    col18: isDestWB ? grossKg : 0,
    col19: isDestWB ? tareKg : 0,
    col20: isDestWB ? netKg : 0,
    col21: 0,
    col22: effectiveQty,
    col23: unitStr,
    col24: unitPrice,
    col25: goodsAmount,
    col26: rawAiSnapshot.rawVehicleType,
    col27: 0,
    col28: 0,
    col29: grandTotal,
    col30: rawAiSnapshot.rawPaymentTerms || (detectedDocType === 'tax_invoice' ? 'โอนเงิน' : 'รอตรวจรับ / RR'),
    col31: 0,
    col32: goodsAmount,
    col33: 0,
    col34: 0,
    col35: 0,
    col36: grandTotal,
    col37: rawAiSnapshot.rawDeliveryLocation,
    col38: rawAiSnapshot.rawNotes,
    referenceDocNo: isDestWB ? rawAiSnapshot.rawRefDoNo : rawAiSnapshot.rawRefPoNo,
    referenceSource: rawAiSnapshot.referenceSource,
    lineItems: rawAiSnapshot.lineItems,
    lineSenderName: senderName,
    lineGroupName: groupName,
    rawAiSnapshot
  };

  return {
    isBillDocument: true,
    detectedDocType,
    extractedData,
    rawAiSnapshot,
    storeSuggestion: {
      name: rawAiSnapshot.rawStoreName,
      category: rawAiSnapshot.rawCategory,
      taxId: raw.storeTaxId || '',
      phone: raw.storePhone || '',
      address: raw.storeAddress || ''
    },
    confidence: Number(raw.confidence) || 92
  };
}

// 1. Get & Update LINE OA Bot Configuration
app.get('/api/line/config', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    config: {
      ...lineBotConfig,
      hasChannelAccessToken: Boolean(lineBotConfig.channelAccessToken),
      hasChannelSecret: Boolean(lineBotConfig.channelSecret)
    }
  });
});

app.post('/api/line/config', (req: Request, res: Response) => {
  const body = req.body || {};
  lineBotConfig = {
    ...lineBotConfig,
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : lineBotConfig.enabled,
    channelAccessToken: body.channelAccessToken !== undefined ? String(body.channelAccessToken).trim() : lineBotConfig.channelAccessToken,
    channelSecret: body.channelSecret !== undefined ? String(body.channelSecret).trim() : lineBotConfig.channelSecret,
    autoQuoteReply: body.autoQuoteReply !== undefined ? Boolean(body.autoQuoteReply) : lineBotConfig.autoQuoteReply,
    replyOnDuplicate: body.replyOnDuplicate !== undefined ? Boolean(body.replyOnDuplicate) : lineBotConfig.replyOnDuplicate,
    replyOnUnclearImage: body.replyOnUnclearImage !== undefined ? Boolean(body.replyOnUnclearImage) : lineBotConfig.replyOnUnclearImage,
    filterNonBillImages: body.filterNonBillImages !== undefined ? Boolean(body.filterNonBillImages) : lineBotConfig.filterNonBillImages,
    strictZeroPushQuota: true, // Always enforce 0 push quota
    allowedGroupNames: Array.isArray(body.allowedGroupNames) ? body.allowedGroupNames : lineBotConfig.allowedGroupNames
  };
  return res.json({ success: true, config: lineBotConfig });
});

// 2. Poll & Acknowledge Incoming Webhook Queue for Browser localStorage Sync
app.get('/api/line/inbox', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    items: lineWebhookInboxQueue
  });
});

app.post('/api/line/inbox/ack', (req: Request, res: Response) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    for (let i = lineWebhookInboxQueue.length - 1; i >= 0; i--) {
      if (idSet.has(lineWebhookInboxQueue[i].id)) {
        lineWebhookInboxQueue.splice(i, 1);
      }
    }
  }
  return res.json({ success: true, remaining: lineWebhookInboxQueue.length });
});

// 3. Real LINE Messaging API Webhook Endpoint (POST /api/line/webhook)
app.post('/api/line/webhook', async (req: Request, res: Response) => {
  try {
    // Optional signature verification when channelSecret is configured
    const signature = req.headers['x-line-signature'] as string | undefined;
    if (lineBotConfig.channelSecret && signature) {
      const rawBodyStr = JSON.stringify(req.body);
      const expectedSig = crypto
        .createHmac('SHA256', lineBotConfig.channelSecret)
        .update(rawBodyStr)
        .digest('base64');
      if (signature !== expectedSig) {
        console.warn('LINE Webhook signature mismatch warning (proceeding only if dev environment)');
      }
    }

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    // Respond 200 OK quickly as required by LINE Webhook specification
    res.status(200).json({ status: 'ok', receivedEvents: events.length });

    if (!lineBotConfig.enabled) return;

    for (const event of events) {
      if (event.type !== 'message' || event.message?.type !== 'image') {
        continue;
      }

      const messageId: string = event.message.id;
      const quoteToken: string | undefined = event.message.quoteToken;
      const replyToken: string | undefined = event.replyToken;
      const userId: string = event.source?.userId || 'unknown-user';
      const groupId: string | undefined = event.source?.groupId || event.source?.roomId;
      const receivedAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();

      // Step 1: Resolve Sender & Group Name (Free GET calls, 0 quota)
      const { senderName, senderAvatar, groupName } = await resolveLineSenderAndGroup(userId, groupId);

      // Check allowedGroupNames filter if configured
      if (
        lineBotConfig.allowedGroupNames.length > 0 &&
        !lineBotConfig.allowedGroupNames.some(g => g.trim().toLowerCase() === groupName.trim().toLowerCase())
      ) {
        continue;
      }

      // Step 2: Download Image Binary from LINE Content API (Free GET call, 0 quota)
      let base64DataUrl = '';
      let mimeType = 'image/jpeg';
      if (lineBotConfig.channelAccessToken) {
        try {
          const imgResp = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
            headers: { Authorization: `Bearer ${lineBotConfig.channelAccessToken}` }
          });
          if (imgResp.ok) {
            mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
            const arrayBuf = await imgResp.arrayBuffer();
            const b64 = Buffer.from(arrayBuf).toString('base64');
            base64DataUrl = `data:${mimeType};base64,${b64}`;
          }
        } catch (dlErr) {
          console.error('Failed to download LINE image:', dlErr);
        }
      }

      // Step 3: QUEUE-FIRST SAFETY — Push into queue immediately BEFORE AI scan so zero bills are ever dropped!
      const inboxItem: any = {
        id: `line-bill-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        lineMessageId: messageId,
        lineQuoteToken: quoteToken,
        lineReplyToken: replyToken,
        lineUserId: userId,
        lineSenderName: senderName,
        lineSenderAvatar: senderAvatar,
        lineGroupId: groupId,
        lineGroupName: groupName, // Stored strictly separate from col2 Project Name!
        receivedAt,
        image: base64DataUrl,
        status: 'queued',
        detectedDocType: 'delivery_order',
        extractedData: {
          col2: '', // Project Name left empty for mandatory verifier input
          lineSenderName: senderName,
          lineGroupName: groupName,
          lineReceivedAt: receivedAt
        },
        rawAiSnapshot: {},
        isBillDocument: true
      };

      lineWebhookInboxQueue.unshift(inboxItem);
      if (lineWebhookInboxQueue.length > MAX_WEBHOOK_QUEUE_SIZE) {
        lineWebhookInboxQueue.pop();
      }

      if (!base64DataUrl) {
        inboxItem.status = 'scan_failed';
        inboxItem.botReplyText = buildLineQuoteReplyText({
          isBillDocument: true,
          senderName,
          scanFailed: true
        });
        continue;
      }

      // Step 4: Run AI Analysis + Duplicate Check + Quote Reply
      try {
        const analysis = await analyzeLineBillWithGemini(base64DataUrl, mimeType, senderName, groupName);
        inboxItem.isBillDocument = analysis.isBillDocument;
        inboxItem.nonBillReason = analysis.nonBillReason;
        inboxItem.detectedDocType = analysis.detectedDocType;
        inboxItem.extractedData = {
          ...analysis.extractedData,
          lineInboxId: inboxItem.id,
          lineMessageId: messageId,
          lineUserId: userId,
          lineSenderName: senderName,
          lineSenderAvatar: senderAvatar,
          lineGroupId: groupId,
          lineGroupName: groupName,
          lineReceivedAt: receivedAt
        };
        inboxItem.rawAiSnapshot = analysis.rawAiSnapshot;
        inboxItem.storeSuggestion = analysis.storeSuggestion;
        inboxItem.aiConfidence = analysis.confidence;

        if (!analysis.isBillDocument && lineBotConfig.filterNonBillImages) {
          inboxItem.status = 'ignored_non_bill';
          inboxItem.botReplyText = '🤫 (ข้ามการตอบกลับ: AI ตรวจพบว่าเป็นภาพถ่ายทั่วไป ไม่ใช่เอกสารบิล)';
          continue;
        }

        const billNo = analysis.extractedData.col17 || analysis.extractedData.col6 || analysis.extractedData.col4 || '';
        const storeName = analysis.extractedData.col8 || '';

        // Check duplicate within existing webhook queue
        const dupInQueue = lineWebhookInboxQueue.find(
          other =>
            other.id !== inboxItem.id &&
            other.status !== 'ignored_non_bill' &&
            billNo &&
            isServerDocMatch(
              other.extractedData?.col17 || other.extractedData?.col6 || other.extractedData?.col4,
              billNo
            ) &&
            (!storeName ||
              !other.extractedData?.col8 ||
              other.extractedData.col8.trim().toLowerCase() === storeName.trim().toLowerCase())
        );

        if (dupInQueue) {
          inboxItem.status = 'duplicate_warning';
          inboxItem.duplicateInfo = {
            isDuplicate: true,
            matchedCode: `คิว LINE (${dupInQueue.lineSenderName})`,
            matchedBillNo: billNo,
            matchedVendor: storeName,
            reason: `บิลเลขที่ ${billNo} ร้าน ${storeName} เพิ่งถูกส่งเข้ากลุ่มโดย ${dupInQueue.lineSenderName}`
          };
        } else {
          inboxItem.status = 'pending_review';
        }

        const replyText = buildLineQuoteReplyText({
          isBillDocument: true,
          billNo,
          docType: analysis.detectedDocType,
          storeName,
          senderName,
          isDuplicate: Boolean(dupInQueue),
          duplicateMatchedCode: dupInQueue ? `ส่งแล้วโดย ${dupInQueue.lineSenderName}` : undefined,
          scanFailed: !billNo
        });

        inboxItem.botReplyText = replyText;
        inboxItem.botReplySent = await sendLineFreeQuoteReply(replyToken, quoteToken, replyText);
      } catch (scanErr) {
        console.error('LINE Webhook AI scan error (bill safely kept in queue):', scanErr);
        inboxItem.status = 'scan_failed';
        const fallbackReply = buildLineQuoteReplyText({
          isBillDocument: true,
          senderName,
          scanFailed: true
        });
        inboxItem.botReplyText = fallbackReply;
        inboxItem.botReplySent = await sendLineFreeQuoteReply(replyToken, quoteToken, fallbackReply);
      }
    }
  } catch (err) {
    console.error('LINE Webhook handler error:', err);
  }
});

// 4. Interactive LINE OA Group Bot Simulator Endpoint (POST /api/line/simulate)
// Allows full end-to-end testing of Queue-First storage, AI extraction, Duplicate check, and Quote Reply directly from the web UI
app.post('/api/line/simulate', rateLimitScan, async (req: Request, res: Response) => {
  try {
    const {
      image,
      mimeType,
      senderName = 'ช่างสมชาย (หน้างาน)',
      groupName = 'กลุ่มรับบิลสโตร์กลาง',
      existingDocs = []
    } = req.body || {};

    if (!image) {
      return res.status(400).json({ success: false, error: 'กรุณาเลือกรูปภาพที่จะส่งเข้ากลุ่ม LINE' });
    }

    const receivedAt = new Date().toISOString();
    const inboxId = `line-sim-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const messageId = `MSG-${Date.now()}`;
    const quoteToken = `QT-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    try {
      const analysis = await analyzeLineBillWithGemini(image, mimeType || 'image/jpeg', senderName, groupName);

      if (!analysis.isBillDocument && lineBotConfig.filterNonBillImages) {
        const nonBillItem = {
          id: inboxId,
          lineMessageId: messageId,
          lineQuoteToken: quoteToken,
          lineUserId: 'U-SIMULATOR',
          lineSenderName: senderName,
          lineGroupName: groupName,
          receivedAt,
          image,
          status: 'ignored_non_bill',
          detectedDocType: 'delivery_order',
          extractedData: {
            col2: '',
            lineSenderName: senderName,
            lineGroupName: groupName,
            lineReceivedAt: receivedAt
          },
          rawAiSnapshot: {},
          isBillDocument: false,
          nonBillReason: analysis.nonBillReason,
          aiConfidence: analysis.confidence,
          botReplyText: '🤫 (บอทไม่ตอบกลับในกลุ่ม: AI คัดกรองแล้วว่าเป็นภาพถ่ายทั่วไป ไม่ใช่เอกสารบิล)',
          botReplySent: false
        };
        return res.json({ success: true, item: nonBillItem });
      }

      const billNo = analysis.extractedData.col17 || analysis.extractedData.col6 || analysis.extractedData.col4 || '';
      const storeName = analysis.extractedData.col8 || '';

      // Check duplicates against existingOrders / existingPOs / existingInbox passed from client
      let matchedDup: { code: string; billNo: string; vendor: string; reason: string } | null = null;
      if (billNo && Array.isArray(existingDocs)) {
        for (const doc of existingDocs) {
          const docNo = doc.billNo || doc.col6 || doc.col17 || doc.poNumber || '';
          const docVendor = (doc.vendor || doc.col8 || doc.storeName || '').trim();
          if (
            docNo &&
            isServerDocMatch(docNo, billNo) &&
            (!storeName || !docVendor || docVendor.toLowerCase() === storeName.trim().toLowerCase())
          ) {
            matchedDup = {
              code: doc.code || doc.col1 || doc.poNumber || 'ในระบบ',
              billNo: docNo,
              vendor: docVendor || storeName,
              reason: `บิลเลขที่ ${billNo} (ร้าน ${docVendor || storeName}) มีอยู่ในระบบแล้ว (${doc.code || doc.col1 || 'คิวตรวจสอบ'})`
            };
            break;
          }
        }
      }

      const replyText = buildLineQuoteReplyText({
        isBillDocument: true,
        billNo,
        docType: analysis.detectedDocType,
        storeName,
        senderName,
        isDuplicate: Boolean(matchedDup),
        duplicateMatchedCode: matchedDup?.code,
        scanFailed: !billNo
      });

      const simulatedItem = {
        id: inboxId,
        lineMessageId: messageId,
        lineQuoteToken: quoteToken,
        lineUserId: 'U-SIMULATOR',
        lineSenderName: senderName,
        lineGroupName: groupName, // Strictly separate from col2 Project Name!
        receivedAt,
        image,
        status: matchedDup ? 'duplicate_warning' : 'pending_review',
        detectedDocType: analysis.detectedDocType,
        extractedData: {
          ...analysis.extractedData,
          col2: '', // Never auto-fill Project Name from LINE Group Name
          lineInboxId: inboxId,
          lineMessageId: messageId,
          lineUserId: 'U-SIMULATOR',
          lineSenderName: senderName,
          lineGroupName: groupName,
          lineReceivedAt: receivedAt
        },
        rawAiSnapshot: analysis.rawAiSnapshot,
        storeSuggestion: analysis.storeSuggestion,
        aiConfidence: analysis.confidence,
        isBillDocument: true,
        botReplyText: replyText,
        botReplySent: true,
        duplicateInfo: matchedDup
          ? {
              isDuplicate: true,
              matchedCode: matchedDup.code,
              matchedBillNo: matchedDup.billNo,
              matchedVendor: matchedDup.vendor,
              reason: matchedDup.reason
            }
          : undefined
      };

      return res.json({ success: true, item: simulatedItem });
    } catch (aiErr: any) {
      // Queue-First Resilience: Even if AI fails or hits 503, save the bill image + sender + group into the inbox!
      const fallbackReply = buildLineQuoteReplyText({
        isBillDocument: true,
        senderName,
        scanFailed: true
      });

      const safeFallbackItem = {
        id: inboxId,
        lineMessageId: messageId,
        lineQuoteToken: quoteToken,
        lineUserId: 'U-SIMULATOR',
        lineSenderName: senderName,
        lineGroupName: groupName,
        receivedAt,
        image,
        status: 'scan_failed',
        detectedDocType: 'delivery_order',
        extractedData: {
          col1: `TR-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
          col2: '',
          col7: new Date().toISOString().split('T')[0],
          lineInboxId: inboxId,
          lineMessageId: messageId,
          lineSenderName: senderName,
          lineGroupName: groupName,
          lineReceivedAt: receivedAt
        },
        rawAiSnapshot: {},
        isBillDocument: true,
        botReplyText: fallbackReply,
        botReplySent: true
      };

      return res.json({
        success: true,
        item: safeFallbackItem,
        warning: `AI ตอบสนองช้าชั่วคราว แต่ระบบเก็บรูปบิลเข้ากล่องพักเรียบร้อยแล้ว (${aiErr?.message || 'Queue-First Safe'})`
      });
    }
  } catch (err: any) {
    console.error('LINE Simulate Error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'เกิดข้อผิดพลาดในการจำลองรับบิลจาก LINE'
    });
  }
});

// ============================================================================
// SUPABASE CLOUD & POSTGRESQL DATABASE INTEGRATION (PHASE 2 ENGINE)
// Reference: /DATABASE_STORAGE_BLUEPRINT.md
// ============================================================================

const CONFIG_FILE_PATH = path.resolve(__dirname, '.supabase_config.json');

interface ServerDbConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
  pgConnectionString?: string;
  isEnabled: boolean;
  autoSyncIntervalMinutes?: number;
  lastTestedAt?: string;
}

function getStoredDbConfig(): ServerDbConfig {
  let fileConfig: Partial<ServerDbConfig> = {};
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const content = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      fileConfig = JSON.parse(content);
    }
  } catch (err) {
    console.warn('[DB Config] Failed to read .supabase_config.json', err);
  }

  return {
    supabaseUrl: (fileConfig.supabaseUrl || process.env.SUPABASE_URL || '').trim(),
    supabaseAnonKey: (fileConfig.supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '').trim(),
    supabaseServiceRoleKey: (fileConfig.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    pgConnectionString: (fileConfig.pgConnectionString || process.env.DATABASE_URL || '').trim(),
    isEnabled: fileConfig.isEnabled !== undefined ? fileConfig.isEnabled : true,
    autoSyncIntervalMinutes: fileConfig.autoSyncIntervalMinutes || 15,
    lastTestedAt: fileConfig.lastTestedAt
  };
}

function saveStoredDbConfig(cfg: Partial<ServerDbConfig>) {
  const current = getStoredDbConfig();
  const merged: ServerDbConfig = {
    ...current,
    ...cfg
  };
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function getSupabaseClient(customCfg?: Partial<ServerDbConfig>) {
  const cfg = { ...getStoredDbConfig(), ...(customCfg || {}) };
  if (!cfg.supabaseUrl || !cfg.supabaseUrl.startsWith('http')) return null;
  const key = cfg.supabaseServiceRoleKey || cfg.supabaseAnonKey;
  if (!key) return null;
  return createClient(cfg.supabaseUrl, key, {
    auth: { persistSession: false }
  });
}

function getPgPool(customCfg?: Partial<ServerDbConfig>) {
  const cfg = { ...getStoredDbConfig(), ...(customCfg || {}) };
  if (!cfg.pgConnectionString || !cfg.pgConnectionString.startsWith('postgres')) return null;
  return new pg.Pool({
    connectionString: cfg.pgConnectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000
  });
}

// 1. Get database configuration & connection status
app.get('/api/database/config', async (req: Request, res: Response) => {
  try {
    const cfg = getStoredDbConfig();
    const isConfigured = Boolean(
      (cfg.supabaseUrl && (cfg.supabaseAnonKey || cfg.supabaseServiceRoleKey)) ||
        cfg.pgConnectionString
    );

    const maskedPgConn = cfg.pgConnectionString
      ? cfg.pgConnectionString.replace(/:([^:@]+)@/, ':••••••@')
      : '';

    return res.json({
      success: true,
      config: {
        isConfigured,
        isEnabled: cfg.isEnabled,
        mode: cfg.pgConnectionString
          ? 'postgres_direct'
          : cfg.supabaseUrl
          ? 'supabase_rest'
          : 'offline',
        supabaseUrl: cfg.supabaseUrl,
        hasAnonKey: Boolean(cfg.supabaseAnonKey),
        hasServiceKey: Boolean(cfg.supabaseServiceRoleKey),
        hasPgConnection: Boolean(cfg.pgConnectionString),
        pgConnectionString: maskedPgConn,
        autoSyncIntervalMinutes: cfg.autoSyncIntervalMinutes,
        lastTestedAt: cfg.lastTestedAt || null
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// 2. Save database configuration
app.post('/api/database/config', async (req: Request, res: Response) => {
  try {
    const {
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceRoleKey,
      pgConnectionString,
      isEnabled,
      autoSyncIntervalMinutes
    } = req.body;

    const saved = saveStoredDbConfig({
      supabaseUrl: typeof supabaseUrl === 'string' ? supabaseUrl.trim() : undefined,
      supabaseAnonKey: typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : undefined,
      supabaseServiceRoleKey:
        typeof supabaseServiceRoleKey === 'string' ? supabaseServiceRoleKey.trim() : undefined,
      pgConnectionString:
        typeof pgConnectionString === 'string' ? pgConnectionString.trim() : undefined,
      isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : undefined,
      autoSyncIntervalMinutes:
        typeof autoSyncIntervalMinutes === 'number' ? autoSyncIntervalMinutes : undefined
    });

    return res.json({
      success: true,
      message: 'บันทึกการตั้งค่าเชื่อมต่อฐานข้อมูล Supabase Cloud เรียบร้อยแล้ว',
      config: {
        isConfigured: Boolean(
          (saved.supabaseUrl && (saved.supabaseAnonKey || saved.supabaseServiceRoleKey)) ||
            saved.pgConnectionString
        ),
        isEnabled: saved.isEnabled,
        supabaseUrl: saved.supabaseUrl,
        hasAnonKey: Boolean(saved.supabaseAnonKey),
        hasServiceKey: Boolean(saved.supabaseServiceRoleKey),
        hasPgConnection: Boolean(saved.pgConnectionString)
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// 3. Test Database Connection & Table Schema Existence
app.post('/api/database/test', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const targetCfg: Partial<ServerDbConfig> = req.body || {};
  const cfg = { ...getStoredDbConfig(), ...targetCfg };

  const tablesStatus: Record<string, boolean> = {
    orders: false,
    purchase_orders: false,
    line_inbox: false,
    stores: false,
    projects: false,
    app_users: false,
    billing_notes: false
  };

  // Option A: Direct PostgreSQL Connection
  if (cfg.pgConnectionString && cfg.pgConnectionString.startsWith('postgres')) {
    const pool = getPgPool(cfg);
    if (!pool) {
      return res.status(400).json({
        success: false,
        isConnected: false,
        error: 'รูปแบบ PostgreSQL Connection String ไม่ถูกต้อง'
      });
    }

    try {
      const client = await pool.connect();
      try {
        const pingRes = await client.query('SELECT NOW() as now, version() as ver;');
        const tablesRes = await client.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
        );
        const existingTables = new Set(tablesRes.rows.map(r => r.table_name));

        Object.keys(tablesStatus).forEach(t => {
          tablesStatus[t] = existingTables.has(t);
        });

        const latencyMs = Date.now() - startTime;
        saveStoredDbConfig({ lastTestedAt: new Date().toISOString() });

        client.release();
        await pool.end();

        return res.json({
          success: true,
          isConnected: true,
          mode: 'postgres_direct',
          latencyMs,
          serverVersion: pingRes.rows[0]?.ver || 'PostgreSQL',
          tables: tablesStatus,
          message: 'เชื่อมต่อ PostgreSQL Database สำเร็จเรียบร้อยแล้ว'
        });
      } catch (qErr: any) {
        client.release();
        await pool.end();
        throw qErr;
      }
    } catch (pgErr: any) {
      return res.json({
        success: false,
        isConnected: false,
        mode: 'postgres_direct',
        latencyMs: Date.now() - startTime,
        tables: tablesStatus,
        error: `ไม่สามารถเชื่อมต่อ PostgreSQL: ${pgErr?.message || 'Connection failed'}`
      });
    }
  }

  // Option B: Supabase REST API via @supabase/supabase-js
  const client = getSupabaseClient(cfg);
  if (!client) {
    return res.status(400).json({
      success: false,
      isConnected: false,
      error: 'กรุณากรอก Supabase Project URL และ Anon Key หรือ Service Role Key ก่อนทดสอบ'
    });
  }

  try {
    const checkTable = async (tableName: string) => {
      try {
        const { error } = await client.from(tableName).select('id').limit(1);
        if (!error) return true;
        if (
          error.code === '42P01' ||
          error.message?.includes('does not exist') ||
          error.message?.includes('not found')
        ) {
          return false;
        }
        // If RLS blocked or empty table, table actually exists!
        return true;
      } catch {
        return false;
      }
    };

    const tableNames = Object.keys(tablesStatus);
    const results = await Promise.all(tableNames.map(checkTable));
    tableNames.forEach((name, i) => {
      tablesStatus[name] = results[i];
    });

    const latencyMs = Date.now() - startTime;
    const isAnyTableFound = Object.values(tablesStatus).some(Boolean);
    saveStoredDbConfig({ lastTestedAt: new Date().toISOString() });

    return res.json({
      success: true,
      isConnected: true,
      mode: 'supabase_rest',
      latencyMs,
      tables: tablesStatus,
      isSchemaReady: Object.values(tablesStatus).every(Boolean),
      message: isAnyTableFound
        ? 'เชื่อมต่อ Supabase Cloud สำเร็จ และพบตารางในฐานข้อมูล'
        : 'เชื่อมต่อ Supabase Cloud สำเร็จ (แต่ยังไม่พบตารางตามสกีมา กรุณารันคำสั่งสร้างตาราง SQL DDL)'
    });
  } catch (err: any) {
    return res.json({
      success: false,
      isConnected: false,
      mode: 'supabase_rest',
      latencyMs: Date.now() - startTime,
      tables: tablesStatus,
      error: `ไม่สามารถเชื่อมต่อ Supabase: ${err?.message || 'Connection error'}`
    });
  }
});

// 4. Initialize Database Schema (Execute DDL or return DDL script)
app.post('/api/database/init-schema', async (req: Request, res: Response) => {
  const cfg = getStoredDbConfig();

  // If direct PG connection string is available, execute DDL directly
  if (cfg.pgConnectionString && cfg.pgConnectionString.startsWith('postgres')) {
    const pool = getPgPool(cfg);
    if (pool) {
      try {
        const client = await pool.connect();
        try {
          await client.query(SUPABASE_SQL_DDL_SCHEMA);
          client.release();
          await pool.end();

          return res.json({
            success: true,
            executedDirectly: true,
            ddl: SUPABASE_SQL_DDL_SCHEMA,
            message: 'สร้างตาราง PostgreSQL ทั้ง 7 ตารางบน Supabase Cloud สำเร็จเรียบร้อยแล้ว!'
          });
        } catch (execErr: any) {
          client.release();
          await pool.end();
          return res.json({
            success: false,
            executedDirectly: false,
            ddl: SUPABASE_SQL_DDL_SCHEMA,
            error: `รันคำสั่ง DDL ขัดข้อง: ${execErr?.message}. ท่านสามารถนำคำสั่ง SQL ด้านล่างไปรันใน Supabase SQL Editor ได้โดยตรงครับ`
          });
        }
      } catch (connErr: any) {
        return res.json({
          success: false,
          executedDirectly: false,
          ddl: SUPABASE_SQL_DDL_SCHEMA,
          error: `เชื่อมต่อ PG ไม่สำเร็จ: ${connErr?.message}`
        });
      }
    }
  }

  // For REST mode: return the SQL script for Supabase SQL Editor
  return res.json({
    success: true,
    executedDirectly: false,
    ddl: SUPABASE_SQL_DDL_SCHEMA,
    message:
      'กรุณาคัดลอกชุดคำสั่ง SQL DDL ด้านล่างนี้ไปวางในเมนู SQL Editor บนแดชบอร์ด Supabase แล้วกด Run ครับ'
  });
});

// 5. Migrate Local Data to Supabase Cloud
app.post('/api/database/migrate-local-to-cloud', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'ยังไม่ได้เชื่อมต่อกับ Supabase Cloud กรุณาตั้งค่า URL และ Key ก่อนทำการย้ายข้อมูล'
      });
    }

    const {
      orders = [],
      pos = [],
      stores = [],
      projects = [],
      billingNotes = []
    } = req.body;

    const migratedCounts = {
      orders: 0,
      pos: 0,
      stores: 0,
      projects: 0,
      billingNotes: 0
    };

    // 1. Migrate stores
    if (Array.isArray(stores) && stores.length > 0) {
      const rows = stores.map(mapStoreToSupabase);
      const { error } = await client.from('stores').upsert(rows, { onConflict: 'id' });
      if (!error) migratedCounts.stores = rows.length;
      else console.error('Migrate stores error:', error);
    }

    // 2. Migrate projects
    if (Array.isArray(projects) && projects.length > 0) {
      const rows = projects.map(mapProjectToSupabase);
      const { error } = await client.from('projects').upsert(rows, { onConflict: 'id' });
      if (!error) migratedCounts.projects = rows.length;
      else console.error('Migrate projects error:', error);
    }

    // 3. Migrate purchase orders (POs)
    if (Array.isArray(pos) && pos.length > 0) {
      const rows = pos.map(mapPOToSupabase);
      const { error } = await client.from('purchase_orders').upsert(rows, { onConflict: 'id' });
      if (!error) migratedCounts.pos = rows.length;
      else console.error('Migrate POs error:', error);
    }

    // 4. Migrate orders (39-column records)
    if (Array.isArray(orders) && orders.length > 0) {
      // Chunk into batches of 50 to prevent payload limit
      const chunkSize = 50;
      for (let i = 0; i < orders.length; i += chunkSize) {
        const chunk = orders.slice(i, i + chunkSize);
        const rows = chunk.map(mapOrderToSupabase);
        const { error } = await client.from('orders').upsert(rows, { onConflict: 'id' });
        if (!error) migratedCounts.orders += rows.length;
        else console.error(`Migrate orders chunk ${i} error:`, error);
      }
    }

    // 5. Migrate billing notes
    if (Array.isArray(billingNotes) && billingNotes.length > 0) {
      const rows = billingNotes.map(mapBillingNoteToSupabase);
      const { error } = await client.from('billing_notes').upsert(rows, { onConflict: 'id' });
      if (!error) migratedCounts.billingNotes = rows.length;
      else console.error('Migrate billing notes error:', error);
    }

    return res.json({
      success: true,
      migratedCounts,
      message: `ย้ายข้อมูลขึ้น Supabase Cloud สำเร็จ: ใบส่งของ 39 ช่อง ${migratedCounts.orders} ใบ, ใบสั่งซื้อ ${migratedCounts.pos} ใบ, ร้านค้า ${migratedCounts.stores} ร้าน, โครงการ ${migratedCounts.projects} โครงการ, ชุดรับวางบิล ${migratedCounts.billingNotes} ชุด`
    });
  } catch (err: any) {
    console.error('Migrate error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'เกิดข้อผิดพลาดในการย้ายข้อมูล' });
  }
});

// 6. Sync All Data from Supabase Cloud to Client
app.post('/api/database/sync-all', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'ยังไม่ได้เชื่อมต่อกับ Supabase Cloud'
      });
    }

    const [ordersRes, posRes, storesRes, projectsRes, billingNotesRes] = await Promise.all([
      client.from('orders').select('*').order('created_at', { ascending: false }).limit(2000),
      client.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      client.from('stores').select('*').order('name', { ascending: true }),
      client.from('projects').select('*').order('name', { ascending: true }),
      client.from('billing_notes').select('*').order('created_at', { ascending: false })
    ]);

    const mappedOrders = (ordersRes.data || []).map(mapSupabaseToOrder);
    const mappedPOs = (posRes.data || []).map(mapSupabaseToPO);
    const mappedStores = (storesRes.data || []).map(mapSupabaseToStore);
    const mappedProjects = (projectsRes.data || []).map(mapSupabaseToProject);
    const mappedBillingNotes = (billingNotesRes.data || []).map(mapSupabaseToBillingNote);

    return res.json({
      success: true,
      data: {
        orders: mappedOrders,
        pos: mappedPOs,
        stores: mappedStores,
        projects: mappedProjects,
        billingNotes: mappedBillingNotes
      },
      counts: {
        orders: mappedOrders.length,
        pos: mappedPOs.length,
        stores: mappedStores.length,
        projects: mappedProjects.length,
        billingNotes: mappedBillingNotes.length
      },
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Sync error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'เกิดข้อผิดพลาดในการซิงค์ข้อมูล' });
  }
});

// ============================================================================
// GOOGLE DRIVE ZERO-JUNK FILE STORAGE ENGINE (PHASE 3 & VERIFIED-ONLY MOVE RULE)
// Reference: /DATABASE_STORAGE_BLUEPRINT.md
// ============================================================================

const DRIVE_CONFIG_FILE_PATH = path.resolve(__dirname, '.google_drive_config.json');

interface ServerDriveConfig {
  rootFolderId: string;
  connectionMode?: 'gas' | 'service_account';
  gasWebAppUrl?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountJson?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  directAccessToken?: string;
  isEnabled: boolean;
  lastTestedAt?: string;
}

function getStoredDriveConfig(): ServerDriveConfig {
  let fileConfig: Partial<ServerDriveConfig> = {};
  try {
    if (fs.existsSync(DRIVE_CONFIG_FILE_PATH)) {
      const content = fs.readFileSync(DRIVE_CONFIG_FILE_PATH, 'utf-8');
      fileConfig = JSON.parse(content);
    }
  } catch (err) {
    console.warn('[Drive Config] Failed to read .google_drive_config.json', err);
  }

  // Parse raw service account JSON if provided in env
  let saEmail = fileConfig.serviceAccountEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  let saKey = fileConfig.serviceAccountPrivateKey || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const rawSaJson = fileConfig.serviceAccountJson || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';

  if (rawSaJson && (!saEmail || !saKey)) {
    try {
      const parsed = JSON.parse(rawSaJson);
      if (parsed.client_email) saEmail = parsed.client_email;
      if (parsed.private_key) saKey = parsed.private_key;
    } catch {
      // ignore parse error
    }
  }

  const gasUrl = (fileConfig.gasWebAppUrl || process.env.GOOGLE_APPS_SCRIPT_URL || '').trim();
  const connMode = fileConfig.connectionMode || (gasUrl ? 'gas' : 'service_account');

  return {
    rootFolderId: (fileConfig.rootFolderId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim(),
    connectionMode: connMode,
    gasWebAppUrl: gasUrl,
    serviceAccountEmail: saEmail.trim(),
    serviceAccountPrivateKey: saKey.trim(),
    serviceAccountJson: rawSaJson.trim(),
    clientId: (fileConfig.clientId || process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (fileConfig.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    refreshToken: (fileConfig.refreshToken || process.env.GOOGLE_REFRESH_TOKEN || '').trim(),
    directAccessToken: (fileConfig.directAccessToken || process.env.GOOGLE_DRIVE_ACCESS_TOKEN || '').trim(),
    isEnabled: fileConfig.isEnabled !== undefined ? fileConfig.isEnabled : true,
    lastTestedAt: fileConfig.lastTestedAt
  };
}

function saveStoredDriveConfig(cfg: Partial<ServerDriveConfig>) {
  const current = getStoredDriveConfig();
  const merged: ServerDriveConfig = {
    ...current,
    ...cfg
  };
  fs.writeFileSync(DRIVE_CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// Helper to call Google Apps Script Web App (Zero-Junk & Verified-Only Move without Service Account)
async function callGasDriveApi(gasUrl: string, payload: any): Promise<any> {
  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  if (!resp.ok) {
    throw new Error(`Google Apps Script ตอบกลับด้วยรหัส HTTP ${resp.status}`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Google Apps Script ส่งผลลัพธ์ไม่ใช่ JSON: ${text.slice(0, 120)}`);
  }
}

// In-memory token cache
let cachedDriveAccessToken: { token: string; expiresAt: number } | null = null;
const zoneFoldersCache = new Map<string, string>(); // zoneKey -> folderId

// Generate OAuth2 access token from Google Service Account using Node.js crypto (RSA-SHA256)
async function getDriveAccessToken(): Promise<string | null> {
  const cfg = getStoredDriveConfig();
  if (!cfg.isEnabled) return null;

  // Use direct token if supplied and valid
  if (cfg.directAccessToken && !cfg.serviceAccountEmail) {
    return cfg.directAccessToken;
  }

  // Return cached token if still valid (with 2-minute buffer)
  if (cachedDriveAccessToken && Date.now() < cachedDriveAccessToken.expiresAt - 120000) {
    return cachedDriveAccessToken.token;
  }

  // 1. Service Account Flow (Preferred & Recommended for 24/7 background automation)
  if (cfg.serviceAccountEmail && cfg.serviceAccountPrivateKey) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const claimSet = {
        iss: cfg.serviceAccountEmail,
        scope: 'https://www.googleapis.com/auth/drive',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
      const b64Claim = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
      const signatureInput = `${b64Header}.${b64Claim}`;

      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signatureInput);
      signer.end();

      // Normalize formatted private key string with real newlines
      const normalizedKey = cfg.serviceAccountPrivateKey.replace(/\\n/g, '\n');
      const signature = signer.sign(normalizedKey, 'base64url');
      const jwt = `${signatureInput}.${signature}`;

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        })
      });

      if (!tokenResp.ok) {
        const errBody = await tokenResp.text();
        throw new Error(`Google Auth Token Error (${tokenResp.status}): ${errBody}`);
      }

      const tokenData: any = await tokenResp.json();
      cachedDriveAccessToken = {
        token: tokenData.access_token,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
      };
      return tokenData.access_token;
    } catch (err: any) {
      console.error('[Google Drive] Service Account Auth failed:', err);
      throw err;
    }
  }

  // 2. OAuth2 Refresh Token Flow (Alternative)
  if (cfg.clientId && cfg.clientSecret && cfg.refreshToken) {
    try {
      const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: cfg.refreshToken,
          grant_type: 'refresh_token'
        })
      });

      if (!refreshResp.ok) {
        const errBody = await refreshResp.text();
        throw new Error(`Google OAuth Refresh Error: ${errBody}`);
      }

      const rData: any = await refreshResp.json();
      cachedDriveAccessToken = {
        token: rData.access_token,
        expiresAt: Date.now() + (rData.expires_in || 3600) * 1000
      };
      return rData.access_token;
    } catch (err: any) {
      console.error('[Google Drive] OAuth2 Refresh failed:', err);
      throw err;
    }
  }

  return null;
}

// 5 Standard Zones + 99 Trash Folder definition
const STANDARD_DRIVE_ZONES = {
  ZONE_00: '00_กล่องพักบิล_LINE_รอตรวจรับ',
  ZONE_01: '01_ใบสั่งซื้อ_PO',
  ZONE_02: '02_ใบงานหลัก_DO_ครบชุด',
  ZONE_03: '03_ตั๋วชั่งปลายทาง_รอจับคู่DO',
  ZONE_04: '04_ใบเสร็จกำกับภาษี_เอกเทศ',
  ZONE_99: '99_ถังขยะ_รอทำลาย_30วัน' // Soft Delete quarantine
};

// Helper: Ensure 5 standard zones exist under root folder
async function ensureStandardDriveZones(accessToken: string, rootFolderId: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const [key, folderName] of Object.entries(STANDARD_DRIVE_ZONES)) {
    if (zoneFoldersCache.has(key)) {
      result[key] = zoneFoldersCache.get(key)!;
      continue;
    }

    // Search if folder already exists under root
    const query = encodeURIComponent(`'${rootFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (searchResp.ok) {
      const searchData: any = await searchResp.json();
      if (searchData.files && searchData.files.length > 0) {
        const foundId = searchData.files[0].id;
        zoneFoldersCache.set(key, foundId);
        result[key] = foundId;
        continue;
      }
    }

    // Create folder if not found
    const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId]
      })
    });

    if (createResp.ok) {
      const createdData: any = await createResp.json();
      zoneFoldersCache.set(key, createdData.id);
      result[key] = createdData.id;
    }
  }

  return result;
}

// Helper: Sanitize document number for safe Google Drive folder/file names
function sanitizeDriveName(rawName: string): string {
  return (rawName || 'DOC')
    .toString()
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_');
}

// Upload a bill file (Base64) to Google Drive in multipart upload
async function uploadFileToDrive(params: {
  accessToken: string;
  folderId: string;
  fileName: string;
  base64Data: string;
  mimeType?: string;
}): Promise<{ fileId: string; webViewLink?: string }> {
  const { accessToken, folderId, fileName, base64Data, mimeType = 'image/jpeg' } = params;
  const cleanBase64 = base64Data.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '');
  const fileBuffer = Buffer.from(cleanBase64, 'base64');

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: mimeType
  };

  const boundary = `-------DriveBoundary${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody = Buffer.concat([
    Buffer.from(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: binary\r\n\r\n'
    ),
    fileBuffer,
    Buffer.from(closeDelimiter)
  ]);

  const uploadResp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': multipartBody.length.toString()
      },
      body: multipartBody
    }
  );

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`Google Drive Upload failed (${uploadResp.status}): ${errText}`);
  }

  const fileData: any = await uploadResp.json();
  return {
    fileId: fileData.id,
    webViewLink: fileData.webViewLink
  };
}

// Move a file from one folder to another
async function moveDriveFile(accessToken: string, fileId: string, fromFolderId: string, toFolderId: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id,parents`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google Drive Move failed: ${err}`);
  }
  return await resp.json();
}

// Soft Delete: Move file to 99_Trash or Google Drive Trash
async function trashDriveFile(accessToken: string, fileId: string, currentFolderId?: string, trashFolderId?: string) {
  if (currentFolderId && trashFolderId) {
    try {
      await moveDriveFile(accessToken, fileId, currentFolderId, trashFolderId);
      return { success: true, mode: 'moved_to_quarantine_99' };
    } catch {
      // fallback to Drive native trash
    }
  }

  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trashed: true })
  });

  return { success: resp.ok, mode: 'native_trash' };
}

// Find or create subfolder under a parent zone (e.g. TR-2026-001_DO-02-0045)
async function getOrCreateSubfolder(accessToken: string, parentFolderId: string, subfolderName: string): Promise<string> {
  const safeName = sanitizeDriveName(subfolderName);
  const query = encodeURIComponent(`'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);

  const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (searchResp.ok) {
    const searchData: any = await searchResp.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
  }

  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    })
  });

  if (!createResp.ok) {
    throw new Error('ไม่สามารถสร้างโฟลเดอร์ใบงานย่อยบน Google Drive ได้');
  }

  const createdData: any = await createResp.json();
  return createdData.id;
}

// ----------------------------------------------------------------------------
// GOOGLE DRIVE API ENDPOINTS
// ----------------------------------------------------------------------------

// 1. Get Google Drive configuration
app.get('/api/drive/config', (req: Request, res: Response) => {
  const cfg = getStoredDriveConfig();
  res.json({
    success: true,
    config: {
      isConfigured: Boolean(cfg.rootFolderId && (cfg.gasWebAppUrl || cfg.serviceAccountEmail || cfg.directAccessToken || cfg.refreshToken)),
      isEnabled: cfg.isEnabled,
      connectionMode: cfg.connectionMode || (cfg.gasWebAppUrl ? 'gas' : 'service_account'),
      gasWebAppUrl: cfg.gasWebAppUrl || null,
      hasGas: Boolean(cfg.gasWebAppUrl),
      rootFolderId: cfg.rootFolderId,
      hasServiceAccount: Boolean(cfg.serviceAccountEmail && cfg.serviceAccountPrivateKey),
      serviceAccountEmail: cfg.serviceAccountEmail || null,
      hasOAuth: Boolean(cfg.clientId && cfg.refreshToken),
      lastTestedAt: cfg.lastTestedAt || null
    }
  });
});

// 2. Save Google Drive configuration
app.post('/api/drive/config', (req: Request, res: Response) => {
  try {
    const { rootFolderId, connectionMode, gasWebAppUrl, serviceAccountJson, serviceAccountEmail, serviceAccountPrivateKey, isEnabled } = req.body;
    const saved = saveStoredDriveConfig({
      rootFolderId: typeof rootFolderId === 'string' ? rootFolderId.trim() : undefined,
      connectionMode: connectionMode === 'gas' || connectionMode === 'service_account' ? connectionMode : undefined,
      gasWebAppUrl: typeof gasWebAppUrl === 'string' ? gasWebAppUrl.trim() : undefined,
      serviceAccountJson: typeof serviceAccountJson === 'string' ? serviceAccountJson.trim() : undefined,
      serviceAccountEmail: typeof serviceAccountEmail === 'string' ? serviceAccountEmail.trim() : undefined,
      serviceAccountPrivateKey: typeof serviceAccountPrivateKey === 'string' ? serviceAccountPrivateKey.trim() : undefined,
      isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : undefined
    });

    zoneFoldersCache.clear();
    cachedDriveAccessToken = null;

    res.json({
      success: true,
      message: 'บันทึกการตั้งค่า Google Drive สำเร็จ',
      config: {
        isConfigured: Boolean(saved.rootFolderId && (saved.gasWebAppUrl || saved.serviceAccountEmail || saved.directAccessToken)),
        isEnabled: saved.isEnabled,
        connectionMode: saved.connectionMode,
        gasWebAppUrl: saved.gasWebAppUrl || null,
        rootFolderId: saved.rootFolderId,
        serviceAccountEmail: saved.serviceAccountEmail || null
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// 3. Test Google Drive Connection & Create 5 Zones
app.post('/api/drive/test', async (req: Request, res: Response) => {
  try {
    const cfg = getStoredDriveConfig();
    const effectiveRootFolderId = (req.body?.rootFolderId || cfg.rootFolderId || '').trim();
    const effectiveGasUrl = (req.body?.gasWebAppUrl || cfg.gasWebAppUrl || '').trim();
    const effectiveConnMode = req.body?.connectionMode || cfg.connectionMode || (effectiveGasUrl ? 'gas' : 'service_account');

    if (!effectiveRootFolderId) {
      return res.status(400).json({
        success: false,
        error: 'กรุณากรอก Google Drive Root Folder ID ของโฟลเดอร์หลักบริษัท'
      });
    }

    // A) Google Apps Script (GAS) Connection Mode (No Service Account required)
    if (effectiveConnMode === 'gas' || effectiveGasUrl) {
      if (!effectiveGasUrl) {
        return res.status(400).json({
          success: false,
          error: 'กรุณากรอก URL เว็บแอป Google Apps Script (GAS Web App URL)'
        });
      }

      const gasResult = await callGasDriveApi(effectiveGasUrl, {
        action: 'test',
        rootFolderId: effectiveRootFolderId
      });

      if (!gasResult || !gasResult.success) {
        return res.status(400).json({
          success: false,
          error: gasResult?.error || 'การทดสอบผ่าน Google Apps Script ไม่สำเร็จ กรุณาตรวจสอบ URL เว็บแอป'
        });
      }

      saveStoredDriveConfig({
        rootFolderId: effectiveRootFolderId,
        gasWebAppUrl: effectiveGasUrl,
        connectionMode: 'gas',
        lastTestedAt: new Date().toISOString()
      });

      return res.json({
        success: true,
        rootFolderName: gasResult.rootFolderName || 'Root Folder',
        rootFolderId: gasResult.rootFolderId || effectiveRootFolderId,
        zonesCreated: gasResult.zonesCreated || {},
        message: 'เชื่อมต่อ Google Drive ผ่าน Google Apps Script สำเร็จ และตรวจสอบ 5 โซนมาตรฐานเรียบร้อย 100%'
      });
    }

    // B) Service Account Flow
    const token = await getDriveAccessToken();
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'ยังไม่ได้ตั้งค่า Google Service Account หรือ Root Folder ID สำหรับเชื่อมต่อ Google Drive'
      });
    }

    // Ping root folder
    const rootCheck = await fetch(`https://www.googleapis.com/drive/v3/files/${effectiveRootFolderId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!rootCheck.ok) {
      const errText = await rootCheck.text();
      return res.status(400).json({
        success: false,
        error: `ไม่สามารถเข้าถึง Root Folder ID ได้ กรุณาตรวจสอบว่าแชร์สิทธิ์ Editor ให้ Service Account Email แล้วหรือไม่: ${errText}`
      });
    }

    const rootData: any = await rootCheck.json();
    const zones = await ensureStandardDriveZones(token, effectiveRootFolderId);
    saveStoredDriveConfig({ lastTestedAt: new Date().toISOString() });

    res.json({
      success: true,
      rootFolderName: rootData.name,
      rootFolderId: rootData.id,
      zonesCreated: zones,
      message: 'เชื่อมต่อ Google Drive API และตรวจสอบโครงสร้าง 5 โซนมาตรฐานสำเร็จ 100%'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'เกิดข้อผิดพลาดในการทดสอบ Google Drive' });
  }
});

// 4. Upload bill image directly to appropriate Google Drive Zone
app.post('/api/drive/upload', async (req: Request, res: Response) => {
  try {
    const token = await getDriveAccessToken();
    const cfg = getStoredDriveConfig();
    const isGasMode = Boolean(cfg.connectionMode === 'gas' || (!token && cfg.gasWebAppUrl) || (cfg.isEnabled && cfg.gasWebAppUrl && !token));

    if (!token && !isGasMode) {
      return res.status(400).json({
        success: false,
        error: 'Google Drive ยังไม่ได้เชื่อมต่อ หรือไม่ได้เปิดใช้งาน'
      });
    }

    if (!cfg.rootFolderId) {
      return res.status(400).json({
        success: false,
        error: 'กรุณากรอก Google Drive Root Folder ID'
      });
    }

    const {
      base64Image,
      docType = 'delivery_order',
      docNumber = '',
      trNumber = '',
      source = 'web_upload' // 'line_webhook' | 'web_upload'
    } = req.body;

    if (!base64Image) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลรูปภาพ (base64Image)' });
    }

    const safeDocNo = sanitizeDriveName(docNumber || 'NEW');
    const safeTrNo = sanitizeDriveName(trNumber || `TR-${Date.now().toString().slice(-4)}`);

    let fileName: string;
    let assignedZone: string;

    if (source === 'line_webhook') {
      assignedZone = 'zone_00';
      fileName = `LINE_${Date.now()}_${safeDocNo}.jpg`;
    } else if (docType === 'purchase_order') {
      assignedZone = 'zone_01';
      fileName = `PO_${safeDocNo}.jpg`;
    } else if (docType === 'dest_weighbridge') {
      assignedZone = 'zone_03';
      fileName = `WB_${safeDocNo}_รอชนDO.jpg`;
    } else if (docType === 'tax_invoice') {
      assignedZone = 'zone_04';
      fileName = `TAX_${safeDocNo}.jpg`;
    } else {
      assignedZone = 'zone_02';
      fileName = `1_DO_${safeDocNo}.jpg`;
    }

    // A) If GAS Mode
    if (isGasMode && cfg.gasWebAppUrl) {
      const gasResult = await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'upload',
        rootFolderId: cfg.rootFolderId,
        targetZone: assignedZone,
        subfolderName: docType === 'delivery_order' ? `${safeTrNo}_DO-${safeDocNo}` : undefined,
        fileName,
        base64Image
      });

      if (!gasResult || !gasResult.success) {
        throw new Error(gasResult?.error || 'การอัปโหลดไฟล์ผ่าน Google Apps Script ขัดข้อง');
      }

      return res.json({
        success: true,
        driveFileId: gasResult.fileId,
        driveFolderId: gasResult.folderId || cfg.rootFolderId,
        driveFileLocation: assignedZone,
        webViewLink: gasResult.webViewLink,
        message: `จัดเก็บภาพบิลลงโฟลเดอร์ Google Drive (${assignedZone}) ผ่าน Google Apps Script สำเร็จ`
      });
    }

    // B) Service Account Flow
    if (!token) {
      return res.status(400).json({ success: false, error: 'ไม่พบ Token เชื่อมต่อ Google Drive' });
    }

    const zones = await ensureStandardDriveZones(token, cfg.rootFolderId);
    let targetFolderId: string;

    if (source === 'line_webhook') {
      targetFolderId = zones.ZONE_00;
    } else if (docType === 'purchase_order') {
      targetFolderId = zones.ZONE_01;
    } else if (docType === 'dest_weighbridge') {
      targetFolderId = zones.ZONE_03;
    } else if (docType === 'tax_invoice') {
      targetFolderId = zones.ZONE_04;
    } else {
      const subfolderName = `${safeTrNo}_DO-${safeDocNo}`;
      const subfolderId = await getOrCreateSubfolder(token, zones.ZONE_02, subfolderName);
      targetFolderId = subfolderId;
    }

    const uploadRes = await uploadFileToDrive({
      accessToken: token,
      folderId: targetFolderId,
      fileName,
      base64Data: base64Image
    });

    res.json({
      success: true,
      driveFileId: uploadRes.fileId,
      driveFolderId: targetFolderId,
      driveFileLocation: assignedZone,
      webViewLink: uploadRes.webViewLink,
      message: `อัปโหลดเข้า Google Drive โซน ${assignedZone} สำเร็จ`
    });
  } catch (err: any) {
    console.error('Drive upload error:', err);
    res.status(500).json({ success: false, error: err?.message || 'อัปโหลด Google Drive ขัดข้อง' });
  }
});

// 5. Verified-Only File Move Rule (POST /api/drive/sync-verified-move)
app.post('/api/drive/sync-verified-move', async (req: Request, res: Response) => {
  try {
    const token = await getDriveAccessToken();
    const cfg = getStoredDriveConfig();
    const isGasMode = Boolean(cfg.connectionMode === 'gas' || (!token && cfg.gasWebAppUrl) || (cfg.isEnabled && cfg.gasWebAppUrl && !token));

    if (!token && !isGasMode) {
      return res.status(400).json({ success: false, error: 'Google Drive ยังไม่ได้เชื่อมต่อ' });
    }

    const {
      action, // 'confirm_match' | 'revoke_match'
      destTicketFileId,
      destTicketDocNo = 'WB',
      doTrNumber = '',
      doDocNumber = ''
    } = req.body;

    if (!destTicketFileId) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสไฟล์ตั๋วชั่งปลายทาง (destTicketFileId)' });
    }

    const safeDoNo = sanitizeDriveName(doDocNumber);
    const safeTrNo = sanitizeDriveName(doTrNumber || 'TR');
    const subfolderName = `${safeTrNo}_DO-${safeDoNo}`;

    // A) If GAS Mode
    if (isGasMode && cfg.gasWebAppUrl) {
      const gasResult = await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'sync_verified_move',
        rootFolderId: cfg.rootFolderId,
        fileId: destTicketFileId,
        targetZone: action === 'confirm_match' ? 'zone_02' : 'zone_03',
        subfolderName: action === 'confirm_match' ? subfolderName : undefined
      });

      if (!gasResult || !gasResult.success) {
        throw new Error(gasResult?.error || 'การย้ายไฟล์ผ่าน Google Apps Script ขัดข้อง');
      }

      return res.json({
        success: true,
        action,
        driveFileLocation: action === 'confirm_match' ? 'zone_02' : 'zone_03',
        targetFolderId: gasResult.targetFolderId,
        message: action === 'confirm_match'
          ? `ย้ายตั๋วชั่ง ${destTicketDocNo} รวมเข้าโฟลเดอร์ใบงาน ${subfolderName} สำเร็จแล้วตามกฎยืนยัน (GAS)`
          : `ย้ายตั๋วชั่ง ${destTicketDocNo} กลับไปพักที่ 03_ตั๋วชั่งปลายทาง เรียบร้อยแล้ว (GAS)`
      });
    }

    // B) Service Account Flow
    if (!token) {
      return res.status(400).json({ success: false, error: 'ไม่พบ Token เชื่อมต่อ Google Drive' });
    }

    const zones = await ensureStandardDriveZones(token, cfg.rootFolderId);

    if (action === 'confirm_match') {
      const doFolderId = await getOrCreateSubfolder(token, zones.ZONE_02, subfolderName);
      await moveDriveFile(token, destTicketFileId, zones.ZONE_03, doFolderId);

      return res.json({
        success: true,
        action: 'confirm_match',
        driveFileLocation: 'zone_02',
        targetFolderId: doFolderId,
        message: `ย้ายตั๋วชั่ง ${destTicketDocNo} รวมเข้าโฟลเดอร์ใบงาน ${subfolderName} สำเร็จแล้วตามกฎยืนยัน`
      });
    } else if (action === 'revoke_match') {
      const doFolderId = await getOrCreateSubfolder(token, zones.ZONE_02, subfolderName);
      await moveDriveFile(token, destTicketFileId, doFolderId, zones.ZONE_03);

      return res.json({
        success: true,
        action: 'revoke_match',
        driveFileLocation: 'zone_03',
        targetFolderId: zones.ZONE_03,
        message: `ย้ายตั๋วชั่ง ${destTicketDocNo} กลับไปพักที่ 03_ตั๋วชั่งปลายทาง_รอจับคู่DO เรียบร้อยแล้ว`
      });
    } else {
      return res.status(400).json({ success: false, error: 'รูปแบบ action ไม่ถูกต้อง (ต้องเป็น confirm_match หรือ revoke_match)' });
    }
  } catch (err: any) {
    console.error('Verified-Move Error:', err);
    res.status(500).json({ success: false, error: err?.message || 'การย้ายไฟล์บน Google Drive ขัดข้อง' });
  }
});

// 6. Zero-Junk Cleanup Endpoint (POST /api/drive/cleanup-file)
app.post('/api/drive/cleanup-file', async (req: Request, res: Response) => {
  try {
    const token = await getDriveAccessToken();
    const cfg = getStoredDriveConfig();
    const isGasMode = Boolean(cfg.connectionMode === 'gas' || (!token && cfg.gasWebAppUrl) || (cfg.isEnabled && cfg.gasWebAppUrl && !token));

    if (!token && !isGasMode) {
      return res.status(400).json({ success: false, error: 'Google Drive ยังไม่ได้เชื่อมต่อ' });
    }

    const {
      mode, // 'delete_old_file' | 'delete_order_cascade'
      oldFileId,
      orderFolderId,
      orderFileIds = [],
      destTicketFileIdToRescue
    } = req.body;

    // A) If GAS Mode
    if (isGasMode && cfg.gasWebAppUrl) {
      await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'cleanup',
        rootFolderId: cfg.rootFolderId,
        fileId: oldFileId,
        folderId: orderFolderId,
        rescueFileId: destTicketFileIdToRescue
      });

      return res.json({
        success: true,
        message: 'ทำความสะอาดลบเอกสารและไฟล์แนบออกจาก Google Drive สำเร็จ 100% (Zero-Junk Cleanup via GAS)'
      });
    }

    // B) Service Account Flow
    if (!token) {
      return res.status(400).json({ success: false, error: 'ไม่พบ Token เชื่อมต่อ Google Drive' });
    }

    const zones = await ensureStandardDriveZones(token, cfg.rootFolderId);

    if (mode === 'delete_old_file' && oldFileId) {
      await trashDriveFile(token, oldFileId, undefined, zones.ZONE_99);
      return res.json({
        success: true,
        message: `ลบไฟล์รูปเก่า ${oldFileId} ออกจาก Google Drive สำเร็จ (Zero-Junk)`
      });
    }

    if (mode === 'delete_order_cascade') {
      if (destTicketFileIdToRescue && orderFolderId) {
        try {
          await moveDriveFile(token, destTicketFileIdToRescue, orderFolderId, zones.ZONE_03);
          console.log(`[Drive Rescue] Rescued dest ticket ${destTicketFileIdToRescue} back to Zone 03 before DO deletion`);
        } catch (rescueErr) {
          console.warn('[Drive Rescue Warning] Could not rescue dest ticket:', rescueErr);
        }
      }

      for (const fId of orderFileIds) {
        if (fId && fId !== destTicketFileIdToRescue) {
          try {
            await trashDriveFile(token, fId, orderFolderId, zones.ZONE_99);
          } catch {
            // ignore
          }
        }
      }

      if (orderFolderId && orderFolderId !== zones.ZONE_02 && orderFolderId !== cfg.rootFolderId) {
        try {
          await trashDriveFile(token, orderFolderId, zones.ZONE_02, zones.ZONE_99);
        } catch {
          // ignore
        }
      }

      return res.json({
        success: true,
        message: 'ทำความสะอาดลบเอกสารและไฟล์แนบออกจาก Google Drive สำเร็จ 100% (Zero-Junk Cleanup)'
      });
    }

    res.status(400).json({ success: false, error: 'ระบุพารามิเตอร์ cleanup ไม่ครบถ้วน' });
  } catch (err: any) {
    console.error('Zero-Junk Cleanup Error:', err);
    res.status(500).json({ success: false, error: err?.message || 'การทำความสะอาดไฟล์ล้มเหลว' });
  }
});

// Vite mounting & static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
