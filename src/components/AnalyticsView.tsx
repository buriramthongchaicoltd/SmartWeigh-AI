import React, { useMemo } from 'react';
import { 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  AlertTriangle, 
  Weight, 
  CreditCard, 
  Store, 
  Boxes,
  Truck
} from 'lucide-react';
import { OrderRecord, StoreMerchant } from '../types';

interface AnalyticsViewProps {
  orders: OrderRecord[];
  stores: StoreMerchant[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ orders, stores }) => {
  // Effective orders for spend calculation (exclude dest_weighbridge and duplicate tax_invoice where store already has priced DOs)
  const effectivePurchaseOrders = useMemo(() => {
    const storesWithPricedDeliveries = new Set(
      orders
        .filter(r => r.docType !== 'tax_invoice' && r.docType !== 'dest_weighbridge' && (Number(r.col29) > 0 || Number(r.col25) > 0))
        .map(r => (r.storeId || r.col8 || '').trim().toLowerCase())
        .filter(Boolean)
    );
    return orders.filter(o => {
      if (o.docType === 'dest_weighbridge') return false;
      if (o.docType === 'tax_invoice' && o.linkedViaDocNo) return false;
      const storeKey = (o.storeId || o.col8 || '').trim().toLowerCase();
      if (o.docType === 'tax_invoice' && storeKey && storesWithPricedDeliveries.has(storeKey)) {
        return false;
      }
      return true;
    });
  }, [orders]);

  // 1. Spend by Store
  const storeSpendList = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    effectivePurchaseOrders.forEach(o => {
      const name = o.col8 || 'ไม่ระบุร้าน';
      const amt = Number(o.col29) || 0;
      const cur = map.get(name) || { total: 0, count: 0 };
      map.set(name, { total: cur.total + amt, count: cur.count + 1 });
    });

    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [effectivePurchaseOrders]);

  // 2. Spend by Category
  const categorySpendList = useMemo(() => {
    const map = new Map<string, number>();
    effectivePurchaseOrders.forEach(o => {
      const cat = o.col3 || 'ทั่วไป';
      const amt = Number(o.col29) || 0;
      map.set(cat, (map.get(cat) || 0) + amt);
    });

    const list = Array.from(map.entries()).map(([category, amount]) => ({ category, amount }));
    list.sort((a, b) => b.amount - a.amount);
    return list;
  }, [effectivePurchaseOrders]);

  // 3. Payment Method Breakdown
  const paymentStats = useMemo(() => {
    let creditTotal = 0;
    let transferTotal = 0;
    let cashTotal = 0;
    let otherTotal = 0;

    effectivePurchaseOrders.forEach(o => {
      const amt = Number(o.col29) || 0;
      const method = (o.col30 || '').toLowerCase();
      if (method.includes('เครดิต')) {
        creditTotal += amt;
      } else if (method.includes('โอน')) {
        transferTotal += amt;
      } else if (method.includes('เงินสด')) {
        cashTotal += amt;
      } else {
        otherTotal += amt;
      }
    });

    return { creditTotal, transferTotal, cashTotal, otherTotal };
  }, [effectivePurchaseOrders]);

  // 4. Weight Diff / Discrepancy analysis
  const weightDiffOrders = useMemo(() => {
    return orders
      .filter(o => o.docType !== 'dest_weighbridge' && Number(o.col21) > 0)
      .sort((a, b) => Number(b.col21) - Number(a.col21));
  }, [orders]);

  const maxStoreSpend = storeSpendList[0]?.total || 1;
  const totalSpendAll = effectivePurchaseOrders.reduce((sum, o) => sum + (Number(o.col29) || 0), 0);

  const fmtCurrency = (num: number) => {
    return '฿' + num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-4 text-xs">
      
      {/* Top 2 Big Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* Top Vendors by Purchase Volume */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Store className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">ยอดสั่งซื้อแยกตามร้านค้า / คู่ค้า</h3>
                <p className="text-[11px] text-slate-500">ลำดับร้านค้าที่มียอดสั่งซื้อสูงสุด</p>
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              รวม {fmtCurrency(totalSpendAll)}
            </span>
          </div>

          <div className="space-y-3 pt-2">
            {storeSpendList.length === 0 ? (
              <p className="text-slate-400 py-6 text-center">ไม่มีข้อมูล</p>
            ) : (
              storeSpendList.slice(0, 6).map((store, idx) => {
                const percent = Math.round((store.total / (totalSpendAll || 1)) * 100);
                const barWidth = Math.round((store.total / maxStoreSpend) * 100);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium text-slate-800 truncate max-w-[280px]">
                        {idx + 1}. {store.name} ({store.count} บิล)
                      </span>
                      <span className="font-bold text-indigo-700">{fmtCurrency(store.total)} <span className="text-[10px] text-slate-400">({percent}%)</span></span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Spend by Category & Payment method */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">สัดส่วนตามหมวดหมู่งาน & เงื่อนไขชำระ</h3>
              <p className="text-[11px] text-slate-500">การกระจายตัวของค่าใช้จ่ายในแต่ละประเภท</p>
            </div>
          </div>

          {/* Category Bars */}
          <div className="space-y-2.5">
            <div className="font-semibold text-slate-700 text-xs">หมวดหมู่งาน:</div>
            {categorySpendList.map((cat, idx) => {
              const pct = Math.round((cat.amount / (totalSpendAll || 1)) * 100);
              return (
                <div key={idx} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="font-medium text-slate-800">{cat.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-purple-800">{fmtCurrency(cat.amount)}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-100 text-purple-700 font-bold">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Payment Method Distribution */}
          <div className="pt-2 border-t border-slate-100">
            <div className="font-semibold text-slate-700 text-xs mb-2">รูปแบบการชำระเงิน:</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-[10px] text-blue-600 font-medium">เครดิต (15-60 วัน)</div>
                <div className="font-bold text-blue-900 text-xs mt-0.5">{fmtCurrency(paymentStats.creditTotal)}</div>
              </div>
              <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="text-[10px] text-emerald-600 font-medium">โอนเงินธนาคาร</div>
                <div className="font-bold text-emerald-900 text-xs mt-0.5">{fmtCurrency(paymentStats.transferTotal)}</div>
              </div>
              <div className="p-2 bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-[10px] text-amber-600 font-medium">เงินสดหน้างาน</div>
                <div className="font-bold text-amber-900 text-xs mt-0.5">{fmtCurrency(paymentStats.cashTotal)}</div>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Discrepancy & Weight Difference Monitoring */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">การตรวจสอบผลต่างน้ำหนักขนส่ง (Weight Loss Analysis)</h3>
              <p className="text-[11px] text-slate-500">
                เปรียบเทียบน้ำหนักสุทธิต้นทาง (คอลัมน์ 15) กับน้ำหนักสุทธิปลายทาง (คอลัมน์ 20)
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            พบบิลที่มีผลต่าง {weightDiffOrders.length} รายการ
          </span>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-2.5">เลข TR</th>
                <th className="p-2.5">โครงการ</th>
                <th className="p-2.5">ร้านค้า / ผู้จำหน่าย</th>
                <th className="p-2.5">ทะเบียนรถ</th>
                <th className="p-2.5">รายการสินค้า</th>
                <th className="p-2.5 text-right">สุทธิต้นทาง (กก.)</th>
                <th className="p-2.5 text-right">สุทธิปลายทาง (กก.)</th>
                <th className="p-2.5 text-right text-rose-700 bg-rose-50/50 font-bold">ผลต่างหายไป (กก.)</th>
                <th className="p-2.5">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {weightDiffOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400">
                    ไม่พบรายการบิลที่มีน้ำหนักตกหล่นระหว่างขนส่ง (ทุกคันน้ำหนักตรง 100%)
                  </td>
                </tr>
              ) : (
                weightDiffOrders.map(ord => {
                  const diff = Number(ord.col21) || 0;
                  const originNet = Number(ord.col15) || 1;
                  const pctLoss = ((diff / originNet) * 100).toFixed(2);
                  const isSevere = Number(pctLoss) > 0.5;

                  return (
                    <tr key={ord.id} className="hover:bg-slate-50 transition">
                      <td className="p-2.5 font-bold text-blue-600 font-mono">{ord.col1}</td>
                      <td className="p-2.5 text-slate-800">{ord.col2}</td>
                      <td className="p-2.5 text-slate-800 font-medium">{ord.col8}</td>
                      <td className="p-2.5 text-slate-700 font-mono">{ord.col10}</td>
                      <td className="p-2.5 text-slate-900 font-semibold">{ord.col11}</td>
                      <td className="p-2.5 text-right font-mono">{Number(ord.col15).toLocaleString()}</td>
                      <td className="p-2.5 text-right font-mono">{Number(ord.col20).toLocaleString()}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-rose-600 bg-rose-50/40">
                        -{diff.toLocaleString()} กก. ({pctLoss}%)
                      </td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isSevere ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}>
                          {isSevere ? 'หายเกินเกณฑ์' : 'อยู่ในเกณฑ์ปกติ'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};
