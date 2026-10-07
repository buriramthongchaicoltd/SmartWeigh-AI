import React, { useState, useMemo } from 'react';
import { 
  X, 
  Store, 
  Phone, 
  MapPin, 
  Building, 
  CreditCard, 
  Calendar, 
  FileSpreadsheet, 
  FileText, 
  Eye, 
  Plus, 
  TrendingUp,
  AlertCircle,
  Package,
  Truck,
  Edit3,
  Trash2
} from 'lucide-react';
import { StoreMerchant, OrderRecord } from '../types';
import { exportStoreStatement } from '../utils/excelExport';
import { isMatchedOriginWeighbridge } from '../utils/poReconciliation';

interface StoreDetailModalProps {
  store: StoreMerchant | null;
  orders: OrderRecord[];
  onClose: () => void;
  onInspectOrder: (order: OrderRecord) => void;
  onAddNewOrderForStore: (store: StoreMerchant) => void;
  onOpenCreatePOForStore?: (store: StoreMerchant) => void;
  onEditStore: (store: StoreMerchant) => void;
  onDeleteStore?: (store: StoreMerchant) => void;
}

export const StoreDetailModal: React.FC<StoreDetailModalProps> = ({
  store,
  orders,
  onClose,
  onInspectOrder,
  onAddNewOrderForStore,
  onOpenCreatePOForStore,
  onEditStore,
  onDeleteStore
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!store) return null;

  // Filter orders related to this store (excluding unmerged dest_weighbridge)
  const storeOrders = useMemo(() => {
    return orders.filter(o => 
      (o.storeId === store.id || 
      (o.col8 && o.col8.trim().toLowerCase() === store.name.trim().toLowerCase())) &&
      o.docType !== 'dest_weighbridge'
    );
  }, [orders, store]);

  // Recalculate dynamic totals from actual orders
  const stats = useMemo(() => {
    const financialOrders = storeOrders.filter(o => !isMatchedOriginWeighbridge(o));
    const hasPricedDeliveries = financialOrders.some(
      o => o.docType !== 'tax_invoice' && (Number(o.col29) > 0 || Number(o.col25) > 0)
    );
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    let totalNetWeightTons = 0;
    let validOrderCount = 0;
    const vehiclePlates = new Set<string>();
    const projectNames = new Set<string>();

    financialOrders.forEach(o => {
      if (o.docType === 'tax_invoice' && o.linkedViaDocNo) return;
      if (o.docType === 'tax_invoice' && hasPricedDeliveries) {
        totalPaid += Number(o.col35) || 0;
        totalDebt += Number(o.col36) || 0;
      } else {
        validOrderCount++;
        totalPurchases += Number(o.col29) || 0;
        totalPaid += Number(o.col35) || 0;
        totalDebt += Number(o.col36) || 0;
        totalNetWeightTons += (Number(o.col15) || 0) / 1000;
      }
      if (o.col10) vehiclePlates.add(o.col10);
      if (o.col2) projectNames.add(o.col2);
    });

    return {
      orderCount: validOrderCount,
      totalPurchases,
      totalPaid,
      totalDebt,
      totalNetWeightTons,
      vehiclePlates: Array.from(vehiclePlates),
      projects: Array.from(projectNames)
    };
  }, [storeOrders]);

  const filteredStoreOrders = useMemo(() => {
    if (!searchTerm.trim()) return storeOrders;
    const q = searchTerm.toLowerCase();
    return storeOrders.filter(o => 
      o.col1.toLowerCase().includes(q) ||
      o.col2.toLowerCase().includes(q) ||
      o.col6.toLowerCase().includes(q) ||
      o.col10.toLowerCase().includes(q) ||
      o.col11.toLowerCase().includes(q)
    );
  }, [storeOrders, searchTerm]);

  const fmtCurrency = (val: number) => {
    return '฿' + val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        
        {/* Modal Top Header */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 flex items-center justify-center text-xl shrink-0 mt-0.5">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-white">{store.name}</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  {store.category}
                </span>
                {store.creditTerms && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] bg-slate-800 text-amber-300 border border-slate-700">
                    {store.creditTerms}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
                {store.taxId && <span>เลขผู้เสียภาษี: <span className="font-mono text-slate-300">{store.taxId}</span></span>}
                {store.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" /> {store.phone}</span>}
                {store.contactPerson && <span>ผู้ติดต่อ: {store.contactPerson}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => onEditStore(store)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>แก้ไขข้อมูลร้านค้า</span>
            </button>
            {onDeleteStore && (
              confirmDelete ? (
                <div className="flex items-center gap-1 bg-rose-950/90 border border-rose-500/50 px-2 py-1 rounded-lg">
                  <span className="text-[11px] text-rose-200 mr-1">ยืนยันลบ?</span>
                  <button
                    onClick={() => {
                      onDeleteStore(store);
                      setConfirmDelete(false);
                      onClose();
                    }}
                    className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-bold cursor-pointer"
                  >
                    ยืนยันลบ
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-1.5 py-0.5 text-slate-300 hover:text-white text-[11px] cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-200 rounded-lg text-xs font-medium transition cursor-pointer border border-rose-800/60 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ลบร้านค้า</span>
                </button>
              )
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-lg w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Financial KPI Summary Cards for this Store */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-slate-500 mb-1 flex items-center justify-between">
              <span>คำสั่งซื้อทั้งหมด</span>
              <FileText className="w-3.5 h-3.5 text-blue-500" />
            </div>
            <div className="text-lg font-bold text-slate-900">{stats.orderCount} <span className="text-xs font-normal text-slate-400">รายการ</span></div>
            <div className="text-[11px] text-slate-400 mt-0.5">น้ำหนักรวม {stats.totalNetWeightTons.toFixed(2)} ตัน</div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-slate-500 mb-1 flex items-center justify-between">
              <span>ยอดสั่งซื้อสะสม</span>
              <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <div className="text-lg font-bold text-indigo-700">{fmtCurrency(stats.totalPurchases)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">รวมค่าสินค้า & ขนส่ง</div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-slate-500 mb-1 flex items-center justify-between">
              <span>ชำระเงินแล้ว</span>
              <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-lg font-bold text-emerald-700">{fmtCurrency(stats.totalPaid)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {stats.totalPurchases > 0 ? `${((stats.totalPaid / stats.totalPurchases) * 100).toFixed(0)}% ของยอดรวม` : '-'}
            </div>
          </div>

          <div className={`p-3 rounded-xl border ${
            stats.totalDebt > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-emerald-50/30 border-emerald-200'
          }`}>
            <div className="text-slate-500 mb-1 flex items-center justify-between">
              <span className={stats.totalDebt > 0 ? 'text-rose-700 font-semibold' : 'text-slate-600'}>
                ยอดคงค้างชำระ
              </span>
              <AlertCircle className={`w-3.5 h-3.5 ${stats.totalDebt > 0 ? 'text-rose-600' : 'text-emerald-500'}`} />
            </div>
            <div className={`text-lg font-bold ${stats.totalDebt > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {fmtCurrency(stats.totalDebt)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {stats.totalDebt > 0 ? 'รอชำระตามกำหนด' : 'ไม่มีหนี้คงค้าง'}
            </div>
          </div>
        </div>

        {/* Store Detail Content & Order History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* Metadata info row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <span className="font-semibold text-slate-600 block mb-0.5">ที่อยู่สถานประกอบการ:</span>
              <p className="text-slate-800 flex items-start gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>{store.address || 'ไม่ระบุที่อยู่'}</span>
              </p>
            </div>
            <div>
              <span className="font-semibold text-slate-600 block mb-0.5">บัญชีธนาคาร / การชำระ:</span>
              <p className="text-slate-800 font-mono">{store.bankAccount || 'ตามใบวางบิล'}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">เงื่อนไข: {store.creditTerms || 'เงินสด/โอนเงิน'}</p>
            </div>
            <div>
              <span className="font-semibold text-slate-600 block mb-0.5">สินค้าหลักที่จัดหา:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {store.primaryGoods && store.primaryGoods.length > 0 ? (
                  store.primaryGoods.map((g, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-white border border-slate-300 text-[11px] text-slate-700">
                      {g}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400">วัสดุก่อสร้างทั่วไป</span>
                )}
              </div>
            </div>
          </div>

          {/* Section: Automatic Order History */}
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span>ประวัติคำสั่งซื้ออัตโนมัติ (Order History)</span>
                  <span className="text-xs font-normal text-slate-500">
                    ({filteredStoreOrders.length} รายการ)
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  รายการสั่งซื้อและตั๋วส่งของทั้งหมดที่บันทึกสำหรับ {store.name}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportStoreStatement(store, storeOrders)}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>ส่งออก Statement Excel</span>
                </button>
                <button
                  onClick={() => {
                    if (onOpenCreatePOForStore) {
                      onOpenCreatePOForStore(store);
                    } else {
                      onAddNewOrderForStore(store);
                    }
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title="สำหรับกรณีต้องการคีย์บันทึกข้อมูล PO ด้วยตนเอง"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-500" />
                  <span>บันทึก PO ร้านนี้</span>
                </button>
              </div>
            </div>

            {/* Filter orders search */}
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ค้นหาเลข TR, DO, โครงการ, ทะเบียน, สินค้า ในประวัติร้านนี้..."
                className="w-full pl-3 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none"
              />
            </div>

            {/* Order History Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5">เลข TR</th>
                      <th className="p-2.5">วันที่</th>
                      <th className="p-2.5">โครงการ</th>
                      <th className="p-2.5">DO / ตั๋ว</th>
                      <th className="p-2.5">ทะเบียนรถ</th>
                      <th className="p-2.5">รายการสินค้า</th>
                      <th className="p-2.5 text-right">ปริมาณ</th>
                      <th className="p-2.5 text-right">ค่าสินค้า</th>
                      <th className="p-2.5 text-right">ค่าขนส่ง</th>
                      <th className="p-2.5 text-right font-bold text-blue-900 bg-blue-50">รวมทั้งสิ้น</th>
                      <th className="p-2.5 text-right font-semibold text-rose-700">คงค้าง</th>
                      <th className="p-2.5 text-center">ดูตั๋ว</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredStoreOrders.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="p-8 text-center text-slate-400">
                          ยังไม่มีประวัติคำสั่งซื้อสำหรับร้านค้านี้
                        </td>
                      </tr>
                    ) : (
                      filteredStoreOrders.map((ord) => {
                        const isUnpaid = Number(ord.col36) > 0;
                        return (
                          <tr key={ord.id} className="hover:bg-slate-50 transition">
                            <td className="p-2.5 font-bold text-blue-600 font-mono">{ord.col1}</td>
                            <td className="p-2.5 text-slate-600 font-mono">{ord.col7}</td>
                            <td className="p-2.5 text-slate-800 font-medium truncate max-w-[150px]" title={ord.col2}>{ord.col2}</td>
                            <td className="p-2.5 text-slate-600 font-mono">{ord.col6}</td>
                            <td className="p-2.5 text-slate-700 font-mono bg-slate-50">{ord.col10 || '-'}</td>
                            <td className="p-2.5 font-medium text-slate-900 truncate max-w-[160px]" title={ord.col11}>{ord.col11}</td>
                            <td className="p-2.5 text-right font-mono font-semibold">{ord.col22} {ord.col23}</td>
                            <td className="p-2.5 text-right font-mono text-purple-700">{fmtCurrency(Number(ord.col25) || 0)}</td>
                            <td className="p-2.5 text-right font-mono text-slate-700">{fmtCurrency(Number(ord.col28) || 0)}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-blue-700 bg-blue-50/50">{fmtCurrency(Number(ord.col29) || 0)}</td>
                            <td className={`p-2.5 text-right font-mono font-bold ${isUnpaid ? 'text-rose-600' : 'text-slate-400'}`}>
                              {fmtCurrency(Number(ord.col36) || 0)}
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                onClick={() => {
                                  onClose();
                                  onInspectOrder(ord);
                                }}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition cursor-pointer"
                                title="ดูบิลตั๋วชั่ง / สเปก"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
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

        </div>

        {/* Modal Bottom Actions */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
          <div className="text-slate-500">
            ทะเบียนคู่ค้า ID: <span className="font-mono text-slate-700">{store.id}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-medium transition cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>
    </div>
  );
};
