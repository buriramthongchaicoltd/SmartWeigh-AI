# เอกสารแผนงานสถาปัตยกรรมฐานข้อมูลและระบบจัดเก็บไฟล์อัตโนมัติ
**(Database & Zero-Junk Cloud Storage Blueprint — Supabase + Google Drive API)**

**โครงการ:** ระบบบริหารคลังวัสดุ ตั๋วชั่ง และใบสั่งซื้ออัตโนมัติ (AutoStore & 39-Column ERP)  
**องค์กร:** บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด  
**วัตถุประสงค์ของเอกสาร:** ใช้เป็นพิมพ์เขียวอ้างอิงมาตรฐาน (Reference Architecture) สำหรับการเชื่อมต่อฐานข้อมูลจริง เพื่อให้การพัฒนาต่อยอดเป็นไปตามโครงสร้างเดียวกัน 100%

---

## 1. ภาพรวมสถาปัตยกรรม (Hybrid Cloud Architecture)

ระบบแบ่งหน้าที่การจัดเก็บออกเป็น 2 ส่วนที่ทำงานประสานกันแบบอัตโนมัติ:

| ส่วนประกอบ | เทคโนโลยีที่ใช้ | หน้าที่หลัก |
| :--- | :--- | :--- |
| **1. Core Transactional Database** | **Supabase Cloud (PostgreSQL + Realtime)** | จัดเก็บข้อมูลตาราง 39 คอลัมน์, ใบสั่งซื้อ (PO), ตั๋วชั่งปลายทาง, ใบกำกับภาษี, ทะเบียนร้านค้า, โครงการ, กล่องพัก LINE, สิทธิ์ผู้ใช้งาน และรหัสอ้างอิงไฟล์ (`drive_file_id`, `drive_folder_id`) พร้อมซิงก์หน้าจอทุกเครื่องแบบ Realtime |
| **2. File Storage & Zero-Junk Engine** | **Google Drive API (Service Account / OAuth2)** | จัดเก็บรูปถ่ายบิลและเอกสารแนบทั้งหมด แยกโฟลเดอร์ตามประเภทและเลขที่เอกสารอัตโนมัติ ย้ายไฟล์มารวมชุดเมื่อชนบิลสำเร็จ และลบไฟล์เก่า/ไฟล์ที่ถูกลบออกจากระบบทันที (Zero-Junk Cleanup) |

---

## 2. โครงสร้างโฟลเดอร์อัตโนมัติบน Google Drive (5 โซนมาตรฐาน)

ใช้ **การจัดกลุ่มตามประเภทเอกสารและเลขที่เอกสารโดยตรง (ไม่ใช้ชื่อโครงการครอบโฟลเดอร์)** เพื่อให้สามารถเปลี่ยนโครงการของบิลในตารางได้ตลอดเวลาโดยไม่เกิดปัญหาโฟลเดอร์ค้าง:

```text
📁 BRTC_ERP_Storage (โฟลเดอร์หลักของบริษัทบน Google Drive)
 │
 ├── 📁 00_กล่องพักบิล_LINE_รอตรวจรับ/
 │    └── 🖼️ LINE_<messageId>_<timestamp>.jpg      (พักรูปจาก LINE ที่ยังไม่ได้ตรวจรับ)
 │
 ├── 📁 01_ใบสั่งซื้อ_PO/
 │    └── 📁 PO-2026-001_หจก.ศิลาบุรีรัมย์/
 │         └── 🖼️ PO_PO-2026-001.jpg
 │
 ├── 📁 02_ใบงานหลัก_DO_ครบชุด/                    (โฟลเดอร์ประจำใบงาน: รวมเอกสารที่ชนคู่กันแล้ว)
 │    └── 📁 TR-2026-0001_DO-02-0045/
 │         ├── 🖼️ 1_DO_02-0045.jpg                 (รูปใบส่งของต้นทาง)
 │         ├── 🖼️ 2_WB_W-1024.jpg                  (รูปตั๋วชั่งปลายทาง -> ย้ายมาจากโฟลเดอร์ 03 อัตโนมัติเมื่อชนบิล)
 │         └── 🖼️ 3_TAX_IV-889.jpg                 (รูปใบกำกับภาษี -> ย้ายมาจากโฟลเดอร์ 04 อัตโนมัติเมื่อชนบิล)
 │
 ├── 📁 03_ตั๋วชั่งปลายทาง_รอจับคู่DO/               (พักตั๋วชั่งปลายทางที่ยังไม่มีใบ DO ต้นทางมาชน)
 │    └── 🖼️ WB_W-1025_รอชนDO.jpg
 │
 └── 📁 04_ใบเสร็จกำกับภาษี_เอกเทศ/                (เก็บใบเสร็จซื้อสดหน้าร้าน หรือใบกำกับภาษีที่ยังไม่ผูก DO)
      └── 🖼️ TAX_IV-890.jpg
```

> **กฎการตั้งชื่อโฟลเดอร์และไฟล์ (Sanitization Rule):**  
> เครื่องหมายทับ `/` หรืออักขระพิเศษในเลขที่บิล (เช่น `02/0045`) จะถูกแปลงเป็นขีดกลาง `-` อัตโนมัติ (เป็น `02-0045`) และนำหน้าด้วยเลขรหัสธุรกรรมระบบ `TR-xxxx` เสมอ เพื่อป้องกันชื่อโฟลเดอร์ซ้ำกันระหว่างคนละร้านค้า

---

## 3. กฎการทำงานอัตโนมัติและการล้างไฟล์ขยะ (Auto-Move & Zero-Junk State Machine)

ผู้ใช้งานไม่ต้องย้ายหรือลบไฟล์ใน Google Drive เอง ระบบหลังบ้าน (`server.ts`) จะจัดการผ่าน `driveFileId` และ `driveFolderId` ตามเหตุการณ์ต่อไปนี้:

| ลำดับ | เหตุการณ์ในระบบ (System Event) | การทำงานที่ฐานข้อมูล Supabase | การทำงานที่ Google Drive อัตโนมัติ (Zero-Junk & Auto-Move) |
| :---: | :--- | :--- | :--- |
| **1** | **บอท LINE รับรูปบิลใหม่จากกลุ่ม** | สร้างเรคคอร์ดใหม่ในตาราง `line_inbox` พร้อมบันทึก `drive_file_id` | อัปโหลดรูปเข้าโฟลเดอร์ `00_กล่องพักบิล_LINE_รอตรวจรับ` |
| **2** | **กดลบรายการในกล่องพักบิล LINE** | ลบเรคคอร์ดออกจากตาราง `line_inbox` | สั่งลบไฟล์ `drive_file_id` ออกจากโฟลเดอร์ `00` ทันที (**ไม่เหลือขยะค้าง**) |
| **3** | **กดยืนยันตรวจรับบิลเป็น `ใบส่งของ (DO)`** | บันทึกลงตาราง `orders` และอัปเดตสถานะใน `line_inbox` เป็น `verified` | สร้างโฟลเดอร์ใบงาน `02_ใบงานหลัก_DO_ครบชุด/TR-xxxx_DO-xxxx` แล้วย้ายไฟล์จาก `00` เข้าไปทันที |
| **4** | **กดยืนยันตรวจรับบิลเป็น `ตั๋วชั่งปลายทาง` (ยังไม่เจอ DO)** | บันทึกลงตาราง `orders` (`doc_type = 'dest_weighbridge'`) | ย้ายไฟล์ไปพักไว้ที่โฟลเดอร์ `03_ตั๋วชั่งปลายทาง_รอจับคู่DO` |
| **5** | **เมื่อ `ตั๋วชั่งปลายทาง` หรือ `ใบกำกับภาษี` จับคู่ชนกับ `DO` สำเร็จ** | อัปเดต `matched_dest_ticket_id` / `linked_via_doc_no` และซิงก์น้ำหนักช่อง 16–21 เข้าใบ DO | **ย้ายไฟล์รูปตั๋วชั่ง/ใบกำกับภาษี** จากโฟลเดอร์ `03` หรือ `04` เข้าไปรวมในโฟลเดอร์ `02_ใบงานหลัก_DO_ครบชุด/TR-xxxx` ของใบ DO คู่นั้นทันที |
| **6** | **เมื่อกดยกเลิกการจับคู่บิล (Unlink)** | ล้างค่าการผูกบิลใน Supabase | ย้ายไฟล์ตั๋วชั่งกลับไปยัง `03_ตั๋วชั่งปลายทาง_รอจับคู่DO` (หรือย้ายใบกำกับภาษีกลับไป `04`) อัตโนมัติ |
| **7** | **แก้ไขเลขที่เอกสาร (เช่น แก้เลข DO)** | อัปเดตเลขที่เอกสารใน Supabase | สั่งเปลี่ยนชื่อโฟลเดอร์เดิม (`Rename Folder`) ตาม `drive_folder_id` โดยไม่ต้องย้ายไฟล์ |
| **8** | **อัปโหลดรูปใหม่ทับรูปเดิม หรือกดลบรูปแนบในหน้าแก้ไข** | อัปเดต `drive_file_id` ตัวใหม่ใน Supabase | **สั่งลบไฟล์รูปเก่า (`old_drive_file_id`) ทิ้งออกจาก Google Drive ทันที** ก่อนผูกไฟล์ใหม่ |
| **9** | **กดลบเอกสารออกจากระบบ (Delete Order / Delete PO)** | ลบเรคคอร์ดออกจาก Supabase (พร้อมทำ Cascade Unlink) | **สั่งลบไฟล์และโฟลเดอร์ประจำใบงานนั้นออกจาก Google Drive ทันที 100%** (หากมีตั๋วชั่งที่ผูกอยู่ ระบบจะย้ายตั๋วชั่งกลับโฟลเดอร์ `03` ก่อนลบโฟลเดอร์ DO เพื่อไม่ให้ตั๋วชั่งหายโดยไม่ตั้งใจ) |

---

## 4. โครงสร้างตารางฐานข้อมูล Supabase (PostgreSQL Schema DDL)

สามารถนำชุดคำสั่ง SQL ด้านล่างนี้ไปรันใน **Supabase SQL Editor** เมื่อเริ่มขั้นตอนการเชื่อมต่อฐานข้อมูลได้ทันที:

```sql
-- 1. ตารางหลัก 39 คอลัมน์ (เก็บใบส่งของ DO, ตั๋วชั่งปลายทาง, และใบเสร็จ/กำกับภาษี)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL DEFAULT 'delivery_order', -- 'delivery_order' | 'dest_weighbridge' | 'tax_invoice'
  status TEXT NOT NULL DEFAULT 'pending',          -- 'verified' | 'pending'
  confidence NUMERIC DEFAULT 100,

  -- Google Drive Storage Tracking (สำหรับ Auto-Move & Zero-Junk Cleanup)
  image_url TEXT,
  drive_file_id TEXT,
  drive_folder_id TEXT,

  -- การผูกชนบิลข้ามประเภท (Reconciliation Links)
  linked_via_doc_no TEXT,
  matched_dest_ticket_id TEXT,

  -- ประวัติการรับบิลจาก LINE OA
  line_inbox_id TEXT,
  line_sender_name TEXT,
  line_group_name TEXT,
  line_received_at TIMESTAMPTZ,

  -- โซน 1: เอกสารอ้างอิง (ช่อง 1-6)
  col1 TEXT, -- เลข TR ระบบ
  col2 TEXT, -- ชื่อโครงการ
  col3 TEXT, -- หมวดหมู่งานโยธา 15 หมวด
  col4 TEXT, -- เลขที่ใบสั่งซื้อ (PO)
  col5 TEXT, -- เลขที่ใบรับของ (RR)
  col6 TEXT, -- เลขที่ใบส่งของ (DO)

  -- โซน 2: คู่ค้าและสินค้า (ช่อง 7-12)
  col7 TEXT, -- วันที่เอกสาร
  col8 TEXT, -- ชื่อร้านค้า/ผู้จำหน่าย
  col9 TEXT, -- ผู้รับเหมา/ผู้ซื้อ
  col10 TEXT, -- ทะเบียนรถขนส่ง
  col11 TEXT, -- รายการสินค้าหลัก
  col12 TEXT, -- สเปก/รหัสวัสดุ

  -- โซน 3: น้ำหนักต้นทาง (ช่อง 13-15)
  col13 NUMERIC DEFAULT 0, -- หนักต้นทาง (Gross กก.)
  col14 NUMERIC DEFAULT 0, -- เบาต้นทาง (Tare กก.)
  col15 NUMERIC DEFAULT 0, -- สุทธิต้นทาง (Net กก.)

  -- โซน 4: น้ำหนักปลายทาง & ผลต่าง (ช่อง 16-21)
  col16 TEXT,              -- วันที่ชั่งปลายทาง
  col17 TEXT,              -- เลขที่ตั๋วชั่งปลายทาง / เลขที่ใบกำกับภาษี
  col18 NUMERIC DEFAULT 0, -- หนักปลายทาง (Gross กก.)
  col19 NUMERIC DEFAULT 0, -- เบาปลายทาง (Tare กก.)
  col20 NUMERIC DEFAULT 0, -- สุทธิปลายทาง (Net กก.)
  col21 NUMERIC DEFAULT 0, -- ผลต่างน้ำหนัก (กก.)

  -- โซน 5: ปริมาณและราคา (ช่อง 22-29)
  col22 NUMERIC DEFAULT 0, -- ปริมาณรับสุทธิ
  col23 TEXT,              -- หน่วยนับ
  col24 NUMERIC DEFAULT 0, -- ราคาต่อหน่วย
  col25 NUMERIC DEFAULT 0, -- รวมค่าวัสดุ
  col26 TEXT,              -- ประเภทรถบรรทุก
  col27 NUMERIC DEFAULT 0, -- อัตราค่าขนส่ง/หน่วย
  col28 NUMERIC DEFAULT 0, -- รวมค่าขนส่ง
  col29 NUMERIC DEFAULT 0, -- รวมเป็นเงินสุทธิทั้งสิ้น (บาท)

  -- โซน 6: การชำระเงิน (ช่อง 30-36)
  col30 TEXT,              -- รูปแบบการชำระเงิน
  col31 NUMERIC DEFAULT 0, -- จ่ายค่าสินค้าแล้ว
  col32 NUMERIC DEFAULT 0, -- ค้างจ่ายค่าสินค้า
  col33 NUMERIC DEFAULT 0, -- จ่ายค่าขนส่งแล้ว
  col34 NUMERIC DEFAULT 0, -- ค้างจ่ายค่าขนส่ง
  col35 NUMERIC DEFAULT 0, -- ชำระแล้วรวมทั้งสิ้น (บาท)
  col36 NUMERIC DEFAULT 0, -- ยอดค้างชำระรวม (บาท)

  -- โซน 7: สถานที่และหมายเหตุ (ช่อง 37-38)
  col37 TEXT,              -- สถานที่จัดส่ง / กม.
  col38 TEXT,              -- หมายเหตุ

  -- รายการสินค้าย่อย (กรณีบิลมีหลายบรรทัด)
  items JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ตารางใบสั่งซื้อ (Purchase Orders - PO)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL,
  project_name TEXT,
  supplier_name TEXT,
  issue_date TEXT,
  expected_date TEXT,
  status TEXT DEFAULT 'open',
  total_amount NUMERIC DEFAULT 0,
  notes TEXT,
  image_url TEXT,
  drive_file_id TEXT,
  drive_folder_id TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  linked_order_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ตารางกล่องพักบิลจาก LINE (LINE OA Bill Inbox)
CREATE TABLE IF NOT EXISTS public.line_inbox (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  line_message_id TEXT,
  line_quote_token TEXT,
  line_sender_name TEXT,
  line_group_name TEXT,
  image_url TEXT,
  drive_file_id TEXT,
  detected_doc_type TEXT DEFAULT 'delivery_order',
  ai_confidence NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending_review',
  duplicate_of_order_id TEXT,
  duplicate_reason TEXT,
  bot_replied BOOLEAN DEFAULT FALSE,
  bot_reply_mode TEXT DEFAULT 'reply_quote_free',
  bot_reply_text TEXT,
  extracted_data JSONB DEFAULT '{}'::jsonb,
  store_suggestion JSONB
);

-- 4. ตารางทะเบียนร้านค้า (Stores / Suppliers)
CREATE TABLE IF NOT EXISTS public.stores (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  tax_id TEXT,
  category TEXT,
  contact_name TEXT,
  phone TEXT,
  address TEXT,
  credit_days INTEGER DEFAULT 30,
  credit_limit NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ตารางทะเบียนโครงการก่อสร้าง (Projects)
CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  location TEXT,
  manager_name TEXT,
  budget NUMERIC DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ตารางผู้ใช้งานและตั้งค่าระบบ (Users & System Settings)
CREATE TABLE IF NOT EXISTS public.app_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  department TEXT,
  phone TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_config (
  config_key TEXT PRIMARY KEY,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. ตารางชุดรับวางบิลฝ่ายจัดซื้อ & เชื่อมต่อ Express (Purchasing Billing Notes & Express RR)
CREATE TABLE IF NOT EXISTS public.billing_notes (
  id TEXT PRIMARY KEY,                          -- เช่น BN-202603-001
  supplier_name TEXT NOT NULL,
  supplier_code TEXT,
  supplier_invoice_no TEXT,                     -- เลขที่ใบวางบิล/ใบแจ้งหนี้ของ Supplier
  billing_date TEXT NOT NULL,
  due_date TEXT,                                -- คำนวณจากเครดิตเทอมร้านค้า
  weight_basis TEXT DEFAULT 'dest',             -- 'origin' (col15) | 'dest' (col20) | 'min' (MIN(col15,col20))
  billing_scope TEXT DEFAULT 'both',            -- 'material_only' (col25) | 'transport_only' (col28) | 'both' (col29)
  vat_mode TEXT DEFAULT 'exclude_7',            -- 'exclude_7' | 'include_7' | 'none'
  subtotal_amount NUMERIC DEFAULT 0,
  vat_amount NUMERIC DEFAULT 0,
  rounding_adjustment NUMERIC DEFAULT 0,        -- ปรับเศษสตางค์ให้ตรงใบแจ้งหนี้ Supplier
  net_total_amount NUMERIC DEFAULT 0,
  express_rr_number TEXT,                       -- เลขที่ RR จากโปรแกรม Express (เมื่อบันทึกจะ Auto-Stamp ลง col5 ของ DO ทุกใบ)
  status TEXT DEFAULT 'draft',                  -- 'draft' | 'exported_express' | 'rr_stamped_billed' | 'paid'
  order_ids JSONB DEFAULT '[]'::jsonb,          -- รายการ ID ของใบ DO ในชุดวางบิลนี้
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. รายการค่าติดตั้ง (Environment Variables) ที่ต้องใช้เมื่อเริ่มเชื่อมต่อจริง

เมื่อพร้อมเริ่มเชื่อมต่อฐานข้อมูลจริง ให้เตรียมค่าตัวแปรเหล่านี้ในระบบเซิร์ฟเวอร์ (`.env`):

1. **สำหรับ Supabase Cloud:**
   - `VITE_SUPABASE_URL` — URL ของโปรเจกต์ Supabase
   - `VITE_SUPABASE_ANON_KEY` — กุญแจสำหรับฝั่งหน้าเว็บ (Realtime & Read/Write)
   - `SUPABASE_SERVICE_ROLE_KEY` — กุญแจสำหรับฝั่ง `server.ts` (เพื่อให้ LINE Webhook บันทึกข้อมูลเข้าฐานข้อมูลได้โดยตรง)
2. **สำหรับ Google Drive API (Zero-Junk Storage):**
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — รหัสโฟลเดอร์หลักบน Google Drive ที่แชร์สิทธิ์ให้ระบบแล้ว
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (หรือ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) — สำหรับให้เซิร์ฟเวอร์สร้างโฟลเดอร์ ย้ายไฟล์ และสั่งลบไฟล์ขยะอัตโนมัติได้ตลอด 24 ชม.
