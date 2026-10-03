import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Upload, 
  Loader2, 
  FileText,
  AlertCircle
} from 'lucide-react';
import { PurchaseOrder } from '../types';

interface POScanModalProps {
  isOpen: boolean;
  existingPOs?: PurchaseOrder[];
  onClose: () => void;
  onScanComplete: (poData: Partial<PurchaseOrder>, imageBase64: string) => void;
}

// Helper to scale down oversized mobile photos to keep payloads light and crisp
const optimizeImageForAI = (file: File, maxDim = 1800, quality = 0.85): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawData = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(rawData);
        }
      };
      img.onerror = () => resolve(rawData);
      img.src = rawData;
    };
    reader.readAsDataURL(file);
  });
};

export const POScanModal: React.FC<POScanModalProps> = ({
  isOpen,
  existingPOs = [],
  onClose,
  onScanComplete
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const duplicateImagePO = React.useMemo(() => {
    if (!previewUrl || previewUrl.length < 200) return null;
    return existingPOs.find(p => p.image && p.image === previewUrl) || null;
  }, [previewUrl, existingPOs]);

  if (!isOpen) return null;

  const handleFileChange = async (file: File) => {
    if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
      setScanError('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP) หรือเอกสาร');
      return;
    }

    setSelectedFile(file);
    setScanError(null);

    try {
      const optimizedBase64 = await optimizeImageForAI(file);
      setPreviewUrl(optimizedBase64);
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleStartScan = async () => {
    if (!previewUrl) {
      setScanError('กรุณาเลือกไฟล์ภาพใบสั่งซื้อก่อนเริ่มสแกน');
      return;
    }

    setIsScanning(true);
    setScanError(null);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 32000);

    try {
      const response = await fetch('/api/scan-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          imageBase64: previewUrl,
          mimeType: selectedFile?.type || 'image/png'
        })
      });
      clearTimeout(timeoutId);

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'การอ่านใบสั่งซื้อล้มเหลว');
      }

      onScanComplete(result.data, previewUrl);
      onClose();
    } catch (err: any) {
      console.error('Scan error:', err);
      if (err.name === 'AbortError') {
        setScanError('การสแกนใบสั่งซื้อใช้เวลานานเกินกำหนด (Timeout) กรุณากดลองใหม่อีกครั้ง');
      } else {
        setScanError(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Gemini AI');
      }
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-8 overflow-hidden flex flex-col animate-fadeIn border border-slate-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5 text-blue-100" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>สแกนใบสั่งซื้อด้วย AI (PO Vision)</span>
              </h2>
              <p className="text-xs text-slate-300">
                อ่านเลขที่ PO, ร้านค้า, รายการสินค้า, ปริมาณ และยอดเงินอัตโนมัติ
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

        {/* Content */}
        <div className="p-6 space-y-4">
          
          {/* File Upload Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-6 text-center transition flex flex-col items-center justify-center cursor-pointer ${
              dragOver 
                ? 'border-blue-500 bg-blue-50/50' 
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/60'
            }`}
            onClick={() => document.getElementById('po-file-input')?.click()}
          >
            <input
              id="po-file-input"
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileChange(e.target.files[0]);
                }
              }}
            />

            {previewUrl ? (
              <div className="space-y-3 w-full">
                <div className="max-h-60 overflow-hidden rounded-xl border border-slate-200 shadow-2xs mx-auto max-w-sm">
                  <img
                    src={previewUrl}
                    alt="PO Preview"
                    className="w-full h-auto object-contain"
                  />
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900">{selectedFile?.name}</span> (คลิกเพื่อเปลี่ยนไฟล์)
                </div>
              </div>
            ) : (
              <div className="space-y-2 py-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto shadow-2xs">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">
                    ลากไฟล์รูปภาพใบสั่งซื้อมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
                  </p>
                  <p className="text-xs text-slate-500">
                    รองรับไฟล์ภาพถ่าย, สแกนเอกสาร PO (.png, .jpg, .webp)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Duplicate PO Image Hard Block */}
          {duplicateImagePO && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-500 rounded-xl space-y-2 text-rose-950 animate-fadeIn">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-rose-900">
                    🚫 บล็อกการนำเข้า: รูปใบสั่งซื้อ (PO) นี้มีอยู่ในระบบแล้ว!
                  </div>
                  <p className="text-[11px] text-rose-800 mt-0.5">
                    ตรงกับใบสั่งซื้อเลขที่ <span className="font-mono font-bold">{duplicateImagePO.poNumber}</span> • ร้าน <span className="font-semibold">{duplicateImagePO.storeName}</span> (ยอด ฿{duplicateImagePO.totalAmount.toLocaleString()})
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message with Retry */}
          {scanError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{scanError}</span>
              </div>
              {previewUrl && (
                <button
                  type="button"
                  onClick={handleStartScan}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer shadow-2xs flex items-center gap-1"
                >
                  <span>🔄 ลองใหม่อีกครั้ง</span>
                </button>
              )}
            </div>
          )}

          {/* Action Button */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={!previewUrl || isScanning || Boolean(duplicateImagePO)}
              onClick={handleStartScan}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition cursor-pointer"
            >
              {duplicateImagePO ? (
                <span>🚫 บล็อก: รูป PO นี้ถูกนำเข้าแล้ว</span>
              ) : isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Gemini กำลังอ่านใบสั่งซื้อ...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-blue-200" />
                  <span>เริ่มสแกนใบสั่งซื้อ</span>
                </>
              )}
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
