/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OrderRecord,
  PurchaseOrder,
  StoreMerchant,
  ProjectRecord,
  BillingNoteRecord,
  LineBillInboxItem
} from '../types';

/**
 * 7-Table PostgreSQL DDL Schema from DATABASE_STORAGE_BLUEPRINT.md
 * Ready for 1-click execution or copy-pasting into Supabase SQL Editor.
 */
export const SUPABASE_SQL_DDL_SCHEMA = `-- ============================================================================
-- AUTOSTORE & 39-COLUMN ERP — SUPABASE POSTGRESQL SCHEMA (7 TABLES)
-- Reference: /DATABASE_STORAGE_BLUEPRINT.md
-- ============================================================================

-- 1. ตารางหลัก 39 คอลัมน์ (เก็บใบส่งของ DO, ตั๋วชั่งปลายทาง, และใบเสร็จ/กำกับภาษี)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL DEFAULT 'delivery_order',
  status TEXT NOT NULL DEFAULT 'pending',
  confidence NUMERIC DEFAULT 100,

  image_url TEXT,
  drive_file_id TEXT,
  drive_folder_id TEXT,

  linked_via_doc_no TEXT,
  matched_dest_ticket_id TEXT,

  line_inbox_id TEXT,
  line_sender_name TEXT,
  line_group_name TEXT,
  line_received_at TIMESTAMPTZ,

  -- โซน 1: เอกสารอ้างอิง (ช่อง 1-6)
  col1 TEXT,
  col2 TEXT,
  col3 TEXT,
  col4 TEXT,
  col5 TEXT,
  col6 TEXT,

  -- โซน 2: คู่ค้าและสินค้า (ช่อง 7-12)
  col7 TEXT,
  col8 TEXT,
  col9 TEXT,
  col10 TEXT,
  col11 TEXT,
  col12 TEXT,

  -- โซน 3: น้ำหนักต้นทาง (ช่อง 13-15)
  col13 NUMERIC DEFAULT 0,
  col14 NUMERIC DEFAULT 0,
  col15 NUMERIC DEFAULT 0,

  -- โซน 4: น้ำหนักปลายทาง & ผลต่าง (ช่อง 16-21)
  col16 TEXT,
  col17 TEXT,
  col18 NUMERIC DEFAULT 0,
  col19 NUMERIC DEFAULT 0,
  col20 NUMERIC DEFAULT 0,
  col21 NUMERIC DEFAULT 0,

  -- โซน 5: ปริมาณและราคา (ช่อง 22-29)
  col22 NUMERIC DEFAULT 0,
  col23 TEXT,
  col24 NUMERIC DEFAULT 0,
  col25 NUMERIC DEFAULT 0,
  col26 TEXT,
  col27 NUMERIC DEFAULT 0,
  col28 NUMERIC DEFAULT 0,
  col29 NUMERIC DEFAULT 0,

  -- โซน 6: การชำระเงิน (ช่อง 30-36)
  col30 TEXT,
  col31 NUMERIC DEFAULT 0,
  col32 NUMERIC DEFAULT 0,
  col33 NUMERIC DEFAULT 0,
  col34 NUMERIC DEFAULT 0,
  col35 NUMERIC DEFAULT 0,
  col36 NUMERIC DEFAULT 0,

  -- โซน 7: สถานที่และหมายเหตุ (ช่อง 37-38)
  col37 TEXT,
  col38 TEXT,

  billing_status TEXT DEFAULT 'UNBILLED',
  billing_note_id TEXT,

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
  id TEXT PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  supplier_code TEXT,
  supplier_invoice_no TEXT,
  billing_date TEXT NOT NULL,
  due_date TEXT,
  weight_basis TEXT DEFAULT 'dest',
  billing_scope TEXT DEFAULT 'both',
  vat_mode TEXT DEFAULT 'exclude_7',
  subtotal_amount NUMERIC DEFAULT 0,
  vat_amount NUMERIC DEFAULT 0,
  rounding_adjustment NUMERIC DEFAULT 0,
  net_total_amount NUMERIC DEFAULT 0,
  express_rr_number TEXT,
  status TEXT DEFAULT 'draft',
  order_ids JSONB DEFAULT '[]'::jsonb,
  lines JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  attachment_image TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) & Public Access Policies for Web Application
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_notes ENABLE ROW LEVEL SECURITY;

-- Allow read/write for authenticated and anon users (Full Applet Integration)
-- DROP before CREATE so this script is idempotent (safe to re-run anytime)
DROP POLICY IF EXISTS "Allow all operations for orders" ON public.orders;
DROP POLICY IF EXISTS "Allow all operations for purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Allow all operations for line_inbox" ON public.line_inbox;
DROP POLICY IF EXISTS "Allow all operations for stores" ON public.stores;
DROP POLICY IF EXISTS "Allow all operations for projects" ON public.projects;
DROP POLICY IF EXISTS "Allow all operations for app_users" ON public.app_users;
DROP POLICY IF EXISTS "Allow all operations for system_config" ON public.system_config;
DROP POLICY IF EXISTS "Allow all operations for billing_notes" ON public.billing_notes;

CREATE POLICY "Allow all operations for orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for purchase_orders" ON public.purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for line_inbox" ON public.line_inbox FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for stores" ON public.stores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for system_config" ON public.system_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for billing_notes" ON public.billing_notes FOR ALL USING (true) WITH CHECK (true);

-- Ensure extended columns for line_inbox exist
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
`;

/**
 * Maps an OrderRecord (TypeScript frontend) to PostgreSQL `orders` row
 */
export function mapOrderToSupabase(ord: OrderRecord): any {
  return {
    id: ord.id,
    doc_type: ord.docType || 'delivery_order',
    status: ord.status || 'pending',
    image_url: ord.image || null,
    drive_file_id: ord.driveFileId || null,
    drive_folder_id: ord.driveFolderId || null,
    linked_via_doc_no: ord.linkedViaDocNo || null,
    matched_dest_ticket_id: ord.matchedDestTicketId || null,
    line_inbox_id: ord.lineInboxId || null,
    line_sender_name: ord.lineSenderName || null,
    line_group_name: ord.lineGroupName || null,
    line_received_at: ord.lineReceivedAt || null,

    col1: ord.col1 || null,
    col2: ord.col2 || null,
    col3: ord.col3 || null,
    col4: ord.col4 || null,
    col5: ord.col5 || null,
    col6: ord.col6 || null,

    col7: ord.col7 || null,
    col8: ord.col8 || null,
    col9: ord.col9 || null,
    col10: ord.col10 || null,
    col11: ord.col11 || null,
    col12: ord.col12 || null,

    col13: Number(ord.col13) || 0,
    col14: Number(ord.col14) || 0,
    col15: Number(ord.col15) || 0,

    col16: ord.col16 || null,
    col17: ord.col17 || null,
    col18: Number(ord.col18) || 0,
    col19: Number(ord.col19) || 0,
    col20: Number(ord.col20) || 0,
    col21: Number(ord.col21) || 0,

    col22: Number(ord.col22) || 0,
    col23: ord.col23 || null,
    col24: Number(ord.col24) || 0,
    col25: Number(ord.col25) || 0,
    col26: ord.col26 || null,
    col27: Number(ord.col27) || 0,
    col28: Number(ord.col28) || 0,
    col29: Number(ord.col29) || 0,

    col30: ord.col30 || null,
    col31: Number(ord.col31) || 0,
    col32: Number(ord.col32) || 0,
    col33: Number(ord.col33) || 0,
    col34: Number(ord.col34) || 0,
    col35: Number(ord.col35) || 0,
    col36: Number(ord.col36) || 0,

    col37: ord.col37 || null,
    col38: ord.col38 || null,

    billing_status: ord.billingStatus || 'UNBILLED',
    billing_note_id: ord.billingNoteId || null,

    items: ord.lineItems || [],
    created_at: ord.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Maps a PostgreSQL `orders` row to frontend OrderRecord
 */
export function mapSupabaseToOrder(row: any): OrderRecord {
  return {
    id: row.id,
    docType: row.doc_type || 'delivery_order',
    status: (row.status as any) || 'verified',
    image: row.image_url || undefined,
    driveFileId: row.drive_file_id || undefined,
    driveFolderId: row.drive_folder_id || undefined,
    linkedViaDocNo: row.linked_via_doc_no || undefined,
    matchedDestTicketId: row.matched_dest_ticket_id || undefined,
    lineInboxId: row.line_inbox_id || undefined,
    lineSenderName: row.line_sender_name || undefined,
    lineGroupName: row.line_group_name || undefined,
    lineReceivedAt: row.line_received_at || undefined,

    col1: row.col1 || '',
    col2: row.col2 || '',
    col3: row.col3 || '',
    col4: row.col4 || '',
    col5: row.col5 || '',
    col6: row.col6 || '',

    col7: row.col7 || '',
    col8: row.col8 || '',
    col9: row.col9 || '',
    col10: row.col10 || '',
    col11: row.col11 || '',
    col12: row.col12 || '',

    col13: Number(row.col13) || 0,
    col14: Number(row.col14) || 0,
    col15: Number(row.col15) || 0,

    col16: row.col16 || '',
    col17: row.col17 || '',
    col18: Number(row.col18) || 0,
    col19: Number(row.col19) || 0,
    col20: Number(row.col20) || 0,
    col21: Number(row.col21) || 0,

    col22: Number(row.col22) || 0,
    col23: row.col23 || '',
    col24: Number(row.col24) || 0,
    col25: Number(row.col25) || 0,
    col26: row.col26 || '',
    col27: Number(row.col27) || 0,
    col28: Number(row.col28) || 0,
    col29: Number(row.col29) || 0,

    col30: row.col30 || '',
    col31: Number(row.col31) || 0,
    col32: Number(row.col32) || 0,
    col33: Number(row.col33) || 0,
    col34: Number(row.col34) || 0,
    col35: Number(row.col35) || 0,
    col36: Number(row.col36) || 0,

    col37: row.col37 || '',
    col38: row.col38 || '',

    billingStatus: row.billing_status || 'UNBILLED',
    billingNoteId: row.billing_note_id || undefined,

    lineItems: Array.isArray(row.items) ? row.items : [],
    createdAt: row.created_at || new Date().toISOString()
  };
}

/**
 * Maps a PurchaseOrder to PostgreSQL `purchase_orders` row
 */
export function mapPOToSupabase(po: PurchaseOrder): any {
  return {
    id: po.id,
    po_number: po.poNumber,
    project_name: po.project || '',
    supplier_name: po.supplierName || po.storeName || '',
    issue_date: po.orderDate,
    expected_date: po.deliveryDueDate || null,
    status: po.status || 'pending',
    total_amount: Number(po.totalAmount) || 0,
    notes: po.notes || null,
    image_url: po.image || null,
    drive_file_id: po.driveFileId || null,
    drive_folder_id: po.driveFolderId || null,
    items: po.items || [],
    linked_order_ids: [],
    created_at: po.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Maps a PostgreSQL `purchase_orders` row to frontend PurchaseOrder
 */
export function mapSupabaseToPO(row: any): PurchaseOrder {
  const items = Array.isArray(row.items) ? row.items : [];
  const totalQty = items.reduce((acc: number, it: any) => acc + (Number(it.orderedQty || it.qty) || 0), 0);
  return {
    id: row.id,
    poNumber: row.po_number || '',
    orderDate: row.issue_date || '',
    deliveryDueDate: row.expected_date || undefined,
    projectId: '',
    project: row.project_name || '',
    storeId: '',
    storeName: row.supplier_name || '',
    category: 'วัสดุก่อสร้าง',
    items: items,
    totalQty,
    totalAmount: Number(row.total_amount) || 0,
    status: (row.status as any) || 'pending',
    notes: row.notes || undefined,
    image: row.image_url || undefined,
    driveFileId: row.drive_file_id || undefined,
    driveFolderId: row.drive_folder_id || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

/**
 * Maps a StoreMerchant to PostgreSQL `stores` row
 */
export function mapStoreToSupabase(store: StoreMerchant): any {
  const creditDays = store.creditTerms ? parseInt(store.creditTerms, 10) || 30 : 30;
  return {
    id: store.id,
    name: store.name,
    tax_id: store.taxId || null,
    category: store.category || null,
    contact_name: store.contactPerson || null,
    phone: store.phone || null,
    address: store.address || null,
    credit_days: creditDays,
    credit_limit: 0,
    status: 'active',
    notes: store.notes || null,
    created_at: new Date().toISOString()
  };
}

/**
 * Maps a PostgreSQL `stores` row to frontend StoreMerchant
 */
export function mapSupabaseToStore(row: any): StoreMerchant {
  return {
    id: row.id,
    name: row.name || '',
    taxId: row.tax_id || undefined,
    category: row.category || 'ร้านค้าทั่วไป',
    contactPerson: row.contact_name || undefined,
    phone: row.phone || undefined,
    address: row.address || undefined,
    creditTerms: row.credit_days ? `${row.credit_days} วัน` : undefined,
    totalOrders: 0,
    totalPurchases: 0,
    totalPaid: 0,
    totalDebt: 0,
    primaryGoods: [],
    notes: row.notes || undefined
  };
}

/**
 * Maps a ProjectRecord to PostgreSQL `projects` row
 */
export function mapProjectToSupabase(proj: ProjectRecord): any {
  return {
    id: proj.id,
    code: proj.code || null,
    name: proj.name,
    location: proj.location || null,
    manager_name: proj.manager || null,
    budget: Number(proj.budget) || 0,
    status: proj.status || 'active',
    notes: proj.notes || null,
    created_at: proj.createdAt || new Date().toISOString()
  };
}

/**
 * Maps a PostgreSQL `projects` row to frontend ProjectRecord
 */
export function mapSupabaseToProject(row: any): ProjectRecord {
  return {
    id: row.id,
    code: row.code || undefined,
    name: row.name || '',
    location: row.location || undefined,
    manager: row.manager_name || undefined,
    budget: Number(row.budget) || 0,
    status: (row.status as any) || 'active',
    notes: row.notes || undefined,
    createdAt: row.created_at || new Date().toISOString()
  };
}

/**
 * Maps a BillingNoteRecord to PostgreSQL `billing_notes` row
 */
export function mapBillingNoteToSupabase(note: BillingNoteRecord): any {
  return {
    id: note.id,
    supplier_name: note.supplierName,
    supplier_code: note.supplierCode || null,
    supplier_invoice_no: note.supplierInvoiceNo || null,
    billing_date: note.billingDate,
    due_date: note.dueDate || null,
    weight_basis: note.weightBasis || 'dest',
    billing_scope: note.billingScope || 'both',
    vat_mode: note.vatMode || 'exclude_7',
    subtotal_amount: Number(note.subtotalAmount) || 0,
    vat_amount: Number(note.vatAmount) || 0,
    rounding_adjustment: Number(note.roundingAdjustment) || 0,
    net_total_amount: Number(note.netTotalAmount) || 0,
    express_rr_number: note.expressRrNumber || null,
    status: note.status || 'draft',
    order_ids: note.orderIds || [],
    lines: note.lines || [],
    notes: note.notes || null,
    attachment_image: note.attachmentImage || null,
    created_by: note.createdBy || null,
    created_at: note.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Maps a PostgreSQL `billing_notes` row to frontend BillingNoteRecord
 */
export function mapSupabaseToBillingNote(row: any): BillingNoteRecord {
  return {
    id: row.id,
    supplierName: row.supplier_name || '',
    supplierCode: row.supplier_code || undefined,
    supplierInvoiceNo: row.supplier_invoice_no || '',
    billingDate: row.billing_date || '',
    creditDays: Number(row.credit_days) || 30,
    dueDate: row.due_date || '',
    weightBasis: (row.weight_basis as any) || 'dest',
    billingScope: (row.billing_scope as any) || 'both',
    vatMode: (row.vat_mode as any) || 'exclude_7',
    subtotalAmount: Number(row.subtotal_amount) || 0,
    vatAmount: Number(row.vat_amount) || 0,
    roundingAdjustment: Number(row.rounding_adjustment) || 0,
    netTotalAmount: Number(row.net_total_amount) || 0,
    expressRrNumber: row.express_rr_number || undefined,
    status: (row.status as any) || 'draft',
    orderIds: Array.isArray(row.order_ids) ? row.order_ids : [],
    lines: Array.isArray(row.lines) ? row.lines : [],
    notes: row.notes || undefined,
    attachmentImage: row.attachment_image || undefined,
    createdBy: row.created_by || '',
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

/**
 * Maps a LineBillInboxItem to PostgreSQL `line_inbox` row
 */
export function mapLineInboxToSupabase(item: LineBillInboxItem): any {
  const ext = item.extractedData || {};

  // Extract docNumber from the right column based on document type
  const rawSnapshot: any = item.rawAiSnapshot || {};
  let docNumber = '';
  if (item.detectedDocType === 'dest_weighbridge') {
    docNumber = (ext as any).col17 || (ext as any).col6 || rawSnapshot.rawDocNo || '';
  } else if (item.detectedDocType === 'purchase_order') {
    docNumber = (ext as any).col4 || (ext as any).col6 || rawSnapshot.rawDocNo || '';
  } else {
    docNumber = (ext as any).col6 || (ext as any).col17 || (ext as any).col4 || rawSnapshot.rawDocNo || '';
  }

  const mergedExtracted = {
    ...(ext),
    driveFileId: item.driveFileId,
    driveFileLocation: item.driveFileLocation || (item.driveFileId ? 'zone_00' : undefined),
    driveWebViewLink: item.driveWebViewLink,
    imageHash: item.imageHash,
    rawAiSnapshot: item.rawAiSnapshot || {}
  };

  const row: any = {
    id: item.id,
    received_at: item.receivedAt || new Date().toISOString(),
    line_message_id: item.lineMessageId || null,
    line_quote_token: item.lineQuoteToken || null,
    line_sender_name: item.lineSenderName || null,
    line_group_name: item.lineGroupName || null,
    // ARCHITECTURE RULE: image_url is NEVER stored in Supabase.
    // Images MUST be uploaded to Google Drive first. Only Drive link is stored in Supabase.
    image_url: null,
    drive_file_id: item.driveFileId || null,
    drive_file_location: item.driveFileLocation || (item.driveFileId ? 'zone_00' : null),
    drive_web_view_link: item.driveWebViewLink || null,
    detected_doc_type: item.detectedDocType || 'delivery_order',
    ai_confidence: item.aiConfidence || 0,
    status: item.status || 'pending_review',
    duplicate_of_order_id: item.duplicateInfo?.matchedCode || null,
    duplicate_reason: item.duplicateInfo?.reason || null,
    bot_replied: Boolean(item.botReplySent),
    bot_reply_mode: 'reply_quote_free',
    bot_reply_text: item.botReplyText || null,
    extracted_data: mergedExtracted,
    store_suggestion: item.storeSuggestion || null,
    // Dedicated searchable columns (avoid digging through JSONB)
    doc_number: docNumber.toString().trim() || null,
    doc_date: ((ext as any).col7 || rawSnapshot.rawDate || '').toString().trim() || null,
    store_name: ((ext as any).col8 || rawSnapshot.rawStoreName || '').toString().trim() || null,
    is_bill_document: item.isBillDocument !== false,
    image_hash: item.imageHash || null
  };

  return row;
}

/**
 * Maps a PostgreSQL `line_inbox` row to frontend LineBillInboxItem
 */
export function mapSupabaseToLineInbox(row: any): LineBillInboxItem {
  const extData = row.extracted_data || {};
  const detectedDocType: any = row.detected_doc_type || 'delivery_order';

  // Back-fill doc_number into extractedData columns if extData is missing them
  // (handles old rows that were saved before doc_number column existed)
  const docNum = row.doc_number || extData.col6 || extData.col17 || extData.col4 || '';
  if (docNum) {
    if (detectedDocType === 'dest_weighbridge') {
      if (!extData.col17) extData.col17 = docNum;
    } else if (detectedDocType === 'purchase_order') {
      if (!extData.col4) extData.col4 = docNum;
    } else {
      if (!extData.col6) extData.col6 = docNum;
    }
  }
  if (row.doc_date && !extData.col7) extData.col7 = row.doc_date;
  if (row.store_name && !extData.col8) extData.col8 = row.store_name;

  return {
    id: row.id,
    lineMessageId: row.line_message_id || '',
    lineQuoteToken: row.line_quote_token || undefined,
    lineUserId: extData.lineUserId || 'U-LINE',
    lineSenderName: row.line_sender_name || 'พนักงาน LINE',
    lineSenderAvatar: extData.lineSenderAvatar || undefined,
    lineGroupId: extData.lineGroupId || undefined,
    lineGroupName: row.line_group_name || '',
    receivedAt: row.received_at || new Date().toISOString(),
    image: row.image_url || '',
    imageHash: row.image_hash || extData.imageHash || undefined,
    driveFileId: row.drive_file_id || extData.driveFileId || undefined,
    driveFileLocation: row.drive_file_location || extData.driveFileLocation || (row.drive_file_id ? 'zone_00' : undefined),
    driveWebViewLink: row.drive_web_view_link || extData.driveWebViewLink || undefined,
    status: (row.status as any) || 'pending_review',
    detectedDocType,
    extractedData: extData,
    rawAiSnapshot: extData.rawAiSnapshot || {},
    storeSuggestion: row.store_suggestion || undefined,
    aiConfidence: Number(row.ai_confidence) || 0,
    isBillDocument: row.is_bill_document !== false,
    nonBillReason: extData.nonBillReason || undefined,
    botReplyText: row.bot_reply_text || undefined,
    botReplySent: Boolean(row.bot_replied),
    duplicateInfo: row.duplicate_of_order_id ? {
      isDuplicate: true,
      matchedCode: row.duplicate_of_order_id,
      reason: row.duplicate_reason || undefined
    } : undefined,
    verifiedOrderId: extData.verifiedOrderId || undefined,
    verifiedBy: extData.verifiedBy || undefined,
    verifiedAt: extData.verifiedAt || undefined
  };
}
