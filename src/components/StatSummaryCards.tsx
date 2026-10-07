import React from 'react';
import { 
  FileText, 
  Scale, 
  Package, 
  CheckCircle2, 
  Calculator, 
  AlertCircle
} from 'lucide-react';
import { OrderRecord } from '../types';
import { isMatchedOriginWeighbridge } from '../utils/poReconciliation';

interface StatSummaryCardsProps {
  orders: OrderRecord[];
  onFilterClick?: (filterType: string) => void;
}

export const StatSummaryCards: React.FC<StatSummaryCardsProps> = ({ orders, onFilterClick }) => {
  let totalWeightTons = 0;
  let totalGoodsAmount = 0;
  let totalFreightAmount = 0;
  let grandTotal = 0;
  let totalUnpaid = 0;
  let totalPaid = 0;
  let weighedDOCount = 0;
  let generalDOCount = 0;
  let weighedDOAmount = 0;
  let generalDOAmount = 0;
  let unpaidCount = 0;
  let paidCount = 0;

  // All destination weighbridge tickets for checking linked weighing status
  const destTickets = orders.filter(o => o.docType === 'dest_weighbridge');

  // Primary DO records shown in the 39-Column Table (strictly excluding standalone dest_weighbridge & tax_invoice rows)
  const primaryDOs = orders.filter(
    o => o.docType !== 'dest_weighbridge' && o.docType !== 'tax_invoice' && !isMatchedOriginWeighbridge(o)
  );

  const uniqueProjects = new Set(primaryDOs.map(r => (r.col2 || '').trim()).filter(Boolean));
  const uniqueStores = new Set(primaryDOs.map(r => (r.col8 || '').trim()).filter(Boolean));

  // Identify stores that already have priced physical delivery orders (DO / Weighbridge)
  const storesWithPricedDeliveries = new Set(
    primaryDOs
      .filter(r => Number(r.col29) > 0 || Number(r.col25) > 0)
      .map(r => (r.storeId || r.col8 || '').trim().toLowerCase())
      .filter(Boolean)
  );

  primaryDOs.forEach((row) => {
    const hasWeighing =
      Number(row.col13) > 0 ||
      Number(row.col15) > 0 ||
      Number(row.col18) > 0 ||
      Number(row.col20) > 0 ||
      Boolean(row.col17) ||
      Boolean(row.matchedDestTicketId) ||
      row.docType === 'weighbridge' ||
      destTickets.some(
        t =>
          t.linkedViaDocNo &&
          ((row.col6 && t.linkedViaDocNo.trim().toLowerCase() === row.col6.trim().toLowerCase()) ||
            (row.col1 && t.linkedViaDocNo.trim().toLowerCase() === row.col1.trim().toLowerCase()))
      );

    const rowTotal = Number(row.col29) || Number(row.col25) || 0;
    if (hasWeighing) {
      weighedDOCount++;
      weighedDOAmount += rowTotal;
    } else {
      generalDOCount++;
      generalDOAmount += rowTotal;
    }

    const netKg = Number(row.col15) || Number(row.col20) || 0;
    totalWeightTons += netKg / 1000;

    totalGoodsAmount += Number(row.col25) || 0;
    totalFreightAmount += Number(row.col28) || 0;
    grandTotal += Number(row.col29) || 0;
    totalPaid += Number(row.col35) || 0;

    const unpaid = Number(row.col36) || 0;
    totalUnpaid += unpaid;
    if (unpaid > 0) {
      unpaidCount++;
    } else if (rowTotal > 0 || Number(row.col35) > 0) {
      paidCount++;
    }
  });

  // Also include financial totals from unlinked Tax Invoices ONLY for stores without priced DOs (prevents double counting)
  orders.forEach((row) => {
    if (row.docType !== 'tax_invoice' || row.linkedViaDocNo) return;
    const storeKey = (row.storeId || row.col8 || '').trim().toLowerCase();
    const hasPricedDO = storeKey && storesWithPricedDeliveries.has(storeKey);
    if (!hasPricedDO) {
      totalGoodsAmount += Number(row.col25) || 0;
      totalFreightAmount += Number(row.col28) || 0;
      grandTotal += Number(row.col29) || 0;
    }
    totalPaid += Number(row.col35) || 0;
    const unpaid = Number(row.col36) || 0;
    totalUnpaid += unpaid;
    if (unpaid > 0) unpaidCount++;
  });

  const formatCurrency = (amount: number) => {
    return '฿' + amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatCompactCurrency = (amount: number) => {
    return '฿' + amount.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const paidPercent = grandTotal > 0 ? Math.min(100, Math.round((totalPaid / grandTotal) * 100)) : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* 1. All DOs (ทั้งหมด 39 คอลัมน์) */}
      <div 
        onClick={() => onFilterClick && onFilterClick('all')}
        className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs hover:border-blue-300 transition cursor-pointer group"
        title="คลิกเพื่อแสดงใบส่งของ (DO) ทั้งหมด 39 คอลัมน์"
      >
        <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
          <span className="font-semibold">ใบส่งของ (DO) ทั้งหมด</span>
          <FileText className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition" />
        </div>
        <div className="text-xl font-bold text-slate-900 tracking-tight tabular-nums">
          {primaryDOs.length.toLocaleString()} <span className="text-xs font-normal text-slate-500">ใบ</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
          {primaryDOs.length > 0
            ? `${uniqueProjects.size} โครงการ • ${uniqueStores.size} ร้านค้า`
            : 'ยังไม่มีเอกสาร DO'}
        </div>
      </div>

      {/* 2. General DOs (DO สินค้าทั่วไป - ไม่ชั่งน้ำหนัก) */}
      <div 
        onClick={() => onFilterClick && onFilterClick('delivery_order')}
        className="bg-white p-3.5 rounded-xl border border-sky-200/80 shadow-2xs hover:border-sky-400 transition cursor-pointer group"
        title="คลิกเพื่อกรองเฉพาะ DO สินค้าทั่วไป (คอนกรีต/เหล็ก/ท่อ/ปูน/อุปกรณ์งานทาง)"
      >
        <div className="flex items-center justify-between text-xs text-sky-900 mb-1">
          <span className="font-semibold">DO สินค้าทั่วไป</span>
          <Package className="w-3.5 h-3.5 text-sky-500 group-hover:text-sky-700 transition" />
        </div>
        <div className="text-xl font-bold text-sky-700 tracking-tight tabular-nums">
          {generalDOCount.toLocaleString()} <span className="text-xs font-normal text-slate-500">ใบ</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
          มูลค่า {formatCompactCurrency(generalDOAmount)}
        </div>
      </div>

      {/* 3. Weighed DOs (DO สินค้าที่มีการชั่งน้ำหนัก) */}
      <div 
        onClick={() => onFilterClick && onFilterClick('weighbridge')}
        className="bg-white p-3.5 rounded-xl border border-emerald-200/80 shadow-2xs hover:border-emerald-400 transition cursor-pointer group"
        title="คลิกเพื่อกรองเฉพาะ DO สินค้าที่มีการชั่งน้ำหนัก (หิน/ดิน/ทราย/แอสฟัลต์)"
      >
        <div className="flex items-center justify-between text-xs text-emerald-900 mb-1">
          <span className="font-semibold">DO สินค้าชั่งน้ำหนัก</span>
          <Scale className="w-3.5 h-3.5 text-emerald-500 group-hover:text-emerald-700 transition" />
        </div>
        <div className="text-xl font-bold text-emerald-700 tracking-tight tabular-nums">
          {weighedDOCount.toLocaleString()} <span className="text-xs font-normal text-slate-500">ใบ ({formatNumber(totalWeightTons, 1)} ตัน)</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
          มูลค่า {formatCompactCurrency(weighedDOAmount)}
        </div>
      </div>

      {/* 4. Grand Total (Goods + Freight Combined) */}
      <div
        onClick={() => onFilterClick && onFilterClick('all')}
        className="bg-white p-3.5 rounded-xl border border-blue-200 bg-blue-50/20 shadow-2xs hover:border-blue-300 transition cursor-pointer"
        title={`ค่าวัสดุ/สินค้า: ${formatCurrency(totalGoodsAmount)} | ค่าขนส่ง: ${formatCurrency(totalFreightAmount)}`}
      >
        <div className="flex items-center justify-between text-xs font-semibold text-blue-900 mb-1">
          <span>ยอดรวมทั้งสิ้น</span>
          <Calculator className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <div className="text-xl font-bold text-blue-700 tracking-tight tabular-nums truncate">
          {formatCurrency(grandTotal)}
        </div>
        <div className="text-[11px] text-blue-700/80 mt-0.5 truncate">
          วัสดุ {formatCompactCurrency(totalGoodsAmount)} • ขนส่ง {formatCompactCurrency(totalFreightAmount)}
        </div>
      </div>

      {/* 5. Total Paid */}
      <div
        onClick={() => onFilterClick && onFilterClick('paid')}
        className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs hover:border-emerald-300 transition cursor-pointer group"
        title="คลิกเพื่อกรองดูเฉพาะบิลที่ชำระเงินครบถ้วนแล้ว"
      >
        <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
          <span className="font-semibold">ชำระเงินแล้วรวม</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 group-hover:text-emerald-600 transition" />
        </div>
        <div className="text-xl font-bold text-emerald-700 tracking-tight tabular-nums truncate">
          {formatCurrency(totalPaid)}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
          ชำระครบ {paidCount} บิล ({paidPercent}%)
        </div>
      </div>

      {/* 6. Total Unpaid Debt */}
      <div 
        onClick={() => onFilterClick && onFilterClick('unpaid')}
        className={`p-3.5 rounded-xl border shadow-2xs transition cursor-pointer group ${
          totalUnpaid > 0 
            ? 'bg-rose-50/40 border-rose-200 hover:border-rose-300' 
            : 'bg-emerald-50/30 border-emerald-200'
        }`}
        title="คลิกเพื่อกรองดูเฉพาะบิลที่มียอดค้างชำระ"
      >
        <div className="flex items-center justify-between text-xs font-medium mb-1 text-slate-700">
          <span className={totalUnpaid > 0 ? 'text-rose-700 font-semibold' : 'text-slate-600'}>
            ยอดคงค้างชำระ
          </span>
          <AlertCircle className={`w-3.5 h-3.5 ${totalUnpaid > 0 ? 'text-rose-500' : 'text-emerald-500'}`} />
        </div>
        <div className={`text-xl font-bold tracking-tight tabular-nums truncate ${totalUnpaid > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
          {formatCurrency(totalUnpaid)}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
          {totalUnpaid > 0 ? `${unpaidCount} บิลรอจ่าย` : 'ชำระครบถ้วน'}
        </div>
      </div>
    </div>
  );
};
