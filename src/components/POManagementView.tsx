import React, { useState, useMemo } from 'react';
import { 
  FileText, 
  Plus, 
  Search, 
  Sparkles, 
  FileSpreadsheet, 
  Truck, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Eye, 
  Edit3, 
  Trash2, 
  Layers, 
  Building2, 
  Calendar, 
  ArrowUpRight 
} from 'lucide-react';
import { PurchaseOrder, OrderRecord, StoreMerchant, POStatus } from '../types';
import { reconcileAllPOs } from '../utils/poReconciliation';
import * as XLSX from 'xlsx';

interface POManagementViewProps {
  pos: PurchaseOrder[];
  orders: OrderRecord[];
  stores: StoreMerchant[];
  onOpenCreatePO: () => void;
  onOpenScanPO: () => void;
  onSelectPO: (po: PurchaseOrder) => void;
  onEditPO: (po: PurchaseOrder) => void;
  onDeletePO: (id: string) => void;
  onAddTicketForPO: (po: PurchaseOrder) => void;
}

export const POManagementView: React.FC<POManagementViewProps> = ({
  pos,
  orders,
  stores,
  onOpenCreatePO,
  onOpenScanPO,
  onSelectPO,
  onEditPO,
  onDeletePO,
  onAddTicketForPO
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [confirmDeletePOId, setConfirmDeletePOId] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Reconcile all POs against real orders
  const reconciledPOs = useMemo(() => {
    return reconcileAllPOs(pos, orders);
  }, [pos, orders]);

  // Overall Statistics
  const stats = useMemo(() => {
    const totalCount = reconciledPOs.length;
    let totalAmount = 0;
    let deliveredAmount = 0;
    let pendingCount = 0;
    let partiallyCount = 0;
    let completedCount = 0;

    reconciledPOs.forEach(r => {
      totalAmount += r.po.totalAmount;
      deliveredAmount += r.deliveredAmount;
      if (r.status === 'completed') completedCount++;
      else if (r.status === 'partially_delivered') partiallyCount++;
      else if (r.status === 'pending') pendingCount++;
    });

    const remainingAmount = Math.max(0, totalAmount - deliveredAmount);
    const overallProgress = totalAmount > 0 ? Math.round((deliveredAmount / totalAmount) * 100) : 0;

    return {
      totalCount,
      totalAmount,
      deliveredAmount,
      remainingAmount,
      pendingCount,
      partiallyCount,
      completedCount,
      overallProgress
    };
  }, [reconciledPOs]);

  // Distinct Filter Options
  const projects = useMemo(() => {
    return Array.from(new Set(pos.map(p => p.projectId).filter(Boolean)));
  }, [pos]);

  const storeNames = useMemo(() => {
    return Array.from(new Set(pos.map(p => p.storeName).filter(Boolean)));
  }, [pos]);

  // Filtered List
  const filteredList = useMemo(() => {
    return reconciledPOs.filter(r => {
      if (selectedStatus !== 'all' && r.status !== selectedStatus) return false;
      if (selectedStore && r.po.storeName !== selectedStore) return false;
      if (selectedProject && r.po.projectId !== selectedProject) return false;

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const itemsStr = (r.po.items || []).map(i => i.itemDescription).join(' ').toLowerCase();
        const searchStr = `${r.po.poNumber} ${r.po.storeName} ${r.po.projectId} ${r.po.category} ${itemsStr}`.toLowerCase();
        if (!searchStr.includes(term)) return false;
      }

      return true;
    });
  }, [reconciledPOs, selectedStatus, selectedStore, selectedProject, searchTerm]);

  const fmtCurrency = (val: number) => {
    return '฿' + (val || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const exportPOsToExcel = () => {
    if (pos.length === 0) {
      setExportMessage('ไม่มีข้อมูลใบสั่งซื้อให้ส่งออก');
      return;
    }
    setExportMessage(null);

    const exportRows = reconciledPOs.map((r, idx) => ({
      'ลำดับ': idx + 1,
      'เลขที่ PO': r.po.poNumber,
      'วันที่สั่งซื้อ': r.po.orderDate,
      'กำหนดส่งมอบ': r.po.deliveryDueDate || '-',
      'ผู้จำหน่าย / ร้านค้า': r.po.storeName,
      'โครงการ': r.po.projectId,
      'หมวดหมู่': r.po.category,
      'ปริมาณรวมตาม PO': r.po.totalQty,
      'ยอดเงินรวมตาม PO (บาท)': r.po.totalAmount,
      'ปริมาณส่งมอบแล้ว': r.deliveredQty,
      'ยอดเงินส่งมอบแล้ว (บาท)': r.deliveredAmount,
      'ปริมาณคงเหลือ': r.remainingQty,
      'ยอดคงเหลือ (บาท)': r.remainingAmount,
      'ความคืบหน้า (%)': r.percentageDelivered + '%',
      'สถานะ': r.status === 'completed' ? 'ส่งมอบครบแล้ว' :
               r.status === 'partially_delivered' ? 'ส่งมอบบางส่วน' :
               r.status === 'cancelled' ? 'ยกเลิก' : 'รอส่งมอบ',
      'จำนวนตั๋วขนส่งที่ตัดยอด': r.linkedOrders.length,
      'เงื่อนไขชำระเงิน': r.po.creditTerms || '-',
      'ผู้สั่งซื้อ': r.po.orderedBy || '-',
      'หมายเหตุ': r.po.notes || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase_Orders');
    XLSX.writeFile(wb, `รายงานใบสั่งซื้อ_PO_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-4">
      
      {/* 4 Stat Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        
        {/* Stat 1: Total POs & Active */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-medium">ใบสั่งซื้อทั้งหมด</span>
            <div className="text-2xl font-bold text-slate-900 mt-0.5 tabular-nums">
              {stats.totalCount} <span className="text-xs font-normal text-slate-400">ฉบับ</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
              <span className="text-amber-600 font-semibold">{stats.pendingCount + stats.partiallyCount} รอส่งมอบ</span>
              <span>·</span>
              <span className="text-emerald-600 font-semibold">{stats.completedCount} สำเร็จ</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        {/* Stat 2: Total PO Amount */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-medium">มูลค่าสั่งซื้อรวม (ตาม PO)</span>
            <div className="text-2xl font-bold text-blue-900 mt-0.5 tabular-nums">
              {fmtCurrency(stats.totalAmount)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              ยอดจัดซื้อตามสัญญาและ PO
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        </div>

        {/* Stat 3: Delivered Amount & Progress */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-medium">มูลค่าที่ส่งมอบเข้ามาแล้ว</span>
            <div className="text-2xl font-bold text-emerald-700 mt-0.5 tabular-nums">
              {fmtCurrency(stats.deliveredAmount)}
            </div>
            <div className="text-[11px] text-emerald-600 mt-1 font-semibold">
              ส่งมอบแล้ว {stats.overallProgress}% ของยอดสั่งซื้อ
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Truck className="w-5 h-5" />
          </div>
        </div>

        {/* Stat 4: Remaining Outstanding */}
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 font-medium">ยอดคงค้างรอรับมอบ</span>
            <div className="text-2xl font-bold text-amber-700 mt-0.5 tabular-nums">
              {fmtCurrency(stats.remainingAmount)}
            </div>
            <div className="text-[11px] text-amber-600 mt-1">
              ยอดคงเหลือที่ต้องส่งมอบเข้าไซต์
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Control Bar: Actions, Search & Filters */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-3">
        
        {/* Top Action Row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          
          {/* Status Tabs */}
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg text-xs gap-0.5">
            <button
              onClick={() => setSelectedStatus('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                selectedStatus === 'all' 
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ทั้งหมด ({stats.totalCount})
            </button>
            <button
              onClick={() => setSelectedStatus('pending')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                selectedStatus === 'pending' 
                  ? 'bg-white text-amber-700 shadow-2xs font-semibold' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⏱️ รอส่งมอบ ({stats.pendingCount})
            </button>
            <button
              onClick={() => setSelectedStatus('partially_delivered')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                selectedStatus === 'partially_delivered' 
                  ? 'bg-white text-blue-700 shadow-2xs font-semibold' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🚚 กำลังส่งมอบ ({stats.partiallyCount})
            </button>
            <button
              onClick={() => setSelectedStatus('completed')}
              className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
                selectedStatus === 'completed' 
                  ? 'bg-white text-emerald-700 shadow-2xs font-semibold' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ✓ ครบแล้ว ({stats.completedCount})
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={exportPOsToExcel}
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>ส่งออกรายงาน PO (Excel)</span>
            </button>
            {exportMessage && (
              <p className="text-xs text-amber-700" role="status">{exportMessage}</p>
            )}
          </div>

        </div>

        {/* Filter Dropdowns & Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t border-slate-100">
          
          <div className="relative md:col-span-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาเลขที่ PO, ร้านค้า, โครงการ, รายการสินค้า..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none"
            />
          </div>

          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 cursor-pointer"
          >
            <option value="">ทุกร้านค้า / ผู้จำหน่าย ({storeNames.length})</option>
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 cursor-pointer"
          >
            <option value="">ทุกโครงการ ({projects.length})</option>
            {projects.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <div className="flex items-center justify-end text-xs text-slate-500">
            พบ <span className="font-bold text-slate-800 mx-1">{filteredList.length}</span> ฉบับ
          </div>

        </div>

      </div>

      {/* PO Table Container */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3 w-12 text-center">#</th>
                <th className="p-3">เลขที่ PO</th>
                <th className="p-3">วันที่ / กำหนดส่ง</th>
                <th className="p-3">ผู้จำหน่าย / ร้านค้า</th>
                <th className="p-3">โครงการ</th>
                <th className="p-3">รายการสินค้าหลัก</th>
                <th className="p-3 text-right">ยอดเงินรวม PO</th>
                <th className="p-3 text-center w-40">ความคืบหน้าส่งมอบ</th>
                <th className="p-3 text-center">สถานะ</th>
                <th className="p-3 text-center">ตั๋วที่ตัดยอด</th>
                <th className="p-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-16 text-center text-slate-400">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-2xs">
                        <FileText className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-bold text-slate-800">ยังไม่มีข้อมูลใบสั่งซื้อในระบบ</p>
                        <p className="text-xs text-slate-500">
                          เริ่มสร้างใบสั่งซื้อใหม่ หรือสแกนภาพใบสั่งซื้อ (PO) จริงด้วย Gemini AI
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          onClick={onOpenScanPO}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-xs"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>สแกนใบสั่งซื้อด้วย AI</span>
                        </button>
                        <button
                          onClick={onOpenCreatePO}
                          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                          title="สำหรับกรณีไม่มีรูปถ่ายเอกสารใบสั่งซื้อ"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>คีย์ข้อมูลด้วยตนเอง</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredList.map((recon, index) => {
                  const po = recon.po;
                  const firstItem = po.items && po.items[0]?.itemDescription;
                  const itemCount = po.items ? po.items.length : 0;

                  return (
                    <tr key={po.id} className="hover:bg-slate-50/80 transition">
                      
                      <td className="p-3 text-center text-slate-400 font-mono">{index + 1}</td>

                      {/* PO Number */}
                      <td className="p-3 font-mono font-bold text-blue-600">
                        <button
                          onClick={() => onSelectPO(po)}
                          className="hover:underline flex items-center gap-1 cursor-pointer text-left"
                          title="คลิกดูรายละเอียดใบสั่งซื้อ"
                        >
                          <span>{po.poNumber}</span>
                        </button>
                      </td>

                      {/* Dates */}
                      <td className="p-3">
                        <div className="font-mono text-slate-800">{po.orderDate}</div>
                        {po.deliveryDueDate && (
                          <div className="text-[10px] text-slate-500">
                            กำหนด: {po.deliveryDueDate}
                          </div>
                        )}
                      </td>

                      {/* Store / Vendor */}
                      <td className="p-3">
                        <div className="font-bold text-slate-900 truncate max-w-[180px]" title={po.storeName}>
                          {po.storeName}
                        </div>
                        <div className="text-[10px] text-slate-500">{po.category}</div>
                      </td>

                      {/* Project */}
                      <td className="p-3 text-slate-700 truncate max-w-[150px]" title={po.projectId}>
                        {po.projectId || '-'}
                      </td>

                      {/* Items Preview */}
                      <td className="p-3">
                        <div className="text-slate-900 font-medium truncate max-w-[180px]">
                          {firstItem || '-'}
                        </div>
                        {itemCount > 1 && (
                          <div className="text-[10px] text-slate-500">
                            และอีก {itemCount - 1} รายการ
                          </div>
                        )}
                      </td>

                      {/* Total Amount */}
                      <td className="p-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {fmtCurrency(po.totalAmount)}
                      </td>

                      {/* Fulfillment Progress */}
                      <td className="p-3">
                        <div className="space-y-1 w-36 mx-auto">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold font-mono text-slate-800">
                              {recon.percentageDelivered}%
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono" title={recon.isMultiItem ? 'ความคืบหน้าคิดตามมูลค่าเงินรวม (Multi-Item PO)' : undefined}>
                              {recon.isMultiItem ? 'ตามมูลค่าเงิน' : `${recon.deliveredQty.toLocaleString('th-TH')} / ${po.totalQty.toLocaleString('th-TH')}`}
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                recon.status === 'completed' ? 'bg-emerald-500' :
                                recon.percentageDelivered > 50 ? 'bg-blue-600' : 'bg-amber-500'
                              }`}
                              style={{ width: `${Math.min(100, recon.percentageDelivered)}%` }}
                            />
                          </div>
                          {recon.isMultiItem && (
                            <div className="text-center">
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200 font-medium">
                                📦 PO หลายรายการ ({po.items.length})
                              </span>
                            </div>
                          )}
                          {recon.hasUnitMismatch && (
                            <div className="text-center">
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-semibold" title={recon.unitMismatchWarnings?.join('\n')}>
                                ⚠️ หน่วยตั๋วไม่ตรง PO
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                          recon.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                          recon.status === 'partially_delivered' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          recon.status === 'cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                          'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {recon.status === 'completed' ? '✓ ส่งมอบครบ' :
                           recon.status === 'partially_delivered' ? '🚚 ส่งมอบบางส่วน' :
                           recon.status === 'cancelled' ? '✕ ยกเลิก' : '⏱️ รอส่งมอบ'}
                        </span>
                      </td>

                      {/* Linked Inbound Tickets Count */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => onSelectPO(po)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-mono text-xs font-semibold cursor-pointer transition"
                          title="คลิกดูตั๋วชั่งและบิลที่ตัดยอด PO นี้"
                        >
                          <Truck className="w-3 h-3 text-slate-500" />
                          <span>{recon.linkedOrders.length} ตั๋ว</span>
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onSelectPO(po)}
                            title="ดูเอกสาร / ตั๋วที่ตัดยอด"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onAddTicketForPO(po)}
                            title="+ บันทึกตั๋วชั่งตัดยอด PO นี้"
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onEditPO(po)}
                            title="แก้ไขใบสั่งซื้อ"
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md transition cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeletePOId(po.id)}
                            title="ลบใบสั่งซื้อ"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {confirmDeletePOId === po.id && (
                          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2">
                            <span className="text-[11px] text-rose-800">
                              ยืนยันลบ PO {po.poNumber}?
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onDeletePO(po.id);
                                setConfirmDeletePOId(null);
                              }}
                              className="rounded-md bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-800"
                            >
                              ยืนยัน
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePOId(null)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        )}
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            แสดง <span className="font-semibold text-slate-800">{filteredList.length}</span> จากทั้งหมด <span className="font-semibold text-slate-800">{pos.length}</span> ฉบับ
          </div>
          <div className="text-slate-600">
            ระบบจับคู่ตัดยอดใบสั่งซื้ออัตโนมัติเมื่อมีการบันทึกตั๋วชั่งหรือใบส่งของ
          </div>
        </div>
      </div>

    </div>
  );
};
