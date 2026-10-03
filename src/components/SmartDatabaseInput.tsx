import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Sparkles, Database } from 'lucide-react';
import { CatalogOption, analyzeDatabaseLookup } from '../utils/dbLookup';

interface SmartDatabaseInputProps {
  id?: string;
  value: string;
  onChange: (newValue: string) => void;
  onSelectOption?: (option: CatalogOption) => void;
  options: CatalogOption[];
  placeholder?: string;
  required?: boolean;
  className?: string;
  isStoreField?: boolean;
  showStatusBadge?: boolean;
  fieldLabel?: string;
}

export const SmartDatabaseInput: React.FC<SmartDatabaseInputProps> = ({
  id,
  value,
  onChange,
  onSelectOption,
  options,
  placeholder,
  required = false,
  className = '',
  isStoreField = false,
  showStatusBadge = true,
  fieldLabel = 'ข้อมูล'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAllMode, setShowAllMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const analysis = useMemo(
    () => analyzeDatabaseLookup(value || '', options, isStoreField),
    [value, options, isStoreField]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handlePick = (opt: CatalogOption) => {
    onChange(opt.value);
    if (onSelectOption) {
      onSelectOption(opt);
    }
    setIsOpen(false);
  };

  const displayedOptions = showAllMode || analysis.filteredOptions.length === 0
    ? options.slice(0, 40)
    : analysis.filteredOptions;

  const trimmedVal = (value || '').trim();

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          id={id}
          type="text"
          required={required}
          value={value || ''}
          onFocus={() => {
            if (options.length > 0) setIsOpen(true);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setShowAllMode(false);
            if (options.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className={`${className} ${options.length > 0 ? 'pr-7' : ''}`}
        />
        {options.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsOpen(prev => !prev);
            }}
            className="absolute right-1.5 text-slate-400 hover:text-blue-600 p-1 rounded transition cursor-pointer"
            title={`คลิกเพื่อเลือก${fieldLabel}จากฐานข้อมูล (${options.length} รายการ)`}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180 text-blue-600' : ''}`} />
          </button>
        )}
      </div>

      {/* Dropdown Menu from Database */}
      {isOpen && options.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-300 rounded-xl shadow-xl max-h-60 flex flex-col overflow-hidden text-xs animate-fadeIn">
          {/* Header Bar */}
          <div className="px-2.5 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2 text-[10px]">
            <span className="font-bold text-slate-700 flex items-center gap-1 truncate">
              <Database className="w-3 h-3 text-blue-600 shrink-0" />
              <span>
                {analysis.filteredOptions.length > 0 && !showAllMode
                  ? `ตัวเลือกในฐานข้อมูลที่ตรง/คล้าย (${analysis.filteredOptions.length})`
                  : `รายการในฐานข้อมูลทั้งหมด (${options.length})`}
              </span>
            </span>
            {trimmedVal.length > 0 && analysis.filteredOptions.length < options.length && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowAllMode(prev => !prev);
                }}
                className="text-blue-700 hover:text-blue-900 font-bold underline cursor-pointer shrink-0"
              >
                {showAllMode ? `กรองตามที่พิมพ์ (${analysis.filteredOptions.length})` : `ดูทั้งหมด (${options.length})`}
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="overflow-y-auto divide-y divide-slate-100 max-h-48">
            {displayedOptions.map((opt, i) => {
              const isSelected = opt.value.trim() === trimmedVal;
              const isFuzzy = analysis.fuzzySimilarMatches.some(f => f.value === opt.value);
              return (
                <button
                  key={`${opt.value}-${i}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePick(opt);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-50/90 text-emerald-950 font-bold'
                      : isFuzzy
                      ? 'bg-amber-50/70 hover:bg-amber-100/80 text-slate-900'
                      : 'hover:bg-blue-50/80 text-slate-800'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                      <span className="truncate font-medium">{opt.value}</span>
                      {isFuzzy && !isSelected && (
                        <span className="px-1.5 py-0.2 bg-amber-200/80 text-amber-900 rounded text-[9px] font-bold shrink-0">
                          คล้ายที่พิมพ์
                        </span>
                      )}
                    </div>
                    {opt.subLabel && (
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">{opt.subLabel}</div>
                    )}
                  </div>
                  {opt.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                      {opt.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer helper reminding user they can keep their typed value as a new entry */}
          {trimmedVal && !analysis.exactMatch && (
            <div className="px-2.5 py-1.5 bg-indigo-50/70 border-t border-indigo-100 text-[10px] text-indigo-900 flex items-center justify-between gap-2">
              <span className="truncate">
                ✨ หากไม่เลือก ระบบจะใช้ <strong>"{trimmedVal}"</strong> เป็นรายการใหม่
              </span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsOpen(false);
                }}
                className="px-2 py-0.5 bg-white hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded font-semibold shrink-0 cursor-pointer"
              >
                ใช้ตามที่พิมพ์
              </button>
            </div>
          )}
        </div>
      )}

      {/* Real-time Fuzzy Similarity / Typo / Spacing Warning Pill */}
      {trimmedVal && !analysis.exactMatch && analysis.fuzzySimilarMatches.length > 0 && (
        <div className="mt-1 p-1.5 rounded-lg bg-amber-50/90 border border-amber-300 text-[10px] text-amber-950 space-y-1">
          <div className="flex items-center justify-between gap-1 flex-wrap">
            <span className="font-bold flex items-center gap-1 text-amber-900">
              <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
              <span>พบข้อมูลคล้ายกันในฐานข้อมูล (ป้องกันพิมพ์ผิด/วรรคผิด):</span>
            </span>
            <span className="text-[9px] text-amber-700">หรือไม่แก้เพื่อบันทึกเป็นรายการใหม่</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {analysis.fuzzySimilarMatches.map((match, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handlePick(match)}
                className="px-2 py-0.5 bg-white hover:bg-amber-100 text-amber-950 border border-amber-400 rounded-md font-bold text-[10px] shadow-2xs transition cursor-pointer flex items-center gap-1"
                title="คลิกเพื่อเปลี่ยนไปใช้ชื่อที่มีอยู่แล้วในฐานข้อมูล"
              >
                <span>🔄 ใช้ "{match.value}"</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Subtle Exact-Match or New-Item Status Indicator */}
      {showStatusBadge && trimmedVal && (
        <div className="mt-0.5 flex items-center justify-between text-[10px]">
          {analysis.exactMatch ? (
            <span className="text-emerald-700 font-medium flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-600 shrink-0" />
              <span>ตรงกับฐานข้อมูลเดิม (ไม่สร้างข้อมูลซ้ำ)</span>
            </span>
          ) : analysis.fuzzySimilarMatches.length === 0 ? (
            <span className="text-slate-500 flex items-center gap-1">
              <span>✨ รายการใหม่ในระบบ (บันทึกตามนี้ได้เลยหากถูกต้อง)</span>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
};
