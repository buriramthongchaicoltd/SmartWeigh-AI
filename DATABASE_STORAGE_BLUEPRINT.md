# เอกสารแผนงานสถาปัตยกรรมฐานข้อมูลและระบบจัดเก็บไฟล์อัตโนมัติ
**(Database & Zero-Junk Cloud Storage Blueprint — Supabase + Google Drive API)**

**โครงการ:** ระบบบริหารคลังวัสดุ ตั๋วชั่ง และใบสั่งซื้ออัตโนมัติ (AutoStore & 39-Column ERP)  
**องค์กร:** บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด  
**วัตถุประสงค์ของเอกสาร:** ใช้เป็นพิมพ์เขียวอ้างอิง (Reference Architecture) สำหรับโครงสร้างฐานข้อมูลและจัดเก็บไฟล์; รายละเอียดการทำงานจริงต้องยืนยันกับโค้ดและสถานะบริการ ไม่ถือว่าการระบุไว้ในแผนหมายถึงได้เปิดใช้งานหรือทดสอบครบถ้วน

---

## 1. ภาพรวมสถาปัตยกรรม (Hybrid Cloud Architecture)

ระบบแบ่งหน้าที่การจัดเก็บออกเป็น 2 ส่วนที่ทำงานประสานกันแบบอัตโนมัติ:

| ส่วนประกอบ | เทคโนโลยีที่ใช้ | หน้าที่หลัก |
| :--- | :--- | :--- |
| **1. Core Transactional Database** | **Supabase Cloud (PostgreSQL)** | จัดเก็บข้อมูลตาราง 39 คอลัมน์, ใบสั่งซื้อ (PO), ตั๋วชั่งปลายทาง, ใบกำกับภาษี, ทะเบียนร้านค้า, โครงการ, กล่องพัก LINE, สิทธิ์ผู้ใช้งาน, เอกสารแนบหักผู้รับเหมา และรหัสอ้างอิงไฟล์ (`drive_file_id`, `drive_folder_id`); วิธี refresh/sync หน้าจอแตกต่างตาม feature โดย LINE Inbox ใช้ API polling ทุก 8 วินาที ไม่ใช่ Supabase Realtime subscription |
| **2. File Storage & Zero-Junk Engine** | **Google Drive API (Apps Script Web App / Service Account)** | จัดเก็บรูปถ่ายบิลและเอกสารแนบ แยกโฟลเดอร์ตามประเภทและเลขที่เอกสารอัตโนมัติ และย้ายไฟล์ตามสถานะการตรวจรับ/จับคู่; การนำไฟล์ไปถังขยะและการบันทึกฐานข้อมูลเป็นคนละขั้นตอน ไม่ใช่ transaction เดียว |

### สถานะและข้อจำกัดด้านความปลอดภัยหลังทวนโค้ด
- `.supabase_config.json` ที่เคยถูก track ถูกนำออกแล้ว; service-role credential และ `DATABASE_URL` อ่านจาก runtime environment เท่านั้น. เนื่องจาก credential เดิมยังอยู่ใน Git history ให้ถือว่า compromised และเพิกถอน/หมุนก่อนใช้งานต่อ; อย่าคัดลอก secret ลงเอกสารหรือ log
- `getSupabaseClient()` ใช้ `SUPABASE_SERVICE_ROLE_KEY` จาก runtime environment เท่านั้น; ไม่ใช้ anon key สำหรับ backend เพราะ DDL ถอนสิทธิ์ `PUBLIC`, `anon`, `authenticated` และให้ `service_role` เท่านั้น. ตั้ง Project URL และ service-role key ใน Render Environment; ห้ามใส่ secret ใน browser/Git. ต้องนำ DDL ไป execute ใน Supabase SQL Editor ด้วยตนเอง; source change ไม่ปรับ cloud database อัตโนมัติ. หน้าตั้งค่าตรวจ 10 ตาราง โดยใช้ namespace `auth_session:` ภายใน `system_config` เก็บ hash ของ session แทนการเพิ่มตารางใหม่ พร้อม 2 ตารางเอกสารแนบหักผู้รับเหมา
- เมื่อเปิดเว็บไซต์ การตรวจบริการเริ่มทำงานตั้งแต่หน้าเข้าสู่ระบบ โดยเช็คฐานข้อมูลและ 10 ตาราง, Google Drive, Gemini API และ LINE Token; ระบบแชร์ผลตรวจล่าสุดภายใน 60 วินาทีเพื่อลดการเรียกบริการซ้ำ. การตรวจ LINE ยืนยัน Token เท่านั้น ไม่ได้ยืนยัน webhook delivery หรือการรับบิลจริง
- API ที่ไม่ใช่ health/login/LINE webhook บังคับ server session. การเขียน/ลบข้อมูลและไฟล์ถูกจำกัดตาม role ที่ backend; role `user` จำกัดตารางที่เขียนได้และไม่สามารถแก้ไขฟิลด์ราคา/การเงิน/การชำระเงินที่ถูกป้องกันผ่าน API. UI ไม่ใช่ security boundary
- Login ใช้บัญชี `app_users`, password hash scrypt และ HttpOnly/SameSite session cookie อายุ 8 ชั่วโมง; เก็บเฉพาะ SHA-256 ของ token ใน `system_config` โดยใช้ key prefix `auth_session:` เพื่อให้ทุก Render instance ตรวจ session ร่วมกันและเพิกถอนข้าม instance ได้ โดยอ่าน role/status ปัจจุบันจาก `app_users` ทุกครั้งที่ตรวจ session. ไม่ต้องสร้างตารางหรือเพิ่ม DDL สำหรับ session; session ใน memory เดิมจะใช้ต่อไม่ได้หลังปล่อยรุ่นนี้ ผู้ใช้ต้อง login ใหม่. บัญชีที่ยังไม่เปลี่ยนรหัสผ่านจะแสดงหน้าต่างเปลี่ยนรหัสครั้งแรก; ข้ามได้เฉพาะ session นั้นและระบบจะแจ้งอีกครั้งเมื่อเข้าระบบใหม่จนกว่าจะเปลี่ยนสำเร็จ. รหัสใหม่ต้องมีอย่างน้อย 12 ตัวอักษร. สถานะเก็บใน `app_users.first_password_change_completed`; ต้องรัน DDL รุ่นล่าสุดเพื่อเพิ่มคอลัมน์นี้. Master Admin ใหม่ต้อง bootstrap ด้วย `SYSTEM_MASTER_ADMIN_PASSWORD` ความยาวอย่างน้อย 16 ตัวอักษร; บัญชีเดิมที่ยังใช้ `@Admin` สามารถล็อกอินได้ ส่วน `123456` ถูกปฏิเสธ และ runtime secret ใช้หมุนรหัส Master เดิมได้
- GAS ต้องมี secret อย่างน้อย 32 ตัวอักษรตรงกับ Script Property `SMARTWEIGH_SHARED_SECRET`; Admin สร้างและคัดลอก secret จากหน้าตั้งค่าได้ โดยระบบเก็บค่าเข้ารหัสใน `system_config` และใช้ service-role key/`DATABASE_URL` ที่ server เพื่อเข้ารหัส. หากหมุน database credential ต้องสร้าง GAS secret ใหม่และอัปเดต Script Property เพราะค่าเดิมถอดรหัสไม่ได้. รองรับ `GOOGLE_APPS_SCRIPT_SHARED_SECRET` ใน Environment เป็น override เดิม แต่ไม่จำเป็นสำหรับการตั้งค่าใหม่. ต้อง deploy `google_apps_script_drive.gs` รุ่นล่าสุดเพื่อให้ endpoint ปฏิเสธ request ที่ไม่มี secret
- การเปลี่ยนแปลงนี้ไม่ได้หมุน key, รัน DDL, deploy GAS หรือทดสอบ production จริง. ผู้ดูแลต้องทำขั้นตอนภายนอกและตรวจ service logs หลัง deploy

---

## 1.1 กติกา OCR, การจับคู่ และการตรวจเอกสารซ้ำ

- ค่าที่ OCR อ่านไม่ชัด เช่น เลขเอกสาร วันที่ น้ำหนัก และยอดเงิน ต้องเว้นว่าง/ให้ผู้ตรวจทาน ไม่แทนด้วยวันที่ปัจจุบัน จำนวนเริ่มต้น หรือยอดที่คำนวณขึ้นเอง
- การจำแนกประเภทต้องอ่านชื่อหัวเอกสาร/ข้อความที่พิมพ์บนภาพก่อน (`documentTitle`, `docTypeEvidence`) แล้วเทียบกับคำอธิบายประเภท; น้ำหนัก Gross/Tare/Net หรือชนิดสินค้าเพียงอย่างเดียวไม่ใช่หลักฐานพอให้เลือก `weighbridge`. เก็บคะแนนโมเดล `docTypeConfidence` ซึ่งอาจมีสัญญาณจากค่าตั้งค่าบริษัทประกอบ และแสดงหลักฐานแก่ผู้ตรวจในขั้นยืนยัน; คะแนนนี้ยังไม่ใช่ค่าความแม่นยำที่ผ่านการสอบเทียบ
- OCR หน้าเว็บและ LINE อาจใช้ `companyName`/`companyAddress` จาก `system_config.system_settings` เป็นหลักฐานเสริม โดยพิจารณาร่วมกับบทบาทที่พิมพ์กำกับ; ชื่อ/ที่อยู่ที่ตรงกันลำพังไม่ชี้ขาดและห้ามแทนหลักฐานภาพ. หากอ่านหลักฐานภาพไม่พบ จะไม่นำค่าตั้งค่าไปเขียนเป็น `documentTitle` หรือ `docTypeEvidence`
- ตารางหลักจัดกลุ่มตั๋วชั่งต้นทางไว้ใต้ DO โดยใช้ `matched_origin_do_id` ก่อน; สำหรับข้อมูลเดิมที่ไม่มีความสัมพันธ์ดังกล่าว ใช้ TR เดียวกันเป็น fallback เฉพาะเมื่อมี DO ที่ตรง TR เพียงรายการเดียว. หากพบหลาย DO ใน TR เดียวกันจะไม่ซ่อนตั๋วโดยเดา; records เอกสารยังคงแยกในฐานข้อมูล
- เมื่อตรวจรับตั๋วชั่งปลายทางที่อ้างเลขตั๋วต้นทาง ระบบ resolve เลขอ้างอิงไปยัง record ตั๋วต้นทางใบใดก็ได้ที่เกี่ยวข้อง แล้วตาม `matched_origin_do_id` หรือ `linked_via_doc_no` ไปหา DO; ตั๋วต้นทางหลายใบที่ชี้ DO เดียวกันจะรวมเป็นเป้าหมาย DO เดียว. fallback ด้วย TR ทำเฉพาะเมื่อมี DO ตรงเพียงรายการเดียว. ตั๋วปลายทางยังคงเป็น record แยกและผูกโซน 4 ด้วย `matched_dest_ticket_id`
- สำหรับ PO ให้แยกชื่อผู้ขาย (Vendor) ออกจากผู้ซื้อ/บริษัทผู้ออกเอกสาร (Buyer/Issuer); ถ้าหลักฐานผู้ขายไม่ชัดให้เว้นชื่อผู้ขาย ไม่ใช้ชื่อบริษัทบนหัวกระดาษแทน
- การผูก PO/DO/ตั๋วชั่งอาศัยเลขอ้างอิงตรงจากช่องเอกสารหรือหมายเหตุเท่านั้น ไม่ใช้ชื่อร้าน วันที่ รถ น้ำหนัก เลข TR ภายในระบบ หรือข้อมูลอื่นเป็นเกณฑ์จับคู่ ตัวตรวจยอมรับช่องว่างและ prefix ที่ไม่มี/ตรงกัน แต่คงตัวคั่น เลขศูนย์นำหน้า และปฏิเสธ prefix ประเภทเอกสารที่ระบุชัดแต่ขัดกัน
- การตัดสินว่าเอกสารซ้ำให้ผู้ใช้ตรวจเทียบภาพและข้อมูลด้วยตนเอง; ระบบไม่ติดป้าย/แจ้งเตือนซ้ำในกล่องพัก LINE, Verify หรือหน้าตาราง 39 คอลัมน์
- ค่าดิบ OCR เทียบกับค่าที่ผู้ตรวจยืนยันและรายการฟิลด์ที่แก้ เก็บใน JSONB `line_inbox.extracted_data.reviewFeedbackHistory`; ใช้ schema เดิม ไม่มีการเพิ่มตารางหรือคอลัมน์จากแนวทางนี้

---

## 2. โครงสร้างโฟลเดอร์อัตโนมัติบน Google Drive (5 โซนมาตรฐาน)

ใช้ **การจัดกลุ่มตามประเภทเอกสารและเลขที่เอกสารโดยตรง (ไม่ใช้ชื่อโครงการครอบโฟลเดอร์)** เพื่อให้สามารถเปลี่ยนโครงการของบิลในตารางได้ตลอดเวลาโดยไม่เกิดปัญหาโฟลเดอร์ค้าง:

```text
📁 BRTC_ERP_Storage (โฟลเดอร์หลักของบริษัทบน Google Drive)
 │
 ├── 📁 00_กล่องพักบิล_LINE_รอตรวจรับ/
 │    └── 🖼️ LINE_<received-date>_<line-inbox-id>.jpg (พักรูปจาก LINE ที่ยังไม่ได้ตรวจรับ; ใช้ ID คงที่เพื่อกันอัปโหลดซ้ำ)
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
 ├── 📁 04_ใบเสร็จกำกับภาษี_เอกเทศ/                (เก็บใบเสร็จซื้อสดหน้าร้าน หรือใบกำกับภาษีที่ยังไม่ผูก DO)
      └── 🖼️ TAX_IV-890.jpg
 │
 └── 📁 99_ถังขยะ_รอทำลาย_30วัน/ (กักกันไฟล์ที่ผู้ใช้เลือก ไม่ลบถาวรอัตโนมัติ)
```

> **กฎการตั้งชื่อโฟลเดอร์และไฟล์ (Sanitization Rule):**  
> เครื่องหมายทับ `/` หรืออักขระพิเศษในเลขที่บิล (เช่น `02/0045`) จะถูกแปลงเป็นขีดกลาง `-` อัตโนมัติ (เป็น `02-0045`) และนำหน้าด้วยเลขรหัสธุรกรรมระบบ `TR-xxxx` เสมอ เพื่อป้องกันชื่อโฟลเดอร์ซ้ำกันระหว่างคนละร้านค้า
>
> **การสร้างและใช้โฟลเดอร์ TR ในการทำงานจริง:** เมื่อตรวจรับ DO (`delivery_order`, `concrete`, `full_logistics`) ระบบต้องสร้างหรือใช้โฟลเดอร์ `<col1>_DO-<col6>` (เช่น `TR-2026-0001_DO-02-0045`) ใต้โซน 02 แล้วจึงย้ายรูป DO เข้าไป; หากเลือกตั๋วชั่งต้นทางมาคู่กับ DO ตอนตรวจรับ รูปตั๋วต้นทางต้องเข้าซับโฟลเดอร์ TR/DO เดียวกันด้วย. Google Apps Script และ Service Account ใช้ชื่อโฟลเดอร์เดียวกัน. ตั๋วชั่งปลายทางที่ยังไม่ยืนยันการจับคู่คงอยู่โซน 03; หลังผู้ใช้ยืนยันจึงย้ายเข้าซับโฟลเดอร์ TR/DO ของ DO ที่จับคู่. ห้ามย้ายเอกสาร DO เข้าโซน 02 แบบวางตรงในโฟลเดอร์หลัก.
>
> รูปใบกำกับภาษีในตัวอย่างโฟลเดอร์เป็นเป้าหมายการจัดเก็บ; โค้ดปัจจุบันยังเชื่อมข้อมูลกับ DO โดยไม่ย้ายรูปจากโซน 04 จนกว่าจะเพิ่มและทดสอบ verified-move สำหรับใบกำกับภาษี

---

## 3. กฎการทำงานอัตโนมัติและการล้างไฟล์ขยะ (Auto-Move & Zero-Junk State Machine)

ผู้ใช้งานไม่ต้องย้ายหรือลบไฟล์ใน Google Drive เอง ระบบหลังบ้าน (`server.ts`) จะจัดการผ่าน `driveFileId` และ `driveFolderId` ตามเหตุการณ์ต่อไปนี้:

| ลำดับ | เหตุการณ์ในระบบ (System Event) | การทำงานที่ฐานข้อมูล Supabase | การทำงานที่ Google Drive อัตโนมัติ (Zero-Junk & Auto-Move) |
| :---: | :--- | :--- | :--- |
| **1** | **บอท LINE รับรูปบิลใหม่จากกลุ่ม** | ตรวจ signature และบันทึกแถวสถานะ `queued` ใน `line_inbox` ก่อนตอบ HTTP 200; หลัง ACK จึงทำ OCR และอัปโหลดไฟล์ โดยบันทึก `drive_file_id` เมื่อ upload สำเร็จ. ตรวจบิลซ้ำด้วยประเภทเอกสาร + เลขที่เอกสาร + ชื่อร้าน; ถ้าตรงกันให้เก็บแถวไว้และบันทึกเหตุผลเพื่อแสดงป้าย “อาจซ้ำ” | พยายามอัปโหลดรูปเข้าโฟลเดอร์ `00_กล่องพักบิล_LINE_รอตรวจรับ`; หาก process หยุดหรือ upload ล้มเหลว แถวคิวยังคงอยู่เพื่อ manual/daily recovery |
| **1.1** | **จัดสรรและตรวจเลข TR สำหรับ DO เท่านั้น** | เอกสาร `delivery_order`, `concrete`, `full_logistics` อ่านเลขสูงสุดจาก `orders.col1` ใน Supabase จริงและเสนอเลขถัดไป; ก่อนตรวจรับ `VerifyModal` ตรวจ `col1` ซ้ำกับ Supabase. เอกสารประเภทอื่นไม่ขอเลข TR และใช้เลขเอกสารของตนในช่องเฉพาะ เช่น ตั๋วชั่งต้นทาง `col6` และตั๋วชั่งปลายทาง `col17`. การลบ `orders` หยุด timer และรอ batch upsert ที่เริ่มไปแล้วก่อนลบ เพื่อป้องกัน snapshot เก่าเขียนแถวกลับ | ไม่เกี่ยวข้อง |
| **2** | **ตรวจรับหรือลบรายการซ้ำในกล่องพักบิล LINE** | ก่อนตรวจรับให้ตรวจฐานข้อมูลซ้ำอีกครั้งด้วยเกณฑ์สามค่าเดิม; ผู้ใช้เลือกยืนยันการลบรายการปัจจุบันพร้อมรูป หรือยกเลิกการยืนยันซ้ำเพื่อบันทึกตรวจรับต่อ. การลบข้อมูลเกิดหลัง Drive API ตอบว่าสำเร็จ; หาก Drive API ล้มเหลวจะไม่ลบ row | เมื่อตรวจรับ DO ระบบสร้าง/ใช้ `<col1>_DO-<col6>` ใต้โซน 02 แล้วเปลี่ยนชื่อและย้ายรูป DO เข้าโฟลเดอร์นั้น; ตั๋วชั่งต้นทางที่ผู้ใช้เลือกแนบกับ DO จะถูกย้ายเข้าโฟลเดอร์เดียวกัน. การลบรายการซ้ำยังนำไฟล์ที่เชื่อมกับ Inbox ไปถังขยะก่อน แล้วจึงลบ row ใน Supabase; ขั้นตอน Drive trash และ Supabase delete แยกกัน จึงอาจเหลือ row หาก DB delete ล้มเหลวหลัง Drive สำเร็จ |
| **2.1** | **ผู้ใช้เลือกจับคู่ตั๋วชั่งต้นทางจาก LINE กับ DO** | ทำได้ทั้งตอนตรวจรับ DO (เลือกตั๋วชั่งที่ยังพักอยู่), จากหน้าตั๋วชั่งเพื่อเปิด DO ที่ยังรอตรวจพร้อมแนบตั๋วชั่ง, และหลัง DO บันทึกแล้ว (เลือก DO ที่บันทึกอยู่); รายการ orders โหลดแบบแบ่งหน้าจนครบ และตัวเลือกแสดงเอกสารที่มีเลข DO (`col6`) โดยรวมชนิดเอกสาร DO และข้อมูลเก่าที่ไม่มีชนิดระบุไว้ พร้อมค้นหาด้วยเลข DO/ร้านค้า/TR/โครงการ. ยกเว้นตั๋วชั่งต้นทาง/ปลายทาง, ใบกำกับ และ PO เพื่อไม่ให้เอกสารที่ไม่ใช่ DO ถูกเลือก. กรณี DO ยังรอตรวจ ระบบเปิดแบบฟอร์มตรวจรับตามปกติและยังไม่บันทึกคู่จนกว่าผู้ใช้ยืนยัน. เมื่อบันทึกแล้ว ตั๋วชั่งเป็น `orders` แยกและผูกกับ DO ที่เลือกด้วย `orders.matched_origin_do_id` โดยไม่จับคู่อัตโนมัติจากชื่อร้าน/เวลา; แถวตั๋วชั่งใหม่ไม่คัดลอกเลข TR จาก DO. ตอนตรวจรับ DO จะเติมน้ำหนักต้นทางจากตั๋วที่เลือกลงแบบฟอร์มเพื่อตรวจทาน; การจับคู่ย้อนหลังเติมช่อง 13–15 เฉพาะเมื่อ DO ยังไม่มีน้ำหนักเดิม. ตารางหลัก 39 คอลัมน์แสดงเป็นหนึ่งแถวต่อ DO โดยไม่แสดงตั๋วชั่งต้นทางที่จับคู่แล้วเป็นแถวซ้ำ; แสดงเลขตั๋วเป็นรายการย่อยที่คลิกเปิด record จริงได้. แถวในเมนูเฉพาะตั๋วชั่งปลายทางคงไว้สำหรับตรวจสอบ/จัดการเอกสาร. เอกสารที่จับคู่ยังคงเป็น records แยกในฐานข้อมูลและตั๋วชั่งที่มีความสัมพันธ์ `matched_origin_do_id` ไม่นับซ้ำเป็น DO ในยอดการเงิน/ปริมาณหรือรายการที่เลือกทำชุดวางบิล; เมื่อลบ DO จะล้างความสัมพันธ์และคงตั๋วชั่งเป็นเอกสารเดี่ยว | ย้ายรูปตั๋วชั่งไปโซน `02_ใบงานหลัก_DO_ครบชุด`; คงรูปและข้อมูลตั๋วชั่งเป็นเอกสารแยกสำหรับตรวจสอบย้อนกลับ |
| **3** | **กดยืนยันตรวจรับบิลเป็น `ใบส่งของ (DO)`** | ย้ายไฟล์ให้สำเร็จก่อน แล้วปรับ local Order/Inbox state; การ sync ไป `orders`/`line_inbox` ใช้ debounced DB sync ไม่ใช่การบันทึก transaction แบบ synchronous | สร้างโฟลเดอร์ใบงาน `02_ใบงานหลัก_DO_ครบชุด/TR-xxxx_DO-xxxx` แล้วย้ายไฟล์จาก `00` เข้าไปก่อนบันทึก state |
| **3.1** | **กดยืนยันตรวจรับรายการ LINE เป็น `ใบสั่งซื้อ (PO)`** | ย้ายไฟล์จาก `00` ไป `01` ให้สำเร็จก่อน; จากนั้นบันทึก `purchase_orders` พร้อม `drive_file_id` แล้วเปลี่ยน `line_inbox.status` เป็น `verified` ในฐานข้อมูลก่อนปิดหน้าตรวจรับ | หากไม่มี Drive ID, ย้ายไฟล์ไม่สำเร็จ, หรือบันทึก PO/สถานะคิวไม่สำเร็จ จะไม่ถือว่าการตรวจรับสำเร็จ; หากบันทึก PO แล้วอัปเดต Inbox ไม่ได้ ระบบพยายามย้อน PO และแจ้งข้อผิดพลาด |
| **4** | **กดยืนยันตรวจรับบิลเป็น `ตั๋วชั่งปลายทาง` (ยังไม่เจอ DO)** | ย้ายไฟล์ก่อน แล้วปรับ local Order/Inbox state ซึ่ง sync ไป `orders`/`line_inbox` แบบ debounced (`doc_type = 'dest_weighbridge'`) | ย้ายไฟล์ไปพักไว้ที่โฟลเดอร์ `03_ตั๋วชั่งปลายทาง_รอจับคู่DO` |
| **5** | **เมื่อ `ตั๋วชั่งปลายทาง` จับคู่ชนกับ `DO` และผู้ใช้ยืนยัน** | อัปเดต `matched_dest_ticket_id` / `linked_via_doc_no` และซิงก์น้ำหนักช่อง 16–21 เข้าใบ DO | **ย้ายรูปตั๋วชั่งปลายทาง** จากโฟลเดอร์ `03` เข้า `02_ใบงานหลัก_DO_ครบชุด/<col1>_DO-<col6>` ของ DO ที่จับคู่; การชน `ใบกำกับภาษี` ในปัจจุบันอัปเดตความสัมพันธ์/ข้อมูลในฐานข้อมูล แต่ยังไม่ย้ายรูปจากโฟลเดอร์ `04` เข้าโฟลเดอร์ DO |
| **6** | **เมื่อกดยกเลิกการจับคู่บิล (Unlink)** | ล้างค่าการผูกบิลใน Supabase | ย้ายไฟล์ตั๋วชั่งกลับไปยัง `03_ตั๋วชั่งปลายทาง_รอจับคู่DO` (หรือย้ายใบกำกับภาษีกลับไป `04`) อัตโนมัติ |
| **7** | **แก้ไขเลขที่เอกสาร (เช่น แก้เลข DO)** | อัปเดตเลขที่เอกสารใน Supabase | สั่งเปลี่ยนชื่อโฟลเดอร์เดิม (`Rename Folder`) ตาม `drive_folder_id` โดยไม่ต้องย้ายไฟล์ |
| **8** | **อัปโหลดรูปใหม่ทับรูปเดิม หรือกดลบรูปแนบในหน้าแก้ไข** | อัปเดต `drive_file_id` ตัวใหม่ใน Supabase | **สั่งลบไฟล์รูปเก่า (`old_drive_file_id`) ทิ้งออกจาก Google Drive ทันที** ก่อนผูกไฟล์ใหม่ |
| **9** | **กดลบเอกสารออกจากระบบ (Delete Order / Delete PO)** | ลบเรคคอร์ดออกจาก Supabase (พร้อมทำ Cascade Unlink) | **สั่งลบไฟล์และโฟลเดอร์ประจำใบงานนั้นออกจาก Google Drive ทันที 100%** (หากมีตั๋วชั่งที่ผูกอยู่ ระบบจะย้ายตั๋วชั่งกลับโฟลเดอร์ `03` ก่อนลบโฟลเดอร์ DO เพื่อไม่ให้ตั๋วชั่งหายโดยไม่ตั้งใจ) |
| **10** | **ตรวจสอบไฟล์ในกล่องพัก LINE** | อ่านรายการ `line_inbox` พร้อม `drive_file_id` และอ่าน references จาก `orders`, `purchase_orders` โดยไม่แก้ข้อมูล | จับคู่ไฟล์ในโฟลเดอร์ `00` กับ `line_inbox.drive_file_id` โดยตรง; รายงานแถว LINE ไม่มี Drive ID, การอ้าง Drive ID ซ้ำ, ไฟล์ใน `00` ที่ไม่ตรง LINE, แถว LINE ที่อ้างไฟล์ไม่พบใน `00` และ verified ที่ยังค้างใน `00`; แยกไฟล์ no-LINE ที่ Order/PO ยังอ้างอิงออกจาก orphan ที่ไม่มี reference ทุกตาราง; เฉพาะ orphan ให้ผู้ใช้เลือกย้ายไป `99` เอง ไม่ลบอัตโนมัติ |

**LINE Inbox Drive Sync reconciliation:** สำหรับ LINE row ที่ยังไม่มี `drive_file_id` ระบบค้นหาเฉพาะชื่อไฟล์ที่สร้างจาก LINE inbox ID เดียวกันเพื่อทำ retry แบบ idempotent; ไม่ค้นหรือผูกไฟล์ orphan จากการเทียบ image hash เพราะไม่ยืนยันว่าไฟล์นั้นสัมพันธ์กับรายการ LINE ใด ก่อน reuse `drive_file_id` ที่มีอยู่จะตรวจว่าไม่มี LINE row อื่นอ้าง ID เดียวกัน; หากพบการอ้างซ้ำและยังเข้าถึงภาพต้นฉบับได้ จะสร้างไฟล์เฉพาะรายการนั้นแทน ไฟล์ที่ไม่มีการจับคู่คงเป็น orphan เพื่อให้ผู้ใช้ตรวจ audit แยกต่างหาก

**LINE Webhook durable acceptance:** Webhook ตรวจ `x-line-signature` ด้วย raw request body และต้องมี Channel Secret ก่อนประมวลผลรูปภาพทุกครั้ง ระบบ insert/upsert แถวสถานะ `queued` ใน `line_inbox` ก่อนตอบ HTTP 200 โดยใช้ `LINE_{messageId}` และ `ON CONFLICT DO NOTHING` เพื่อให้ LINE retry หลัง timeout ได้โดยไม่เขียนซ้ำ; หาก Supabase ยังไม่รับแถว ระบบตอบ HTTP 503 แทน success. หลัง ACK จึงดาวน์โหลดรูป, วิเคราะห์ AI, อัปโหลด Drive, ตอบด้วย LINE Reply API และอัปเดตแถวเดิม. หาก process หยุดหลัง durable acceptance แถวที่ยังไม่มี Drive ID/OCR จะเข้า flow Daily/Manual LINE Inbox Drive Sync; ภาพต้นฉบับยังขึ้นกับ LINE retention จนกว่าจะอัปโหลด Drive สำเร็จ. Reply token ไม่ได้เก็บถาวรและใช้ซ้ำไม่ได้; สถานะการตอบกลับล้มเหลวถูกบันทึกใน `extracted_data` และแสดงบนกล่องพัก แต่ไม่สามารถรับประกันการ retry ข้อความหลัง token หมดอายุ.

**LINE verification save gate:** เมื่อผู้ใช้ยืนยันเอกสารจาก LINE Inbox ระบบต้องมี `drive_file_id` และ Drive API ต้องยืนยันว่าไฟล์อยู่ในโซนปลายทางก่อนเขียนรายการธุรกิจ. สำหรับ PO ระบบบันทึก `purchase_orders` และอัปเดตแถว `line_inbox` เป็น `verified` แบบ synchronous ผ่าน API; หากการอัปเดต Inbox ล้มเหลว ระบบพยายามย้อนการเขียน PO และคงหน้าตรวจรับไว้. สำหรับ DO/ตั๋วชั่ง/เอกสารที่เก็บใน `orders` การย้าย Drive เกิดก่อน แต่การเปลี่ยน Order/Inbox state ถูก sync จาก local state แบบ debounced จึงไม่มีการยืนยัน DB แบบ synchronous หรือ rollback ที่เทียบเท่า PO. การย้าย Drive กับการเขียนฐานข้อมูลไม่ใช่ distributed transaction; หาก DB ล้มเหลวหลังย้ายไฟล์ ไฟล์อาจย้ายแล้วแต่ไม่มีระเบียนธุรกิจ โดยรายการ LINE ยังคงตรวจรับซ้ำได้ และ endpoint ย้ายไฟล์รองรับการเรียกซ้ำเมื่อไฟล์อยู่โซนเป้าหมายแล้ว.

**LINE Inbox list/image behavior:** `GET /api/line/inbox` เลือกข้อมูลล่าสุดสูงสุด 500 แถวและไม่ดึง `image_url` เพื่อป้องกัน payload Base64 ขนาดใหญ่; UI refreshes ด้วย polling ทุก 8 วินาที ไม่ใช่ Supabase Realtime subscription. รูปโหลดแยกเมื่อดู/สแกน และ UI เตรียมภาพตัวอย่างของรายการที่กรองอยู่พร้อมกันไม่เกิน 3 รายการ. `mapLineInboxToSupabase` ปัจจุบันตั้ง `image_url` เป็น `null`; ต้นฉบับควรอยู่ใน Google Drive เมื่อ upload สำเร็จ หรือดึงจาก LINE ได้ชั่วคราวภายใน retention window. Manual sync ตรวจรายการค้างทั้งหมดเป็น batch (UI ส่ง batch size 5; API รองรับได้สูงสุด 10) ส่วน daily recovery ทำงานเวลา 06:00 Asia/Bangkok ใน server process และตรวจย้อนหลัง 3 วัน จึงเป็น best-effort ไม่ใช่ external cron. ปุ่ม AI rescan ใช้ภาพในรายการก่อน จากนั้นขอภาพจาก LINE endpoint และ fallback ไป authenticated Drive image proxy โดยใช้ `drive_file_id` หรือรหัสที่ดึงจาก `drive_web_view_link`.

**LINE Inbox deletion:** เมื่อลบ row `line_inbox` ระบบนำไฟล์ใน `drive_file_id` ไปถังขยะของ Google Drive ทันที หากไม่มี row `line_inbox`, `orders` หรือ `purchase_orders` อื่นอ้างอิงไฟล์นั้น; ถ้ามี reference อื่นให้เก็บไฟล์ไว้และลบเฉพาะ row ที่ผู้ใช้เลือก หากลบไฟล์ไม่สำเร็จให้หยุด ไม่ลบ row เพื่อไม่ให้เกิดไฟล์ขยะที่ไร้ reference ไฟล์ในถังขยะยังสามารถกู้คืนได้ตามนโยบายถังขยะของ Google Drive

**Daily LINE OCR recovery:** งานประจำวันเวลา 06:00 น. (Asia/Bangkok) ตรวจ `line_inbox` ย้อนหลัง 3 วันเพื่อ retry เฉพาะแถวที่ยังไม่มี Drive ID หรือ OCR ล้มเหลว/เลขเอกสารว่าง; ข้าม `verified` และ `ignored_non_bill`. ถ้ามี Drive ID อยู่แล้ว จะดึงต้นฉบับจาก LINE มาสแกนซ้ำและคงไฟล์เดิม ไม่สร้างไฟล์ซ้ำ; เมื่อได้เลขที่จึงเปลี่ยนสถานะเป็น `pending_review`, ถ้ายังอ่านไม่ได้คง `scan_failed` เพื่อรอบถัดไป. รูปต้นฉบับจาก LINE อาจดึงไม่ได้เมื่อพ้นช่วง retention 3 วัน จึงควรเก็บภาพใน Drive ให้สำเร็จก่อนเสมอ

**Manual image recovery for saved orders:** เมื่อข้อมูลบิลอยู่ใน `orders` แต่ยังไม่มี `drive_file_id` และมี `line_inbox_id`, หน้า Verify มีปุ่มให้ผู้ใช้ดึงภาพต้นฉบับจาก LINE ไปเก็บในโซน Drive ของเอกสารนั้น โดย API ตรวจการเชื่อมโยง `orders.line_inbox_id` ก่อนบันทึก `drive_file_id`/`drive_folder_id`; ไม่เปลี่ยนข้อมูล OCR หรือคอลัมน์ 39 ช่อง. ถ้า LINE หมดช่วงให้บริการภาพหรือข้อมูลอ้างอิงไม่ครบ ระบบแจ้งข้อผิดพลาดโดยไม่สร้างภาพขึ้นเอง. รายการที่มี Drive ID อยู่แล้วต้องตรวจสอบการอ้างอิงแยกต่างหาก

**LINE Inbox ↔ Drive audit interpretation:** `POST /api/drive/audit-line-inbox` เป็นรายงานอ้างอิง ID ไม่ใช่การตรวจภาพด้วยสายตาหรือเทียบ hash. ระบบเปรียบเทียบ `line_inbox.drive_file_id` กับไฟล์ใน Zone 00 และแยกไฟล์ที่ยังถูก `orders`/`purchase_orders` อ้างอิงออกจากไฟล์ที่ไม่มี reference ในทั้งสามตาราง. จำนวน LINE ที่ไม่มี Drive ID และไฟล์ที่ไม่มี database reference ยังไม่พิสูจน์ว่ารูปภาพไม่ตรงกันหรือเป็นขยะ; อย่าลบหรือกักกันจากจำนวนเพียงอย่างเดียว.

**Production snapshot (2026-10-05 13:23 Asia/Bangkok; reported by user):** LINE 92 rows; Zone 00 115 files; 86 LINE rows with 86 unique Drive IDs; 6 rows without Drive ID; 29 files without reference in `line_inbox`, `orders`, or `purchase_orders`; duplicate LINE Drive IDs 0; unverified LINE references missing from Zone 00 0; verified rows still in Zone 00 0. These counts are time-specific and may change. The 29 files were not confirmed as junk by image-content comparison.

**Apps Script audit performance/deployment:** ในโหมด GAS action `list_zone_files` ส่งเฉพาะ file ID, name, created time และ view URL เพื่อลด metadata calls. การแก้ source `google_apps_script_drive.gs` ใน GitHub ไม่ได้ deploy ไปยัง Google Apps Script อัตโนมัติ; ต้อง deploy version ที่มีการแก้เอง. การตรวจ audit เคยพบ timeout/response ที่ไม่ใช่ JSON เป็นบางครั้ง ก่อนมีรายงาน audit สำเร็จ; ยังไม่มี Render log ที่ยืนยันต้นเหตุ จึงไม่ถือว่าปัญหา transient ถูกพิสูจน์หรือกำจัดได้แล้ว

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
  matched_origin_do_id TEXT,
  po_match_status TEXT,
  dest_match_status TEXT,
  auto_action_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_flags_verified BOOLEAN NOT NULL DEFAULT FALSE,
  auto_flags_verified_by TEXT,
  auto_flags_verified_at TIMESTAMPTZ,
  reference_source TEXT,

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
  col9 TEXT, -- ผู้รับสินค้า/ผู้ซื้อ/ผู้รับเหมา (บังคับใน delivery_order, concrete และ full_logistics)
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

-- Additive migration for existing installations; legacy PO links require review.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS po_match_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dest_match_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS auto_action_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS auto_flags_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS auto_flags_verified_by TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS auto_flags_verified_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reference_source TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS matched_origin_do_id TEXT;

-- Existing installations must run this additive migration before using manual origin-ticket pairing.

UPDATE public.orders
SET po_match_status = 'auto_flagged',
    auto_action_flags = COALESCE(auto_action_flags, '[]'::jsonb) ||
      jsonb_build_array('🔗 ชนใบสั่งซื้อเดิม — กรุณาตรวจสอบการชนบิล')
WHERE col4 IS NOT NULL AND BTRIM(col4) <> '' AND po_match_status IS NULL;

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

-- Additive columns also present in src/utils/supabaseClient.ts for existing installations
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS image_hash TEXT;
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS drive_file_location TEXT DEFAULT 'zone_00';
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT;
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS doc_number TEXT;
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS doc_date TEXT;
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS store_name TEXT;
ALTER TABLE public.line_inbox ADD COLUMN IF NOT EXISTS is_bill_document BOOLEAN DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_line_inbox_doc_number ON public.line_inbox (doc_number);
CREATE INDEX IF NOT EXISTS idx_line_inbox_status ON public.line_inbox (status);
CREATE INDEX IF NOT EXISTS idx_line_inbox_received_at ON public.line_inbox (received_at DESC);

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
  first_password_change_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS first_password_change_completed BOOLEAN NOT NULL DEFAULT FALSE;

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

> สำหรับฐานข้อมูลที่สร้างไว้แล้ว ให้รัน DDL นี้ซ้ำเพื่อเพิ่มคอลัมน์สถานะการชนแบบ additive; PO เก่าที่ยังมีเลขใน `col4` แต่ไม่มีสถานะจะถูกทำเครื่องหมาย `auto_flagged` เพื่อให้ผู้ใช้ตรวจสอบ แทนการถือว่ายืนยันแล้ว

## 4.1 เอกสารแนบหักค่าวัสดุผู้รับเหมา

- แยกจาก Express RR และยอดหนี้ร้านค้า; เอกสารเป็นเอกสารภายในสำหรับแนบประกอบการเบิกค่างาน ไม่ใช่ใบแจ้งหนี้/ใบกำกับภาษี และไม่มีผลกับ 39 คอลัมน์
- DO ใช้ค่า `col9` เป็นผู้รับสินค้า/ผู้ซื้อ/ผู้รับเหมาและบังคับกรอกในฟอร์ม; ไม่สร้างทะเบียนผู้รับเหมาซ้ำ. ค่าเริ่มต้นของรายการใหม่/รายการเดิมที่ยังไม่มีสถานะคือ `chargeable` โดยใช้ผู้รับเหมาที่ระบุในช่อง 9. ตัวเลือก “ไม่นำหัก (บริษัทซื้อใช้เอง)” ที่ช่อง 9 กำหนดทุกรายการเป็น `not_chargeable`; ผู้ใช้ยังปรับสถานะรายบรรทัดภายหลังได้. Metadata ใน `orders.items` บันทึกค่า `chargeable`/`not_chargeable` โดยไม่เพิ่มคอลัมน์หลัก
- หน้าจอแสดงเฉพาะรายการที่กำหนดให้หักและยังมีจำนวนคงเหลือ. ผู้ใช้เลือกรายการ/จำนวน ใส่ราคาในขั้นออกเอกสาร (รองรับ PO ที่ไม่มีราคา) และเลือกว่าเอกสารฉบับนี้นำไปหักหรือเป็นเอกสารประกอบอย่างเดียว
- `contractor_charge_notes` เก็บหัวเอกสารและสถานะยกเลิก; `contractor_charge_lines` เก็บ snapshot ของราคา/จำนวนและการอ้างอิง DO + PO. RPC `create_contractor_charge_note` ตรวจชื่อผู้รับเหมาจาก `col9`, PO/DO, สถานะรายการและจำนวนคงเหลือ พร้อมล็อก DO ขณะจองจำนวนเพื่อกันออกเอกสารซ้ำ/เกิน
- ทั้งสองตารางเปิด RLS และให้ backend `service_role` เท่านั้น; API ฝั่ง server จำกัดการอ่าน/เขียนเอกสารแก่ Manager/Admin. สคริปต์สร้าง/ตรวจ schema รุ่นปัจจุบันอยู่ใน `src/utils/supabaseClient.ts`; ต้องรัน DDL ใน Supabase เองก่อนเปิดเมนู และการแก้ source ไม่ได้เปลี่ยนฐานข้อมูล production อัตโนมัติ
- ข้อจำกัดปัจจุบัน: JSON backup/restore ในหน้า Settings ยังไม่รวมสองตารางเอกสารแนบนี้; ต้องสำรอง/กู้คืนระดับฐานข้อมูลก่อนใช้จริงจนกว่าจะเพิ่ม support ใน backup ของแอป

---

## 5. รายการค่าติดตั้ง (Environment Variables) ที่ต้องใช้เมื่อเริ่มเชื่อมต่อจริง

เมื่อพร้อมเริ่มเชื่อมต่อฐานข้อมูลจริง ให้เตรียมค่าตัวแปรเหล่านี้ในระบบเซิร์ฟเวอร์ (`.env`):

1. **สำหรับ Supabase Cloud:**
   - `VITE_SUPABASE_URL` — URL ของโปรเจกต์ Supabase
   - `SUPABASE_URL` — Project URL สำหรับ backend
   - `SUPABASE_SERVICE_ROLE_KEY` — runtime secret สำหรับ backend `server.ts` เท่านั้น; ห้ามตั้งเป็น `VITE_*` หรือส่งให้ browser
   - `SYSTEM_MASTER_ADMIN_PASSWORD` — รหัส bootstrap/กู้คืน Master Admin ยาวอย่างน้อย 16 ตัวอักษร
   - ทางเลือกเดิม: `GOOGLE_APPS_SCRIPT_SHARED_SECRET` — ใช้ override รหัสที่สร้างในหน้า Settings; หากตั้งค่านี้ต้องให้ค่าตรงกับ Script Property `SMARTWEIGH_SHARED_SECRET`
2. **สำหรับ Google Drive API (Zero-Junk Storage):**
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — รหัสโฟลเดอร์หลักบน Google Drive ที่แชร์สิทธิ์ให้ระบบแล้ว
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (หรือ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) — สำหรับให้เซิร์ฟเวอร์สร้างโฟลเดอร์ ย้ายไฟล์ และสั่งลบไฟล์ขยะอัตโนมัติได้ตลอด 24 ชม.
