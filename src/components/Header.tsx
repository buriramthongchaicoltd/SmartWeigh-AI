import React, { useEffect, useState, useRef } from 'react';
import {
  Sparkles,
  Plus,
  FileSpreadsheet,
  Store,
  FileText,
  BarChart3,
  Building2,
  ScanLine,
  Scale,
  Receipt,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  MessageSquare,
  Bell,
  Users,
  Settings,
  Printer,
  ShieldCheck,
  AlertTriangle,
  Info,
  LogOut,
  CheckCircle2,
  FileCheck2,
  Database
} from 'lucide-react';
import {
  AppUser,
  RolePermissions,
  SystemNotification
} from '../types';
import { DEFAULT_COMPANY_LOGO_URL } from '../utils/systemConfig';

export type MainTabType =
  | 'orders'
  | 'pos'
  | 'dest_wb'
  | 'tax_inv'
  | 'billing'
  | 'line_inbox'
  | 'analytics'
  | 'reports'
  | 'stores'
  | 'projects'
  | 'users'
  | 'settings';

interface HeaderProps {
  activeTab: MainTabType;
  setActiveTab: (tab: MainTabType) => void;
  onOpenScan: () => void;
  onOpenScanPO?: () => void;
  onAddNewOrder: () => void;
  onAddNewStore: () => void;
  onAddNewPO?: () => void;
  onAddNewProject?: () => void;
  onExportExcel: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  isMobileMenuOpen?: boolean;
  onToggleMobileMenu?: () => void;
  // Auth, Permissions & Notifications
  currentUser?: AppUser;
  currentPermissions?: RolePermissions;
  notifications?: SystemNotification[];
  dismissedNotifIds?: string[];
  onDismissNotification?: (id: string) => void;
  onClearDismissedNotifications?: () => void;
  onLogout?: () => void;
  // Database connection status (shown as compact indicator in header)
  isDbConnected?: boolean;
  dbSyncTimestamp?: string | null;
  onSyncDb?: () => void;
  isSyncingDb?: boolean;
}

const TAB_META: Record<MainTabType, { label: string; subtitle: string; badgeText: string; badgeColor: string }> = {
  orders: {
    label: 'ใบส่งของ / ใบส่งสินค้า (DO)',
    subtitle: 'ตารางหลัก 39 คอลัมน์ บันทึกใบส่งของจากร้านค้าทุกชนิด (รวมบิลชั่งน้ำหนักต้นทาง ช่อง 13–15)',
    badgeText: 'ตารางหลัก 39 คอลัมน์',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  pos: {
    label: 'ใบสั่งซื้อ (PO)',
    subtitle: 'บริหารใบสั่งซื้อ ตรวจสอบโควตาส่งมอบ และตัดยอดสะสมอัตโนมัติ (3-Way Matching)',
    badgeText: 'เอกสารบริษัท • ฝ่ายจัดซื้อ',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  dest_wb: {
    label: 'ตั๋วชั่งปลายทาง',
    subtitle: 'รายการตั๋วชั่งน้ำหนักตรวจรับหน้างาน (โซน 4: ช่อง 18–20) สำหรับชนบิลเข้ากับใบส่งของ (DO)',
    badgeText: 'เอกสารบริษัท • ช่อง 18–20',
    badgeColor: 'bg-teal-50 text-teal-700 border-teal-200'
  },
  tax_inv: {
    label: 'ใบเสร็จ/กำกับภาษี',
    subtitle: 'รายการบิลการเงิน/ใบกำกับภาษี (โซน 5–6) สำหรับชนบิลเข้ากับ DO หรือรับของสดหน้าร้าน',
    badgeText: 'เอกสารการเงิน & บัญชี',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-200'
  },
  billing: {
    label: 'ระบบรับวางบิลฝ่ายจัดซื้อ (Express RR)',
    subtitle: 'ชนข้อมูล DO กับใบวางบิลร้านค้า ส่งออกไฟล์เข้าโปรแกรม Express และ Auto-Stamp เลขที่ RR ลงช่อง 5',
    badgeText: '4-Step Express RR',
    badgeColor: 'bg-sky-50 text-sky-800 border-sky-200'
  },
  line_inbox: {
    label: 'กล่องพักบิลจาก LINE',
    subtitle: 'รายการบิลรับเข้าจากกลุ่ม LINE รอตรวจสอบและระบุโครงการก่อนบันทึกเข้าระบบ',
    badgeText: 'LINE OA',
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200'
  },
  analytics: {
    label: 'วิเคราะห์ & การเงิน',
    subtitle: 'รายงานสรุปยอดจัดซื้อ ยอดชำระเงิน หนี้คงค้าง และวิเคราะห์ส่วนต่างน้ำหนัก',
    badgeText: 'รายงานผู้บริหาร',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
  },
  reports: {
    label: 'ออกรายงาน Excel / PDF',
    subtitle: 'ศูนย์ออกรายงานมาตรฐาน A4 PDF พร้อมหัวกระดาษบริษัท ช่องลงนาม 3 ฝ่าย และส่งออก Excel ตามตัวกรอง',
    badgeText: 'รายงานทางการ • Excel & PDF',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  stores: {
    label: 'ทะเบียนร้านค้า',
    subtitle: 'ฐานข้อมูลผู้จำหน่าย คู่ค้า ประวัติการสั่งซื้อ และยอดหนี้คงค้างรายร้านค้า',
    badgeText: 'ข้อมูลหลัก (Master Data)',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  projects: {
    label: 'ทะเบียนโครงการ',
    subtitle: 'ฐานข้อมูลโครงการก่อสร้าง/ไซต์งาน งบประมาณ ยอดสั่งซื้อ PO และยอดรับของจริงรายโครงการ',
    badgeText: 'ข้อมูลหลัก (Master Data)',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  users: {
    label: 'ผู้ใช้งาน & กำหนดสิทธิ์ (Users & Roles)',
    subtitle: 'จัดการบัญชี Username / Password และกำหนดสิทธิ์ Admin / Manager / User',
    badgeText: 'ผู้ดูแลระบบ • RBAC',
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200'
  },
  settings: {
    label: 'ตั้งค่าระบบ & สำรองข้อมูล (Settings & Backup)',
    subtitle: 'ตั้งค่าข้อมูลบริษัท เกณฑ์แจ้งเตือน หมวดหมู่วัสดุ/หน่วยนับไม่ต้องแก้โค้ด และสำรอง/กู้คืนไฟล์ฐานข้อมูล (.json)',
    badgeText: 'ตั้งค่าระบบ & Backup',
    badgeColor: 'bg-slate-100 text-slate-800 border-slate-300'
  }
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenScan,
  onOpenScanPO,
  onAddNewOrder,
  onAddNewStore,
  onAddNewPO,
  onAddNewProject,
  onExportExcel,
  onToggleMobileMenu,
  currentUser,
  currentPermissions,
  notifications = [],
  dismissedNotifIds = [],
  onDismissNotification,
  onClearDismissedNotifications,
  onLogout,
  isDbConnected,
  dbSyncTimestamp,
  onSyncDb,
  isSyncingDb
}) => {
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  const canCreateOrder = currentPermissions ? currentPermissions.canCreateOrder : true;
  const canManagePO = currentPermissions ? currentPermissions.canManagePO : true;
  const canExportReport = currentPermissions ? currentPermissions.canExportReport : true;

  const activeNotifications = notifications.filter(n => !dismissedNotifIds.includes(n.id));
  const criticalCount = activeNotifications.filter(n => n.severity === 'critical').length;

  // Close notification dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut listener: Cmd/Ctrl + S for AI Scan
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!canCreateOrder) return;
        if (activeTab === 'pos' && onOpenScanPO) {
          onOpenScanPO();
        } else {
          onOpenScan();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, onOpenScan, onOpenScanPO, canCreateOrder]);

  const currentMeta = TAB_META[activeTab] || TAB_META.orders;

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 sticky top-0 z-30 shadow-xs print:hidden">
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Mobile Menu Button + Current View Context */}
        <div className="flex items-center gap-3">
          {onToggleMobileMenu && (
            <button
              type="button"
              onClick={onToggleMobileMenu}
              className="lg:hidden p-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              title="เปิดเมนูนำทาง"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                {currentMeta.label}
              </h1>
              <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${currentMeta.badgeColor}`}>
                {currentMeta.badgeText}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden md:block">
              {currentMeta.subtitle}
            </p>
          </div>
        </div>

        {/* Right: Context Action Controls + Notification Bell */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* 1. เมนู ใบส่งของ / ใบส่งสินค้า (DO) */}
          {activeTab === 'orders' && (
            <>
              {canCreateOrder && (
                <>
                  <button
                    onClick={onOpenScan}
                    title="สแกนใบส่งของ / ใบส่งสินค้า (DO) จากร้านค้าด้วย AI (ทางลัด: Ctrl+S)"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <Sparkles className="w-4 h-4 text-blue-200" />
                    <span>สแกนใบส่งของ DO (AI)</span>
                  </button>
                  <button
                    onClick={onAddNewOrder}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-medium transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">เพิ่มใบส่งของ (DO)</span>
                  </button>
                </>
              )}
              {canExportReport && (
                <button
                  onClick={() => setActiveTab('reports')}
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 px-3 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                  title="ออกรายงาน Excel / PDF"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden xl:inline">รายงาน Excel / PDF</span>
                </button>
              )}
            </>
          )}

          {/* 2. เมนู ใบสั่งซื้อ (PO) */}
          {activeTab === 'pos' && canManagePO && (
            <>
              <button
                onClick={onOpenScanPO || onOpenScan}
                title="สแกนใบสั่งซื้อสินค้า (PO) ด้วย AI"
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-indigo-200" />
                <span>สแกนใบสั่งซื้อ PO (AI)</span>
              </button>
              {onAddNewPO && (
                <button
                  onClick={onAddNewPO}
                  className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-medium transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>เปิดใบสั่งซื้อ (PO)</span>
                </button>
              )}
            </>
          )}

          {/* 3. เมนู ตั๋วชั่งปลายทาง */}
          {activeTab === 'dest_wb' && canCreateOrder && (
            <>
              <button
                onClick={onOpenScan}
                title="สแกนตั๋วชั่งน้ำหนักปลายทาง (ช่อง 18–20) ด้วย AI"
                className="bg-teal-600 hover:bg-teal-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-teal-200" />
                <span>สแกนตั๋วชั่งปลายทาง (AI)</span>
              </button>
              <button
                onClick={onAddNewOrder}
                className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-medium transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>คีย์ตั๋วชั่งปลายทาง</span>
              </button>
            </>
          )}

          {/* 4. เมนู ใบเสร็จ/กำกับภาษี */}
          {activeTab === 'tax_inv' && canCreateOrder && (
            <>
              <button
                onClick={onOpenScan}
                title="สแกนใบเสร็จรับเงิน / ใบกำกับภาษีด้วย AI"
                className="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-amber-100" />
                <span>สแกนใบเสร็จ/กำกับภาษี (AI)</span>
              </button>
              <button
                onClick={onAddNewOrder}
                className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-medium transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>คีย์ใบเสร็จ/กำกับภาษี</span>
              </button>
            </>
          )}

          {/* 5. เมนู วิเคราะห์ & การเงิน */}
          {activeTab === 'analytics' && canExportReport && (
            <button
              onClick={onExportExcel}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-100" />
              <span>ส่งออกรายงานการเงิน (Excel)</span>
            </button>
          )}

          {/* 6. เมนู ทะเบียนร้านค้า */}
          {activeTab === 'stores' && canCreateOrder && (
            <button
              onClick={onAddNewStore}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>เพิ่มร้านค้า / คู่ค้าใหม่</span>
            </button>
          )}

          {/* 7. เมนู ทะเบียนโครงการ */}
          {activeTab === 'projects' && onAddNewProject && canCreateOrder && (
            <button
              onClick={onAddNewProject}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>เพิ่มโครงการใหม่</span>
            </button>
          )}

          {/* DB Connection Status Indicator (compact dot) */}
          <button
            type="button"
            onClick={onSyncDb}
            disabled={!isDbConnected || isSyncingDb}
            title={isDbConnected ? `Supabase Cloud PostgreSQL — ซิงก์ล่าสุด: ${dbSyncTimestamp || 'เพิ่งเชื่อมต่อ'}` : 'ยังไม่ได้เชื่อมต่อฐานข้อมูล Supabase'}
            className="flex items-center gap-1.5 px-2 py-2 rounded-xl border transition cursor-pointer text-xs disabled:cursor-default bg-white border-slate-200 hover:bg-slate-50"
          >
            <Database className={`w-3.5 h-3.5 ${isDbConnected ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              isDbConnected ? 'bg-emerald-500 animate-pulse' : isSyncingDb ? 'bg-amber-400 animate-pulse' : 'bg-slate-300'
            }`} />
          </button>

          {/* Notification Bell Dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(prev => !prev)}
              className={`relative p-2 rounded-xl border transition cursor-pointer ${
                activeNotifications.length > 0
                  ? criticalCount > 0
                    ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                    : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
              title="ศูนย์แจ้งเตือนสถานะสำคัญภายในระบบ"
            >
              <Bell className="w-4 h-4" />
              {activeNotifications.length > 0 && (
                <span
                  className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center text-white ${
                    criticalCount > 0 ? 'bg-rose-600 animate-pulse' : 'bg-amber-500'
                  }`}
                >
                  {activeNotifications.length}
                </span>
              )}
            </button>

            {isNotifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50">
                <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold">
                      แจ้งเตือนระบบ ({activeNotifications.length} รายการ)
                    </span>
                  </div>
                  {dismissedNotifIds.length > 0 && onClearDismissedNotifications && (
                    <button
                      type="button"
                      onClick={onClearDismissedNotifications}
                      className="text-[10px] text-sky-300 hover:underline cursor-pointer"
                    >
                      แสดงทั้งหมด ({notifications.length})
                    </button>
                  )}
                </div>

                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                  {activeNotifications.length === 0 ? (
                    <div className="p-6 text-center space-y-1.5">
                      <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
                      <div className="text-xs font-bold text-slate-800">ไม่มีรายการแจ้งเตือนค้าง</div>
                      <div className="text-[11px] text-slate-500">
                        บิล น้ำหนักตาชั่ง และโควตาใบสั่งซื้อทั้งหมดอยู่ในเกณฑ์ปกติ
                      </div>
                    </div>
                  ) : (
                    activeNotifications.map(n => (
                      <div
                        key={n.id}
                        className={`p-3.5 hover:bg-slate-50 transition flex items-start justify-between gap-2.5 ${
                          n.severity === 'critical'
                            ? 'bg-rose-50/40'
                            : n.severity === 'warning'
                            ? 'bg-amber-50/30'
                            : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab(n.targetTab as MainTabType);
                            setIsNotifOpen(false);
                          }}
                          className="text-left flex-1 flex items-start gap-2.5 cursor-pointer"
                        >
                          <div
                            className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${
                              n.severity === 'critical'
                                ? 'bg-rose-100 text-rose-700'
                                : n.severity === 'warning'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {n.severity === 'info' ? (
                              <Info className="w-3.5 h-3.5" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold text-slate-900 leading-snug">
                              {n.title}
                            </div>
                            <div className="text-[11px] text-slate-600 leading-relaxed">
                              {n.message}
                            </div>
                            <div className="text-[10px] font-semibold text-blue-600 pt-0.5">
                              คลิกเพื่อเปิดดูรายการ →
                            </div>
                          </div>
                        </button>
                        {onDismissNotification && (
                          <button
                            type="button"
                            onClick={() => onDismissNotification(n.id)}
                            className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                            title="ซ่อนการแจ้งเตือนนี้"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

const formatActionBadgeCount = (count: number) =>
  count > 99 ? '99+' : count.toLocaleString('th-TH');

export const SidebarNav: React.FC<{
  activeTab: MainTabType;
  setActiveTab: (tab: MainTabType) => void;
  unmatchedDestWB: number;
  pendingLineInbox?: number;
  pendingOrderReview?: number;
  pendingBillingRR?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  currentUser?: AppUser;
  currentPermissions?: RolePermissions;
  onLogout?: () => void;
  companyName?: string;
  companyLogoUrl?: string;
}> = ({
  activeTab,
  setActiveTab,
  unmatchedDestWB,
  pendingLineInbox = 0,
  pendingOrderReview = 0,
  pendingBillingRR = 0,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  currentUser,
  currentPermissions,
  onLogout,
  companyName = 'บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด',
  companyLogoUrl = DEFAULT_COMPANY_LOGO_URL
}) => {
  const [logoImgFailed, setLogoImgFailed] = useState(false);

  const handleSelect = (tab: MainTabType) => {
    setActiveTab(tab);
    onCloseMobile();
  };

  const isTabAllowed = (tab: MainTabType) => {
    if (!currentPermissions) return true;
    return currentPermissions.allowedTabs.includes(tab);
  };

  const renderNavContent = (collapsed: boolean) => (
    <div className="flex flex-col h-full justify-between select-none overflow-y-auto">
      <div className="space-y-3.5 p-3">
        {/* Brand Header inside Sidebar */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} pb-3 border-b border-slate-800`}>
          <div className="flex items-center gap-2.5 overflow-hidden" title={companyName}>
            <div className="w-9 h-9 rounded-xl bg-white text-slate-900 flex items-center justify-center shadow-sm shrink-0 overflow-hidden p-0.5 border border-slate-700">
              {companyLogoUrl && !logoImgFailed ? (
                <img
                  src={companyLogoUrl}
                  alt={companyName}
                  className="w-full h-full object-contain"
                  onError={() => setLogoImgFailed(true)}
                />
              ) : (
                <ScanLine className="w-5 h-5 text-blue-600" />
              )}
            </div>
            {!collapsed && (
              <div className="truncate">
                <div className="text-xs font-bold text-white tracking-tight truncate">{companyName}</div>
                <div className="text-[10px] text-slate-400 truncate">AutoStore & 39-Col ERP</div>
              </div>
            )}
          </div>

          {!collapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="ย่อแถบเมนูซ้ายเพื่อขยายตาราง 39 คอลัมน์"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* GROUP 1: เอกสาร & การรับของ (Documents & Reconciliation) */}
        <div className="space-y-1">
          {!collapsed && (
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              เอกสาร & ชนบิล
            </div>
          )}

          {/* 0. กล่องพักบิลจาก LINE OA Bot */}
          {isTabAllowed('line_inbox') && (
            <button
              type="button"
              onClick={() => handleSelect('line_inbox')}
              title={pendingLineInbox > 0
                ? `กล่องพักบิล LINE — ต้องตรวจหรือสแกนซ้ำ ${pendingLineInbox.toLocaleString('th-TH')} รายการ`
                : 'กล่องพักบิลจาก LINE OA'}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer relative ${
                activeTab === 'line_inbox'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <MessageSquare className={`w-4 h-4 shrink-0 ${activeTab === 'line_inbox' ? 'text-white' : 'text-emerald-400'}`} />
                {!collapsed && <span className="truncate">กล่องพักบิลจาก LINE</span>}
              </div>
              {!collapsed ? (
                <div className="flex items-center gap-1">
                  {pendingLineInbox > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-400 text-slate-950"
                      title={`รายการ LINE ที่ต้องตรวจหรือสแกนซ้ำ ${pendingLineInbox.toLocaleString('th-TH')} รายการ`}
                    >
                      ต้องตรวจ {formatActionBadgeCount(pendingLineInbox)}
                    </span>
                  )}
                </div>
              ) : pendingLineInbox > 0 ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1.5 right-1.5 animate-ping" />
              ) : null}
            </button>
          )}

          {/* 1. ใบส่งของ / ใบส่งสินค้า (DO) */}
          {isTabAllowed('orders') && (
            <button
              type="button"
              onClick={() => handleSelect('orders')}
              title={pendingOrderReview > 0
                ? `ใบส่งของ / ใบส่งสินค้า (DO) — รอตรวจยืนยัน ${pendingOrderReview.toLocaleString('th-TH')} รายการ`
                : 'ใบส่งของ / ใบส่งสินค้า (DO)'}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <FileText className={`w-4 h-4 shrink-0 ${activeTab === 'orders' ? 'text-white' : 'text-sky-400'}`} />
                {!collapsed && <span className="truncate">ใบส่งของ / ใบส่งสินค้า (DO)</span>}
              </div>
              {!collapsed && (
                pendingOrderReview > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-400 text-slate-950"
                    title={`รายการ DO ที่ยังรอตรวจยืนยันการทำงานอัตโนมัติ ${pendingOrderReview.toLocaleString('th-TH')} รายการ`}
                  >
                    รอตรวจ {formatActionBadgeCount(pendingOrderReview)}
                  </span>
                )
              )}
              {collapsed && pendingOrderReview > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1.5 right-1.5" />
              )}
            </button>
          )}

          {/* 2. ใบสั่งซื้อ (PO) */}
          {isTabAllowed('pos') && (
            <button
              type="button"
              onClick={() => handleSelect('pos')}
              title="ใบสั่งซื้อ (PO)"
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'pos'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Building2 className={`w-4 h-4 shrink-0 ${activeTab === 'pos' ? 'text-white' : 'text-indigo-400'}`} />
                {!collapsed && <span className="truncate">ใบสั่งซื้อ (PO)</span>}
              </div>
            </button>
          )}

          {/* 3. ตั๋วชั่งปลายทาง */}
          {isTabAllowed('dest_wb') && (
            <button
              type="button"
              onClick={() => handleSelect('dest_wb')}
              title={unmatchedDestWB > 0
                ? `ตั๋วชั่งปลายทาง — รอจับคู่ ${unmatchedDestWB.toLocaleString('th-TH')} รายการ`
                : 'ตั๋วชั่งปลายทาง'}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer relative ${
                activeTab === 'dest_wb'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Scale className={`w-4 h-4 shrink-0 ${activeTab === 'dest_wb' ? 'text-white' : 'text-teal-400'}`} />
                {!collapsed && <span className="truncate">ตั๋วชั่งปลายทาง</span>}
              </div>
              {!collapsed ? (
                <div className="flex items-center gap-1">
                  {unmatchedDestWB > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-400 text-slate-950"
                      title={`ตั๋วชั่งปลายทางที่ยังรอจับคู่ ${unmatchedDestWB.toLocaleString('th-TH')} รายการ`}
                    >
                      รอชน {formatActionBadgeCount(unmatchedDestWB)}
                    </span>
                  )}
                </div>
              ) : unmatchedDestWB > 0 ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1.5 right-1.5 animate-ping" />
              ) : null}
            </button>
          )}

          {/* 4. ใบเสร็จ/กำกับภาษี */}
          {isTabAllowed('tax_inv') && (
            <button
              type="button"
              onClick={() => handleSelect('tax_inv')}
              title="ใบเสร็จ/กำกับภาษี"
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer relative ${
                activeTab === 'tax_inv'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Receipt className={`w-4 h-4 shrink-0 ${activeTab === 'tax_inv' ? 'text-white' : 'text-amber-400'}`} />
                {!collapsed && <span className="truncate">ใบเสร็จ/กำกับภาษี</span>}
              </div>
            </button>
          )}

          {/* 5. ระบบรับวางบิลฝ่ายจัดซื้อ (Express RR) */}
          {isTabAllowed('billing') && (
            <button
              type="button"
              onClick={() => handleSelect('billing')}
              title={pendingBillingRR > 0
                ? `ระบบรับวางบิลฝ่ายจัดซื้อ — รอเลข RR ${pendingBillingRR.toLocaleString('th-TH')} ชุด`
                : 'ระบบรับวางบิลฝ่ายจัดซื้อ & เชื่อมต่อโปรแกรม Express (4 Steps)'}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer relative ${
                activeTab === 'billing'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <FileCheck2 className={`w-4 h-4 shrink-0 ${activeTab === 'billing' ? 'text-white' : 'text-sky-400'}`} />
                {!collapsed && <span className="truncate">รับวางบิล (Express RR)</span>}
              </div>
              {!collapsed ? (
                <div className="flex items-center gap-1">
                  {pendingBillingRR > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-400 text-slate-950"
                      title={`ชุดวางบิลที่ยังรอเลข RR จาก Express ${pendingBillingRR.toLocaleString('th-TH')} ชุด`}
                    >
                      รอ RR {formatActionBadgeCount(pendingBillingRR)}
                    </span>
                  )}
                </div>
              ) : pendingBillingRR > 0 ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1.5 right-1.5 animate-ping" />
              ) : null}
            </button>
          )}
        </div>

        {/* GROUP 2: รายงาน & การเงิน (Analytics, Excel & PDF Reports) */}
        {(isTabAllowed('analytics') || isTabAllowed('reports')) && (
          <>
            <div className="border-t border-slate-800/90" />
            <div className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  รายงาน & การเงิน
                </div>
              )}

              {isTabAllowed('analytics') && (
                <button
                  type="button"
                  onClick={() => handleSelect('analytics')}
                  title="วิเคราะห์ & การเงิน"
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'analytics'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <BarChart3 className={`w-4 h-4 shrink-0 ${activeTab === 'analytics' ? 'text-white' : 'text-purple-400'}`} />
                    {!collapsed && <span className="truncate">วิเคราะห์ & การเงิน</span>}
                  </div>
                </button>
              )}

              {isTabAllowed('reports') && (
                <button
                  type="button"
                  onClick={() => handleSelect('reports')}
                  title="ออกรายงาน Excel / PDF"
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'reports'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Printer className={`w-4 h-4 shrink-0 ${activeTab === 'reports' ? 'text-white' : 'text-emerald-400'}`} />
                    {!collapsed && <span className="truncate">ออกรายงาน Excel / PDF</span>}
                  </div>
                </button>
              )}
            </div>
          </>
        )}

        {/* GROUP 3: ทะเบียนข้อมูลหลัก (Master Data) */}
        {(isTabAllowed('stores') || isTabAllowed('projects')) && (
          <>
            <div className="border-t border-slate-800/90" />
            <div className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  ข้อมูลหลัก (Master)
                </div>
              )}

              {isTabAllowed('stores') && (
                <button
                  type="button"
                  onClick={() => handleSelect('stores')}
                  title="ทะเบียนร้านค้า"
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'stores'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Store className={`w-4 h-4 shrink-0 ${activeTab === 'stores' ? 'text-white' : 'text-indigo-400'}`} />
                    {!collapsed && <span className="truncate">ทะเบียนร้านค้า</span>}
                  </div>
                </button>
              )}

              {isTabAllowed('projects') && (
                <button
                  type="button"
                  onClick={() => handleSelect('projects')}
                  title="ทะเบียนโครงการ"
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'projects'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <FolderKanban className={`w-4 h-4 shrink-0 ${activeTab === 'projects' ? 'text-white' : 'text-emerald-400'}`} />
                    {!collapsed && <span className="truncate">ทะเบียนโครงการ</span>}
                  </div>
                </button>
              )}
            </div>
          </>
        )}

        {/* GROUP 4: ผู้ดูแลระบบ & ตั้งค่า (Users, Roles, Settings & Backup) */}
        {(isTabAllowed('users') || isTabAllowed('settings')) && (
          <>
            <div className="border-t border-slate-800/90" />
            <div className="space-y-1">
              {!collapsed && (
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  ผู้ดูแลระบบ & ตั้งค่า
                </div>
              )}

              {isTabAllowed('users') && (
                <button
                  type="button"
                  onClick={() => handleSelect('users')}
                  title="ผู้ใช้งาน & สิทธิ์ (Users & Roles)"
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'users'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Users className={`w-4 h-4 shrink-0 ${activeTab === 'users' ? 'text-white' : 'text-rose-400'}`} />
                    {!collapsed && <span className="truncate">ผู้ใช้งาน & สิทธิ์</span>}
                  </div>
                </button>
              )}

              {isTabAllowed('settings') && (
                <button
                  type="button"
                  onClick={() => handleSelect('settings')}
                  title="ตั้งค่าระบบ & สำรองข้อมูล"
                  className={`w-full flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2'} rounded-xl text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'settings'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Settings className={`w-4 h-4 shrink-0 ${activeTab === 'settings' ? 'text-white' : 'text-sky-400'}`} />
                    {!collapsed && <span className="truncate">ตั้งค่าระบบ & สำรองข้อมูล</span>}
                  </div>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom User Card & Collapse Button */}
      <div className="p-3 border-t border-slate-800 space-y-2">
        {currentUser && onLogout && (
          <button
            type="button"
            onClick={onLogout}
            title="ออกจากระบบ"
            className={`w-full flex items-center ${
              collapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-2'
            } rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-left transition cursor-pointer`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-white truncate">{currentUser.fullName}</div>
                  <div className="text-[10px] text-sky-400 truncate">
                    {currentPermissions?.label || currentUser.role} • ออกจากระบบ
                  </div>
                </div>
              )}
            </div>
            {!collapsed && <LogOut className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
          </button>
        )}

        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden lg:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer"
          title={collapsed ? 'ขยายเมนูด้านซ้าย' : 'ย่อเมนูด้านซ้ายเพื่อเพิ่มพื้นที่ตาราง 39 คอลัมน์'}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4 text-blue-400" />
          ) : (
            <>
              <PanelLeftClose className="w-4 h-4 text-slate-400" />
              <span>ย่อเมนู (ขยายตาราง)</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Left Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-slate-900 text-white border-r border-slate-800 shrink-0 sticky top-0 h-screen z-40 transition-all duration-200 print:hidden ${
          isCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {renderNavContent(isCollapsed)}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex print:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <aside className="relative w-64 max-w-[80vw] bg-slate-900 text-white h-full z-10 flex flex-col shadow-2xl">
            <button
              type="button"
              onClick={onCloseMobile}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            {renderNavContent(false)}
          </aside>
        </div>
      )}
    </>
  );
};
