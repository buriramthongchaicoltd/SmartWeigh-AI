import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Upload, 
  Camera,
  Loader2, 
  Scale, 
  Package, 
  Truck, 
  Receipt, 
  Layers, 
  Check, 
  AlertCircle,
  FileImage,
  FileText
} from 'lucide-react';
import { OrderRecord, StoreMerchant, DocumentType, PurchaseOrder } from '../types';
import { optimizeImageForAI } from '../utils/imageProcessing';

interface ScanModalProps {
  isOpen: boolean;
  defaultDocType?: ScanDocType;
  existingOrders?: OrderRecord[];
  existingPOs?: PurchaseOrder[];
  onInspectExistingOrder?: (order: OrderRecord) => void;
  onInspectExistingPO?: (po: PurchaseOrder) => void;
  onClose: () => void;
  onScanComplete: (data: Partial<OrderRecord>, imageBase64: string, storeSuggestion?: Partial<StoreMerchant>) => void;
  onPOScanComplete?: (poData: Partial<PurchaseOrder>, imageBase64: string) => void;
}

type ScanDocType = 'auto' | DocumentType;

interface DocTypeOption {
  id: ScanDocType;
  group: 'store' | 'company' | 'auto';
  title: string;
  icon: string;
  description: string;
  badge: string;
  color: string;
}

const DOC_TYPE_OPTIONS: DocTypeOption[] = [
  // ==================== 1. กลุ่มเอกสารจากร้านค้า / ผู้จำหน่าย (Store / Vendor) ====================
  {
    id: 'delivery_order',
    group: 'store',
    title: 'ใบส่งของ / ใบส่งสินค้า (DO)',
    icon: '📦',
    description: 'ครอบคลุมบิลส่งของร้านค้าทุกชนิด ทั้งสินค้าทั่วไป, คอนกรีตผสมเสร็จ และบิล/ตั๋วชั่งต้นทางจากโรงโม่/ท่าทรายร้านค้า (เก็บน้ำหนักต้นทางลงช่อง 13. หนัก Gross, 14. เบา Tare, 15. สุทธิ Net)',
    badge: 'บิลร้านค้า • ช่อง 13-15',
    color: 'border-sky-500 bg-sky-50/60 text-sky-950'
  },
  {
    id: 'tax_invoice',
    group: 'store',
    title: 'ใบเสร็จรับเงิน / ใบกำกับภาษี',
    icon: '🧾',
    description: 'บิลเรียกเก็บเงิน/ภาษีจากร้านค้า เก็บยอดรวม VAT และสถานะชำระเงิน (โซน 5-6) เพื่อชนกับ DO หรือรับของสด',
    badge: 'บิลร้านค้า • โซน 5-6',
    color: 'border-amber-500 bg-amber-50/60 text-amber-950'
  },

  // ==================== 2. กลุ่มเอกสารของบริษัทเรา / หน้างาน (Company / Internal) ====================
  {
    id: 'purchase_order',
    group: 'company',
    title: 'ใบสั่งซื้อสินค้า (PO)',
    icon: '📝',
    description: 'เอกสารใบสั่งซื้อที่ฝ่ายจัดซื้อของบริษัทเราออกให้ร้านค้า (สกัดเลข PO เล่มที่/เลขที่, รายการสั่งซื้อ, โควตา)',
    badge: 'ของบริษัท • ฝ่ายจัดซื้อ',
    color: 'border-indigo-500 bg-indigo-50/60 text-indigo-950'
  },
  {
    id: 'dest_weighbridge',
    group: 'company',
    title: 'ตั๋วชั่งน้ำหนัก (ชั่งปลายทาง/บริษัท)',
    icon: '⚖️',
    description: 'ตั๋วชั่งตรวจรับที่ตราชั่งบริษัทเรา/หน้างาน เก็บลงช่อง 18. หนักเข้า, 19. เบาออก, 20. สุทธิ เพื่อชนกับ DO ร้านค้า',
    badge: 'ของบริษัท • ช่อง 18-20',
    color: 'border-teal-500 bg-teal-50/60 text-teal-950'
  },

  // ==================== 3. โหมดตรวจจับอัตโนมัติ ====================
  {
    id: 'auto',
    group: 'auto',
    title: 'ตรวจจับอัตโนมัติ (Auto-Detect)',
    icon: '🤖',
    description: 'ให้ Gemini AI ตรวจสอบและแยกแยะประเภทเอกสารให้อัตโนมัติจากรูปภาพ',
    badge: 'AI วิเคราะห์เอง',
    color: 'border-purple-500 bg-purple-50/60 text-purple-950'
  }
];

export const ScanModal: React.FC<ScanModalProps> = ({
  isOpen,
  defaultDocType = 'delivery_order',
  existingOrders = [],
  existingPOs = [],
  onInspectExistingOrder,
  onInspectExistingPO,
  onClose,
  onScanComplete,
  onPOScanComplete
}) => {
  const [selectedDocType, setSelectedDocType] = useState<ScanDocType>(defaultDocType);
  const [showAllDocTypes, setShowAllDocTypes] = useState(false);

  React.useEffect(() => {
    if (isOpen && defaultDocType) {
      setSelectedDocType(defaultDocType);
      setShowAllDocTypes(false);
    }
  }, [isOpen, defaultDocType]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusText, setScanStatusText] = useState('กำลังประมวลผล...');
  const [progressPercent, setProgressPercent] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Instant Stage-1 Duplicate Image Check before AI scan (checks both Orders and POs)
  const duplicateImageOrder = React.useMemo(() => {
    if (!previewImage || previewImage.length < 200) return null;
    return existingOrders.find(o => o.image && o.image === previewImage) || null;
  }, [previewImage, existingOrders]);

  const duplicateImagePO = React.useMemo(() => {
    if (!previewImage || previewImage.length < 200) return null;
    return existingPOs.find(p => p.image && p.image === previewImage) || null;
  }, [previewImage, existingPOs]);

  if (!isOpen) return null;

  const handleFileSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('กรุณาเลือกไฟล์รูปภาพ เช่น JPG, PNG, WEBP');
      return;
    }

    setErrorMsg(null);
    setSelectedFile(file);

    try {
      const optimizedBase64 = await optimizeImageForAI(file);
      setPreviewImage(optimizedBase64);
    } catch {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        setPreviewImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleTriggerAIScan = async () => {
    if (!previewImage) {
      setErrorMsg('กรุณาเลือกไฟล์ภาพบิลก่อนเริ่มสแกน');
      return;
    }

    setIsScanning(true);
    setErrorMsg(null);
    setProgressPercent(20);

    const currentDoc = DOC_TYPE_OPTIONS.find(d => d.id === selectedDocType);
    const docLabel = currentDoc ? currentDoc.title : 'เอกสาร';
    setScanStatusText(`กำลังเชื่อมต่อ Gemini 3.8 Flash Vision (โหมด: ${docLabel})...`);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 45000);

    try {
      setTimeout(() => {
        setProgressPercent(60);
        setScanStatusText(`Gemini AI กำลังอ่านและสกัดข้อมูลตามรูปแบบ ${docLabel}...`);
      }, 500);

      // When user explicitly scans a Purchase Order (PO), use the dedicated /api/scan-po endpoint for rich PO extraction
      if (selectedDocType === 'purchase_order' && onPOScanComplete) {
        const resp = await fetch('/api/scan-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            imageBase64: previewImage,
            mimeType: selectedFile?.type || 'image/png'
          })
        });
        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP ${resp.status}`);
        }

        const result = await resp.json();
        if (!result.success) {
          throw new Error(result.error || 'การอ่านใบสั่งซื้อล้มเหลว');
        }

        setProgressPercent(100);
        setScanStatusText('สกัดข้อมูลใบสั่งซื้อ (PO) สำเร็จ! กำลังเปิดหน้าต่างตรวจสอบ...');

        setTimeout(() => {
          setIsScanning(false);
          setPreviewImage(null);
          setSelectedFile(null);
          onClose();
          onPOScanComplete(result.data || {}, previewImage);
        }, 400);
        return;
      }

      const resp = await fetch('/api/scan-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          imageBase64: previewImage,
          mimeType: selectedFile?.type || 'image/png',
          targetDocType: selectedDocType
        })
      });
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${resp.status}`);
      }

      const result = await resp.json();

      setProgressPercent(100);
      setScanStatusText('สกัดข้อมูลสำเร็จ! กำลังเปิดหน้าต่างตรวจสอบความถูกต้อง...');

      setTimeout(() => {
        setIsScanning(false);
        setPreviewImage(null);
        setSelectedFile(null);
        onClose();

        // Enforce user's explicit selection over AI guess
        const enforcedDocType = (selectedDocType && selectedDocType !== 'auto')
          ? selectedDocType
          : (result.data?.docType || 'delivery_order');

        if (enforcedDocType === 'purchase_order' && onPOScanComplete) {
          const d = result.data || {};
          const mappedItems = Array.isArray(d.lineItems) && d.lineItems.length > 0
            ? d.lineItems.map((li: any, idx: number) => ({
                id: `poi-${Date.now()}-${idx}`,
                itemDescription: li.itemDescription || d.col11 || 'รายการสินค้า',
                specCode: li.specCode || '',
                orderedQty: Number(li.qty) || 1,
                unit: li.unit || d.col23 || 'หน่วย',
                unitPrice: Number(li.unitPrice) || 0,
                totalAmount: Number(li.totalAmount) || ((Number(li.qty) || 1) * (Number(li.unitPrice) || 0))
              }))
            : [{
                id: `poi-${Date.now()}-0`,
                itemDescription: d.col11 || 'รายการสินค้า',
                specCode: d.col12 || '',
                orderedQty: Number(d.col22) || 1,
                unit: d.col23 || 'หน่วย',
                unitPrice: Number(d.col24) || 0,
                totalAmount: Number(d.col29) || Number(d.col25) || 0
              }];

          onPOScanComplete({
            poNumber: d.col4 || d.col6 || '',
            orderDate: d.col7 || new Date().toISOString().split('T')[0],
            storeName: d.col8 || '',
            projectId: d.col2 || d.col9 || '',
            category: d.col3 || 'งานวัสดุก่อสร้าง',
            items: mappedItems,
            totalQty: mappedItems.reduce((s: number, i: any) => s + (Number(i.orderedQty) || 0), 0),
            totalAmount: Number(d.col29) || Number(d.col25) || mappedItems.reduce((s: number, i: any) => s + (Number(i.totalAmount) || 0), 0),
            creditTerms: d.col30 || 'เครดิต 30 วัน',
            deliveryLocation: d.col37 || '',
            orderedBy: d.col9 || '',
            notes: d.col38 || ''
          }, previewImage);
          return;
        }

        const payloadData = {
          ...(result.data || {}),
          docType: enforcedDocType
        };

        onScanComplete(payloadData, previewImage, result.storeSuggestion);
      }, 400);

    } catch (err: any) {
      console.error('Scan error:', err);
      setIsScanning(false);
      if (err.name === 'AbortError') {
        setErrorMsg('การสแกนใช้เวลานานเกินกำหนด (Timeout) เซิร์ฟเวอร์ AI อาจมีการตอบสนองช้าชั่วคราว กรุณากดลองใหม่อีกครั้ง');
      } else {
        setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อสแกนบิล โปรดลองใหม่อีกครั้ง');
      }
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const handleResetFile = () => {
    setSelectedFile(null);
    setPreviewImage(null);
    setErrorMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 relative my-8 animate-fadeIn">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isScanning}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-xl shadow-md shadow-blue-200">
            <Sparkles className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 flex-wrap">
              <span>
                สแกน{DOC_TYPE_OPTIONS.find(o => o.id === selectedDocType)?.title || 'เอกสาร'} ด้วย Gemini AI
              </span>
              <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                Targeted AI
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              เลือกประเภทเอกสารล่วงหน้าเพื่อเพิ่มความแม่นยำ หรือสลับประเภทเอกสารได้ทันที
            </p>
          </div>
        </div>

        {/* STEP 1: DOCUMENT TYPE SELECTOR (FOCUSED BY ACTIVE MENU OR EXPANDABLE TO ALL GROUPS) */}
        {!isScanning && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">1</span>
                <span>ประเภทเอกสารที่กำลังสแกน:</span>
              </label>
              <button
                type="button"
                onClick={() => setShowAllDocTypes(!showAllDocTypes)}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-200 transition cursor-pointer"
              >
                {showAllDocTypes ? 'ย่อตัวเลือกประเภทเอกสาร ▴' : 'เปลี่ยนประเภทเอกสารอื่น (แสดงครบทุกกลุ่ม) ▾'}
              </button>
            </div>

            {!showAllDocTypes ? (
              /* FOCUSED VIEW: Single dedicated card for the current menu (DO, dest_wb, tax_inv, or pos) */
              (() => {
                const activeOpt = DOC_TYPE_OPTIONS.find(o => o.id === selectedDocType) || DOC_TYPE_OPTIONS[0];
                return (
                  <div className={`p-3 rounded-xl border ${activeOpt.color} flex items-center justify-between gap-3`}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{activeOpt.icon}</span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm">{activeOpt.title}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-white/90 text-slate-800 font-bold border border-slate-200">
                            {activeOpt.badge}
                          </span>
                        </div>
                        <p className="text-[11px] opacity-85 mt-0.5 leading-snug">{activeOpt.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              /* EXPANDED VIEW: Full Group 1 (Store) & Group 2 (Company) */
              <div className="space-y-2.5 animate-fadeIn">
                {/* GROUP 1: 🏪 เอกสารจากร้านค้า / ผู้จำหน่าย (Vendor / Store Bills) */}
                <div className="p-2.5 rounded-xl border border-sky-200/80 bg-sky-50/30 space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold text-sky-900 flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-sky-600 text-white text-[10px]">กลุ่ม 1</span>
                      <span>🏪 เอกสารจากร้านค้า / ผู้จำหน่าย (บิลที่ร้านค้าส่งมาให้)</span>
                    </span>
                    <span className="text-[10px] text-sky-700 font-medium">น้ำหนักต้นทางลงช่อง 13-15 & โซน 5-6</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DOC_TYPE_OPTIONS.filter(o => o.group === 'store').map((opt) => {
                      const isSelected = selectedDocType === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedDocType(opt.id)}
                          className={`p-2.5 rounded-xl border text-left transition relative cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? `${opt.color} ring-2 ring-blue-600 shadow-xs`
                              : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-base">{opt.icon}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                                isSelected ? 'bg-white/90 text-slate-800' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {opt.badge}
                              </span>
                            </div>
                            <div className="font-bold text-xs leading-tight">{opt.title}</div>
                            <div className="text-[10px] text-slate-500 line-clamp-2 mt-1 leading-snug">
                              {opt.description}
                            </div>
                          </div>

                          {isSelected && (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-blue-600">
                              <Check className="w-3 h-3" />
                              <span>เลือกแล้ว</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* GROUP 2: 🏢 เอกสารของบริษัทเรา / หน้างาน (Company / Internal Documents) + Auto Detect */}
                <div className="p-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/30 space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold text-indigo-950 flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px]">กลุ่ม 2</span>
                      <span>🏢 เอกสารของบริษัทเรา / ตรวจรับหน้างาน (บริษัทออกเองหรือชั่งตรวจรับเอง)</span>
                    </span>
                    <span className="text-[10px] text-indigo-700 font-medium">PO & ชั่งปลายทางช่อง 18-20</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {DOC_TYPE_OPTIONS.filter(o => o.group === 'company' || o.group === 'auto').map((opt) => {
                      const isSelected = selectedDocType === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedDocType(opt.id)}
                          className={`p-2.5 rounded-xl border text-left transition relative cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? `${opt.color} ring-2 ring-indigo-600 shadow-xs`
                              : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-base">{opt.icon}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                                isSelected ? 'bg-white/90 text-slate-800' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {opt.badge}
                              </span>
                            </div>
                            <div className="font-bold text-xs leading-tight">{opt.title}</div>
                            <div className="text-[10px] text-slate-500 line-clamp-2 mt-1 leading-snug">
                              {opt.description}
                            </div>
                          </div>

                          {isSelected && (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-indigo-600">
                              <Check className="w-3 h-3" />
                              <span>เลือกแล้ว</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: UPLOAD DROP ZONE & PREVIEW */}
        {!isScanning ? (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">2</span>
                <span>ถ่ายภาพหรืออัปโหลดเอกสาร:</span>
              </label>
              <span className="text-[11px] text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                โหมด: {DOC_TYPE_OPTIONS.find(o => o.id === selectedDocType)?.title || 'ตรวจจับอัตโนมัติ'}
              </span>
            </div>

            {/* Quick Action Buttons: Camera vs File Picker */}
            {!previewImage && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => document.getElementById('camera-upload-input')?.click()}
                  className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-blue-200" />
                  <span>📷 ถ่ายภาพด้วยกล้อง</span>
                </button>
                <button
                  type="button"
                  onClick={() => document.getElementById('file-upload-input')?.click()}
                  className="py-2.5 px-3 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-slate-500" />
                  <span>📁 เลือกไฟล์รูปภาพ</span>
                </button>
              </div>
            )}

            {!previewImage ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload-input')?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-2 ${
                  isDragging 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-blue-300 bg-blue-50/20 hover:bg-blue-50/50 hover:border-blue-400'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shadow-xs">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-800">
                    หรือลากรูปภาพเอกสารมาวางที่นี่
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    รองรับไฟล์ภาพ JPG, PNG, WEBP (ความละเอียดชัดเจน ตัวหนังสือไม่เบลอ)
                  </div>
                </div>
                {/* Standard file picker */}
                <input
                  type="file"
                  id="file-upload-input"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
                {/* Mobile camera capture */}
                <input
                  type="file"
                  id="camera-upload-input"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
              </div>
            ) : (
              /* Selected Image Preview Box */
              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileImage className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-slate-800 truncate max-w-xs">
                      {selectedFile?.name || 'ภาพเอกสาร'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetFile}
                    className="text-xs text-rose-600 hover:underline cursor-pointer"
                  >
                    เปลี่ยนรูปภาพ
                  </button>
                </div>

                <div className="max-h-48 rounded-lg overflow-hidden border border-slate-200 bg-white flex items-center justify-center">
                  <img
                    src={previewImage}
                    alt="Preview"
                    className="max-h-48 object-contain"
                  />
                </div>

                {/* Instant Stage-1 Duplicate Block or Primary Scan Trigger Button */}
                {duplicateImageOrder || duplicateImagePO ? (
                  <div className="p-3.5 bg-rose-50 border-2 border-rose-500 rounded-xl space-y-2.5 text-rose-950 animate-fadeIn">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold text-rose-900">
                          🚫 บล็อกการนำเข้า: รูปเอกสารนี้มีอยู่ในระบบแล้ว! (ไม่อนุญาตให้สแกนซ้ำ)
                        </div>
                        {duplicateImageOrder ? (
                          <p className="text-[11px] text-rose-800 mt-0.5">
                            ตรงกับรายการ <span className="font-mono font-bold">{duplicateImageOrder.col1}</span> • เลขที่บิล <span className="font-mono font-bold">{duplicateImageOrder.col6 || duplicateImageOrder.col17 || '-'}</span> • ร้าน <span className="font-semibold">{duplicateImageOrder.col8}</span>
                          </p>
                        ) : duplicateImagePO ? (
                          <p className="text-[11px] text-rose-800 mt-0.5">
                            ตรงกับใบสั่งซื้อเลขที่ <span className="font-mono font-bold">{duplicateImagePO.poNumber}</span> • ร้าน <span className="font-semibold">{duplicateImagePO.storeName}</span> (ยอด ฿{duplicateImagePO.totalAmount.toLocaleString()})
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleResetFile}
                        className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                      >
                        📁 เลือกรูปเอกสารใบอื่นแทน
                      </button>
                      {duplicateImageOrder && onInspectExistingOrder && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onInspectExistingOrder(duplicateImageOrder);
                          }}
                          className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          👁️ เปิดดูบิลเดิม ({duplicateImageOrder.col1})
                        </button>
                      )}
                      {duplicateImagePO && onInspectExistingPO && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onInspectExistingPO(duplicateImagePO);
                          }}
                          className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          👁️ เปิดดู PO เดิม ({duplicateImagePO.poNumber})
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleTriggerAIScan}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>
                      เริ่มสแกนด้วย AI (โหมด: {DOC_TYPE_OPTIONS.find(d => d.id === selectedDocType)?.title})
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Error Message with Retry */}
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-3 animate-fadeIn">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
                {previewImage && (
                  <button
                    type="button"
                    onClick={handleTriggerAIScan}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer shadow-2xs flex items-center gap-1"
                  >
                    <span>🔄 ลองใหม่อีกครั้ง</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Scanning In-Progress Visualizer */
          <div className="space-y-3 py-4">
            <div className="relative max-h-60 rounded-xl overflow-hidden border border-slate-300 bg-slate-950 flex items-center justify-center">
              {previewImage && (
                <img
                  src={previewImage}
                  alt="เอกสารกำลังสแกน"
                  className="max-h-60 object-contain opacity-80"
                />
              )}
              {/* Laser Scanning Line Animation */}
              <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_15px_#3b82f6] animate-scan-line"></div>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-blue-900 font-semibold">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>{scanStatusText}</span>
                </span>
                <span className="font-mono text-blue-700">{progressPercent}%</span>
              </div>
              <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
