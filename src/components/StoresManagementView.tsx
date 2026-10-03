import React, { useState, useMemo } from 'react';
import { 
  Store, 
  Search, 
  Plus, 
  Phone, 
  MapPin, 
  ChevronRight, 
  FileText, 
  CreditCard, 
  AlertCircle,
  TrendingUp,
  Building2,
  Calendar,
  FolderKanban,
  Edit3,
  Trash2,
  X,
  Save,
  UserCheck,
  LayoutGrid,
  Table2,
  RefreshCw
} from 'lucide-react';
import { StoreMerchant, OrderRecord, ProjectRecord, PurchaseOrder } from '../types';

interface StoresManagementViewProps {
  stores: StoreMerchant[];
  orders: OrderRecord[];
  pos?: PurchaseOrder[];
  onSelectStore: (store: StoreMerchant) => void;
  onAddNewStore: () => void;
  onEditStore: (store: StoreMerchant) => void;
  onDeleteStore: (store: StoreMerchant) => void;
  onAddNewOrderForStore: (store: StoreMerchant) => void;
  onSyncStoresFromBills?: () => void;
}

export const StoresManagementView: React.FC<StoresManagementViewProps> = ({
  stores,
  orders,
  pos = [],
  onSelectStore,
  onAddNewStore,
  onEditStore,
  onDeleteStore,
  onAddNewOrderForStore,
  onSyncStoresFromBills
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [confirmDeleteStoreId, setConfirmDeleteStoreId] = useState<string | null>(null);

  // Count any unlinked store names in orders/POs not currently in `stores`
  const unlinkedStoreNamesCount = useMemo(() => {
    const existingSet = new Set(stores.map(s => s.name.trim().toLowerCase()));
    const missing = new Set<string>();
    orders.forEach(o => {
      const name = (o.col8 || '').trim();
      if (name && !existingSet.has(name.toLowerCase())) missing.add(name.toLowerCase());
    });
    pos.forEach(p => {
      const name = (p.storeName || '').trim();
      if (name && !existingSet.has(name.toLowerCase())) missing.add(name.toLowerCase());
    });
    return missing.size;
  }, [stores, orders, pos]);

  // Dynamically augment store metrics from real-time order records
  const augmentedStores = useMemo(() => {
    return stores.map(store => {
      const storeOrders = orders.filter(
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
        if (o.docType === 'tax_invoice' && o.linkedViaDocNo) return;
        if (o.docType === 'tax_invoice' && hasPricedDeliveries) {
          totalPaid += Number(o.col35) || 0;
          totalDebt += Number(o.col36) || 0;
        } else {
          validOrderCount++;
          totalPurchases += Number(o.col29) || 0;
          totalPaid += Number(o.col35) || 0;
          totalDebt += Number(o.col36) || 0;
        }
        if (o.col7 && o.col7 > lastDate) {
          lastDate = o.col7;
        }
      });

      return {
        ...store,
        totalOrders: storeOrders.length > 0 ? validOrderCount : store.totalOrders,
        totalPurchases: storeOrders.length > 0 ? totalPurchases : store.totalPurchases,
        totalPaid: storeOrders.length > 0 ? totalPaid : store.totalPaid,
        totalDebt: storeOrders.length > 0 ? totalDebt : store.totalDebt,
        lastOrderDate: lastDate
      };
    });
  }, [stores, orders]);

  // Overall metrics across all stores
  const overallMetrics = useMemo(() => {
    let grandPurchases = 0;
    let grandDebt = 0;
    let grandPaid = 0;
    let grandOrders = 0;

    augmentedStores.forEach(s => {
      grandPurchases += s.totalPurchases;
      grandDebt += s.totalDebt;
      grandPaid += s.totalPaid;
      grandOrders += s.totalOrders;
    });

    return {
      storeCount: augmentedStores.length,
      grandPurchases,
      grandDebt,
      grandPaid,
      grandOrders
    };
  }, [augmentedStores]);

  // Filtered store list
  const filteredStores = useMemo(() => {
    return augmentedStores.filter(s => {
      if (selectedCategory && s.category !== selectedCategory) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const str = `${s.name} ${s.category} ${s.taxId || ''} ${s.phone || ''} ${s.contactPerson || ''} ${s.address || ''}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });
  }, [augmentedStores, searchTerm, selectedCategory]);

  const categories = useMemo(() => {
    return Array.from(new Set(stores.map(s => s.category).filter(Boolean)));
  }, [stores]);

  const fmtCurrency = (val: number) => {
    return '฿' + val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-4">
      
      {/* Top Banner KPI for Stores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">ร้านค้า & คู่ค้าทั้งหมด</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{overallMetrics.storeCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">ในทะเบียนระบบ</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">ยอดสั่งซื้อสะสมรวม</div>
            <div className="text-2xl font-bold text-indigo-700 mt-1">{fmtCurrency(overallMetrics.grandPurchases)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{overallMetrics.grandOrders} คำสั่งซื้อ</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">ชำระเงินให้ร้านค้าแล้ว</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{fmtCurrency(overallMetrics.grandPaid)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {overallMetrics.grandPurchases > 0 ? `${((overallMetrics.grandPaid / overallMetrics.grandPurchases) * 100).toFixed(0)}% ของยอดรวม` : '-'}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CreditCard className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 bg-rose-50/20 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-rose-700 font-medium">ยอดหนี้คงค้างร้านค้า</div>
            <div className="text-2xl font-bold text-rose-700 mt-1">{fmtCurrency(overallMetrics.grandDebt)}</div>
            <div className="text-[11px] text-rose-500 mt-0.5">รอครบกำหนดชำระ</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Control Bar: Search & Category filter & View Toggle & Add New Store */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาชื่อร้านค้า, หมวดหมู่, เลขผู้เสียภาษี, เบอร์โทร..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700"
          >
            <option value="">ทุกหมวดหมู่ ({categories.length})</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {unlinkedStoreNamesCount > 0 && onSyncStoresFromBills && (
            <button
              type="button"
              onClick={onSyncStoresFromBills}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="ดึงรายชื่อร้านค้าที่อยู่ในบิล/PO แต่ยังไม่อยู่ในทะเบียน"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>ดึงชื่อร้านจากบิล (+{unlinkedStoreNamesCount})</span>
            </button>
          )}

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>การ์ด</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>ตาราง</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onAddNewStore}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มร้านค้า / คู่ค้าใหม่</span>
          </button>
        </div>
      </div>

      {/* Store List: Cards or Table View */}
      {filteredStores.length === 0 ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-400">
          <Store className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">ไม่พบข้อมูลร้านค้าในทะเบียน</p>
          <p className="text-xs text-slate-400 mt-1">
            กดปุ่ม &quot;เพิ่มร้านค้า / คู่ค้าใหม่&quot; ด้านบนเพื่อเพิ่มร้านค้า หรือสแกนบิลเพื่อให้ระบบบันทึกร้านค้าอัตโนมัติ
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">ชื่อร้านค้า / บริษัทผู้จำหน่าย</th>
                  <th className="p-3">หมวดหมู่</th>
                  <th className="p-3">เลขผู้เสียภาษี / เบอร์โทร</th>
                  <th className="p-3">เงื่อนไขชำระ</th>
                  <th className="p-3 text-center">จำนวนบิล</th>
                  <th className="p-3 text-right">ยอดสั่งซื้อรวม</th>
                  <th className="p-3 text-right">ชำระแล้ว</th>
                  <th className="p-3 text-right">หนี้คงค้าง</th>
                  <th className="p-3 text-center">จัดการ (เพิ่มบิล / แก้ไข / ลบ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredStores.map((store, idx) => {
                  const hasDebt = store.totalDebt > 0;
                  return (
                    <tr key={store.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-3 font-mono text-slate-400">{idx + 1}</td>
                      <td className="p-3">
                        <div
                          onClick={() => onSelectStore(store)}
                          className="font-bold text-slate-900 hover:text-indigo-600 cursor-pointer"
                        >
                          {store.name}
                        </div>
                        {store.address && (
                          <div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={store.address}>
                            {store.address}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {store.category}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">
                        {store.taxId && <div className="font-mono text-[11px]">Tax: {store.taxId}</div>}
                        {store.phone && <div>โทร: {store.phone} {store.contactPerson ? `(${store.contactPerson})` : ''}</div>}
                        {!store.taxId && !store.phone && <span className="text-slate-400">-</span>}
                      </td>
                      <td className="p-3 text-slate-700">{store.creditTerms || '-'}</td>
                      <td className="p-3 text-center font-bold text-slate-800">{store.totalOrders}</td>
                      <td className="p-3 text-right font-mono font-bold text-indigo-700">{fmtCurrency(store.totalPurchases)}</td>
                      <td className="p-3 text-right font-mono text-emerald-700">{fmtCurrency(store.totalPaid)}</td>
                      <td className={`p-3 text-right font-mono font-bold ${hasDebt ? 'text-rose-600' : 'text-slate-400'}`}>
                        {fmtCurrency(store.totalDebt)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectStore(store)}
                            className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md font-semibold text-[11px] cursor-pointer"
                          >
                            ประวัติ
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditStore(store)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-md font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>แก้ไข</span>
                          </button>
                          {confirmDeleteStoreId === store.id ? (
                            <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-md">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteStore(store);
                                  setConfirmDeleteStoreId(null);
                                }}
                                className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer"
                              >
                                ยืนยันลบ
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStoreId(null)}
                                className="px-1 py-0.5 text-slate-600 hover:text-slate-900 text-[10px] font-semibold cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteStoreId(store.id)}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-md font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>ลบ</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStores.map(store => {
            const hasDebt = store.totalDebt > 0;
            return (
              <div 
                key={store.id} 
                className="bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md hover:border-indigo-300 transition flex flex-col justify-between overflow-hidden"
              >
                {/* Card Top */}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {store.category}
                        </span>
                        {store.creditTerms && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] bg-slate-100 text-slate-700">
                            {store.creditTerms}
                          </span>
                        )}
                      </div>
                      <h3
                        className="font-bold text-slate-900 text-sm hover:text-indigo-600 transition cursor-pointer"
                        onClick={() => onSelectStore(store)}
                      >
                        {store.name}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onEditStore(store)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:text-indigo-700 bg-slate-100 hover:bg-indigo-50 border border-slate-200 rounded-lg transition flex items-center gap-1 cursor-pointer"
                        title="แก้ไขข้อมูลร้านค้า"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>แก้ไข</span>
                      </button>

                      {confirmDeleteStoreId === store.id ? (
                        <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteStore(store);
                              setConfirmDeleteStoreId(null);
                            }}
                            className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer"
                          >
                            ยืนยันลบ
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteStoreId(null)}
                            className="px-1 py-0.5 text-slate-600 hover:text-slate-900 text-[10px] font-semibold cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteStoreId(store.id)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition flex items-center gap-1 cursor-pointer"
                          title="ลบร้านค้าออกจากทะเบียน"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>ลบ</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Info points */}
                  <div className="space-y-1 text-xs text-slate-500">
                    {store.taxId && (
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span className="text-slate-400">Tax ID:</span>
                        <span>{store.taxId}</span>
                      </div>
                    )}
                    {store.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{store.phone}</span>
                        {store.contactPerson && <span className="text-slate-400">({store.contactPerson})</span>}
                      </div>
                    )}
                    {store.address && (
                      <div className="flex items-start gap-1.5 truncate">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                        <span className="truncate">{store.address}</span>
                      </div>
                    )}
                  </div>

                  {/* Financial Stats Bar inside Card */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg text-center border border-slate-100 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">คำสั่งซื้อ</div>
                      <div className="font-bold text-slate-800">{store.totalOrders} รายการ</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">ยอดซื้อรวม</div>
                      <div className="font-bold text-indigo-700 truncate" title={fmtCurrency(store.totalPurchases)}>
                        {fmtCurrency(store.totalPurchases)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">หนี้คงค้าง</div>
                      <div className={`font-bold truncate ${hasDebt ? 'text-rose-600' : 'text-emerald-600'}`} title={fmtCurrency(store.totalDebt)}>
                        {fmtCurrency(store.totalDebt)}
                      </div>
                    </div>
                  </div>

                  {/* Primary Goods Tags */}
                  {store.primaryGoods && store.primaryGoods.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {store.primaryGoods.slice(0, 3).map((good, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px]">
                          {good}
                        </span>
                      ))}
                      {store.primaryGoods.length > 3 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-400 text-[10px]">
                          +{store.primaryGoods.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Bottom Actions */}
                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>สั่งล่าสุด: {store.lastOrderDate || '-'}</span>
                  </span>

                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => onAddNewOrderForStore(store)}
                      className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-md font-medium transition cursor-pointer text-xs flex items-center gap-1"
                      title="เพิ่มตั๋วชั่งหรือใบส่งของสำหรับร้านนี้"
                    >
                      <Plus className="w-3 h-3" />
                      <span>ลงตั๋ว/บิล</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectStore(store)}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-semibold transition cursor-pointer text-xs flex items-center gap-1 shadow-xs"
                    >
                      <span>ดูประวัติ</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};

// ==================== ทะเบียนโครงการ (PROJECTS MANAGEMENT VIEW) ====================
interface ProjectsManagementViewProps {
  projects: ProjectRecord[];
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  triggerCreateCounter?: number;
  onSaveProject: (project: ProjectRecord, oldName?: string) => void;
  onDeleteProject: (id: string, projectName?: string) => void;
  onFilterOrdersByProject: (projectName: string) => void;
  onCreateOrderForProject: (projectName: string, location?: string, manager?: string) => void;
  onSyncProjectsFromBills?: () => void;
}

export const ProjectsManagementView: React.FC<ProjectsManagementViewProps> = ({
  projects,
  orders,
  pos,
  triggerCreateCounter = 0,
  onSaveProject,
  onDeleteProject,
  onFilterOrdersByProject,
  onCreateOrderForProject,
  onSyncProjectsFromBills
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'on_hold'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(null);
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string | null>(null);
  const [confirmDeleteInModal, setConfirmDeleteInModal] = useState(false);
  const [formData, setFormData] = useState<Partial<ProjectRecord>>({
    name: '',
    code: '',
    location: '',
    manager: '',
    budget: 0,
    status: 'active',
    notes: ''
  });

  React.useEffect(() => {
    if (triggerCreateCounter > 0) {
      handleOpenAdd();
    }
  }, [triggerCreateCounter]);

  const handleOpenAdd = () => {
    setEditingProject(null);
    setConfirmDeleteInModal(false);
    setFormData({
      name: '',
      code: `PRJ-${String(projects.length + 1).padStart(2, '0')}`,
      location: '',
      manager: '',
      budget: 0,
      status: 'active',
      notes: ''
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (proj: ProjectRecord) => {
    setEditingProject(proj);
    setConfirmDeleteInModal(false);
    setFormData({ ...proj });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) return;
    const saved: ProjectRecord = {
      id: editingProject?.id || `proj-${Date.now()}`,
      name: formData.name.trim(),
      code: formData.code?.trim() || '',
      location: formData.location?.trim() || '',
      manager: formData.manager?.trim() || '',
      budget: Number(formData.budget) || 0,
      status: formData.status || 'active',
      notes: formData.notes?.trim() || '',
      createdAt: editingProject?.createdAt || new Date().toISOString().split('T')[0]
    };
    onSaveProject(saved, editingProject?.name);
    setIsModalOpen(false);
  };

  // Count any unlinked project names in orders/POs that are not in `projects` registry
  const unlinkedProjectNamesCount = useMemo(() => {
    const existingSet = new Set(projects.map(p => p.name.trim().toLowerCase()));
    const missing = new Set<string>();
    orders.forEach(o => {
      const pName = (o.col2 || '').trim();
      if (pName && pName !== 'โครงการทั่วไป' && !existingSet.has(pName.toLowerCase())) {
        missing.add(pName.toLowerCase());
      }
    });
    pos.forEach(po => {
      const pName = (po.projectId || '').trim();
      if (pName && pName !== 'โครงการทั่วไป' && !existingSet.has(pName.toLowerCase())) {
        missing.add(pName.toLowerCase());
      }
    });
    return missing.size;
  }, [projects, orders, pos]);

  // Calculate financial metrics strictly for registered projects in `projects` (Single Source of Truth)
  const augmentedProjects = useMemo(() => {
    return projects.map(proj => {
      const key = proj.name.trim().toLowerCase();
      const projOrders = orders.filter(
        o => (o.col2 || '').trim().toLowerCase() === key &&
             o.docType !== 'dest_weighbridge' &&
             !(o.docType === 'tax_invoice' && o.linkedViaDocNo)
      );
      const projPOs = pos.filter(p => (p.projectId || '').trim().toLowerCase() === key);

      let totalPurchases = 0;
      let totalPaid = 0;
      let totalDebt = 0;
      let lastDate = proj.createdAt ? proj.createdAt.split('T')[0] : '';

      projOrders.forEach(o => {
        totalPurchases += Number(o.col29) || 0;
        totalPaid += Number(o.col35) || 0;
        totalDebt += Number(o.col36) || 0;
        if (o.col7 && o.col7 > lastDate) lastDate = o.col7;
      });

      const totalPOAmount = projPOs.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);

      return {
        ...proj,
        orderCount: projOrders.length,
        poCount: projPOs.length,
        totalPOAmount,
        totalPurchases,
        totalPaid,
        totalDebt,
        lastDate
      };
    });
  }, [projects, orders, pos]);

  const filteredProjects = useMemo(() => {
    return augmentedProjects.filter(p => {
      if (statusFilter !== 'all' && (p.status || 'active') !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hay = `${p.name} ${p.code || ''} ${p.location || ''} ${p.manager || ''} ${p.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [augmentedProjects, searchTerm, statusFilter]);

  const metrics = useMemo(() => {
    return augmentedProjects.reduce(
      (acc, p) => {
        acc.count++;
        acc.poAmt += p.totalPOAmount;
        acc.purchases += p.totalPurchases;
        acc.debt += p.totalDebt;
        return acc;
      },
      { count: 0, poAmt: 0, purchases: 0, debt: 0 }
    );
  }, [augmentedProjects]);

  const fmtCurrency = (val: number) =>
    '฿' + val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">โครงการทั้งหมดในทะเบียน</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{metrics.count}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">เพิ่ม/ลบ/แก้ไขได้โดยตรง</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <FolderKanban className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">ยอดเปิด PO รวมทุกโครงการ</div>
            <div className="text-2xl font-bold text-indigo-700 mt-1">{fmtCurrency(metrics.poAmt)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">วงเงินสั่งซื้อตามใบ PO</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">ยอดรับของจริง (DO) สะสม</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{fmtCurrency(metrics.purchases)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">ตามใบส่งของที่เข้าหน้างาน</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 bg-rose-50/20 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-rose-700 font-medium">ยอดค้างชำระรวม</div>
            <div className="text-2xl font-bold text-rose-700 mt-1">{fmtCurrency(metrics.debt)}</div>
            <div className="text-[11px] text-rose-500 mt-0.5">แยกตามโครงการก่อสร้าง</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาชื่อโครงการ, รหัสโครงการ, สถานที่หน้างาน, ผู้ดูแล..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500 outline-none text-slate-700"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="active">กำลังดำเนินการ</option>
            <option value="completed">เสร็จสิ้นแล้ว</option>
            <option value="on_hold">ชะลอชั่วคราว</option>
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {unlinkedProjectNamesCount > 0 && onSyncProjectsFromBills && (
            <button
              type="button"
              onClick={onSyncProjectsFromBills}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="ดึงชื่อโครงการที่อยู่ในบิล/PO แต่ยังไม่อยู่ในทะเบียนโครงการ"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>ดึงชื่อโครงการจากบิล (+{unlinkedProjectNamesCount})</span>
            </button>
          )}

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>การ์ด</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>ตาราง</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มโครงการใหม่</span>
          </button>
        </div>
      </div>

      {/* Project List: Cards or Table View */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-400">
          <FolderKanban className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">ยังไม่มีข้อมูลในทะเบียนโครงการ</p>
          <p className="text-xs text-slate-400 mt-1">
            กดปุ่ม &quot;เพิ่มโครงการใหม่&quot; ด้านบนเพื่อสร้างโครงการ หรือดึงชื่อโครงการจากบิลที่มีอยู่
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">รหัส</th>
                  <th className="p-3">ชื่อโครงการ / ไซต์งาน</th>
                  <th className="p-3">สถานะ</th>
                  <th className="p-3">สถานที่ส่ง / กม.</th>
                  <th className="p-3">ผู้ดูแล / ผู้รับเหมา</th>
                  <th className="p-3 text-center">บิล DO / PO</th>
                  <th className="p-3 text-right">งบประมาณ</th>
                  <th className="p-3 text-right">ยอดรับของรวม</th>
                  <th className="p-3 text-right">ค้างชำระ</th>
                  <th className="p-3 text-center">จัดการ (ดูบิล / แก้ไข / ลบ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredProjects.map((proj) => (
                  <tr key={proj.id} className="hover:bg-slate-50/80 transition">
                    <td className="p-3 font-mono font-bold text-slate-600">{proj.code || '-'}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{proj.name}</div>
                      {proj.notes && <div className="text-[11px] text-slate-500 truncate max-w-[240px]">{proj.notes}</div>}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        proj.status === 'completed'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : proj.status === 'on_hold'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {proj.status === 'completed' ? 'เสร็จสิ้นแล้ว' : proj.status === 'on_hold' ? 'ชะลอชั่วคราว' : 'กำลังดำเนินการ'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{proj.location || '-'}</td>
                    <td className="p-3 text-slate-600">{proj.manager || '-'}</td>
                    <td className="p-3 text-center font-semibold text-slate-700">
                      {proj.orderCount} DO • {proj.poCount} PO
                    </td>
                    <td className="p-3 text-right font-mono text-slate-700">
                      {Number(proj.budget) > 0 ? fmtCurrency(Number(proj.budget)) : '-'}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-700">
                      {fmtCurrency(proj.totalPurchases)}
                    </td>
                    <td className={`p-3 text-right font-mono font-bold ${proj.totalDebt > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {fmtCurrency(proj.totalDebt)}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onFilterOrdersByProject(proj.name)}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md font-semibold text-[11px] cursor-pointer"
                        >
                          ดูบิล
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(proj)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 rounded-md font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>แก้ไข</span>
                        </button>
                        {confirmDeleteProjId === proj.id ? (
                          <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-md">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteProject(proj.id, proj.name);
                                setConfirmDeleteProjId(null);
                              }}
                              className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer"
                            >
                              ยืนยันลบ
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteProjId(null)}
                              className="px-1 py-0.5 text-slate-600 hover:text-slate-900 text-[10px] font-semibold cursor-pointer"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteProjId(proj.id)}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-md font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>ลบ</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map(proj => {
            const budgetNum = Number(proj.budget) || 0;
            const budgetPct = budgetNum > 0 ? Math.min(100, Math.round((proj.totalPurchases / budgetNum) * 100)) : 0;

            return (
              <div
                key={proj.id}
                className="bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md hover:border-emerald-300 transition flex flex-col justify-between overflow-hidden"
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {proj.code && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {proj.code}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          proj.status === 'completed'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : proj.status === 'on_hold'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {proj.status === 'completed' ? 'เสร็จสิ้นแล้ว' : proj.status === 'on_hold' ? 'ชะลอชั่วคราว' : 'กำลังดำเนินการ'}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-900 text-sm">{proj.name}</h3>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(proj)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:text-emerald-700 bg-slate-100 hover:bg-emerald-50 border border-slate-200 rounded-lg transition flex items-center gap-1 cursor-pointer"
                        title="แก้ไขข้อมูลโครงการ"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>แก้ไข</span>
                      </button>

                      {confirmDeleteProjId === proj.id ? (
                        <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProject(proj.id, proj.name);
                              setConfirmDeleteProjId(null);
                            }}
                            className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer"
                          >
                            ยืนยันลบ
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteProjId(null)}
                            className="px-1 py-0.5 text-slate-600 hover:text-slate-900 text-[10px] font-semibold cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProjId(proj.id)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition flex items-center gap-1 cursor-pointer"
                          title="ลบโครงการออกจากทะเบียน"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>ลบ</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-slate-500">
                    {proj.location && (
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">สถานที่ส่ง/กม.: {proj.location}</span>
                      </div>
                    )}
                    {proj.manager && (
                      <div className="flex items-center gap-1.5 truncate">
                        <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">ผู้รับผิดชอบ/ผู้รับเหมา: {proj.manager}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg text-center border border-slate-100 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">บิล DO / PO</div>
                      <div className="font-bold text-slate-800">{proj.orderCount} DO • {proj.poCount} PO</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">ยอดรับของรวม</div>
                      <div className="font-bold text-emerald-700 truncate" title={fmtCurrency(proj.totalPurchases)}>
                        {fmtCurrency(proj.totalPurchases)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">ค้างชำระ</div>
                      <div className={`font-bold truncate ${proj.totalDebt > 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                        {fmtCurrency(proj.totalDebt)}
                      </div>
                    </div>
                  </div>

                  {budgetNum > 0 && (
                    <div className="space-y-1 pt-0.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>งบประมาณ: {fmtCurrency(budgetNum)}</span>
                        <span className="font-bold text-slate-700">{budgetPct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${budgetPct > 90 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                          style={{ width: `${budgetPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>อัปเดต: {proj.lastDate || '-'}</span>
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onCreateOrderForProject(proj.name, proj.location, proj.manager)}
                      className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-medium transition cursor-pointer text-xs flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      <span>ลงบิลส่งของ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onFilterOrdersByProject(proj.name)}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold transition cursor-pointer text-xs flex items-center gap-1 shadow-xs"
                    >
                      <span>ดูบิลโครงการ</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-fadeIn">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FolderKanban className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold">
                    {editingProject ? 'แก้ไขข้อมูลโครงการ' : 'เพิ่มโครงการก่อสร้าง / ไซต์งานใหม่'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    หากเปลี่ยนชื่อโครงการ ระบบจะอัปเดตชื่อโครงการในบิลและ PO ที่ผูกไว้ให้อัตโนมัติ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    ชื่อโครงการ (เชื่อมกับช่อง 2. โครงการ) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="เช่น โครงการก่อสร้างถนนสาย กม.12"
                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">รหัสโครงการ</label>
                  <input
                    type="text"
                    value={formData.code || ''}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="เช่น PRJ-01"
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">สถานที่ส่ง / กม. (ช่อง 37)</label>
                  <input
                    type="text"
                    value={formData.location || ''}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="เช่น หน้างาน กม.12+500"
                    className="w-full p-2 border border-slate-300 rounded-lg outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">ผู้ดูแล / ผู้รับเหมา (ช่อง 9)</label>
                  <input
                    type="text"
                    value={formData.manager || ''}
                    onChange={(e) => setFormData({ ...formData, manager: e.target.value })}
                    placeholder="เช่น วิศวกรประจำไซต์"
                    className="w-full p-2 border border-slate-300 rounded-lg outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">งบประมาณวัสดุโครงการ (บาท)</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.budget || ''}
                    onChange={(e) => setFormData({ ...formData, budget: Number(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">สถานะโครงการ</label>
                  <select
                    value={formData.status || 'active'}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full p-2 border border-slate-300 rounded-lg outline-none bg-white"
                  >
                    <option value="active">กำลังดำเนินการ</option>
                    <option value="completed">เสร็จสิ้นแล้ว</option>
                    <option value="on_hold">ชะลอชั่วคราว</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">หมายเหตุ</label>
                <input
                  type="text"
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="รายละเอียดเพิ่มเติมของโครงการ"
                  className="w-full p-2 border border-slate-300 rounded-lg outline-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-between gap-2 border-t border-slate-100">
                <div>
                  {editingProject && (
                    confirmDeleteInModal ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg">
                        <span className="text-rose-700 font-semibold text-[11px]">ยืนยันลบโครงการ?</span>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteProject(editingProject.id, editingProject.name);
                            setConfirmDeleteInModal(false);
                            setIsModalOpen(false);
                          }}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold cursor-pointer"
                        >
                          ยืนยันลบ
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteInModal(false)}
                          className="px-2 py-1 text-slate-600 hover:text-slate-900 text-[11px] font-medium cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteInModal(true)}
                        className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ลบโครงการนี้</span>
                      </button>
                    )
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>บันทึกโครงการ</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
