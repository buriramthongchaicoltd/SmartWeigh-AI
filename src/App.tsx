/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Header, SidebarNav, MainTabType } from './components/Header';
import { StatSummaryCards } from './components/StatSummaryCards';
import { TableView39Cols } from './components/TableView39Cols';
import { LoginModal } from './components/LoginModal';
import {
  OrderRecord,
  StoreMerchant,
  PurchaseOrder,
  ProjectRecord,
  LineBillInboxItem,
  AppUser,
  UserRole,
  RolePermissions,
  SystemSettings,
  SystemBackupPayload,
  BillingNoteRecord
} from './types';
import { isExactDocNumberReference, extractDocReferences, checkDuplicateOrder, checkDuplicatePO } from './utils/poReconciliation';
import { convertOrderDraftToPODraft } from './utils/lineBillRemapper';
import { safeSaveToLocalStorage } from './utils/storageEngine';
import {
  STORAGE_SETTINGS_KEY,
  STORAGE_DISMISSED_NOTIFS_KEY,
  STORAGE_BILLING_NOTES_KEY,
  SYSTEM_MASTER_ADMIN,
  DEFAULT_USERS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SYSTEM_SETTINGS,
  normalizeSystemSettings,
  computeSystemNotifications,
  hasUnverifiedAutoActions
} from './utils/systemConfig';
import { CheckCircle2, RefreshCw, AlertTriangle, Database, X } from 'lucide-react';

const loadPOManagementView = () => import('./components/POManagementView');
const loadPODetailModal = () => import('./components/PODetailModal');
const loadPOEditModal = () => import('./components/POEditModal');
const loadStoresManagement = () => import('./components/StoresManagementView');
const loadAnalyticsView = () => import('./components/AnalyticsView');
const loadLineInboxView = () => import('./components/LineInboxView');
const loadReportsExportView = () => import('./components/ReportsExportView');
const loadPurchasingBillingView = () => import('./components/PurchasingBillingView');
const loadUsersRolesView = () => import('./components/UsersRolesView');
const loadSystemSettingsView = () => import('./components/SystemSettingsView');
const loadScanModal = () => import('./components/ScanModal');
const loadVerifyModal = () => import('./components/VerifyModal');
const loadStoreDetailModal = () => import('./components/StoreDetailModal');
const loadStoreEditModal = () => import('./components/StoreEditModal');

const POManagementView = React.lazy(() => loadPOManagementView().then(module => ({ default: module.POManagementView })));
const PODetailModal = React.lazy(() => loadPODetailModal().then(module => ({ default: module.PODetailModal })));
const POEditModal = React.lazy(() => loadPOEditModal().then(module => ({ default: module.POEditModal })));
const StoresManagementView = React.lazy(() => loadStoresManagement().then(module => ({ default: module.StoresManagementView })));
const ProjectsManagementView = React.lazy(() => loadStoresManagement().then(module => ({ default: module.ProjectsManagementView })));
const AnalyticsView = React.lazy(() => loadAnalyticsView().then(module => ({ default: module.AnalyticsView })));
const LineInboxView = React.lazy(() => loadLineInboxView().then(module => ({ default: module.LineInboxView })));
const ReportsExportView = React.lazy(() => loadReportsExportView().then(module => ({ default: module.ReportsExportView })));
const PurchasingBillingView = React.lazy(() => loadPurchasingBillingView().then(module => ({ default: module.PurchasingBillingView })));
const UsersRolesView = React.lazy(() => loadUsersRolesView().then(module => ({ default: module.UsersRolesView })));
const SystemSettingsView = React.lazy(() => loadSystemSettingsView().then(module => ({ default: module.SystemSettingsView })));
const ScanModal = React.lazy(() => loadScanModal().then(module => ({ default: module.ScanModal })));
const VerifyModal = React.lazy(() => loadVerifyModal().then(module => ({ default: module.VerifyModal })));
const StoreDetailModal = React.lazy(() => loadStoreDetailModal().then(module => ({ default: module.StoreDetailModal })));
const StoreEditModal = React.lazy(() => loadStoreEditModal().then(module => ({ default: module.StoreEditModal })));

const STORAGE_ORDERS_KEY = 'autostore_real_orders_v2';
const STORAGE_STORES_KEY = 'autostore_real_stores_v2';
const STORAGE_POS_KEY = 'autostore_real_pos_v2';
const STORAGE_PROJECTS_KEY = 'autostore_real_projects_v2';
const STORAGE_LINE_INBOX_KEY = 'autostore_line_inbox_v1';

class DeferredChunkErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Failed to load a deferred application module.', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p>โหลดส่วนหนึ่งของระบบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-lg bg-red-700 px-3 py-2 font-semibold text-white hover:bg-red-800"
          >
            โหลดระบบใหม่
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DeferredModalFallback = () => (
  <div
    role="status"
    aria-live="polite"
    className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 p-4 text-sm font-semibold text-slate-700"
  >
    <div className="rounded-xl bg-white px-5 py-4 shadow-xl">กำลังเตรียมหน้าต่าง...</div>
  </div>
);

// Helper to recalculate store financials strictly from actual order records (Single Source of Truth)
const syncStoreFinancials = (storesList: StoreMerchant[], ordersList: OrderRecord[]): StoreMerchant[] => {
  return storesList.map(store => {
    const storeOrders = ordersList.filter(
      o => (o.storeId === store.id || (o.col8 && o.col8.trim().toLowerCase() === store.name.trim().toLowerCase())) &&
           o.docType !== 'dest_weighbridge'
    );
    const hasPricedDeliveries = storeOrders.some(
      o => o.docType !== 'tax_invoice' && (Number(o.col29) > 0 || Number(o.col25) > 0)
    );
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    let validOrderCount = 0;
    let lastDate = store.lastOrderDate || '';
    storeOrders.forEach(o => {
      // Skip tax invoices that have already been matched/merged into a DO's Zone 5-6
      if (o.docType === 'tax_invoice' && o.linkedViaDocNo) return;
      // Prevent double-counting purchase value if store already has priced DO/Weighbridge records,
      // while still counting standalone tax invoices or Zone 6 payments recorded on unmatched tax invoices
      if (o.docType === 'tax_invoice' && hasPricedDeliveries) {
        totalPaid += Number(o.col35) || 0;
        totalDebt += Number(o.col36) || 0;
      } else {
        validOrderCount++;
        totalPurchases += Number(o.col29) || 0;
        totalPaid += Number(o.col35) || 0;
        totalDebt += Number(o.col36) || 0;
      }
      if (o.col7 && o.col7 > lastDate) lastDate = o.col7;
    });

    return {
      ...store,
      totalOrders: validOrderCount,
      totalPurchases,
      totalPaid,
      totalDebt,
      lastOrderDate: lastDate || store.lastOrderDate
    };
  });
};

// Recover missing Zone 4 fields without rewriting implausible OCR weight values.
const normalizeOrderWeights = (ord: OrderRecord): OrderRecord => {
  const next = { ...ord };
  const snap: Record<string, any> = (next.rawAiSnapshot as Record<string, any>) || {};

  if (next.docType === 'dest_weighbridge') {
    if (!next.col16) {
      next.col16 = next.col7 || snap.rawDate || snap.col16 || snap.col7 || '';
    }
    if (!next.col17) {
      next.col17 = next.col6 || snap.rawDocNo || snap.col17 || snap.col6 || '';
    }
    if (!Number(next.col18) && !Number(next.col20)) {
      const recoveredGross =
        Number(next.col13) ||
        Number(snap.rawGrossWeightKg) ||
        Number(snap.col18) ||
        Number(snap.col13) ||
        0;
      const recoveredTare =
        Number(next.col14) ||
        Number(snap.rawTareWeightKg) ||
        Number(snap.col19) ||
        Number(snap.col14) ||
        0;
      let recoveredNet =
        Number(next.col15) ||
        Number(snap.rawNetWeightKg) ||
        Number(snap.col20) ||
        Number(snap.col15) ||
        0;
      if (!recoveredNet && recoveredGross >= recoveredTare && recoveredGross > 0 && recoveredTare > 0) {
        recoveredNet = recoveredGross - recoveredTare;
      }
      next.col18 = recoveredGross;
      next.col19 = recoveredTare;
      next.col20 = recoveredNet;
      next.col13 = 0;
      next.col14 = 0;
      next.col15 = 0;
    }
  }

  const c13 = Number(next.col13) || 0;
  const c14 = Number(next.col14) || 0;
  if (c13 > 0 && c14 > 0 && c13 >= c14 && !next.col15) {
    next.col15 = c13 - c14;
  }

  const c18 = Number(next.col18) || 0;
  const c19 = Number(next.col19) || 0;
  if (c18 > 0 && c19 > 0 && c18 >= c19 && !next.col20) {
    next.col20 = c18 - c19;
  }

  if (Number(next.col15) > 0 && Number(next.col20) > 0) {
    next.col21 = Number(next.col15) - Number(next.col20);
  }
  return next;
};

// Self-healing reconciliation across DOs and Destination Weighbridge tickets (Zone 4)
// Ensures that whenever a DO has a linked Zone 4 ticket (or vice versa), Zone 4 columns (16-21) on the DO are always populated
const reconcileAndHealOrders = (ordersList: OrderRecord[]): OrderRecord[] => {
  const list = ordersList.map(normalizeOrderWeights);

  for (let i = 0; i < list.length; i++) {
    const ticket = list[i];
    if (ticket.docType !== 'dest_weighbridge') continue;

    const ticketNo = ticket.col17 || ticket.col6 || '';
    const textRefs = extractDocReferences(ticket.col38);
    const refCandidates = [ticket.referenceDocNo, ...textRefs.doNumbers].filter(Boolean) as string[];

    // Find linked DO (matched via matchedDestTicketId, linkedViaDocNo, col17, or autoActionFlags/col38)
    const doIdx = list.findIndex(ord => {
      if (ord.id === ticket.id || ord.docType === 'dest_weighbridge' || ord.docType === 'tax_invoice') return false;
      if (ord.matchedDestTicketId && ord.matchedDestTicketId === ticket.id) return true;
      if (ticket.linkedViaDocNo && isExactDocNumberReference(ord.col6, ticket.linkedViaDocNo)) return true;
      if (ord.col17 && ticketNo && isExactDocNumberReference(ord.col17, ticketNo)) return true;
      if (!ticket.linkedViaDocNo && !ticket.autoFlagsVerified && ord.col6 && refCandidates.some(ref => isExactDocNumberReference(ord.col6, ref))) return true;
      return false;
    });

    if (doIdx >= 0) {
      const targetDO = list[doIdx];
      const grossD = Number(targetDO.col18) || Number(ticket.col18) || 0;
      const tareD = Number(targetDO.col19) || Number(ticket.col19) || 0;
      const netD =
        Number(targetDO.col20) ||
        Number(ticket.col20) ||
        (grossD > 0 && tareD > 0 && grossD >= tareD ? grossD - tareD : 0);
      const netO = Number(targetDO.col15) || 0;
      const diff = netO > 0 && netD > 0 ? netO - netD : Number(targetDO.col21) || 0;
      const destDate = targetDO.col16 || ticket.col16 || ticket.col7 || targetDO.col7 || '';

      list[doIdx] = {
        ...targetDO,
        col16: destDate,
        col17: targetDO.col17 || ticketNo,
        col18: grossD,
        col19: tareD,
        col20: netD,
        col21: diff,
        matchedDestTicketId: targetDO.matchedDestTicketId || ticket.id,
        destMatchStatus: targetDO.destMatchStatus || ticket.destMatchStatus || 'auto_flagged'
      };

      if (!ticket.linkedViaDocNo) {
        list[i] = {
          ...ticket,
          linkedViaDocNo: targetDO.col6 || '',
          destMatchStatus: ticket.destMatchStatus || targetDO.destMatchStatus || 'auto_flagged'
        };
      }
    }
  }

  return list;
};

export default function App() {
  // Main Data States (100% Real Database Mode - Loaded directly from Supabase Cloud PostgreSQL)
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [stores, setStores] = useState<StoreMerchant[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [lineInbox, setLineInbox] = useState<LineBillInboxItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<UserRole, RolePermissions>>(DEFAULT_ROLE_PERMISSIONS);
  const [billingNotes, setBillingNotes] = useState<BillingNoteRecord[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [authenticatedUser, setAuthenticatedUser] = useState<AppUser | null>(null);
  const [isAuthChecked, setIsAuthChecked] = useState<boolean>(false);
  const [dismissedNotifIds, setDismissedNotifIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const authSessionWarningRef = useRef(false);

  const showToast = React.useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    if (toastTimeoutRef.current !== null) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = type === 'error'
      ? null
      : window.setTimeout(() => {
          setToast(null);
          toastTimeoutRef.current = null;
        }, 5000);
  }, []);

  // Database Connection & Synchronization Status (100% Real Database Mode)
  const [isDbLoaded, setIsDbLoaded] = useState<boolean>(false);
  const [isDbConnected, setIsDbConnected] = useState<boolean>(false);
  const [dbSyncTimestamp, setDbSyncTimestamp] = useState<string | null>(null);
  const [isSyncingDb, setIsSyncingDb] = useState<boolean>(false);

  // Central Database Fetcher: Loads from Supabase Cloud PostgreSQL
  const fetchDatabaseData = React.useCallback(async () => {
    setIsSyncingDb(true);
    try {
      const res = await fetch('/api/database/sync-all', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json?.success || !json?.data) {
        throw new Error(json?.error || `โหลดข้อมูลฐานข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
      }
      if (json.data) {
        setIsDbConnected(true);
        setDbSyncTimestamp(new Date().toLocaleTimeString('th-TH'));

        const d = json.data;
        const queryErrors: Record<string, string> =
          json.queryErrors && typeof json.queryErrors === 'object' ? json.queryErrors : {};
        const queryErrorDetails = Object.entries(queryErrors)
          .map(([table, message]) => `${table}: ${message}`)
          .join('\n');
        if (queryErrorDetails) {
          showToast(`โหลดข้อมูลฐานข้อมูลได้ไม่ครบ ตารางที่ผิดพลาดจะไม่ถูกเขียนทับ:\n${queryErrorDetails}`, 'error');
        }

        // Always load all records directly from Supabase Cloud PostgreSQL
        if (!queryErrors.orders && Array.isArray(d.orders)) setOrders(reconcileAndHealOrders(d.orders));
        if (!queryErrors.purchase_orders && Array.isArray(d.pos)) setPos(d.pos);
        if (!queryErrors.stores && Array.isArray(d.stores)) setStores(d.stores);
        if (!queryErrors.projects && Array.isArray(d.projects)) setProjects(d.projects);
        if (!queryErrors.billing_notes && Array.isArray(d.billingNotes)) setBillingNotes(d.billingNotes);
        if (!queryErrors.line_inbox && Array.isArray(d.lineInbox)) setLineInbox(d.lineInbox);
        if (!queryErrors.app_users && Array.isArray(d.users)) setUsers(d.users);
        if (!queryErrors.system_config && d.systemSettings) setSystemSettings(normalizeSystemSettings(d.systemSettings));

        const hasDbOrdersOrStores = (d.orders?.length || 0) > 0 || (d.stores?.length || 0) > 0 || (d.pos?.length || 0) > 0;
        const hasCoreTableErrors = Boolean(queryErrors.orders || queryErrors.stores || queryErrors.purchase_orders);
        if (!hasDbOrdersOrStores && !hasCoreTableErrors) {
          // If DB is newly connected and completely empty, check if user has old localStorage data to migrate
          try {
            const rawOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
            const rawStores = localStorage.getItem(STORAGE_STORES_KEY);
            const rawPos = localStorage.getItem(STORAGE_POS_KEY);
            const rawProjects = localStorage.getItem(STORAGE_PROJECTS_KEY);
            const localOrders = rawOrders ? JSON.parse(rawOrders) : [];
            const localStores = rawStores ? JSON.parse(rawStores) : [];
            const localPos = rawPos ? JSON.parse(rawPos) : [];
            const localProjects = rawProjects ? JSON.parse(rawProjects) : [];

            if (localOrders.length > 0 || localStores.length > 0 || localPos.length > 0) {
              const migrationResponse = await fetch('/api/database/migrate-local-to-cloud', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orders: localOrders,
                  stores: localStores,
                  pos: localPos,
                  projects: localProjects,
                  billingNotes: []
                })
              });
              const migrationResult = await migrationResponse.json();
              if (!migrationResponse.ok || !migrationResult?.success) {
                throw new Error(migrationResult?.error || `ย้ายข้อมูลเดิมขึ้นฐานข้อมูลไม่สำเร็จ (HTTP ${migrationResponse.status})`);
              }
              setOrders(reconcileAndHealOrders(localOrders));
              setStores(localStores);
              setPos(localPos);
              setProjects(localProjects);
              localStorage.removeItem(STORAGE_ORDERS_KEY);
              localStorage.removeItem(STORAGE_STORES_KEY);
              localStorage.removeItem(STORAGE_POS_KEY);
              localStorage.removeItem(STORAGE_PROJECTS_KEY);
            }
          } catch (e) {
            console.error('[DB Migration] Failed to migrate local data:', e);
            const reason = e instanceof Error ? `: ${e.message}` : '';
            showToast(`ย้ายข้อมูลเดิมขึ้นฐานข้อมูลไม่สำเร็จ ข้อมูลเดิมยังเก็บไว้ในอุปกรณ์${reason}`, 'error');
          }
        } else if (Object.keys(queryErrors).length === 0) {
          // Clear legacy local storage once DB is successfully loaded with data
          try {
            localStorage.removeItem(STORAGE_ORDERS_KEY);
            localStorage.removeItem(STORAGE_STORES_KEY);
            localStorage.removeItem(STORAGE_POS_KEY);
            localStorage.removeItem(STORAGE_PROJECTS_KEY);
            localStorage.removeItem(STORAGE_LINE_INBOX_KEY);
            localStorage.removeItem(STORAGE_BILLING_NOTES_KEY);
          } catch {}
        }
      }
    } catch (err) {
      console.error('[DB Startup] Failed to load database:', err);
      setIsDbConnected(false);
      const reason = err instanceof Error ? `: ${err.message}` : '';
      showToast(`เชื่อมต่อหรือโหลดข้อมูลฐานข้อมูลไม่สำเร็จ${reason}`, 'error');
    } finally {
      setIsDbLoaded(true);
      setIsSyncingDb(false);
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/startup/auto-check', { method: 'POST' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'การตรวจสอบระบบเริ่มต้นไม่สำเร็จ');
        }
      })
      .catch(error => {
        if (!cancelled) {
          console.error('[Startup] Automatic service check failed:', error);
          const reason = error instanceof Error ? `: ${error.message}` : '';
          showToast(`ตรวจสอบบริการตอนเริ่มระบบไม่สำเร็จ${reason}`, 'error');
        }
      });
    return () => { cancelled = true; };
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
          if (!cancelled) setIsAuthChecked(true);
          return;
        }
        const result = await response.json();
        if (!cancelled && result.success && result.user) {
          setAuthenticatedUser(result.user);
          setCurrentUserId(result.user.id);
          await fetchDatabaseData();
        }
      } catch (error) {
        console.error('[Auth] Could not restore login session:', error);
        const reason = error instanceof Error ? `: ${error.message}` : '';
        showToast(`ตรวจสอบสถานะเข้าสู่ระบบไม่สำเร็จ${reason}`, 'error');
      } finally {
        if (!cancelled) setIsAuthChecked(true);
      }
    };
    restoreSession();
    return () => { cancelled = true; };
  }, [fetchDatabaseData, showToast]);

  useEffect(() => {
    if (!authenticatedUser) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.status === 401) await handleLogout();
        else if (!response.ok) throw new Error(`HTTP ${response.status}`);
        else authSessionWarningRef.current = false;
      } catch (error) {
        console.error('[Auth] Session check failed:', error);
        if (!authSessionWarningRef.current) {
          authSessionWarningRef.current = true;
          const reason = error instanceof Error ? `: ${error.message}` : '';
          showToast(`ตรวจสอบการเชื่อมต่อบัญชีไม่สำเร็จ${reason}`, 'error');
        }
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [authenticatedUser, showToast]);

  // Active User & Current Role Permissions
  const currentUser = useMemo(() => {
    return (
      authenticatedUser ||
      users.find(u => u.id === currentUserId && u.status === 'active') ||
      DEFAULT_USERS[0]
    );
  }, [authenticatedUser, users, currentUserId]);

  const currentPermissions = useMemo(() => {
    return rolePermissions[currentUser.role] || DEFAULT_ROLE_PERMISSIONS.admin;
  }, [rolePermissions, currentUser.role]);

  // Computed Real-Time System Notifications
  const notifications = useMemo(() => {
    return computeSystemNotifications(orders, pos, lineInbox, systemSettings);
  }, [orders, pos, lineInbox, systemSettings]);

  // Navigation tab & Left Sidebar state
  const [activeTab, setActiveTab] = useState<MainTabType>('orders');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [triggerCreateProjectCounter, setTriggerCreateProjectCounter] = useState(0);
  const [tableExternalFilter, setTableExternalFilter] = useState<string | null>(null);

  // Ensure activeTab is always allowed for currentUser's role
  useEffect(() => {
    if (
      currentPermissions &&
      Array.isArray(currentPermissions.allowedTabs) &&
      currentPermissions.allowedTabs.length > 0 &&
      !currentPermissions.allowedTabs.includes(activeTab)
    ) {
      setActiveTab((currentPermissions.allowedTabs[0] as MainTabType) || 'orders');
    }
  }, [currentPermissions, activeTab]);

  // Bill Scan & Verify Modals
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [verifyOrderData, setVerifyOrderData] = useState<Partial<OrderRecord> | null>(null);
  const [verifyImage, setVerifyImage] = useState<string | null>(null);
  const [verifyStoreSuggestion, setVerifyStoreSuggestion] = useState<Partial<StoreMerchant> | undefined>(undefined);

  // PO Modals
  const [selectedPOForDetail, setSelectedPOForDetail] = useState<PurchaseOrder | null>(null);
  const [isPOEditOpen, setIsPOEditOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);
  const [initialStoreNameForPO, setInitialStoreNameForPO] = useState<string | undefined>(undefined);

  // Store Detail & Edit Modals
  const [selectedStoreForDetail, setSelectedStoreForDetail] = useState<StoreMerchant | null>(null);
  const [isStoreEditOpen, setIsStoreEditOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreMerchant | null>(null);

  // Toast Notification
  const failedDbSyncTablesRef = useRef(new Set<string>());

  // Database Operations (100% Real Database Persistence - Supabase PostgreSQL)
  const saveDbTimerRef = React.useRef<Record<string, any>>({});
  const debouncedSyncToDb = React.useCallback((table: string, records: any[]) => {
    if (saveDbTimerRef.current[table]) {
      clearTimeout(saveDbTimerRef.current[table]);
    }
    saveDbTimerRef.current[table] = setTimeout(async () => {
      const saveBatch = async (attempt: number): Promise<void> => {
        try {
          const response = await fetch('/api/database/save-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, records })
          });
          const result = await response.json();
          if (!response.ok || !result?.success) {
            throw new Error(result?.error || `HTTP ${response.status}`);
          }
          failedDbSyncTablesRef.current.delete(table);
        } catch (err) {
          if (attempt < 2) {
            window.setTimeout(() => void saveBatch(attempt + 1), 1000 * (attempt + 1));
            return;
          }
          console.error(`[DB Sync] Failed to sync ${table} to Supabase after retries:`, err);
          if (!failedDbSyncTablesRef.current.has(table)) {
            failedDbSyncTablesRef.current.add(table);
            const reason = err instanceof Error ? `: ${err.message}` : '';
            showToast(`บันทึกข้อมูล ${table} ลงฐานข้อมูลไม่สำเร็จ ข้อมูลบนหน้าจออาจยังไม่ถูกบันทึก${reason}`, 'error');
          }
        }
      };

      void saveBatch(0);
    }, 1200);
  }, [showToast]);

  const deleteRecordFromDb = React.useCallback(async (table: string, id: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/database/delete-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id })
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      console.error(`[DB Delete] Failed to delete ${id} from ${table}:`, err);
      const reason = err instanceof Error ? `: ${err.message}` : '';
      showToast(`ลบข้อมูลจากฐานข้อมูลไม่สำเร็จ${reason} รายการยังคงอยู่ในระบบ`, 'error');
      return false;
    }
  }, [showToast]);

  useEffect(() => {
    if (!isDbLoaded) return;
    debouncedSyncToDb('orders', orders);
  }, [orders, isDbLoaded, debouncedSyncToDb]);

  useEffect(() => {
    if (!isDbLoaded) return;
    debouncedSyncToDb('stores', stores);
  }, [stores, isDbLoaded, debouncedSyncToDb]);

  useEffect(() => {
    if (!isDbLoaded) return;
    debouncedSyncToDb('purchase_orders', pos);
  }, [pos, isDbLoaded, debouncedSyncToDb]);

  useEffect(() => {
    if (!isDbLoaded) return;
    debouncedSyncToDb('projects', projects);
  }, [projects, isDbLoaded, debouncedSyncToDb]);

  useEffect(() => {
    if (!isDbLoaded) return;
    debouncedSyncToDb('billing_notes', billingNotes);
  }, [billingNotes, isDbLoaded, debouncedSyncToDb]);

  useEffect(() => {
    if (!isDbLoaded) return;
    debouncedSyncToDb('line_inbox', lineInbox);
  }, [lineInbox, isDbLoaded, debouncedSyncToDb]);

  useEffect(() => {
    if (!isDbLoaded) return;
    fetch('/api/database/save-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'system_config',
        record: {
          config_key: 'system_settings',
          config_value: systemSettings
        }
      })
    }).catch(err => console.warn('[DB Sync] Failed to save system settings:', err));
  }, [systemSettings, isDbLoaded]);

  useEffect(() => {
    safeSaveToLocalStorage(STORAGE_DISMISSED_NOTIFS_KEY, dismissedNotifIds);
  }, [dismissedNotifIds]);

  // Real-Time Multi-User Sync: Keep lineInbox strictly synced from Supabase Cloud so all users see identical bills
  const lastInboxSyncWarningRef = useRef(0);
  const syncWebhookQueueToLocal = React.useCallback(async () => {
    const warnOnce = (message: string) => {
      if (Date.now() - lastInboxSyncWarningRef.current < 60_000) return;
      lastInboxSyncWarningRef.current = Date.now();
      showToast(message, 'error');
    };

    try {
      const resp = await fetch('/api/line/inbox');
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        warnOnce(data?.error || 'โหลดกล่องพัก LINE จากฐานข้อมูลไม่สำเร็จ');
        return;
      }
      const incoming: LineBillInboxItem[] = Array.isArray(data?.items) ? data.items : [];
      setLineInbox(current => {
        const unchanged = current.length === incoming.length && current.every((item, index) => {
          const nextItem = incoming[index];
          return nextItem &&
            item.id === nextItem.id &&
            JSON.stringify({ ...item, image: '', lineReplyToken: undefined }) ===
              JSON.stringify({ ...nextItem, image: '', lineReplyToken: undefined });
        });
        return unchanged ? current : incoming;
      });
    } catch (err: any) {
      console.warn('[LINE Inbox] Failed to refresh from server:', err);
      warnOnce('เชื่อมต่อกล่องพัก LINE ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตหรือฐานข้อมูล');
    }
  }, [showToast]);

  useEffect(() => {
    if (!authenticatedUser) return;
    syncWebhookQueueToLocal();
    const timer = setInterval(syncWebhookQueueToLocal, 8000);
    return () => clearInterval(timer);
  }, [authenticatedUser, syncWebhookQueueToLocal]);

  // Google Drive Verified-Only Move Trigger
  // "ย้ายไฟล์บน Google Drive จะย้ายก็ต่อเมื่อมีการยืนยันแล้วเท่านั้น ถ้าระบบชนบิลโดยยังไม่มีการยืนยันห้ามย้าย"
  const triggerDriveVerifiedMove = async (params: {
    action: 'confirm_match' | 'revoke_match';
    destTicketFileId: string;
    destTicketDocNo?: string;
    doTrNumber?: string;
    doDocNumber?: string;
  }) => {
    try {
      const resp = await fetch('/api/drive/sync-verified-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      console.log('[Google Drive Move Success]:', data.message);
    } catch (err) {
      console.error('[Google Drive Move Error]:', err);
      const reason = err instanceof Error ? `: ${err.message}` : '';
      showToast(`อัปเดตตำแหน่งไฟล์ที่ยืนยันบน Google Drive ไม่สำเร็จ${reason}`, 'error');
    }
  };

  // Google Drive Zero-Junk Cleanup Trigger
  const triggerDriveCleanup = async (params: {
    mode: 'delete_old_file' | 'delete_order_cascade';
    oldFileId?: string;
    orderFolderId?: string;
    orderFileIds?: string[];
    destTicketFileIdToRescue?: string;
  }) => {
    try {
      const response = await fetch('/api/drive/cleanup-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('[Google Drive Cleanup Error]:', err);
      const reason = err instanceof Error ? `: ${err.message}` : '';
      showToast(`จัดการไฟล์บน Google Drive ไม่สำเร็จ${reason}`, 'error');
    }
  };

  // User Auth & Management Handlers
  const handleLoginSuccess = async (loggedInUser: AppUser) => {
    setAuthenticatedUser(loggedInUser);
    setCurrentUserId(loggedInUser.id);
    await fetchDatabaseData();
    showToast(`เข้าใช้งานในชื่อ "${loggedInUser.fullName}" (${rolePermissions[loggedInUser.role]?.label || loggedInUser.role})`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('[Auth] Logout request failed:', error);
      const reason = error instanceof Error ? `: ${error.message}` : '';
      showToast(`แจ้งออกจากระบบไปยังเซิร์ฟเวอร์ไม่สำเร็จ${reason}`, 'error');
    } finally {
      setAuthenticatedUser(null);
      setCurrentUserId('');
      setUsers([]);
      setIsDbLoaded(false);
      setOrders([]);
      setPos([]);
      setStores([]);
      setProjects([]);
      setLineInbox([]);
      setBillingNotes([]);
      setIsAuthChecked(true);
    }
  };

  const handleSaveUser = async (userToSave: AppUser, isNew: boolean) => {
    const response = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userToSave })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'บันทึกบัญชีผู้ใช้ไม่สำเร็จ');
    const savedUser: AppUser = result.user;
    setUsers(prev => {
      if (isNew) return [...prev, savedUser];
      return prev.map(u => (u.id === savedUser.id ? savedUser : u));
    });
    showToast(
      isNew
        ? `เพิ่มผู้ใช้งาน "${savedUser.fullName}" เรียบร้อยแล้ว`
        : `อัปเดตข้อมูลผู้ใช้ "${savedUser.fullName}" เรียบร้อยแล้ว`
    );
  };

  const handleToggleUserStatus = (userId: string) => {
    const target = users.find(u => u.id === userId);
    if (!target) return;
    if (target.isSystemMaster || target.id === SYSTEM_MASTER_ADMIN.id) {
      showToast('บัญชีหลักมาสเตอร์ (Admin) ติดกับระบบถาวร ไม่สามารถระงับการใช้งานได้', 'info');
      return;
    }

    if (target.status === 'active') {
      const activeAdmins = users.filter(u => u.role === 'admin' && u.status === 'active');
      if (target.role === 'admin' && activeAdmins.length <= 1) {
        showToast('ไม่สามารถระงับผู้ดูแลระบบ (Admin) คนสุดท้ายที่เปิดใช้งานอยู่ได้', 'info');
        return;
      }
    }

    const nextStatus = target.status === 'active' ? 'suspended' : 'active';
    void handleSaveUser({ ...target, status: nextStatus, password: '' }, false).then(() => {
      showToast(
        nextStatus === 'suspended'
          ? `ระงับการใช้งานบัญชี "${target.fullName}" ชั่วคราวแล้ว`
          : `เปิดใช้งานบัญชี "${target.fullName}" ตามปกติแล้ว`
      );
    }).catch(error => showToast(error.message || 'อัปเดตสถานะผู้ใช้ไม่สำเร็จ', 'info'));
  };

  // Restore Backup Handler (Merge or Overwrite)
  const handleRestoreBackup = (payload: SystemBackupPayload, mode: 'merge' | 'overwrite') => {
    const d = payload.data;
    if (!d) return;

    if (mode === 'overwrite') {
      const nextOrders = (d.orders || []).map(normalizeOrderWeights);
      const nextStores = syncStoreFinancials(d.stores || [], nextOrders);
      setOrders(nextOrders);
      setPos(d.pos || []);
      setStores(nextStores);
      setProjects(d.projects || []);
      setLineInbox(d.lineInbox || []);
      setUsers(d.users || []);
      if (d.rolePermissions) setRolePermissions(d.rolePermissions);
      if (d.systemSettings) setSystemSettings(d.systemSettings);
      if (d.billingNotes) setBillingNotes(d.billingNotes);
      showToast(`กู้คืนข้อมูลแบบทับทั้งหมดสำเร็จ! (บิล ${nextOrders.length} ใบ • PO ${(d.pos || []).length} ใบ)`);
    } else {
      // Merge mode: append records whose ID does not exist yet
      setOrders(prevOrders => {
        const existingIds = new Set(prevOrders.map(o => o.id));
        const incoming = (d.orders || []).filter(o => !existingIds.has(o.id)).map(normalizeOrderWeights);
        const mergedOrders = [...incoming, ...prevOrders];

        setStores(prevStores => {
          const storeIds = new Set(prevStores.map(s => s.id));
          const storeNames = new Set(prevStores.map(s => s.name.trim().toLowerCase()));
          const incomingStores = (d.stores || []).filter(
            s => !storeIds.has(s.id) && !storeNames.has(s.name.trim().toLowerCase())
          );
          return syncStoreFinancials([...incomingStores, ...prevStores], mergedOrders);
        });

        return mergedOrders;
      });

      setPos(prevPos => {
        const existingIds = new Set(prevPos.map(p => p.id));
        const incoming = (d.pos || []).filter(p => !existingIds.has(p.id));
        return [...incoming, ...prevPos];
      });

      setProjects(prevProjects => {
        const existingNames = new Set(prevProjects.map(p => p.name.trim().toLowerCase()));
        const incoming = (d.projects || []).filter(p => !existingNames.has(p.name.trim().toLowerCase()));
        return [...incoming, ...prevProjects];
      });

      setLineInbox(prevInbox => {
        const existingIds = new Set(prevInbox.map(i => i.id));
        const incoming = (d.lineInbox || []).filter(i => !existingIds.has(i.id));
        return [...incoming, ...prevInbox];
      });

      if (Array.isArray(d.billingNotes)) {
        setBillingNotes(prevNotes => {
          const existingIds = new Set(prevNotes.map(n => n.id));
          const incoming = (d.billingNotes || []).filter(n => !existingIds.has(n.id));
          return [...incoming, ...prevNotes];
        });
      }

      showToast('ผสานข้อมูลจากไฟล์สำรอง (Merge) เข้าสู่ระบบเรียบร้อยแล้ว!');
    }
  };

  // ============================================================================
  // 4-STEP PURCHASING BILLING NOTE & EXPRESS RR HANDLERS
  // ============================================================================
  const handleSaveBillingNote = (note: BillingNoteRecord, isNew: boolean) => {
    setBillingNotes(prev => {
      if (isNew) return [note, ...prev];
      return prev.map(n => (n.id === note.id ? note : n));
    });

    // Mark included DOs as IN_BILLING and update their Zone 5 weights/qty/transport adjustments
    const linesByOrderId = new Map<string, typeof note.lines>();
    note.lines.forEach(l => {
      const arr = linesByOrderId.get(l.orderId) || [];
      arr.push(l);
      linesByOrderId.set(l.orderId, arr);
    });

    setOrders(prevOrders => {
      const nextOrders = prevOrders.map(ord => {
        const orderLines = linesByOrderId.get(ord.id);
        if (!orderLines || orderLines.length === 0) {
          if (ord.billingNoteId === note.id && ord.billingStatus !== 'BILLED') {
            return {
              ...ord,
              billingStatus: 'UNBILLED' as const,
              billingNoteId: undefined
            };
          }
          return ord;
        }
        const firstLine = orderLines[0];
        const sumMaterial = Number(
          orderLines.reduce((acc, l) => acc + (Number(l.materialAmount) || 0), 0).toFixed(2)
        );
        const sumFreight = Number(
          orderLines.reduce((acc, l) => acc + (Number(l.freightAmount) || 0), 0).toFixed(2)
        );
        const sumQty = Number(
          orderLines.reduce((acc, l) => acc + (Number(l.qty) || 0), 0).toFixed(3)
        );
        const updatedLineItems =
          orderLines.length > 1 || (ord.lineItems && ord.lineItems.length > 0)
            ? orderLines.map((l, idx) => ({
                id: `${ord.id}-item-${idx}`,
                itemDescription: l.itemDescription,
                specCode: l.specCode || '',
                qty: l.qty,
                unit: l.unit,
                unitPrice: l.unitPrice,
                totalAmount: l.materialAmount
              }))
            : ord.lineItems;

        return {
          ...ord,
          lineItems: updatedLineItems,
          col11:
            orderLines.length > 1
              ? orderLines.map(l => l.itemDescription).join(', ')
              : firstLine.itemDescription || ord.col11,
          col22: orderLines.length === 1 ? firstLine.qty : sumQty,
          col23: orderLines.length === 1 ? firstLine.unit : ord.col23,
          col24:
            orderLines.length === 1
              ? firstLine.unitPrice
              : sumQty > 0
              ? Number((sumMaterial / sumQty).toFixed(2))
              : firstLine.unitPrice,
          col25: sumMaterial,
          col26: firstLine.truckType,
          col27: firstLine.freightRate,
          col28: sumFreight,
          col29: Number((sumMaterial + sumFreight).toFixed(2)),
          billingStatus: note.status === 'rr_stamped_billed' ? ('BILLED' as const) : ('IN_BILLING' as const),
          billingNoteId: note.id
        };
      });
      setStores(prevStores => syncStoreFinancials(prevStores, nextOrders));
      return nextOrders;
    });

    showToast(
      isNew
        ? `สร้างชุดรับวางบิล ${note.id} (${note.orderIds.length} ใบ DO · ${note.lines.length} รายการ) เรียบร้อยแล้ว`
        : `อัปเดตชุดรับวางบิล ${note.id} เรียบร้อยแล้ว`
    );
  };

  const handleStampExpressRR = (billingNoteId: string, rrNumber: string) => {
    const targetNote = billingNotes.find(b => b.id === billingNoteId);
    if (!targetNote) return;
    const nowIso = new Date().toISOString();

    const updatedNote: BillingNoteRecord = {
      ...targetNote,
      expressRrNumber: rrNumber,
      rrStampedAt: nowIso,
      rrStampedBy: currentUser.fullName,
      status: 'rr_stamped_billed',
      updatedAt: nowIso
    };

    setBillingNotes(prev => prev.map(b => (b.id === billingNoteId ? updatedNote : b)));

    const linesByOrderId = new Map<string, typeof targetNote.lines>();
    targetNote.lines.forEach(l => {
      const arr = linesByOrderId.get(l.orderId) || [];
      arr.push(l);
      linesByOrderId.set(l.orderId, arr);
    });

    setOrders(prevOrders => {
      const nextOrders = prevOrders.map(ord => {
        const orderLines = linesByOrderId.get(ord.id);
        if (!orderLines || orderLines.length === 0) return ord;

        const firstLine = orderLines[0];
        const sumMaterial = Number(
          orderLines.reduce((acc, l) => acc + (Number(l.materialAmount) || 0), 0).toFixed(2)
        );
        const sumFreight = Number(
          orderLines.reduce((acc, l) => acc + (Number(l.freightAmount) || 0), 0).toFixed(2)
        );
        const sumQty = Number(
          orderLines.reduce((acc, l) => acc + (Number(l.qty) || 0), 0).toFixed(3)
        );

        const paidVendor = Number(ord.col31) || 0;
        const paidTransport = Number(ord.col33) || 0;
        const totalPaid = paidVendor + paidTransport;
        const nextCol29 = Number((sumMaterial + sumFreight).toFixed(2));
        const owedVendor = Math.max(0, Number((sumMaterial - paidVendor).toFixed(2)));
        const owedTransport = Math.max(0, Number((sumFreight - paidTransport).toFixed(2)));
        const totalDebt = Math.max(0, Number((nextCol29 - totalPaid).toFixed(2)));

        const updatedLineItems =
          orderLines.length > 1 || (ord.lineItems && ord.lineItems.length > 0)
            ? orderLines.map((l, idx) => ({
                id: `${ord.id}-item-${idx}`,
                itemDescription: l.itemDescription,
                specCode: l.specCode || '',
                qty: l.qty,
                unit: l.unit,
                unitPrice: l.unitPrice,
                totalAmount: l.materialAmount
              }))
            : ord.lineItems;

        return {
          ...ord,
          lineItems: updatedLineItems,
          col11:
            orderLines.length > 1
              ? orderLines.map(l => l.itemDescription).join(', ')
              : firstLine.itemDescription || ord.col11,
          col5: rrNumber, // Auto-Stamp Express RR into Zone 1 col5!
          col22: orderLines.length === 1 ? firstLine.qty : sumQty,
          col23: orderLines.length === 1 ? firstLine.unit : ord.col23,
          col24:
            orderLines.length === 1
              ? firstLine.unitPrice
              : sumQty > 0
              ? Number((sumMaterial / sumQty).toFixed(2))
              : firstLine.unitPrice,
          col25: sumMaterial,
          col26: firstLine.truckType,
          col27: firstLine.freightRate,
          col28: sumFreight,
          col29: nextCol29,
          col30: ord.col30 || `เครดิตวางบิล (${targetNote.id})`,
          col32: owedVendor,
          col34: owedTransport,
          col35: totalPaid,
          col36: totalDebt,
          billingStatus: 'BILLED' as const,
          billingNoteId: targetNote.id,
          updatedBy: currentUser.fullName
        };
      });
      setStores(prevStores => syncStoreFinancials(prevStores, nextOrders));
      return nextOrders;
    });

    showToast(
      `Auto-Stamp เลขที่ RR "${rrNumber}" ลงช่อง 5 ของใบ DO ทั้ง ${targetNote.orderIds.length} ใบ (${targetNote.lines.length} รายการ) และล็อกสถานะ BILLED สำเร็จ!`
    );
  };

  const handleUnbillBillingNote = (billingNoteId: string) => {
    const targetNote = billingNotes.find(b => b.id === billingNoteId);
    if (!targetNote) return;
    const nowIso = new Date().toISOString();

    setBillingNotes(prev =>
      prev.map(b =>
        b.id === billingNoteId
          ? {
              ...b,
              status: 'exported_express',
              updatedAt: nowIso
            }
          : b
      )
    );

    const orderIdsSet = new Set(targetNote.orderIds);
    setOrders(prevOrders => {
      const nextOrders = prevOrders.map(ord => {
        if (!orderIdsSet.has(ord.id)) return ord;
        return {
          ...ord,
          col5: '',
          billingStatus: 'IN_BILLING' as const
        };
      });
      setStores(prevStores => syncStoreFinancials(prevStores, nextOrders));
      return nextOrders;
    });

    showToast(`ปลดล็อกชุดวางบิล ${billingNoteId} เพื่อแก้ไขเลข RR หรือรายการแล้ว`);
  };

  const handleDeleteBillingNote = async (billingNoteId: string) => {
    const targetNote = billingNotes.find(b => b.id === billingNoteId);
    if (!targetNote) return;
    if (!(await deleteRecordFromDb('billing_notes', billingNoteId))) return;
    const orderIdsSet = new Set(targetNote.orderIds);

    setBillingNotes(prev => prev.filter(b => b.id !== billingNoteId));
    setOrders(prevOrders => {
      const nextOrders = prevOrders.map(ord => {
        if (!orderIdsSet.has(ord.id)) return ord;
        return {
          ...ord,
          col5: ord.col5 === targetNote.expressRrNumber ? '' : ord.col5,
          billingStatus: 'UNBILLED' as const,
          billingNoteId: undefined
        };
      });
      setStores(prevStores => syncStoreFinancials(prevStores, nextOrders));
      return nextOrders;
    });

    showToast(`ลบชุดรับวางบิล ${billingNoteId} และคืนสถานะใบ DO ให้วางบิลใหม่ได้แล้ว`);
  };

  // AI Scan completion handler
  const handleScanComplete = (
    data: Partial<OrderRecord>,
    imageBase64: string,
    storeSuggestion?: Partial<StoreMerchant>
  ) => {
    // If Gemini identified this as a Purchase Order (PO):
    if (data.docType === 'purchase_order') {
      const newPO: PurchaseOrder = {
        id: `po-${Date.now()}`,
        poNumber: data.col4 || data.col6 || '',
        orderDate: data.col7 || '',
        deliveryDueDate: '',
        projectId: data.col2 || '',
        storeName: data.col8 || '',
        supplierName: data.supplierName || data.col8 || '',
        buyerName: data.buyerName || '',
        documentIssuerName: data.documentIssuerName || '',
        documentIssuerRole: data.documentIssuerRole || 'uncertain',
        partyRoleEvidence: data.partyRoleEvidence || '',
        partyRoleConfidence: Number(data.partyRoleConfidence) || 0,
        category: data.col3 || 'งานจัดซื้อทั่วไป',
        items: data.lineItems && data.lineItems.length > 0 
          ? data.lineItems.map((item, idx) => ({
              id: `item-${Date.now()}-${idx}`,
              itemDescription: item.itemDescription || '',
              specCode: item.specCode || '',
              orderedQty: Number(item.qty) || 0,
              unit: item.unit || '',
              unitPrice: item.unitPrice || 0,
              totalAmount: Number(item.totalAmount) || 0
            }))
          : data.col11 ? [{
              id: `item-${Date.now()}-0`,
              itemDescription: data.col11,
              specCode: data.col12 || '',
              orderedQty: Number(data.col22) || 0,
              unit: data.col23 || '',
              unitPrice: Number(data.col24) || 0,
              totalAmount: Number(data.col25) || Number(data.col29) || 0
            }] : [],
        totalQty: Number(data.col22) || (data.lineItems?.reduce((s, i) => s + (Number(i.qty) || 0), 0) || 0),
        totalAmount: Number(data.col29) || Number(data.col25) || 0,
        status: 'pending',
        creditTerms: data.col30 || '',
        deliveryLocation: data.col37 || '',
        orderedBy: data.col9 || '',
        notes: data.col38 || '',
        image: imageBase64,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setEditingPO(newPO);
      setIsPOEditOpen(true);
      showToast('AI ตรวจพบว่าเป็น "ใบสั่งซื้อสินค้า (PO)" นำเข้าสู่ระบบ PO ให้ตรวจสอบแล้ว!');
      return;
    }

    setVerifyOrderData(data);
    setVerifyImage(imageBase64);
    setVerifyStoreSuggestion(storeSuggestion);
    setIsVerifyOpen(true);
    showToast('Gemini AI สแกนเอกสารสำเร็จ! กรุณาตรวจสอบข้อมูล');
  };

  // Switch from VerifyModal to POEditModal when user selects or detects PO
  const handleSwitchVerifyToPO = (draftPO: Partial<PurchaseOrder>) => {
    setIsVerifyOpen(false);
    setVerifyOrderData(null);
    setVerifyImage(null);
    setEditingPO(draftPO as PurchaseOrder);
    setIsPOEditOpen(true);
    showToast('สลับเข้าสู่หน้าต่างบันทึกใบสั่งซื้อ (PO) เรียบร้อยแล้ว');
  };

  // Save verified order (either new or updated) with automatic DO matching for dest_weighbridge and tax_invoice
  const handleSaveOrder = async (order: OrderRecord, storeToSave?: StoreMerchant, allowDuplicate = false): Promise<boolean> => {
    const isExistingRecord = orders.some(o => o.id === order.id);
    if (!isExistingRecord) {
      const blockingDups = checkDuplicateOrder(order, orders, order.image).filter(
        d => d.level === 'exact' || d.level === 'suspected'
      );
      if (blockingDups.length > 0 && !allowDuplicate) {
        showToast(`พบรายการที่อาจซ้ำกับ ${blockingDups[0].matchedOrder.col1} กรุณาตรวจสอบและยืนยันก่อนบันทึก`, 'info');
        return false;
      }
    }

    let verifiedLineItem: LineBillInboxItem | undefined;
    let verifiedLineTargetZone: OrderRecord['driveFileLocation'];
    let verifiedLineFileId: string | undefined;
    if (order.lineInboxId) {
      verifiedLineItem = lineInbox.find(item => item.id === order.lineInboxId);
      if (!verifiedLineItem?.driveFileId) {
        showToast('ยังบันทึกใบตรวจรับไม่ได้: ไม่พบรูปที่จัดเก็บใน Google Drive กรุณาซิงก์รูปให้สำเร็จก่อน', 'info');
        return false;
      }
      verifiedLineFileId = verifiedLineItem.driveFileId;

      const targetZone: NonNullable<OrderRecord['driveFileLocation']> =
        order.docType === 'dest_weighbridge' ? 'zone_03' :
        order.docType === 'tax_invoice' ? 'zone_04' :
        'zone_02';
      verifiedLineTargetZone = targetZone;
      if (verifiedLineItem.driveFileLocation !== targetZone) {
        try {
          const driveResponse = await fetch('/api/drive/rename-and-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId: verifiedLineItem.driveFileId,
              docType: order.docType || 'delivery_order',
              docDate: (order.docType === 'dest_weighbridge' && order.col16)
                ? order.col16
                : order.col7 || new Date().toISOString().slice(0, 10),
              docNumber: order.col6 || order.col4 || order.col17 || order.col1 || ''
            })
          });
          const driveResult = await driveResponse.json();
          if (!driveResponse.ok || !driveResult?.success || driveResult.targetZone !== targetZone) {
            throw new Error(driveResult?.error || `Google Drive ไม่ยืนยันการย้ายรูปไป ${targetZone}`);
          }
          verifiedLineItem = {
            ...verifiedLineItem,
            driveFileLocation: targetZone
          };
        } catch (err: any) {
          console.error('[LINE Inbox] Could not move image before saving order:', err);
          showToast(`ยังไม่ได้บันทึกใบตรวจรับ เพราะย้ายรูปใน Google Drive ไม่สำเร็จ: ${err?.message || 'ตรวจสอบการเชื่อมต่อ Drive'}`, 'error');
          return false;
        }
      }
    }

    let autoMatchedNote = '';

    // Zero-Junk Cleanup: Detect if image was replaced or deleted, and trash the old Google Drive file
    if (isExistingRecord) {
      const prevOrder = orders.find(o => o.id === order.id);
      if (prevOrder && prevOrder.driveFileId) {
        if (!order.image || (order.image && order.image !== prevOrder.image)) {
          triggerDriveCleanup({ mode: 'delete_old_file', oldFileId: prevOrder.driveFileId });
        }
      }
    }

    setOrders(prev => {
      let workingList = [...prev];
      const previousOrder = isExistingRecord ? orders.find(existing => existing.id === order.id) : undefined;
      let orderToSave: OrderRecord = normalizeOrderWeights({
        ...order,
        image: verifiedLineItem
          ? verifiedLineItem.driveWebViewLink ||
            `https://drive.google.com/uc?export=view&id=${encodeURIComponent(verifiedLineFileId || '')}`
          : order.image,
        driveFileId: verifiedLineFileId ||
          ((previousOrder?.image !== order.image && order.driveFileId === previousOrder?.driveFileId)
            ? undefined
            : order.driveFileId),
        driveFileLocation: verifiedLineTargetZone || order.driveFileLocation,
        createdBy: order.createdBy || currentUser.fullName,
        updatedBy: currentUser.fullName
      });

      // =========================================================================
      // STRICT REFERENCE-NUMBER-ONLY AUTO-MATCHING (ZONES 1-4) + VERIFICATION FLAGS
      // ห้ามใช้ข้อมูลทั่วไป (เช่น ทะเบียนรถ ชื่อร้าน สินค้า) มาเดาชนบิลอัตโนมัติเด็ดขาด!
      // ต้องชนจาก "เลขที่เอกสารอ้างอิง" (ในช่องฟอร์ม, ในหมายเหตุ, หรือลายมือเขียน) เท่านั้น
      // และทุกรายการที่ระบบทำอัตโนมัติ ต้องติดธง (auto_flagged) ให้ผู้ใช้ตรวจสอบและยืนยันเสมอ
      // =========================================================================
      const autoFlagsSet = new Set<string>(orderToSave.autoActionFlags || []);

      if (!isExistingRecord && orderToSave.aiExtracted) {
        autoFlagsSet.add('🤖 AI สแกนและสกัดข้อมูลจากรูปบิลอัตโนมัติ');
      }

      // 1A. Case 1: Saving an unlinked Destination Weighbridge ticket -> Auto-match to Origin DO strictly by Reference DO Number
      if (orderToSave.docType === 'dest_weighbridge' && !orderToSave.linkedViaDocNo) {
        const textRefs = extractDocReferences(orderToSave.col38);
        const refCandidates = [
          orderToSave.referenceDocNo,
          ...textRefs.doNumbers
        ].filter(Boolean) as string[];

        if (refCandidates.length > 0) {
          const candIdx = workingList.findIndex(ord => {
            if (ord.id === orderToSave.id || ord.docType === 'dest_weighbridge' || ord.docType === 'tax_invoice') return false;
            if (Number(ord.col18) > 0 || Number(ord.col20) > 0) return false;
            if (!ord.col6) return false;
            return refCandidates.some(ref => isExactDocNumberReference(ord.col6, ref));
          });

          if (candIdx >= 0) {
            const candidate = workingList[candIdx];
            const grossD = Number(orderToSave.col18) || 0;
            const tareD = Number(orderToSave.col19) || 0;
            const netD = Number(orderToSave.col20) || Math.max(0, grossD - tareD);
            const netO = Number(candidate.col15) || 0;
            const diff = (netO > 0 && netD > 0) ? (netO - netD) : 0;
            const destTicketNo = orderToSave.col17 || orderToSave.col6 || orderToSave.col1;
            const candFlags = new Set<string>(candidate.autoActionFlags || []);
            candFlags.add(`⚖️ ชนตั๋วชั่งปลายทาง #${destTicketNo} เข้าโซน 4 อัตโนมัติ (อ้างอิงเลข DO ${candidate.col6})`);

            workingList[candIdx] = {
              ...candidate,
              col16: orderToSave.col16 || orderToSave.col7 || '',
              col17: destTicketNo,
              col18: grossD,
              col19: tareD,
              col20: netD,
              col21: diff,
              destMatchStatus: 'auto_flagged',
              matchedDestTicketId: orderToSave.id,
              autoActionFlags: Array.from(candFlags),
              autoFlagsVerified: false,
              updatedBy: currentUser.fullName,
              col38: candidate.col38
                ? `${candidate.col38} | ชนตั๋วปลายทางอัตโนมัติ: ${destTicketNo}`
                : `ชนตั๋วปลายทางอัตโนมัติ: ${destTicketNo}`
            };
            orderToSave.linkedViaDocNo = candidate.col6;
            orderToSave.destMatchStatus = 'auto_flagged';
            autoFlagsSet.add(`⚖️ ชนเข้าใบส่งของ DO ${candidate.col6 || candidate.col1} อัตโนมัติ (ตามเลขอ้างอิง)`);
            orderToSave.autoActionFlags = Array.from(autoFlagsSet);
            orderToSave.autoFlagsVerified = false;
            autoMatchedNote = `🚩 ชนตั๋วชั่งปลายทางเข้ากับ DO ${candidate.col6 || candidate.col1} อัตโนมัติแล้ว (ติดธงรอตรวจสอบยืนยัน)`;
          }
        }
      }

      // 1B. Case 2 (Reverse Direction): Saving an Origin DO -> Check if an unlinked Destination Weighbridge ticket is waiting with a matching DO Reference!
      if (orderToSave.docType !== 'dest_weighbridge' && orderToSave.docType !== 'tax_invoice') {
        if (Number(orderToSave.col18) === 0 && Number(orderToSave.col20) === 0 && orderToSave.col6) {
          const doTextRefs = extractDocReferences(orderToSave.col38);
          const waitingDestIdx = workingList.findIndex(ticket => {
            if (ticket.id === orderToSave.id || ticket.docType !== 'dest_weighbridge' || ticket.linkedViaDocNo) return false;
            const ticketTextRefs = extractDocReferences(ticket.col38);
            const ticketRefsToDO = [ticket.referenceDocNo, ...ticketTextRefs.doNumbers].filter(Boolean) as string[];
            const matchesDO = ticketRefsToDO.some(ref => isExactDocNumberReference(orderToSave.col6, ref));
            const doRefsToTicket = [orderToSave.col17, ...doTextRefs.doNumbers].filter(Boolean) as string[];
            const matchesTicketNo = Boolean(ticket.col17 && doRefsToTicket.some(ref => isExactDocNumberReference(ticket.col17, ref)));
            return matchesDO || matchesTicketNo;
          });

          if (waitingDestIdx >= 0) {
            const waitingTicket = workingList[waitingDestIdx];
            const grossD = Number(waitingTicket.col18) || 0;
            const tareD = Number(waitingTicket.col19) || 0;
            const netD = Number(waitingTicket.col20) || Math.max(0, grossD - tareD);
            const netO = Number(orderToSave.col15) || 0;
            const diff = (netO > 0 && netD > 0) ? (netO - netD) : 0;
            const destTicketNo = waitingTicket.col17 || waitingTicket.col6 || waitingTicket.col1;

            orderToSave.col16 = waitingTicket.col16 || waitingTicket.col7 || orderToSave.col7;
            orderToSave.col17 = destTicketNo;
            orderToSave.col18 = grossD;
            orderToSave.col19 = tareD;
            orderToSave.col20 = netD;
            orderToSave.col21 = diff;
            orderToSave.destMatchStatus = 'auto_flagged';
            orderToSave.matchedDestTicketId = waitingTicket.id;
            orderToSave.col38 = orderToSave.col38
              ? `${orderToSave.col38} | ดึงตั๋วปลายทางอัตโนมัติ: ${destTicketNo}`
              : `ดึงตั๋วปลายทางอัตโนมัติ: ${destTicketNo}`;

            autoFlagsSet.add(`⚖️ ดึงตั๋วชั่งปลายทาง #${destTicketNo} ที่พักรอไว้มาชนโซน 4 อัตโนมัติ (ตามเลขอ้างอิง DO ${orderToSave.col6})`);

            const ticketFlags = new Set<string>(waitingTicket.autoActionFlags || []);
            ticketFlags.add(`⚖️ ถูกดึงไปชนเข้า DO ${orderToSave.col6} อัตโนมัติ`);
            workingList[waitingDestIdx] = {
              ...waitingTicket,
              linkedViaDocNo: orderToSave.col6,
              destMatchStatus: 'auto_flagged',
              autoActionFlags: Array.from(ticketFlags),
              autoFlagsVerified: false
            };

            autoMatchedNote = `🚩 ดึงตั๋วชั่งปลายทาง #${destTicketNo} มาชนเข้า DO ${orderToSave.col6} อัตโนมัติแล้ว (ติดธงรอตรวจสอบยืนยัน)`;
          }
        }

        // 1C. Auto-Match Origin DO with Purchase Order (PO — Zone 1 Col 4) strictly by Reference PO Number
        const doTextRefs = extractDocReferences(orderToSave.col38);
        const poRefCandidates = [
          orderToSave.col4,
          orderToSave.referenceDocNo,
          ...doTextRefs.poNumbers
        ].filter(Boolean) as string[];

        if (poRefCandidates.length > 0) {
          const matchedPO = pos.find(p => poRefCandidates.some(ref => isExactDocNumberReference(p.poNumber, ref)));
          if (matchedPO) {
            const wasAlreadyVerified = orderToSave.poMatchStatus === 'verified' && isExactDocNumberReference(orderToSave.col4, matchedPO.poNumber);
            orderToSave.col4 = matchedPO.poNumber;
            if (!wasAlreadyVerified) {
              orderToSave.poMatchStatus = 'auto_flagged';
              autoFlagsSet.add(`🔗 ชนใบสั่งซื้อ ${matchedPO.poNumber} เข้าช่อง 4 อัตโนมัติ (ตามเลขอ้างอิงในบิล)`);
            }
          }
        }
      }

      // 2. If saving an unlinked Tax Invoice, try auto-matching to an Origin DO if referenceDocNo matches DO col6
      if (orderToSave.docType === 'tax_invoice' && !orderToSave.linkedViaDocNo) {
        const textRefs = extractDocReferences(orderToSave.col38);
        const refCandidates = [orderToSave.referenceDocNo, ...textRefs.doNumbers].filter(Boolean) as string[];
        if (refCandidates.length > 0) {
          const candIdx = workingList.findIndex(ord => {
            if (ord.id === orderToSave.id || ord.docType === 'dest_weighbridge' || ord.docType === 'tax_invoice') return false;
            return Boolean(ord.col6 && refCandidates.some(ref => isExactDocNumberReference(ord.col6, ref)));
          });

          if (candIdx >= 0) {
            const candidateDO = workingList[candIdx];
            const hasExistingPrice = Number(candidateDO.col29) > 0;
            const invNo = orderToSave.col6 || orderToSave.col1;
            const candFlags = new Set<string>(candidateDO.autoActionFlags || []);
            candFlags.add(`🧾 ชนใบกำกับภาษี #${invNo} อัตโนมัติ (ตามเลขอ้างอิง DO ${candidateDO.col6})`);
            workingList[candIdx] = {
              ...candidateDO,
              col24: hasExistingPrice ? candidateDO.col24 : (Number(orderToSave.col24) || candidateDO.col24),
              col25: hasExistingPrice ? candidateDO.col25 : (Number(orderToSave.col25) || candidateDO.col25),
              col28: hasExistingPrice ? candidateDO.col28 : (Number(orderToSave.col28) || candidateDO.col28),
              col29: hasExistingPrice ? candidateDO.col29 : (Number(orderToSave.col29) || candidateDO.col29),
              col30: orderToSave.col30 || candidateDO.col30 || '',
              col31: Number(orderToSave.col31) || 0,
              col32: Number(orderToSave.col32) || 0,
              col33: Number(orderToSave.col33) || 0,
              col34: Number(orderToSave.col34) || 0,
              col35: Number(orderToSave.col35) || Number(orderToSave.col31) || 0,
              col36: Number(orderToSave.col36) || 0,
              autoActionFlags: Array.from(candFlags),
              autoFlagsVerified: false,
              updatedBy: currentUser.fullName,
              col38: candidateDO.col38
                ? `${candidateDO.col38} | ชนใบกำกับภาษี: ${invNo}`
                : `ชนใบกำกับภาษี: ${invNo}`
            };
            orderToSave.linkedViaDocNo = candidateDO.col6;
            autoFlagsSet.add(`🧾 ชนเข้า DO ${candidateDO.col6 || candidateDO.col1} อัตโนมัติ`);
            autoMatchedNote = `🚩 จับคู่ใบกำกับภาษีเข้ากับ DO ${candidateDO.col6 || candidateDO.col1} อัตโนมัติแล้ว (ติดธงรอตรวจสอบยืนยัน)`;
          }
        }
      }

      if (autoFlagsSet.size > 0) {
        orderToSave.autoActionFlags = Array.from(autoFlagsSet);
        if (
          !isExistingRecord ||
          orderToSave.poMatchStatus === 'auto_flagged' ||
          orderToSave.destMatchStatus === 'auto_flagged'
        ) {
          orderToSave.autoFlagsVerified = Boolean(orderToSave.autoFlagsVerified);
        }
      }

      const idx = workingList.findIndex(o => o.id === orderToSave.id);
      if (idx >= 0) {
        workingList[idx] = orderToSave;
      } else {
        workingList = [orderToSave, ...workingList];
      }

      workingList = reconcileAndHealOrders(workingList);

      setStores(prevStores => {
        let nextStores = [...prevStores];
        if (storeToSave) {
          const existingIdx = nextStores.findIndex(s => s.name.trim().toLowerCase() === storeToSave.name.trim().toLowerCase());
          if (existingIdx >= 0) {
            const prevGoods = nextStores[existingIdx].primaryGoods || [];
            const incomingGoods = storeToSave.primaryGoods || (orderToSave.col11 ? [orderToSave.col11] : []);
            const mergedGoods = Array.from(new Set([...prevGoods, ...incomingGoods.filter(Boolean)]));
            nextStores[existingIdx] = {
              ...nextStores[existingIdx],
              ...storeToSave,
              primaryGoods: mergedGoods,
              id: nextStores[existingIdx].id
            };
          } else {
            nextStores = [storeToSave, ...nextStores];
          }
        } else if (orderToSave.col8 && orderToSave.col11) {
          const existingIdx = nextStores.findIndex(s => s.name.trim().toLowerCase() === orderToSave.col8.trim().toLowerCase());
          if (existingIdx >= 0) {
            const prevGoods = nextStores[existingIdx].primaryGoods || [];
            if (!prevGoods.some(g => g.trim().toLowerCase() === orderToSave.col11.trim().toLowerCase())) {
              nextStores[existingIdx] = {
                ...nextStores[existingIdx],
                primaryGoods: [...prevGoods, orderToSave.col11.trim()]
              };
            }
          }
        }
        return syncStoreFinancials(nextStores, workingList);
      });

      return workingList;
    });

    // If user entered a new project name (and didn't pick an existing one), register it as a new project in the database
    if (order.col2 && order.col2.trim() && order.col2.trim() !== 'โครงการทั่วไป') {
      const cleanProj = order.col2.trim();
      setProjects(prev => {
        const exists = prev.some(p => p.name.trim().toLowerCase() === cleanProj.toLowerCase());
        if (exists) return prev;
        return [
          {
            id: `proj-${Date.now()}`,
            name: cleanProj,
            location: order.col37 || '',
            status: 'active',
            createdAt: new Date().toISOString()
          },
          ...prev
        ];
      });
    }

    // If this order was verified from the LINE OA Bot Inbox, mark the inbox item as verified
    if (order.lineInboxId) {
      setLineInbox(prev => {
        const updatedInbox = prev.map(item => {
          if (item.id !== order.lineInboxId) return item;

          const reviewedAt = new Date().toISOString();
          const itemSnapshot = item.rawAiSnapshot || {};
          const raw = (Object.keys(itemSnapshot).length ? itemSnapshot : order.rawAiSnapshot || {}) as Partial<OrderRecord> & {
            rawDocNo?: string;
            rawRefPoNo?: string;
            rawRefDoNo?: string;
            rawDate?: string;
            rawStoreName?: string;
            rawBuyerName?: string;
            rawLicensePlate?: string;
            rawItemDescription?: string;
            rawSpecCode?: string;
            rawGrossWeightKg?: number;
            rawTareWeightKg?: number;
            rawNetWeightKg?: number;
            rawDestDate?: string;
            rawDestDocNo?: string;
            rawDestGrossWeightKg?: number;
            rawDestTareWeightKg?: number;
            rawDestNetWeightKg?: number;
            rawQty?: number;
            rawUnit?: string;
            rawUnitPrice?: number;
            rawGoodsAmount?: number;
            rawGrandTotal?: number;
            rawNotes?: string;
          };
          const originalAiValues: Partial<OrderRecord> = {
            col4: order.docType === 'purchase_order' ? raw.rawDocNo || raw.col4 || '' : raw.rawRefPoNo || raw.col4 || '',
            col6: order.docType === 'dest_weighbridge' ? raw.rawRefDoNo || raw.col6 || '' : raw.rawDocNo || raw.col6 || '',
            col7: raw.rawDate || raw.col7 || '',
            col8: raw.rawStoreName || raw.col8 || '',
            col9: raw.rawBuyerName || raw.col9 || '',
            col10: raw.rawLicensePlate || raw.col10 || '',
            col11: raw.rawItemDescription || raw.col11 || '',
            col12: raw.rawSpecCode || raw.col12 || '',
            col13: raw.rawGrossWeightKg ?? raw.col13 ?? 0,
            col14: raw.rawTareWeightKg ?? raw.col14 ?? 0,
            col15: raw.rawNetWeightKg ?? raw.col15 ?? 0,
            col16: raw.rawDestDate || raw.col16 || '',
            col17: raw.rawDestDocNo || raw.col17 || '',
            col18: raw.rawDestGrossWeightKg ?? raw.col18 ?? 0,
            col19: raw.rawDestTareWeightKg ?? raw.col19 ?? 0,
            col20: raw.rawDestNetWeightKg ?? raw.col20 ?? 0,
            col22: raw.rawQty ?? raw.col22 ?? 0,
            col23: raw.rawUnit || raw.col23 || '',
            col24: raw.rawUnitPrice ?? raw.col24 ?? 0,
            col25: raw.rawGoodsAmount ?? raw.col25 ?? 0,
            col29: raw.rawGrandTotal ?? raw.col29 ?? 0,
            col38: raw.rawNotes || raw.col38 || ''
          };
          const confirmedValues: Partial<OrderRecord> = {
            col4: order.col4,
            col6: order.col6,
            col7: order.col7,
            col8: order.col8,
            col9: order.col9,
            col10: order.col10,
            col11: order.col11,
            col12: order.col12,
            col13: order.col13,
            col14: order.col14,
            col15: order.col15,
            col16: order.col16,
            col17: order.col17,
            col18: order.col18,
            col19: order.col19,
            col20: order.col20,
            col22: order.col22,
            col23: order.col23,
            col24: order.col24,
            col25: order.col25,
            col29: order.col29,
            col38: order.col38
          };
          const comparedFields: Array<[keyof OrderRecord, unknown, unknown]> = [
            ['col4', originalAiValues.col4, confirmedValues.col4],
            ['col6', originalAiValues.col6, confirmedValues.col6],
            ['col7', originalAiValues.col7, confirmedValues.col7],
            ['col8', originalAiValues.col8, confirmedValues.col8],
            ['col9', originalAiValues.col9, confirmedValues.col9],
            ['col10', originalAiValues.col10, confirmedValues.col10],
            ['col11', originalAiValues.col11, confirmedValues.col11],
            ['col12', originalAiValues.col12, confirmedValues.col12],
            ['col13', originalAiValues.col13, confirmedValues.col13],
            ['col14', originalAiValues.col14, confirmedValues.col14],
            ['col15', originalAiValues.col15, confirmedValues.col15],
            ['col16', originalAiValues.col16, confirmedValues.col16],
            ['col17', originalAiValues.col17, confirmedValues.col17],
            ['col18', originalAiValues.col18, confirmedValues.col18],
            ['col19', originalAiValues.col19, confirmedValues.col19],
            ['col20', originalAiValues.col20, confirmedValues.col20],
            ['col22', originalAiValues.col22, confirmedValues.col22],
            ['col23', originalAiValues.col23, confirmedValues.col23],
            ['col24', originalAiValues.col24, confirmedValues.col24],
            ['col25', originalAiValues.col25, confirmedValues.col25],
            ['col29', originalAiValues.col29, confirmedValues.col29],
            ['col38', originalAiValues.col38, confirmedValues.col38]
          ];
          const correctedFields = comparedFields
            .filter(([, original, confirmed]) => String(original ?? '').trim() !== String(confirmed ?? '').trim())
            .map(([field]) => field);

          return {
            ...item,
            status: 'verified' as const,
            verifiedOrderId: order.col1,
            verifiedBy: currentUser.fullName,
            verifiedAt: reviewedAt,
            reviewFeedbackHistory: [
              ...(item.reviewFeedbackHistory || []),
              {
                rawAiSnapshot: item.rawAiSnapshot || order.rawAiSnapshot || {},
                originalAiValues,
                confirmedValues,
                correctedFields,
                reviewedBy: currentUser.fullName,
                reviewedAt
              }
            ],
            extractedData: {
              ...item.extractedData,
              ...order
            }
          };
        });

        // Auto-rename + Auto-move Drive file: {prefix}_{วันที่เอกสาร}_{เลขที่เอกสาร}.jpg → Zone ที่ถูก
        return updatedInbox.map(item =>
          item.id === order.lineInboxId && verifiedLineItem
            ? { ...item, driveFileLocation: verifiedLineItem.driveFileLocation }
            : item
        );
      });
    }


    if (order.docType === 'dest_weighbridge' && !autoMatchedNote) {
      setActiveTab('dest_wb');
      showToast('บันทึกในแถบ "ตั๋วชั่งปลายทาง" เรียบร้อยแล้ว (รอชนบิลเข้า DO)');
    } else if (order.docType === 'tax_invoice' && !autoMatchedNote) {
      setActiveTab('tax_inv');
      showToast('บันทึกในแถบ "ใบเสร็จ/กำกับภาษี" เรียบร้อยแล้ว (รอชนบิลเข้า DO)');
    } else if (autoMatchedNote) {
      showToast(autoMatchedNote);
    } else {
      showToast('บันทึกข้อมูลตั๋วชั่ง/คำสั่งซื้อเรียบร้อยแล้ว!');
    }
    return true;
  };

  // Add new blank order tailored to the active menu
  const handleAddNewOrder = () => {
    if (!currentPermissions.canCreateOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์เพิ่มบิลใหม่`, 'info');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const targetDocType =
      activeTab === 'dest_wb' ? 'dest_weighbridge' :
      activeTab === 'tax_inv' ? 'tax_invoice' :
      'delivery_order';

    const newDraft: Partial<OrderRecord> = {
      docType: targetDocType,
      col1: '',
      col2: currentUser.assignedProjects?.[0] || '',
      col3: '',
      col4: '',
      col5: '',
      col6: '',
      col7: today,
      col8: '',
      col9: currentUser.fullName,
      col10: '',
      col11: '',
      col12: '',
      col13: 0,
      col14: 0,
      col15: 0,
      col16: targetDocType === 'dest_weighbridge' ? today : '',
      col17: '',
      col18: 0,
      col19: 0,
      col20: 0,
      col21: 0,
      col22: 0,
      col23: 'ตัน',
      col24: 0,
      col25: 0,
      col26: '',
      col27: 0,
      col28: 0,
      col29: 0,
      col30: 'โอนเงิน',
      col31: 0,
      col32: 0,
      col33: 0,
      col34: 0,
      col35: 0,
      col36: 0,
      col37: '',
      col38: '',
      image: null
    };

    setVerifyOrderData(newDraft);
    setVerifyImage(null);
    setVerifyStoreSuggestion(undefined);
    setIsVerifyOpen(true);
  };

  // Add new order specifically for an existing store
  const handleAddNewOrderForStore = (store: StoreMerchant) => {
    if (!currentPermissions.canCreateOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์เพิ่มบิลใหม่`, 'info');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const newDraft: Partial<OrderRecord> = {
      col1: '',
      col2: currentUser.assignedProjects?.[0] || '',
      col3: store.category || '',
      col4: '',
      col5: '',
      col6: '',
      col7: today,
      col8: store.name,
      col9: currentUser.fullName,
      col10: '',
      col11: store.primaryGoods?.[0] || '',
      col12: '',
      col13: 0,
      col14: 0,
      col15: 0,
      col16: '',
      col17: '',
      col18: 0,
      col19: 0,
      col20: 0,
      col21: 0,
      col22: 0,
      col23: 'ตัน',
      col24: 0,
      col25: 0,
      col26: '',
      col27: 0,
      col28: 0,
      col29: 0,
      col30: store.creditTerms || 'โอนเงิน',
      col31: 0,
      col32: 0,
      col33: 0,
      col34: 0,
      col35: 0,
      col36: 0,
      col37: '',
      col38: '',
      storeId: store.id,
      image: null
    };

    setVerifyOrderData(newDraft);
    setVerifyImage(null);
    setVerifyStoreSuggestion(store);
    setIsVerifyOpen(true);
  };

  // Duplicate an existing order
  const handleDuplicateOrder = (order: OrderRecord) => {
    if (!currentPermissions.canCreateOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์คัดลอกบิล`, 'info');
      return;
    }
    const duplicated: OrderRecord = {
      ...order,
      id: 'ord-' + Date.now(),
      col1: order.col1 + '-COPY',
      col6: order.col6 ? `${order.col6}-COPY` : '',
      col16: order.docType === 'dest_weighbridge' ? order.col16 : '',
      col17: order.docType === 'dest_weighbridge' ? (order.col17 ? `${order.col17}-COPY` : '') : '',
      col18: order.docType === 'dest_weighbridge' ? order.col18 : 0,
      col19: order.docType === 'dest_weighbridge' ? order.col19 : 0,
      col20: order.docType === 'dest_weighbridge' ? order.col20 : 0,
      col21: 0,
      linkedViaDocNo: '',
      matchedDestTicketId: undefined,
      poMatchStatus: undefined,
      destMatchStatus: undefined,
      autoActionFlags: [],
      autoFlagsVerified: true,
      lineInboxId: undefined,
      createdBy: currentUser.fullName,
      createdAt: new Date().toISOString()
    };
    setOrders(prev => {
      const nextOrders = [duplicated, ...prev];
      setStores(prevStores => syncStoreFinancials(prevStores, nextOrders));
      return nextOrders;
    });
    showToast(`คัดลอกรายการ ${order.col1} สำเร็จ!`);
  };

  // Delete order (with cascade cleanup of linked Dest Weighbridge, Tax Invoice, or DO Zone 4)
  const handleDeleteOrder = async (id: string, skipConfirm = false) => {
    if (!currentPermissions.canDeleteOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์ลบรายการบิล`, 'info');
      return;
    }
    if (!(await deleteRecordFromDb('orders', id))) return;
    setOrders(prev => {
      const target = prev.find(o => o.id === id);
      let remaining = prev.filter(o => o.id !== id);

      if (target) {
        if (target.docType === 'dest_weighbridge') {
          // Zero-Junk: Delete dest weighbridge file from Google Drive
          if (target.driveFileId) {
            triggerDriveCleanup({ mode: 'delete_old_file', oldFileId: target.driveFileId });
          }

          // Unlink Zone 4 on any DO that had this destination weighbridge ticket matched
          const ticketNo = target.col17 || target.col6 || target.col1;
          remaining = remaining.map(ord => {
            if (ord.docType === 'dest_weighbridge' || ord.docType === 'tax_invoice') return ord;
            const isMatched =
              ord.matchedDestTicketId === target.id ||
              (target.linkedViaDocNo && (isExactDocNumberReference(ord.col6, target.linkedViaDocNo) || isExactDocNumberReference(ord.col1, target.linkedViaDocNo))) ||
              (ticketNo && ord.col17 && isExactDocNumberReference(ord.col17, ticketNo));
            if (!isMatched) return ord;
            return {
              ...ord,
              col16: '',
              col17: '',
              col18: 0,
              col19: 0,
              col20: 0,
              col21: 0,
              matchedDestTicketId: undefined,
              destMatchStatus: undefined,
              autoActionFlags: (ord.autoActionFlags || []).filter(f => !f.includes('ตั๋วชั่งปลายทาง'))
            };
          });
        } else if (target.docType !== 'tax_invoice') {
          // Zero-Junk: Cascade delete DO folder + files from Google Drive (with Rescue Rule for dest ticket!)
          const pairedDestTicket = prev.find(o => o.id === target.matchedDestTicketId);
          triggerDriveCleanup({
            mode: 'delete_order_cascade',
            orderFolderId: target.driveFolderId,
            orderFileIds: target.driveFileId ? [target.driveFileId] : [],
            destTicketFileIdToRescue: pairedDestTicket?.driveFileId
          });

          // Deleting a DO: release any dest_weighbridge or tax_invoice that was linked to this DO
          const doNo = target.col6 || target.col1;
          remaining = remaining.map(ord => {
            if (ord.docType === 'dest_weighbridge') {
              const linkedToDeletedDO =
                target.matchedDestTicketId === ord.id ||
                (ord.linkedViaDocNo && doNo && (isExactDocNumberReference(ord.linkedViaDocNo, target.col6) || isExactDocNumberReference(ord.linkedViaDocNo, target.col1)));
              if (linkedToDeletedDO) {
                // Reverse-Move: Move rescued dest ticket back to Zone 03 on Google Drive
                if (ord.driveFileId) {
                  triggerDriveVerifiedMove({
                    action: 'revoke_match',
                    destTicketFileId: ord.driveFileId,
                    destTicketDocNo: ord.col17 || ord.col6,
                    doTrNumber: target.col1,
                    doDocNumber: target.col6
                  });
                }
                return {
                  ...ord,
                  linkedViaDocNo: '',
                  destMatchStatus: undefined,
                  driveFileLocation: 'zone_03'
                };
              }
            } else if (ord.docType === 'tax_invoice' && ord.linkedViaDocNo && doNo) {
              const parts = ord.linkedViaDocNo.split(',').map(s => s.trim()).filter(Boolean);
              const kept = parts.filter(p => !isExactDocNumberReference(p, target.col6) && !isExactDocNumberReference(p, target.col1));
              if (kept.length !== parts.length) {
                return {
                  ...ord,
                  linkedViaDocNo: kept.join(', ')
                };
              }
            }
            return ord;
          });
        }
      }

      setStores(prevStores => syncStoreFinancials(prevStores, remaining));
      return remaining;
    });
    if (!skipConfirm) {
      showToast('ลบรายการและอัปเดตสถานะเอกสารที่เชื่อมโยงเรียบร้อยแล้ว');
    }
  };

  // Update order inline
  const handleUpdateOrder = (updatedOrder: OrderRecord) => {
    if (!currentPermissions.canEditOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์แก้ไขบิล`, 'info');
      return;
    }
    setOrders(prev => {
      const nextOrders = reconcileAndHealOrders(
        prev.map(o =>
          o.id === updatedOrder.id ? { ...updatedOrder, updatedBy: currentUser.fullName } : o
        )
      );
      setStores(prevStores => syncStoreFinancials(prevStores, nextOrders));
      return nextOrders;
    });
    showToast('อัปเดตรายการเรียบร้อยแล้ว');
  };

  // Inspect order in verification modal
  const handleInspectOrder = (order: OrderRecord) => {
    setVerifyOrderData(order);
    setVerifyImage(order.image || null);
    const matchingStore = stores.find(s => s.name === order.col8 || s.id === order.storeId);
    setVerifyStoreSuggestion(matchingStore);
    setIsVerifyOpen(true);
  };

  const handleRecoverOrderImageFromLine = async (orderId: string) => {
    const response = await fetch('/api/drive/recover-order-line-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || `กู้ภาพจาก LINE ไม่สำเร็จ (HTTP ${response.status})`);
    }
    if (typeof result.image !== 'string' || typeof result.driveFileId !== 'string') {
      throw new Error('เซิร์ฟเวอร์กู้ภาพได้ไม่ครบข้อมูลสำหรับแสดงผล');
    }

    const recoveredFields = {
      driveFileId: result.driveFileId,
      driveFolderId: typeof result.driveFolderId === 'string' ? result.driveFolderId : undefined
    };
    setOrders(previous => previous.map(order =>
      order.id === orderId ? { ...order, ...recoveredFields } : order
    ));
    setVerifyOrderData(previous =>
      previous?.id === orderId ? { ...previous, ...recoveredFields, image: result.image } : previous
    );
    showToast('กู้ภาพจาก LINE และบันทึกเข้า Google Drive สำเร็จ');
    return {
      image: result.image,
      ...recoveredFields
    };
  };

  // ================= PO MANAGEMENT HANDLERS =================
  const handleSavePO = async (inputPO: PurchaseOrder): Promise<boolean> => {
    let savedPO = inputPO;
    const isExistingPO = pos.some(p => p.id === savedPO.id);
    if (!isExistingPO) {
      const blockingPODups = checkDuplicatePO(savedPO, pos, savedPO.image);
      if (blockingPODups.length > 0) {
        showToast(`🚫 บล็อกการนำเข้า PO ซ้ำ: เลขที่ ${blockingPODups[0].matchedPO.poNumber} มีอยู่ในระบบแล้ว`);
        return false;
      }
    }

    let verifiedInboxItem: LineBillInboxItem | undefined;
    if (savedPO.lineInboxId) {
      const inboxItem = lineInbox.find(item => item.id === savedPO.lineInboxId);
      if (!inboxItem?.driveFileId) {
        showToast('ยังบันทึก PO ไม่ได้: ไม่พบรูปที่จัดเก็บใน Google Drive กรุณาซิงก์รูปให้สำเร็จก่อน', 'info');
        return false;
      }

      try {
        if (inboxItem.driveFileLocation !== 'zone_01') {
          const driveResponse = await fetch('/api/drive/rename-and-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId: inboxItem.driveFileId,
              docType: 'purchase_order',
              docDate: savedPO.orderDate || new Date().toISOString().slice(0, 10),
              docNumber: savedPO.poNumber
            })
          });
          const driveResult = await driveResponse.json();
          if (!driveResponse.ok || !driveResult?.success || driveResult.targetZone !== 'zone_01') {
            throw new Error(driveResult?.error || 'Google Drive ไม่ยืนยันการย้ายรูปไปโฟลเดอร์ PO');
          }
        }

        const verifiedAt = new Date().toISOString();
        savedPO = {
          ...savedPO,
          project: savedPO.projectId,
          driveFileId: inboxItem.driveFileId,
          driveFileLocation: 'zone_01',
          image: inboxItem.driveWebViewLink ||
            `https://drive.google.com/uc?export=view&id=${encodeURIComponent(inboxItem.driveFileId)}`
        };
        verifiedInboxItem = {
          ...inboxItem,
          driveFileLocation: 'zone_01',
          status: 'verified',
          verifiedOrderId: savedPO.poNumber,
          verifiedBy: currentUser.fullName,
          verifiedAt,
          extractedData: {
            ...inboxItem.extractedData,
            col2: savedPO.projectId,
            col4: savedPO.poNumber,
            col8: savedPO.storeName
          }
        };

        const persistRecord = async (table: string, record: unknown) => {
          const response = await fetch('/api/database/save-record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table, record })
          });
          const result = await response.json();
          if (!response.ok || !result?.success) {
            throw new Error(result?.error || `บันทึก ${table} ไม่สำเร็จ`);
          }
        };

        await persistRecord('purchase_orders', savedPO);
        try {
          await persistRecord('line_inbox', verifiedInboxItem);
        } catch (inboxSaveError) {
          const previousPO = pos.find(item => item.id === savedPO.id);
          try {
            if (previousPO) {
              await persistRecord('purchase_orders', previousPO);
            } else {
              const rollbackResponse = await fetch('/api/database/delete-record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table: 'purchase_orders', id: savedPO.id })
              });
              const rollbackResult = await rollbackResponse.json();
              if (!rollbackResponse.ok || !rollbackResult?.success) {
                throw new Error(rollbackResult?.error || 'ลบ PO ที่บันทึกค้างไม่สำเร็จ');
              }
            }
          } catch (rollbackError: any) {
            throw new Error(
              `บันทึกสถานะกล่องพัก LINE ไม่สำเร็จ และย้อนการบันทึก PO ไม่สำเร็จ: ${rollbackError?.message || 'กรุณาตรวจสอบข้อมูลในระบบ'}`
            );
          }
          throw inboxSaveError;
        }
      } catch (err: any) {
        console.error('[LINE Inbox] PO verification failed before completion:', err);
        showToast(`บันทึก PO ไม่สำเร็จ: ${err?.message || 'ย้ายรูปหรือบันทึกฐานข้อมูลไม่สำเร็จ'}`, 'error');
        return false;
      }
    }

    setPos(prev => {
      const idx = prev.findIndex(p => p.id === savedPO.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = savedPO;
        return copy;
      }
      return [savedPO, ...prev];
    });

    // Check if store should also be added to directory or have its primaryGoods updated
    if (savedPO.storeName) {
      setStores(prev => {
        const idx = prev.findIndex(s => s.name.trim().toLowerCase() === savedPO.storeName.trim().toLowerCase());
        const poItemNames = (savedPO.items || []).map(i => i.itemDescription?.trim()).filter(Boolean);
        if (idx === -1) {
          const newStore: StoreMerchant = {
            id: `store-${Date.now()}`,
            name: savedPO.storeName.trim(),
            category: savedPO.category || 'ทั่วไป',
            creditTerms: savedPO.creditTerms || 'เครดิต 30 วัน',
            totalOrders: 0,
            totalPurchases: savedPO.totalAmount || 0,
            totalPaid: 0,
            totalDebt: savedPO.totalAmount || 0,
            primaryGoods: poItemNames
          };
          return [newStore, ...prev];
        } else {
          const existingStore = prev[idx];
          const mergedGoods = Array.from(new Set([...(existingStore.primaryGoods || []), ...poItemNames]));
          const copy = [...prev];
          copy[idx] = { ...existingStore, primaryGoods: mergedGoods };
          return copy;
        }
      });
    }

    // Check if project should also be added to directory when saved as a new project name
    if (savedPO.projectId && savedPO.projectId.trim() && savedPO.projectId.trim() !== 'โครงการทั่วไป') {
      const cleanProj = savedPO.projectId.trim();
      setProjects(prev => {
        const exists = prev.some(p => p.name.trim().toLowerCase() === cleanProj.toLowerCase());
        if (exists) return prev;
        return [
          {
            id: `proj-${Date.now()}`,
            name: cleanProj,
            location: savedPO.deliveryLocation || '',
            status: 'active',
            createdAt: new Date().toISOString()
          },
          ...prev
        ];
      });
    }

    // If this PO was verified from the LINE OA Bot Inbox, mark the inbox item as verified
    if (savedPO.lineInboxId && verifiedInboxItem) {
      setLineInbox(prev =>
        prev.map(item =>
          item.id === savedPO.lineInboxId
            ? verifiedInboxItem!
            : item
        )
      );
    }

    // Reverse Auto-Match: If DOs arrived BEFORE this PO was saved, and those DOs have a reference to this PO number,
    // automatically link them to this PO and attach an auto_flagged verification flag!
    let autoLinkedDOCount = 0;
    setOrders(prevOrders =>
      prevOrders.map(ord => {
        if (ord.docType === 'dest_weighbridge' || ord.docType === 'tax_invoice') return ord;
        const textRefs = extractDocReferences(ord.col38);
        const matchesThisPO =
          isExactDocNumberReference(ord.col4, savedPO.poNumber) ||
          isExactDocNumberReference(ord.referenceDocNo, savedPO.poNumber) ||
          textRefs.poNumbers.some(p => isExactDocNumberReference(p, savedPO.poNumber));

        if (matchesThisPO) {
          const alreadyVerified = ord.poMatchStatus === 'verified' && ord.col4 === savedPO.poNumber;
          if (!alreadyVerified) {
            autoLinkedDOCount++;
            const nextFlags = new Set<string>(ord.autoActionFlags || []);
            nextFlags.add(`🔗 ชนใบสั่งซื้อ ${savedPO.poNumber} อัตโนมัติ (ตามเลขอ้างอิงในบิล)`);
            return {
              ...ord,
              col4: savedPO.poNumber,
              poMatchStatus: 'auto_flagged',
              autoActionFlags: Array.from(nextFlags),
              autoFlagsVerified: false
            };
          }
        }
        return ord;
      })
    );

    // If detail modal was open for this PO, update it
    if (selectedPOForDetail && selectedPOForDetail.id === savedPO.id) {
      setSelectedPOForDetail(savedPO);
    }

    if (autoLinkedDOCount > 0) {
      showToast(`บันทึก PO ${savedPO.poNumber} และชนบิล DO อัตโนมัติ ${autoLinkedDOCount} ใบ (ติดธงรอตรวจสอบยืนยัน)!`);
    } else {
      showToast(`บันทึกใบสั่งซื้อ ${savedPO.poNumber} เรียบร้อยแล้ว!`);
    }
    return true;
  };

  const handleDeletePO = async (id: string) => {
    if (!currentPermissions.canDeleteOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์ลบใบสั่งซื้อ`, 'info');
      return;
    }
    if (!(await deleteRecordFromDb('purchase_orders', id))) return;
    const targetPO = pos.find(p => p.id === id);
    setPos(prev => prev.filter(p => p.id !== id));
    if (targetPO?.poNumber) {
      setOrders(prev =>
        prev.map(ord => {
          if (ord.col4 && isExactDocNumberReference(ord.col4, targetPO.poNumber)) {
            return {
              ...ord,
              col4: '',
              poMatchStatus: undefined,
              autoActionFlags: (ord.autoActionFlags || []).filter(f => !f.includes('ชนใบสั่งซื้อ'))
            };
          }
          return ord;
        })
      );
    }
    if (selectedPOForDetail?.id === id) {
      setSelectedPOForDetail(null);
    }
    showToast('ลบใบสั่งซื้อและปลดการผูกกับใบส่งของเรียบร้อยแล้ว');
  };

  const handleOpenCreatePO = (initialStoreName?: string) => {
    if (!currentPermissions.canManagePO) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์เปิดใบสั่งซื้อใหม่`, 'info');
      return;
    }
    setEditingPO(null);
    setInitialStoreNameForPO(initialStoreName);
    setIsPOEditOpen(true);
  };

  const handlePOScanComplete = (poData: Partial<PurchaseOrder>, imageBase64: string) => {
    const newPO: PurchaseOrder = {
      id: `po-${Date.now()}`,
      poNumber: poData.poNumber || '',
      orderDate: poData.orderDate || '',
      deliveryDueDate: poData.deliveryDueDate || '',
      projectId: poData.projectId || '',
      storeName: poData.supplierName || poData.storeName || '',
      supplierName: poData.supplierName || poData.storeName || '',
      buyerName: poData.buyerName || '',
      documentIssuerName: poData.documentIssuerName || '',
      documentIssuerRole: poData.documentIssuerRole || 'uncertain',
      partyRoleEvidence: poData.partyRoleEvidence || '',
      partyRoleConfidence: Number(poData.partyRoleConfidence) || 0,
      category: poData.category || 'งานวัสดุก่อสร้าง',
      items: poData.items || [],
      totalQty: poData.totalQty || 0,
      totalAmount: poData.totalAmount || 0,
      status: 'pending',
      creditTerms: poData.creditTerms || '',
      deliveryLocation: poData.deliveryLocation || '',
      orderedBy: poData.orderedBy || '',
      approvedBy: poData.approvedBy || '',
      notes: poData.notes || '',
      image: imageBase64,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setEditingPO(newPO);
    setIsPOEditOpen(true);
    showToast('Gemini AI สแกนใบสั่งซื้อสำเร็จ! กรุณาตรวจสอบข้อมูลก่อนบันทึก');
  };

  // Quick action: Create an inbound ticket/bill linked directly to this PO
  const handleAddTicketForPO = (po: PurchaseOrder) => {
    const today = new Date().toISOString().split('T')[0];
    const firstItem = po.items?.[0];
    const newDraft: Partial<OrderRecord> = {
      col1: '',
      col2: po.projectId || '',
      col3: po.category || '',
      col4: po.poNumber, // Link to this PO
      col5: '',
      col6: '',
      col7: today,
      col8: po.storeName,
      col9: currentUser.fullName,
      col10: '',
      col11: firstItem?.itemDescription || '',
      col12: firstItem?.specCode || '',
      col13: 0,
      col14: 0,
      col15: 0,
      col16: '',
      col17: '',
      col18: 0,
      col19: 0,
      col20: 0,
      col21: 0,
      col22: firstItem?.orderedQty || 0,
      col23: firstItem?.unit || 'ตัน',
      col24: firstItem?.unitPrice || 0,
      col25: (firstItem?.orderedQty || 0) * (firstItem?.unitPrice || 0),
      col26: '',
      col27: 0,
      col28: 0,
      col29: (firstItem?.orderedQty || 0) * (firstItem?.unitPrice || 0),
      col30: po.creditTerms || 'โอนเงิน',
      col31: 0,
      col32: 0,
      col33: 0,
      col34: 0,
      col35: 0,
      col36: (firstItem?.orderedQty || 0) * (firstItem?.unitPrice || 0),
      col37: po.deliveryLocation || '',
      col38: `ตัดยอดส่งมอบตาม PO: ${po.poNumber}`,
      storeId: po.storeId || '',
      image: null
    };

    setVerifyOrderData(newDraft);
    setVerifyImage(null);
    const matchingStore = stores.find(s => s.name === po.storeName || s.id === po.storeId);
    setVerifyStoreSuggestion(matchingStore);
    setIsVerifyOpen(true);
  };

  // User Manual Match: Link an unlinked order to this PO strictly by user decision (marked as verified)
  const handleLinkOrderToPO = (orderId: string, poNumber: string) => {
    const targetPO = pos.find(p => p.poNumber === poNumber);
    setOrders(prev => prev.map(ord => {
      if (ord.id === orderId) {
        return {
          ...ord,
          col4: poNumber,
          col2: (!ord.col2 || ord.col2 === 'โครงการทั่วไป') && targetPO?.projectId ? targetPO.projectId : ord.col2,
          poMatchStatus: 'verified',
          updatedBy: currentUser.fullName,
          col38: ord.col38 ? `${ord.col38} | ชน PO ด้วยมือ: ${poNumber}` : `ชน PO ด้วยมือ: ${poNumber}`
        };
      }
      return ord;
    }));
    showToast(`✅ ชนบิลตั๋วเข้า PO ${poNumber} ด้วยมือเรียบร้อยแล้ว!`);
  };

  // Unlink an order from a PO
  const handleUnlinkOrderFromPO = (orderId: string) => {
    setOrders(prev => prev.map(ord => {
      if (ord.id === orderId) {
        const filteredFlags = (ord.autoActionFlags || []).filter(f => !f.includes('ชนใบสั่งซื้อ'));
        return {
          ...ord,
          col4: '',
          poMatchStatus: undefined,
          autoActionFlags: filteredFlags,
          updatedBy: currentUser.fullName
        };
      }
      return ord;
    }));
    showToast('ยกเลิกการชนบิล PO ของตั๋วใบนี้แล้ว');
  };

  // Confirm / Verify Automatic Flags (Both Auto-Match PO/Dest Ticket & Auto System Actions)
  // "ย้ายไฟล์บน Google Drive จะย้ายก็ต่อเมื่อมีการยืนยันแล้วเท่านั้น ถ้าระบบชนบิลโดยยังไม่มีการยืนยันห้ามย้าย"
  const handleVerifyOrderAutoFlags = (orderId: string, scope: 'all' | 'po' | 'dest' = 'all') => {
    const nowIso = new Date().toISOString();
    const target = orders.find(o => o.id === orderId);
    const linkedDestId = target?.matchedDestTicketId;
    const targetDONo = target?.col6 || '';

    // Trigger Google Drive Verified Move if confirming destination weighbridge match
    if (scope === 'all' || scope === 'dest') {
      const pairedTicket = orders.find(
        o => (linkedDestId && o.id === linkedDestId) || (targetDONo && o.linkedViaDocNo && isExactDocNumberReference(o.linkedViaDocNo, targetDONo))
      );
      if (pairedTicket && pairedTicket.driveFileId) {
        triggerDriveVerifiedMove({
          action: 'confirm_match',
          destTicketFileId: pairedTicket.driveFileId,
          destTicketDocNo: pairedTicket.col17 || pairedTicket.col6,
          doTrNumber: target?.col1,
          doDocNumber: target?.col6
        });
      }
    }

    setOrders(prev => {
      return prev.map(ord => {
        if (ord.id === orderId) {
          const nextPoStatus = (scope === 'all' || scope === 'po') && ord.col4 ? 'verified' : ord.poMatchStatus;
          const nextDestStatus = (scope === 'all' || scope === 'dest') && (ord.col17 || Number(ord.col20) > 0 || ord.linkedViaDocNo) ? 'verified' : ord.destMatchStatus;
          const hasOtherUnverifiedActions =
            scope !== 'all' &&
            (ord.autoActionFlags || []).some(flag => {
              if (scope === 'po') return !flag.includes('ชนใบสั่งซื้อ') && !flag.includes('ชน PO');
              return !flag.includes('ตั๋วชั่งปลายทาง') && !flag.includes('ตั๋วปลายทาง') && !flag.includes('โซน 4');
            });
          const allCleared =
            nextPoStatus !== 'auto_flagged' &&
            nextDestStatus !== 'auto_flagged' &&
            !hasOtherUnverifiedActions;

          return {
            ...ord,
            poMatchStatus: nextPoStatus,
            destMatchStatus: nextDestStatus,
            autoFlagsVerified: allCleared ? true : ord.autoFlagsVerified,
            autoFlagsVerifiedBy: currentUser.fullName,
            autoFlagsVerifiedAt: nowIso,
            driveFileLocation: (scope === 'all' || scope === 'dest') && ord.matchedDestTicketId ? 'zone_02' : ord.driveFileLocation,
            updatedBy: currentUser.fullName
          };
        }

        // Also mark the paired destination weighbridge ticket as verified when confirming Zone 4
        if (
          (scope === 'all' || scope === 'dest') &&
          ord.docType === 'dest_weighbridge' &&
          ((linkedDestId && ord.id === linkedDestId) || (targetDONo && ord.linkedViaDocNo && isExactDocNumberReference(ord.linkedViaDocNo, targetDONo)))
        ) {
          return {
            ...ord,
            destMatchStatus: 'verified',
            autoFlagsVerified: true,
            autoFlagsVerifiedBy: currentUser.fullName,
            autoFlagsVerifiedAt: nowIso,
            driveFileLocation: 'zone_02'
          };
        }

        return ord;
      });
    });
    showToast(`✅ ยืนยันการตรวจสอบรายการอัตโนมัติ (และย้ายไฟล์ตั๋วชั่งเข้าโฟลเดอร์ใบงานแล้ว)`);
  };

  // Store management handlers
  const handleSaveStore = (savedStore: StoreMerchant, oldName?: string) => {
    const previousStore = stores.find(s => s.id === savedStore.id);
    const effectiveOldName = oldName || previousStore?.name;

    let updatedOrders = orders;
    if (effectiveOldName && effectiveOldName.trim() !== savedStore.name.trim()) {
      const oldKey = effectiveOldName.trim().toLowerCase();
      updatedOrders = orders.map(o =>
        (o.storeId === savedStore.id || (o.col8 || '').trim().toLowerCase() === oldKey)
          ? { ...o, col8: savedStore.name.trim(), storeId: savedStore.id }
          : o
      );
      setOrders(updatedOrders);
      setPos(prev => prev.map(p =>
        (p.storeId === savedStore.id || (p.storeName || '').trim().toLowerCase() === oldKey)
          ? { ...p, storeName: savedStore.name.trim(), storeId: savedStore.id }
          : p
      ));
    }

    setStores(prev => {
      const idx = prev.findIndex(s => s.id === savedStore.id || (effectiveOldName && s.name.trim().toLowerCase() === effectiveOldName.trim().toLowerCase()));
      let nextList: StoreMerchant[];
      if (idx >= 0) {
        nextList = [...prev];
        nextList[idx] = savedStore;
      } else {
        nextList = [savedStore, ...prev];
      }
      return syncStoreFinancials(nextList, updatedOrders);
    });

    if (selectedStoreForDetail && (selectedStoreForDetail.id === savedStore.id || (effectiveOldName && selectedStoreForDetail.name.trim().toLowerCase() === effectiveOldName.trim().toLowerCase()))) {
      setSelectedStoreForDetail(savedStore);
    }

    showToast(`บันทึกข้อมูลร้านค้า "${savedStore.name}" เรียบร้อยแล้ว!`);
  };

  const handleDeleteStore = async (storeToDelete: StoreMerchant) => {
    if (!currentPermissions.canDeleteOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์ลบร้านค้า`, 'info');
      return;
    }
    if (!(await deleteRecordFromDb('stores', storeToDelete.id))) return;
    const targetKey = storeToDelete.name.trim().toLowerCase();
    setStores(prev => prev.filter(s => s.id !== storeToDelete.id && s.name.trim().toLowerCase() !== targetKey));
    setOrders(prev => prev.map(o => o.storeId === storeToDelete.id ? { ...o, storeId: '' } : o));
    setPos(prev => prev.map(p => p.storeId === storeToDelete.id ? { ...p, storeId: '' } : p));
    if (selectedStoreForDetail?.id === storeToDelete.id) {
      setSelectedStoreForDetail(null);
    }
    showToast(`ลบร้านค้า "${storeToDelete.name}" ออกจากทะเบียนเรียบร้อยแล้ว`);
  };

  const handleSyncStoresFromBills = () => {
    const existingSet = new Set(stores.map(s => s.name.trim().toLowerCase()));
    const newStores: StoreMerchant[] = [];

    orders.forEach(o => {
      const sName = (o.col8 || '').trim();
      if (sName && !existingSet.has(sName.toLowerCase())) {
        existingSet.add(sName.toLowerCase());
        newStores.push({
          id: `store-${Date.now()}-${newStores.length}`,
          name: sName,
          category: o.col3 || 'งานวัสดุก่อสร้าง',
          creditTerms: o.col30 || 'เครดิต 30 วัน',
          totalOrders: 0,
          totalPurchases: 0,
          totalPaid: 0,
          totalDebt: 0,
          primaryGoods: o.col11 ? [o.col11] : []
        });
      }
    });

    pos.forEach(p => {
      const sName = (p.storeName || '').trim();
      if (sName && !existingSet.has(sName.toLowerCase())) {
        existingSet.add(sName.toLowerCase());
        newStores.push({
          id: `store-${Date.now()}-${newStores.length}`,
          name: sName,
          category: p.category || 'งานวัสดุก่อสร้าง',
          creditTerms: p.creditTerms || 'เครดิต 30 วัน',
          totalOrders: 0,
          totalPurchases: 0,
          totalPaid: 0,
          totalDebt: 0,
          primaryGoods: (p.items || []).map(i => i.itemDescription).filter(Boolean)
        });
      }
    });

    if (newStores.length > 0) {
      setStores(prev => syncStoreFinancials([...newStores, ...prev], orders));
      showToast(`ดึงชื่อร้านค้าจากบิลเข้าทะเบียนเพิ่ม ${newStores.length} ร้านเรียบร้อยแล้ว`);
    }
  };

  const handleOpenStoreByName = (storeName: string) => {
    let found = stores.find(s => s.name.trim().toLowerCase() === storeName.trim().toLowerCase());
    if (!found) {
      found = {
        id: 'store-' + Date.now(),
        name: storeName,
        category: 'ทั่วไป',
        totalOrders: 0,
        totalPurchases: 0,
        totalPaid: 0,
        totalDebt: 0,
        primaryGoods: [],
        creditTerms: 'เครดิต 30 วัน'
      };
      setStores(prev => [found!, ...prev]);
    }
    setSelectedStoreForDetail(found);
  };

  // Export full excel (Orders + POs + Stores)
  const handleExportExcel = async () => {
    if (!currentPermissions.canExportReport) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์ส่งออกรายงาน`, 'info');
      return;
    }
    if (orders.length === 0 && stores.length === 0 && pos.length === 0) {
      showToast('ยังไม่มีข้อมูลในระบบสำหรับส่งออก กรุณาสแกนบิลหรือเพิ่มรายการก่อน', 'info');
      return;
    }
    try {
      const { exportAllDataToExcel } = await import('./utils/excelExport');
      exportAllDataToExcel(orders, stores, pos);
      showToast('ส่งออกไฟล์ Excel เรียบร้อยแล้ว!');
    } catch (error) {
      showToast(`ส่งออกไฟล์ Excel ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  // One-time seed of projects from existing orders/POs so existing project names are real records in `projects`
  useEffect(() => {
    try {
      const seeded = localStorage.getItem('autostore_projects_seeded_v1');
      if (seeded) return;
      localStorage.setItem('autostore_projects_seeded_v1', 'true');
      setProjects(prev => {
        const existingSet = new Set(prev.map(p => p.name.trim().toLowerCase()));
        const added: ProjectRecord[] = [];
        orders.forEach(o => {
          const pName = (o.col2 || '').trim();
          if (pName && pName !== 'โครงการทั่วไป' && !existingSet.has(pName.toLowerCase())) {
            existingSet.add(pName.toLowerCase());
            added.push({
              id: `proj-seed-${Date.now()}-${added.length}`,
              name: pName,
              code: `PRJ-${String(prev.length + added.length + 1).padStart(2, '0')}`,
              location: o.col37 || '',
              manager: o.col9 || '',
              budget: 0,
              status: 'active',
              createdAt: o.col7 || new Date().toISOString().split('T')[0]
            });
          }
        });
        pos.forEach(po => {
          const pName = (po.projectId || '').trim();
          if (pName && pName !== 'โครงการทั่วไป' && !existingSet.has(pName.toLowerCase())) {
            existingSet.add(pName.toLowerCase());
            added.push({
              id: `proj-seed-${Date.now()}-${added.length}`,
              name: pName,
              code: `PRJ-${String(prev.length + added.length + 1).padStart(2, '0')}`,
              location: po.deliveryLocation || '',
              manager: po.orderedBy || '',
              budget: 0,
              status: 'active',
              createdAt: po.orderDate || new Date().toISOString().split('T')[0]
            });
          }
        });
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    } catch {
      // ignore
    }
  }, [orders, pos]);

  // Project management handlers
  const handleSaveProject = (savedProj: ProjectRecord, oldName?: string) => {
    setProjects(prev => {
      const idx = prev.findIndex(p => p.id === savedProj.id || p.name.trim().toLowerCase() === (oldName || savedProj.name).trim().toLowerCase());
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = savedProj;
        return copy;
      }
      return [savedProj, ...prev];
    });
    // If project was renamed, cascade update to matching orders (col2), POs (projectId), and Users (assignedProjects)
    if (oldName && oldName.trim() !== savedProj.name.trim()) {
      const oldKey = oldName.trim().toLowerCase();
      setOrders(prev => prev.map(o => (o.col2 || '').trim().toLowerCase() === oldKey ? { ...o, col2: savedProj.name } : o));
      setPos(prev => prev.map(p => (p.projectId || '').trim().toLowerCase() === oldKey ? { ...p, projectId: savedProj.name } : p));
      setUsers(prev => prev.map(u => ({
        ...u,
        assignedProjects: (u.assignedProjects || []).map(pn => pn.trim().toLowerCase() === oldKey ? savedProj.name : pn)
      })));
    }
    showToast(`บันทึกข้อมูลโครงการ "${savedProj.name}" เรียบร้อยแล้ว!`);
  };

  const handleDeleteProject = async (id: string, projectName?: string) => {
    if (!currentPermissions.canDeleteOrder) {
      showToast(`🚫 บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์ลบโครงการ`, 'info');
      return;
    }
    if (!(await deleteRecordFromDb('projects', id))) return;
    const targetKey = (projectName || '').trim().toLowerCase();
    setProjects(prev => prev.filter(p => p.id !== id && (!targetKey || p.name.trim().toLowerCase() !== targetKey)));
    showToast(`ลบโครงการ "${projectName || ''}" ออกจากทะเบียนเรียบร้อยแล้ว`);
  };

  const handleSyncProjectsFromBills = () => {
    const existingSet = new Set(projects.map(p => p.name.trim().toLowerCase()));
    const newProjects: ProjectRecord[] = [];

    orders.forEach(o => {
      const pName = (o.col2 || '').trim();
      if (pName && pName !== 'โครงการทั่วไป' && !existingSet.has(pName.toLowerCase())) {
        existingSet.add(pName.toLowerCase());
        newProjects.push({
          id: `proj-${Date.now()}-${newProjects.length}`,
          name: pName,
          code: `PRJ-${String(projects.length + newProjects.length + 1).padStart(2, '0')}`,
          location: o.col37 || '',
          manager: o.col9 || '',
          budget: 0,
          status: 'active',
          createdAt: o.col7 || new Date().toISOString().split('T')[0]
        });
      }
    });

    pos.forEach(po => {
      const pName = (po.projectId || '').trim();
      if (pName && pName !== 'โครงการทั่วไป' && !existingSet.has(pName.toLowerCase())) {
        existingSet.add(pName.toLowerCase());
        newProjects.push({
          id: `proj-${Date.now()}-${newProjects.length}`,
          name: pName,
          code: `PRJ-${String(projects.length + newProjects.length + 1).padStart(2, '0')}`,
          location: po.deliveryLocation || '',
          manager: po.orderedBy || '',
          budget: 0,
          status: 'active',
          createdAt: po.orderDate || new Date().toISOString().split('T')[0]
        });
      }
    });

    if (newProjects.length > 0) {
      setProjects(prev => [...newProjects, ...prev]);
      showToast(`ดึงชื่อโครงการจากบิลเข้าทะเบียนเพิ่ม ${newProjects.length} โครงการเรียบร้อยแล้ว`);
    }
  };

  const handleCreateOrderForProject = (projectName: string, location?: string, manager?: string) => {
    const today = new Date().toISOString().split('T')[0];
    const draftOrder: Partial<OrderRecord> = {
      id: 'ord-' + Date.now(),
      docType: 'delivery_order',
      col1: '',
      col2: projectName,
      col3: 'งานวัสดุก่อสร้าง',
      col7: today,
      col9: manager || currentUser.fullName,
      col23: 'ตัน',
      col30: 'เครดิต 30 วัน',
      col37: location || ''
    };
    setVerifyOrderData(draftOrder);
    setVerifyImage(null);
    setVerifyStoreSuggestion(undefined);
    setIsVerifyOpen(true);
  };

  // Open Verification / PO Modal from LINE OA Bot Inbox
  const handleOpenVerifyFromInbox = async (item: LineBillInboxItem) => {
    const dataWithLineMeta: Partial<OrderRecord> = {
      ...item.extractedData,
      docType: item.detectedDocType,
      col2: item.extractedData?.col2 || '', // Strictly never auto-fill col2 with lineGroupName
      lineInboxId: item.id,
      lineMessageId: item.lineMessageId,
      lineUserId: item.lineUserId,
      lineSenderName: item.lineSenderName,
      lineSenderAvatar: item.lineSenderAvatar,
      lineGroupId: item.lineGroupId,
      lineGroupName: item.lineGroupName,
      lineReceivedAt: item.receivedAt,
      rawAiSnapshot: item.rawAiSnapshot,
      image: item.image
    };

    // Resolve image: fetch จาก server on-demand เสมอเมื่อไม่มี item.image (ไม่เปิด tab ใหม่)
    let resolvedImage = item.image || '';
    if (!resolvedImage || resolvedImage.length < 50) {
      try {
        showToast('กำลังโหลดรูปภาพบิล...', 'info');
        const resp = await fetch(`/api/line/inbox/image/${item.id}`);
        const data = await resp.json();
        if (data.success && data.image && data.image.length > 50) {
          // Got base64 from LINE API — use directly in modal
          resolvedImage = data.image;
        } else if (data.driveWebViewLink) {
          // Convert Drive view link to direct img URL (shows in <img> tag)
          const match = (data.driveWebViewLink as string).match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (match) resolvedImage = `https://drive.google.com/uc?export=view&id=${match[1]}`;
        }
      } catch {
        // silent fallback
      }
    }
    // Last resort: convert item.driveWebViewLink to direct img URL
    if ((!resolvedImage || resolvedImage.length < 10) && item.driveWebViewLink) {
      const match = item.driveWebViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) resolvedImage = `https://drive.google.com/uc?export=view&id=${match[1]}`;
    }

    if (item.detectedDocType === 'purchase_order') {
      const draftPO = {
        ...convertOrderDraftToPODraft(dataWithLineMeta, resolvedImage),
        driveFileId: item.driveFileId
      };
      setEditingPO(draftPO);
      setIsPOEditOpen(true);
      return;
    }

    setVerifyOrderData({ ...dataWithLineMeta, image: resolvedImage || undefined });
    setVerifyImage(resolvedImage || null);
    setVerifyStoreSuggestion(item.storeSuggestion);
    setIsVerifyOpen(true);
  };


  // Cloud Database Synchronization handler
  const handleSyncFromCloud = (cloudData: {
    orders?: OrderRecord[];
    pos?: PurchaseOrder[];
    stores?: StoreMerchant[];
    projects?: ProjectRecord[];
    billingNotes?: BillingNoteRecord[];
    lineInbox?: LineBillInboxItem[];
    users?: AppUser[];
    systemSettings?: SystemSettings;
  }) => {
    if (cloudData.orders && Array.isArray(cloudData.orders)) setOrders(reconcileAndHealOrders(cloudData.orders));
    if (cloudData.pos && Array.isArray(cloudData.pos)) setPos(cloudData.pos);
    if (cloudData.stores && Array.isArray(cloudData.stores)) setStores(cloudData.stores);
    if (cloudData.projects && Array.isArray(cloudData.projects)) setProjects(cloudData.projects);
    if (cloudData.billingNotes && Array.isArray(cloudData.billingNotes)) setBillingNotes(cloudData.billingNotes);
    if (cloudData.lineInbox && Array.isArray(cloudData.lineInbox)) setLineInbox(cloudData.lineInbox);
    if (cloudData.users && Array.isArray(cloudData.users)) setUsers(cloudData.users);
    if (cloudData.systemSettings) setSystemSettings(normalizeSystemSettings(cloudData.systemSettings));
    setIsDbConnected(true);
    setDbSyncTimestamp(new Date().toLocaleTimeString('th-TH'));
  };

  // Re-fetch database data when switching to business tabs to keep views fresh
  useEffect(() => {
    if (isDbConnected && activeTab !== 'settings') {
      fetchDatabaseData();
    }
  }, [activeTab]);

  const pendingLineInboxCount = lineInbox.filter(item =>
    item.status === 'pending_review' ||
    item.status === 'duplicate_warning' ||
    item.status === 'scan_failed'
  ).length;
  const pendingOrderReviewCount = orders.filter(
    order =>
      order.docType !== 'dest_weighbridge' &&
      order.docType !== 'tax_invoice' &&
      hasUnverifiedAutoActions(order)
  ).length;

  useEffect(() => {
    if (!isAuthChecked || !authenticatedUser) return;

    const modulesToPreload = [
      loadLineInboxView,
      loadPOManagementView,
      loadPurchasingBillingView,
      loadAnalyticsView,
      loadStoresManagement,
      loadReportsExportView,
      loadUsersRolesView,
      loadSystemSettingsView,
      loadScanModal,
      loadVerifyModal,
      loadPODetailModal,
      loadPOEditModal,
      loadStoreDetailModal,
      loadStoreEditModal
    ];
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;

    const preloadNextModule = () => {
      if (canceled || index >= modulesToPreload.length) return;

      void modulesToPreload[index++]()
        .catch(error => {
          console.warn('Background module preload failed; the module will be requested again when needed.', error);
        })
        .finally(() => {
          if (!canceled) timer = setTimeout(preloadNextModule, 1200);
        });
    };

    timer = setTimeout(preloadNextModule, 2000);
    return () => {
      canceled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAuthChecked, authenticatedUser]);

  if (!isAuthChecked) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">กำลังตรวจสอบการเข้าสู่ระบบ...</div>;
  }
  if (!authenticatedUser) {
    return (
      <LoginModal
        isOpen
        companyName={systemSettings.companyName}
        companyLogoUrl={systemSettings.companyLogoUrl}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex font-sans">
      {/* Left Navigation Sidebar */}
      <SidebarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unmatchedDestWB={orders.filter(o => o.docType === 'dest_weighbridge' && !o.linkedViaDocNo).length}
        pendingLineInbox={pendingLineInboxCount}
        pendingOrderReview={pendingOrderReviewCount}
        pendingBillingRR={billingNotes.filter(b => b.status !== 'rr_stamped_billed').length}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        currentUser={currentUser}
        currentPermissions={currentPermissions}
        onLogout={handleLogout}
        companyName={systemSettings.companyName}
        companyLogoUrl={systemSettings.companyLogoUrl}
      />

      {/* Right Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Action Bar */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenScan={() => setIsScanOpen(true)}
          onOpenScanPO={() => setIsScanOpen(true)}
          onAddNewOrder={handleAddNewOrder}
          onAddNewStore={() => {
            setEditingStore(null);
            setIsStoreEditOpen(true);
          }}
          onAddNewPO={() => handleOpenCreatePO()}
          onAddNewProject={() => {
            setActiveTab('projects');
            setTriggerCreateProjectCounter(c => c + 1);
          }}
          onExportExcel={handleExportExcel}
          onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
          currentUser={currentUser}
          currentPermissions={currentPermissions}
          notifications={notifications}
          dismissedNotifIds={dismissedNotifIds}
          onDismissNotification={(id) => setDismissedNotifIds(prev => [...prev, id])}
          onClearDismissedNotifications={() => setDismissedNotifIds([])}
          onLogout={handleLogout}
          isDbConnected={isDbConnected}
          dbSyncTimestamp={dbSyncTimestamp}
          onSyncDb={fetchDatabaseData}
          isSyncingDb={isSyncingDb}
        />

        {/* Main Container */}
        <main className="flex-1 max-w-[1920px] w-full mx-auto p-3 md:p-4 space-y-4 overflow-x-hidden">
          {/* KPI Statistics Bar shown ONLY on DO (39-Col) & Analytics views */}
          {(activeTab === 'orders' || activeTab === 'analytics') && (
            <StatSummaryCards
              orders={orders}
              onFilterClick={(type) => {
                setActiveTab('orders');
                setTableExternalFilter(type === 'all' ? '' : type);
              }}
            />
          )}

          <DeferredChunkErrorBoundary>
          <React.Suspense fallback={
            <div role="status" aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              กำลังโหลดหน้าจอ...
            </div>
          }>
          {/* Menu 0: กล่องพักบิลจาก LINE OA Bot */}
          {activeTab === 'line_inbox' && (
            <LineInboxView
              inboxItems={lineInbox}
              orders={orders}
              pos={pos}
              onUpdateInboxItem={(updated) => {
                setLineInbox(prev => {
                  const next = prev.map(i => (i.id === updated.id ? updated : i));
                  debouncedSyncToDb('line_inbox', next);
                  return next;
                });
              }}
              onAddInboxItems={(newItems) => {
                setLineInbox(prev => {
                  const next = [...newItems, ...prev];
                  debouncedSyncToDb('line_inbox', next);
                  return next;
                });
              }}
              onDeleteInboxItem={async (id) => {
                if (!currentPermissions.canDeleteOrder) {
                  throw new Error(`บัญชีของคุณ (${currentPermissions.label}) ไม่มีสิทธิ์ลบรายการในกล่องพัก`);
                }
                const driveResponse = await fetch('/api/drive/delete-line-inbox-file', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ inboxId: id })
                });
                const driveResult = await driveResponse.json();
                if (!driveResponse.ok || !driveResult.success) {
                  throw new Error(driveResult.error || 'ลบไฟล์จาก Google Drive ไม่สำเร็จ; ยังไม่ได้ลบรายการ');
                }

                const dbResponse = await fetch('/api/database/delete-record', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ table: 'line_inbox', id })
                });
                const dbResult = await dbResponse.json();
                if (!dbResponse.ok || !dbResult.success) {
                  throw new Error(dbResult.error || 'ลบรายการจากฐานข้อมูลไม่สำเร็จ');
                }
                setLineInbox(prev => prev.filter(i => i.id !== id));
                showToast(driveResult.deleted
                  ? 'ลบรายการและนำรูปออกจาก Google Drive ไปยังถังขยะแล้ว'
                  : driveResult.retained
                    ? `ลบรายการแล้ว แต่เก็บรูปไว้เพราะยังมีรายการอื่นใช้งาน: ${driveResult.message}`
                    : 'ลบรายการออกจากกล่องพักบิล LINE แล้ว; ไม่มีไฟล์ Drive ที่ต้องลบ');
              }}
              onOpenVerifyFromInbox={handleOpenVerifyFromInbox}
              onSyncWebhookQueue={syncWebhookQueueToLocal}
              onOpenSystemSettings={() => setActiveTab('settings')}
              showToast={showToast}
            />
          )}

          {/* Menu 1, 3, 4: ใบส่งของ (39 Cols) | ตั๋วชั่งปลายทาง | ใบเสร็จ/กำกับภาษี */}
          {(activeTab === 'orders' || activeTab === 'dest_wb' || activeTab === 'tax_inv') && (
            <TableView39Cols
              viewMode={activeTab}
              onSwitchTab={(tab) => setActiveTab(tab)}
              orders={orders}
              pos={pos}
              stores={stores}
              onInspectOrder={handleInspectOrder}
              onDuplicateOrder={handleDuplicateOrder}
              onDeleteOrder={handleDeleteOrder}
              onUpdateOrder={handleUpdateOrder}
              onLinkOrderToPO={handleLinkOrderToPO}
              onUnlinkOrderFromPO={handleUnlinkOrderFromPO}
              onVerifyAutoFlags={handleVerifyOrderAutoFlags}
              onOpenStoreModal={handleOpenStoreByName}
              onOpenScan={() => setIsScanOpen(true)}
              externalFilter={tableExternalFilter}
            />
          )}

          {/* Menu 2: ใบสั่งซื้อ (Purchase Orders / POs) */}
          {activeTab === 'pos' && (
            <POManagementView
              pos={pos}
              orders={orders}
              stores={stores}
              onOpenCreatePO={() => handleOpenCreatePO()}
              onOpenScanPO={() => setIsScanOpen(true)}
              onSelectPO={(po) => setSelectedPOForDetail(po)}
              onEditPO={(po) => {
                setEditingPO(po);
                setIsPOEditOpen(true);
              }}
              onDeletePO={handleDeletePO}
              onAddTicketForPO={handleAddTicketForPO}
            />
          )}

          {/* Menu 4.5: ระบบรับวางบิลฝ่ายจัดซื้อ & เชื่อมต่อ Express (4-Step Workflow) */}
          {activeTab === 'billing' && (
            <PurchasingBillingView
              orders={orders}
              pos={pos}
              stores={stores}
              billingNotes={billingNotes}
              systemSettings={systemSettings}
              currentUser={currentUser}
              canManageBilling={currentPermissions.canViewFinancials || currentPermissions.role === 'admin'}
              onSaveBillingNote={handleSaveBillingNote}
              onStampExpressRR={handleStampExpressRR}
              onUnbillBillingNote={handleUnbillBillingNote}
              onDeleteBillingNote={handleDeleteBillingNote}
              onInspectOrder={handleInspectOrder}
              showToast={showToast}
            />
          )}

          {/* Menu 5: วิเคราะห์ & การเงิน */}
          {activeTab === 'analytics' && (
            <AnalyticsView
              orders={orders}
              stores={stores}
            />
          )}

          {/* Menu 5.5: ออกรายงาน Excel / PDF */}
          {activeTab === 'reports' && (
            <ReportsExportView
              orders={orders}
              pos={pos}
              stores={stores}
              projects={projects}
              systemSettings={systemSettings}
              currentUser={currentUser}
              canViewFinancials={currentPermissions.canViewFinancials}
              showToast={showToast}
            />
          )}

          {/* Menu 6: ทะเบียนร้านค้า */}
          {activeTab === 'stores' && (
            <StoresManagementView
              stores={stores}
              orders={orders}
              pos={pos}
              onSelectStore={(st) => setSelectedStoreForDetail(st)}
              onAddNewStore={() => {
                setEditingStore(null);
                setIsStoreEditOpen(true);
              }}
              onEditStore={(st) => {
                setEditingStore(st);
                setIsStoreEditOpen(true);
              }}
              onDeleteStore={handleDeleteStore}
              onAddNewOrderForStore={handleAddNewOrderForStore}
              onSyncStoresFromBills={handleSyncStoresFromBills}
            />
          )}

          {/* Menu 7: ทะเบียนโครงการ */}
          {activeTab === 'projects' && (
            <ProjectsManagementView
              projects={projects}
              orders={orders}
              pos={pos}
              triggerCreateCounter={triggerCreateProjectCounter}
              onSaveProject={handleSaveProject}
              onDeleteProject={handleDeleteProject}
              onFilterOrdersByProject={(projectName) => {
                setActiveTab('orders');
                setTableExternalFilter(projectName);
              }}
              onCreateOrderForProject={handleCreateOrderForProject}
              onSyncProjectsFromBills={handleSyncProjectsFromBills}
            />
          )}

          {/* Menu 8: ผู้ใช้งาน & กำหนดสิทธิ์ (Users & Roles) */}
          {activeTab === 'users' && (
            <UsersRolesView
              users={users}
              currentUser={currentUser}
              rolePermissions={rolePermissions}
              projects={projects}
              orders={orders}
              pos={pos}
              onSaveUser={handleSaveUser}
              onToggleUserStatus={handleToggleUserStatus}
              onUpdateRolePermissions={(updated) => {
                setRolePermissions(updated);
                showToast('บันทึกตารางกำหนดสิทธิ์ (Role & Permission) เรียบร้อยแล้ว');
              }}
              showToast={showToast}
            />
          )}

          {/* Menu 9: ตั้งค่าระบบ & สำรอง/กู้คืนข้อมูล (System Settings & Backup) */}
          {activeTab === 'settings' && (
            <SystemSettingsView
              systemSettings={systemSettings}
              orders={orders}
              pos={pos}
              stores={stores}
              projects={projects}
              lineInbox={lineInbox}
              users={users}
              currentUser={currentUser}
              rolePermissions={rolePermissions}
              billingNotes={billingNotes}
              onUpdateSettings={setSystemSettings}
              onRestoreBackup={handleRestoreBackup}
              onSyncFromCloud={handleSyncFromCloud}
              onReloadDatabase={fetchDatabaseData}
              showToast={showToast}
            />
          )}
          </React.Suspense>
          </DeferredChunkErrorBoundary>
        </main>
      </div>

      <DeferredChunkErrorBoundary>
      {/* Unified AI Scan Modal for All Document Types (DO, PO, Dest Weighbridge, Tax Invoice) */}
      {isScanOpen && <React.Suspense fallback={<DeferredModalFallback />}><ScanModal
        isOpen
        defaultDocType={
          activeTab === 'dest_wb' ? 'dest_weighbridge' :
          activeTab === 'tax_inv' ? 'tax_invoice' :
          activeTab === 'pos' ? 'purchase_order' :
          'delivery_order'
        }
        existingOrders={orders}
        existingPOs={pos}
        onInspectExistingOrder={handleInspectOrder}
        onInspectExistingPO={(po) => {
          setEditingPO(po);
          setIsPOEditOpen(true);
        }}
        onClose={() => setIsScanOpen(false)}
        onScanComplete={handleScanComplete}
        onPOScanComplete={handlePOScanComplete}
      /></React.Suspense>}

      {/* Split Screen Verification Modal for Bills */}
      {isVerifyOpen && <React.Suspense fallback={<DeferredModalFallback />}><VerifyModal
        isOpen
        orderData={verifyOrderData}
        billImage={verifyImage}
        storeSuggestion={verifyStoreSuggestion}
        stores={stores}
        projects={projects}
        pos={pos}
        existingOrders={orders}
        lineInboxItems={lineInbox}
        trPrefix={systemSettings.trPrefix || `TR-${new Date().getFullYear()}-`}
        canEditTrNumber={currentUser.role === 'admin'}
        onClose={() => setIsVerifyOpen(false)}
        onSaveOrder={handleSaveOrder}
        onSwitchToPO={handleSwitchVerifyToPO}
        onRecoverLineImage={handleRecoverOrderImageFromLine}
      /></React.Suspense>}

      {/* Purchase Order Detail & Print Modal */}
      {selectedPOForDetail && <React.Suspense fallback={<DeferredModalFallback />}><PODetailModal
        isOpen
        po={selectedPOForDetail}
        orders={orders}
        systemSettings={systemSettings}
        onClose={() => setSelectedPOForDetail(null)}
        onEditPO={(po) => {
          setSelectedPOForDetail(null);
          setEditingPO(po);
          setIsPOEditOpen(true);
        }}
        onInspectOrder={handleInspectOrder}
        onAddTicketForPO={handleAddTicketForPO}
        onLinkOrderToPO={handleLinkOrderToPO}
        onUnlinkOrderFromPO={handleUnlinkOrderFromPO}
      /></React.Suspense>}

      {/* Purchase Order Create / Edit Modal */}
      {isPOEditOpen && <React.Suspense fallback={<DeferredModalFallback />}><POEditModal
        isOpen
        po={editingPO}
        stores={stores}
        projects={projects}
        existingPOs={pos}
        existingOrders={orders}
        initialStoreName={initialStoreNameForPO}
        onClose={() => {
          setIsPOEditOpen(false);
          setEditingPO(null);
          setInitialStoreNameForPO(undefined);
        }}
        onSave={handleSavePO}
      /></React.Suspense>}

      {/* Store Detail & Order History Modal */}
      {selectedStoreForDetail && <React.Suspense fallback={<DeferredModalFallback />}><StoreDetailModal
        store={selectedStoreForDetail}
        orders={orders}
        onClose={() => setSelectedStoreForDetail(null)}
        onInspectOrder={handleInspectOrder}
        onAddNewOrderForStore={handleAddNewOrderForStore}
        onOpenCreatePOForStore={(st) => handleOpenCreatePO(st.name)}
        onEditStore={(st) => {
          setSelectedStoreForDetail(null);
          setEditingStore(st);
          setIsStoreEditOpen(true);
        }}
        onDeleteStore={handleDeleteStore}
      /></React.Suspense>}

      {/* Store Add / Edit Modal */}
      {isStoreEditOpen && <React.Suspense fallback={<DeferredModalFallback />}><StoreEditModal
        store={editingStore}
        existingStores={stores}
        isOpen
        onClose={() => {
          setIsStoreEditOpen(false);
          setEditingStore(null);
        }}
        onSave={handleSaveStore}
        onDelete={handleDeleteStore}
      /></React.Suspense>}
      </DeferredChunkErrorBoundary>

      {/* Toast Notification */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          className={`fixed bottom-5 right-5 z-50 max-w-[min(32rem,calc(100vw-2.5rem))] text-white px-4 py-3 rounded-xl shadow-xl flex items-start gap-3 text-sm font-semibold border print:hidden ${
            toast.type === 'error'
              ? 'bg-red-950 border-red-500'
              : 'bg-slate-900 border-slate-700'
          }`}
        >
          {toast.type === 'error'
            ? <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
            : <CheckCircle2 className={`w-5 h-5 shrink-0 mt-0.5 ${toast.type === 'info' ? 'text-sky-300' : 'text-emerald-400'}`} />}
          <span className="flex-1 whitespace-pre-wrap">{toast.message}</span>
          <button
            type="button"
            aria-label="ปิดการแจ้งเตือน"
            onClick={() => {
              if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
              toastTimeoutRef.current = null;
              setToast(null);
            }}
            className="rounded p-1 -mr-2 -mt-1 text-white/80 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
