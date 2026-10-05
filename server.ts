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
  mapSupabaseToBillingNote,
  mapLineInboxToSupabase,
  mapSupabaseToLineInbox
} from './src/utils/supabaseClient';
import type { DocumentType } from './src/types';

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

// ─── System Config File (GEMINI_API_KEY + other runtime settings) ───────────
const SYSTEM_CONFIG_FILE_PATH = path.resolve(__dirname, '.system_config.json');

interface SystemConfig {
  geminiApiKey?: string;
}

function getSystemConfig(): SystemConfig {
  try {
    if (fs.existsSync(SYSTEM_CONFIG_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(SYSTEM_CONFIG_FILE_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveSystemConfig(patch: Partial<SystemConfig>) {
  const current = getSystemConfig();
  fs.writeFileSync(SYSTEM_CONFIG_FILE_PATH, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
}

/** Returns active Gemini API Key: file config first, then env var */
function getActiveGeminiApiKey(): string {
  return (getSystemConfig().geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
}

// ─── Startup Self-Test Status (in-memory, reset each server restart) ─────────
const startupStatus: {
  ranAt: string | null;
  supabase: 'ok' | 'error' | 'not_configured' | 'pending';
  supabaseMessage: string;
  drive: 'ok' | 'error' | 'not_configured' | 'pending';
  driveMessage: string;
  gemini: 'ok' | 'not_configured';
  geminiMessage: string;
  allReady: boolean;
} = {
  ranAt: null,
  supabase: 'pending',
  supabaseMessage: 'ยังไม่ได้ทดสอบ',
  drive: 'pending',
  driveMessage: 'ยังไม่ได้ทดสอบ',
  gemini: 'not_configured',
  geminiMessage: 'ยังไม่ได้ตั้งค่า',
  allReady: false
};

// Shared Gemini client instance
const getGeminiClient = () => {
  const apiKey = getActiveGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
};

// Locked strictly to the 'flash-lite' family using Google's rolling alias 'gemini-flash-lite-latest'
// (with 'gemini-3.1-flash-lite' as same-family fallback) so the system automatically updates when a newer
// flash-lite version is released while keeping 100% consistent flash-lite extraction behavior.
const FLASH_LITE_MODELS = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
const OCR_DOCUMENT_TYPES: DocumentType[] = [
  'delivery_order',
  'weighbridge',
  'dest_weighbridge',
  'concrete',
  'tax_invoice',
  'purchase_order',
  'full_logistics'
];

const SHARED_OCR_POLICY = `มาตรฐาน OCR กลางของระบบ (ใช้กับทุกช่องทาง):
- จำแนกประเภทเอกสารให้ตรงหลักฐานบนภาพ: delivery_order, weighbridge (ตั๋วชั่งต้นทาง), dest_weighbridge (ตั๋วชั่งปลายทาง), concrete, tax_invoice, purchase_order หรือ full_logistics
- ห้ามเดา: ข้อมูลที่อ่านไม่ชัดหรือไม่มีบนภาพให้เว้นว่าง/ใส่ 0 ตามชนิดข้อมูล และอย่าอนุมานชื่อโครงการจากชื่อกลุ่มหรือบริบทภายนอก
- เลขเอกสารที่มีทั้งเล่มที่และเลขที่ให้เรียงเป็น เล่มที่/เลขที่ เช่น 02/0045; เก็บเล่มที่ใน bookNo แยกด้วย
- น้ำหนักรถหนัก (Gross) ต้องไม่น้อยกว่าน้ำหนักรถเปล่า (Tare); Net = Gross - Tare เมื่อทั้งคู่มีข้อมูล
- แยกชื่อสินค้าออกจากหมายเหตุ เงื่อนไขส่งของ และข้อความติดต่อ; ให้รายการจริงอยู่ใน lineItems/items และข้อความอื่นอยู่ใน notes
- วันที่ใช้ YYYY-MM-DD เมื่ออ่านได้; รายการสินค้าเก็บชื่อ, สเปก, ปริมาณ, หน่วย, ราคาต่อหน่วย และยอดตามที่พิมพ์จริง
- หากช่องทางหรือผู้ใช้ระบุประเภทเอกสารไว้ชัดเจน ให้คงประเภทนั้นและจัดข้อมูลลงฟิลด์เฉพาะของประเภทนั้น โดยไม่คัดลอกน้ำหนักไปคนละโซน`;

function normalizeOcrDocumentNumber(rawDoc?: string, rawBook?: string): string {
  const doc = (rawDoc || '').trim();
  const book = (rawBook || '')
    .replace(/^(?:เล่มที่|เล่ม|book\s*no\.?|book|vol\.?)\s*[:#.]?\s*/i, '')
    .trim();
  if (!doc && !book) return '';

  if (/เล่ม/i.test(doc) && /เลข/i.test(doc)) {
    const bookMatch = /เล่ม(?:ที่)?\s*[:#.]?\s*([A-Za-z0-9\-_]+)/i.exec(doc);
    const numberMatch = /เลข(?:ที่)?\s*[:#.]?\s*([A-Za-z0-9\-_]+)/i.exec(doc);
    if (bookMatch?.[1] && numberMatch?.[1]) return `${bookMatch[1]}/${numberMatch[1]}`;
  }

  const cleanDoc = doc.replace(/^(?:เลขที่|เลข|no\.?|invoice\s*no\.?|po\s*no\.?|do\s*no\.?)\s*[:#.]?\s*/i, '').trim();
  if (!book || book === '-' || book === '0') return cleanDoc;
  if (!cleanDoc) return book;
  if (cleanDoc.includes('/')) {
    const parts = cleanDoc.split('/').map(part => part.trim());
    if (parts.length === 2 && parts[1] === book && parts[0] !== book) {
      return `${parts[1]}/${parts[0]}`;
    }
    return cleanDoc;
  }
  return `${book}/${cleanDoc}`;
}

function normalizeOcrDocumentType(value: unknown, fallback: DocumentType = 'delivery_order'): DocumentType {
  return OCR_DOCUMENT_TYPES.find(type => type === value) || fallback;
}

function normalizeOcrWeightPair(grossValue: unknown, tareValue: unknown, netValue: unknown = 0) {
  let gross = Number(grossValue) || 0;
  let tare = Number(tareValue) || 0;
  if (gross > 0 && tare > 0 && gross < tare) [gross, tare] = [tare, gross];
  return {
    gross,
    tare,
    net: gross > 0 && tare > 0 ? gross - tare : Number(netValue) || 0
  };
}

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

async function requestOcrWithSharedPolicy(ai: GoogleGenAI, payload: Record<string, any>) {
  const parts = payload.contents?.parts;
  const promptPart = Array.isArray(parts)
    ? parts.find((part: any) => typeof part?.text === 'string')
    : undefined;
  if (!promptPart) {
    throw new Error('OCR request ไม่มี prompt สำหรับแนบมาตรฐานการอ่านเอกสาร');
  }
  promptPart.text = `${SHARED_OCR_POLICY}\n\n${promptPart.text}`;
  const result = await callGeminiWithResilience(ai, payload);
  const output = result.response.text || '{}';
  let data: Record<string, any>;
  try {
    data = JSON.parse(output);
  } catch (error) {
    throw new Error(`ผลลัพธ์ OCR ไม่ใช่ JSON ที่ถูกต้อง: ${(error as Error).message}`);
  }
  return { ...result, data };
}

// Health & Status endpoint
app.get('/api/status', (req: Request, res: Response) => {
  const activeKey = getActiveGeminiApiKey();
  const hasKey = Boolean(activeKey && activeKey.length > 5);
  const keySource = activeKey
    ? (getSystemConfig().geminiApiKey ? 'ui_config' : 'env_var')
    : 'none';
  res.json({
    status: 'ok',
    hasKey,
    keySource,
    model: FLASH_LITE_MODELS[0],
    timestamp: new Date().toISOString()
  });
});

// System Config API — Gemini Key management via Settings UI
app.get('/api/system/config', async (_req: Request, res: Response) => {
  // Ensure latest config is restored from Supabase system_config (handles Render redeploys)
  await restoreConfigsFromSupabase();
  const cfg = getSystemConfig();
  const activeKey = getActiveGeminiApiKey();
  const hasGeminiKey = Boolean(activeKey && activeKey.length > 5);
  // Return masked key for display (first 8 chars + ****)
  const maskedKey = hasGeminiKey ? activeKey.substring(0, 8) + '••••••••••••••••••••' : '';
  return res.json({
    success: true,
    hasGeminiKey,
    maskedGeminiKey: maskedKey,
    keySource: cfg.geminiApiKey ? 'ui_config' : (process.env.GEMINI_API_KEY ? 'env_var' : 'none')
  });
});

app.post('/api/system/config', (req: Request, res: Response) => {
  const { geminiApiKey } = req.body || {};
  if (typeof geminiApiKey === 'string') {
    const trimmed = geminiApiKey.trim();
    if (trimmed.length < 10) {
      return res.status(400).json({ success: false, error: 'GEMINI_API_KEY ต้องมีความยาวอย่างน้อย 10 ตัวอักษร' });
    }
    saveSystemConfig({ geminiApiKey: trimmed });
    persistConfigToSupabase('gemini_config', { geminiApiKey: trimmed });
    return res.json({ success: true, message: 'บันทึก GEMINI_API_KEY เรียบร้อยแล้ว ระบบ AI พร้อมทำงาน' });
  }
  return res.status(400).json({ success: false, error: 'กรุณาระบุ geminiApiKey' });
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

    const { data: parsedData, usedModel } = await requestOcrWithSharedPolicy(ai, {
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
              description: "ประเภทเอกสารกลาง: delivery_order, weighbridge, dest_weighbridge, concrete, tax_invoice, purchase_order หรือ full_logistics"
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

    if (parsedData.bookNo || /เล่ม/i.test(parsedData.col6 || '') || /เล่ม/i.test(parsedData.col4 || '')) {
      if (parsedData.docType === 'purchase_order') {
        parsedData.col4 = normalizeOcrDocumentNumber(parsedData.col4 || parsedData.col6, parsedData.bookNo);
      } else {
        if (parsedData.col6) {
          parsedData.col6 = normalizeOcrDocumentNumber(parsedData.col6, parsedData.bookNo);
        }
        if (/เล่ม/i.test(parsedData.col4 || '')) {
          parsedData.col4 = normalizeOcrDocumentNumber(parsedData.col4, '');
        }
      }
    }

    const originWeights = normalizeOcrWeightPair(parsedData.col13, parsedData.col14, parsedData.col15);
    parsedData.col13 = originWeights.gross;
    parsedData.col14 = originWeights.tare;
    parsedData.col15 = originWeights.net;

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

    const destinationWeights = normalizeOcrWeightPair(parsedData.col18, parsedData.col19, parsedData.col20);
    parsedData.col18 = destinationWeights.gross;
    parsedData.col19 = destinationWeights.tare;
    parsedData.col20 = destinationWeights.net;
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

    parsedData.docType = targetDocType && targetDocType !== 'auto'
      ? normalizeOcrDocumentType(targetDocType, normalizeOcrDocumentType(parsedData.docType))
      : normalizeOcrDocumentType(parsedData.docType);

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

    const { data: parsedPO, usedModel } = await requestOcrWithSharedPolicy(ai, {
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

    if (parsedPO.bookNo || /เล่ม/i.test(parsedPO.poNumber || '')) {
      parsedPO.poNumber = normalizeOcrDocumentNumber(parsedPO.poNumber, parsedPO.bookNo);
    }
    parsedPO.docType = 'purchase_order';

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

const LINE_CONFIG_FILE_PATH = path.resolve(__dirname, '.line_config.json');

function getStoredLineConfig(): ServerLineBotConfig {
  let fileConfig: Partial<ServerLineBotConfig> = {};
  try {
    if (fs.existsSync(LINE_CONFIG_FILE_PATH)) {
      const content = fs.readFileSync(LINE_CONFIG_FILE_PATH, 'utf-8');
      fileConfig = JSON.parse(content);
    }
  } catch (err) {
    console.warn('[LINE Config] Failed to read .line_config.json', err);
  }
  return {
    enabled: fileConfig.enabled !== undefined ? fileConfig.enabled : true,
    channelAccessToken: (fileConfig.channelAccessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
    channelSecret: (fileConfig.channelSecret || process.env.LINE_CHANNEL_SECRET || '').trim(),
    autoQuoteReply: fileConfig.autoQuoteReply !== undefined ? fileConfig.autoQuoteReply : true,
    replyOnDuplicate: fileConfig.replyOnDuplicate !== undefined ? fileConfig.replyOnDuplicate : true,
    replyOnUnclearImage: fileConfig.replyOnUnclearImage !== undefined ? fileConfig.replyOnUnclearImage : true,
    filterNonBillImages: fileConfig.filterNonBillImages !== undefined ? fileConfig.filterNonBillImages : true,
    strictZeroPushQuota: true,
    allowedGroupNames: Array.isArray(fileConfig.allowedGroupNames) ? fileConfig.allowedGroupNames : []
  };
}

let lineBotConfig: ServerLineBotConfig = getStoredLineConfig();

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
    // Collect-First Mode: เก็บบิลไว้แล้ว แม้อ่านเลขที่ไม่ได้ — เจ้าหน้าที่จะตรวจสอบเองในระบบ
    return [
      `📥 รับบิลไว้แล้วครับ คุณ ${senderName}`,
      `• สถานะ: บันทึกรอเจ้าหน้าที่ตรวจสอบ`,
      `• หมายเหตุ: อ่านเลขที่บิลไม่ชัด — เจ้าหน้าที่จะกรอกข้อมูลให้เองในระบบ`,
      `✅ ไม่ต้องถ่ายซ้ำ บิลถูกเก็บเรียบร้อยแล้ว`
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
 * Sends a retake-request reply to LINE group WITH @mention of the original sender.
 * Uses LINE mention feature so the sender sees a notification directly.
 * Only used for the "bill number unreadable" case — never for normal bill confirmations.
 */
async function sendLineRetakeReplyWithMention(
  replyToken: string | undefined,
  quoteToken: string | undefined,
  userId: string,
  senderName: string
): Promise<boolean> {
  if (!replyToken || !lineBotConfig.channelAccessToken || !lineBotConfig.autoQuoteReply) {
    return false;
  }

  // LINE mention: @{senderName} ต้องอยู่ต้นข้อความ และระบุ index + length ให้ตรง
  const mentionTag = `@${senderName}`;
  const bodyText = [
    `❌ อ่านเลขที่บิลไม่ได้ — กรุณาถ่ายใหม่และส่งใหม่ครับ`,
    `• สาเหตุ: ภาพไม่ชัด / เลขที่บิลเบลอหรืออ่านไม่ออก`,
    `📸 กรุณาถ่ายใหม่ให้ชัดขึ้น เพื่อให้บอทอ่านเลขที่เอกสารได้ถูกต้อง`
  ].join('\n');
  const fullText = `${mentionTag} ${bodyText}`;

  try {
    const messagePayload: Record<string, any> = {
      type: 'text',
      text: fullText,
      mentionees: [
        {
          index: 0,                    // ตำแหน่งเริ่มต้นของ @mention ในข้อความ
          length: mentionTag.length,   // ความยาวของ @mention tag
          userId,                      // LINE userId ของผู้ส่งบิล
          type: 'user'
        }
      ]
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
      body: JSON.stringify({ replyToken, messages: [messagePayload] })
    });

    if (!resp.ok) {
      // Fallback: ถ้า mention ไม่ work (เช่น userId unknown) ให้ส่งแบบปกติแทน
      console.warn('[LINE Retake] Mention reply failed, falling back to plain reply');
      return sendLineFreeQuoteReply(replyToken, quoteToken, `${senderName} — ${bodyText}`);
    }
    return true;
  } catch (err) {
    console.warn('[LINE Retake] Reply with mention error:', err);
    return sendLineFreeQuoteReply(replyToken, quoteToken, `${senderName} — ${bodyText}`);
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
  detectedDocType: DocumentType;
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
     * 'delivery_order': ใบส่งของหรือใบส่งสินค้าทั่วไปที่ไม่ได้จำแนกเป็นเอกสารเฉพาะด้านล่าง
     * 'weighbridge': ตั๋วชั่งน้ำหนักต้นทางจากร้านค้าหรือโรงโม่
     * 'dest_weighbridge': ตั๋วชั่งน้ำหนักปลายทางของไซต์งานเรา (เพื่อนำมาชนกับ DO)
     * 'concrete': ใบส่งคอนกรีตผสมเสร็จ
     * 'tax_invoice': ใบเสร็จรับเงิน / ใบกำกับภาษี
     * 'purchase_order': ใบสั่งซื้อสินค้า (PO)
     * 'full_logistics': เอกสารโลจิสติกส์ที่มีข้อมูลชั่งต้นทางและปลายทางครบในแผ่นเดียว
   - กฎเหล็กการอ่านเลขที่เอกสาร (PO / DO / ใบเสร็จ):
     * กรณีเอกสารมีทั้ง "เล่มที่ (Book No. / Vol.)" และ "เลขที่ (No.)" แยกกันบนหัวบิล ให้สกัดและจัดเก็บเป็นรูปแบบ 'เล่มที่/เลขที่' เสมอ (เช่น บนบิลพิมพ์ 'เล่มที่ 02 เลขที่ 0045' ให้บันทึกเป็น '02/0045' พร้อมระบุเล่มที่ใน bookNo)
     * กรณีไม่มีเล่มที่ ให้อ่านตามที่ปรากฏตรงๆ
   - กฎเหล็กน้ำหนักชั่งรถบรรทุก (Gross / Tare / Net):
     * GrossWeightKg = น้ำหนักหนัก / รถรวมสินค้า (ค่าที่มากกว่าเสมอ แม้บิลโรงโม่ต้นทางพิมพ์ว่าน้ำหนักออก)
     * TareWeightKg = น้ำหนักเบา / รถเปล่า (ค่าที่น้อยกว่าเสมอ แม้บิลโรงโม่ต้นทางพิมพ์ว่าน้ำหนักเข้า)
     * NetWeightKg = GrossWeightKg - TareWeightKg
   - จัดหมวดหมู่วัสดุ (category) ตามมาตรฐานงานโยธา/ทล./ทช. เช่น 'หิน/ดิน/ทราย (ชั้นทาง & พื้นทาง)', 'ยางมะตอย & ผิวทางลาดยาง (ทล./ทช.)', 'คอนกรีตผสมเสร็จ & ผิวทางคอนกรีต', 'งานสะพาน & คอนกรีตอัดแรง', 'เหล็กเส้น & เหล็กโครงสร้างสะพาน/ถนน', 'งานท่อระบายน้ำ & รางระบายน้ำ', 'งานอำนวยความปลอดภัย & จราจร (ทล./ทช.)', 'งานป้องกันการกัดเซาะ & กำแพงกันดิน', 'ปูนซีเมนต์ & เคมีภัณฑ์ก่อสร้าง', 'ไม้แบบ นั่งร้าน & วัสดุสิ้นเปลือง', 'เครื่องจักรกลหนัก & น้ำมันเชื้อเพลิง', 'งานขนส่ง & โลจิสติกส์', 'ระบบไฟฟ้า & ประปาสนาม', หรือ 'วัสดุก่อสร้างทั่วไป'
   - ห้ามเดาชื่อโครงการ (col2) จากชื่อกลุ่ม LINE เด็ดขาด และแยกข้อความหมายเหตุออกจากชื่อสินค้าหลักเสมอ`;

  const { data: raw } = await requestOcrWithSharedPolicy(ai, {
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
            enum: OCR_DOCUMENT_TYPES
          },
          bookNo: { type: Type.STRING, description: 'เล่มที่ของบิล (ถ้ามี)' },
          docNumber: { type: Type.STRING, description: 'เลขที่เอกสารหลักบนหัวบิล (เลข DO / เลขตั๋วชั่ง / เลขใบเสร็จ / เลข PO)' },
          destBookNo: { type: Type.STRING, description: 'เล่มที่ของตั๋วชั่งปลายทาง หากแยกจากเอกสารหลัก' },
          destDocNumber: { type: Type.STRING, description: 'เลขที่ตั๋วชั่งปลายทาง' },
          destDocDate: { type: Type.STRING, description: 'วันที่ชั่งปลายทาง YYYY-MM-DD' },
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
          DestGrossWeightKg: { type: Type.NUMBER, description: 'น้ำหนัก Gross ปลายทาง กก.' },
          DestTareWeightKg: { type: Type.NUMBER, description: 'น้ำหนัก Tare ปลายทาง กก.' },
          DestNetWeightKg: { type: Type.NUMBER, description: 'น้ำหนัก Net ปลายทาง กก.' },
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

  const detectedDocType = normalizeOcrDocumentType(raw.docType);
  const formattedDocNo = normalizeOcrDocumentNumber(raw.docNumber, raw.bookNo);
  const formattedDestDocNo = normalizeOcrDocumentNumber(raw.destDocNumber, raw.destBookNo);

  const rawBook = (raw.bookNo || '')
    .toString()
    .replace(/^(?:เล่มที่|เล่ม|book\s*no\.?|book|vol\.?)\s*[:#.]?\s*/i, '')
    .trim();

  const { gross: grossKg, tare: tareKg, net: netKg } = normalizeOcrWeightPair(
    raw.GrossWeightKg,
    raw.TareWeightKg,
    raw.NetWeightKg
  );
  const { gross: destGrossKg, tare: destTareKg, net: destNetKg } = normalizeOcrWeightPair(
    raw.DestGrossWeightKg,
    raw.DestTareWeightKg,
    raw.DestNetWeightKg
  );

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
    rawDestDocNo: formattedDestDocNo,
    rawDestDate: (raw.destDocDate || '').toString().trim(),
    rawDestGrossWeightKg: destGrossKg,
    rawDestTareWeightKg: destTareKg,
    rawDestNetWeightKg: destNetKg,
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
  const isOriginWB = detectedDocType === 'weighbridge' || detectedDocType === 'full_logistics';
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
    col13: isOriginWB ? grossKg : 0,
    col14: isOriginWB ? tareKg : 0,
    col15: isOriginWB ? netKg : 0,
    col16: isDestWB ? rawAiSnapshot.rawDate : (detectedDocType === 'full_logistics' ? rawAiSnapshot.rawDestDate : ''),
    col17: isDestWB ? formattedDocNo : (detectedDocType === 'full_logistics' ? formattedDestDocNo : ''),
    col18: isDestWB ? grossKg : (detectedDocType === 'full_logistics' ? destGrossKg : 0),
    col19: isDestWB ? tareKg : (detectedDocType === 'full_logistics' ? destTareKg : 0),
    col20: isDestWB ? netKg : (detectedDocType === 'full_logistics' ? destNetKg : 0),
    col21: detectedDocType === 'full_logistics' ? netKg - destNetKg : 0,
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
app.get('/api/line/config', async (_req: Request, res: Response) => {
  // Ensure latest config is restored from Supabase system_config (handles Render redeploys)
  await restoreConfigsFromSupabase();
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
    channelAccessToken: (typeof body.channelAccessToken === 'string' && body.channelAccessToken.trim())
      ? body.channelAccessToken.trim()
      : lineBotConfig.channelAccessToken,
    channelSecret: (typeof body.channelSecret === 'string' && body.channelSecret.trim())
      ? body.channelSecret.trim()
      : lineBotConfig.channelSecret,
    autoQuoteReply: body.autoQuoteReply !== undefined ? Boolean(body.autoQuoteReply) : lineBotConfig.autoQuoteReply,
    replyOnDuplicate: body.replyOnDuplicate !== undefined ? Boolean(body.replyOnDuplicate) : lineBotConfig.replyOnDuplicate,
    replyOnUnclearImage: body.replyOnUnclearImage !== undefined ? Boolean(body.replyOnUnclearImage) : lineBotConfig.replyOnUnclearImage,
    filterNonBillImages: body.filterNonBillImages !== undefined ? Boolean(body.filterNonBillImages) : lineBotConfig.filterNonBillImages,
    strictZeroPushQuota: true, // Always enforce 0 push quota
    allowedGroupNames: Array.isArray(body.allowedGroupNames) ? body.allowedGroupNames : lineBotConfig.allowedGroupNames
  };
  try {
    fs.writeFileSync(LINE_CONFIG_FILE_PATH, JSON.stringify(lineBotConfig, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[LINE Config] Failed to save .line_config.json', err);
  }
  persistConfigToSupabase('line_bot_config', lineBotConfig);
  return res.json({ success: true, config: lineBotConfig });
});

// 2. Poll & Acknowledge Incoming Webhook Queue for Browser localStorage Sync
// Columns for line_inbox list — EXCLUDES image_url (base64 ~500KB each) to prevent 33MB payload timeout
const LINE_INBOX_LIST_COLUMNS = 'id,received_at,line_message_id,line_quote_token,line_sender_name,line_group_name,drive_file_id,drive_file_location,drive_web_view_link,detected_doc_type,ai_confidence,status,duplicate_of_order_id,duplicate_reason,bot_replied,bot_reply_mode,bot_reply_text,extracted_data,store_suggestion,doc_number,doc_date,store_name,is_bill_document,image_hash';

app.get('/api/line/inbox', async (_req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (client) {
      // Primary: fetch from Supabase so ALL users see the SAME bills (real-time multi-user)
      // Intentionally exclude 'image_url' (base64 images) — loaded on-demand via /api/line/inbox/image/:id
      const { data, error } = await client
        .from('line_inbox')
        .select(LINE_INBOX_LIST_COLUMNS)
        .order('received_at', { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) {
        const supabaseItems = data.map(mapSupabaseToLineInbox);

        // Merge in-memory queue (items not yet persisted — these still have image in memory)
        const supabaseIds = new Set(supabaseItems.map((i: any) => i.id));
        const queueOnly = lineWebhookInboxQueue.filter(q => !supabaseIds.has(q.id));
        const merged = [...queueOnly, ...supabaseItems];

        return res.json({ success: true, items: merged });
      }
    }
    // Fallback to in-memory queue when Supabase is not configured
    return res.json({ success: true, items: lineWebhookInboxQueue });
  } catch (err: any) {
    console.warn('[GET /api/line/inbox] Error fetching from Supabase, falling back to queue:', err?.message);
    return res.json({ success: true, items: lineWebhookInboxQueue });
  }
});

// Load single bill image on-demand (GET /api/line/inbox/image/:id)
// Called only when user clicks to view/rescan a specific bill
app.get('/api/line/inbox/image/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const client = getSupabaseClient();
    if (!client) {
      // Try in-memory queue
      const qItem = lineWebhookInboxQueue.find(q => q.id === id);
      if (qItem?.image) return res.json({ success: true, image: qItem.image });
      return res.status(404).json({ success: false, error: 'ไม่พบรูปบิล' });
    }
    const { data, error } = await client
      .from('line_inbox')
      .select('id, image_url, line_message_id, drive_web_view_link')
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ success: false, error: 'ไม่พบรูปบิล' });

    // Case 1: image_url still has base64 data → return directly
    if (data.image_url && data.image_url.length > 100) {
      return res.json({
        success: true,
        image: data.image_url,
        driveWebViewLink: data.drive_web_view_link || null
      });
    }

    // Case 2: image_url is null (cleared after Drive upload) → fallback to LINE Messaging API
    if (data.line_message_id && lineBotConfig.channelAccessToken) {
      try {
        const imgResp = await fetch(
          `https://api-data.line.me/v2/bot/message/${data.line_message_id}/content`,
          { headers: { Authorization: `Bearer ${lineBotConfig.channelAccessToken}` } }
        );
        if (imgResp.ok) {
          const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
          const arrayBuf = await imgResp.arrayBuffer();
          const b64 = Buffer.from(arrayBuf).toString('base64');
          const base64Image = `data:${mimeType};base64,${b64}`;
          return res.json({
            success: true,
            image: base64Image,
            driveWebViewLink: data.drive_web_view_link || null,
            source: 'line_api'
          });
        }
      } catch (lineErr: any) {
        console.warn(`[inbox/image] LINE API fallback failed for ${data.line_message_id}:`, lineErr?.message);
      }
    }

    // Case 3: Both image_url and LINE API unavailable → try to proxy download from Google Drive
    if (data.drive_web_view_link) {
      // Extract fileId from drive link and build export URL
      const fileIdMatch = (data.drive_web_view_link as string).match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        const fileId = fileIdMatch[1];
        // Try Google Drive export URL (works for publicly shared files)
        const driveExportUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        try {
          const driveResp = await fetch(driveExportUrl, {
            headers: { 'User-Agent': 'SmartWeighAI-Server/1.0' },
            redirect: 'follow'
          });
          if (driveResp.ok) {
            const contentType = driveResp.headers.get('content-type') || 'image/jpeg';
            // Only proxy if it's actually an image (not a Drive HTML confirmation page)
            if (contentType.startsWith('image/')) {
              const arrayBuf = await driveResp.arrayBuffer();
              const b64 = Buffer.from(arrayBuf).toString('base64');
              const base64Image = `data:${contentType};base64,${b64}`;
              console.log(`[inbox/image] Proxied from Drive: fileId=${fileId}, size=${b64.length}`);
              return res.json({
                success: true,
                image: base64Image,
                driveWebViewLink: data.drive_web_view_link,
                source: 'drive_proxy'
              });
            }
          }
        } catch (driveProxyErr: any) {
          console.warn(`[inbox/image] Drive proxy failed for ${fileId}:`, driveProxyErr?.message);
        }
      }
      // Drive proxy failed — return the link for client to handle
      return res.json({
        success: false,
        image: null,
        driveWebViewLink: data.drive_web_view_link,
        driveDirectUrl: fileIdMatch ? `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}` : null,
        error: 'ไม่สามารถโหลดรูปภาพจาก Google Drive ได้โดยตรง',
        canOpenInDrive: true
      });
    }

    return res.json({ success: false, image: null, error: 'ไม่พบรูปภาพบิลนี้ในระบบ' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
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

// 2.5 Check Duplicate Bill Number at Verify Time (POST /api/line/check-duplicate)
// เรียกจาก Frontend ก่อนกด "บันทึกตรวจรับ" เพื่อป้องกันบิลซ้ำใน orders / line_inbox
app.post('/api/line/check-duplicate', async (req: Request, res: Response) => {
  try {
    const { billNo, storeName, excludeInboxId } = req.body || {};
    if (!billNo) {
      return res.json({ isDuplicate: false, matches: [] });
    }
    const client = getSupabaseClient();
    const matches: Array<{ source: string; code: string; billNo: string; vendor: string; reason: string }> = [];

    if (client) {
      // ตรวจสอบใน orders (col6 = DO No., col17 = ตั๋วชั่ง No.)
      const [ordersRes, inboxRes] = await Promise.all([
        client.from('orders').select('col1,col6,col8,col17').or(`col6.eq.${billNo},col17.eq.${billNo}`).limit(5),
        client.from('line_inbox').select('id,doc_number,store_name,status').eq('doc_number', billNo).neq('id', excludeInboxId || '').in('status', ['verified']).limit(5)
      ]);

      if (ordersRes.data) {
        for (const row of ordersRes.data) {
          const matchedNo = isServerDocMatch(row.col6, billNo) || isServerDocMatch(row.col17, billNo);
          const vendorMatch = !storeName || !row.col8 || row.col8.trim().toLowerCase() === storeName.trim().toLowerCase();
          if (matchedNo && vendorMatch) {
            matches.push({
              source: 'orders',
              code: row.col1 || '',
              billNo: row.col6 || row.col17 || billNo,
              vendor: row.col8 || storeName || '',
              reason: `เลขที่บิล ${billNo} มีบันทึกใบ DO แล้ว (${row.col1 || 'ในระบบ'})`
            });
          }
        }
      }

      if (inboxRes.data) {
        for (const row of inboxRes.data) {
          matches.push({
            source: 'line_inbox',
            code: row.id || '',
            billNo: row.doc_number || billNo,
            vendor: row.store_name || storeName || '',
            reason: `เลขที่บิล ${billNo} ถูกตรวจรับไปแล้วใน LINE Inbox (id=${row.id})`
          });
        }
      }
    }

    return res.json({ isDuplicate: matches.length > 0, matches });
  } catch (err: any) {
    console.error('[line/check-duplicate] error:', err?.message);
    return res.json({ isDuplicate: false, matches: [], error: err?.message });
  }
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
      // ID กฎ: LINE_{messageId} ตาม Blueprint — messageId ของ LINE เป็น unique key ป้องกัน duplicate อัตโนมัติ
      const inboxItem: any = {
        id: messageId ? `LINE_${messageId}` : `LINE_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
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

        // กฎใหม่: เก็บบิลไว้เสมอ ไม่ว่าจะอ่านเลขที่ได้หรือไม่
        // ถ้าอ่านไม่ได้ → status = 'scan_failed' (เก็บรูปไว้, คีย์มือหรือสแกนซ้ำภายหลังได้)
        // การเช็คบิลซ้ำจะทำตอนบันทึกตรวจรับ (Verify) เท่านั้น
        inboxItem.status = billNo ? 'pending_review' : 'scan_failed';

        const replyText = buildLineQuoteReplyText({
          isBillDocument: true,
          billNo,
          docType: analysis.detectedDocType,
          storeName,
          senderName,
          isDuplicate: false,
          scanFailed: !billNo
        });

        inboxItem.botReplyText = replyText;
        inboxItem.botReplySent = await sendLineFreeQuoteReply(replyToken, quoteToken, replyText);
        if (!billNo) {
          console.log(`[LINE Webhook] Unreadable bill saved as scan_failed (collect-first mode). messageId=${messageId}, sender=${senderName}`);
        }
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

      // Step 5: Upload to Google Drive ZONE_00 BEFORE saving to Supabase
      // Architecture rule: image MUST be in Drive, Supabase stores ONLY the Drive link
      if (base64DataUrl && inboxItem.isBillDocument !== false) {
        try {
          const driveCfg = getStoredDriveConfig();
          if (driveCfg.isEnabled && driveCfg.rootFolderId) {
            const safeInboxId = sanitizeDriveName(inboxItem.id).slice(-80);
            const dateStr = new Date(inboxItem.receivedAt).toISOString().slice(0, 10);
            const fileName = `LINE_${dateStr}_${safeInboxId}.jpg`;
            let driveResult: any = null;

            if (driveCfg.connectionMode === 'gas' && driveCfg.gasWebAppUrl) {
              driveResult = await callGasDriveApi(driveCfg.gasWebAppUrl, {
                action: 'upload',
                rootFolderId: driveCfg.rootFolderId,
                targetZone: 'zone_00',
                fileName,
                base64Image: base64DataUrl
              });
            } else {
              const driveToken = await getDriveAccessToken();
              if (driveToken) {
                const zones = await ensureStandardDriveZones(driveToken, driveCfg.rootFolderId);
                if (zones.ZONE_00) {
                  driveResult = await findDriveFileByName(driveToken, zones.ZONE_00, fileName);
                  if (!driveResult) {
                    driveResult = await uploadFileToDrive({
                      accessToken: driveToken,
                      folderId: zones.ZONE_00,
                      fileName,
                      base64Data: base64DataUrl,
                      mimeType
                    });
                  }
                }
              }
            }

            if (driveResult && (driveResult.fileId || driveResult.success)) {
              inboxItem.driveFileId = driveResult.fileId;
              inboxItem.driveFileLocation = 'zone_00';
              inboxItem.driveWebViewLink = driveResult.webViewLink;
              console.log(`[LINE Webhook] Drive upload OK: ${fileName} (${driveResult.fileId})`);
            } else {
              console.warn('[LINE Webhook] Drive upload returned no fileId — image will be pending sync');
            }
          } else {
            console.warn('[LINE Webhook] Google Drive not configured — image will NOT be stored in Drive. Please configure Drive in settings.');
          }
        } catch (driveErr) {
          console.warn('[LINE Webhook] Drive upload error (non-blocking, bill safely queued):', driveErr);
        }
      }

      // Step 6: Persist to Supabase (Drive link only, NO base64 image)
      try {
        const client = getSupabaseClient();
        if (client) {
          const { error } = await client.from('line_inbox').upsert(mapLineInboxToSupabase(inboxItem), { onConflict: 'id' });
          if (error) throw new Error(`บันทึกรายการ LINE ${inboxItem.id} ลง Supabase ไม่สำเร็จ: ${error.message}`);
        }
      } catch (dbErr) {
        console.warn('[LINE Webhook] Failed to auto-save inboxItem to Supabase line_inbox table:', dbErr);
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
    const simTimestamp = Date.now();
    // ID กฎ: LINE_SIM_{timestamp} — บ่งบอกชัดว่าเป็น simulation (ไม่มี LINE messageId จริง)
    const inboxId = `LINE_SIM_${simTimestamp}`;
    const messageId = `SIM_MSG_${simTimestamp}`;
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

      // Persist to Supabase (same as real webhook)
      try {
        const supaClient = getSupabaseClient();
        if (supaClient) {
          await supaClient.from('line_inbox').upsert(mapLineInboxToSupabase(simulatedItem as any), { onConflict: 'id' });
        }
      } catch (dbErr) {
        console.warn('[LINE Simulate] Supabase save warning:', dbErr);
      }

      // Auto-upload to Google Drive ZONE_00 (fire-and-forget)
      if (image && simulatedItem.isBillDocument) {
        setImmediate(async () => {
          try {
            const driveCfg = getStoredDriveConfig();
            if (driveCfg.isEnabled && driveCfg.rootFolderId) {
              const _extForDrive = simulatedItem.extractedData as any;
              const safeDocNo = (
                _extForDrive?.col17 ||
                _extForDrive?.col6 ||
                _extForDrive?.col4 ||
                inboxId
              ).replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
              const fileName = `LINE_SIM_${new Date().toISOString().slice(0, 10)}_${safeDocNo}.jpg`;

              let driveResult: any = null;
              if (driveCfg.connectionMode === 'gas' && driveCfg.gasWebAppUrl) {
                driveResult = await callGasDriveApi(driveCfg.gasWebAppUrl, {
                  action: 'upload',
                  rootFolderId: driveCfg.rootFolderId,
                  targetZone: 'zone_00',
                  fileName,
                  base64Image: image
                });
              } else {
                const driveToken = await getDriveAccessToken();
                if (driveToken) {
                  const zones = await ensureStandardDriveZones(driveToken, driveCfg.rootFolderId);
                  if (zones.ZONE_00) {
                    driveResult = await uploadFileToDrive({
                      accessToken: driveToken,
                      folderId: zones.ZONE_00,
                      fileName,
                      base64Data: image,
                      mimeType: mimeType || 'image/jpeg'
                    });
                  }
                }
              }

              if (driveResult?.fileId) {
                try {
                  const supaClient = getSupabaseClient();
                  if (supaClient) {
                    await supaClient.from('line_inbox').update({
                      drive_file_id: driveResult.fileId,
                      drive_file_location: 'zone_00',
                      drive_web_view_link: driveResult.webViewLink
                    }).eq('id', inboxId);
                  }
                } catch {}
                console.log(`[LINE Simulate] Drive upload OK: ${fileName} (${driveResult.fileId})`);
              }
            }
          } catch (driveErr) {
            console.warn('[LINE Simulate] Drive upload warning (non-blocking):', driveErr);
          }
        });
      }

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

function getStoredDbConfig(): ServerDbConfig & { _source?: string } {
  let fileConfig: Partial<ServerDbConfig> = {};
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const content = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      // ใช้ค่าจาก file เฉพาะ field ที่ไม่ว่างเปล่า
      if (parsed && typeof parsed === 'object') fileConfig = parsed;
    }
  } catch (err) {
    console.warn('[DB Config] Failed to read .supabase_config.json', err);
  }

  // Default Project Supabase credentials (ฝังถาวร — ไม่ต้องกรอกใหม่ทุกครั้ง)
  const DEFAULT_SUPABASE_URL         = 'https://bmytwcnjebrqpormoalh.supabase.co';
  const DEFAULT_SUPABASE_ANON_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJteXR3Y25qZWJycXBvcm1vYWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5ODU1OTksImV4cCI6MjEwNjU2MTU5OX0.4hqvunADQ6oGDos22UPKewPjniIcq_mWLNVkTv2aoHA';
  const DEFAULT_SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJteXR3Y25qZWJycXBvcm1vYWxoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDk4NTU5OSwiZXhwIjoyMTA2NTYxNTk5fQ.tnsTEIJSNkTpEN8jr4vq9Ney9Rze7dexz0zmsbzzDIE';

  // Priority: UI file config > Environment Variable > Project Default (hardcoded)
  const supabaseUrl            = (fileConfig.supabaseUrl?.trim()            || process.env.SUPABASE_URL              || DEFAULT_SUPABASE_URL).trim();
  const supabaseAnonKey        = (fileConfig.supabaseAnonKey?.trim()        || process.env.SUPABASE_ANON_KEY         || DEFAULT_SUPABASE_ANON_KEY).trim();
  const supabaseServiceRoleKey = (fileConfig.supabaseServiceRoleKey?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY).trim();
  const pgConnectionString     = (fileConfig.pgConnectionString?.trim()     || process.env.DATABASE_URL              || '').trim();

  // Detect config source for UI display and logging
  const hasFileConfig = Boolean(fileConfig.supabaseUrl?.trim() || fileConfig.supabaseAnonKey?.trim());
  const hasEnvConfig = Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_ANON_KEY);
  const configSource = hasFileConfig ? 'ui_config' : hasEnvConfig ? 'env_var' : 'none';

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    pgConnectionString,
    isEnabled: fileConfig.isEnabled !== undefined ? fileConfig.isEnabled : true,
    autoSyncIntervalMinutes: fileConfig.autoSyncIntervalMinutes || 15,
    lastTestedAt: fileConfig.lastTestedAt,
    _source: configSource
  };
}

function saveStoredDbConfig(cfg: Partial<ServerDbConfig>) {
  const current = getStoredDbConfig();
  const cleaned: Partial<ServerDbConfig> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== undefined && v !== '') {
      (cleaned as any)[k] = v;
    }
  }
  const merged: ServerDbConfig = {
    ...current,
    ...cleaned
  };
  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[DB Config] Failed to write .supabase_config.json', e);
  }
  return merged;
}

// ─── Cloud-Safe Config Persistence across Render Ephemeral Deploys ───────────
async function persistConfigToSupabase(key: string, value: any) {
  try {
    const client = getSupabaseClient();
    if (!client) return;
    await client.from('system_config').upsert({
      config_key: key,
      config_value: value,
      updated_at: new Date().toISOString()
    }, { onConflict: 'config_key' });
    console.log(`[Config Persistence] Synced '${key}' to Supabase system_config ✅`);
  } catch (err: any) {
    console.warn(`[Config Persistence] Could not sync '${key}' to Supabase:`, err?.message);
  }
}

async function restoreConfigsFromSupabase() {
  try {
    const client = getSupabaseClient();
    if (!client) return;
    const { data, error } = await client.from('system_config').select('*');
    if (error || !Array.isArray(data)) return;

    for (const row of data) {
      if (row.config_key === 'gemini_config' && row.config_value?.geminiApiKey) {
        saveSystemConfig(row.config_value);
      } else if (row.config_key === 'drive_config' && row.config_value) {
        saveStoredDriveConfig(row.config_value);
      } else if (row.config_key === 'line_bot_config' && row.config_value) {
        lineBotConfig = { ...lineBotConfig, ...row.config_value };
        try {
          fs.writeFileSync(LINE_CONFIG_FILE_PATH, JSON.stringify(lineBotConfig, null, 2), 'utf-8');
        } catch (_) {}
      }
    }
    console.log('[Config Persistence] Restored configs from Supabase system_config table ✅');
  } catch (err: any) {
    console.warn('[Config Persistence] Could not restore configs from Supabase:', err?.message);
  }
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

    // Mask sensitive values: show first 12 chars + ••• for display
    const maskSecret = (val?: string) => val ? val.substring(0, 12) + '•••••••••••••••••••••••••••' : '';
    const maskedPgConn = cfg.pgConnectionString
      ? cfg.pgConnectionString.replace(/:([^:@]+)@/, ':••••••@')
      : '';

    return res.json({
      success: true,
      config: {
        isConfigured,
        isEnabled: cfg.isEnabled,
        // แสดง source เพื่อให้ UI บอกผู้ใช้ได้ว่า config มาจากไหน
        configSource: (cfg as any)._source || 'none', // 'env_var' | 'ui_config' | 'none'
        mode: cfg.pgConnectionString
          ? 'postgres_direct'
          : cfg.supabaseUrl
          ? 'supabase_rest'
          : 'offline',
        supabaseUrl: cfg.supabaseUrl,
        // Return masked values so UI can show "configured" state
        supabaseAnonKey: maskSecret(cfg.supabaseAnonKey),
        supabaseServiceRoleKey: maskSecret(cfg.supabaseServiceRoleKey),
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
      supabaseUrl: typeof supabaseUrl === 'string' && supabaseUrl.trim() ? supabaseUrl.trim() : undefined,
      supabaseAnonKey: typeof supabaseAnonKey === 'string' && supabaseAnonKey.trim() ? supabaseAnonKey.trim() : undefined,
      supabaseServiceRoleKey:
        typeof supabaseServiceRoleKey === 'string' && supabaseServiceRoleKey.trim() ? supabaseServiceRoleKey.trim() : undefined,
      pgConnectionString:
        typeof pgConnectionString === 'string' && pgConnectionString.trim() ? pgConnectionString.trim() : undefined,
      isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : undefined,
      autoSyncIntervalMinutes:
        typeof autoSyncIntervalMinutes === 'number' ? autoSyncIntervalMinutes : undefined
    });

    setImmediate(() => {
      restoreConfigsFromSupabase().catch(() => {});
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
  const rawTargetCfg: Partial<ServerDbConfig> = req.body || {};
  const targetCfg: Partial<ServerDbConfig> = {};
  if (rawTargetCfg.supabaseUrl?.trim()) targetCfg.supabaseUrl = rawTargetCfg.supabaseUrl.trim();
  if (rawTargetCfg.supabaseAnonKey?.trim()) targetCfg.supabaseAnonKey = rawTargetCfg.supabaseAnonKey.trim();
  if (rawTargetCfg.supabaseServiceRoleKey?.trim()) targetCfg.supabaseServiceRoleKey = rawTargetCfg.supabaseServiceRoleKey.trim();
  if (rawTargetCfg.pgConnectionString?.trim()) targetCfg.pgConnectionString = rawTargetCfg.pgConnectionString.trim();
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
    const tablesCounts: Record<string, number> = {};
    const tablesErrors: Record<string, string> = {};

    const checkTable = async (tableName: string) => {
      try {
        const { count, error } = await client.from(tableName).select('id', { count: 'exact', head: true });
        if (!error) {
          tablesCounts[tableName] = count ?? 0;
          return true;
        }
        if (
          error.code === '42P01' ||
          error.message?.includes('does not exist') ||
          error.message?.includes('not found')
        ) {
          tablesErrors[tableName] = 'ไม่พบตารางในฐานข้อมูล';
          return false;
        }
        // If error is permission/RLS or column issue, table exists but access is constrained
        console.warn(`[DB Test] Table ${tableName} query notice:`, error.message);
        tablesErrors[tableName] = error.message || 'ติดสิทธิ์ RLS หรือ Permission';
        tablesCounts[tableName] = 0;
        return true;
      } catch (err: any) {
        tablesErrors[tableName] = err?.message || 'Check failed';
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
      tableCounts: tablesCounts,
      tableErrors: Object.keys(tablesErrors).length > 0 ? tablesErrors : undefined,
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

// 6. Sync All Data from Supabase Cloud to Client (Supports both GET & POST)
app.all('/api/database/sync-all', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'ยังไม่ได้เชื่อมต่อกับ Supabase Cloud'
      });
    }

    // NOTE: line_inbox intentionally excludes 'image_url' — base64 images are ~33MB total
    // Images are loaded on-demand via GET /api/line/inbox/image/:id to prevent sync-all timeout
    const LINE_INBOX_COLUMNS = 'id,received_at,line_message_id,line_quote_token,line_sender_name,line_group_name,drive_file_id,drive_file_location,drive_web_view_link,detected_doc_type,ai_confidence,status,duplicate_of_order_id,duplicate_reason,bot_replied,bot_reply_mode,bot_reply_text,extracted_data,store_suggestion,doc_number,doc_date,store_name,is_bill_document,image_hash';
    const [ordersRes, posRes, storesRes, projectsRes, billingNotesRes, lineInboxRes, usersRes, configRes] = await Promise.all([
      client.from('orders').select('*').order('created_at', { ascending: false }).limit(2000),
      client.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      client.from('stores').select('*').order('name', { ascending: true }),
      client.from('projects').select('*').order('name', { ascending: true }),
      client.from('billing_notes').select('*').order('created_at', { ascending: false }),
      client.from('line_inbox').select(LINE_INBOX_COLUMNS).order('received_at', { ascending: false }).limit(500),
      client.from('app_users').select('*').order('created_at', { ascending: true }),
      client.from('system_config').select('*')
    ]);

    // Check and log errors for each table (e.g. RLS blocking, missing column)
    const queryErrors: Record<string, string> = {};
    if (ordersRes.error) {
      console.error('[Sync-All] orders error:', ordersRes.error.message);
      queryErrors.orders = ordersRes.error.message;
    }
    if (posRes.error) {
      console.error('[Sync-All] purchase_orders error:', posRes.error.message);
      queryErrors.purchase_orders = posRes.error.message;
    }
    if (storesRes.error) {
      console.error('[Sync-All] stores error:', storesRes.error.message);
      queryErrors.stores = storesRes.error.message;
    }
    if (projectsRes.error) {
      console.error('[Sync-All] projects error:', projectsRes.error.message);
      queryErrors.projects = projectsRes.error.message;
    }
    if (billingNotesRes.error) {
      console.error('[Sync-All] billing_notes error:', billingNotesRes.error.message);
      queryErrors.billing_notes = billingNotesRes.error.message;
    }
    if (lineInboxRes.error) {
      console.error('[Sync-All] line_inbox error:', lineInboxRes.error.message);
      queryErrors.line_inbox = lineInboxRes.error.message;
    }
    if (usersRes.error) {
      console.error('[Sync-All] app_users error:', usersRes.error.message);
      queryErrors.app_users = usersRes.error.message;
    }

    const mappedOrders = (ordersRes.data || []).map(mapSupabaseToOrder);
    const mappedPOs = (posRes.data || []).map(mapSupabaseToPO);
    const mappedStores = (storesRes.data || []).map(mapSupabaseToStore);
    const mappedProjects = (projectsRes.data || []).map(mapSupabaseToProject);
    const mappedBillingNotes = (billingNotesRes.data || []).map(mapSupabaseToBillingNote);
    const mappedLineInbox = (lineInboxRes.data || []).map(mapSupabaseToLineInbox);

    let systemSettings = null;
    if (configRes.data && configRes.data.length > 0) {
      const cfgRow = configRes.data.find((c: any) => c.config_key === 'system_settings');
      if (cfgRow?.config_value) {
        systemSettings = cfgRow.config_value;
      }
    }

    return res.json({
      success: true,
      queryErrors: Object.keys(queryErrors).length > 0 ? queryErrors : undefined,
      data: {
        orders: mappedOrders,
        pos: mappedPOs,
        stores: mappedStores,
        projects: mappedProjects,
        billingNotes: mappedBillingNotes,
        lineInbox: mappedLineInbox,
        users: usersRes.data || [],
        systemSettings
      },
      counts: {
        orders: mappedOrders.length,
        pos: mappedPOs.length,
        stores: mappedStores.length,
        projects: mappedProjects.length,
        billingNotes: mappedBillingNotes.length,
        lineInbox: mappedLineInbox.length,
        users: (usersRes.data || []).length
      },
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Sync error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'เกิดข้อผิดพลาดในการซิงค์ข้อมูล' });
  }
});

// 7. Save Single Record Directly to Supabase (100% Real Database Persistence)
app.post('/api/database/save-record', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'Database not connected' });
    }

    const { table, record } = req.body;
    if (!table || !record) {
      return res.status(400).json({ success: false, error: 'Missing table or record' });
    }

    let targetTable = table;
    let dbRow: any = record;

    if (table === 'orders') dbRow = mapOrderToSupabase(record);
    else if (table === 'purchase_orders' || table === 'pos') {
      targetTable = 'purchase_orders';
      dbRow = mapPOToSupabase(record);
    } else if (table === 'stores') dbRow = mapStoreToSupabase(record);
    else if (table === 'projects') dbRow = mapProjectToSupabase(record);
    else if (table === 'line_inbox') dbRow = mapLineInboxToSupabase(record);
    else if (table === 'billing_notes') dbRow = mapBillingNoteToSupabase(record);
    else if (table === 'app_users') dbRow = record;
    else if (table === 'system_config') {
      dbRow = {
        config_key: record.config_key || 'system_settings',
        config_value: record.config_value || record,
        updated_at: new Date().toISOString()
      };
    }

    const { error } = await client.from(targetTable).upsert(dbRow, { onConflict: targetTable === 'system_config' ? 'config_key' : 'id' });
    if (error) {
      console.error(`DB Save Error on ${targetTable}:`, error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({ success: true, message: `Record saved to ${targetTable}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// 8. Delete Single Record Directly from Supabase
app.post('/api/database/delete-record', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'Database not connected' });
    }

    const { table, id } = req.body;
    if (!table || !id) {
      return res.status(400).json({ success: false, error: 'Missing table or id' });
    }

    let targetTable = table;
    if (table === 'pos') targetTable = 'purchase_orders';

    const { error } = await client.from(targetTable).delete().eq('id', id);
    if (error) {
      console.error(`DB Delete Error on ${targetTable}:`, error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({ success: true, message: `Record deleted from ${targetTable}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// 9. Batch Upsert Records to Supabase
app.post('/api/database/save-batch', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'Database not connected' });
    }

    const { table, records } = req.body;
    if (!table || !Array.isArray(records)) {
      return res.status(400).json({ success: false, error: 'Missing table or records array' });
    }

    let targetTable = table;
    let mapper: (r: any) => any = (r) => r;

    if (table === 'orders') mapper = mapOrderToSupabase;
    else if (table === 'purchase_orders' || table === 'pos') {
      targetTable = 'purchase_orders';
      mapper = mapPOToSupabase;
    } else if (table === 'stores') mapper = mapStoreToSupabase;
    else if (table === 'projects') mapper = mapProjectToSupabase;
    else if (table === 'line_inbox') mapper = mapLineInboxToSupabase;
    else if (table === 'billing_notes') mapper = mapBillingNoteToSupabase;

    const rows = records.map(mapper);
    const chunkSize = 50;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await client.from(targetTable).upsert(chunk, { onConflict: 'id' });
      if (error) throw error;
    }

    return res.json({ success: true, count: rows.length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// ============================================================================
// GOOGLE DRIVE ZERO-JUNK FILE STORAGE ENGINE (PHASE 3 & VERIFIED-ONLY MOVE RULE)
// Reference: /DATABASE_STORAGE_BLUEPRINT.md
// ============================================================================

const DRIVE_CONFIG_FILE_PATH = path.resolve(__dirname, '.google_drive_config.json');

interface ServerDriveConfig {
  rootFolderId: string;
  rootFolderName?: string;
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
    rootFolderName: fileConfig.rootFolderName || '',
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
  const cleaned: Partial<ServerDriveConfig> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== undefined && v !== '') {
      (cleaned as any)[k] = v;
    }
  }
  const merged: ServerDriveConfig = {
    ...current,
    ...cleaned
  };
  try {
    fs.writeFileSync(DRIVE_CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Drive Config] Failed to write .google_drive_config.json', e);
  }
  return merged;
}

// Helper to call Google Apps Script Web App (Zero-Junk & Verified-Only Move without Service Account)
async function callGasDriveApi(gasUrl: string, payload: any): Promise<any> {
  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
    signal: AbortSignal.timeout(45000)
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

async function findDriveFileByName(
  accessToken: string,
  folderId: string,
  fileName: string
): Promise<{ fileId: string; webViewLink?: string } | null> {
  const escapeQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = `name = '${escapeQueryValue(fileName)}' and '${escapeQueryValue(folderId)}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    pageSize: '1',
    fields: 'files(id,name,webViewLink)'
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Google Drive file lookup failed (${response.status}): ${await response.text()}`);
  }
  const result = await response.json() as { files?: Array<{ id?: string; webViewLink?: string }> };
  const existingFile = result.files?.[0];
  return existingFile?.id
    ? { fileId: existingFile.id, webViewLink: existingFile.webViewLink }
    : null;
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
app.get('/api/drive/config', async (req: Request, res: Response) => {
  // Ensure latest config is restored from Supabase system_config (handles Render redeploys)
  await restoreConfigsFromSupabase();
  const cfg = getStoredDriveConfig();
  // isConfigured: gasWebAppUrl alone (GAS mode) is enough — rootFolderId may be configured later
  const isConfigured = Boolean(
    cfg.gasWebAppUrl ||
    (cfg.rootFolderId && (cfg.serviceAccountEmail || cfg.directAccessToken || cfg.refreshToken))
  );
  res.json({
    success: true,
    config: {
      isConfigured,
      isConnected: startupStatus.drive === 'ok',
      lastTestedStatus: startupStatus.drive,
      lastTestedMessage: startupStatus.driveMessage,
      isEnabled: cfg.isEnabled,
      connectionMode: cfg.connectionMode || (cfg.gasWebAppUrl ? 'gas' : 'service_account'),
      gasWebAppUrl: cfg.gasWebAppUrl || null,
      hasGas: Boolean(cfg.gasWebAppUrl),
      rootFolderId: cfg.rootFolderId,
      rootFolderName: cfg.rootFolderName || null,
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

    // Persist to Supabase so it survives Render redeploys
    persistConfigToSupabase('drive_config', saved);

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

      const updated = saveStoredDriveConfig({
        rootFolderId: effectiveRootFolderId,
        gasWebAppUrl: effectiveGasUrl,
        connectionMode: 'gas',
        lastTestedAt: new Date().toISOString()
      });
      persistConfigToSupabase('drive_config', updated);

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
    const updated = saveStoredDriveConfig({ lastTestedAt: new Date().toISOString() });
    persistConfigToSupabase('drive_config', updated);

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

// 6. Rename + Move File Atomically (POST /api/drive/rename-and-move)
// ใช้ตอน verify บิลจาก LINE inbox เพื่อตั้งชื่อตามประเภท/วันที่/เลขที่เอกสาร แล้วย้ายไป Zone ที่ถูกต้อง
app.post('/api/drive/rename-and-move', async (req: Request, res: Response) => {
  try {
    const token = await getDriveAccessToken();
    const cfg = getStoredDriveConfig();
    const isGasMode = Boolean(cfg.connectionMode === 'gas' || (!token && cfg.gasWebAppUrl) || (cfg.isEnabled && cfg.gasWebAppUrl && !token));

    if (!token && !isGasMode) {
      return res.status(400).json({ success: false, error: 'Google Drive ยังไม่ได้เชื่อมต่อ' });
    }

    const {
      fileId,
      docType = 'delivery_order',
      docDate = '',  // วันที่ในเอกสาร (YYYY-MM-DD)
      docNumber = '' // เลขที่เอกสาร เช่น DO-01-0045, WB-0012
    } = req.body;

    if (!fileId) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ fileId ของไฟล์ที่ต้องการเปลี่ยนชื่อ' });
    }

    // --- Build new filename and target zone from docType ---
    const safeDate   = sanitizeDriveName(docDate || new Date().toISOString().slice(0, 10));
    const safeDocNo  = sanitizeDriveName(docNumber || 'NEW');

    let prefix: string;
    let targetZone: string;

    switch (docType) {
      case 'purchase_order':
        prefix     = 'PO';
        targetZone = 'zone_01';
        break;
      case 'dest_weighbridge':
        prefix     = 'WB';
        targetZone = 'zone_03';
        break;
      case 'tax_invoice':
        prefix     = 'INV';
        targetZone = 'zone_04';
        break;
      default: // delivery_order
        prefix     = 'DO';
        targetZone = 'zone_02';
    }

    const newFileName = `${prefix}_${safeDate}_${safeDocNo}.jpg`;

    // A) GAS Mode
    if (isGasMode && cfg.gasWebAppUrl) {
      const gasResult = await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'rename_and_move',
        rootFolderId: cfg.rootFolderId,
        fileId,
        newFileName,
        targetZone
      });

      if (!gasResult || !gasResult.success) {
        throw new Error(gasResult?.error || 'เปลี่ยนชื่อไฟล์ผ่าน Google Apps Script ขัดข้อง');
      }

      return res.json({
        success: true,
        fileId: gasResult.fileId || fileId,
        newFileName,
        targetZone,
        message: `เปลี่ยนชื่อเป็น "${newFileName}" และย้ายไป ${targetZone} สำเร็จ (GAS)`
      });
    }

    // B) Service Account Flow
    if (!token) {
      return res.status(400).json({ success: false, error: 'ไม่พบ Token เชื่อมต่อ Google Drive' });
    }

    const zones = await ensureStandardDriveZones(token, cfg.rootFolderId);
    const zoneMapping: Record<string, string> = {
      zone_01: zones.ZONE_01,
      zone_02: zones.ZONE_02,
      zone_03: zones.ZONE_03,
      zone_04: zones.ZONE_04
    };
    const toFolderId = zoneMapping[targetZone] || zones.ZONE_02;

    // 1. Rename via PATCH
    const renameResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: newFileName })
    });
    if (!renameResp.ok) {
      const errText = await renameResp.text();
      throw new Error(`Rename failed: ${errText}`);
    }
    const renamedData: any = await renameResp.json();

    // 2. Move: remove from zone_00, add to target zone
    const fromFolderId = zones.ZONE_00;
    await moveDriveFile(token, fileId, fromFolderId, toFolderId);

    return res.json({
      success: true,
      fileId,
      newFileName: renamedData.name,
      targetZone,
      message: `เปลี่ยนชื่อเป็น "${newFileName}" และย้ายไป ${targetZone} สำเร็จ`
    });

  } catch (err: any) {
    console.error('[Drive Rename+Move Error]', err);
    res.status(500).json({ success: false, error: err?.message || 'เปลี่ยนชื่อหรือย้ายไฟล์บน Google Drive ขัดข้อง' });
  }
});

// 7. Zero-Junk Cleanup Endpoint (POST /api/drive/cleanup-file)
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

async function getDriveLinkedFileIds(
  client: any,
  tables: string[] = ['line_inbox', 'orders', 'purchase_orders']
): Promise<Map<string, string[]>> {
  const linkedFileIds = new Map<string, string[]>();
  for (const table of tables) {
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client
        .from(table)
        .select('drive_file_id')
        .not('drive_file_id', 'is', null)
        .range(offset, offset + pageSize - 1);
      if (error) {
        throw new Error(`ตรวจรายการเชื่อมโยง Drive ใน ${table} ไม่สำเร็จ: ${error.message}`);
      }
      for (const row of data || []) {
        if (row.drive_file_id) {
          const fileId = String(row.drive_file_id);
          const sources = linkedFileIds.get(fileId) || [];
          if (!sources.includes(table)) sources.push(table);
          linkedFileIds.set(fileId, sources);
        }
      }
      if (!data || data.length < pageSize) break;
    }
  }
  return linkedFileIds;
}

app.post('/api/drive/audit-line-inbox', async (_req: Request, res: Response) => {
  try {
    const cfg = getStoredDriveConfig();
    if (!cfg.isEnabled || !cfg.rootFolderId) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Google Drive กรุณาตั้งค่าก่อน' });
    }
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่าก่อน' });
    }

    const linkedFileIds = await getDriveLinkedFileIds(client);
    const lineRows: Array<{
      id: string;
      status?: string;
      drive_file_id?: string;
      drive_file_location?: string;
      received_at?: string;
      doc_number?: string;
      store_name?: string;
    }> = [];
    const linePageSize = 500;
    for (let offset = 0; ; offset += linePageSize) {
      const { data, error } = await client
        .from('line_inbox')
        .select('id,status,drive_file_id,drive_file_location,received_at,doc_number,store_name')
        .order('id', { ascending: true })
        .range(offset, offset + linePageSize - 1);
      if (error) throw new Error(`อ่านรายการกล่องพัก LINE ไม่สำเร็จ: ${error.message}`);
      lineRows.push(...(data || []));
      if (!data || data.length < linePageSize) break;
    }

    let files: Array<{ id: string; name: string; mimeType?: string; createdTime?: string; webViewLink?: string }> = [];
    const driveToken = cfg.connectionMode === 'gas' ? null : await getDriveAccessToken();
    const isGasMode = cfg.connectionMode === 'gas' || (!driveToken && Boolean(cfg.gasWebAppUrl));

    if (isGasMode && cfg.gasWebAppUrl) {
      const result = await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'list_zone_files',
        rootFolderId: cfg.rootFolderId
      });
      if (!result?.success) {
        throw new Error(result?.error || 'อ่านรายการไฟล์จาก Google Apps Script ไม่สำเร็จ');
      }
      if (result.hasMore) {
        throw new Error('โฟลเดอร์มีไฟล์เกินขีดจำกัดที่อ่านได้ กรุณาตรวจสอบก่อนย้ายไฟล์');
      }
      files = Array.isArray(result.files) ? result.files : [];
    } else {
      if (!driveToken) {
        return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลเชื่อมต่อ Google Drive' });
      }
      const zones = await ensureStandardDriveZones(driveToken, cfg.rootFolderId);
      const zone00Id = zones.ZONE_00;
      if (!zone00Id) throw new Error('ไม่พบโฟลเดอร์ 00_กล่องพักบิล_LINE_รอตรวจรับ');

      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: `'${zone00Id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
          pageSize: '1000',
          fields: 'nextPageToken,files(id,name,mimeType,createdTime,webViewLink)'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
          headers: { Authorization: 'Bearer ' + driveToken }
        });
        if (!response.ok) {
          throw new Error(`อ่านไฟล์ในโฟลเดอร์ Drive ไม่สำเร็จ (${response.status}): ${await response.text()}`);
        }
        const page = await response.json() as {
          nextPageToken?: string;
          files?: Array<{ id?: string; name?: string; mimeType?: string; createdTime?: string; webViewLink?: string }>;
        };
        files.push(...(page.files || []).filter(file => file.id && file.name).map(file => ({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType,
          createdTime: file.createdTime,
          webViewLink: file.webViewLink
        })));
        pageToken = page.nextPageToken;
        if (files.length > 5000) {
          throw new Error('โฟลเดอร์มีไฟล์เกิน 5,000 รายการ ระบบหยุดตรวจเพื่อป้องกันการทำงานเกินขอบเขต');
        }
      } while (pageToken);
    }

    const lineRowsByFileId = new Map<string, typeof lineRows>();
    for (const row of lineRows) {
      if (!row.drive_file_id) continue;
      const references = lineRowsByFileId.get(row.drive_file_id) || [];
      references.push(row);
      lineRowsByFileId.set(row.drive_file_id, references);
    }

    const zone00FileIds = new Set(files.map(file => file.id));
    const linkedFiles = files
      .filter(file => linkedFileIds.has(file.id))
      .map(file => ({
        ...file,
        linkedIn: linkedFileIds.get(file.id) || [],
        lineInboxItems: (lineRowsByFileId.get(file.id) || []).map(row => ({
          id: row.id,
          status: row.status,
          docNumber: row.doc_number,
          storeName: row.store_name
        }))
      }));
    const orphanFiles = files.filter(file => !linkedFileIds.has(file.id));
    const filesNotMatchedToLine = files
      .filter(file => !lineRowsByFileId.has(file.id))
      .map(file => ({ ...file, linkedIn: linkedFileIds.get(file.id) || [] }));
    const lineRowsWithoutDriveId = lineRows.filter(row => !row.drive_file_id);
    const lineRowsWithFileOutsideZone00 = lineRows.filter(row =>
      row.status !== 'verified' &&
      row.drive_file_id &&
      (!row.drive_file_location || row.drive_file_location === 'zone_00') &&
      !zone00FileIds.has(row.drive_file_id)
    );
    const verifiedRowsStillInZone00 = lineRows.filter(row =>
      row.status === 'verified' && row.drive_file_id && zone00FileIds.has(row.drive_file_id)
    );
    const duplicateLineReferences = Array.from(lineRowsByFileId.entries())
      .filter(([, references]) => references.length > 1)
      .map(([fileId, references]) => ({
        fileId,
        lineInboxCount: references.length,
        lineInboxIds: references.map(row => row.id),
        status: references.map(row => row.status || 'unknown')
      }));
    return res.json({
      success: true,
      scannedAt: new Date().toISOString(),
      zone00Count: files.length,
      lineInboxCount: lineRows.length,
      lineInboxWithDriveIdCount: lineRows.filter(row => row.drive_file_id).length,
      lineInboxUniqueDriveFileCount: lineRowsByFileId.size,
      lineInboxWithoutDriveIdCount: lineRowsWithoutDriveId.length,
      zone00MatchedToLineCount: files.length - filesNotMatchedToLine.length,
      zone00NotMatchedToLineCount: filesNotMatchedToLine.length,
      zone00LinkedToOtherDocumentsCount: filesNotMatchedToLine.filter(file => file.linkedIn.length > 0).length,
      orphanCount: orphanFiles.length,
      duplicateLineReferenceCount: duplicateLineReferences.length,
      lineRowsWithFileOutsideZone00Count: lineRowsWithFileOutsideZone00.length,
      verifiedRowsStillInZone00Count: verifiedRowsStillInZone00.length,
      linkedFiles,
      orphanFiles,
      filesNotMatchedToLine,
      lineRowsWithoutDriveId,
      duplicateLineReferences,
      lineRowsWithFileOutsideZone00,
      verifiedRowsStillInZone00,
      message: 'จับคู่ไฟล์ในโฟลเดอร์ 00 กับ line_inbox ด้วย drive_file_id โดยตรง; แยกไฟล์ที่อ้างอิงโดย orders/PO และไฟล์ที่ไม่มีการอ้างอิงก่อนเสนอให้กักกัน'
    });
  } catch (err: any) {
    console.error('[Drive Inbox Audit] Failed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'ตรวจสอบรายการไฟล์ Drive ไม่สำเร็จ' });
  }
});

app.post('/api/drive/quarantine-line-inbox-orphan', async (req: Request, res: Response) => {
  try {
    const fileId = typeof req.body?.fileId === 'string' ? req.body.fileId.trim() : '';
    if (!fileId) return res.status(400).json({ success: false, error: 'กรุณาระบุ fileId' });

    const cfg = getStoredDriveConfig();
    if (!cfg.isEnabled || !cfg.rootFolderId) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Google Drive กรุณาตั้งค่าก่อน' });
    }
    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่าก่อน' });
    }
    const linkedFileIds = await getDriveLinkedFileIds(client);
    if (linkedFileIds.has(fileId)) {
      return res.status(409).json({ success: false, error: 'ไฟล์นี้ถูกเชื่อมโยงกับข้อมูลในระบบแล้ว จึงไม่ย้ายไปกักกัน' });
    }

    const driveToken = cfg.connectionMode === 'gas' ? null : await getDriveAccessToken();
    const isGasMode = cfg.connectionMode === 'gas' || (!driveToken && Boolean(cfg.gasWebAppUrl));
    if (isGasMode && cfg.gasWebAppUrl) {
      const result = await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'quarantine_inbox_file',
        rootFolderId: cfg.rootFolderId,
        fileId
      });
      if (!result?.success) {
        throw new Error(result?.error || 'ย้ายไฟล์ไปถังกักกันผ่าน Google Apps Script ไม่สำเร็จ');
      }
      return res.json({ success: true, fileId, message: 'ย้ายไฟล์ไปโฟลเดอร์ 99_ถังขยะ_รอทำลาย_30วันแล้ว' });
    }

    if (!driveToken) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลเชื่อมต่อ Google Drive' });
    }
    const zones = await ensureStandardDriveZones(driveToken, cfg.rootFolderId);
    const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents,trashed`, {
      headers: { Authorization: 'Bearer ' + driveToken }
    });
    if (!metadataResponse.ok) {
      throw new Error(`ตรวจสอบไฟล์ก่อนย้ายไม่สำเร็จ (${metadataResponse.status}): ${await metadataResponse.text()}`);
    }
    const metadata = await metadataResponse.json() as { id: string; name?: string; parents?: string[]; trashed?: boolean };
    if (metadata.trashed || !metadata.parents?.includes(zones.ZONE_00)) {
      return res.status(409).json({ success: false, error: 'ไฟล์ไม่ได้อยู่ในโฟลเดอร์ 00 แล้ว จึงไม่ย้ายไปกักกัน' });
    }
    await moveDriveFile(driveToken, fileId, zones.ZONE_00, zones.ZONE_99);
    return res.json({
      success: true,
      fileId,
      name: metadata.name,
      message: 'ย้ายไฟล์ไปโฟลเดอร์ 99_ถังขยะ_รอทำลาย_30วันแล้ว'
    });
  } catch (err: any) {
    console.error('[Drive Inbox Quarantine] Failed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'ย้ายไฟล์ไปถังกักกันไม่สำเร็จ' });
  }
});

app.post('/api/drive/quarantine-line-inbox-item', async (req: Request, res: Response) => {
  try {
    const inboxId = typeof req.body?.inboxId === 'string' ? req.body.inboxId.trim() : '';
    if (!inboxId) return res.status(400).json({ success: false, error: 'กรุณาระบุ inboxId' });

    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่าก่อน' });
    }
    const { data: inboxRow, error: inboxError } = await client
      .from('line_inbox')
      .select('drive_file_id')
      .eq('id', inboxId)
      .maybeSingle();
    if (inboxError) throw new Error(`ตรวจสอบรายการ LINE ไม่สำเร็จ: ${inboxError.message}`);
    if (!inboxRow) return res.status(404).json({ success: false, error: 'ไม่พบรายการในกล่องพัก LINE' });
    const fileId = inboxRow.drive_file_id;
    if (!fileId) return res.json({ success: true, quarantined: false, message: 'รายการนี้ไม่มีไฟล์ Drive ที่ต้องย้าย' });

    const cfg = getStoredDriveConfig();
    if (!cfg.isEnabled || !cfg.rootFolderId) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Google Drive กรุณาตั้งค่าก่อน' });
    }
    const linkedOrderIds = await getDriveLinkedFileIds(client, ['orders', 'purchase_orders']);
    if (linkedOrderIds.has(fileId)) {
      return res.json({ success: true, quarantined: false, message: 'เก็บไฟล์ไว้เพราะยังเชื่อมโยงกับเอกสารในระบบ' });
    }

    const driveToken = cfg.connectionMode === 'gas' ? null : await getDriveAccessToken();
    const isGasMode = cfg.connectionMode === 'gas' || (!driveToken && Boolean(cfg.gasWebAppUrl));
    if (isGasMode && cfg.gasWebAppUrl) {
      const result = await callGasDriveApi(cfg.gasWebAppUrl, {
        action: 'quarantine_inbox_file',
        rootFolderId: cfg.rootFolderId,
        fileId
      });
      if (!result?.success) {
        throw new Error(result?.error || 'ย้ายไฟล์ไปถังกักกันผ่าน Google Apps Script ไม่สำเร็จ');
      }
      return res.json({ success: true, quarantined: true, message: 'ย้ายรูปไปโฟลเดอร์กักกันแล้ว' });
    }

    if (!driveToken) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลเชื่อมต่อ Google Drive' });
    }
    const zones = await ensureStandardDriveZones(driveToken, cfg.rootFolderId);
    const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents,trashed`, {
      headers: { Authorization: 'Bearer ' + driveToken }
    });
    if (!metadataResponse.ok) {
      throw new Error(`ตรวจสอบไฟล์ก่อนย้ายไม่สำเร็จ (${metadataResponse.status}): ${await metadataResponse.text()}`);
    }
    const metadata = await metadataResponse.json() as { parents?: string[]; trashed?: boolean };
    if (metadata.trashed || !metadata.parents?.includes(zones.ZONE_00)) {
      return res.json({ success: true, quarantined: false, message: 'ไฟล์ไม่ได้อยู่ในโฟลเดอร์ 00 จึงไม่ย้าย' });
    }
    await moveDriveFile(driveToken, fileId, zones.ZONE_00, zones.ZONE_99);
    return res.json({ success: true, quarantined: true, message: 'ย้ายรูปไปโฟลเดอร์กักกันแล้ว' });
  } catch (err: any) {
    console.error('[LINE Inbox Delete Cleanup] Failed:', err);
    return res.status(500).json({ success: false, error: err?.message || 'เตรียมไฟล์ LINE ก่อนลบไม่สำเร็จ' });
  }
});

// 7. Sync & Rescan Inbox Images to Google Drive ZONE_00 (POST /api/drive/sync-inbox-images)
// Downloads images from Supabase or LINE API, re-scans with Gemini AI, uploads to Google Drive, and stores links in Supabase
let inboxDriveSyncInProgress = false;
app.post('/api/drive/sync-inbox-images', async (req: Request, res: Response) => {
  if (inboxDriveSyncInProgress) {
    return res.status(409).json({ success: false, error: 'กำลังซิงก์คิว LINE อยู่ กรุณารอให้รอบปัจจุบันเสร็จก่อน' });
  }
  inboxDriveSyncInProgress = true;
  try {
    const driveCfg = getStoredDriveConfig();
    if (!driveCfg.isEnabled || !driveCfg.rootFolderId) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Google Drive กรุณาตั้งค่าก่อน' });
    }

    const client = getSupabaseClient();
    if (!client) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่าก่อน' });
    }

    const batchSize = Math.min(Math.max(Number(req.body?.batchSize) || 5, 1), 10);
    const lookbackDays = req.body?.lookbackDays === undefined ? undefined : Number(req.body.lookbackDays);
    if (lookbackDays !== undefined && (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365)) {
      return res.status(400).json({ success: false, error: 'lookbackDays ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 365' });
    }
    const cursorId = typeof req.body?.cursorId === 'string' ? req.body.cursorId.trim() : '';
    if (cursorId.length > 200) {
      return res.status(400).json({ success: false, error: 'cursorId ยาวเกินกำหนด' });
    }
    const receivedAfter =
      lookbackDays === undefined ? undefined : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    // Only process inbox items that are not verified and have not yet been linked to Drive.
    let countQuery = client
      .from('line_inbox')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'verified')
      .or('drive_file_id.is.null,drive_file_id.eq.');

    if (receivedAfter) countQuery = countQuery.gte('received_at', receivedAfter);
    if (cursorId) countQuery = countQuery.gt('id', cursorId);

    const { count: totalPendingCount, error: countError } = await countQuery;
    if (countError) {
      return res.status(500).json({ success: false, error: `นับรายการคิว LINE ไม่ได้: ${countError.message}` });
    }

    // Use a stable ID cursor so failed rows are reported once per run rather than retried endlessly.
    let query = client
      .from('line_inbox')
      .select('id, image_url, detected_doc_type, doc_number, doc_date, store_name, received_at, drive_file_id, drive_web_view_link, line_message_id, line_sender_name, line_group_name, extracted_data')
      .neq('status', 'verified')
      .or('drive_file_id.is.null,drive_file_id.eq.')
      .order('id', { ascending: true })
      .limit(batchSize);

    if (receivedAfter) query = query.gte('received_at', receivedAfter);
    if (cursorId) query = query.gt('id', cursorId);

    const { data: rows, error } = await query;

    if (error) {
      return res.status(500).json({ success: false, error: `ดึงข้อมูลจาก Supabase ไม่ได้: ${error.message}` });
    }

    const pending = rows || [];
    if (pending.length === 0) {
      return res.json({
        success: true,
        uploadedCount: 0,
        aiRescanCount: 0,
        failedCount: 0,
        remainingCount: 0,
        hasMore: false,
        message: 'รูปบิลทั้งหมดเชื่อมต่อกับ Google Drive แล้ว ไม่มีรายการค้างอยู่'
      });
    }

    let uploadedCount = 0;
    let aiRescanCount = 0;
    const errors: string[] = [];
    const failedIds = new Set<string>();

    // Ensure ZONE_00 folder exists
    let zone00Id: string | undefined;
    let driveToken: string | undefined;
    if (driveCfg.connectionMode !== 'gas') {
      driveToken = await getDriveAccessToken() || undefined;
      if (driveToken) {
        const zones = await ensureStandardDriveZones(driveToken, driveCfg.rootFolderId);
        zone00Id = zones.ZONE_00;
      }
    }

    for (const row of pending) {
      try {
        let base64Image = row.image_url;
        let mimeType = 'image/jpeg';

        // If no image_url in Supabase, fetch original image directly from LINE Messaging API via line_message_id
        if ((!base64Image || base64Image.length < 50) && row.line_message_id && lineBotConfig.channelAccessToken) {
          try {
            const imgResp = await fetch(`https://api-data.line.me/v2/bot/message/${row.line_message_id}/content`, {
              headers: { Authorization: `Bearer ${lineBotConfig.channelAccessToken}` }
            });
            if (imgResp.ok) {
              mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
              const arrayBuf = await imgResp.arrayBuffer();
              const b64 = Buffer.from(arrayBuf).toString('base64');
              base64Image = `data:${mimeType};base64,${b64}`;
              console.log(`[Drive Sync] Downloaded image for message ${row.line_message_id} from LINE API ✅`);
            } else {
              console.warn(`[Drive Sync] LINE API returned ${imgResp.status} for message ${row.line_message_id}`);
            }
          } catch (dlErr: any) {
            console.warn(`[Drive Sync] Failed to download from LINE for message ${row.line_message_id}:`, dlErr?.message);
          }
        }

        if (!base64Image || base64Image.length < 50) {
          failedIds.add(row.id);
          errors.push(`บิล ${row.id}: ไม่มีไฟล์ภาพและโหลดจาก LINE ไม่สำเร็จ`);
          continue;
        }

        // Re-scan each unprocessed inbox image before storing its Drive reference.
        let updatedExtractedData = row.extracted_data || {};
        let updatedDocNo = row.doc_number;
        let updatedDocType = row.detected_doc_type || 'delivery_order';
        let updatedStore = row.store_name;
        let isBillDocument = false;
        let aiConfidence: number | undefined;

        try {
          const aiResult = await analyzeLineBillWithGemini(
            base64Image,
            mimeType,
            row.line_sender_name || '',
            row.line_group_name || ''
          );
          aiRescanCount++;
          isBillDocument = aiResult.isBillDocument;
          aiConfidence = aiResult.confidence;
          if (aiResult.isBillDocument) {
            updatedExtractedData = {
              ...updatedExtractedData,
              ...aiResult.extractedData,
              lineInboxId: row.id,
              lineSenderName: row.line_sender_name,
              lineGroupName: row.line_group_name,
              lineReceivedAt: row.received_at
            };
            updatedDocType = aiResult.detectedDocType;
            const rawDocNo =
              updatedExtractedData.col17 ||
              updatedExtractedData.col6 ||
              updatedExtractedData.col4 ||
              '';
            if (rawDocNo) updatedDocNo = rawDocNo;
            if (aiResult.storeSuggestion?.name) updatedStore = aiResult.storeSuggestion.name;
          } else {
            updatedExtractedData = {
              ...updatedExtractedData,
              nonBillReason: aiResult.nonBillReason || 'AI ตรวจพบว่าไม่ใช่เอกสารบิล',
              lineInboxId: row.id,
              lineSenderName: row.line_sender_name,
              lineGroupName: row.line_group_name,
              lineReceivedAt: row.received_at
            };
          }
        } catch (aiErr: any) {
          failedIds.add(row.id);
          errors.push(`บิล ${row.id}: สแกน AI ใหม่ไม่สำเร็จ (${aiErr?.message || 'ไม่ทราบสาเหตุ'})`);
          console.warn(`[Drive Sync] AI re-scan warning for ${row.id}:`, aiErr?.message);
        }

        // Upload to Google Drive ZONE_00
        // Use the immutable inbox ID so retries reuse the same Drive file if OCR fails.
        const safeInboxId = sanitizeDriveName(row.id).slice(-80);
        const dateStr = row.received_at ? new Date(row.received_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const fileName = `LINE_${dateStr}_${safeInboxId}.jpg`;

        let driveResult: any = null;

        if (driveCfg.connectionMode === 'gas' && driveCfg.gasWebAppUrl) {
          driveResult = await callGasDriveApi(driveCfg.gasWebAppUrl, {
            action: 'upload',
            rootFolderId: driveCfg.rootFolderId,
            targetZone: 'zone_00',
            fileName,
            base64Image
          });
        } else if (driveToken && zone00Id) {
          driveResult = await findDriveFileByName(driveToken, zone00Id, fileName);
          if (!driveResult) {
            driveResult = await uploadFileToDrive({
              accessToken: driveToken,
              folderId: zone00Id,
              fileName,
              base64Data: base64Image,
              mimeType
            });
          }
        }

        if (driveResult?.fileId) {
          if (aiConfidence === undefined) {
            failedIds.add(row.id);
            continue;
          }
          const fileId = driveResult.fileId;
          const webViewLink = driveResult.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : null);

          // Update Supabase with Drive info and clear base64 from image_url
          const { error: updateError } = await client.from('line_inbox').update({
            drive_file_id: fileId || null,
            drive_file_location: 'zone_00',
            drive_web_view_link: webViewLink,
            doc_number: updatedDocNo || null,
            detected_doc_type: updatedDocType,
            store_name: updatedStore || null,
            ...(aiConfidence !== undefined ? { ai_confidence: aiConfidence } : {}),
            is_bill_document: isBillDocument,
            ...(isBillDocument ? {} : { status: 'ignored_non_bill' }),
            extracted_data: updatedExtractedData,
            image_url: aiConfidence !== undefined ? null : base64Image
          }).eq('id', row.id);
          if (updateError) throw new Error(`บันทึกข้อมูล Drive ลง Supabase ไม่สำเร็จ: ${updateError.message}`);

          uploadedCount++;
          console.log(`[Drive Sync] Saved to Drive & updated Supabase: ${fileName} (${fileId})`);
        } else {
          failedIds.add(row.id);
          errors.push(`บิล ${row.id}: อัปโหลดขึ้น Drive ไม่สำเร็จ (${driveResult?.error || 'ไม่มี fileId จาก Drive'})`);
        }
      } catch (itemErr: any) {
        failedIds.add(row.id);
        errors.push(`บิล ${row.id}: ${itemErr?.message || 'เกิดข้อผิดพลาด'}`);
        console.warn(`[Drive Sync] Item error ${row.id}:`, itemErr?.message);
      }
    }

    const remainingCount = Math.max(0, (totalPendingCount || 0) - pending.length);
    const hasMore = pending.length === batchSize;
    const nextCursorId = pending[pending.length - 1]?.id;

    return res.json({
      success: true,
      uploadedCount,
      aiRescanCount,
      failedCount: failedIds.size,
      totalPending: totalPendingCount || pending.length,
      remainingCount,
      hasMore,
      nextCursorId,
      errors: errors.slice(0, 5),
      message: `ตรวจชุดนี้แล้ว: อัปโหลด/เชื่อม Drive ${uploadedCount} ใบ, สแกน AI ${aiRescanCount} ใบ, พบข้อผิดพลาด ${errors.length} รายการ`
    });
  } catch (err: any) {
    console.error('Drive Sync Error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'การดึงรูปและซิงก์ Drive ขัดข้อง' });
  } finally {
    inboxDriveSyncInProgress = false;
  }
});

// ============================================================================
// STARTUP AUTO-TEST: ถ้ามีการตั้งค่าไว้แล้ว ทดสอบการเชื่อมต่อทันทีตอน startup
// ============================================================================
async function runStartupSelfTest() {
  console.log('[Startup] Running self-test for configured services...');
  startupStatus.ranAt = new Date().toISOString();

  // Log config source so it's clear in Render logs where each value comes from
  const _dbCfgForLog = getStoredDbConfig() as any;
  console.log(`[Startup] Supabase config source: ${_dbCfgForLog._source}`);
  if (_dbCfgForLog._source === 'env_var') {
    console.log('[Startup] ✅ Supabase credentials loaded from Environment Variables (Render Dashboard) — ไม่หายเมื่อ redeploy');
  } else if (_dbCfgForLog._source === 'ui_config') {
    console.log('[Startup] ⚠️  Supabase credentials loaded from local file (.supabase_config.json) — จะหายเมื่อ Render redeploy! แนะนำให้ตั้งค่าเป็น Environment Variables แทน');
  } else {
    console.log('[Startup] ❌ Supabase: ยังไม่มีค่า — กรุณาตั้งค่า SUPABASE_URL, SUPABASE_ANON_KEY ใน Render Dashboard → Environment');
  }

  // --- 1. Test Supabase ---
  const dbCfg = getStoredDbConfig();
  const dbConfigured = Boolean(
    (dbCfg.supabaseUrl && (dbCfg.supabaseAnonKey || dbCfg.supabaseServiceRoleKey)) ||
    dbCfg.pgConnectionString
  );

  if (dbConfigured) {
    try {
      const supaClient = getSupabaseClient(dbCfg);
      if (supaClient) {
        const { error } = await supaClient.from('line_inbox').select('id').limit(1);
        if (!error) {
          startupStatus.supabase = 'ok';
          startupStatus.supabaseMessage = 'เชื่อมต่อ Supabase Cloud สำเร็จ ✅';
          console.log('[Startup] ✅ Supabase: เชื่อมต่อสำเร็จ');
          saveStoredDbConfig({ lastTestedAt: new Date().toISOString() });
          // Restore all cloud-persisted configs (Drive, LINE OA, Gemini) from Supabase system_config
          await restoreConfigsFromSupabase();
        } else {
          startupStatus.supabase = 'error';
          startupStatus.supabaseMessage = `เชื่อมต่อได้แต่มีข้อผิดพลาด: ${error.message}`;
          console.warn('[Startup] ⚠️  Supabase:', error.message);
        }
      }
    } catch (err: any) {
      startupStatus.supabase = 'error';
      startupStatus.supabaseMessage = err?.message || 'เชื่อมต่อ Supabase ล้มเหลว';
      console.warn('[Startup] ⚠️  Supabase self-test error:', err?.message);
    }
  } else {
    startupStatus.supabase = 'not_configured';
    startupStatus.supabaseMessage = 'ยังไม่ได้ตั้งค่า Supabase';
    console.log('[Startup] ℹ️  Supabase: ยังไม่ได้ตั้งค่า (ข้ามการทดสอบ)');
  }

  // --- 2. Test Google Drive ---
  const driveCfg = getStoredDriveConfig();
  const driveConfigured = Boolean(
    driveCfg.rootFolderId && (driveCfg.gasWebAppUrl || driveCfg.serviceAccountEmail || driveCfg.refreshToken)
  );

  if (!driveCfg.rootFolderId && (driveCfg.gasWebAppUrl || driveCfg.serviceAccountEmail)) {
    startupStatus.drive = 'error';
    startupStatus.driveMessage = 'ยังไม่ได้ระบุ Google Drive Root Folder ID';
    console.warn('[Startup] ⚠️  Google Drive: ยังไม่ได้ระบุ Root Folder ID');
  } else if (driveConfigured) {
    try {
      if (driveCfg.connectionMode === 'gas' && driveCfg.gasWebAppUrl) {
        const result = await callGasDriveApi(driveCfg.gasWebAppUrl, {
          action: 'test',
          rootFolderId: driveCfg.rootFolderId
        });
        if (result?.success) {
          startupStatus.drive = 'ok';
          startupStatus.driveMessage = `เชื่อมต่อ Google Drive (GAS) สำเร็จ${result.rootFolderName ? ` — ${result.rootFolderName}` : ''} ✅`;
          console.log('[Startup] ✅ Google Drive (GAS):', result.rootFolderName);
          saveStoredDriveConfig({
            lastTestedAt: new Date().toISOString(),
            rootFolderName: result.rootFolderName || undefined
          });
        } else {
          startupStatus.drive = 'error';
          startupStatus.driveMessage = result?.error || 'เชื่อมต่อ Drive ไม่สำเร็จ';
          console.warn('[Startup] ⚠️  Google Drive (GAS):', result?.error);
        }
      } else {
        const token = await getDriveAccessToken();
        if (token) {
          await ensureStandardDriveZones(token, driveCfg.rootFolderId);
          startupStatus.drive = 'ok';
          startupStatus.driveMessage = 'เชื่อมต่อ Google Drive (Service Account) สำเร็จ ✅';
          console.log('[Startup] ✅ Google Drive (Service Account): เชื่อมต่อสำเร็จ');
          saveStoredDriveConfig({ lastTestedAt: new Date().toISOString() });
        } else {
          startupStatus.drive = 'error';
          startupStatus.driveMessage = 'ไม่สามารถขอ Access Token ได้';
          console.warn('[Startup] ⚠️  Google Drive: ไม่สามารถขอ Access Token ได้');
        }
      }
    } catch (err: any) {
      startupStatus.drive = 'error';
      startupStatus.driveMessage = err?.message || 'เชื่อมต่อ Drive ล้มเหลว';
      console.warn('[Startup] ⚠️  Google Drive self-test error:', err?.message);
    }
  } else {
    startupStatus.drive = 'not_configured';
    startupStatus.driveMessage = 'ยังไม่ได้ตั้งค่า Google Drive';
    console.log('[Startup] ℹ️  Google Drive: ยังไม่ได้ตั้งค่า (ข้ามการทดสอบ)');
  }

  // --- 3. Check Gemini Key ---
  const geminiKey = getActiveGeminiApiKey();
  if (geminiKey && geminiKey.length > 5) {
    startupStatus.gemini = 'ok';
    startupStatus.geminiMessage = 'Gemini API Key พร้อมใช้งาน ✅';
    console.log('[Startup] ✅ Gemini API Key: พร้อมสแกนบิล');
  } else {
    startupStatus.gemini = 'not_configured';
    startupStatus.geminiMessage = 'ยังไม่ได้ตั้งค่า Gemini API Key — ระบบ AI จะยังไม่ทำงาน';
    console.warn('[Startup] ⚠️  Gemini API Key: ยังไม่ได้ตั้งค่า');
  }

  startupStatus.allReady = (
    (startupStatus.supabase === 'ok' || startupStatus.supabase === 'not_configured') &&
    (startupStatus.drive === 'ok' || startupStatus.drive === 'not_configured') &&
    startupStatus.gemini === 'ok'
  );

  console.log(`[Startup] Self-test done — Supabase:${startupStatus.supabase} Drive:${startupStatus.drive} Gemini:${startupStatus.gemini} 🚀`);
}

// GET /api/startup/status — Return startup self-test results for the Settings UI
app.get('/api/startup/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    ...startupStatus
  });
});

// POST /api/startup/retest — Re-run startup self-test on demand & return fresh status
app.post('/api/startup/retest', async (_req: Request, res: Response) => {
  try {
    await restoreConfigsFromSupabase();
    await runStartupSelfTest();
    res.json({
      success: true,
      ...startupStatus
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Retest failed' });
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
    // Run self-test after server is up (non-blocking)
    setImmediate(() => runStartupSelfTest().catch(err => console.warn('[Startup] Self-test unexpected error:', err)));
  });
}

startServer();

// ============================================================================
// DAILY AUTO SYNC: ดึงรูปจาก LINE & สแกนใหม่ & อัปโหลด Drive ทุกวันอัตโนมัติ
// ทำงานทุก 24 ชั่วโมง หลัง server เริ่มต้น (ไม่พึ่ง node-cron ใด)
// ============================================================================
async function runDailyLineInboxSync(): Promise<void> {
  const driveCfg = getStoredDriveConfig();
  const client = getSupabaseClient();
  if (!driveCfg.isEnabled || !driveCfg.rootFolderId || !client) {
    console.log('[DailySync] Skipped — Drive or Supabase not configured');
    return;
  }

  console.log('[DailySync] Starting daily LINE inbox sync...');
  let totalUploaded = 0;
  let totalAiRescan = 0;
  let totalFailed = 0;
  let cursorId: string | undefined;

  try {
    let hasMore = true;
    while (hasMore) {
      // Reuse sync-inbox-images logic via internal HTTP call to self
      const port = Number(PORT);
      const resp = await fetch(`http://localhost:${port}/api/drive/sync-inbox-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 3, batchSize: 5, cursorId })
      });
      if (resp.status === 409) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      if (!resp.ok) throw new Error(`sync-inbox-images ตอบกลับ HTTP ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'ซิงก์คิว LINE ไม่สำเร็จ');
      totalUploaded += data.uploadedCount || 0;
      totalAiRescan += data.aiRescanCount || 0;
      totalFailed += data.failedCount || 0;
      hasMore = Boolean(data.hasMore);
      if (hasMore) {
        if (!data.nextCursorId || data.nextCursorId === cursorId) {
          throw new Error('ไม่ได้รับ cursor ของชุดถัดไป จึงหยุดเพื่อป้องกันการวนซ้ำ');
        }
        cursorId = data.nextCursorId;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.log(`[DailySync] ✅ Done — Drive linked: ${totalUploaded}, AI rescanned: ${totalAiRescan}, errors: ${totalFailed}`);
  } catch (err: any) {
    console.error('[DailySync] Error:', err?.message);
  }
}

function millisecondsUntilNextBangkokSync(now = new Date()): number {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const part = (type: string) => dateParts.find(value => value.type === type)?.value || '';
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const todayAtSix = Date.UTC(year, month - 1, day, 6) - 7 * 60 * 60 * 1000;
  const nextRun = todayAtSix > now.getTime()
    ? todayAtSix
    : Date.UTC(year, month - 1, day + 1, 6) - 7 * 60 * 60 * 1000;
  return nextRun - now.getTime();
}

function scheduleNextDailyLineInboxSync(): void {
  const delay = millisecondsUntilNextBangkokSync();
  console.log(`[DailySync] Next run in ${Math.ceil(delay / 60000)} minutes (06:00 Asia/Bangkok)`);
  setTimeout(async () => {
    await runDailyLineInboxSync();
    scheduleNextDailyLineInboxSync();
  }, delay);
}

scheduleNextDailyLineInboxSync();
