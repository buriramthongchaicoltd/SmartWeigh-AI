import React, { useState, useRef, useEffect } from 'react';
import {
  SystemSettings,
  SystemBackupPayload,
  OrderRecord,
  PurchaseOrder,
  StoreMerchant,
  ProjectRecord,
  LineBillInboxItem,
  AppUser,
  UserRole,
  RolePermissions
} from '../types';
import {
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_COMPANY_LOGO_URL,
  STORAGE_QUICK_SNAPSHOT_KEY,
  createSystemBackupPayload,
  downloadBackupJson
} from '../utils/systemConfig';
import { safeSaveToLocalStorage } from '../utils/storageEngine';
import {
  Settings,
  DatabaseBackup,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Building2,
  BellRing,
  Tags,
  FileSignature,
  Plus,
  X,
  RotateCcw,
  Save,
  History,
  RefreshCw,
  Image as ImageIcon,
  Mail,
  FileText,
  ShieldCheck,
  GitBranch,
  Layers,
  Database,
  Cloud,
  Server,
  Copy,
  Check,
  ExternalLink,
  Play,
  Key,
  Sparkles,
  Eye,
  EyeOff,
  MessageSquare
} from 'lucide-react';
import { BillingNoteRecord } from '../types';
import { SUPABASE_SQL_DDL_SCHEMA } from '../utils/supabaseClient';
import GAS_SCRIPT_TEMPLATE from '../../google_apps_script_drive.gs?raw';

interface SystemSettingsViewProps {
  systemSettings: SystemSettings;
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  stores: StoreMerchant[];
  projects: ProjectRecord[];
  lineInbox: LineBillInboxItem[];
  users: AppUser[];
  currentUser: AppUser;
  rolePermissions: Record<UserRole, RolePermissions>;
  billingNotes?: BillingNoteRecord[];
  onUpdateSettings: (next: SystemSettings) => void;
  onRestoreBackup: (payload: SystemBackupPayload, mode: 'merge' | 'overwrite') => void;
  onSyncFromCloud?: (data: {
    orders: OrderRecord[];
    pos: PurchaseOrder[];
    stores: StoreMerchant[];
    projects: ProjectRecord[];
    billingNotes: BillingNoteRecord[];
  }) => void;
  onReloadDatabase?: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  systemSettings,
  orders,
  pos,
  stores,
  projects,
  lineInbox,
  users,
  currentUser,
  rolePermissions,
  billingNotes = [],
  onUpdateSettings,
  onRestoreBackup,
  onSyncFromCloud,
  onReloadDatabase,
  showToast
}) => {
  const [subTab, setSubTab] = useState<'settings' | 'backup' | 'database' | 'handover'>('settings');
  const [form, setForm] = useState<SystemSettings>(systemSettings);
  const [newCategory, setNewCategory] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Supabase Cloud & PostgreSQL Database State
  const [dbConfig, setDbConfig] = useState({
    supabaseUrl: '',
    isEnabled: true
  });
  const [dbStatus, setDbStatus] = useState<{
    isConfigured: boolean;
    isEnabled: boolean;
    mode: 'supabase_rest' | 'postgres_direct' | 'offline';
    supabaseUrl: string;
    supabaseUrlSource?: 'env_var' | 'ui_config' | 'none';
    hasServiceKey: boolean;
    hasPgConnection: boolean;
    isConnected?: boolean;
    latencyMs?: number;
    lastTestedAt?: string | null;
    message?: string;
    tables?: Record<string, boolean>;
    tableCounts?: Record<string, number>;
    tableErrors?: Record<string, string>;
    isSchemaReady?: boolean;
    serverVersion?: string;
    configSource?: 'env_var' | 'ui_config' | 'none';
  } | null>(null);
  const [isLoadingDbConfig, setIsLoadingDbConfig] = useState(false);
  const [isTestingDb, setIsTestingDb] = useState(false);
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [isMigratingDb, setIsMigratingDb] = useState(false);
  const [isSyncingDb, setIsSyncingDb] = useState(false);
  const [isInitializingSchema, setIsInitializingSchema] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSqlDdlModal, setShowSqlDdlModal] = useState(false);

  // Google Drive Cloud Storage States
  const [driveConfig, setDriveConfig] = useState({
    rootFolderId: '',
    connectionMode: 'gas' as 'gas' | 'service_account',
    gasWebAppUrl: '',
    serviceAccountEmail: '',
    serviceAccountPrivateKey: '',
    serviceAccountJson: '',
    isEnabled: true
  });
  const [driveStatus, setDriveStatus] = useState<{
    isConfigured?: boolean;
    isEnabled?: boolean;
    connectionMode?: 'gas' | 'service_account';
    gasWebAppUrl?: string;
    hasGasSharedSecret?: boolean;
    gasSecretSource?: 'env_var' | 'cloud_config' | 'none';
    hasGas?: boolean;
    rootFolderId?: string;
    rootFolderName?: string;
    hasServiceAccount?: boolean;
    serviceAccountEmail?: string;
    lastTestedAt?: string;
    message?: string;
    isConnected?: boolean;
    zonesCreated?: Record<string, string>;
  } | null>(null);
  const [isLoadingDriveConfig, setIsLoadingDriveConfig] = useState(false);
  const [isTestingDrive, setIsTestingDrive] = useState(false);
  const [isSavingDrive, setIsSavingDrive] = useState(false);
  const [driveSetupSecret, setDriveSetupSecret] = useState('');
  const [isSettingUpDriveSecret, setIsSettingUpDriveSecret] = useState(false);

  // Global Startup & Live Services Self-Test State
  const [startupStatus, setStartupStatus] = useState<{
    ranAt: string | null;
    supabase: 'ok' | 'error' | 'not_configured' | 'pending';
    supabaseMessage: string;
    drive: 'ok' | 'error' | 'not_configured' | 'pending';
    driveMessage: string;
    gemini: 'ok' | 'not_configured';
    geminiMessage: string;
    line: 'ok' | 'not_configured' | 'pending';
    lineMessage: string;
    allReady: boolean;
  } | null>(null);
  const [isSelfTestingAll, setIsSelfTestingAll] = useState(false);

  // Gemini AI API Key State
  const [geminiConfig, setGeminiConfig] = useState<{
    hasKey: boolean;
    maskedKey: string;
    keySource: 'ui_config' | 'env_var' | 'none';
  }>({ hasKey: false, maskedKey: '', keySource: 'none' });
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [isSavingGemini, setIsSavingGemini] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const loadSystemConfig = async () => {
    try {
      const res = await fetch('/api/system/config');
      const data = await res.json();
      if (data.success) {
        setGeminiConfig({
          hasKey: data.hasGeminiKey,
          maskedKey: data.maskedGeminiKey || '',
          keySource: data.keySource || 'none'
        });
      }
    } catch (err) {
      console.error('Failed to load system config:', err);
    }
  };

  const handleSaveGeminiKey = async () => {
    if (!geminiKeyInput.trim()) {
      showToast('กรุณาใส่ GEMINI_API_KEY ก่อน', 'info');
      return;
    }
    setIsSavingGemini(true);
    try {
      const res = await fetch('/api/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiApiKey: geminiKeyInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'บันทึก Gemini API Key สำเร็จ');
        setGeminiKeyInput('');
        loadSystemConfig();
      } else {
        showToast(data.error || 'บันทึกไม่สำเร็จ', 'info');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการบันทึก', 'info');
    } finally {
      setIsSavingGemini(false);
    }
  };

  // LINE Official Account Messaging API State
  const [lineConfig, setLineConfig] = useState({
    enabled: true,
    channelAccessToken: '',
    channelSecret: '',
    autoQuoteReply: true,
    filterNonBillImages: true,
    hasChannelAccessToken: false,
    hasChannelSecret: false
  });
  const [showLineToken, setShowLineToken] = useState(false);
  const [showLineSecret, setShowLineSecret] = useState(false);
  const [isSavingLine, setIsSavingLine] = useState(false);
  const [copiedLineWebhook, setCopiedLineWebhook] = useState(false);

  const lineWebhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/line/webhook`;

  const loadLineConfig = async () => {
    try {
      const res = await fetch('/api/line/config');
      const data = await res.json();
      if (data.success && data.config) {
        setLineConfig({
          enabled: data.config.enabled !== undefined ? Boolean(data.config.enabled) : true,
          channelAccessToken: data.config.channelAccessToken || '',
          channelSecret: data.config.channelSecret || '',
          autoQuoteReply: data.config.autoQuoteReply !== undefined ? Boolean(data.config.autoQuoteReply) : true,
          filterNonBillImages: data.config.filterNonBillImages !== undefined ? Boolean(data.config.filterNonBillImages) : true,
          hasChannelAccessToken: Boolean(data.config.hasChannelAccessToken || data.config.channelAccessToken),
          hasChannelSecret: Boolean(data.config.hasChannelSecret || data.config.channelSecret)
        });
      }
    } catch (err) {
      console.warn('Failed to load LINE config:', err);
    }
  };

  const handleSaveLineConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingLine(true);
    try {
      const res = await fetch('/api/line/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineConfig)
      });
      const data = await res.json();
      if (data.success) {
        showToast('บันทึกการตั้งค่า LINE OA สำเร็จเรียบร้อยแล้ว');
        loadLineConfig();
      } else {
        showToast(data.error || 'บันทึกการตั้งค่า LINE ไม่สำเร็จ', 'info');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการบันทึก LINE OA', 'info');
    } finally {
      setIsSavingLine(false);
    }
  };

  const loadDriveConfig = async () => {
    setIsLoadingDriveConfig(true);
    try {
      const res = await fetch('/api/drive/config');
      const data = await res.json();
      if (!res.ok || !data.success || !data.config) {
        throw new Error(data.error || 'โหลดสถานะ Google Drive ไม่สำเร็จ');
      }
      if (data.success && data.config) {
        setDriveStatus(prev => {
          const isConn = typeof data.config.isConnected === 'boolean'
            ? data.config.isConnected
            : (data.config.isConfigured ? (prev?.isConnected ?? undefined) : false);

          return {
            ...prev,
            isConfigured: data.config.isConfigured,
            isEnabled: data.config.isEnabled,
            connectionMode: data.config.connectionMode,
            hasGas: data.config.hasGas,
            gasWebAppUrl: data.config.gasWebAppUrl,
              hasGasSharedSecret: data.config.hasGasSharedSecret,
              gasSecretSource: data.config.gasSecretSource || 'none',
            rootFolderId: data.config.rootFolderId,
            rootFolderName: data.config.rootFolderName || prev?.rootFolderName,
            hasServiceAccount: data.config.hasServiceAccount,
            serviceAccountEmail: data.config.serviceAccountEmail,
            lastTestedAt: data.config.lastTestedAt,
            isConnected: isConn,
            message: data.config.lastTestedMessage || prev?.message
          };
        });
        setDriveConfig(prev => ({
          ...prev,
          rootFolderId: data.config.rootFolderId || '',
          connectionMode: data.config.connectionMode || 'gas',
          gasWebAppUrl: data.config.gasWebAppUrl || '',
          serviceAccountEmail: data.config.serviceAccountEmail || '',
          isEnabled: data.config.isEnabled !== undefined ? data.config.isEnabled : true
        }));
      }
    } catch (err) {
      console.error('Failed to load drive config:', err);
      showToast(`โหลดสถานะ Google Drive ไม่สำเร็จ: ${err instanceof Error ? err.message : 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}`, 'info');
    } finally {
      setIsLoadingDriveConfig(false);
    }
  };

  const handleSaveDriveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingDrive(true);
    try {
      const res = await fetch('/api/drive/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driveConfig)
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'บันทึกการตั้งค่า Google Drive สำเร็จ กำลังทดสอบการเชื่อมต่ออัตโนมัติ...');
        await loadDriveConfig();
        await handleTestDriveConnection();
      } else {
        showToast(data.error || 'บันทึกการตั้งค่า Google Drive ไม่สำเร็จ', 'info');
      }
    } catch (err) {
      showToast(`บันทึกการตั้งค่า Google Drive ไม่สำเร็จ: ${err instanceof Error ? err.message : 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}`, 'info');
    } finally {
      setIsSavingDrive(false);
    }
  };

  const handleSetupDriveSecret = async () => {
    setIsSettingUpDriveSecret(true);
    try {
      const res = await fetch('/api/drive/setup-secret', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success || typeof data.secret !== 'string') {
        throw new Error(data.error || 'สร้างรหัส Google Drive ไม่สำเร็จ');
      }
      setDriveSetupSecret(data.secret);
      setDriveStatus(prev => ({
        ...prev,
        hasGasSharedSecret: true,
        gasSecretSource: 'cloud_config'
      }));
      try {
        await navigator.clipboard.writeText(data.secret);
        showToast('สร้างและคัดลอกรหัสแล้ว นำไปวางใน Apps Script Script Properties ได้เลย');
      } catch {
        showToast('สร้างรหัสแล้ว แต่คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกจากช่องรหัสด้านล่าง', 'info');
      }
    } catch (err) {
      showToast(`ตั้งค่ารหัส Google Drive ไม่สำเร็จ: ${err instanceof Error ? err.message : 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}`, 'info');
    } finally {
      setIsSettingUpDriveSecret(false);
    }
  };

  const handleTestDriveConnection = async () => {
    setIsTestingDrive(true);
    try {
      const res = await fetch('/api/drive/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driveConfig)
      });
      const data = await res.json();
      setDriveStatus(prev => ({
        ...prev,
        ...data,
        isConfigured: data.success ? true : (prev?.isConfigured ?? false),
        isConnected: Boolean(data.success),
        message: data.message || data.error
      }));
      if (data.success) {
        showToast(`เชื่อมต่อ Google Drive สำเร็จ! โฟลเดอร์: ${data.rootFolderName}`);
      } else {
        showToast(data.error || 'เชื่อมต่อ Google Drive ไม่สำเร็จ', 'info');
      }
    } catch (err: any) {
      showToast(`ทดสอบการเชื่อมต่อ Google Drive ขัดข้อง: ${err?.message}`, 'info');
    } finally {
      setIsTestingDrive(false);
    }
  };

  // Fetch database status & config from server
  const loadDatabaseConfig = async () => {
    setIsLoadingDbConfig(true);
    try {
      const res = await fetch('/api/database/config');
      const data = await res.json();
      if (!res.ok || !data.success || !data.config) {
        throw new Error(data.error || 'โหลดสถานะฐานข้อมูลไม่สำเร็จ');
      }
      if (data.success && data.config) {
        // Merge with existing dbStatus so isConnected/latencyMs from prior test-run are preserved
        setDbStatus(prev => ({
          ...prev,
          isConfigured: data.config.isConfigured,
          isEnabled: data.config.isEnabled,
          mode: data.config.mode,
          supabaseUrl: data.config.supabaseUrl,
          supabaseUrlSource: data.config.supabaseUrlSource || 'none',
          hasServiceKey: data.config.hasServiceKey,
          hasPgConnection: data.config.hasPgConnection,
          lastTestedAt: data.config.lastTestedAt,
          configSource: data.config.configSource || 'none',
          // Keep isConnected from previous test unless not configured
          isConnected: data.config.isConfigured ? (prev?.isConnected ?? undefined) : false
        }));
        setDbConfig(prev => ({
          ...prev,
          supabaseUrl: data.config.supabaseUrl || '',
          isEnabled: data.config.isEnabled !== undefined ? data.config.isEnabled : true
        }));
      }
    } catch (err) {
      console.error('Failed to load database config:', err);
      showToast(`โหลดสถานะฐานข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}`, 'info');
    } finally {
      setIsLoadingDbConfig(false);
    }
  };

  // Auto-test silently in background after configs load — ถ้าตั้งค่าไว้แล้วให้ทดสอบทันที
  const runSilentAutoTest = async (dbConfigured: boolean, driveConfigured: boolean) => {
    if (dbConfigured) {
      try {
        const res = await fetch('/api/database/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}) // use server's stored config
        });
        const data = await res.json();
        setDbStatus(prev => ({
          ...prev,
          ...data,
          isConfigured: true,
          isConnected: Boolean(data.success && data.isConnected),
          message: data.isConnected
            ? `✅ เชื่อมต่อสำเร็จ (${data.latencyMs ?? '—'} ms) — พร้อมใช้งาน`
            : data.error || 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบ Key'
        }));
        // ถ้าต่อได้สำเร็จ และในแอปยังไม่มี orders/pos/stores ให้ซิงก์ดึงข้อมูลมาแสดงทันที
        if (data.success && data.isConnected && orders.length === 0 && pos.length === 0 && stores.length === 0) {
          if (onReloadDatabase) {
            onReloadDatabase();
          } else if (onSyncFromCloud) {
            handleSyncFromCloud();
          }
        }
      } catch {
        // silent — don't show error toast on auto-test
      }
    }

    if (driveConfigured) {
      try {
        const res = await fetch('/api/drive/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}) // use server's stored config
        });
        const data = await res.json();
        setDriveStatus(prev => ({
          ...prev,
          isConfigured: true,
          isConnected: Boolean(data.success),
          rootFolderName: data.rootFolderName || prev?.rootFolderName,
          zonesCreated: data.zonesCreated || prev?.zonesCreated,
          message: data.success
            ? `✅ เชื่อมต่อ Google Drive สำเร็จ${data.rootFolderName ? ` — ${data.rootFolderName}` : ''}`
            : data.error || 'เชื่อมต่อ Drive ไม่สำเร็จ'
        }));
      } catch {
        // silent
      }
    }
  };

  const fetchStartupStatus = async () => {
    try {
      const res = await fetch('/api/startup/status');
      const data = await res.json();
      if (data.success) {
        setStartupStatus(data);
        if (data.drive === 'ok') {
          setDriveStatus(prev => ({
            ...prev,
            isConfigured: true,
            isConnected: true,
            message: data.driveMessage || '✅ เชื่อมต่อ Google Drive สำเร็จ'
          }));
        } else if (data.drive === 'error') {
          setDriveStatus(prev => ({
            ...prev,
            isConfigured: true,
            isConnected: false,
            message: data.driveMessage || 'เชื่อมต่อ Drive ไม่สำเร็จ'
          }));
        }
      }
    } catch {
      // silent
    }
  };

  const handleRunFullSelfTest = async () => {
    setIsSelfTestingAll(true);
    try {
      const res = await fetch('/api/startup/retest', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setStartupStatus(data);
        await Promise.all([loadDatabaseConfig(), loadDriveConfig()]);
        if (onReloadDatabase) {
          await onReloadDatabase();
        } else if (onSyncFromCloud) {
          await handleSyncFromCloud();
        }
        showToast('ทดสอบระบบอัตโนมัติ (Self-Test) ทั้งหมดสำเร็จเรียบร้อย');
      } else {
        showToast(data.error || 'การทดสอบตนเองไม่สำเร็จ', 'info');
      }
    } catch (err: any) {
      showToast(`การทดสอบขัดข้อง: ${err?.message}`, 'info');
    } finally {
      setIsSelfTestingAll(false);
    }
  };

  useEffect(() => {
    const initLoad = async () => {
      // 1. Load all configs in parallel and fetch startup health status
      await Promise.all([
        loadDatabaseConfig(),
        loadDriveConfig(),
        loadSystemConfig(),
        loadLineConfig(),
        fetchStartupStatus()
      ]);
    };
    initLoad();
  }, []);

  // 2. Auto-test silently once after isConfigured is known (runs exactly once per page-open)
  const autoTestDoneRef = React.useRef(false);
  useEffect(() => {
    if (autoTestDoneRef.current) return;
    const dbReady = Boolean(dbStatus?.isConfigured);
    const driveReady = Boolean(driveStatus?.isConfigured);
    // Only run when at least one service is configured
    if (dbReady || driveReady) {
      autoTestDoneRef.current = true;
      // ใช้ /api/startup/retest แทน runSilentAutoTest เพราะ retest จะ restore configs ก่อน แล้วค่อย test
      // ป้องกัน race condition ระหว่าง restoreConfigsFromSupabase() กับ /api/drive/test
      fetch('/api/startup/retest', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setStartupStatus(data);
            // อัปเดต Drive status จาก startup result
            if (data.drive === 'ok') {
              setDriveStatus(prev => ({
                ...prev,
                isConfigured: true,
                isConnected: true,
                message: data.driveMessage || '✅ เชื่อมต่อ Google Drive สำเร็จ'
              }));
            } else if (data.drive === 'error') {
              setDriveStatus(prev => ({
                ...prev,
                isConfigured: true,
                isConnected: false,
                message: data.driveMessage || 'เชื่อมต่อ Drive ไม่สำเร็จ'
              }));
            }
          }
        })
        .catch(() => {
          // silent fail — ไม่รบกวน user
        });
    }
  }, [dbStatus?.isConfigured, driveStatus?.isConfigured]);

  const handleSaveDbConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingDb(true);
    try {
      const res = await fetch('/api/database/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbConfig)
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'บันทึกการตั้งค่าฐานข้อมูลสำเร็จ');
        await loadDatabaseConfig();
        // ทันทีที่บันทึกสำเร็จ ให้ดึงข้อมูลจาก Supabase Cloud เข้าสู่ระบบทันที
        if (onReloadDatabase) {
          await onReloadDatabase();
        } else if (onSyncFromCloud) {
          await handleSyncFromCloud();
        }
      } else {
        showToast(data.error || 'บันทึกการตั้งค่าไม่สำเร็จ', 'info');
      }
    } catch (err) {
      showToast(`บันทึกการตั้งค่าฐานข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}`, 'info');
    } finally {
      setIsSavingDb(false);
    }
  };

  const handleTestDbConnection = async () => {
    setIsTestingDb(true);
    try {
      const res = await fetch('/api/database/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbConfig)
      });
      const data = await res.json();
      setDbStatus(prev => ({
        ...prev,
        ...data,
        isConfigured: Boolean(data.success && data.isConnected),
        isEnabled: dbConfig.isEnabled,
        supabaseUrl: dbConfig.supabaseUrl,
        mode: data.mode || 'supabase_rest'
      }));
      if (data.success && data.isConnected) {
        showToast(`เชื่อมต่อสำเร็จ (${data.latencyMs} ms) — ${data.message}`);
        // ทันทีที่ทดสอบเชื่อมต่อสำเร็จ ให้ดึงข้อมูลจาก Supabase Cloud เข้าสู่ระบบทันที
        if (onReloadDatabase) {
          onReloadDatabase();
        } else if (onSyncFromCloud) {
          handleSyncFromCloud();
        }
      } else {
        showToast(data.error || 'เชื่อมต่อไม่สำเร็จ ตรวจสอบ SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน Render Environment', 'info');
      }
    } catch (err: any) {
      showToast(`ทดสอบการเชื่อมต่อขัดข้อง: ${err?.message}`, 'info');
    } finally {
      setIsTestingDb(false);
    }
  };

  const handleInitializeSchema = async () => {
    setIsInitializingSchema(true);
    try {
      const res = await fetch('/api/database/init-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success && data.executedDirectly) {
        showToast('รันสคริปต์สร้างตารางทั้ง 8 ตารางบน PostgreSQL สำเร็จเรียบร้อยแล้ว!');
        handleTestDbConnection();
      } else if (data.success) {
        setShowSqlDdlModal(true);
        showToast('กรุณาคัดลอกสคริปต์ SQL ไปรันใน Supabase SQL Editor');
      } else {
        showToast(data.error || 'สร้างตารางอัตโนมัติไม่สำเร็จ', 'info');
      }
    } catch (err: any) {
      setShowSqlDdlModal(true);
      showToast(`สร้างตารางอัตโนมัติไม่สำเร็จ: ${err?.message || 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}`, 'info');
    } finally {
      setIsInitializingSchema(false);
    }
  };

  const handleMigrateLocalToCloud = async () => {
    if (orders.length === 0 && pos.length === 0 && stores.length === 0) {
      showToast('ยังไม่มีข้อมูลในเครื่องให้ทำการย้าย', 'info');
      return;
    }
    setIsMigratingDb(true);
    try {
      const res = await fetch('/api/database/migrate-local-to-cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders,
          pos,
          stores,
          projects,
          billingNotes
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'ย้ายข้อมูลขึ้น Supabase Cloud เรียบร้อยแล้ว!');
        handleTestDbConnection();
      } else {
        showToast(data.error || 'ย้ายข้อมูลไม่สำเร็จ', 'info');
      }
    } catch (err: any) {
      showToast(`ย้ายข้อมูลขัดข้อง: ${err?.message}`, 'info');
    } finally {
      setIsMigratingDb(false);
    }
  };

  const handleSyncFromCloud = async () => {
    setIsSyncingDb(true);
    try {
      if (onReloadDatabase) {
        await onReloadDatabase();
        showToast('ดึงและซิงก์ข้อมูลทั้งหมดจาก Supabase Cloud เรียบร้อยแล้ว!');
      } else {
        const res = await fetch('/api/database/sync-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success && data.data) {
          if (onSyncFromCloud) {
            onSyncFromCloud(data.data);
          }
          showToast(`ดึงข้อมูลจาก Cloud สำเร็จ: DO ${data.counts?.orders || 0} ใบ, PO ${data.counts?.pos || 0} ใบ`);
        } else {
          showToast(data.error || 'ดึงข้อมูลไม่สำเร็จ', 'info');
        }
      }
    } catch (err: any) {
      showToast(`ดึงข้อมูลขัดข้อง: ${err?.message}`, 'info');
    } finally {
      setIsSyncingDb(false);
    }
  };

  const handleCopySqlDdl = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_DDL_SCHEMA);
    setCopiedSql(true);
    showToast('คัดลอกคำสั่ง SQL DDL 8 ตารางเรียบร้อยแล้ว');
    setTimeout(() => setCopiedSql(false), 3000);
  };

  useEffect(() => {
    setForm(systemSettings);
  }, [systemSettings]);

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = String(ev.target?.result || '');
      if (dataUrl) {
        const updated = { ...form, companyLogoUrl: dataUrl };
        setForm(updated);
        onUpdateSettings(updated);
        showToast('อัปโหลดและบันทึกโลโก้บริษัทเรียบร้อยแล้ว');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Backup & Restore state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewPayload, setPreviewPayload] = useState<SystemBackupPayload | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'overwrite'>('merge');
  const [parseError, setParseError] = useState<string | null>(null);

  // Quick local snapshot state
  const [localSnapshotMeta, setLocalSnapshotMeta] = useState<{
    exportedAt: string;
    exportedBy: string;
    counts: SystemBackupPayload['counts'];
  } | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_QUICK_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed: SystemBackupPayload = JSON.parse(raw);
      return {
        exportedAt: parsed.exportedAt,
        exportedBy: parsed.exportedBy,
        counts: parsed.counts
      };
    } catch {
      return null;
    }
  });

  const handleSaveSettingsForm = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(form);
    showToast('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
  };

  const handleAddCategory = () => {
    const clean = newCategory.trim();
    if (!clean) return;
    if (!form.customCategories.includes(clean)) {
      const updated = { ...form, customCategories: [...form.customCategories, clean] };
      setForm(updated);
      onUpdateSettings(updated);
    }
    setNewCategory('');
  };

  const handleRemoveCategory = (cat: string) => {
    const updated = {
      ...form,
      customCategories: form.customCategories.filter(c => c !== cat)
    };
    setForm(updated);
    onUpdateSettings(updated);
  };

  const handleAddUnit = () => {
    const clean = newUnit.trim();
    if (!clean) return;
    if (!form.customUnits.includes(clean)) {
      const updated = { ...form, customUnits: [...form.customUnits, clean] };
      setForm(updated);
      onUpdateSettings(updated);
    }
    setNewUnit('');
  };

  const handleRemoveUnit = (unit: string) => {
    const updated = {
      ...form,
      customUnits: form.customUnits.filter(u => u !== unit)
    };
    setForm(updated);
    onUpdateSettings(updated);
  };

  const handleResetDefaultSettings = () => {
    const next = {
      ...DEFAULT_SYSTEM_SETTINGS,
      lastBackupAt: systemSettings.lastBackupAt
    };
    setForm(next);
    onUpdateSettings(next);
    showToast('คืนค่าการตั้งค่าระบบเป็นค่าเริ่มต้นเรียบร้อยแล้ว');
  };

  // Export JSON Backup
  const handleDownloadFullBackup = () => {
    const payload = createSystemBackupPayload({
      orders,
      pos,
      stores,
      projects,
      lineInbox,
      users,
      rolePermissions,
      systemSettings: form,
      exportedBy: currentUser.fullName
    });
    downloadBackupJson(payload);
    const updatedSettings = { ...form, lastBackupAt: payload.exportedAt };
    setForm(updatedSettings);
    onUpdateSettings(updatedSettings);
    showToast('ดาวน์โหลดไฟล์สำรองข้อมูล (.json) เรียบร้อยแล้ว');
  };

  // Save Quick Local Snapshot
  const handleCreateQuickSnapshot = () => {
    const payload = createSystemBackupPayload({
      orders,
      pos,
      stores,
      projects,
      lineInbox,
      users,
      rolePermissions,
      systemSettings: form,
      exportedBy: currentUser.fullName
    });
    safeSaveToLocalStorage(STORAGE_QUICK_SNAPSHOT_KEY, payload);
    setLocalSnapshotMeta({
      exportedAt: payload.exportedAt,
      exportedBy: payload.exportedBy,
      counts: payload.counts
    });
    showToast('บันทึกจุดย้อนกลับด่วน (Quick Snapshot) ไว้ในเบราว์เซอร์แล้ว');
  };

  const handleRestoreFromQuickSnapshot = () => {
    try {
      const raw = localStorage.getItem(STORAGE_QUICK_SNAPSHOT_KEY);
      if (!raw) return;
      const parsed: SystemBackupPayload = JSON.parse(raw);
      if (parsed?.data) {
        onRestoreBackup(parsed, 'overwrite');
        setForm(parsed.data.systemSettings || form);
      }
    } catch {
      showToast('ไม่สามารถอ่านข้อมูลจุดย้อนกลับด่วนได้', 'info');
    }
  };

  // Handle File Upload for Restore Preview
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParseError(null);
    setPreviewPayload(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const text = String(event.target?.result || '');
        const parsed = JSON.parse(text) as SystemBackupPayload;
        if (!parsed || !parsed.data || !Array.isArray(parsed.data.orders)) {
          setParseError('รูปแบบไฟล์ไม่ถูกต้อง กรุณาเลือกไฟล์ .json ที่ส่งออกจากระบบ AutoStore เท่านั้น');
          return;
        }
        setPreviewPayload(parsed);
      } catch {
        setParseError('ไม่สามารถอ่านไฟล์ JSON ได้ กรุณาตรวจสอบไฟล์สำรองข้อมูลอีกครั้ง');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmRestore = () => {
    if (!previewPayload) return;
    onRestoreBackup(previewPayload, restoreMode);
    if (previewPayload.data.systemSettings) {
      setForm(previewPayload.data.systemSettings);
    }
    setPreviewPayload(null);
  };

  return (
    <div className="space-y-4">
      {/* Top Sub-Navigation Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
            <Settings className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              ตั้งค่าระบบ & สำรอง/กู้คืนข้อมูล (System Settings & Backup Recovery)
            </h2>
            <p className="text-xs text-slate-500">
              ปรับแต่งข้อมูลบริษัท เกณฑ์แจ้งเตือน หมวดหมู่วัสดุ/หน่วยนับโดยไม่ต้องแก้โค้ด และสำรอง/กู้คืนฐานข้อมูลครบวงจร
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'settings'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Settings className="w-4 h-4 text-blue-600" />
            <span>1. ตั้งค่าข้อมูลพื้นฐานของระบบ</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('backup')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'backup'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <DatabaseBackup className="w-4 h-4 text-emerald-600" />
            <span>2. สำรอง & กู้คืนข้อมูล</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('database');
              loadDatabaseConfig();
              loadDriveConfig();
              loadSystemConfig();
              loadLineConfig();
            }}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'database'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4 text-sky-600" />
            <span>3. ฐานข้อมูล & เชื่อมต่อระบบภายนอก (Database & APIs)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('handover')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              subTab === 'handover'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4 text-indigo-600" />
            <span>4. เอกสารส่งต่องาน & สถาปัตยกรรม</span>
          </button>
        </div>
      </div>

      {/* ─── LIVE SYSTEM READINESS & AUTO-TEST STATUS HERO BANNER ─── */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl border border-slate-700/60 p-5 text-white shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  ความพร้อมของระบบจริง 100% (Verified Real-Time Cloud & APIs)
                </h3>
                {((dbStatus?.isConnected || startupStatus?.supabase === 'ok') &&
                  (driveStatus?.isConnected || startupStatus?.drive === 'ok') &&
                  (geminiConfig.hasKey || startupStatus?.gemini === 'ok')) ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    พร้อมใช้งานจริงครบทุกระบบ (100% Online)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 text-xs font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    ตรวจพบการตั้งค่าแล้ว (พร้อมทดสอบด่วน)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                ระบบเชื่อมต่อ <strong>Supabase Cloud</strong> และ <strong>Google Drive</strong> จริงโดยอัตโนมัติ — <span className="text-emerald-400 font-bold">ไม่จำเป็นต้องตั้งค่าใหม่</span> ระบบจะทดสอบตัวเองอัตโนมัติตอนเปิดและพร้อมทำงานทันที
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRunFullSelfTest}
              disabled={isSelfTestingAll}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 text-emerald-100 ${isSelfTestingAll ? 'animate-spin' : ''}`} />
              <span>{isSelfTestingAll ? 'กำลังทดสอบตนเองทุกระบบ...' : '⚡ ทดสอบตนเองทั้งหมดเดี๋ยวนี้ (Self-Test All)'}</span>
            </button>
          </div>
        </div>

        {/* 4 Pillars Grid Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* 1. Supabase Cloud DB */}
          <div
            onClick={() => setSubTab('database')}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              (dbStatus?.isConnected || startupStatus?.supabase === 'ok')
                ? 'bg-emerald-950/40 border-emerald-500/40 hover:bg-emerald-950/60'
                : (dbStatus?.isConfigured || startupStatus?.supabase === 'error')
                ? 'bg-amber-950/30 border-amber-500/40 hover:bg-amber-950/50'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <Database className="w-4 h-4 text-sky-400" />
                1. Supabase Cloud DB
              </span>
              {(dbStatus?.isConnected || startupStatus?.supabase === 'ok') ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400"></span>
              ) : (dbStatus?.isConfigured) ? (
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-500"></span>
              )}
            </div>
            <div className="text-[11px] font-semibold">
              {(dbStatus?.isConnected || startupStatus?.supabase === 'ok') ? (
                <span className="text-emerald-300">
                  ✅ เชื่อมต่อสำเร็จ {dbStatus?.latencyMs ? `(${dbStatus.latencyMs} ms)` : '(พร้อมใช้งาน)'}
                </span>
              ) : dbStatus?.isConfigured ? (
                <span className="text-amber-300">⚠️ ตั้งค่าแล้ว (คลิกเพื่อทดสอบ)</span>
              ) : (
                <span className="text-slate-400">ยังไม่ได้ตั้งค่า</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 truncate">
              {dbConfig.supabaseUrl ? dbConfig.supabaseUrl.replace(/^https?:\/\//, '') : 'PostgreSQL 8 ตาราง'}
            </div>
          </div>

          {/* 2. Google Drive 5-Zone */}
          <div
            onClick={() => setSubTab('database')}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              (driveStatus?.isConnected || startupStatus?.drive === 'ok')
                ? 'bg-emerald-950/40 border-emerald-500/40 hover:bg-emerald-950/60'
                : (driveStatus?.isConfigured || startupStatus?.drive === 'error')
                ? 'bg-amber-950/30 border-amber-500/40 hover:bg-amber-950/50'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <Cloud className="w-4 h-4 text-emerald-400" />
                2. Google Drive 5-Zone
              </span>
              {(driveStatus?.isConnected || startupStatus?.drive === 'ok') ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400"></span>
              ) : startupStatus?.drive === 'error' ? (
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              ) : driveStatus?.isConfigured ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-500"></span>
              )}
            </div>
            <div className="text-[11px] font-semibold">
              {(driveStatus?.isConnected || startupStatus?.drive === 'ok') ? (
                <span className="text-emerald-300">
                  ✅ เชื่อมต่อสำเร็จ {driveStatus?.rootFolderName ? `— ${driveStatus.rootFolderName}` : '(5 Zones)'}
                </span>
              ) : startupStatus?.drive === 'error' ? (
                <span className="text-rose-300">❌ เชื่อมต่อไม่สำเร็จ (คลิกเพื่อแก้ไข)</span>
              ) : driveStatus?.isConfigured ? (
                <span className="text-amber-300">⏳ กำลังตรวจสอบอัตโนมัติ...</span>
              ) : (
                <span className="text-slate-400">ยังไม่ได้ตั้งค่า</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 truncate">
              {driveConfig.connectionMode === 'gas' ? 'โหมด Google Apps Script' : 'โหมด Service Account'}
            </div>
          </div>

          {/* 3. Gemini AI OCR */}
          <div
            onClick={() => setSubTab('database')}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              (geminiConfig.hasKey || startupStatus?.gemini === 'ok')
                ? 'bg-emerald-950/40 border-emerald-500/40 hover:bg-emerald-950/60'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <Sparkles className="w-4 h-4 text-violet-400" />
                3. Google Gemini AI
              </span>
              {(geminiConfig.hasKey || startupStatus?.gemini === 'ok') ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400"></span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              )}
            </div>
            <div className="text-[11px] font-semibold">
              {(geminiConfig.hasKey || startupStatus?.gemini === 'ok') ? (
                <span className="text-emerald-300">✅ Key พร้อมสแกนบิล OCR</span>
              ) : (
                <span className="text-rose-300">⚠️ ยังไม่ระบุ Key</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 truncate font-mono">
              {geminiConfig.maskedKey || 'Gemini 2.5 Flash'}
            </div>
          </div>

          {/* 4. LINE OA Webhook */}
          <div
            onClick={() => setSubTab('database')}
            className={`p-3.5 rounded-xl border transition cursor-pointer ${
              (lineConfig.hasChannelAccessToken || startupStatus?.line === 'ok')
                ? 'bg-emerald-950/40 border-emerald-500/40 hover:bg-emerald-950/60'
                : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                4. LINE OA Webhook
              </span>
              {(lineConfig.hasChannelAccessToken || startupStatus?.line === 'ok') ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs shadow-emerald-400"></span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-500"></span>
              )}
            </div>
            <div className="text-[11px] font-semibold">
              {(lineConfig.hasChannelAccessToken || startupStatus?.line === 'ok') ? (
                <span className="text-emerald-300">✅ Webhook พร้อมรับบิล</span>
              ) : (
                <span className="text-slate-400">ยังไม่ได้ตั้งค่า Token</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 truncate">
              {lineConfig.autoQuoteReply ? 'ตอบกลับกลุ่มอัตโนมัติ' : 'รับข้อมูลทางเดียว'}
            </div>
          </div>
        </div>
      </div>

      {/* SUB-TAB 1: SYSTEM SETTINGS */}
      {subTab === 'settings' && (
        <form onSubmit={handleSaveSettingsForm} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Section 1: Company Profile & Report Header */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    1. ข้อมูลบริษัท & หัวกระดาษรายงาน (Company Profile)
                  </h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                  แสดงบนรายงาน PDF / PO / Excel
                </span>
              </div>

              {/* Live Letterhead Preview Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 flex items-start gap-3.5">
                <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 p-1.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                  {form.companyLogoUrl ? (
                    <img
                      src={form.companyLogoUrl}
                      alt={form.companyName}
                      className="w-full h-full object-contain"
                      onError={e => {
                        (e.currentTarget as HTMLImageElement).src = DEFAULT_COMPANY_LOGO_URL;
                      }}
                    />
                  ) : (
                    <Building2 className="w-7 h-7 text-blue-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                    ตัวอย่างหัวกระดาษรายงาน (Live Header Preview)
                  </div>
                  <div className="text-sm font-extrabold text-slate-900 truncate">
                    {form.companyName || 'บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด'}
                  </div>
                  <div className="text-[11px] text-slate-600 leading-snug">
                    ที่อยู่ {form.companyAddress || '-'}
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>เลขประจำตัวผู้เสียภาษี {form.companyTaxId || '-'}</span>
                    <span>• โทร.{form.companyPhone || '-'}</span>
                    {form.companyEmail && <span>• E-Mail.{form.companyEmail}</span>}
                  </div>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ชื่อบริษัท / ชื่อกิจการ</label>
                  <input
                    type="text"
                    value={form.companyName}
                    onChange={e => setForm({ ...form, companyName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-600 outline-none font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">คำโปรย / สาขา / ชื่อระบบ</label>
                  <input
                    type="text"
                    value={form.companySubtitle}
                    onChange={e => setForm({ ...form, companySubtitle: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ที่อยู่บริษัท (แสดงบนหัวรายงาน)</label>
                  <input
                    type="text"
                    value={form.companyAddress}
                    onChange={e => setForm({ ...form, companyAddress: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">เลขประจำตัวผู้เสียภาษี</label>
                    <input
                      type="text"
                      value={form.companyTaxId}
                      onChange={e => setForm({ ...form, companyTaxId: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">เบอร์โทรศัพท์สำนักงาน</label>
                    <input
                      type="text"
                      value={form.companyPhone}
                      onChange={e => setForm({ ...form, companyPhone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                      <Mail className="w-3 h-3 text-blue-600" /> อีเมล (E-Mail)
                    </label>
                    <input
                      type="email"
                      value={form.companyEmail || ''}
                      onChange={e => setForm({ ...form, companyEmail: e.target.value })}
                      placeholder="brtc2024@gmail.com"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                    />
                  </div>
                </div>

                {/* Company Logo URL & File Upload */}
                <div className="pt-1 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-slate-700 flex items-center gap-1">
                      <ImageIcon className="w-3.5 h-3.5 text-blue-600" /> ลิงก์โลโก้บริษัท (Logo URL หรืออัปโหลดไฟล์รูป)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={logoFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => logoFileInputRef.current?.click()}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Upload className="w-3 h-3" /> อัปโหลดรูปจากเครื่อง
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...form, companyLogoUrl: DEFAULT_COMPANY_LOGO_URL };
                          setForm(updated);
                          onUpdateSettings(updated);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold cursor-pointer"
                        title="ใช้ลิงก์โลโก้เริ่มต้น"
                      >
                        ค่าเริ่มต้น
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={form.companyLogoUrl || ''}
                    onChange={e => setForm({ ...form, companyLogoUrl: e.target.value })}
                    placeholder="https://img2.pic.in.th/pic/Screenshot-2025-03-03-132721e6cc77cbcea28f01.png"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-[11px] focus:border-blue-600 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Document Prefix, VAT & Alert Thresholds */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    2. รหัสเอกสาร & เกณฑ์การแจ้งเตือนอัตโนมัติ (Alert Thresholds)
                  </h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800">
                  เชื่อมกระดิ่งแจ้งเตือน 🔔
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">คำนำหน้าเลข TR (ช่อง 1)</label>
                  <input
                    type="text"
                    value={form.trPrefix}
                    onChange={e => setForm({ ...form, trPrefix: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">คำนำหน้าเลข PO</label>
                  <input
                    type="text"
                    value={form.poPrefix}
                    onChange={e => setForm({ ...form, poPrefix: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ภาษีมูลค่าเพิ่ม VAT (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.defaultVatPercent}
                    onChange={e => setForm({ ...form, defaultVatPercent: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    เกณฑ์เตือนน้ำหนักต่างกันเกิน (กก.)
                  </label>
                  <input
                    type="number"
                    value={form.weightDiffAlertKg}
                    onChange={e => setForm({ ...form, weightDiffAlertKg: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    เกณฑ์เตือนน้ำหนักต่างกันเกิน (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.weightDiffAlertPercent}
                    onChange={e => setForm({ ...form, weightDiffAlertPercent: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    เกณฑ์เตือนโควตา PO ใกล้เต็ม (%)
                  </label>
                  <input
                    type="number"
                    value={form.poQuotaAlertPercent}
                    onChange={e => setForm({ ...form, poQuotaAlertPercent: Number(e.target.value) || 90 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    เตือนสำรองข้อมูลทุกๆ (วัน)
                  </label>
                  <input
                    type="number"
                    value={form.backupReminderDays}
                    onChange={e => setForm({ ...form, backupReminderDays: Number(e.target.value) || 7 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono focus:border-blue-600 outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(form.requireLoginOnStart)}
                    onChange={e => setForm({ ...form, requireLoginOnStart: e.target.checked })}
                    className="w-4 h-4 accent-blue-600 rounded"
                  />
                  <span>เปิดหน้าต่างเลือกบัญชีเข้าสู่ระบบทุกครั้งที่เปิดหน้าเว็บใหม่</span>
                </label>
              </div>
            </div>

            {/* Section 3: Dynamic Categories & Units (No Code Changes Needed) */}

            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Tags className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    3. หมวดหมู่วัสดุ & หน่วยนับมาตรฐาน (ปรับเพิ่ม/ลบได้ไม่ต้องแก้โค้ด)
                  </h3>
                </div>
              </div>

              {/* Categories */}
              <div className="space-y-2 text-xs">
                <label className="block font-bold text-slate-700">
                  หมวดหมู่วัสดุมาตรฐาน ({form.customCategories.length} หมวด)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCategory();
                      }
                    }}
                    placeholder="พิมพ์ชื่อหมวดหมู่ใหม่ เช่น เคมีภัณฑ์ก่อสร้าง..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> เพิ่มหมวด
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.customCategories.map(cat => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 text-[11px] font-semibold"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCategory(cat)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        title="ลบหมวดหมู่นี้"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Units */}
              <div className="space-y-2 text-xs pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700">
                  หน่วยนับมาตรฐาน ({form.customUnits.length} หน่วย)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUnit}
                    onChange={e => setNewUnit(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddUnit();
                      }
                    }}
                    placeholder="พิมพ์หน่วยนับใหม่ เช่น ถัง, แกลลอน, ลิตร..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddUnit}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> เพิ่มหน่วย
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.customUnits.map(u => (
                    <span
                      key={u}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold"
                    >
                      <span>{u}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUnit(u)}
                        className="text-emerald-500 hover:text-rose-600 cursor-pointer"
                        title="ลบหน่วยนับนี้"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Section 4: PDF Report Signatories */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <FileSignature className="w-4 h-4 text-purple-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      4. ตำแหน่งช่องลงลายมือชื่อท้ายรายงาน PDF (Report Signatories)
                    </h3>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">ช่องลงนามที่ 1 (ผู้จัดทำรายงาน)</label>
                    <input
                      type="text"
                      value={form.reportSignatoryPreparedBy}
                      onChange={e => setForm({ ...form, reportSignatoryPreparedBy: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-purple-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">ช่องลงนามที่ 2 (ผู้ตรวจสอบ)</label>
                    <input
                      type="text"
                      value={form.reportSignatoryCheckedBy}
                      onChange={e => setForm({ ...form, reportSignatoryCheckedBy: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-purple-600 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">ช่องลงนามที่ 3 (ผู้อนุมัติ)</label>
                    <input
                      type="text"
                      value={form.reportSignatoryApprovedBy}
                      onChange={e => setForm({ ...form, reportSignatoryApprovedBy: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:border-purple-600 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleResetDefaultSettings}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>คืนค่าเริ่มต้น</span>
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>บันทึกการตั้งค่าระบบทั้งหมด</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* SUB-TAB 2: BACKUP & RECOVERY CENTER */}
      {subTab === 'backup' && (
        <div className="space-y-4">
          {/* Current System Data Status Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500">บิลทั้งหมด (DO/ชั่ง/ภาษี)</div>
              <div className="text-xl font-bold text-slate-900 font-mono mt-1">{orders.length}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500">ใบสั่งซื้อ (PO)</div>
              <div className="text-xl font-bold text-indigo-700 font-mono mt-1">{pos.length}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500">ทะเบียนร้านค้า</div>
              <div className="text-xl font-bold text-blue-700 font-mono mt-1">{stores.length}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500">ทะเบียนโครงการ</div>
              <div className="text-xl font-bold text-emerald-700 font-mono mt-1">{projects.length}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500">กล่องพักบิล LINE</div>
              <div className="text-xl font-bold text-teal-700 font-mono mt-1">{lineInbox.length}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
              <div className="text-[11px] font-semibold text-slate-500">สำรองไฟล์ล่าสุด</div>
              <div className="text-xs font-bold text-slate-800 mt-1.5 truncate">
                {systemSettings.lastBackupAt
                  ? new Date(systemSettings.lastBackupAt).toLocaleString('th-TH', {
                      dateStyle: 'short',
                      timeStyle: 'short'
                    })
                  : 'ยังไม่เคยสำรองไฟล์'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Card 1: Export Full Backup File (.json) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Download className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. สำรองข้อมูลทั้งระบบลงไฟล์ (.JSON)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  ดาวน์โหลดข้อมูลทั้งหมดในระบบ (บิล 39 คอลัมน์, ใบสั่งซื้อ PO, ร้านค้า, โครงการ, กล่องพัก LINE, ผู้ใช้งาน และการตั้งค่าระบบ) ออกมาเป็นไฟล์เดียวเก็บไว้ในคอมพิวเตอร์หรือ Cloud Drive
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadFullBackup}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลดไฟล์สำรองข้อมูล (.json)</span>
              </button>
            </div>

            {/* Card 2: Quick Browser Snapshot */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <History className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  2. จุดย้อนกลับด่วนในเครื่อง (Quick Local Snapshot)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  สร้างจุดพักข้อมูลด่วนในเบราว์เซอร์ก่อนทดสอบลบหรือแก้ไขข้อมูลชุดใหญ่ สามารถกดย้อนกลับ (Undo Restore) ได้ในคลิกเดียว
                </p>
                {localSnapshotMeta ? (
                  <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] text-blue-900 space-y-0.5">
                    <div className="font-bold">จุดย้อนกลับล่าสุดในเครื่อง:</div>
                    <div>
                      เมื่อ {new Date(localSnapshotMeta.exportedAt).toLocaleString('th-TH')} โดย {localSnapshotMeta.exportedBy}
                    </div>
                    <div>
                      (บิล {localSnapshotMeta.counts.orders} ใบ • PO {localSnapshotMeta.counts.pos} ใบ • ร้านค้า {localSnapshotMeta.counts.stores} แห่ง)
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                    ยังไม่มีจุดย้อนกลับด่วนในเครื่อง
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateQuickSnapshot}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>สร้างจุดย้อนกลับ</span>
                </button>
                {localSnapshotMeta && (
                  <button
                    type="button"
                    onClick={handleRestoreFromQuickSnapshot}
                    className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>ย้อนกลับทันที</span>
                  </button>
                )}
              </div>
            </div>

            {/* Card 3: Restore from Backup File */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  3. กู้คืนข้อมูลจากไฟล์สำรอง (Restore from .JSON)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  เลือกไฟล์สำรองข้อมูล `.json` เพื่อตรวจสอบพรีวิวจำนวนข้อมูล และเลือกได้ว่าจะ <strong>"ผสานข้อมูล (Merge)"</strong> หรือ <strong>"ทับข้อมูลทั้งหมด (Overwrite)"</strong>
                </p>
                {parseError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-medium">
                    {parseError}
                  </div>
                )}
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>เลือกไฟล์สำรองข้อมูล (.json) เพื่อพรีวิว</span>
                </button>
              </div>
            </div>
          </div>

          {/* Pre-Restore Verification & Mode Selector Panel */}
          {previewPayload && (
            <div className="bg-amber-50/90 rounded-2xl border-2 border-amber-400 p-5 shadow-md space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      พรีวิวข้อมูลในไฟล์สำรองก่อนยืนยันการกู้คืน (Pre-Restore Verification)
                    </h4>
                    <p className="text-xs text-slate-600">
                      สำรองเมื่อ: <strong>{new Date(previewPayload.exportedAt).toLocaleString('th-TH')}</strong> • โดย: <strong>{previewPayload.exportedBy}</strong> • บริษัท: <strong>{previewPayload.companyName}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewPayload(null)}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer"
                >
                  ✕ ยกเลิก
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                <div className="bg-white p-3 rounded-xl border border-amber-200">
                  <div className="text-slate-500 text-[11px]">บิลในไฟล์สำรอง</div>
                  <div className="text-base font-bold font-mono text-slate-900">{previewPayload.data.orders?.length || 0} ใบ</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-amber-200">
                  <div className="text-slate-500 text-[11px]">ใบสั่งซื้อ (PO)</div>
                  <div className="text-base font-bold font-mono text-indigo-700">{previewPayload.data.pos?.length || 0} ใบ</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-amber-200">
                  <div className="text-slate-500 text-[11px]">ร้านค้า</div>
                  <div className="text-base font-bold font-mono text-blue-700">{previewPayload.data.stores?.length || 0} แห่ง</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-amber-200">
                  <div className="text-slate-500 text-[11px]">โครงการ</div>
                  <div className="text-base font-bold font-mono text-emerald-700">{previewPayload.data.projects?.length || 0} โครงการ</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-amber-200">
                  <div className="text-slate-500 text-[11px]">กล่องพัก LINE</div>
                  <div className="text-base font-bold font-mono text-teal-700">{previewPayload.data.lineInbox?.length || 0} ใบ</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-amber-200">
                  <div className="text-slate-500 text-[11px]">บัญชีผู้ใช้</div>
                  <div className="text-base font-bold font-mono text-slate-900">{previewPayload.data.users?.length || 0} คน</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setRestoreMode('merge')}
                  className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                    restoreMode === 'merge'
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                      : 'bg-white text-slate-800 border-slate-300'
                  }`}
                >
                  <div className="font-bold">🔄 โหมดที่ 1: ผสานข้อมูล (Merge Mode — แนะนำ)</div>
                  <div className={`text-[11px] mt-0.5 ${restoreMode === 'merge' ? 'text-emerald-100' : 'text-slate-500'}`}>
                    นำเฉพาะบิล, PO, ร้านค้า และโครงการที่ยังไม่มีในเครื่องเข้ามาเติม โดยไม่ลบบิลใหม่ที่เพิ่งคีย์ไว้
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setRestoreMode('overwrite')}
                  className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                    restoreMode === 'overwrite'
                      ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                      : 'bg-white text-slate-800 border-slate-300'
                  }`}
                >
                  <div className="font-bold">⚠️ โหมดที่ 2: ทับข้อมูลทั้งหมด (Overwrite 100%)</div>
                  <div className={`text-[11px] mt-0.5 ${restoreMode === 'overwrite' ? 'text-rose-100' : 'text-slate-500'}`}>
                    ล้างข้อมูลปัจจุบันทั้งหมด แล้วแทนที่ด้วยข้อมูลจากไฟล์สำรองนี้ 100%
                  </div>
                </button>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewPayload(null)}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>ยืนยันการกู้คืนข้อมูล ({restoreMode === 'merge' ? 'ผสานข้อมูล' : 'ทับข้อมูลทั้งหมด'})</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: SUPABASE CLOUD POSTGRESQL DATABASE MANAGEMENT */}
      {subTab === 'database' && (
        <div className="space-y-4">
          {/* Top Status Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                    dbStatus?.isConnected
                      ? 'bg-emerald-600 text-white'
                      : dbStatus?.isConfigured
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-800 text-white'
                  }`}
                >
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      1. ระบบฐานข้อมูล Supabase Cloud PostgreSQL (Core Database 100%)
                    </h3>
                    {dbStatus?.isConnected ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        เชื่อมต่อสำเร็จ ({dbStatus.latencyMs} ms)
                      </span>
                    ) : dbStatus?.isConfigured ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                        ตั้งค่าแล้ว (รอทดสอบการเชื่อมต่อ)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold text-xs">
                        ⚠️ ยังไม่ได้เชื่อมต่อฐานข้อมูล
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    จัดเก็บข้อมูล 39 คอลัมน์, ใบสั่งซื้อ (PO), ทะเบียนร้านค้า, ชุดรับวางบิล และรองรับซิงก์ข้อมูลข้ามเครื่องแบบ Realtime
                  </p>
                </div>
              </div>

              {/* Banner: แจ้ง config source — แนะนำให้ใช้ env vars แทน ui config */}
              {dbStatus && (
                (!dbStatus.hasPgConnection && !dbStatus.hasServiceKey) ||
                (!dbStatus.hasPgConnection && !dbStatus.supabaseUrl)
              ) && (
                <div className={`rounded-xl border p-3.5 flex items-start gap-3 text-sm ${
                  dbStatus.configSource === 'ui_config' || dbStatus.supabaseUrlSource === 'ui_config'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  <span className="text-xl mt-0.5 shrink-0">
                    {dbStatus.configSource === 'ui_config' || dbStatus.supabaseUrlSource === 'ui_config' ? '⚠️' : '❌'}
                  </span>
                  <div>
                    {!dbStatus.hasServiceKey && (
                      <>
                        <p className="font-bold text-red-800">ยังไม่มี service-role key สำหรับให้เซิร์ฟเวอร์เข้าถึงฐานข้อมูล</p>
                        <p className="text-red-700 mt-1">ตั้งค่า SUPABASE_SERVICE_ROLE_KEY โดยใช้ service_role / secret key จาก Supabase Dashboard → Project Settings → API Keys แล้วเพิ่มใน Render Dashboard → เลือก Service → <strong>Environment</strong>.</p>
                      </>
                    )}
                    {!dbStatus.supabaseUrl && !dbStatus.hasPgConnection && (
                      <p className="text-red-700 mt-1">ยังไม่มี Project URL; เพิ่ม SUPABASE_URL จาก Supabase Project Settings → API ใน Render Environment.</p>
                    )}
                    {dbStatus.supabaseUrl && dbStatus.supabaseUrlSource !== 'env_var' && !dbStatus.hasServiceKey && (
                      <p className="text-red-700 mt-1">Project URL มาจากค่าที่บันทึกผ่านแอป ซึ่งอาจหายเมื่อ Redeploy; แนะนำให้เพิ่ม SUPABASE_URL ใน Render Environment.</p>
                    )}
                    <p className="text-[11px] text-red-700 mt-1">อย่าวาง service-role key ในหน้านี้, browser หรือ Git.</p>
                  </div>
                </div>
              )}
              {dbStatus?.hasServiceKey && dbStatus?.supabaseUrlSource === 'ui_config' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  service-role key โหลดจากเซิร์ฟเวอร์แล้ว แต่ Project URL ยังมาจากค่าที่บันทึกผ่านแอป ซึ่งอาจหายเมื่อ Redeploy; แนะนำให้ตั้ง <code className="font-mono font-bold">SUPABASE_URL</code> ใน Render Environment ด้วย
                </div>
              )}
              {dbStatus?.hasPgConnection || (dbStatus?.hasServiceKey && dbStatus?.supabaseUrlSource === 'env_var') ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2.5 text-sm">
                  <span className="text-emerald-600 text-lg">✅</span>
                  <p className="text-emerald-800 font-medium">ค่าลับสำหรับเชื่อมต่อฐานข้อมูลโหลดจาก Environment ฝั่งเซิร์ฟเวอร์</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestDbConnection}
                  disabled={isTestingDb}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${isTestingDb ? 'animate-spin' : ''}`} />
                  <span>{isTestingDb ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopySqlDdl}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-sky-400" />}
                  <span>{copiedSql ? 'คัดลอก SQL แล้ว!' : 'คัดลอก SQL DDL 8 ตาราง'}</span>
                </button>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>เปิดแดชบอร์ด Supabase</span>
                </a>
              </div>
            </div>

            {/* Connection feedback alert */}
            {dbStatus?.message && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  dbStatus.isConnected
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 font-medium'
                    : 'bg-amber-50 border-amber-200 text-amber-900 font-medium'
                }`}
              >
                {dbStatus.isConnected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                <span>{dbStatus.message}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Form Section: Credentials Configuration (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-sky-600" />
                  <h4 className="text-sm font-bold text-slate-900">
                    1. ข้อมูลการเชื่อมต่อ Supabase Cloud
                  </h4>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-50 text-sky-700">
                  เฉพาะ URL ไม่เก็บ secret
                </span>
              </div>

              <div className="bg-sky-50 border border-sky-200/80 rounded-xl p-3 text-sky-900 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">ตั้งค่า service-role key ใน Render Environment เท่านั้น</p>
                  <p className="text-[11px] text-sky-800">
                    ห้ามวาง anon/service-role key หรือ PostgreSQL password ในฟอร์มนี้, browser หรือ Git; backend ปฏิเสธการเชื่อมต่อหากไม่มี runtime secret
                  </p>
                </div>
              </div>

              <form onSubmit={handleSaveDbConfig} className="space-y-3.5 text-xs">
                {/* Supabase URL */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Supabase Project URL <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={dbConfig.supabaseUrl}
                    onChange={e => setDbConfig(prev => ({ ...prev, supabaseUrl: e.target.value }))}
                    placeholder="https://xyzcompany.supabase.co"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-sky-500 bg-white"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    ดูได้จาก Supabase Dashboard → <strong>Project Settings → API → Project URL</strong>
                  </p>
                </div>
                {/* Cloud Mode Toggle */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">เปิดใช้งานระบบฐานข้อมูล Supabase Cloud PostgreSQL 100%</div>
                    <div className="text-[11px] text-slate-500">
                      ระบบทำงานบนฐานข้อมูล Supabase Cloud PostgreSQL 100% (ข้อมูลจะถูกจัดเก็บบนคลาวด์แบบ Realtime ถาวร)
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dbConfig.isEnabled}
                      onChange={e => setDbConfig(prev => ({ ...prev, isEnabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleTestDbConnection}
                    disabled={isTestingDb}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingDb ? 'animate-spin' : ''}`} />
                    <span>{isTestingDb ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}</span>
                  </button>

                  <button
                    type="submit"
                    disabled={isSavingDb}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4 text-emerald-400" />
                    <span>{isSavingDb ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าฐานข้อมูล'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Right Section: Schema Tables & Migration (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Tables Schema Readiness Card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-600" />
                    <h4 className="text-sm font-bold text-slate-900">
                      2. ตรวจสอบตาราง PostgreSQL ทั้ง 8 ตาราง
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                    Schema Blueprint
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  {[
                    { key: 'orders', name: '1. orders (ตารางหลัก 39 คอลัมน์)', desc: 'DO, ตั๋วชั่ง, ใบกำกับภาษี' },
                    { key: 'purchase_orders', name: '2. purchase_orders', desc: 'ทะเบียนใบสั่งซื้อ (PO)' },
                    { key: 'line_inbox', name: '3. line_inbox', desc: 'กล่องพักรูปบิล LINE OA' },
                    { key: 'stores', name: '4. stores', desc: 'ทะเบียนร้านค้า/คู่ค้า' },
                    { key: 'projects', name: '5. projects', desc: 'ทะเบียนโครงการก่อสร้าง' },
                    { key: 'app_users', name: '6. app_users', desc: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน' },
                    { key: 'system_config', name: '7. system_config', desc: 'ค่าตั้งค่าระบบที่บันทึกบน Cloud' },
                    { key: 'billing_notes', name: '8. billing_notes', desc: 'ชุดรับวางบิลฝ่ายจัดซื้อ & RR' }
                  ].map(t => {
                    const isFound = dbStatus?.tables ? dbStatus.tables[t.key] : false;
                    const rowCount = dbStatus?.tableCounts ? dbStatus.tableCounts[t.key] : undefined;
                    const tableErr = dbStatus?.tableErrors ? dbStatus.tableErrors[t.key] : undefined;
                    return (
                      <div
                        key={t.key}
                        className={`p-2.5 rounded-xl border flex items-center justify-between transition ${
                          isFound
                            ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-bold flex items-center gap-1.5">
                            <span>{t.name}</span>
                            {rowCount !== undefined && isFound && (
                              <span className="font-mono text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-md">
                                {rowCount} แถว
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">{t.desc}</div>
                          {tableErr && (
                            <div className="text-[10px] text-amber-600 font-medium mt-0.5">
                              ⚠️ {tableErr}
                            </div>
                          )}
                        </div>
                        <div>
                          {isFound ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              <span>พบตาราง</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-medium">
                              ยังไม่มีตาราง
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Schema Action Buttons */}
                <div className="pt-2 flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleInitializeSchema}
                    disabled={isInitializingSchema}
                    className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{isInitializingSchema ? 'กำลังรัน DDL...' : 'สร้างตารางอัตโนมัติ'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSqlDdlModal(true)}
                    className="py-2 px-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>ดูคำสั่ง SQL DDL</span>
                  </button>
                </div>
              </div>

              {/* Data Migration Card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-sm font-bold text-slate-900">
                      3. ย้ายข้อมูลในเครื่องขึ้น Cloud (One-Click Migration)
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                    Data Sync
                  </span>
                </div>

                <p className="text-xs text-slate-600">
                  ย้ายข้อมูลปัจจุบันจากเครื่องขึ้นสู่ตาราง Supabase Cloud ได้ทันที ข้อมูลจะไม่สูญหาย:
                </p>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">ใบส่งของ 39 ช่อง (ในระบบ)</div>
                    <div className="font-bold font-mono text-slate-900 text-sm">{orders.length} ใบ</div>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">ใบสั่งซื้อ PO (ในระบบ)</div>
                    <div className="font-bold font-mono text-indigo-700 text-sm">{pos.length} ใบ</div>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">ร้านค้า / คู่ค้า (ในระบบ)</div>
                    <div className="font-bold font-mono text-blue-700 text-sm">{stores.length} แห่ง</div>
                  </div>
                </div>

                {orders.length === 0 && pos.length === 0 && stores.length === 0 && dbStatus?.isConnected && (
                  <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs flex items-center justify-between gap-2">
                    <div className="text-[11px]">
                      <span className="font-bold">💡 ฐานข้อมูลเชื่อมต่อแล้ว:</span> ข้อมูลในหน้าจอขณะนี้เป็น 0 หากต้องการดึงข้อมูลล่าสุดจาก Supabase Cloud มาแสดง สามารถกดดึงข้อมูลได้ทันที
                    </div>
                    <button
                      type="button"
                      onClick={handleSyncFromCloud}
                      disabled={isSyncingDb}
                      className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {isSyncingDb ? 'กำลังดึง...' : 'ดึงข้อมูลเดี๋ยวนี้'}
                    </button>
                  </div>
                )}

                <div className="space-y-2 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={handleMigrateLocalToCloud}
                    disabled={isMigratingDb}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isMigratingDb ? 'กำลังย้ายข้อมูลขึ้น Cloud...' : 'ย้ายข้อมูลปัจจุบันทั้งหมดขึ้น Supabase Cloud'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncFromCloud}
                    disabled={isSyncingDb}
                    className="w-full py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-4 h-4 text-blue-600" />
                    <span>{isSyncingDb ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูลทั้งหมดจาก Supabase Cloud มาลงเครื่อง'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Google Gemini AI API Key */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3.5">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                  geminiConfig.hasKey ? 'bg-violet-600 text-white' : 'bg-slate-800 text-white'
                }`}>
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      2. Google Gemini AI API Key (ระบบอ่านบิล & OCR แยกรายการอัตโนมัติ)
                    </h3>
                    {geminiConfig.hasKey ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        ตั้งค่าแล้ว ({geminiConfig.keySource === 'env_var' ? 'Environment Variable' : 'UI Config'})
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        ยังไม่ได้ตั้งค่า (ระบบ AI จะไม่สามารถอ่านบิลได้)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ใช้สำหรับอ่านรูปบิลแยก DO / PO / ตั๋วชั่ง และสกัดข้อมูลน้ำหนักเข้าตาราง 39 คอลัมน์อัตโนมัติ
                  </p>
                </div>
              </div>

              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-2 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-violet-200"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>รับ API Key ฟรีที่ Google AI Studio</span>
              </a>
            </div>

            {geminiConfig.hasKey && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Key ที่กำลังใช้งานอยู่ในระบบ: <code className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-300">{geminiConfig.maskedKey}</code> (หากต้องการเปลี่ยนให้กรอก Key ใหม่ด้านล่าง)</span>
              </div>
            )}

            <div className="space-y-2 text-xs">
              <label className="block font-bold text-slate-700">
                {geminiConfig.hasKey ? 'ระบุ GEMINI_API_KEY ใหม่เพื่อเปลี่ยนแปลง' : 'ระบุ GEMINI_API_KEY เพื่อเปิดใช้งานระบบ AI'}
                <span className="text-rose-500 ml-1">*</span>
              </label>
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <div className="relative flex-1">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiKeyInput}
                    onChange={e => setGeminiKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-violet-500 bg-white pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    title={showGeminiKey ? 'ซ่อน Key' : 'แสดง Key'}
                  >
                    {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSaveGeminiKey}
                  disabled={isSavingGemini || !geminiKeyInput.trim()}
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs transition cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingGemini ? 'กำลังบันทึก...' : geminiConfig.hasKey ? 'บันทึกการแก้ไข Key' : 'บันทึก Gemini Key'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: LINE Official Account Messaging API */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3.5">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                  lineConfig.hasChannelAccessToken ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
                }`}>
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      3. ระบบเชื่อมต่อ LINE Official Account (Messaging API Bot)
                    </h3>
                    {lineConfig.hasChannelAccessToken ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        ตั้งค่าแล้ว (พร้อมรับบิลจากกลุ่ม LINE)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        ยังไม่ได้ตั้งค่า Token
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    รับรูปบิลเข้ากล่องพักอัตโนมัติจากกลุ่ม LINE • ตอบกลับยืนยันฟรี 0 บาทด้วย Quote Reply
                  </p>
                </div>
              </div>

              <a
                href="https://developers.line.biz/console/"
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-emerald-200"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>เปิด LINE Developers Console</span>
              </a>
            </div>

            <form onSubmit={handleSaveLineConfig} className="space-y-3.5 text-xs">
              {/* Webhook URL Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-800">
                    Webhook URL สำหรับนำไปใส่ใน LINE Developers Console
                  </label>
                  <span className="text-[11px] text-slate-500">เปิดใช้งาน "Use Webhook" ใน LINE Console ด้วย</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={lineWebhookUrl}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs text-blue-900 font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(lineWebhookUrl);
                      setCopiedLineWebhook(true);
                      showToast('คัดลอก Webhook URL เรียบร้อยแล้ว');
                      setTimeout(() => setCopiedLineWebhook(false), 2500);
                    }}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1 shrink-0 cursor-pointer shadow-xs"
                  >
                    {copiedLineWebhook ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLineWebhook ? 'คัดลอกแล้ว' : 'คัดลอก URL'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Channel Access Token */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-2">
                    Channel Access Token (Long-Lived) <span className="text-rose-500">*</span>
                    {lineConfig.hasChannelAccessToken && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" /> มีค่าเดิมแล้ว
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showLineToken ? 'text' : 'password'}
                      value={lineConfig.channelAccessToken}
                      onChange={e => setLineConfig(prev => ({ ...prev, channelAccessToken: e.target.value }))}
                      placeholder={lineConfig.hasChannelAccessToken ? '•••••••••••••••• (ใส่ค่าใหม่เพื่อแก้ไข)' : 'Channel Access Token...'}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-emerald-500 bg-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLineToken(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showLineToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Channel Secret */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-2">
                    Channel Secret <span className="text-rose-500">*</span>
                    {lineConfig.hasChannelSecret && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" /> มีค่าเดิมแล้ว
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showLineSecret ? 'text' : 'password'}
                      value={lineConfig.channelSecret}
                      onChange={e => setLineConfig(prev => ({ ...prev, channelSecret: e.target.value }))}
                      placeholder={lineConfig.hasChannelSecret ? '•••••••••••••••• (ใส่ค่าใหม่เพื่อแก้ไข)' : 'Channel Secret...'}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-emerald-500 bg-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLineSecret(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showLineSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Bot Options Checkboxes */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-slate-800 font-medium">
                  <input
                    type="checkbox"
                    checked={lineConfig.autoQuoteReply}
                    onChange={e => setLineConfig(prev => ({ ...prev, autoQuoteReply: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  <span>ตอบกลับยืนยันรับบิลอัตโนมัติในกลุ่ม LINE (Reply Token ฟรี 0 บาท)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-800 font-medium">
                  <input
                    type="checkbox"
                    checked={lineConfig.filterNonBillImages}
                    onChange={e => setLineConfig(prev => ({ ...prev, filterNonBillImages: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  <span>คัดกรองรูปภาพทั่วไปที่ไม่ใช่เอกสารบิลออกอัตโนมัติ</span>
                </label>
              </div>

              <div className="flex items-center justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSavingLine}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4 text-emerald-400" />
                  <span>{isSavingLine ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า LINE OA'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Section 4: Google Drive API (Zero-Junk Storage & 5-Zone Auto Folder Engine) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                    driveStatus?.isConnected
                      ? 'bg-emerald-600 text-white'
                      : driveStatus?.isConfigured
                      ? 'bg-amber-500 text-white'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  <Cloud className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      4. ระบบจัดเก็บไฟล์ Google Drive API (Zero-Junk & Verified-Only Move)
                    </h3>
                    {(driveStatus?.isConnected || startupStatus?.drive === 'ok') ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        เชื่อมต่อสำเร็จ ({driveStatus?.rootFolderName || 'พร้อมใช้งาน'})
                      </span>
                    ) : startupStatus?.drive === 'error' || (driveStatus?.message && !driveStatus?.isConnected) ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-xs flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                        ⚠️ ตรวจพบข้อผิดพลาด
                      </span>
                    ) : driveStatus?.isConfigured ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-xs flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        กำลังตรวจสอบอัตโนมัติ...
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold text-xs">
                        ยังไม่ได้เชื่อมต่อ
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    จัดกลุ่มไฟล์ตามเลขที่เอกสาร 5 โซนอัตโนมัติ • <strong>ย้ายไฟล์เฉพาะเมื่อมีการยืนยันแล้วเท่านั้น</strong> • ทำความสะอาดลบไฟล์ขยะอัตโนมัติ (Zero-Junk)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestDriveConnection}
                  disabled={isTestingDrive}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${isTestingDrive ? 'animate-spin' : ''}`} />
                  <span>{isTestingDrive ? 'กำลังตรวจสอบ...' : 'ทดสอบ Google Drive & 5 โซน'}</span>
                </button>
              </div>
            </div>

            {(driveStatus?.message || startupStatus?.driveMessage) && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  (driveStatus?.isConnected || startupStatus?.drive === 'ok')
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 font-medium'
                    : 'bg-rose-50 border-rose-200 text-rose-900 font-medium'
                }`}
              >
                {(driveStatus?.isConnected || startupStatus?.drive === 'ok') ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{driveStatus?.message || startupStatus?.driveMessage}</span>
              </div>
            )}

            <form onSubmit={handleSaveDriveConfig} className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
              <div className="lg:col-span-7 space-y-3.5">

                {/* ─── GAS URL — แสดงอยู่เสมอ ─── */}
                <div className="p-3.5 rounded-xl bg-emerald-50 border-2 border-emerald-400 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    <span className="font-bold text-emerald-900 text-xs">Google Apps Script Web App URL</span>
                    <span className="text-rose-500 font-bold">*</span>
                  </div>
                  <input
                    type="url"
                    value={driveConfig.gasWebAppUrl ?? ''}
                    onChange={e => setDriveConfig(prev => ({ ...prev, gasWebAppUrl: e.target.value, connectionMode: 'gas' }))}
                    placeholder="https://script.google.com/macros/s/AKfycbx.../exec"
                    className="w-full px-3 py-2 rounded-xl border border-emerald-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-emerald-600 bg-white"
                  />
                  <div className="rounded-lg bg-white/80 border border-emerald-200 p-3 space-y-2">
                    <p className="text-[11px] text-emerald-900 font-semibold">
                      ไม่ต้องเปิด PowerShell หรือไปตั้งรหัสใน Render ครับ เว็บจะสร้างรหัสและเก็บไว้ให้เอง
                    </p>
                    <button
                      type="button"
                      onClick={handleSetupDriveSecret}
                      disabled={isSettingUpDriveSecret || driveStatus?.gasSecretSource === 'env_var'}
                      className="min-h-11 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-50"
                    >
                      {isSettingUpDriveSecret
                        ? 'กำลังสร้างรหัส...'
                        : driveStatus?.gasSecretSource === 'env_var'
                        ? 'รหัสถูกตั้งใน Server Environment แล้ว'
                        : driveStatus?.hasGasSharedSecret
                        ? 'คัดลอกรหัสสำหรับ Apps Script'
                        : 'สร้างรหัสให้และคัดลอก'}
                    </button>
                    {driveSetupSecret && (
                      <div className="space-y-1.5">
                        <label htmlFor="drive-setup-secret" className="block font-bold text-emerald-900">
                          คัดลอกรหัสนี้ไปวางใน Apps Script
                        </label>
                        <input
                          id="drive-setup-secret"
                          type="text"
                          readOnly
                          value={driveSetupSecret}
                          onFocus={e => e.currentTarget.select()}
                          className="w-full px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 font-mono text-xs text-slate-900"
                        />
                      </div>
                    )}
                    <ol className="list-decimal pl-4 text-[11px] text-emerald-900 space-y-1">
                      <li>กดปุ่มด้านบนเพื่อสร้างและคัดลอกรหัส (ไม่ต้องตั้งใน Render)</li>
                      <li>เปิด <a href="https://script.google.com/home" target="_blank" rel="noreferrer" className="font-bold underline">Google Apps Script</a> → เลือกโปรเจกต์ Drive → <strong>Project Settings</strong> → <strong>Script Properties</strong></li>
                      <li>เพิ่ม Property <code>SMARTWEIGH_SHARED_SECRET</code> แล้ววางรหัสที่คัดลอก กด Save</li>
                      <li>กลับมาหน้านี้แล้วกดทดสอบ Google Drive</li>
                    </ol>
                    <p className="text-[10px] text-emerald-800">
                      Google กำหนดให้เจ้าของ Apps Script บันทึก Script Property เองหนึ่งครั้ง; เว็บเก็บรหัสฝั่ง server แบบเข้ารหัสและไม่ส่งกลับมาเมื่อโหลดหน้าปกติ
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(GAS_SCRIPT_TEMPLATE);
                        showToast('คัดลอกโค้ด Google Apps Script (Code.gs) เรียบร้อยแล้ว!');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center gap-1 transition cursor-pointer shadow-2xs"
                    >
                      <Copy className="w-3 h-3" />
                      <span>คัดลอกโค้ด Code.gs สำหรับ script.google.com</span>
                    </button>
                  </div>
                </div>

                {/* ─── Root Folder ID ─── */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Google Drive Root Folder ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={driveConfig.rootFolderId}
                    onChange={e => setDriveConfig(prev => ({ ...prev, rootFolderId: e.target.value }))}
                    placeholder="1aBcDeFgHiJkLmNoPqRsTuVwXyZ..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-blue-500 bg-white"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    รหัสโฟลเดอร์หลักของบริษัทบน Google Drive (ดูได้จาก URL หลัง <code>folders/...</code>)
                  </p>
                </div>

                {/* ─── Save & Enable ─── */}
                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={driveConfig.isEnabled}
                      onChange={e => setDriveConfig(prev => ({ ...prev, isEnabled: e.target.checked }))}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    <span>เปิดใช้งานระบบจัดเก็บไฟล์ Google Drive อัตโนมัติ</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSavingDrive}
                    className="py-2.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {isSavingDrive ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า Google Drive'}
                  </button>
                </div>
              </div>

              {/* 5 Zones Summary & Verified-Only Rule Card */}
              <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>โครงสร้าง 5 โซน & กฎการย้ายไฟล์</span>
                </div>

                <div className="space-y-1.5 text-[11px] text-slate-600">
                  <div className="p-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">00</span>
                    <span>กล่องพักบิล LINE (รอตรวจรับ)</span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">01</span>
                    <span>ใบสั่งซื้อ PO (แยกตามเลข PO)</span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">02</span>
                    <span>ใบงานหลัก DO ครบชุด (TR-xxxx_DO-xxxx)</span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">03</span>
                    <span>ตั๋วชั่งปลายทาง (พักรอจับคู่ DO)</span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-800">04</span>
                    <span>ใบเสร็จ/กำกับภาษี (เอกเทศ)</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span>กฎเหล็กการย้ายไฟล์ (Verified-Only):</span>
                  </div>
                  <p>
                    • เมื่อระบบชนบิลอัตโนมัติ <strong>ไฟล์จะไม่ถูกย้ายเด็ดขาด</strong> เพื่อป้องกันไฟล์ย้ายผิดที่<br />
                    • ไฟล์จะย้ายเข้าโฟลเดอร์ <code>02_ใบงานหลัก</code> <strong>ก็ต่อเมื่อผู้ใช้กดยืนยันแล้วเท่านั้น</strong><br />
                    • หากกดยกเลิกการจับคู่ ระบบจะย้ายไฟล์กลับคืนโฟลเดอร์ <code>03</code> อัตโนมัติ (Zero-Orphan)
                  </p>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SQL DDL Script Modal */}
      {showSqlDdlModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-sky-400" />
                <h4 className="text-sm font-bold">ชุดคำสั่ง SQL DDL สำหรับสร้าง 8 ตารางบน Supabase</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlDdlModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3.5 text-xs text-slate-700">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900">
                <div className="font-bold mb-1">💡 คำแนะนำการนำคำสั่ง SQL ไปรันบน Supabase:</div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>กดปุ่ม <strong>"คัดลอกคำสั่ง SQL ทั้งหมด"</strong> ด้านล่างนี้</li>
                  <li>เปิด <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-blue-700 underline font-semibold">Supabase Dashboard</a> → เลือกโปรเจกต์ของท่าน</li>
                  <li>คลิกเมนู <strong>SQL Editor</strong> ที่แถบซ้ายมือ → กดปุ่ม <strong>New query</strong></li>
                  <li>วางโค้ดที่คัดลอกลงไป แล้วกดปุ่ม <strong>Run (สีเขียว)</strong> ได้ทันทีครับ</li>
                </ol>
              </div>

              <div className="relative">
                <pre className="p-3.5 rounded-xl bg-slate-950 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-80 leading-relaxed border border-slate-800">
                  {SUPABASE_SQL_DDL_SCHEMA}
                </pre>
                <button
                  type="button"
                  onClick={handleCopySqlDdl}
                  className="absolute top-2.5 right-2.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer shadow-xs"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'คัดลอกแล้ว!' : 'คัดลอกโค้ด'}</span>
                </button>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                รองรับ PostgreSQL 15+ บน Supabase พร้อม Row-Level Security (RLS)
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopySqlDdl}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-sky-400" />}
                  <span>{copiedSql ? 'คัดลอกแล้ว!' : 'คัดลอกคำสั่ง SQL ทั้งหมด'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSqlDdlModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: SYSTEM HANDOVER & ARCHITECTURE DOCUMENTATION */}
      {subTab === 'handover' && (
        <div className="space-y-4">
          {/* Header Banner */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
                  System Handover & Architecture Spec
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold">
                  ไฟล์ในโปรเจกต์: /HANDOVER_DOCUMENTATION.md
                </span>
              </div>
              <h3 className="text-base font-bold text-white">
                เอกสารส่งต่องาน โครงสร้างระบบ 39 คอลัมน์ และแผนพัฒนาต่อยอด
              </h3>
              <p className="text-xs text-slate-300">
                สรุปสถานะโมดูลทั้ง 10 เมนู กฎเหล็กทางสถาปัตยกรรมที่ห้ามแก้ไขให้ผิดเพี้ยน และลำดับงานพัฒนาต่อยอด
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>พิมพ์ / บันทึก PDF เอกสารส่งต่องาน</span>
            </button>
          </div>

          {/* 1. Module Status Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Layers className="w-4 h-4 text-blue-600" />
              <h4 className="text-sm font-bold text-slate-900">
                1. สถานะระบบปัจจุบันครบทั้ง 11 เมนู (Current Module Status)
              </h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3 font-bold">#</th>
                    <th className="py-2.5 px-3 font-bold">เมนูในระบบ</th>
                    <th className="py-2.5 px-3 font-bold">ไฟล์หลัก</th>
                    <th className="py-2.5 px-3 font-bold">สถานะ</th>
                    <th className="py-2.5 px-3 font-bold">ขอบเขตการทำงานที่สร้างเสร็จแล้ว</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">01</td>
                    <td className="py-2 px-3 font-bold text-slate-900">กล่องพักบิลจาก LINE</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">LineInboxView.tsx / server.ts</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">รับรูปบิลจากกลุ่ม LINE OA ผ่าน Webhook (/api/line/webhook), AI สแกนแยกประเภทอัตโนมัติ, ผู้ใช้ตรวจเทียบรูปเองโดยไม่ติดป้ายซ้ำอัตโนมัติ, ตอบกลับด้วย Quote Reply (0 โควตา), แยกชื่อกลุ่ม LINE ออกจากชื่อโครงการ</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">02</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ใบส่งของ / ใบส่งสินค้า (DO)</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">TableView39Cols.tsx / StatSummaryCards.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">ตารางหลัก 39 คอลัมน์ (7 โซน), แบ่ง 3 มุมมอง (ทั้งหมด, DO สินค้าทั่วไป, DO สินค้าชั่งน้ำหนัก), การ์ดสรุป KPI 6 ใบแบบสมดุล</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">03</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ใบสั่งซื้อ (PO)</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">POManagementView.tsx / PODetailModal.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">เปิด PO / สแกน PO ด้วย AI, ระบบชนบิล 3-Way Matching (reconcilePO) ตัดโควตาส่งมอบสะสมอัตโนมัติ พร้อมพิมพ์ใบสั่งซื้อหัวกระดาษบริษัท</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">04</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ตั๋วชั่งปลายทาง</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">TableView39Cols.tsx / App.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">แยกเก็บตั๋วชั่งน้ำหนักหน้างานปลายทาง (ช่อง 16–20) ชนบิลคู่กับ DO ต้นทาง และคำนวณผลต่างน้ำหนัก (ช่อง 21) อัตโนมัติโดยไม่นับยอดเงินซ้ำ</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">05</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ใบเสร็จ/กำกับภาษี</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">TableView39Cols.tsx / App.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">แยกเก็บบิลการเงิน/ใบกำกับภาษี (โซน 5–6) ชนบิลเข้ากับ DO หรือบันทึกซื้อสดหน้าร้านโดยไม่นับยอดซื้อซ้ำซ้อน</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">06</td>
                    <td className="py-2 px-3 font-bold text-slate-900">รับวางบิล (Express RR)</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">PurchasingBillingView.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">ชนข้อมูล DO กับใบวางบิลร้านค้า (เลือกเกณฑ์น้ำหนัก col15/col20/MIN + ปรับขนส่ง/VAT/เศษสตางค์), พิมพ์ใบปะหน้า A4 & Export .CSV/.TXT เข้า Express, และ Auto-Stamp เลข RR ลงช่อง col5 พร้อมล็อกบิล BILLED</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">07</td>
                    <td className="py-2 px-3 font-bold text-slate-900">วิเคราะห์ & การเงิน</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">AnalyticsView.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">แดชบอร์ดวิเคราะห์ยอดซื้อ ชำระแล้ว หนี้คงค้าง แยกตามร้านค้า โครงการ หมวดหมู่วัสดุ และตรวจสอบผลต่างน้ำหนัก</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">08</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ออกรายงาน Excel / PDF</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">ReportsExportView.tsx / excelExport.ts</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">ออกรายงาน A4 5 แม่แบบ พร้อมหัวกระดาษและโลโก้ บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด ช่องลงนาม 3 ฝ่าย และส่งออก Excel หลายชีต</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">09</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ทะเบียนร้านค้า</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">StoresManagementView.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">ฐานข้อมูลร้านค้า/ผู้จำหน่าย คำนวณยอดซื้อสะสม ชำระแล้ว และหนี้คงค้างแบบ Real-time จากตารางบิลจริง (syncStoreFinancials)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">10</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ทะเบียนโครงการ</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">App.tsx (Projects View)</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">บริหารโครงการก่อสร้าง ติดตามงบประมาณ ยอดเปิด PO ยอดรับของจริง และกดกรองดูบิลรายโครงการได้ทันที</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-bold">11</td>
                    <td className="py-2 px-3 font-bold text-slate-900">ผู้ใช้งาน & สิทธิ์ / ตั้งค่าระบบ</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500">UsersRolesView.tsx / SystemSettingsView.tsx</td>
                    <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">พร้อมใช้งาน</span></td>
                    <td className="py-2 px-3">ระบบบัญชี Username/Password และสิทธิ์ 3 ระดับ (Admin, Manager, User), ตั้งค่าบริษัท และสำรอง/กู้คืนไฟล์ .json</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Strict System Invariants */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h4 className="text-sm font-bold text-slate-900">
                  2. กฎเหล็กทางสถาปัตยกรรม (ห้ามแก้ไขให้ผิดเพี้ยน)
                </h4>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                <li className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <strong className="text-slate-900">1. โครงสร้างตาราง 39 คอลัมน์ (7 โซน):</strong> ใช้คีย์ <code className="font-mono text-indigo-700">col1</code> ถึง <code className="font-mono text-indigo-700">col38</code> (+ คอลัมน์จัดการเป็น 39) ห้ามเปลี่ยนความหมายประจำคอลัมน์เด็ดขาด
                </li>
                <li className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <strong className="text-slate-900">2. ป้องกันการนับยอดซ้ำ (Anti-Double Counting):</strong> ตั๋วชั่งปลายทาง (<code className="font-mono text-indigo-700">dest_weighbridge</code>) และใบกำกับภาษีที่ผูกกับ DO แล้ว (<code className="font-mono text-indigo-700">linkedViaDocNo</code>) ห้ามนำมานับรวมเป็นจำนวนบิลส่งของหรือบวกยอดเงินซ้ำกับใบ DO
                </li>
                <li className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <strong className="text-slate-900">3. มาตรฐาน AI เดียวกันทั้งระบบ:</strong> ทั้ง <code className="font-mono text-indigo-700">/api/scan-bill</code> และ <code className="font-mono text-indigo-700">/api/line/webhook</code> ใช้โมเดลตระกูล <code className="font-mono text-indigo-700">FLASH_LITE_MODELS</code> พร้อมกฎสกัดเลขที่บิล <code className="font-mono text-indigo-700">เล่มที่/เลขที่</code> และกฎสลับน้ำหนัก <code className="font-mono text-indigo-700">Gross &gt;= Tare</code> ชุดเดียวกัน
                </li>
                <li className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <strong className="text-slate-900">4. แยกชื่อกลุ่ม LINE ออกจากชื่อโครงการ:</strong> ชื่อกลุ่ม LINE เก็บใน <code className="font-mono text-indigo-700">lineGroupName</code> เท่านั้น ห้ามนำไปใส่ใน <code className="font-mono text-indigo-700">col2</code> (ชื่อโครงการ) อัตโนมัติ เพื่อให้ผู้ตรวจรับเลือกโครงการจริงเอง
                </li>
                <li className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <strong className="text-slate-900">5. ระบบล้างลิงก์อัตโนมัติ (Cascade Unlink):</strong> เมื่อลบตั๋วชั่งปลายทาง ลบ DO หรือลบ PO ระบบใน <code className="font-mono text-indigo-700">App.tsx</code> จะล้างค่าการผูกบิลที่เกี่ยวข้องให้อัตโนมัติ
                </li>
              </ul>
            </div>

            {/* 3. Next Steps & Roadmap */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <GitBranch className="w-4 h-4 text-indigo-600" />
                <h4 className="text-sm font-bold text-slate-900">
                  3. แผนงานพัฒนาต่อยอดในระยะถัดไป (Next Steps Roadmap)
                </h4>
              </div>
              <div className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200/80">
                  <div className="font-bold text-indigo-950">ระยะที่ 1: เชื่อมต่อ Supabase Cloud (PostgreSQL + Realtime)</div>
                  <p className="text-slate-600 mt-0.5">
                    จัดเก็บข้อมูลธุรกรรมตาราง 39 คอลัมน์, PO, ร้านค้า, โครงการ และกล่องพัก LINE แบบ Realtime พร้อมเก็บรหัสอ้างอิง <code className="font-mono">drive_file_id</code> / <code className="font-mono">drive_folder_id</code>
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/80">
                  <div className="font-bold text-blue-950">ระยะที่ 2: เชื่อมต่อ Google Drive (Auto-Folder & Zero-Junk Cleanup)</div>
                  <p className="text-slate-600 mt-0.5">
                    สร้างโฟลเดอร์แยกตามประเภทและเลขที่เอกสารอัตโนมัติ ย้ายไฟล์มารวมชุดเมื่อชนบิลสำเร็จ และลบไฟล์เก่า/ไฟล์ที่ถูกลบออกจาก Google Drive ทันที 100%
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/80">
                  <div className="font-bold text-emerald-950">ระยะที่ 3: เชื่อมต่อ LINE Official Account จริงใน Production</div>
                  <p className="text-slate-600 mt-0.5">
                    นำ Webhook URL (<code className="font-mono">/api/line/webhook</code>) ไปผูกใน LINE Developers Console ตั้งค่า Channel Access Token / Secret และเชิญบอทเข้ากลุ่มหน้างานจริง
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80">
                  <div className="font-bold text-amber-950">ระยะที่ 4: ระบบใบสรุปวางบิลและใบสำคัญจ่าย (Payment Voucher)</div>
                  <p className="text-slate-600 mt-0.5">
                    ต่อยอดจากโซน 6 (ช่อง 30–36) ให้ติ๊กเลือกหลายบิลของร้านค้าเดียวกันเพื่อรวบยอดออกใบสำคัญจ่าย แนบสลิปโอนเงิน และตัดยอดหนี้คงค้างทั้งชุดในคลิกเดียว
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Database & Google Drive Zero-Junk Blueprint */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="w-4 h-4 text-emerald-600" />
                <h4 className="text-sm font-bold text-slate-900">
                  4. แผนงานสถาปัตยกรรมฐานข้อมูล: Supabase Cloud + Google Drive (Auto-Move & Zero-Junk Cleanup)
                </h4>
              </div>
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-mono font-bold">
                ไฟล์อ้างอิง SQL & Spec: /DATABASE_STORAGE_BLUEPRINT.md
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left: 5-Zone Google Drive Folder Tree */}
              <div className="lg:col-span-5 bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-[11px] space-y-1.5 leading-relaxed">
                <div className="text-sky-400 font-bold mb-2 font-sans text-xs">
                  โครงสร้าง 5 โซนโฟลเดอร์อัตโนมัติบน Google Drive (ยึดตามประเภท & เลขเอกสาร ไม่ผูกชื่อโครงการ):
                </div>
                <div className="text-amber-300 font-bold">📁 BRTC_ERP_Storage/</div>
                <div className="pl-3 text-slate-300">├── 📁 <span className="text-teal-300 font-bold">00_กล่องพักบิล_LINE_รอตรวจรับ/</span></div>
                <div className="pl-6 text-slate-400">└── 🖼️ LINE_msgId.jpg (ลบทิ้ง = ลบไฟล์ทันที)</div>
                <div className="pl-3 text-slate-300">├── 📁 <span className="text-indigo-300 font-bold">01_ใบสั่งซื้อ_PO/</span></div>
                <div className="pl-6 text-slate-400">└── 📁 PO-2026-001_หจก.ศิลาบุรีรัมย์/</div>
                <div className="pl-3 text-slate-300">├── 📁 <span className="text-emerald-300 font-bold">02_ใบงานหลัก_DO_ครบชุด/</span></div>
                <div className="pl-6 text-emerald-200 font-bold">└── 📁 TR-2026-0001_DO-02-0045/</div>
                <div className="pl-10 text-slate-300">├── 🖼️ 1_DO_02-0045.jpg (ใบส่งของ)</div>
                <div className="pl-10 text-sky-300">├── 🖼️ 2_WB_W-1024.jpg (ย้ายมารวมเมื่อชนบิล!)</div>
                <div className="pl-10 text-amber-200">└── 🖼️ 3_TAX_IV-889.jpg (ย้ายมารวมเมื่อชนบิล!)</div>
                <div className="pl-3 text-slate-300">├── 📁 <span className="text-sky-300 font-bold">03_ตั๋วชั่งปลายทาง_รอจับคู่DO/</span></div>
                <div className="pl-6 text-slate-400">└── (พักตั๋วชั่งที่ยังไม่มี DO มาชน)</div>
                <div className="pl-3 text-slate-300">└── 📁 <span className="text-amber-300 font-bold">04_ใบเสร็จกำกับภาษี_เอกเทศ/</span></div>
                <div className="pl-6 text-slate-400">└── (บิลซื้อสด / ใบกำกับภาษีที่ยังไม่ผูก DO)</div>
              </div>

              {/* Right: Auto-Move & Zero-Junk Rules */}
              <div className="lg:col-span-7 space-y-2.5 text-xs">
                <div className="font-bold text-slate-900">
                  กฎการทำงานอัตโนมัติ (คนไม่ต้องย้ายหรือลบไฟล์เอง):
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="font-bold text-slate-900">1. รับบิลจาก LINE & ตรวจรับบิล</div>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      รูปจาก LINE พักในโฟลเดอร์ <code className="font-mono font-bold">00</code> ก่อน เมื่อกดยืนยันตรวจรับเป็น DO ระบบสร้างโฟลเดอร์ <code className="font-mono font-bold">TR-xxxx_DO-xxxx</code> ในโซน <code className="font-mono font-bold">02</code> แล้วย้ายไฟล์เข้าทันที
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="font-bold text-slate-900">2. ย้ายมารวมชุดเมื่อจับคู่สำเร็จ (Auto-Move)</div>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      ตั๋วชั่งในโซน <code className="font-mono font-bold">03</code> หรือใบกำกับภาษีในโซน <code className="font-mono font-bold">04</code> ทันทีที่จับคู่ชนกับใบ DO สำเร็จ ระบบย้ายไฟล์เข้ามารวมในโฟลเดอร์ใบงานของ DO นั้นทันที
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="font-bold text-slate-900">3. เปลี่ยนโครงการ / แก้เลขบิลไม่พัง</div>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      เปลี่ยนโครงการใน Supabase กี่ครั้งก็ได้โดยไม่ต้องย้ายโฟลเดอร์ใน Drive และหากแก้เลขที่บิล ระบบสั่ง <code className="font-mono font-bold">Rename</code> โฟลเดอร์เดิมตาม <code className="font-mono">drive_folder_id</code>
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200">
                    <div className="font-bold text-rose-950">4. ล้างไฟล์ขยะอัตโนมัติ (Zero-Junk 100%)</div>
                    <p className="text-rose-900/80 mt-1 leading-relaxed">
                      เมื่ออัปโหลดรูปใหม่ทับรูปเดิม หรือกดลบใบงานออกจากระบบ ระบบสั่งลบไฟล์/โฟลเดอร์นั้นออกจาก Google Drive ทันที ไม่เหลือไฟล์ขยะตกค้าง
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 5. Purchasing Billing Note & Express Accounting 4-Step Blueprint */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSignature className="w-4 h-4 text-indigo-600" />
                <h4 className="text-sm font-bold text-slate-900">
                  5. พิมพ์เขียว "ระบบรับวางบิลฝ่ายจัดซื้อ & เชื่อมต่อโปรแกรมบัญชี Express" (4-Step Workflow)
                </h4>
              </div>
              <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-mono font-bold">
                Auto-Stamp ช่อง col5 (เลขที่ RR) + ล็อกบิล BILLED
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="inline-block px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold">
                  STEP 1
                </div>
                <div className="font-bold text-slate-900">ชนข้อมูล DO กับ ใบวางบิล Supplier</div>
                <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                  <li>ดึง DO ค้างวางบิลจากตาราง 39 คอลัมน์</li>
                  <li>เลือกเกณฑ์น้ำหนัก (<code className="font-mono">col15</code> ต้นทาง / <code className="font-mono">col20</code> ปลายทาง / <code className="font-mono">MIN</code> น้อยกว่า) + แปลง กก. เป็น ตัน</li>
                  <li>เลือกโหมดวางบิล (ค่าวัสดุ <code className="font-mono">col25</code> / ขนส่ง <code className="font-mono">col28</code> / รวม <code className="font-mono">col29</code>) + VAT 7% + ปรับเศษสตางค์</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="inline-block px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">
                  STEP 2
                </div>
                <div className="font-bold text-slate-900">สร้างชุดรับวางบิล & ส่งออก Express</div>
                <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                  <li>ออกเลขชุดรับวางบิล (<code className="font-mono">BN-xxxx</code>) + คำนวณวันครบกำหนดชำระตามเครดิตร้านค้า</li>
                  <li>พิมพ์ใบสรุปปะหน้าชุดรับวางบิล (A4/PDF) ตรงตามหน้าจอคีย์ RR ของ Express</li>
                  <li>Export ไฟล์ข้อมูล (<code className="font-mono">.CSV / .TXT / .XLSX</code>) สำหรับนำเข้าโปรแกรม Express</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="inline-block px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold">
                  STEP 3
                </div>
                <div className="font-bold text-slate-900">นำเข้าโปรแกรม Express & ออกเลข RR</div>
                <ul className="text-slate-600 space-y-1 list-disc pl-4 leading-relaxed">
                  <li>Import ไฟล์เข้า Express (หรือคีย์อ้างอิงจากใบสรุปปะหน้าชุดรับวางบิล)</li>
                  <li>โปรแกรม Express บันทึกซื้อเชื่อ/รับสินค้า และออก <strong>"เลขที่ RR"</strong> (เช่น <code className="font-mono">RR6903-0015</code>)</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1.5">
                <div className="inline-block px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                  STEP 4
                </div>
                <div className="font-bold text-emerald-950">บันทึกเลข RR กลับ & Auto-Stamp</div>
                <ul className="text-emerald-900/90 space-y-1 list-disc pl-4 leading-relaxed">
                  <li>นำเลขที่ RR จาก Express มากรอกในชุดวางบิล</li>
                  <li>ระบบ <strong>Auto-Stamp</strong> เลข RR ลงช่อง <code className="font-mono font-bold">col5</code> ของ DO ทุกใบในชุดทันที</li>
                  <li>อัปเดตสถานะตั้งหนี้ โซน 6 (<code className="font-mono">col30–col36</code>) และล็อกสถานะเป็น <code className="font-mono font-bold">BILLED</code> ป้องกันวางบิลซ้ำ</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
