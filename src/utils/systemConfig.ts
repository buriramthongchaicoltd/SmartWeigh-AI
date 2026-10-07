import {
  AppUser,
  UserRole,
  RolePermissions,
  SystemSettings,
  SystemNotification,
  SystemBackupPayload,
  OrderRecord,
  PurchaseOrder,
  StoreMerchant,
  ProjectRecord,
  LineBillInboxItem,
  BillingNoteRecord
} from '../types';
import { reconcilePO } from './poReconciliation';
import { STANDARD_CONSTRUCTION_CATEGORIES } from './dbLookup';

export const STORAGE_USERS_KEY = 'autostore_users_v1';
export const STORAGE_ROLES_KEY = 'autostore_roles_v1';
export const STORAGE_SETTINGS_KEY = 'autostore_system_settings_v1';
export const STORAGE_CURRENT_USER_KEY = 'autostore_active_user_id_v1';
export const STORAGE_DISMISSED_NOTIFS_KEY = 'autostore_dismissed_notifs_v1';
export const STORAGE_QUICK_SNAPSHOT_KEY = 'autostore_quick_snapshot_v1';
export const STORAGE_BILLING_NOTES_KEY = 'autostore_billing_notes_v1';

export const SYSTEM_MASTER_ADMIN: AppUser = {
  id: 'SYSTEM-MASTER-ADMIN',
  username: 'Admin',
  fullName: 'Admin (ผู้ดูแลระบบหลัก - Master)',
  position: 'System Master Administrator',
  phone: '-',
  role: 'admin',
  assignedProjects: [],
  status: 'active',
  isSystemMaster: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: new Date().toISOString()
};

export const DEFAULT_USERS: AppUser[] = [SYSTEM_MASTER_ADMIN];

/**
 * Ensures the permanent built-in System Master account
 * is always embedded in the system, active, and cannot be lost or disabled.
 * Also strips out legacy mock sample accounts (USR-ADMIN-01, USR-MGR-01, USR-STAFF-01).
 */
export function ensureSystemMasterAdmin(usersList: AppUser[]): AppUser[] {
  const legacyMockIds = new Set(['USR-ADMIN-01', 'USR-MGR-01', 'USR-STAFF-01']);
  const cleaned = (Array.isArray(usersList) ? usersList : []).filter(
    u => u && !legacyMockIds.has(u.id)
  );

  const existingMasterIdx = cleaned.findIndex(
    u => u.id === SYSTEM_MASTER_ADMIN.id || u.isSystemMaster || u.username.trim().toLowerCase() === 'admin'
  );

  if (existingMasterIdx >= 0) {
    const existing = cleaned[existingMasterIdx];
    const enforcedMaster: AppUser = {
      ...existing,
      id: SYSTEM_MASTER_ADMIN.id,
      username: 'Admin',
      password: existing.password,
      fullName: existing.fullName || SYSTEM_MASTER_ADMIN.fullName,
      position: existing.position || SYSTEM_MASTER_ADMIN.position,
      role: 'admin',
      status: 'active',
      isSystemMaster: true
    };
    const others = cleaned.filter((_, idx) => idx !== existingMasterIdx);
    return [enforcedMaster, ...others];
  }

  return [SYSTEM_MASTER_ADMIN, ...cleaned];
}

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  admin: {
    role: 'admin',
    label: 'ผู้ดูแลระบบ (Admin)',
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
    description: 'สิทธิ์เต็ม 100% ทุกเมนู จัดการผู้ใช้งาน กำหนดสิทธิ์ ตั้งค่าระบบ และสำรอง/กู้คืนข้อมูลได้',
    allowedTabs: [
      'line_inbox',
      'orders',
      'pos',
      'dest_wb',
      'tax_inv',
      'billing',
      'contractor_billing',
      'analytics',
      'reports',
      'stores',
      'projects',
      'users',
      'settings'
    ],
    canCreateOrder: true,
    canEditOrder: true,
    canDeleteOrder: true,
    canViewFinancials: true,
    canManagePO: true,
    canExportReport: true,
    canManageUsers: true,
    canManageSettings: true
  },
  manager: {
    role: 'manager',
    label: 'ผู้จัดการ / บัญชี (Manager)',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    description: 'ดูแลใบสั่งซื้อ (PO), ตรวจสอบราคา/การเงิน (โซน 5-6), ชนบิลใบกำกับภาษี และออกรายงาน Excel/PDF',
    allowedTabs: [
      'line_inbox',
      'orders',
      'pos',
      'dest_wb',
      'tax_inv',
      'billing',
      'contractor_billing',
      'analytics',
      'reports',
      'stores',
      'projects'
    ],
    canCreateOrder: true,
    canEditOrder: true,
    canDeleteOrder: true,
    canViewFinancials: true,
    canManagePO: true,
    canExportReport: true,
    canManageUsers: false,
    canManageSettings: false
  },
  user: {
    role: 'user',
    label: 'เจ้าหน้าที่หน้างาน (User / Staff)',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    description: 'ตรวจรับบิลจาก LINE, สแกนใบส่งของ (DO) และตั๋วชั่งปลายทางหน้างาน (ไม่เข้าถึงเมนูการเงินและลบข้อมูลไม่ได้)',
    allowedTabs: [
      'line_inbox',
      'orders',
      'dest_wb',
      'projects'
    ],
    canCreateOrder: true,
    canEditOrder: true,
    canDeleteOrder: false,
    canViewFinancials: false,
    canManagePO: false,
    canExportReport: false,
    canManageUsers: false,
    canManageSettings: false
  }
};

export const DEFAULT_COMPANY_LOGO_URL =
  'https://img2.pic.in.th/pic/Screenshot-2025-03-03-132721e6cc77cbcea28f01.png';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  companyName: 'บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด',
  companySubtitle: 'สำนักงานใหญ่ • ระบบบริหารคลังวัสดุ ตั๋วชั่ง และใบสั่งซื้ออัตโนมัติ (39-Column ERP)',
  companyAddress: '31/2 ถนนอินจันทร์ณรงค์ ต.ในเมือง อ.เมือง จ.บุรีรัมย์ 31000',
  companyTaxId: '0315559001144',
  companyPhone: '044-611134',
  companyEmail: 'brtc2024@gmail.com',
  companyLogoUrl: DEFAULT_COMPANY_LOGO_URL,
  trPrefix: 'TR-2026-',
  poPrefix: 'PO-2026-',
  defaultVatPercent: 7,
  weightDiffAlertKg: 50,
  weightDiffAlertPercent: 1.5,
  poQuotaAlertPercent: 90,
  unlinkedDOAlertDays: 7,
  backupReminderDays: 7,
  lastBackupAt: undefined,
  customCategories: STANDARD_CONSTRUCTION_CATEGORIES.map(c => c.value),
  customUnits: [
    'ตัน',
    'คิว',
    'ลบ.ม.',
    'ตร.ม.',
    'เมตร',
    'เส้น',
    'ถุง',
    'ท่อน',
    'แผ่น',
    'ชุด',
    'อัน',
    'ท่อ',
    'ถัง (200 ลิตร)',
    'ลิตร',
    'กก.',
    'เที่ยว',
    'วัน',
    'งาน'
  ],
  reportSignatoryPreparedBy: 'เจ้าหน้าที่สโตร์ / ผู้จัดทำรายงาน',
  reportSignatoryCheckedBy: 'หัวหน้าฝ่ายจัดซื้อ / บัญชีผู้ตรวจสอบ',
  reportSignatoryApprovedBy: 'ผู้จัดการโครงการ / ผู้อนุมัติ',
  requireLoginOnStart: false
};

/**
 * Normalizes saved system settings and automatically upgrades legacy default company placeholders
 * to บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด.
 */
export function normalizeSystemSettings(saved?: Partial<SystemSettings> | null): SystemSettings {
  if (!saved || typeof saved !== 'object') {
    return { ...DEFAULT_SYSTEM_SETTINGS };
  }

  const isLegacyPlaceholder =
    !saved.companyName ||
    saved.companyName.includes('สมาร์ทเวย์') ||
    saved.companyTaxId === '0105566099888';

  const merged: SystemSettings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...saved,
    companyName: isLegacyPlaceholder
      ? DEFAULT_SYSTEM_SETTINGS.companyName
      : saved.companyName || DEFAULT_SYSTEM_SETTINGS.companyName,
    companyAddress: isLegacyPlaceholder
      ? DEFAULT_SYSTEM_SETTINGS.companyAddress
      : saved.companyAddress || DEFAULT_SYSTEM_SETTINGS.companyAddress,
    companyTaxId: isLegacyPlaceholder
      ? DEFAULT_SYSTEM_SETTINGS.companyTaxId
      : saved.companyTaxId || DEFAULT_SYSTEM_SETTINGS.companyTaxId,
    companyPhone: isLegacyPlaceholder
      ? DEFAULT_SYSTEM_SETTINGS.companyPhone
      : saved.companyPhone || DEFAULT_SYSTEM_SETTINGS.companyPhone,
    companyEmail:
      saved.companyEmail && !isLegacyPlaceholder
        ? saved.companyEmail
        : DEFAULT_SYSTEM_SETTINGS.companyEmail,
    companyLogoUrl:
      saved.companyLogoUrl && !isLegacyPlaceholder
        ? saved.companyLogoUrl
        : DEFAULT_SYSTEM_SETTINGS.companyLogoUrl
  };

  return merged;
}

/**
 * Computes real-time actionable notifications based on current records & SystemSettings thresholds.
 */
export function computeSystemNotifications(
  orders: OrderRecord[],
  pos: PurchaseOrder[],
  lineInbox: LineBillInboxItem[],
  settings: SystemSettings
): SystemNotification[] {
  const notifications: SystemNotification[] = [];
  const nowIso = new Date().toISOString();

  // LINE bills always remain for visual review; legacy duplicate_warning rows count as pending.
  const pendingLineBills = lineInbox.filter(i =>
    i.status === 'pending_review' || i.status === 'queued' || i.status === 'duplicate_warning'
  );

  if (pendingLineBills.length > 0) {
    notifications.push({
      id: `notif-line-pending-${pendingLineBills.length}`,
      type: 'line_inbox',
      severity: 'warning',
      title: `บิลใหม่จาก LINE OA รอตรวจและระบุโครงการ (${pendingLineBills.length} ใบ)`,
      message: `มีรูปบิลจากกลุ่ม LINE ที่ AI สแกนแล้ว รอผู้ตรวจสอบระบุชื่อโครงการ (ช่อง 2) เพื่อบันทึกเข้าตารางหลัก`,
      targetTab: 'line_inbox',
      createdAt: pendingLineBills[0]?.receivedAt || nowIso
    });
  }

  // 2. Weight Discrepancy Alerts (Origin vs Destination Net Weight > threshold)
  const weightDiffOrders = orders.filter(o => {
    if (o.docType === 'dest_weighbridge' || o.docType === 'tax_invoice') return false;
    const netOrigin = Number(o.col15) || 0;
    const netDest = Number(o.col20) || 0;
    if (netOrigin <= 0 || netDest <= 0) return false;
    const diffKg = Math.abs(netOrigin - netDest);
    const diffPct = (diffKg / netOrigin) * 100;
    return diffKg >= (settings.weightDiffAlertKg || 50) || diffPct >= (settings.weightDiffAlertPercent || 1.5);
  });

  if (weightDiffOrders.length > 0) {
    const sample = weightDiffOrders[0];
    const diffKg = Math.abs((Number(sample.col15) || 0) - (Number(sample.col20) || 0));
    notifications.push({
      id: `notif-weight-diff-${weightDiffOrders.length}`,
      type: 'weight_diff',
      severity: 'critical',
      title: `เตือนผลต่างน้ำหนักชั่งเกินเกณฑ์ (${weightDiffOrders.length} รายการ)`,
      message: `พบใบส่งของที่มีผลต่างน้ำหนักต้นทาง-ปลายทางเกิน ${settings.weightDiffAlertKg} กก. (เช่น บิล ${sample.col6 || sample.col1} ต่างกัน ${diffKg.toLocaleString()} กก.)`,
      targetTab: 'orders',
      relatedId: sample.col6 || sample.col1,
      createdAt: sample.createdAt || nowIso
    });
  }

  // 3. PO Quota Alerts (Over-delivered or >= poQuotaAlertPercent)
  for (const po of pos) {
    if (po.status === 'cancelled') continue;
    const rec = reconcilePO(po, orders);
    if (rec.isOverDelivered) {
      notifications.push({
        id: `notif-po-over-${po.id}`,
        type: 'po_quota',
        severity: 'critical',
        title: `ใบสั่งซื้อ ${po.poNumber} ส่งของเกินโควตา (${rec.percentageDelivered.toFixed(1)}%)`,
        message: `ร้าน ${po.storeName} (${po.projectId || 'ไม่ระบุโครงการ'}) ส่งมอบเกินจำนวน/ยอดที่สั่งซื้อใน PO แล้ว`,
        targetTab: 'pos',
        relatedId: po.id,
        createdAt: po.updatedAt || nowIso
      });
    } else if (rec.percentageDelivered >= (settings.poQuotaAlertPercent || 90) && rec.percentageDelivered < 100) {
      notifications.push({
        id: `notif-po-near-${po.id}`,
        type: 'po_quota',
        severity: 'warning',
        title: `โควตา PO ${po.poNumber} ใกล้เต็มแล้ว (${rec.percentageDelivered.toFixed(1)}%)`,
        message: `ร้าน ${po.storeName} คงเหลือโควตาส่งมอบอีกเพียง ${rec.remainingQty.toLocaleString()} ${rec.primaryUnit || 'หน่วย'}`,
        targetTab: 'pos',
        relatedId: po.id,
        createdAt: po.updatedAt || nowIso
      });
    }
  }

  // 4. Unmatched Destination Weighbridge or Tax Invoices
  const unmatchedDestWB = orders.filter(o => o.docType === 'dest_weighbridge' && !o.linkedViaDocNo);
  if (unmatchedDestWB.length > 0) {
    notifications.push({
      id: `notif-unmatched-wb-${unmatchedDestWB.length}`,
      type: 'unlinked_doc',
      severity: 'warning',
      title: `ตั๋วชั่งปลายทางรอชนบิลเข้า DO (${unmatchedDestWB.length} ใบ)`,
      message: `มีตั๋วชั่งน้ำหนักปลายทางที่ยังไม่ได้ผูกเข้ากับใบส่งของต้นทาง (DO) คลิกเพื่อไปหน้าชนบิล`,
      targetTab: 'dest_wb',
      createdAt: unmatchedDestWB[0]?.createdAt || nowIso
    });
  }

  const unmatchedTaxInv = orders.filter(o => o.docType === 'tax_invoice' && !o.linkedViaDocNo);
  if (unmatchedTaxInv.length > 0) {
    notifications.push({
      id: `notif-unmatched-tax-${unmatchedTaxInv.length}`,
      type: 'unlinked_doc',
      severity: 'info',
      title: `ใบเสร็จ/ใบกำกับภาษีรอชนบิล (${unmatchedTaxInv.length} ใบ)`,
      message: `มีเอกสารการเงินที่รอตรวจสอบและผูกเข้ากับใบส่งของ (DO) เพื่อตัดยอดชำระเงิน`,
      targetTab: 'tax_inv',
      createdAt: unmatchedTaxInv[0]?.createdAt || nowIso
    });
  }

  // 4.5. Unverified Automatic Actions / Auto-Matched Bills (Waiting for user verification)
  const unverifiedAutoOrders = orders.filter(o =>
    o.poMatchStatus === 'auto_flagged' ||
    o.destMatchStatus === 'auto_flagged' ||
    Boolean(o.autoActionFlags && o.autoActionFlags.length > 0 && !o.autoFlagsVerified)
  );
  if (unverifiedAutoOrders.length > 0) {
    const sample = unverifiedAutoOrders[0];
    notifications.push({
      id: `notif-auto-flag-${unverifiedAutoOrders.length}`,
      type: 'auto_flag',
      severity: 'warning',
      title: `🚩 รายการอัตโนมัติรอตรวจสอบและยืนยัน (${unverifiedAutoOrders.length} รายการ)`,
      message: `ระบบทำการชนบิลอัตโนมัติ (ตามเลขอ้างอิง) หรือคำนวณข้อมูลอัตโนมัติไว้ กรุณาตรวจสอบและกดยืนยันความถูกต้อง (เช่น ${sample.col1})`,
      targetTab: 'orders',
      relatedId: sample.col1,
      createdAt: sample.createdAt || nowIso
    });
  }

  // 5. Backup Reminder
  const totalRecords = orders.length + pos.length + lineInbox.length;
  if (totalRecords > 0) {
    const reminderDays = settings.backupReminderDays || 7;
    if (!settings.lastBackupAt) {
      notifications.push({
        id: 'notif-backup-never',
        type: 'backup_reminder',
        severity: 'info',
        title: 'คำแนะนำ: ยังไม่เคยสำรองข้อมูลลงไฟล์ (.json)',
        message: `ปัจจุบันมีข้อมูลรวม ${totalRecords} รายการในระบบ แนะนำให้กดดาวน์โหลดไฟล์สำรองข้อมูลเก็บไว้ในเครื่อง`,
        targetTab: 'settings',
        createdAt: nowIso
      });
    } else {
      const daysSince = (Date.now() - new Date(settings.lastBackupAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= reminderDays) {
        notifications.push({
          id: `notif-backup-due-${Math.floor(daysSince)}`,
          type: 'backup_reminder',
          severity: 'warning',
          title: `ครบกำหนดสำรองข้อมูลประจำสัปดาห์ (${Math.floor(daysSince)} วันที่ผ่านมา)`,
          message: `สำรองข้อมูลครั้งล่าสุดเมื่อ ${new Date(settings.lastBackupAt).toLocaleDateString('th-TH')} คลิกเพื่อดาวน์โหลดไฟล์ Backup ล่าสุด`,
          targetTab: 'settings',
          createdAt: nowIso
        });
      }
    }
  }

  return notifications;
}

/**
 * Checks whether an OrderRecord has any unverified automated system actions
 * (Auto-matched PO, Auto-matched Destination Weighbridge, AI Extraction, or Auto Calculation)
 */
export function hasUnverifiedAutoActions(order: OrderRecord): boolean {
  if (!order) return false;
  if (order.col4 && order.poMatchStatus !== 'verified') return true;
  if (order.destMatchStatus === 'auto_flagged') return true;
  if (order.autoActionFlags && order.autoActionFlags.length > 0 && !order.autoFlagsVerified) return true;
  return false;
}

/**
 * Returns a list of human-readable descriptions of all unverified automated actions on an order
 */
export function getOrderAutoFlagSummary(order: OrderRecord): string[] {
  if (!order) return [];
  const items = new Set<string>();
  if (order.col4 && order.poMatchStatus !== 'verified') {
    items.add(`🔗 ชนใบสั่งซื้อ ${order.col4} — รอตรวจสอบและยืนยัน`);
  }
  if (order.destMatchStatus === 'auto_flagged') {
    items.add(`⚖️ ชนตั๋วชั่งปลายทาง ${order.col17 || order.linkedViaDocNo || ''} อัตโนมัติ (ตามเลขอ้างอิง DO)`);
  }
  if (!order.autoFlagsVerified && order.autoActionFlags) {
    order.autoActionFlags.forEach(f => items.add(f));
  }
  return Array.from(items);
}

/**
 * Generates a full SystemBackupPayload ready to export as JSON
 */
export function createSystemBackupPayload(params: {
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  stores: StoreMerchant[];
  projects: ProjectRecord[];
  lineInbox: LineBillInboxItem[];
  users: AppUser[];
  rolePermissions: Record<UserRole, RolePermissions>;
  systemSettings: SystemSettings;
  billingNotes?: BillingNoteRecord[];
  exportedBy: string;
}): SystemBackupPayload {
  const now = new Date().toISOString();
  return {
    version: '2.1.0',
    exportedAt: now,
    exportedBy: params.exportedBy,
    companyName: params.systemSettings.companyName,
    counts: {
      orders: params.orders.length,
      pos: params.pos.length,
      stores: params.stores.length,
      projects: params.projects.length,
      lineInbox: params.lineInbox.length,
      users: params.users.length,
      billingNotes: (params.billingNotes || []).length
    },
    data: {
      orders: params.orders,
      pos: params.pos,
      stores: params.stores,
      projects: params.projects,
      lineInbox: params.lineInbox,
      users: params.users,
      rolePermissions: params.rolePermissions,
      systemSettings: {
        ...params.systemSettings,
        lastBackupAt: now
      },
      billingNotes: params.billingNotes || []
    }
  };
}

/**
 * Triggers a browser file download of the backup JSON payload
 */
export function downloadBackupJson(payload: SystemBackupPayload) {
  const datePart = payload.exportedAt.slice(0, 10);
  const timePart = new Date(payload.exportedAt).toTimeString().slice(0, 5).replace(':', '');
  const filename = `AutoStore_FullBackup_${datePart}_${timePart}.json`;
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
