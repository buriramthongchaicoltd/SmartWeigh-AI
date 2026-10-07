import React, { useState, useMemo } from 'react';
import {
  OrderRecord,
  PurchaseOrder,
  StoreMerchant,
  ProjectRecord,
  SystemSettings,
  AppUser
} from '../types';
import { isMatchedOriginWeighbridge, reconcilePO } from '../utils/poReconciliation';
import { STANDARD_CONSTRUCTION_CATEGORIES } from '../utils/dbLookup';
import { DEFAULT_COMPANY_LOGO_URL } from '../utils/systemConfig';
import {
  Printer,
  FileSpreadsheet,
  Filter,
  FileText,
  Scale,
  Building2,
  Store,
  FolderKanban,
  RotateCcw,
  Calendar
} from 'lucide-react';

interface ReportsExportViewProps {
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  stores: StoreMerchant[];
  projects: ProjectRecord[];
  systemSettings: SystemSettings;
  currentUser: AppUser;
  canViewFinancials: boolean;
  showToast: (msg: string, type?: 'success' | 'info' | 'error') => void;
}

type ReportTemplateType =
  | 'receiving_39'
  | 'vendor_statement'
  | 'po_reconciliation'
  | 'weight_audit'
  | 'project_cost';

const REPORT_TEMPLATES: {
  id: ReportTemplateType;
  title: string;
  subtitle: string;
  badge: string;
}[] = [
  {
    id: 'receiving_39',
    title: '1. รายงานสรุปการรับวัสดุและใบส่งของ (Material Receiving & DO Report)',
    subtitle: 'สรุปรายการบิลรับของ เลขที่ DO/PO ร้านค้า รายการวัสดุ ปริมาณ น้ำหนักสุทธิ และยอดเงิน',
    badge: 'ยอดนิยม • หน้างาน & บัญชี'
  },
  {
    id: 'vendor_statement',
    title: '2. รายงานสรุปยอดจัดซื้อและหนี้คงค้างรายร้านค้า (Vendor Statement & AP)',
    subtitle: 'สรุปจำนวนบิล ยอดสั่งซื้อสะสม ยอดชำระแล้ว และยอดหนี้คงค้างแยกตามร้านค้าคู่ค้า',
    badge: 'การเงิน & เจ้าหนี้การค้า'
  },
  {
    id: 'po_reconciliation',
    title: '3. รายงานติดตามโควตาใบสั่งซื้อ 3-Way Matching (PO Fulfillment Report)',
    subtitle: 'เปรียบเทียบปริมาณสั่งซื้อตาม PO เทียบกับยอดรับจริงสะสม และโควตาคงเหลือ',
    badge: 'ฝ่ายจัดซื้อ & ควบคุมงบ'
  },
  {
    id: 'weight_audit',
    title: '4. รายงานตรวจสอบผลต่างน้ำหนักชั่งต้นทาง–ปลายทาง (Weighbridge Audit)',
    subtitle: 'ตรวจสอบน้ำหนักสุทธิต้นทาง (ช่อง 15) เทียบกับน้ำหนักสุทธิปลายทาง (ช่อง 20) และผลต่าง (กก./%)',
    badge: 'ตรวจสอบตาชั่ง & ป้องกันของขาด'
  },
  {
    id: 'project_cost',
    title: '5. รายงานสรุปต้นทุนวัสดุแยกตามโครงการ/หน้างาน (Project Cost Summary)',
    subtitle: 'สรุปจำนวนเที่ยวส่งของ ยอดสั่งซื้อ PO ยอดรับของจริง และยอดค้างชำระแยกตามโครงการ (ช่อง 2)',
    badge: 'ผู้บริหาร & ผู้จัดการโครงการ'
  }
];

export const ReportsExportView: React.FC<ReportsExportViewProps> = ({
  orders,
  pos,
  stores,
  projects,
  systemSettings,
  currentUser,
  canViewFinancials,
  showToast
}) => {
  const [reportType, setReportType] = useState<ReportTemplateType>('receiving_39');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedProject, setSelectedProject] = useState('ALL');
  const [selectedStore, setSelectedStore] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Unique Filter Options
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach(p => { if (p.name?.trim()) set.add(p.name.trim()); });
    orders.forEach(o => { if (o.col2?.trim()) set.add(o.col2.trim()); });
    pos.forEach(p => { if (p.projectId?.trim()) set.add(p.projectId.trim()); });
    return Array.from(set);
  }, [projects, orders, pos]);

  const storeOptions = useMemo(() => {
    const set = new Set<string>();
    stores.forEach(s => { if (s.name?.trim()) set.add(s.name.trim()); });
    orders.forEach(o => { if (o.col8?.trim()) set.add(o.col8.trim()); });
    pos.forEach(p => { if (p.storeName?.trim()) set.add(p.storeName.trim()); });
    return Array.from(set);
  }, [stores, orders, pos]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>(systemSettings.customCategories || []);
    STANDARD_CONSTRUCTION_CATEGORIES.forEach(c => set.add(c.value));
    orders.forEach(o => { if (o.col3?.trim()) set.add(o.col3.trim()); });
    pos.forEach(p => { if (p.category?.trim()) set.add(p.category.trim()); });
    return Array.from(set);
  }, [systemSettings.customCategories, orders, pos]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (dateFrom && o.col7 && o.col7 < dateFrom) return false;
      if (dateTo && o.col7 && o.col7 > dateTo) return false;
      if (selectedProject !== 'ALL' && (o.col2 || '').trim() !== selectedProject) return false;
      if (selectedStore !== 'ALL' && (o.col8 || '').trim() !== selectedStore) return false;
      if (selectedCategory !== 'ALL' && (o.col3 || '').trim() !== selectedCategory) return false;
      return true;
    });
  }, [orders, dateFrom, dateTo, selectedProject, selectedStore, selectedCategory]);

  // Filtered POs
  const filteredPOs = useMemo(() => {
    return pos.filter(p => {
      if (dateFrom && p.orderDate && p.orderDate < dateFrom) return false;
      if (dateTo && p.orderDate && p.orderDate > dateTo) return false;
      if (selectedProject !== 'ALL' && (p.projectId || '').trim() !== selectedProject) return false;
      if (selectedStore !== 'ALL' && (p.storeName || '').trim() !== selectedStore) return false;
      if (selectedCategory !== 'ALL' && (p.category || '').trim() !== selectedCategory) return false;
      return true;
    });
  }, [pos, dateFrom, dateTo, selectedProject, selectedStore, selectedCategory]);

  // Primary Delivery Orders (Exclude standalone dest_weighbridge & merged tax_invoice for anti-double counting)
  const primaryDeliveries = useMemo(() => {
    return filteredOrders.filter(
      o => o.docType !== 'dest_weighbridge' &&
        !isMatchedOriginWeighbridge(o) &&
        !(o.docType === 'tax_invoice' && o.linkedViaDocNo)
    );
  }, [filteredOrders]);

  // Summary Totals
  const totals = useMemo(() => {
    let totalAmount = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    let totalOriginKg = 0;
    let totalDestKg = 0;

    primaryDeliveries.forEach(o => {
      totalAmount += Number(o.col29) || 0;
      totalPaid += Number(o.col35) || 0;
      totalDebt += Number(o.col36) || 0;
      totalOriginKg += Number(o.col15) || 0;
      totalDestKg += Number(o.col20) || 0;
    });

    return {
      count: primaryDeliveries.length,
      totalAmount,
      totalPaid,
      totalDebt,
      totalOriginKg,
      totalDestKg
    };
  }, [primaryDeliveries]);

  // Project Summary Data
  const projectSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        projectName: string;
        orderCount: number;
        poCount: number;
        poBudget: number;
        deliveredAmount: number;
        paidAmount: number;
        debtAmount: number;
      }
    >();

    const ensureProj = (name: string) => {
      const key = (name || 'ไม่ระบุโครงการ').trim();
      if (!map.has(key)) {
        map.set(key, {
          projectName: key,
          orderCount: 0,
          poCount: 0,
          poBudget: 0,
          deliveredAmount: 0,
          paidAmount: 0,
          debtAmount: 0
        });
      }
      return map.get(key)!;
    };

    filteredPOs.forEach(p => {
      const row = ensureProj(p.projectId);
      row.poCount += 1;
      row.poBudget += Number(p.totalAmount) || 0;
    });

    primaryDeliveries.forEach(o => {
      const row = ensureProj(o.col2);
      row.orderCount += 1;
      row.deliveredAmount += Number(o.col29) || 0;
      row.paidAmount += Number(o.col35) || 0;
      row.debtAmount += Number(o.col36) || 0;
    });

    return Array.from(map.values());
  }, [filteredPOs, primaryDeliveries]);

  // Vendor Summary Data
  const vendorSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        storeName: string;
        category: string;
        orderCount: number;
        totalPurchases: number;
        totalPaid: number;
        totalDebt: number;
      }
    >();

    primaryDeliveries.forEach(o => {
      const name = (o.col8 || 'ไม่ระบุร้านค้า').trim();
      if (!map.has(name)) {
        map.set(name, {
          storeName: name,
          category: o.col3 || '-',
          orderCount: 0,
          totalPurchases: 0,
          totalPaid: 0,
          totalDebt: 0
        });
      }
      const row = map.get(name)!;
      row.orderCount += 1;
      row.totalPurchases += Number(o.col29) || 0;
      row.totalPaid += Number(o.col35) || 0;
      row.totalDebt += Number(o.col36) || 0;
    });

    return Array.from(map.values());
  }, [primaryDeliveries]);

  const handleQuickDateFilter = (mode: 'all' | 'this_month' | 'last_7_days') => {
    if (mode === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (mode === 'this_month') {
      setDateFrom(`${todayStr.slice(0, 7)}-01`);
      setDateTo(todayStr);
    } else if (mode === 'last_7_days') {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setDateFrom(past.toISOString().slice(0, 10));
      setDateTo(todayStr);
    }
  };

  const handleResetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedProject('ALL');
    setSelectedStore('ALL');
    setSelectedCategory('ALL');
  };

  const handlePrintPDF = () => {
    window.print();
  };

  const exportExcel = async (
    exportOrders: OrderRecord[],
    exportPOs: PurchaseOrder[],
    successMessage: string
  ) => {
    try {
      const { exportAllDataToExcel } = await import('../utils/excelExport');
      exportAllDataToExcel(exportOrders, stores, exportPOs);
      showToast(successMessage);
    } catch (error) {
      showToast(`ส่งออกไฟล์ Excel ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const handleExportFilteredExcel = () =>
    exportExcel(filteredOrders, filteredPOs, `ส่งออกไฟล์ Excel ตามตัวกรอง (${filteredOrders.length} รายการ) เรียบร้อยแล้ว`);

  const handleExportFullExcel = () =>
    exportExcel(orders, pos, 'ส่งออกไฟล์ Excel ทั้งระบบครบทุกชีตเรียบร้อยแล้ว');

  const activeTemplateMeta = REPORT_TEMPLATES.find(t => t.id === reportType) || REPORT_TEMPLATES[0];

  return (
    <div className="space-y-4">
      {/* Print-Only Stylesheet so A4 PDF output is clean without app sidebar/header */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #official-printable-report, #official-printable-report * {
            visibility: visible;
          }
          #official-printable-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>

      {/* Top Controls & Report Selector (Hidden during Print) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                ศูนย์ออกรายงานมาตรฐาน Excel & PDF (Official Report & Export Center)
              </h2>
              <p className="text-xs text-slate-500">
                เลือกรูปแบบรายงาน กรองตามช่วงวันที่/โครงการ/ร้านค้า พร้อมพรีวิวหัวกระดาษบริษัทและช่องลงนามสำหรับพิมพ์ PDF หรือส่งออก Excel
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handlePrintPDF}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              <span>พิมพ์รายงาน / บันทึกเป็น PDF (A4)</span>
            </button>
            <button
              type="button"
              onClick={handleExportFilteredExcel}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-100" />
              <span>ส่งออก Excel ตามตัวกรอง ({filteredOrders.length})</span>
            </button>
            <button
              type="button"
              onClick={handleExportFullExcel}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Excel ทั้งระบบ (6 ชีต)</span>
            </button>
          </div>
        </div>

        {/* 5 Report Template Selector Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
          {REPORT_TEMPLATES.map(tmpl => {
            const active = reportType === tmpl.id;
            return (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => setReportType(tmpl.id)}
                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                  active
                    ? 'bg-blue-50/90 border-blue-500 ring-2 ring-blue-100'
                    : 'bg-slate-50/70 hover:bg-white border-slate-200'
                }`}
              >
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold mb-1.5 ${
                    active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {tmpl.badge}
                  </span>
                  <div className="text-xs font-bold text-slate-900 leading-snug">{tmpl.title}</div>
                </div>
                <div className="text-[10px] text-slate-500 mt-1.5 line-clamp-2">{tmpl.subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Filter Bar */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-600" /> ตั้งแต่วันที่
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-600" /> ถึงวันที่
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <FolderKanban className="w-3.5 h-3.5 text-emerald-600" /> โครงการ (ช่อง 2)
            </label>
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="ALL">ทุกโครงการ ({projectOptions.length})</option>
              {projectOptions.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <Store className="w-3.5 h-3.5 text-indigo-600" /> ร้านค้า / ผู้จำหน่าย
            </label>
            <select
              value={selectedStore}
              onChange={e => setSelectedStore(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="ALL">ทุกร้านค้า ({storeOptions.length})</option>
              {storeOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-amber-600" /> หมวดหมู่วัสดุ
            </label>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="ALL">ทุกหมวดหมู่ ({categoryOptions.length})</option>
              {categoryOptions.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleQuickDateFilter('this_month')}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold cursor-pointer"
            >
              เดือนนี้
            </button>
            <button
              type="button"
              onClick={() => handleQuickDateFilter('last_7_days')}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold cursor-pointer"
            >
              7 วัน
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              title="ล้างตัวกรองทั้งหมด"
            >
              <RotateCcw className="w-3 h-3" /> ล้าง
            </button>
          </div>
        </div>
      </div>

      {/* OFFICIAL A4 PRINTABLE / PDF PREVIEW SHEET */}
      <div
        id="official-printable-report"
        className="bg-white rounded-2xl border border-slate-300 shadow-sm p-6 md:p-8 space-y-6 text-slate-900"
      >
        {/* Company Letterhead */}
        <div className="border-b-2 border-slate-900 pb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl border border-slate-200 bg-white p-1.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
              <img
                src={systemSettings.companyLogoUrl || DEFAULT_COMPANY_LOGO_URL}
                alt={systemSettings.companyName}
                className="w-full h-full object-contain"
                onError={e => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <div className="space-y-0.5">
              <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {systemSettings.companyName}
              </h1>
              <p className="text-xs text-slate-700">
                {systemSettings.companyAddress.startsWith('ที่อยู่')
                  ? systemSettings.companyAddress
                  : `ที่อยู่ ${systemSettings.companyAddress}`}
              </p>
              <p className="text-xs text-slate-700 font-mono">
                เลขประจำตัวผู้เสียภาษี {systemSettings.companyTaxId || '-'} &nbsp; โทร.{systemSettings.companyPhone || '-'}
              </p>
              {(systemSettings.companyEmail || 'brtc2024@gmail.com') && (
                <p className="text-xs text-slate-700 font-mono">
                  E-Mail.{systemSettings.companyEmail || 'brtc2024@gmail.com'}
                </p>
              )}
            </div>
          </div>

          <div className="text-right space-y-1">
            <div className="inline-block px-3 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold">
              {activeTemplateMeta.title.replace(/^\d+\.\s*/, '')}
            </div>
            <div className="text-[11px] text-slate-600">
              วันที่พิมพ์รายงาน: <strong>{new Date().toLocaleString('th-TH')}</strong>
            </div>
            <div className="text-[11px] text-slate-600">
              ผู้พิมพ์รายงาน: <strong>{currentUser.fullName}</strong>
            </div>
          </div>
        </div>

        {/* Filter Context Bar on Report */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
          <div>
            <span className="text-slate-500">ช่วงวันที่เอกสาร: </span>
            <strong className="font-mono">
              {dateFrom || 'เริ่มต้น'} ถึง {dateTo || 'ปัจจุบัน'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">โครงการ: </span>
            <strong>{selectedProject === 'ALL' ? 'ทุกโครงการ' : selectedProject}</strong>
          </div>
          <div>
            <span className="text-slate-500">ร้านค้า/คู่ค้า: </span>
            <strong>{selectedStore === 'ALL' ? 'ทุกร้านค้า' : selectedStore}</strong>
          </div>
          <div>
            <span className="text-slate-500">หมวดหมู่วัสดุ: </span>
            <strong>{selectedCategory === 'ALL' ? 'ทุกหมวดหมู่' : selectedCategory}</strong>
          </div>
        </div>

        {/* REPORT 1: MATERIAL RECEIVING & DO REPORT */}
        {reportType === 'receiving_39' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-slate-300 text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <th className="py-2 px-2.5 border-r border-slate-300 text-center">#</th>
                  <th className="py-2 px-2.5 border-r border-slate-300">วันที่ (7)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300">เลขที่ DO (6)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300">อ้างอิง PO (4)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300">โครงการ (2)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300">ผู้จำหน่าย / ร้านค้า (8)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300">รายการสินค้า (11)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300 text-right">ปริมาณ (22)</th>
                  <th className="py-2 px-2.5 border-r border-slate-300 text-center">หน่วย (23)</th>
                  {canViewFinancials && (
                    <>
                      <th className="py-2 px-2.5 border-r border-slate-300 text-right">ราคา/หน่วย</th>
                      <th className="py-2 px-2.5 border-r border-slate-300 text-right">ยอดรวมสุทธิ (29)</th>
                      <th className="py-2 px-2.5 text-right">ค้างชำระ (36)</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {primaryDeliveries.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-slate-500">
                      ไม่พบข้อมูลรายการบิลตามเงื่อนไขตัวกรองที่เลือก
                    </td>
                  </tr>
                ) : (
                  primaryDeliveries.map((o, idx) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono">{o.col7 || '-'}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono font-bold">{o.col6 || o.col1}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-mono">{o.col4 || '-'}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200 font-semibold">{o.col2 || '-'}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200">{o.col8 || '-'}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200">{o.col11 || '-'}</td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono font-bold">
                        {(Number(o.col22) || 0).toLocaleString()}
                      </td>
                      <td className="py-2 px-2.5 border-r border-slate-200 text-center">{o.col23 || '-'}</td>
                      {canViewFinancials && (
                        <>
                          <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono">
                            ฿{(Number(o.col24) || 0).toLocaleString()}
                          </td>
                          <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono font-bold text-slate-900">
                            ฿{(Number(o.col29) || 0).toLocaleString()}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono text-rose-700 font-semibold">
                            ฿{(Number(o.col36) || 0).toLocaleString()}
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {canViewFinancials && primaryDeliveries.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                    <td colSpan={9} className="py-2.5 px-3 text-right">
                      รวมทั้งสิ้น ({primaryDeliveries.length} รายการ):
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono">-</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono text-blue-900">
                      ฿{totals.totalAmount.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono text-rose-700">
                      ฿{totals.totalDebt.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* REPORT 2: VENDOR STATEMENT & AP AGING */}
        {reportType === 'vendor_statement' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">ชื่อร้านค้า / ผู้จำหน่าย (Vendor)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">หมวดหมู่หลัก</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">จำนวนบิลรับของ</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">ยอดสั่งซื้อรวมสุทธิ (บาท)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">ชำระแล้วรวม (บาท)</th>
                  <th className="py-2.5 px-3 text-right">ยอดหนี้คงค้าง (บาท)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {vendorSummaryRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      ไม่พบข้อมูลร้านค้าในช่วงตัวกรองที่เลือก
                    </td>
                  </tr>
                ) : (
                  vendorSummaryRows.map((v, idx) => (
                    <tr key={v.storeName} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 font-bold">{v.storeName}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200">{v.category}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono font-bold">{v.orderCount}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono font-bold">
                        ฿{v.totalPurchases.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono text-emerald-700 font-semibold">
                        ฿{v.totalPaid.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-700 font-bold">
                        ฿{v.totalDebt.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* REPORT 3: PO 3-WAY MATCHING RECONCILIATION */}
        {reportType === 'po_reconciliation' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">เลขที่ PO</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">วันที่เปิด PO</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">โครงการ</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">ร้านค้าคู่ค้า</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">ปริมาณสั่งซื้อ</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">รับของสะสม</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">คงเหลือ</th>
                  <th className="py-2.5 px-3 text-center">% ส่งมอบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredPOs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      ไม่พบใบสั่งซื้อ (PO) ตามตัวกรองที่เลือก
                    </td>
                  </tr>
                ) : (
                  filteredPOs.map((po, idx) => {
                    const rec = reconcilePO(po, orders);
                    return (
                      <tr key={po.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono font-bold">{po.poNumber}</td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono">{po.orderDate}</td>
                        <td className="py-2.5 px-3 border-r border-slate-200 font-semibold">{po.projectId || '-'}</td>
                        <td className="py-2.5 px-3 border-r border-slate-200">{po.storeName}</td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono">
                          {po.totalQty.toLocaleString()} {rec.primaryUnit}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono font-bold text-emerald-700">
                          {rec.deliveredQty.toLocaleString()} {rec.primaryUnit}
                        </td>
                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono font-bold">
                          {rec.remainingQty.toLocaleString()} {rec.primaryUnit}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold">
                          {rec.percentageDelivered.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* REPORT 4: WEIGHBRIDGE DISCREPANCY AUDIT */}
        {reportType === 'weight_audit' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">วันที่</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">เลขที่ DO (6)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">ตั๋วปลายทาง (17)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">ทะเบียนรถ (10)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">ร้านค้า / สินค้า</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">สุทธิต้นทาง (15)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">สุทธิปลายทาง (20)</th>
                  <th className="py-2.5 px-3 text-right">ผลต่างน้ำหนัก (กก.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {primaryDeliveries.filter(o => Number(o.col15) > 0 || Number(o.col20) > 0).length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      ไม่พบบิลที่มีข้อมูลชั่งน้ำหนักในช่วงตัวกรองที่เลือก
                    </td>
                  </tr>
                ) : (
                  primaryDeliveries
                    .filter(o => Number(o.col15) > 0 || Number(o.col20) > 0)
                    .map((o, idx) => {
                      const netOrig = Number(o.col15) || 0;
                      const netDest = Number(o.col20) || 0;
                      const diff = netOrig > 0 && netDest > 0 ? netOrig - netDest : 0;
                      const isAlert = Math.abs(diff) >= (systemSettings.weightDiffAlertKg || 50);
                      return (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                          <td className="py-2 px-3 border-r border-slate-200 font-mono">{o.col7 || '-'}</td>
                          <td className="py-2 px-3 border-r border-slate-200 font-mono font-bold">{o.col6 || o.col1}</td>
                          <td className="py-2 px-3 border-r border-slate-200 font-mono">{o.col17 || 'รอชนตั๋วปลายทาง'}</td>
                          <td className="py-2 px-3 border-r border-slate-200 font-mono">{o.col10 || '-'}</td>
                          <td className="py-2 px-3 border-r border-slate-200">
                            {o.col8} • {o.col11}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200 text-right font-mono font-bold">
                            {netOrig > 0 ? `${netOrig.toLocaleString()} กก.` : '-'}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-200 text-right font-mono font-bold text-teal-800">
                            {netDest > 0 ? `${netDest.toLocaleString()} กก.` : '-'}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${isAlert ? 'text-rose-700' : 'text-slate-800'}`}>
                            {netOrig > 0 && netDest > 0 ? `${diff > 0 ? '-' : '+'}${Math.abs(diff).toLocaleString()} กก.` : '-'}
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* REPORT 5: PROJECT MATERIAL COST SUMMARY */}
        {reportType === 'project_cost' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">#</th>
                  <th className="py-2.5 px-3 border-r border-slate-300">ชื่อโครงการ / หน้างาน (ช่อง 2)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">จำนวน PO</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-center">จำนวนเที่ยวรับของ (DO)</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">วงเงินสั่งซื้อ PO รวม</th>
                  <th className="py-2.5 px-3 border-r border-slate-300 text-right">มูลค่ารับของจริงสะสม</th>
                  <th className="py-2.5 px-3 text-right">ยอดค้างชำระร้านค้า</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {projectSummaryRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      ไม่พบข้อมูลโครงการในช่วงตัวกรองที่เลือก
                    </td>
                  </tr>
                ) : (
                  projectSummaryRows.map((p, idx) => (
                    <tr key={p.projectName} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 font-bold text-slate-900">{p.projectName}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono">{p.poCount}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-center font-mono font-bold">{p.orderCount}</td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono">
                        ฿{p.poBudget.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono font-bold text-blue-900">
                        ฿{p.deliveredAmount.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                        ฿{p.debtAmount.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Official 3-Column Signature Block at Bottom of Printable Report */}
        <div className="pt-10 grid grid-cols-3 gap-8 text-center text-xs">
          <div className="space-y-8">
            <div className="border-b border-dashed border-slate-400 mx-6 pt-6" />
            <div>
              <div className="font-bold text-slate-900">({currentUser.fullName})</div>
              <div className="text-slate-600 mt-0.5">{systemSettings.reportSignatoryPreparedBy}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">วันที่ ____/____/________</div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="border-b border-dashed border-slate-400 mx-6 pt-6" />
            <div>
              <div className="font-bold text-slate-900">(........................................................)</div>
              <div className="text-slate-600 mt-0.5">{systemSettings.reportSignatoryCheckedBy}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">วันที่ ____/____/________</div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="border-b border-dashed border-slate-400 mx-6 pt-6" />
            <div>
              <div className="font-bold text-slate-900">(........................................................)</div>
              <div className="text-slate-600 mt-0.5">{systemSettings.reportSignatoryApprovedBy}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">วันที่ ____/____/________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
