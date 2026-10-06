import React, { useState, useEffect, useRef } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  RotateCw, 
  Crop, 
  Check, 
  X, 
  FileText,
  Undo2
} from 'lucide-react';

interface ImageDocViewerProps {
  image: string | null;
  title?: string;
  onImageChange?: (newImageBase64: string) => void;
}

interface CropBox {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage 0-100
  height: number; // percentage 0-100
}

const getImageSource = (image: string | null) => {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    if (!['drive.google.com', 'docs.google.com'].includes(url.hostname)) return image;
    const fileId = url.pathname.match(/\/(?:file\/)?d\/([^/]+)/)?.[1] || url.searchParams.get('id');
    return fileId && /^[a-zA-Z0-9_-]{5,200}$/.test(fileId)
      ? `/api/drive/image/${encodeURIComponent(fileId)}`
      : image;
  } catch {
    return image;
  }
};

export const ImageDocViewer: React.FC<ImageDocViewerProps> = ({
  image,
  title = 'ภาพเอกสารต้นฉบับ',
  onImageChange
}) => {
  const [currentImage, setCurrentImage] = useState<string | null>(image);
  const [originalImage, setOriginalImage] = useState<string | null>(image);
  const [fallbackImageSource, setFallbackImageSource] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isCropping, setIsCropping] = useState(false);
  const [cropBox, setCropBox] = useState<CropBox>({ x: 5, y: 5, width: 90, height: 90 });
  
  // Track dragging in crop mode
  const [dragState, setDragState] = useState<{
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
    startX: number;
    startY: number;
    initialBox: CropBox;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const driveImageSource = getImageSource(currentImage);
  const displayImageSource = fallbackImageSource || driveImageSource;

  // Sync when prop image changes
  useEffect(() => {
    setCurrentImage(image);
    setOriginalImage(image);
    setFallbackImageSource(null);
    setImageLoadError(false);
    setZoom(1);
    setIsCropping(false);
  }, [image]);

  useEffect(() => {
    setFallbackImageSource(null);
    setImageLoadError(false);
  }, [currentImage]);

  // Rotate 90 degrees clockwise (physically alters canvas image data)
  const handleRotateCw = () => {
    if (!currentImage) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotatedBase64 = canvas.toDataURL('image/jpeg', 0.92);
      setCurrentImage(rotatedBase64);
      onImageChange?.(rotatedBase64);
    };
    img.src = displayImageSource || currentImage;
  };

  // Start Crop Mode
  const handleStartCrop = () => {
    setZoom(1); // Reset zoom to 1:1 for accurate cropping
    setCropBox({ x: 5, y: 5, width: 90, height: 90 });
    setIsCropping(true);
  };

  // Apply Crop to Canvas
  const handleApplyCrop = () => {
    if (!currentImage) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;

      const sx = Math.max(0, (cropBox.x / 100) * naturalWidth);
      const sy = Math.max(0, (cropBox.y / 100) * naturalHeight);
      const sWidth = Math.min(naturalWidth - sx, (cropBox.width / 100) * naturalWidth);
      const sHeight = Math.min(naturalHeight - sy, (cropBox.height / 100) * naturalHeight);

      canvas.width = Math.max(10, Math.round(sWidth));
      canvas.height = Math.max(10, Math.round(sHeight));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);
      
      setCurrentImage(croppedBase64);
      setIsCropping(false);
      onImageChange?.(croppedBase64);
    };
    img.src = displayImageSource || currentImage;
  };

  // Cancel Crop Mode
  const handleCancelCrop = () => {
    setIsCropping(false);
  };

  // Reset back to original image
  const handleResetOriginal = () => {
    if (originalImage) {
      setCurrentImage(originalImage);
      onImageChange?.(originalImage);
    }
    setZoom(1);
    setIsCropping(false);
  };

  // Drag handling for crop box
  const handleMouseDown = (e: React.MouseEvent, type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e') => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      type,
      startX: e.clientX,
      startY: e.clientY,
      initialBox: { ...cropBox }
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const deltaXPercent = ((e.clientX - dragState.startX) / rect.width) * 100;
    const deltaYPercent = ((e.clientY - dragState.startY) / rect.height) * 100;

    let { x, y, width, height } = dragState.initialBox;

    if (dragState.type === 'move') {
      x = Math.max(0, Math.min(100 - width, x + deltaXPercent));
      y = Math.max(0, Math.min(100 - height, y + deltaYPercent));
    } else if (dragState.type === 'se') {
      width = Math.max(10, Math.min(100 - x, width + deltaXPercent));
      height = Math.max(10, Math.min(100 - y, height + deltaYPercent));
    } else if (dragState.type === 'nw') {
      const newX = Math.max(0, Math.min(x + width - 10, x + deltaXPercent));
      const newY = Math.max(0, Math.min(y + height - 10, y + deltaYPercent));
      width = width + (x - newX);
      height = height + (y - newY);
      x = newX;
      y = newY;
    } else if (dragState.type === 'ne') {
      const newY = Math.max(0, Math.min(y + height - 10, y + deltaYPercent));
      width = Math.max(10, Math.min(100 - x, width + deltaXPercent));
      height = height + (y - newY);
      y = newY;
    } else if (dragState.type === 'sw') {
      const newX = Math.max(0, Math.min(x + width - 10, x + deltaXPercent));
      width = width + (x - newX);
      height = Math.max(10, Math.min(100 - y, height + deltaYPercent));
      x = newX;
    }

    setCropBox({ x, y, width, height });
  };

  const handleMouseUp = () => {
    setDragState(null);
  };

  const hasModifications = currentImage !== originalImage;

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      
      {/* Top Controls Toolbar */}
      <div className="flex items-center justify-between text-xs text-slate-300 mb-2 bg-slate-900 p-2 rounded-lg border border-slate-800 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 font-medium">
          <FileText className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate max-w-[140px] sm:max-w-none">{title}</span>
          {hasModifications && (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded font-semibold">
              แก้ไขแล้ว
            </span>
          )}
        </div>

        {/* Toolbar Action Buttons */}
        <div className="flex items-center space-x-1">
          
          {/* CROP MODE BUTTONS */}
          {isCropping ? (
            <div className="flex items-center gap-1 bg-blue-950/80 p-0.5 rounded-lg border border-blue-600">
              <button
                type="button"
                onClick={handleApplyCrop}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs flex items-center gap-1 shadow-xs transition cursor-pointer"
                title="ตัดภาพตามกรอบที่เลือก"
              >
                <Check className="w-3.5 h-3.5" />
                <span>ใช้การตัดขอบนี้</span>
              </button>
              <button
                type="button"
                onClick={handleCancelCrop}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs flex items-center gap-1 transition cursor-pointer"
                title="ยกเลิกครอป"
              >
                <X className="w-3.5 h-3.5" />
                <span>ยกเลิก</span>
              </button>
            </div>
          ) : (
            <>
              {/* Rotate 90 deg Clockwise */}
              <button
                type="button"
                onClick={handleRotateCw}
                disabled={!currentImage}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded text-xs flex items-center gap-1 transition cursor-pointer"
                title="หมุนตามเข็มนาฬิกา 90°"
              >
                <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">หมุน 90°</span>
              </button>

              {/* Enter Crop Mode */}
              <button
                type="button"
                onClick={handleStartCrop}
                disabled={!currentImage}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded text-xs flex items-center gap-1 transition cursor-pointer"
                title="ตัดขอบ / ครอปภาพส่วนเกินออก"
              >
                <Crop className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">ครอปภาพ</span>
              </button>

              <div className="h-4 w-px bg-slate-700 mx-1" />

              {/* Zoom Controls */}
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(3, z + 0.2))}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-white text-xs cursor-pointer"
                title="ขยายภาพ"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(0.5, z - 0.2))}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-white text-xs cursor-pointer"
                title="ย่อภาพ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-white text-xs cursor-pointer"
                title="ซูม 100%"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* Reset to Original Image if edited */}
              {hasModifications && (
                <button
                  type="button"
                  onClick={handleResetOriginal}
                  className="px-2 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-700 rounded text-xs flex items-center gap-1 transition cursor-pointer"
                  title="คืนค่าภาพต้นฉบับก่อนหมุน/ครอป"
                >
                  <Undo2 className="w-3 h-3" />
                  <span className="hidden sm:inline">คืนค่าเดิม</span>
                </button>
              )}
            </>
          )}

        </div>
      </div>

      {/* Main Image Display Area */}
      <div 
        ref={containerRef}
        onMouseMove={isCropping ? handleMouseMove : undefined}
        onMouseUp={isCropping ? handleMouseUp : undefined}
        className="flex-1 overflow-auto border border-slate-800 rounded-xl bg-slate-900/80 flex items-center justify-center p-2 relative"
      >
        {currentImage ? (
          <div className="relative inline-block max-h-full max-w-full">
            {imageLoadError ? (
              <div className="px-6 py-8 text-center text-amber-200 text-xs" role="alert">
                <FileText className="w-8 h-8 mx-auto mb-2 text-amber-300" />
                <p className="font-semibold">โหลดภาพเอกสารไม่สำเร็จ</p>
                <p className="mt-1 text-slate-400">ตรวจสอบการเชื่อมต่อหรือสิทธิ์เข้าถึง Google Drive</p>
              </div>
            ) : (
              <img
                ref={imageRef}
                src={displayImageSource}
                alt="ภาพเอกสารต้นฉบับ"
                onLoad={() => setImageLoadError(false)}
                onError={() => {
                  if (
                    driveImageSource?.startsWith('/api/drive/image/') &&
                    !fallbackImageSource &&
                    currentImage !== driveImageSource
                  ) {
                    setFallbackImageSource(currentImage);
                    return;
                  }
                  setImageLoadError(true);
                }}
                style={{ transform: !isCropping ? `scale(${zoom})` : 'none' }}
                className="max-h-[75vh] max-w-full object-contain transition-transform duration-150 rounded-md shadow-2xl block"
              />
            )}

            {/* Interactive Crop Overlay */}
            {isCropping && (
              <div className="absolute inset-0 pointer-events-auto">
                
                {/* 4 Dimmed Outside Regions */}
                {/* Top */}
                <div 
                  className="absolute top-0 left-0 right-0 bg-black/60 pointer-events-none"
                  style={{ height: `${cropBox.y}%` }}
                />
                {/* Bottom */}
                <div 
                  className="absolute left-0 right-0 bottom-0 bg-black/60 pointer-events-none"
                  style={{ top: `${cropBox.y + cropBox.height}%` }}
                />
                {/* Left */}
                <div 
                  className="absolute bg-black/60 pointer-events-none"
                  style={{ 
                    top: `${cropBox.y}%`, 
                    height: `${cropBox.height}%`, 
                    left: 0, 
                    width: `${cropBox.x}%` 
                  }}
                />
                {/* Right */}
                <div 
                  className="absolute bg-black/60 pointer-events-none"
                  style={{ 
                    top: `${cropBox.y}%`, 
                    height: `${cropBox.height}%`, 
                    left: `${cropBox.x + cropBox.width}%`, 
                    right: 0 
                  }}
                />

                {/* The Crop Selection Box */}
                <div
                  style={{
                    left: `${cropBox.x}%`,
                    top: `${cropBox.y}%`,
                    width: `${cropBox.width}%`,
                    height: `${cropBox.height}%`
                  }}
                  onMouseDown={(e) => handleMouseDown(e, 'move')}
                  className="absolute border-2 border-dashed border-blue-400 cursor-move shadow-sm group ring-1 ring-blue-500/50"
                >
                  {/* Grid Lines inside crop box */}
                  <div className="w-full h-full grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                    <div className="border-r border-b border-white/50" />
                    <div className="border-r border-b border-white/50" />
                    <div className="border-b border-white/50" />
                    <div className="border-r border-b border-white/50" />
                    <div className="border-r border-b border-white/50" />
                    <div className="border-b border-white/50" />
                    <div className="border-r border-white/50" />
                    <div className="border-r border-white/50" />
                    <div />
                  </div>

                  {/* Corner Handles */}
                  {/* Top-Left */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'nw')}
                    className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-blue-600 border border-white rounded-xs cursor-nwse-resize shadow-md"
                  />
                  {/* Top-Right */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'ne')}
                    className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border border-white rounded-xs cursor-nesw-resize shadow-md"
                  />
                  {/* Bottom-Left */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'sw')}
                    className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-blue-600 border border-white rounded-xs cursor-nesw-resize shadow-md"
                  />
                  {/* Bottom-Right */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'se')}
                    className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border border-white rounded-xs cursor-nwse-resize shadow-md"
                  />

                  {/* Center Hint Badge */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-600/90 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none shadow-md font-semibold whitespace-nowrap">
                    ลากเพื่อปรับขนาด / เลื่อนกรอบ
                  </div>
                </div>

              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-slate-500 text-xs">
            <p className="text-slate-400">ไม่มีภาพเอกสารแนบ</p>
            <p className="text-[11px] text-slate-600 mt-1">(ป้อนข้อมูลด้วยตนเอง)</p>
          </div>
        )}
      </div>

      {/* Bottom Hint Banner when in crop mode */}
      {isCropping && (
        <div className="mt-1.5 px-3 py-1.5 bg-blue-900/60 border border-blue-700/60 rounded-lg flex items-center justify-between text-[11px] text-blue-200">
          <span>💡 ลากมุมเพื่อตัดขอบโต๊ะหรือส่วนเกินที่ไม่เกี่ยวข้องออก</span>
          <span className="font-semibold text-white">กด "ใช้การตัดขอบนี้" เมื่อพอใจ</span>
        </div>
      )}

    </div>
  );
};
