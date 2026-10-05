/**
 * Type definitions for the 39-Column Logistics, Store & Order Management System
 */

export type DocumentType = 
  | 'delivery_order'    // ใบส่งสินค้า / ใบส่งของทั่วไป (เหล็ก/ท่อ/ปูน/สี/อุปกรณ์/สินค้าไม่ชั่งน้ำหนัก)
  | 'weighbridge'       // ตั๋วชั่งน้ำหนักต้นทาง (หิน/ดิน/ทราย/สินค้าชั่งน้ำหนัก)
  | 'dest_weighbridge'  // ตั๋วชั่งน้ำหนักปลายทาง (รอชนเข้าโซน 4 ของ DO/ตั๋วต้นทาง)
  | 'concrete'          // ใบส่งคอนกรีตผสมเสร็จ
  | 'tax_invoice'       // ใบเสร็จรับเงิน / ใบกำกับภาษี
  | 'purchase_order'    // ใบสั่งซื้อสินค้า (PO)
  | 'full_logistics';   // โลจิสติกส์ 39 คอลัมน์เต็มรูปแบบ

export interface OrderItemDetail {
  id?: string;
  itemDescription: string;
  specCode?: string;
  qty: number;
  unit: string;
  unitPrice?: number;
  totalAmount?: number;
}

export interface OrderRecord {
  id: string;
  docType?: DocumentType;
  documentTitle?: string;        // ชื่อเอกสารที่ OCR อ่านจากหัว/ป้ายบนภาพ
  docTypeEvidence?: string;      // หลักฐานจากภาพที่ใช้ประกอบการจำแนกประเภท
  docTypeConfidence?: number;    // ความมั่นใจในการจำแนกประเภท 0-100
  lineItems?: OrderItemDetail[];
  referenceDocNo?: string;     // เลขที่เอกสารอ้างอิง เช่น เลข DO ที่ตั๋วชั่งอ้างถึง หรือ เลข PO
  referenceSource?: 'form_field' | 'notes' | 'handwritten'; // แหล่งที่พบ: ในช่องฟอร์ม, ในช่องหมายเหตุ, หรือลายมือเขียน
  linkedViaDocNo?: string;     // ชนบิลผ่านเอกสารใด เช่น ชนเข้า PO ผ่านใบส่งของ DO-xxxxx
  // Zone 1: Document Reference & Project (1 - 6)
  col1: string;  // 1. เลข TR
  col2: string;  // 2. โครงการ
  col3: string;  // 3. หมวดหมู่
  col4: string;  // 4. PO
  col5: string;  // 5. RR
  col6: string;  // 6. DO / ตั๋ว

  // Zone 2: Date, Merchant & Goods (7 - 12)
  col7: string;  // 7. วันที่ (YYYY-MM-DD)
  col8: string;  // 8. ผู้จำหน่าย / ร้านค้า
  col9: string;  // 9. ผู้รับเหมา / ผู้ซื้อ
  col10: string; // 10. ทะเบียนรถ
  col11: string; // 11. รายการสินค้า
  col12: string; // 12. สเปก / Code

  // Zone 3: Origin Weights (13 - 15)
  col13: number; // 13. หนักต้นทาง (กก.)
  col14: number; // 14. เบาต้นทาง (กก.)
  col15: number; // 15. สุทธิต้นทาง (กก.)

  // Zone 4: Destination & Diff (16 - 21)
  col16: string; // 16. วันที่ปลายทาง
  col17: string; // 17. ตั๋วปลายทาง
  col18: number; // 18. หนักปลายทาง (กก.)
  col19: number; // 19. เบาปลายทาง (กก.)
  col20: number; // 20. สุทธิปลายทาง (กก.)
  col21: number; // 21. ผลต่าง (กก.)

  // Zone 5: Billing & Freight (22 - 29)
  col22: number; // 22. ปริมาณ
  col23: string; // 23. หน่วย
  col24: number; // 24. ราคา/หน่วย
  col25: number; // 25. รวมค่าสินค้า
  col26: string; // 26. ประเภทรถ
  col27: number; // 27. ค่าบรรทุก/หน่วย
  col28: number; // 28. รวมค่าขนส่ง
  col29: number; // 29. รวมทั้งสิ้น

  // Zone 6: Payment Tracking (30 - 36)
  col30: string; // 30. รูปแบบจ่าย
  col31: number; // 31. จ่ายผู้ขายแล้ว
  col32: number; // 32. ค้างผู้ขาย
  col33: number; // 33. จ่ายขนส่งแล้ว
  col34: number; // 34. ค้างขนส่ง
  col35: number; // 35. ชำระแล้วรวม
  col36: number; // 36. ยอดค้างรวม

  // Zone 7: Logistics Station & System (37 - 38)
  col37: string; // 37. สถานที่ส่ง / กม.
  col38: string; // 38. หมายเหตุ

  // Metadata
  image?: string | null;
  aiExtracted?: boolean;
  storeId?: string;
  createdAt?: string;
  createdBy?: string;           // ชื่อผู้ใช้งานที่บันทึกบิลเข้าระบบ
  updatedBy?: string;           // ชื่อผู้ใช้งานที่แก้ไขบิลล่าสุด
  status?: 'verified' | 'pending' | 'flagged';

  // Auto-Matching & Auto-Action Verification Flags (Zones 1-4)
  poMatchStatus?: 'auto_flagged' | 'verified';   // สถานะการชน PO โซน 1 (auto_flagged = ชนอัตโนมัติรอตรวจสอบ, verified = ยืนยันแล้ว/ชนด้วยมือ)
  destMatchStatus?: 'auto_flagged' | 'verified'; // สถานะการชนตั๋วปลายทาง โซน 4 (auto_flagged = ชนอัตโนมัติรอตรวจสอบ, verified = ยืนยันแล้ว/ชนด้วยมือ)
  matchedDestTicketId?: string;                  // ID ของตั๋วชั่งปลายทางที่นำมาชนเข้าโซน 4
  autoActionFlags?: string[];                    // รายการสิ่งที่ระบบทำให้อัตโนมัติซึ่งติดธงรอให้ผู้ใช้ตรวจสอบและยืนยัน
  autoFlagsVerified?: boolean;                   // ผู้ใช้งานกดตรวจสอบและยืนยันรายการอัตโนมัติแล้วหรือยัง
  autoFlagsVerifiedBy?: string;                  // ชื่อผู้ใช้งานที่กดยืนยันความถูกต้อง
  autoFlagsVerifiedAt?: string;                  // วัน-เวลาที่กดยืนยันความถูกต้อง

  // LINE OA Bot Metadata (Stored strictly separate from col2 Project Name)
  lineInboxId?: string;
  lineMessageId?: string;
  lineUserId?: string;
  lineSenderName?: string;      // ชื่อผู้ส่งบิลใน LINE (เช่น ช่างสมชาย)
  lineSenderAvatar?: string;    // รูปโปรไฟล์ผู้ส่งใน LINE
  lineGroupId?: string;         // รหัสกลุ่ม LINE
  lineGroupName?: string;       // ชื่อกลุ่ม LINE ที่ส่งบิลเข้ามา (เก็บแยกอิสระ ห้ามผูกเข้า col2 อัตโนมัติ)
  lineReceivedAt?: string;      // วัน-เวลาที่บอทรับรูปบิลจาก LINE
  rawAiSnapshot?: Partial<OrderRecord>; // ข้อมูลดิบทุกโซนที่ AI สกัดไว้ครั้งแรก เพื่อสลับประเภทเอกสารได้ทันทีโดยไม่ต้องสแกนใหม่
  rawGrossWeightKg?: number;
  rawTareWeightKg?: number;
  rawNetWeightKg?: number;

  // Purchasing Billing Note & Express RR Status (4-Step Billing Workflow)
  billingStatus?: 'UNBILLED' | 'IN_BILLING' | 'BILLED';
  billingNoteId?: string;       // รหัสชุดรับวางบิล เช่น BN-202603-001

  // Google Drive Cloud Storage Tracking (5 โซน & Zero-Junk Engine)
  driveFileId?: string;
  driveFolderId?: string;
  driveFileLocation?: 'zone_00' | 'zone_01' | 'zone_02' | 'zone_03' | 'zone_04' | 'trash';
  driveSyncStatus?: 'synced' | 'pending_move' | 'pending_delete' | 'error';
  driveLastSyncedAt?: string;
}

export type BillingWeightBasis = 'none_qty' | 'origin' | 'dest' | 'min';
export type BillingScopeMode = 'both' | 'material_only' | 'transport_only';
export type BillingVatMode = 'exclude_7' | 'include_7' | 'none';
export type BillingNoteStatus = 'draft' | 'exported_express' | 'rr_stamped_billed';

export interface BillingNoteLineAdjustment {
  lineKey?: string;             // รหัสบรรทัดย่อย เช่น `${orderId}__0`, `${orderId}__1`
  orderId: string;              // รหัสใบ DO หลัก
  subItemIndex?: number;        // ลำดับรายการย่อยในใบ DO เดียวกัน (0, 1, 2...)
  trNo: string;
  doNo: string;
  poNo: string;
  date: string;
  projectName: string;
  category: string;
  itemDescription: string;
  specCode?: string;
  originNetKg: number;          // col15
  destNetKg: number;            // col20
  chosenWeightKg: number;       // น้ำหนักที่ใช้คำนวณตามเกณฑ์ที่เลือก
  qty: number;                  // col22 ที่คำนวณใหม่ (แปลง กก. -> ตัน อัตโนมัติถ้าหน่วยเป็นตัน)
  unit: string;                 // col23
  unitPrice: number;            // col24
  materialAmount: number;       // col25
  truckType: string;            // col26
  freightRate: number;          // col27
  freightAmount: number;        // col28
  lineTotal: number;            // ยอดรวมบรรทัดตามโหมดวางบิลที่เลือก
}

export interface BillingNoteRecord {
  id: string;                   // เลขที่ชุดรับวางบิล เช่น BN-202603-001
  supplierName: string;         // ชื่อร้านค้า/ผู้จำหน่าย (col8)
  supplierCode?: string;        // รหัสเจ้าหนี้ในโปรแกรม Express
  supplierTaxId?: string;       // เลขประจำตัวผู้เสียภาษีร้านค้า
  supplierInvoiceNo: string;    // เลขที่ใบวางบิล/ใบแจ้งหนี้ของ Supplier
  billingDate: string;          // วันที่รับวางบิล (YYYY-MM-DD)
  creditDays: number;           // เครดิตเทอม (วัน)
  dueDate: string;              // วันครบกำหนดชำระ (YYYY-MM-DD)
  weightBasis: BillingWeightBasis; // เกณฑ์น้ำหนัก (origin = col15, dest = col20, min = น้อยกว่า)
  billingScope: BillingScopeMode;  // ขอบเขตการวางบิล (both / material_only / transport_only)
  vatMode: BillingVatMode;         // รูปแบบภาษี (exclude_7 / include_7 / none)
  orderIds: string[];              // รายการ ID ของใบ DO ในชุดวางบิลนี้
  lines: BillingNoteLineAdjustment[]; // รายละเอียดแต่ละบรรทัดที่ปรับปรุงแล้ว
  subtotalAmount: number;       // ยอดรวมก่อนภาษี
  vatAmount: number;            // ยอดภาษีมูลค่าเพิ่ม 7%
  roundingAdjustment: number;   // ปรับเศษสตางค์ให้ตรงใบวางบิล Supplier
  supplierInvoiceTargetAmount?: number; // ยอดตามใบวางบิลของ Supplier สำหรับเทียบชนยอด
  netTotalAmount: number;       // ยอดสุทธิตั้งหนี้ใน Express
  expressRrNumber?: string;     // เลขที่ RR จากโปรแกรม Express (Auto-Stamp ลง col5)
  rrStampedAt?: string;
  rrStampedBy?: string;
  attachmentImage?: string | null; // รูปภาพหรือเอกสารใบวางบิล/ใบแจ้งหนี้ของร้านค้าที่แนบไว้
  attachmentFileName?: string;     // ชื่อไฟล์เอกสารใบวางบิลที่แนบ
  status: BillingNoteStatus;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreMerchant {
  id: string;
  name: string;
  category: string;
  taxId?: string;
  phone?: string;
  contactPerson?: string;
  address?: string;
  bankAccount?: string;
  creditTerms?: string;
  rating?: number;
  totalOrders: number;
  totalPurchases: number;
  totalPaid: number;
  totalDebt: number;
  lastOrderDate?: string;
  primaryGoods: string[];
  notes?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  code?: string;
  location?: string;
  manager?: string;
  budget?: number;
  status?: 'active' | 'completed' | 'on_hold';
  notes?: string;
  createdAt?: string;
}

export type POStatus = 'pending' | 'partially_delivered' | 'completed' | 'cancelled';

export interface POItem {
  id: string;
  itemDescription: string;
  description?: string;
  specCode?: string;
  orderedQty: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;               // เลขที่ PO เช่น PO-2026-001
  poNo?: string;
  poId?: string;
  orderDate: string;              // วันที่สั่งซื้อ (YYYY-MM-DD)
  deliveryDueDate?: string;       // กำหนดส่งมอบ
  projectId: string;              // โครงการ
  project?: string;
  storeId?: string;               // รหัสร้านค้า
  storeName: string;              // ชื่อผู้จำหน่าย / ร้านค้า
  supplierName?: string;
  category: string;               // หมวดหมู่วัสดุ
  items: POItem[];                // รายการสินค้าที่สั่ง
  totalQty: number;               // ปริมาณรวมที่สั่ง
  totalOrderedQty?: number;
  totalDeliveredQty?: number;
  totalAmount: number;            // ยอดเงินรวมตาม PO
  status: POStatus;               // สถานะการส่งมอบ
  creditTerms?: string;           // เงื่อนไขชำระเงิน
  deliveryLocation?: string;      // สถานที่จัดส่ง
  orderedBy?: string;             // ผู้สั่งซื้อ
  approvedBy?: string;            // ผู้อนุมัติ
  notes?: string;                 // หมายเหตุ
  image?: string | null;          // ภาพเอกสารใบสั่งซื้อต้นฉบับ
  createdAt: string;
  updatedAt: string;

  // LINE OA Bot Metadata (Stored strictly separate from projectId)
  lineInboxId?: string;
  lineMessageId?: string;
  lineUserId?: string;
  lineSenderName?: string;
  lineGroupId?: string;
  lineGroupName?: string;
  lineReceivedAt?: string;

  // Google Drive Cloud Storage Tracking (01_ใบสั่งซื้อ_PO)
  driveFileId?: string;
  driveFolderId?: string;
  driveFileLocation?: 'zone_01' | 'trash';
  driveSyncStatus?: 'synced' | 'pending_delete' | 'error';
}

export interface ConvertedOrderUnitDetail {
  originalQty: number;
  originalUnit: string;
  convertedQty: number;
  targetUnit: string;
  note: string;
}

export interface MatchedDeliveryShipment {
  id: string;
  doOrder?: OrderRecord;
  weighbridgeOrder?: OrderRecord;
  weighbridgeOrders?: OrderRecord[]; // รองรับกรณี 1 DO เชื่อมกับตั๋วชั่งหลายใบ (1-to-N Split Shipments)
  effectiveQty: number;
  effectiveUnit: string;
  effectiveAmount: number;
  matchType: 'paired_do_wb' | 'do_only' | 'weighbridge_only';
  referenceSource?: 'form_field' | 'notes' | 'handwritten';
  referenceDocNo?: string;
  linkedViaDocNo?: string;
}

export interface POItemReconciliation {
  item: POItem;
  deliveredQty: number;
  deliveredAmount: number;
  remainingQty: number;
  remainingAmount: number;
  percentageDelivered: number;
  status: POStatus;
  matchedOrdersCount: number;
}

export interface POReconciliation {
  po: PurchaseOrder;
  linkedOrders: OrderRecord[];
  pairedShipments?: MatchedDeliveryShipment[];
  deliveredQty: number;
  deliveredAmount: number;
  remainingQty: number;
  remainingAmount: number;
  percentageDelivered: number;
  financialPercentageDelivered?: number;
  quantityPercentageDelivered?: number;
  isMultiItem?: boolean;
  itemReconciliations?: POItemReconciliation[];
  isOverDelivered: boolean;
  status: POStatus;
  primaryUnit?: string;
  hasUnitMismatch?: boolean;
  unitMismatchWarnings?: string[];
  unitConversions?: Record<string, ConvertedOrderUnitDetail>;
  linkedMatchTypes?: Record<string, { type: 'direct_po' | 'via_do' | 'manual'; refDoc?: string; source?: string }>;
}

export interface ScanApiResponse {
  success: boolean;
  data: Partial<OrderRecord>;
  storeSuggestion?: Partial<StoreMerchant>;
  notes?: string;
  confidence?: number;
  error?: string;
  isBillDocument?: boolean;
}

export type LineInboxItemStatus =
  | 'queued'             // เพิ่งรับรูปเข้าคิว กำลังรอ AI สแกน
  | 'pending_review'     // AI สแกนเสร็จแล้ว รอผู้ตรวจสอบตรวจทานและระบุชื่อโครงการ (ช่อง 2)
  | 'duplicate_warning'  // AI ตรวจพบว่าเลขบิล+ร้านค้าซ้ำกับบิลที่มีอยู่แล้ว
  | 'verified'           // ผู้ตรวจสอบกดยืนยันบันทึกเข้าตารางหลัก 39 คอลัมน์ / PO แล้ว
  | 'ignored_non_bill'   // AI คัดกรองแล้วว่าเป็นรูปถ่ายทั่วไปในกลุ่ม (ไม่ใช่บิล)
  | 'scan_failed';       // AI อ่านไม่สำเร็จ แต่เก็บรูปและชื่อผู้ส่งไว้ครบ รอกดสแกนซ้ำหรือคีย์มือ

export interface LineBillInboxItem {
  id: string;
  lineMessageId: string;
  lineQuoteToken?: string;
  lineReplyToken?: string;
  lineUserId: string;
  lineSenderName: string;          // ชื่อผู้ส่งใน LINE
  lineSenderAvatar?: string;
  lineGroupId?: string;
  lineGroupName: string;           // ชื่อกลุ่ม LINE (เก็บแยกจาก col2 ชื่อโครงการ 100%)
  receivedAt: string;              // วัน-เวลาที่ส่งเข้ากลุ่ม LINE (ISO)
  image: string;                   // Base64 image data
  imageHash?: string;              // SHA-256 digital fingerprint to catch 100% duplicate photos even without billNo
  status: LineInboxItemStatus;
  detectedDocType: DocumentType;   // ประเภทเอกสารที่ AI จำแนก (หรือที่ผู้ตรวจสอบสลับเปลี่ยน)
  extractedData: Partial<OrderRecord>; // ข้อมูลที่พร้อมส่งเข้า VerifyModal / POEditModal (col2 จะว่างไว้ให้ผู้ตรวจระบุ)
  rawAiSnapshot: Partial<OrderRecord>; // ข้อมูลดิบครบทุกโซนจาก AI เพื่อรองรับการสลับประเภทบิลทันทีโดยไม่ต้องสแกนใหม่
  storeSuggestion?: Partial<StoreMerchant>;
  aiConfidence?: number;
  isBillDocument: boolean;
  nonBillReason?: string;
  botReplyText?: string;           // ข้อความที่บอท Quote Reply ตอบกลับอ้างอิงภาพบิลในกลุ่ม LINE
  botReplySent?: boolean;
  duplicateInfo?: {
    isDuplicate: boolean;
    matchedCode?: string;          // เช่น TR-2026-101 หรือรหัสคิวเดิม
    matchedBillNo?: string;
    matchedVendor?: string;
    reason?: string;
  };
  verifiedOrderId?: string;        // รหัสบิลที่บันทึกจริงเมื่อตรวจเสร็จ
  verifiedBy?: string;
  verifiedAt?: string;
  reviewFeedbackHistory?: {
    rawAiSnapshot: Partial<OrderRecord>;
    originalAiValues: Partial<OrderRecord>;
    confirmedValues: Partial<OrderRecord>;
    correctedFields: string[];
    reviewedBy: string;
    reviewedAt: string;
  }[];

  // Google Drive Cloud Storage Tracking (00_กล่องพักบิล_LINE)
  driveFileId?: string;
  driveFolderId?: string;
  driveFileLocation?: 'zone_00' | 'zone_01' | 'zone_02' | 'zone_03' | 'zone_04' | 'trash' | string;
  driveWebViewLink?: string;
  driveSyncStatus?: 'synced' | 'pending_move' | 'pending_delete' | 'error';
}

export interface LineBotConfig {
  enabled: boolean;
  channelAccessToken: string;
  channelSecret: string;
  autoQuoteReply: boolean;         // ตอบกลับอ้างอิงรูปบิลด้วย replyToken + quoteToken (ฟรี 0 โควตา)
  replyOnDuplicate: boolean;       // แจ้งเตือนในกลุ่มทันทีเมื่อส่งบิลซ้ำ
  replyOnUnclearImage: boolean;    // แจ้งยืนยันรับรูปเข้ากล่องพักแม้เลขบิลไม่ชัด
  filterNonBillImages: boolean;    // คัดกรองรูปทั่วไปที่ไม่ใช่บิลออกอัตโนมัติ
  strictZeroPushQuota: boolean;    // บล็อกการใช้ Push Message 100% เพื่อไม่ให้กินโควตารายเดือน
  allowedGroupNames: string[];     // รายชื่อกลุ่ม LINE ที่ตั้งรับบิล (ถ้าว่าง = รับทุกกลุ่มที่เชิญบอทเข้า)
}

// ============================================================================
// USER AUTHENTICATION, ROLE PERMISSIONS, SYSTEM SETTINGS & NOTIFICATIONS
// ============================================================================

export type UserRole = 'admin' | 'manager' | 'user';

export interface AppUser {
  id: string;
  username: string;
  password?: string;
  fullName: string;
  position: string;
  phone?: string;
  role: UserRole;
  assignedProjects: string[];      // ว่าง = เข้าถึงได้ทุกโครงการ
  status: 'active' | 'suspended';  // ห้ามลบถาวรเพื่อรักษาประวัติ Audit Trail ในบิลเก่า
  isSystemMaster?: boolean;        // บัญชี Master หลักที่ฝังติดกับระบบถาวร (ห้ามลบ/ห้ามระงับ)
  createdAt: string;
  lastLoginAt?: string;
}

export interface RolePermissions {
  role: UserRole;
  label: string;
  badgeColor: string;
  description: string;
  allowedTabs: string[];           // เมนูที่อนุญาตให้เข้าถึง
  canCreateOrder: boolean;         // สแกน/เพิ่มบิลใหม่
  canEditOrder: boolean;           // แก้ไขข้อมูลบิล
  canDeleteOrder: boolean;         // ลบบิล/ลบรายการ
  canViewFinancials: boolean;      // ดูและแก้ไขราคา/การชำระเงิน (โซน 5-6)
  canManagePO: boolean;            // เปิด/แก้ไข/อนุมัติใบสั่งซื้อ (PO)
  canExportReport: boolean;        // ส่งออกรายงาน Excel / PDF
  canManageUsers: boolean;         // จัดการผู้ใช้งานและสิทธิ์
  canManageSettings: boolean;      // ตั้งค่าระบบและสำรอง/กู้คืนข้อมูล
}

export interface SystemSettings {
  companyName: string;
  companySubtitle: string;
  companyAddress: string;
  companyTaxId: string;
  companyPhone: string;
  companyEmail?: string;
  companyLogoUrl?: string;
  trPrefix: string;                // เช่น TR-2026-
  poPrefix: string;                // เช่น PO-2026-
  defaultVatPercent: number;       // เช่น 7
  weightDiffAlertKg: number;       // เกณฑ์เตือนผลต่างน้ำหนักต้นทาง-ปลายทาง (กก.) เช่น 50 กก.
  weightDiffAlertPercent: number;  // เกณฑ์เตือนผลต่างน้ำหนัก (%) เช่น 1.5%
  poQuotaAlertPercent: number;     // เกณฑ์เตือนโควตา PO ใกล้เต็ม (%) เช่น 90%
  unlinkedDOAlertDays: number;     // เกณฑ์เตือน DO ที่ยังไม่ชน PO (วัน) เช่น 7 วัน
  backupReminderDays: number;      // เตือนสำรองข้อมูลทุกกี่วัน เช่น 7 วัน
  lastBackupAt?: string;           // วัน-เวลาที่สำรองข้อมูลล่าสุด
  customCategories: string[];      // หมวดหมู่วัสดุมาตรฐานที่ปรับเพิ่ม/ลบได้โดยไม่ต้องแก้โค้ด
  customUnits: string[];           // หน่วยนับมาตรฐานที่ปรับเพิ่ม/ลบได้โดยไม่ต้องแก้โค้ด
  reportSignatoryPreparedBy: string; // ตำแหน่งช่องเซ็นผู้จัดทำ
  reportSignatoryCheckedBy: string;  // ตำแหน่งช่องเซ็นผู้ตรวจสอบ
  reportSignatoryApprovedBy: string; // ตำแหน่งช่องเซ็นผู้อนุมัติ
  requireLoginOnStart: boolean;    // บังคับล็อกอินก่อนเข้าใช้งาน
}

export interface SystemNotification {
  id: string;
  type: 'line_inbox' | 'duplicate' | 'weight_diff' | 'po_quota' | 'unlinked_doc' | 'backup_reminder' | 'auto_flag';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  targetTab: string;
  relatedId?: string;
  createdAt: string;
}

export interface SystemBackupPayload {
  version: string;
  exportedAt: string;
  exportedBy: string;
  companyName: string;
  counts: {
    orders: number;
    pos: number;
    stores: number;
    projects: number;
    lineInbox: number;
    users: number;
    billingNotes?: number;
  };
  data: {
    orders: OrderRecord[];
    pos: PurchaseOrder[];
    stores: StoreMerchant[];
    projects: ProjectRecord[];
    lineInbox: LineBillInboxItem[];
    users: AppUser[];
    rolePermissions: Record<UserRole, RolePermissions>;
    systemSettings: SystemSettings;
    billingNotes?: BillingNoteRecord[];
  };
}

export interface DatabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
  pgConnectionString?: string;
  isEnabled: boolean;
  autoSyncIntervalMinutes?: number;
}

export interface DatabaseConnectionStatus {
  isConfigured: boolean;
  isEnabled: boolean;
  mode: 'supabase_rest' | 'postgres_direct' | 'offline';
  supabaseUrl: string;
  hasAnonKey: boolean;
  hasServiceKey: boolean;
  hasPgConnection: boolean;
  isConnected: boolean;
  latencyMs?: number;
  lastTestedAt?: string;
  lastSyncedAt?: string;
  message?: string;
  tables: {
    orders: boolean;
    purchase_orders: boolean;
    line_inbox: boolean;
    stores: boolean;
    projects: boolean;
    app_users: boolean;
    billing_notes: boolean;
  };
}
