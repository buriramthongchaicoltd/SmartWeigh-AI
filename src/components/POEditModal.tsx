import React, { useState, useEffect } from 'react';
import { 
  X, 
  FileText, 
  Plus, 
  Trash2, 
  Save, 
  Building2, 
  Calendar, 
  CreditCard, 
  MapPin, 
  UserCheck,
  AlertTriangle
} from 'lucide-react';
import { PurchaseOrder, POItem, StoreMerchant, ProjectRecord, OrderRecord } from '../types';
import { ImageDocViewer } from './ImageDocViewer';
import { checkDuplicatePO } from '../utils/poReconciliation';
import { buildDatabaseCatalog, inferMaterialCategory } from '../utils/dbLookup';
import { SmartDatabaseInput } from './SmartDatabaseInput';

interface POEditModalProps {
  isOpen: boolean;
  po: PurchaseOrder | null;
  stores: StoreMerchant[];
  projects?: ProjectRecord[];
  existingPOs?: PurchaseOrder[];
  existingOrders?: OrderRecord[];
  initialStoreName?: string;
  onClose: () => void;
  onSave: (po: PurchaseOrder) => void;
}

export const POEditModal: React.FC<POEditModalProps> = ({
  isOpen,
  po,
  stores,
  projects = [],
  existingPOs = [],
  existingOrders = [],
  initialStoreName,
  onClose,
  onSave
}) => {
  const [confirmDuplicatePOOverride, setConfirmDuplicatePOOverride] = useState(false);
  const [projectMissingError, setProjectMissingError] = useState(false);
  const [formData, setFormData] = useState<Partial<PurchaseOrder>>({
    poNumber: '',
    orderDate: new Date().toISOString().split('T')[0],
    deliveryDueDate: '',
    projectId: '',
    storeId: '',
    storeName: initialStoreName || '',
    category: 'งานหิน/ทราย',
    creditTerms: 'เครดิต 30 วัน',
    deliveryLocation: '',
    orderedBy: 'ฝ่ายจัดซื้อ',
    approvedBy: '',
    notes: '',
    status: 'pending',
    items: []
  });

  const [items, setItems] = useState<POItem[]>([
    {
      id: `item-${Date.now()}-1`,
      itemDescription: 'หินคลุก 3/4',
      specCode: 'STD-34',
      orderedQty: 100,
      unit: 'ตัน',
      unitPrice: 280,
      totalAmount: 28000
    }
  ]);

  useEffect(() => {
    setConfirmDuplicatePOOverride(false);
    setProjectMissingError(false);
    if (po) {
      setFormData({ ...po });
      setItems(po.items && po.items.length > 0 ? [...po.items] : []);
    } else {
      const today = new Date().toISOString().split('T')[0];
      const randomSeq = Math.floor(1000 + Math.random() * 9000);
      setFormData({
        poNumber: `PO-${new Date().getFullYear()}-${randomSeq}`,
        orderDate: today,
        deliveryDueDate: '',
        projectId: '',
        storeId: '',
        storeName: initialStoreName || (stores[0]?.name || ''),
        category: 'งานหิน/ทราย',
        creditTerms: 'เครดิต 30 วัน',
        deliveryLocation: '',
        orderedBy: 'ฝ่ายจัดซื้อ',
        approvedBy: '',
        notes: '',
        status: 'pending',
        items: []
      });
      setItems([
        {
          id: `item-${Date.now()}-1`,
          itemDescription: 'หินคลุก 3/4',
          specCode: 'STD-34',
          orderedQty: 100,
          unit: 'ตัน',
          unitPrice: 280,
          totalAmount: 28000
        }
      ]);
    }
  }, [po, isOpen, initialStoreName, stores]);

  const totalQty = items.reduce((sum, it) => sum + (Number(it.orderedQty) || 0), 0);
  const totalAmount = items.reduce((sum, it) => sum + (Number(it.totalAmount) || 0), 0);

  const duplicatePOMatch = React.useMemo(() => {
    if (!isOpen) return null;
    const matches = checkDuplicatePO(
      {
        id: po?.id,
        poNumber: formData.poNumber,
        storeName: formData.storeName,
        orderDate: formData.orderDate,
        totalAmount,
        image: formData.image
      },
      existingPOs,
      formData.image
    );
    return matches.length > 0 ? matches[0] : null;
  }, [isOpen, po?.id, formData.poNumber, formData.storeName, formData.orderDate, totalAmount, formData.image, existingPOs]);

  const dbCatalog = React.useMemo(
    () => buildDatabaseCatalog(stores, projects, existingPOs, existingOrders),
    [stores, projects, existingPOs, existingOrders]
  );

  if (!isOpen) return null;

  const handleItemChange = (index: number, field: keyof POItem, value: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: value };
    
    if (field === 'orderedQty' || field === 'unitPrice') {
      const qty = field === 'orderedQty' ? Number(value) : Number(item.orderedQty);
      const price = field === 'unitPrice' ? Number(value) : Number(item.unitPrice);
      item.totalAmount = (qty || 0) * (price || 0);
    }
    
    updated[index] = item;
    setItems(updated);

    if (index === 0 && (field === 'itemDescription' || field === 'specCode')) {
      const inferred = inferMaterialCategory(item.itemDescription, undefined, undefined, undefined, item.specCode);
      if (inferred && inferred !== 'วัสดุก่อสร้างทั่วไป') {
        setFormData(prev => ({
          ...prev,
          category: (!prev.category || prev.category === 'งานหิน/ทราย' || prev.category === 'วัสดุก่อสร้างทั่วไป' || prev.category === 'งานจัดซื้อทั่วไป')
            ? inferred
            : prev.category
        }));
      }
    }
  };

  const addItemRow = () => {
    setItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${prev.length + 1}`,
        itemDescription: '',
        specCode: '',
        orderedQty: 1,
        unit: 'ตัน',
        unitPrice: 0,
        totalAmount: 0
      }
    ]);
  };

  const removeItemRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const appendToPONotes = (extraNote: string) => {
    const cleanExtra = extraNote.replace(/^(?:หมายเหตุ|Note|Remark)\s*[:：-]?\s*/i, '').trim();
    if (!cleanExtra) return;
    setFormData(prev => {
      const current = (prev.notes || '').trim();
      if (current.includes(cleanExtra)) return prev;
      return {
        ...prev,
        notes: current ? `${current} | ${cleanExtra}` : cleanExtra
      };
    });
  };

  // Move an entire row (that was mistakenly scanned as a line item) into the Notes field
  const moveItemRowToNotes = (index: number) => {
    const target = items[index];
    if (!target) return;
    const combinedText = [target.itemDescription, target.specCode].filter(Boolean).join(' ').trim();
    if (combinedText) {
      appendToPONotes(combinedText);
    }
    if (items.length > 1) {
      setItems(prev => prev.filter((_, i) => i !== index));
    } else {
      handleItemChange(index, 'itemDescription', '');
    }
  };

  // Split selected text OR trailing remark out of itemDescription and move it into Notes
  const splitNoteFromItemDescription = (index: number) => {
    const target = items[index];
    if (!target || !target.itemDescription) return;
    const rawDesc = target.itemDescription.trim();

    // 1. Check if user highlighted/selected a substring inside this row's input
    const inputEl = document.getElementById(`po-item-desc-${index}`) as HTMLInputElement | null;
    if (inputEl && inputEl.selectionStart !== null && inputEl.selectionEnd !== null && inputEl.selectionEnd > inputEl.selectionStart) {
      const selectedPart = rawDesc.slice(inputEl.selectionStart, inputEl.selectionEnd).trim();
      const remainingPart = (rawDesc.slice(0, inputEl.selectionStart) + ' ' + rawDesc.slice(inputEl.selectionEnd))
        .replace(/\s+/g, ' ')
        .replace(/^[-–—|/,\s]+|[-–—|/,\s]+$/g, '')
        .trim();
      if (selectedPart && remainingPart) {
        handleItemChange(index, 'itemDescription', remainingPart);
        appendToPONotes(selectedPart);
        return;
      }
    }

    // 2. Otherwise, auto-detect trailing remark keywords, parentheses, or delimiter
    const keywordMatch = /^(.*?)(?:\s+[-–—|/]*\s*|\s*[(（]\s*|\s+)((?:หมายเหตุ|Remark|Note|เงื่อนไข|ส่งที่|สถานที่ส่ง|จัดส่ง|ติดต่อ|โทร\.?|ราคารวม|ราคาไม่รวม|เครดิต|\*).+?)[)）]?$/i.exec(rawDesc);
    if (keywordMatch && keywordMatch[1].trim() && keywordMatch[2].trim()) {
      handleItemChange(index, 'itemDescription', keywordMatch[1].trim());
      appendToPONotes(keywordMatch[2].replace(/[)）]$/, '').trim());
      return;
    }

    // 3. Check for trailing parentheses e.g. "หินคลุก 3/4 (ส่งหน้างาน กม.12)"
    const parenMatch = /^(.*?)\s*[(（]([^)）]{4,})[)）]$/.exec(rawDesc);
    if (parenMatch && parenMatch[1].trim() && parenMatch[2].trim()) {
      handleItemChange(index, 'itemDescription', parenMatch[1].trim());
      appendToPONotes(parenMatch[2].trim());
      return;
    }

    // 4. Check for dash/pipe delimiter e.g. "หินคลุก 3/4 - ส่งหน้างานพรุ่งนี้"
    const delimMatch = /^(.*?)\s+(?:[-–—|]|\*{2,})\s+(.+)$/.exec(rawDesc);
    if (delimMatch && delimMatch[1].trim() && delimMatch[2].trim()) {
      handleItemChange(index, 'itemDescription', delimMatch[1].trim());
      appendToPONotes(delimMatch[2].trim());
      return;
    }

    // 5. Fallback for trailing logistics/site instructions without punctuation (e.g. "หินคลุก 3/4 ส่งหน้างาน กม.12")
    const phraseMatch = /^(.*?)\s+((?:ส่ง|หน้างาน|กม\.|คุณ|ช่าง|เวลา|ภายในวันที่|ด่วน|พร้อม|ขอใบ).+)$/i.exec(rawDesc);
    if (phraseMatch && phraseMatch[1].trim() && phraseMatch[2].trim()) {
      handleItemChange(index, 'itemDescription', phraseMatch[1].trim());
      appendToPONotes(phraseMatch[2].trim());
      return;
    }
  };

  const handleOverwriteExistingPO = (existing: PurchaseOrder) => {
    const matchedStore = stores.find(s => s.name.trim().toLowerCase() === formData.storeName?.trim().toLowerCase());
    const mergedPO: PurchaseOrder = {
      ...existing,
      poNumber: formData.poNumber?.trim() || existing.poNumber,
      orderDate: formData.orderDate || existing.orderDate,
      deliveryDueDate: formData.deliveryDueDate || existing.deliveryDueDate,
      projectId: formData.projectId || existing.projectId,
      storeId: matchedStore ? matchedStore.id : (formData.storeId || existing.storeId),
      storeName: formData.storeName?.trim() || existing.storeName,
      category: formData.category || existing.category,
      items,
      totalQty,
      totalAmount,
      creditTerms: formData.creditTerms || existing.creditTerms,
      deliveryLocation: formData.deliveryLocation || existing.deliveryLocation,
      orderedBy: formData.orderedBy || existing.orderedBy,
      approvedBy: formData.approvedBy || existing.approvedBy,
      notes: formData.notes || existing.notes,
      image: formData.image || existing.image || null,
      updatedAt: new Date().toISOString()
    };
    onSave(mergedPO);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Strict Hard Block: Never allow saving a duplicate PO as a new record
    if (duplicatePOMatch) {
      return;
    }

    if (!formData.poNumber?.trim()) {
      return;
    }
    if (!formData.storeName?.trim()) {
      return;
    }
    if (!formData.projectId?.trim()) {
      setProjectMissingError(true);
      return;
    }

    const matchedStore = stores.find(s => s.name.trim().toLowerCase() === formData.storeName?.trim().toLowerCase());

    const finalPO: PurchaseOrder = {
      id: po?.id || `po-${Date.now()}`,
      poNumber: formData.poNumber.trim(),
      orderDate: formData.orderDate || new Date().toISOString().split('T')[0],
      deliveryDueDate: formData.deliveryDueDate || '',
      projectId: formData.projectId.trim(),
      storeId: matchedStore ? matchedStore.id : (formData.storeId || ''),
      storeName: formData.storeName.trim(),
      category: formData.category || 'งานวัสดุก่อสร้าง',
      items,
      totalQty,
      totalAmount,
      status: po ? po.status : 'pending',
      creditTerms: formData.creditTerms || 'ตามเงื่อนไขวางบิล',
      deliveryLocation: formData.deliveryLocation || '',
      orderedBy: formData.orderedBy || '',
      approvedBy: formData.approvedBy || '',
      notes: formData.notes || '',
      image: formData.image || po?.image || null,
      createdAt: po?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineInboxId: formData.lineInboxId || po?.lineInboxId,
      lineMessageId: formData.lineMessageId || po?.lineMessageId,
      lineUserId: formData.lineUserId || po?.lineUserId,
      lineSenderName: formData.lineSenderName || po?.lineSenderName,
      lineGroupId: formData.lineGroupId || po?.lineGroupId,
      lineGroupName: formData.lineGroupName || po?.lineGroupName,
      lineReceivedAt: formData.lineReceivedAt || po?.lineReceivedAt
    };

    onSave(finalPO);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 md:p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-2xl w-full my-4 md:my-8 overflow-hidden flex flex-col max-h-[94vh] animate-fadeIn ${
        formData.image ? 'max-w-[97vw] xl:max-w-[1650px]' : 'max-w-4xl'
      }`}>
        
        {/* Header */}
        <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>{po ? `แก้ไขใบสั่งซื้อ: ${po.poNumber}` : 'เปิดใบสั่งซื้อใหม่ (Create Purchase Order)'}</span>
                {formData.image && (
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-normal">
                    เปรียบเทียบกับภาพจริง (Split Screen)
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-300">
                เอกสารบันทึกคำสั่งซื้อสินค้าล่วงหน้า เพื่อใช้ตรวจสอบและตัดยอดส่งมอบอัตโนมัติ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Container: Split layout if image is present */}
        <div className={`flex-1 overflow-hidden flex flex-col ${
          formData.image ? 'md:grid md:grid-cols-12 md:divide-x md:divide-slate-200' : ''
        }`}>
          
          {/* Left Column: PO Image Viewer (Only when image is attached) */}
          {formData.image && (
            <div className="md:col-span-5 lg:col-span-4 bg-slate-950 p-3 flex flex-col h-full overflow-hidden">
              <ImageDocViewer
                image={formData.image}
                title="ภาพใบสั่งซื้อ (PO) ต้นฉบับ"
                onImageChange={(newImg) => setFormData(prev => ({ ...prev, image: newImg }))}
              />
            </div>
          )}

          {/* Right Column: Form Body */}
          <form 
            onSubmit={handleSubmit} 
            className={`flex flex-col h-full overflow-hidden ${formData.image ? 'md:col-span-7 lg:col-span-8' : 'w-full'}`}
          >
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

          {/* LINE OA Bot Metadata Banner if PO came from LINE */}
          {(formData.lineSenderName || formData.lineGroupName) && (
            <div className="p-3 rounded-xl border border-emerald-300 bg-emerald-50/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[10px]">
                  💬 ใบสั่งซื้อจาก LINE OA Bot
                </span>
                {formData.lineSenderName && (
                  <span className="text-emerald-950 font-semibold">
                    👤 ผู้ส่ง: <strong>{formData.lineSenderName}</strong>
                  </span>
                )}
                {formData.lineGroupName && (
                  <span className="text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-200 font-medium">
                    👥 กลุ่ม LINE: <strong>{formData.lineGroupName}</strong>
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-200">
                🔒 เก็บชื่อกลุ่ม LINE แยกต่างหากจากชื่อโครงการ
              </span>
            </div>
          )}

          {/* Mandatory Project Validation Banner */}
          {projectMissingError && !formData.projectId?.trim() && (
            <div className="p-3 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-950 flex items-center justify-between gap-2 animate-fadeIn">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <div className="font-bold text-xs sm:text-sm">
                    กรุณาระบุหรือเลือก "โครงการ / ไซต์งาน" ก่อนกดยืนยันเปิดใบสั่งซื้อ
                  </div>
                  <p className="text-[11px] text-rose-800">
                    ระบบบังคับให้ต้องระบุชื่อโครงการเสมอเพื่อไม่ให้ข้อมูลโครงการตกหล่น
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Duplicate PO Detection Alert Banner */}
          {duplicatePOMatch && (
            <div className={`p-3.5 rounded-xl border-2 space-y-2.5 animate-fadeIn ${
              duplicatePOMatch.level === 'exact'
                ? 'bg-rose-50/90 border-rose-400 text-rose-950 shadow-xs'
                : 'bg-amber-50/90 border-amber-400 text-amber-950 shadow-xs'
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${
                    duplicatePOMatch.level === 'exact' ? 'text-rose-600' : 'text-amber-600'
                  }`} />
                  <div>
                    <div className="font-bold text-xs sm:text-sm">{duplicatePOMatch.reasonTitle}</div>
                    <p className="text-[11px] opacity-90 mt-0.5">{duplicatePOMatch.reasonDetail}</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 ${
                  duplicatePOMatch.level === 'exact' ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
                }`}>
                  {duplicatePOMatch.level === 'exact' ? '🚫 บล็อก PO ซ้ำ 100%' : '🚫 บล็อกข้อมูลซ้ำ'}
                </span>
              </div>

              <div className="bg-white/95 p-2.5 rounded-lg border border-slate-200 text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <span className="text-slate-400 block text-[10px]">เลขที่ PO เดิม</span>
                  <span className="font-mono font-bold text-blue-900">{duplicatePOMatch.matchedPO.poNumber}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">วันที่ออก PO</span>
                  <span className="font-mono text-slate-800">{duplicatePOMatch.matchedPO.orderDate}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">ร้านค้า</span>
                  <span className="font-semibold text-slate-800 truncate block">{duplicatePOMatch.matchedPO.storeName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">ยอดรวมสุทธิ</span>
                  <span className="font-mono font-bold text-emerald-800">฿{duplicatePOMatch.matchedPO.totalAmount.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs transition cursor-pointer flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>ยกเลิกการนำเข้า PO ซ้ำนี้ (ไม่บันทึกเข้าระบบ)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOverwriteExistingPO(duplicatePOMatch.matchedPO)}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                  >
                    🔄 อัปเดตทับ PO เดิม ({duplicatePOMatch.matchedPO.poNumber})
                  </button>
                </div>
                <span className="text-[11px] font-bold text-rose-800 bg-rose-100/90 px-2.5 py-1 rounded-lg border border-rose-300">
                  🔒 ระบบล็อกปุ่มบันทึกแล้ว เพื่อป้องกัน PO ซ้ำเข้าระบบ
                </span>
              </div>
            </div>
          )}
          
          {/* Main Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* PO Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เลขที่ใบสั่งซื้อ (PO Number — ตามหน้าเอกสารจริง) *
              </label>
              <input
                type="text"
                required
                value={formData.poNumber || ''}
                onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                placeholder="เช่น 257/12850, 12855 หรือ PO6900276"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono font-bold text-blue-900"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                ✓ ยึดตามหน้าเอกสารจริง 100% (รองรับทั้ง <span className="font-mono">257/12850</span>, <span className="font-mono">12855</span> และ <span className="font-mono">PO6900276</span>)
              </p>
            </div>

            {/* Order Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                วันที่ออกเอกสาร (Order Date) *
              </label>
              <input
                type="date"
                required
                value={formData.orderDate || ''}
                onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Delivery Due Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                กำหนดส่งมอบสินค้า (Due Date)
              </label>
              <input
                type="date"
                value={formData.deliveryDueDate || ''}
                onChange={(e) => setFormData({ ...formData, deliveryDueDate: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Store / Vendor Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ผู้จำหน่าย / ร้านค้า (Vendor) *
              </label>
              <SmartDatabaseInput
                required
                value={formData.storeName || ''}
                onChange={(val) => setFormData(prev => ({ ...prev, storeName: val }))}
                onSelectOption={(opt) => {
                  setFormData(prev => ({
                    ...prev,
                    storeName: opt.value,
                    storeId: opt.meta?.storeId || prev.storeId,
                    category: opt.meta?.category || prev.category,
                    creditTerms: prev.creditTerms || opt.meta?.creditTerms || 'เครดิต 30 วัน'
                  }));
                }}
                options={dbCatalog.stores}
                isStoreField={true}
                showStatusBadge={true}
                fieldLabel="ร้านค้า"
                placeholder="พิมพ์หรือเลือกร้านค้าจากฐานข้อมูล"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>

            {/* Project */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                โครงการ / ไซต์งาน (Project — ช่อง 2) <span className="text-rose-500">* (ต้องระบุ)</span>
              </label>
              <SmartDatabaseInput
                required
                value={formData.projectId || ''}
                onChange={(val) => {
                  if (val.trim()) setProjectMissingError(false);
                  setFormData(prev => ({ ...prev, projectId: val }));
                }}
                onSelectOption={(opt) => {
                  setProjectMissingError(false);
                  setFormData(prev => ({
                    ...prev,
                    projectId: opt.value,
                    deliveryLocation: prev.deliveryLocation || opt.meta?.location || ''
                  }));
                }}
                options={dbCatalog.projects}
                showStatusBadge={true}
                fieldLabel="โครงการ"
                placeholder="เลือกหรือพิมพ์ชื่อโครงการ (จำเป็นต้องระบุ)"
                className={`w-full px-3 py-2 text-xs bg-slate-50 border rounded-lg focus:ring-2 focus:ring-blue-500 font-semibold ${
                  !formData.projectId?.trim() ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/40' : 'border-slate-300'
                }`}
              />
            </div>

            {/* Category */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  หมวดหมู่งาน / วัสดุ (Category — ช่อง 3)
                </label>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  ✨ ออโต้ตามรายการวัสดุ/ร้านค้า
                </span>
              </div>
              <SmartDatabaseInput
                value={formData.category || ''}
                onChange={(val) => setFormData(prev => ({ ...prev, category: val }))}
                options={dbCatalog.categories}
                showStatusBadge={false}
                fieldLabel="หมวดหมู่งาน/วัสดุ"
                placeholder="เลือกหมวดงานก่อสร้าง/ถนน/สะพาน/กรมทางหลวง หรือพิมพ์เอง"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Credit Terms */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เงื่อนไขการชำระเงิน (Credit Terms)
              </label>
              <SmartDatabaseInput
                value={formData.creditTerms || ''}
                onChange={(val) => setFormData(prev => ({ ...prev, creditTerms: val }))}
                options={dbCatalog.creditTerms}
                showStatusBadge={false}
                fieldLabel="เงื่อนไขชำระเงิน"
                placeholder="เช่น เครดิต 30 วัน, เงินสด"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Delivery Location */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                สถานที่จัดส่ง / กม.
              </label>
              <SmartDatabaseInput
                value={formData.deliveryLocation || ''}
                onChange={(val) => setFormData(prev => ({ ...prev, deliveryLocation: val }))}
                options={dbCatalog.locations}
                showStatusBadge={true}
                fieldLabel="สถานที่จัดส่ง"
                placeholder="เช่น แคมป์ กม.14 หรือ หน้างานหลัก"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Ordered By & Approved By */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ผู้เปิดใบสั่งซื้อ / ผู้อนุมัติ
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <SmartDatabaseInput
                  value={formData.orderedBy || ''}
                  onChange={(val) => setFormData(prev => ({ ...prev, orderedBy: val }))}
                  options={dbCatalog.buyersAndStaff}
                  showStatusBadge={false}
                  fieldLabel="ผู้สั่งซื้อ"
                  placeholder="ผู้สั่งซื้อ"
                  className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <SmartDatabaseInput
                  value={formData.approvedBy || ''}
                  onChange={(val) => setFormData(prev => ({ ...prev, approvedBy: val }))}
                  options={dbCatalog.buyersAndStaff}
                  showStatusBadge={false}
                  fieldLabel="ผู้อนุมัติ"
                  placeholder="ผู้อนุมัติ"
                  className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  รายการสินค้าที่สั่งซื้อ (Ordered Line Items)
                </h3>
                <p className="text-[11px] text-slate-500">
                  คลิกที่ช่องเพื่อกรองเลือกชื่อสินค้า/สเปก/หน่วยจากฐานข้อมูล หรือพิมพ์ใหม่เพื่อบันทึกเป็นรายการใหม่
                </p>
              </div>
              <button
                type="button"
                onClick={addItemRow}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่มรายการ</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-visible shadow-2xs bg-white">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 w-10 text-center">#</th>
                    <th className="p-2.5 min-w-[220px]">ชื่อรายการสินค้า * (Description)</th>
                    <th className="p-2.5 w-28">สเปก / Code</th>
                    <th className="p-2.5 w-24 text-right">ปริมาณ *</th>
                    <th className="p-2.5 w-24 text-center">หน่วย *</th>
                    <th className="p-2.5 w-24 text-right">ราคา/หน่วย (฿)</th>
                    <th className="p-2.5 w-28 text-right">รวมเงิน (฿)</th>
                    <th className="p-2.5 w-10 text-center">ลบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {items.map((it, idx) => {
                    const hasSuspectedNoteInDesc = /(?:หมายเหตุ|Remark|Note|เงื่อนไข|ส่งที่|สถานที่ส่ง|จัดส่ง|ติดต่อ|โทร\.?|ราคารวม|เครดิต|\*{2,}|[(（].{5,}[)）]|\s+[-–—|]\s+)/i.test(it.itemDescription || '');
                    return (
                    <tr key={it.id || idx} className="hover:bg-slate-50/70 align-top">
                      <td className="p-2.5 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-2">
                        <SmartDatabaseInput
                          id={`po-item-desc-${idx}`}
                          required
                          value={it.itemDescription}
                          onChange={(val) => handleItemChange(idx, 'itemDescription', val)}
                          onSelectOption={(opt) => {
                            const updated = [...items];
                            const current = { ...updated[idx], itemDescription: opt.value };
                            if (!current.specCode && opt.meta?.specCode) {
                              current.specCode = opt.meta.specCode;
                            }
                            if ((!current.unit || current.unit === 'ตัน') && opt.meta?.unit) {
                              current.unit = opt.meta.unit;
                            }
                            if (!current.unitPrice && opt.meta?.unitPrice) {
                              current.unitPrice = Number(opt.meta.unitPrice) || 0;
                              current.totalAmount = (Number(current.orderedQty) || 0) * current.unitPrice;
                            }
                            updated[idx] = current;
                            setItems(updated);
                          }}
                          options={dbCatalog.items}
                          showStatusBadge={true}
                          fieldLabel="รายการสินค้า"
                          placeholder="เช่น หินคลุก 3/4, ปูนซีเมนต์, เหล็กข้ออ้อย 16 มม."
                          className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:ring-1 focus:ring-blue-500 font-medium text-slate-900"
                        />
                        {(hasSuspectedNoteInDesc || (it.itemDescription && it.itemDescription.length > 18)) && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => splitNoteFromItemDescription(idx)}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer border ${
                                hasSuspectedNoteInDesc
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                              title="คลิกเพื่อแยกข้อความหมายเหตุท้ายชื่อสินค้า (หรือลากคลุมดำข้อความที่ต้องการแล้วย้ายไปช่องหมายเหตุทันที)"
                            >
                              <span>✂️ แยกหมายเหตุ/ส่วนที่คลุมดำไปช่องหมายเหตุ</span>
                            </button>
                            {items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => moveItemRowToNotes(idx)}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 transition cursor-pointer"
                                title="กรณีแถวนี้ทั้งแถวไม่ใช่สินค้า แต่เป็นบรรทัดหมายเหตุในตาราง"
                              >
                                <span>↪️ ย้ายทั้งแถวนี้ไปหมายเหตุ</span>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <SmartDatabaseInput
                          value={it.specCode || ''}
                          onChange={(val) => handleItemChange(idx, 'specCode', val)}
                          options={dbCatalog.specs}
                          showStatusBadge={false}
                          fieldLabel="สเปก"
                          placeholder="เช่น STD, KSC-280"
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-mono"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          required
                          value={it.orderedQty || ''}
                          onChange={(e) => handleItemChange(idx, 'orderedQty', e.target.value)}
                          placeholder="0"
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md text-right font-mono font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <SmartDatabaseInput
                          required
                          value={it.unit || ''}
                          onChange={(val) => handleItemChange(idx, 'unit', val)}
                          options={dbCatalog.units}
                          showStatusBadge={false}
                          fieldLabel="หน่วยนับ"
                          placeholder="ตัน/คิว"
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-md text-center"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          value={it.unitPrice || ''}
                          onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                          placeholder="0.00"
                          className="w-full min-w-[80px] px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md text-right font-mono"
                        />
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold text-slate-800 tabular-nums">
                        ฿{(Number(it.totalAmount) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          disabled={items.length <= 1}
                          onClick={() => removeItemRow(idx)}
                          className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 rounded transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-300 font-bold text-slate-900">
                  <tr>
                    <td colSpan={3} className="p-3 text-right">รวมปริมาณและยอดเงินทั้งสิ้น:</td>
                    <td className="p-3 text-right font-mono text-blue-900 tabular-nums">
                      {totalQty.toLocaleString('th-TH')}
                    </td>
                    <td></td>
                    <td></td>
                    <td className="p-3 text-right font-mono text-emerald-800 text-sm tabular-nums">
                      ฿{totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หมายเหตุ / เงื่อนไขเพิ่มเติม
            </label>
            <textarea
              rows={2}
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="ระบุข้อกำหนดในการรับของ การชั่งน้ำหนัก หรือข้อมูลเฉพาะกิจ"
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          </div>

          {/* Footer Submit */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              * ข้อมูลใบสั่งซื้อจะถูกนำไปเชื่อมโยงกับตั๋วชั่งและใบส่งของอัตโนมัติตามเลขที่ PO
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                ยกเลิก
              </button>
              {duplicatePOMatch ? (
                <button
                  type="button"
                  disabled
                  className="px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-slate-200 text-slate-500 border border-slate-300 cursor-not-allowed"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>🚫 บล็อกการบันทึก: PO ซ้ำกับ {duplicatePOMatch.matchedPO.poNumber}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{po ? 'บันทึกการแก้ไข PO' : 'ยืนยันเปิดใบสั่งซื้อ'}</span>
                </button>
              )}
            </div>
          </div>

        </form>
      </div>

    </div>
  </div>
  );
};
