import React, { useState } from 'react';
import {
  MessageSquare,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Settings,
  RefreshCw,
  Trash2,
  Eye,
  Copy,
  Check,
  Filter,
  Search,
  Cloud
} from 'lucide-react';
import {
  DocumentType,
  LineBillInboxItem,
  LineBotConfig,
  OrderRecord,
  PurchaseOrder
} from '../types';
import {
  remapLineBillToDocType,
  rescanBillForTargetDocType
} from '../utils/lineBillRemapper';

interface LineInboxViewProps {
  inboxItems: LineBillInboxItem[];
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  onUpdateInboxItem: (updated: LineBillInboxItem) => void;
  onAddInboxItems: (newItems: LineBillInboxItem[]) => void;
  onDeleteInboxItem: (id: string) => void;
  onOpenVerifyFromInbox: (item: LineBillInboxItem) => void;
  onSyncWebhookQueue: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

const DOC_TYPE_OPTIONS: { value: DocumentType; shortLabel: string }[] = [
  {
    value: 'delivery_order',
    shortLabel: '📦 ใบส่งของ (DO)'
  },
  {
    value: 'dest_weighbridge',
    shortLabel: '⚖️ ตั๋วชั่งปลายทาง'
  },
  {
    value: 'tax_invoice',
    shortLabel: '🧾 ใบเสร็จ/กำกับภาษี'
  },
  {
    value: 'purchase_order',
    shortLabel: '📝 ใบสั่งซื้อ (PO)'
  }
];

export const LineInboxView: React.FC<LineInboxViewProps> = ({
  inboxItems,
  onUpdateInboxItem,
  onDeleteInboxItem,
  onOpenVerifyFromInbox,
  onSyncWebhookQueue,
  showToast
}) => {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending_review' | 'duplicate_warning' | 'scan_failed' | 'verified' | 'ignored_non_bill'
  >('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Webhook Settings Modal State
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [copiedWebhook, setCopiedWebhook] = useState<boolean>(false);
  const [botConfig, setBotConfig] = useState<LineBotConfig>({
    enabled: true,
    channelAccessToken: '',
    channelSecret: '',
    autoQuoteReply: true,
    replyOnDuplicate: true,
    replyOnUnclearImage: true,
    filterNonBillImages: true,
    strictZeroPushQuota: true,
    allowedGroupNames: []
  });
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [loadingImageId, setLoadingImageId] = useState<string | null>(null);
  const [previewImageModal, setPreviewImageModal] = useState<{
    image: string;
    title: string;
    replyText?: string;
  } | null>(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  // Load bill image on-demand from server (image_url is NOT in list payload to save bandwidth)
  const handleOpenImagePreview = async (item: LineBillInboxItem) => {
    const title = `บิลจาก ${item.lineSenderName} (${item.lineGroupName})`;
    // If image is already in memory (e.g. from in-memory queue), use it directly
    if (item.image && item.image.length > 10) {
      setPreviewImageModal({ image: item.image, title, replyText: item.botReplyText });
      return;
    }
    // If Drive link available, open in new tab instead
    if (item.driveWebViewLink) {
      window.open(item.driveWebViewLink, '_blank', 'noopener');
      return;
    }
    // Load from server on-demand
    setLoadingImageId(item.id);
    try {
      const resp = await fetch(`/api/line/inbox/image/${item.id}`);
      const data = await resp.json();
      if (data.success && data.image) {
        setPreviewImageModal({ image: data.image, title, replyText: item.botReplyText });
      } else {
        showToast('ไม่พบรูปภาพบิลนี้ในระบบ', 'info');
      }
    } catch {
      showToast('โหลดรูปภาพไม่สำเร็จ', 'info');
    } finally {
      setLoadingImageId(null);
    }
  };

  const handleSyncImagesToDrive = async () => {
    setIsSyncingDrive(true);
    let totalUploaded = 0;
    let totalAiRescanned = 0;
    let totalFailed = 0;
    let cursorId: string | undefined;
    const syncErrors: string[] = [];
    let hasMore = true;
    try {
      while (hasMore) {
        const res = await fetch('/api/drive/sync-inbox-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchSize: 5,
            cursorId
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`เซิร์ฟเวอร์ตอบกลับรหัส ${res.status}: ${errText.slice(0, 120)}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'การซิงก์รูปภาพขัดข้อง');
        }

        totalUploaded += data.uploadedCount || 0;
        totalAiRescanned += data.aiRescanCount || 0;
        totalFailed += data.failedCount || 0;
        syncErrors.push(...(Array.isArray(data.errors) ? data.errors : []));
        hasMore = Boolean(data.hasMore);
        if (hasMore) {
          if (!data.nextCursorId || data.nextCursorId === cursorId) {
            throw new Error('เซิร์ฟเวอร์ไม่ส่ง cursor สำหรับอ่านชุดถัดไป จึงหยุดเพื่อป้องกันการวนซ้ำ');
          }
          cursorId = data.nextCursorId;
          showToast(`กำลังซิงก์รูปภาพ... สำเร็จแล้ว ${totalUploaded} ใบ (เหลืออีก ${data.remainingCount} ใบ)`, 'info');
        }
      }
      await onSyncWebhookQueue();
      if (totalFailed > 0) {
        const errorSummary = syncErrors.slice(0, 3).join(' | ');
        showToast(
          `ตรวจคิวครบแล้ว: ขึ้น Drive ${totalUploaded} รายการ, สแกน AI ${totalAiRescanned} รายการ, ผิดพลาด ${totalFailed} รายการ${errorSummary ? ` — ${errorSummary}` : ''}`,
          'info'
        );
      } else {
        showToast(`ตรวจคิวครบแล้ว: ขึ้น Drive ${totalUploaded} รายการ และสแกน AI ${totalAiRescanned} รายการ`);
      }
    } catch (err: any) {
      showToast(`การซิงก์รูปภาพขัดข้อง: ${err?.message}`, 'info');
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const webhookUrl = `${window.location.origin}/api/line/webhook`;

  // Counts by status
  const pendingCount = inboxItems.filter(i => i.status === 'pending_review' || i.status === 'queued').length;
  const duplicateCount = inboxItems.filter(i => i.status === 'duplicate_warning').length;
  const failedCount = inboxItems.filter(i => i.status === 'scan_failed').length;
  const verifiedCount = inboxItems.filter(i => i.status === 'verified').length;
  const ignoredCount = inboxItems.filter(i => i.status === 'ignored_non_bill').length;

  // Unique LINE groups in inbox
  const uniqueGroups = Array.from(
    new Set(inboxItems.map(i => i.lineGroupName).filter(Boolean))
  );

  // Filtered items
  const filteredItems = inboxItems.filter(item => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending_review') {
        if (item.status !== 'pending_review' && item.status !== 'queued') return false;
      } else if (item.status !== statusFilter) {
        return false;
      }
    }
    if (groupFilter !== 'all' && item.lineGroupName !== groupFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const billNo = (
        item.extractedData?.col17 ||
        item.extractedData?.col6 ||
        item.extractedData?.col4 ||
        ''
      ).toLowerCase();
      const store = (item.extractedData?.col8 || '').toLowerCase();
      const sender = (item.lineSenderName || '').toLowerCase();
      const group = (item.lineGroupName || '').toLowerCase();
      const product = (item.extractedData?.col11 || '').toLowerCase();
      if (
        !billNo.includes(q) &&
        !store.includes(q) &&
        !sender.includes(q) &&
        !group.includes(q) &&
        !product.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  // Instant Document Type Switch
  const handleInstantDocTypeChange = (item: LineBillInboxItem, newDocType: DocumentType) => {
    const remappedData = remapLineBillToDocType(item.extractedData, newDocType);
    const updatedItem: LineBillInboxItem = {
      ...item,
      detectedDocType: newDocType,
      extractedData: {
        ...remappedData,
        col2: item.extractedData?.col2 || '',
        lineInboxId: item.id,
        lineSenderName: item.lineSenderName,
        lineGroupName: item.lineGroupName,
        lineReceivedAt: item.receivedAt
      }
    };
    onUpdateInboxItem(updatedItem);
    showToast(
      `เปลี่ยนประเภทเป็น "${
        DOC_TYPE_OPTIONS.find(d => d.value === newDocType)?.shortLabel || newDocType
      }" เรียบร้อยแล้ว`
    );
  };

  // AI Re-Scan on Row
  const handleCardAIRescan = async (item: LineBillInboxItem) => {
    if (!item.image || rescanningId) return;
    setRescanningId(item.id);
    try {
      const res = await rescanBillForTargetDocType(
        item.image,
        item.detectedDocType,
        item.extractedData
      );
      if (res.success && res.orderData) {
        const billNo =
          res.orderData.col17 || res.orderData.col6 || res.orderData.col4 || '';
        const storeName = res.orderData.col8 || 'ไม่ระบุร้านค้า';
        const updatedItem: LineBillInboxItem = {
          ...item,
          status: 'pending_review',
          extractedData: {
            ...res.orderData,
            col2: item.extractedData?.col2 || '',
            lineInboxId: item.id,
            lineSenderName: item.lineSenderName,
            lineGroupName: item.lineGroupName,
            lineReceivedAt: item.receivedAt
          },
          storeSuggestion: res.storeSuggestion || item.storeSuggestion,
          botReplyText: billNo
            ? `✅ บิลเลขที่ ${billNo} เก็บเข้าระบบรอตรวจสอบแล้ว\n• ร้านค้า: ${storeName}\n• ผู้ส่ง: ${item.lineSenderName}`
            : item.botReplyText
        };
        onUpdateInboxItem(updatedItem);
        showToast('AI อ่านข้อมูลบิลใหม่เรียบร้อยแล้ว');
      } else {
        showToast(res.error || 'ไม่สามารถอ่านข้อมูลใหม่ได้', 'info');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการสแกนซ้ำ', 'info');
    } finally {
      setRescanningId(null);
    }
  };

  const handleSaveBotConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/line/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(botConfig)
      });
      setIsConfigOpen(false);
      showToast('บันทึกการตั้งค่า LINE OA เรียบร้อยแล้ว');
    } catch {
      setIsConfigOpen(false);
      showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว');
    }
  };

  return (
    <div className="space-y-3">
      {/* Unified Action & Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              ทั้งหมด ({inboxItems.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending_review')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'pending_review'
                  ? 'bg-amber-500 text-slate-950 shadow-2xs'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>รอตรวจสอบ ({pendingCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('duplicate_warning')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'duplicate_warning'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>บิลซ้ำ ({duplicateCount})</span>
            </button>
            {failedCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('scan_failed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'scan_failed'
                    ? 'bg-orange-600 text-white'
                    : 'bg-orange-50 text-orange-900 border border-orange-200'
                }`}
              >
                รอสแกนซ้ำ ({failedCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => setStatusFilter('verified')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                statusFilter === 'verified'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>บันทึกแล้ว ({verifiedCount})</span>
            </button>
            {ignoredCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('ignored_non_bill')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'ignored_non_bill'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ไม่ใช่บิล ({ignoredCount})
              </button>
            )}
          </div>

          {/* Search, Group Filter & Webhook Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {uniqueGroups.length > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={groupFilter}
                  onChange={e => setGroupFilter(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50 text-xs font-semibold text-slate-800 outline-none"
                >
                  <option value="all">ทุกกลุ่ม LINE ({uniqueGroups.length})</option>
                  {uniqueGroups.map(g => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ค้นหาเลขบิล, ร้านค้า, ผู้ส่ง..."
                className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 w-48 sm:w-56 outline-none focus:border-blue-500 focus:bg-white"
              />
            </div>

            <button
              type="button"
              onClick={handleSyncImagesToDrive}
              disabled={isSyncingDrive}
              className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              title="ดึงรูปที่ยังไม่เคยซิงก์ทั้งหมดจาก LINE มาสแกน AI และอัปโหลดขึ้น Google Drive; ข้ามรายการที่มี Drive ID และรายการที่ตรวจรับแล้ว"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${isSyncingDrive ? 'animate-spin' : ''}`} />
              <span>{isSyncingDrive ? 'กำลังดึงรูป & สแกนใหม่...' : '🔄 ดึงรูป LINE & สแกนใหม่ & ขึ้น Drive ทั้งหมด'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onSyncWebhookQueue();
                showToast('ซิงค์คิวบิลจาก LINE เรียบร้อยแล้ว');
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="ดึงรายการบิลล่าสุดจาก LINE Webhook"
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
              <span>ซิงค์คิว LINE</span>
            </button>

            <button
              type="button"
              onClick={() => setIsConfigOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="ตั้งค่าเชื่อมต่อ LINE OA Webhook"
            >
              <Settings className="w-3.5 h-3.5 text-emerald-400" />
              <span>ตั้งค่า LINE OA</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Inbox Table */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div className="text-sm font-bold text-slate-800">ไม่มีรายการบิลในกล่องพัก</div>
          <div className="text-xs text-slate-500">
            บิลที่ส่งเข้ากลุ่ม LINE OA จะแสดงในตารางนี้อัตโนมัติ
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold text-[11px] whitespace-nowrap">
                  <th className="py-2.5 px-3 border-r border-slate-200 text-center w-10">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 w-16 text-center">รูปบิล</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[130px]">ผู้ส่ง / เวลา</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[130px]">กลุ่ม LINE</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[135px]">สถานะ</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[175px]">ประเภทเอกสาร</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[125px]">เลขที่บิล / วันที่</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[180px]">ร้านค้า / รายการสินค้า</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 text-right min-w-[120px]">ปริมาณ / ยอดรวม</th>
                  <th className="py-2.5 px-3 border-r border-slate-200 min-w-[130px]">โครงการ</th>
                  <th className="py-2.5 px-3 text-center min-w-[150px] sticky right-0 bg-slate-100 z-10 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)]">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredItems.map((item, idx) => {
                  const rawSnapshot = (item.rawAiSnapshot as any) || {};
                  const billNo =
                    item.detectedDocType === 'dest_weighbridge'
                      ? item.extractedData?.col17 || item.extractedData?.col6 || rawSnapshot.rawDocNo || rawSnapshot.rawRefDoNo || ''
                      : item.detectedDocType === 'purchase_order'
                      ? item.extractedData?.col4 || item.extractedData?.col6 || rawSnapshot.rawDocNo || rawSnapshot.rawRefPoNo || ''
                      : item.extractedData?.col6 || item.extractedData?.col17 || item.extractedData?.col4 || rawSnapshot.rawDocNo || rawSnapshot.rawRefDoNo || '';

                  const refPoOrDo =
                    item.detectedDocType === 'dest_weighbridge'
                      ? item.extractedData?.referenceDocNo || item.extractedData?.col4
                      : item.extractedData?.col4 || item.extractedData?.referenceDocNo;

                  const storeName = item.extractedData?.col8 || 'ไม่ระบุร้านค้า';
                  const productName = item.extractedData?.col11 || '-';
                  const licensePlate = item.extractedData?.col10 || '';
                  const netWeightKg =
                    item.detectedDocType === 'dest_weighbridge'
                      ? Number(item.extractedData?.col20) || 0
                      : Number(item.extractedData?.col15) || 0;
                  const totalAmount = Number(item.extractedData?.col29) || Number(item.extractedData?.col25) || 0;
                  const currentProject = (item.extractedData?.col2 || '').trim();

                  const rowBg =
                    item.status === 'duplicate_warning'
                      ? 'bg-rose-50/40 hover:bg-rose-50/80'
                      : item.status === 'verified'
                      ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                      : item.status === 'ignored_non_bill'
                      ? 'bg-slate-50/70 opacity-75'
                      : 'hover:bg-blue-50/40';

                  return (
                    <tr key={item.id} className={`transition-colors ${rowBg}`}>
                      {/* 1. Index */}
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center font-mono text-slate-500 font-semibold">
                        {idx + 1}
                      </td>

                      {/* 2. Bill Image Thumbnail */}
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center">
                        <button
                          type="button"
                          onClick={() => handleOpenImagePreview(item)}
                          disabled={loadingImageId === item.id}
                          className="relative group w-10 h-12 rounded-lg overflow-hidden border border-slate-300 bg-slate-800 mx-auto flex items-center justify-center cursor-pointer shadow-2xs"
                          title={item.driveWebViewLink ? 'คลิกเพื่อเปิดใน Google Drive' : 'คลิกเพื่อดูรูปบิล'}
                        >
                          {loadingImageId === item.id ? (
                            <RefreshCw className="w-3.5 h-3.5 text-white animate-spin" />
                          ) : item.image && item.image.length > 10 ? (
                            <img
                              src={item.image}
                              alt="LINE Bill"
                              className="w-full h-full object-cover group-hover:scale-110 transition"
                            />
                          ) : item.driveFileId ? (
                            <>
                              <Cloud className="w-4 h-4 text-blue-400" />
                              <span className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                                <Eye className="w-3.5 h-3.5" />
                              </span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5 text-slate-400" />
                              <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                                <Eye className="w-3.5 h-3.5" />
                              </span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* 3. Sender & Time */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle">
                        <div className="font-bold text-slate-900 truncate max-w-[135px]" title={item.lineSenderName}>
                          {item.lineSenderName}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          {new Date(item.receivedAt).toLocaleDateString('th-TH', {
                            day: '2-digit',
                            month: '2-digit'
                          })}{' '}
                          {new Date(item.receivedAt).toLocaleTimeString('th-TH', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </td>

                      {/* 4. LINE Group */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle">
                        <div className="font-medium text-slate-700 truncate max-w-[145px]" title={item.lineGroupName}>
                          {item.lineGroupName}
                        </div>
                      </td>

                      {/* 5. Status */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle">
                        {item.status === 'verified' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>บันทึกแล้ว ({item.verifiedOrderId || 'สำเร็จ'})</span>
                          </span>
                        ) : item.status === 'duplicate_warning' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold text-[11px]">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>ซ้ำ ({item.duplicateInfo?.matchedCode || 'ในระบบ'})</span>
                          </span>
                        ) : item.status === 'ignored_non_bill' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold text-[11px]">
                            ไม่ใช่บิล
                          </span>
                        ) : item.status === 'scan_failed' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 font-bold text-[11px]">
                            รอสแกนซ้ำ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-bold text-[11px]">
                            <Clock className="w-3 h-3 shrink-0" />
                            <span>รอตรวจสอบ</span>
                          </span>
                        )}
                      </td>

                      {/* 6. Document Type Switcher */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle">
                        {item.status !== 'ignored_non_bill' ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={item.detectedDocType}
                              onChange={e =>
                                handleInstantDocTypeChange(item, e.target.value as DocumentType)
                              }
                              className={`flex-1 px-2 py-1 rounded-lg border text-xs font-bold cursor-pointer outline-none ${
                                item.detectedDocType === 'dest_weighbridge'
                                  ? 'bg-teal-50 text-teal-900 border-teal-300'
                                  : item.detectedDocType === 'tax_invoice'
                                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                                  : item.detectedDocType === 'purchase_order'
                                  ? 'bg-indigo-50 text-indigo-900 border-indigo-300'
                                  : 'bg-sky-50 text-sky-900 border-sky-300'
                              }`}
                            >
                              {DOC_TYPE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.shortLabel}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={rescanningId === item.id}
                              onClick={() => handleCardAIRescan(item)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 transition cursor-pointer shrink-0"
                              title="สั่ง AI สแกนรูปนี้ซ้ำ"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${rescanningId === item.id ? 'animate-spin text-indigo-600' : ''}`} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* 7. Bill No & Date */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle font-mono">
                        {item.status !== 'ignored_non_bill' ? (
                          <div>
                            <div className="font-bold text-slate-900">
                              {billNo || <span className="text-amber-700 font-sans">รอระบุ</span>}
                            </div>
                            {refPoOrDo && refPoOrDo !== billNo && (
                              <div className="text-[10px] text-slate-500">
                                อ้างอิง: {refPoOrDo}
                              </div>
                            )}
                            {item.extractedData?.col7 && (
                              <div className="text-[10px] text-slate-400">
                                {item.extractedData.col7}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* 8. Store & Product */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle">
                        {item.status !== 'ignored_non_bill' ? (
                          <div>
                            <div className="font-bold text-slate-900 truncate max-w-[185px]" title={storeName}>
                              {storeName}
                            </div>
                            <div className="text-slate-600 truncate max-w-[185px]" title={productName}>
                              {productName}
                              {licensePlate ? ` • ทะเบียน ${licensePlate}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">{item.nonBillReason || '-'}</span>
                        )}
                      </td>

                      {/* 9. Qty / Weight / Amount */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle text-right font-mono tabular-nums">
                        {item.status !== 'ignored_non_bill' ? (
                          <div>
                            {netWeightKg > 0 ? (
                              <div className="font-bold text-emerald-800">
                                {netWeightKg.toLocaleString()} กก.
                              </div>
                            ) : (
                              <div className="font-bold text-slate-800">
                                {item.extractedData?.col22 || 1} {item.extractedData?.col23 || 'รายการ'}
                              </div>
                            )}
                            {totalAmount > 0 && (
                              <div className="text-[11px] font-bold text-blue-700">
                                ฿{totalAmount.toLocaleString()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* 10. Project Name */}
                      <td className="py-2 px-3 border-r border-slate-200 align-middle">
                        {item.status !== 'ignored_non_bill' ? (
                          currentProject ? (
                            <span className="font-bold text-emerald-800">{currentProject}</span>
                          ) : (
                            <span className="text-[11px] font-semibold text-amber-700">
                              รอระบุโครงการ
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* 11. Actions */}
                      <td
                        className={`py-2 px-3 align-middle text-center sticky right-0 z-10 shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.05)] ${
                          item.status === 'duplicate_warning'
                            ? 'bg-rose-50'
                            : item.status === 'verified'
                            ? 'bg-emerald-50'
                            : 'bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenVerifyFromInbox(item)}
                            className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
                              item.status === 'verified'
                                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                            }`}
                          >
                            <Sparkles className="w-3 h-3 shrink-0" />
                            <span>{item.status === 'verified' ? 'ดู/แก้ไข' : 'ตรวจรับบิล'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteInboxItem(item.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="ลบรายการ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImageModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewImageModal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl border border-slate-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <span className="font-bold text-xs sm:text-sm">{previewImageModal.title}</span>
              <button
                type="button"
                onClick={() => setPreviewImageModal(null)}
                className="text-slate-400 hover:text-white text-sm font-bold cursor-pointer"
              >
                ✕ ปิด
              </button>
            </div>
            <div className="p-4 bg-slate-950 max-h-[75vh] overflow-auto flex justify-center">
              <img
                src={previewImageModal.image}
                alt="Bill Full"
                className="max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* LINE OA Webhook Configuration Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">ตั้งค่าการเชื่อมต่อ LINE OA (Messaging API)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsConfigOpen(false)}
                className="text-slate-400 hover:text-white text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBotConfig} className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <label className="block font-bold text-slate-800">Webhook URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono text-[11px] text-blue-900 font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      setCopiedWebhook(true);
                      setTimeout(() => setCopiedWebhook(false), 2000);
                    }}
                    className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    {copiedWebhook ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedWebhook ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Channel Access Token</label>
                  <input
                    type="password"
                    value={botConfig.channelAccessToken}
                    onChange={e =>
                      setBotConfig(prev => ({ ...prev, channelAccessToken: e.target.value }))
                    }
                    placeholder="Channel Access Token..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Channel Secret</label>
                  <input
                    type="password"
                    value={botConfig.channelSecret}
                    onChange={e =>
                      setBotConfig(prev => ({ ...prev, channelSecret: e.target.value }))
                    }
                    placeholder="Channel Secret..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-slate-800">
                  <input
                    type="checkbox"
                    checked={botConfig.autoQuoteReply}
                    onChange={e =>
                      setBotConfig(prev => ({ ...prev, autoQuoteReply: e.target.checked }))
                    }
                    className="rounded text-emerald-600"
                  />
                  <span>ตอบกลับยืนยันรับบิลอัตโนมัติในกลุ่ม LINE (Reply Token)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-800">
                  <input
                    type="checkbox"
                    checked={botConfig.filterNonBillImages}
                    onChange={e =>
                      setBotConfig(prev => ({ ...prev, filterNonBillImages: e.target.checked }))
                    }
                    className="rounded text-emerald-600"
                  />
                  <span>คัดกรองรูปทั่วไปที่ไม่ใช่บิลออกอัตโนมัติ</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsConfigOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
