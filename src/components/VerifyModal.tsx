import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Save, 
  Sparkles, 
  FileText,
  Truck,
  Boxes,
  Receipt,
  Scale,
  Layers,
  Eye,
  EyeOff,
  AlertTriangle,
  ArrowRight,
  Info,
  Link2,
  PenTool,
  MessageSquare,
  SlidersHorizontal,
  Upload,
  Download,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle
} from 'lucide-react';
import {
  OrderRecord,
  StoreMerchant,
  DocumentType,
  PurchaseOrder,
  ProjectRecord,
  LineBillInboxItem,
  OrderItemDetail,
  DocumentSaveProgressStepId,
  DocumentSaveProgressStatus,
  DocumentSaveProgressUpdate
} from '../types';
import { ImageDocViewer } from './ImageDocViewer';
import { getOccupiedOriginWeighbridgeDoIds, isDeliveryOrderPairingCandidate, isExactDocNumberReference } from '../utils/poReconciliation';
import { buildDatabaseCatalog, CatalogOption, inferMaterialCategory } from '../utils/dbLookup';
import { SmartDatabaseInput } from './SmartDatabaseInput';
import { remapLineBillToDocType, convertOrderDraftToPODraft, rescanBillForTargetDocType } from '../utils/lineBillRemapper';
import { optimizeImageForAI } from '../utils/imageProcessing';

type AIRescanZone = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const SAVE_PROGRESS_STEPS: Array<{ id: DocumentSaveProgressStepId; title: string }> = [
  { id: 'validation', title: 'ตรวจข้อมูลเอกสารและข้อมูลอ้างอิง' },
  { id: 'drive_check', title: 'ทดสอบการเชื่อมต่อ Google Drive' },
  { id: 'prepare_files', title: 'เตรียมรูปเอกสารจาก LINE' },
  { id: 'duplicate_check', title: 'ตรวจเอกสารซ้ำในทะเบียน' },
  { id: 'reserve_tr', title: 'จัดคิว DO และสำรองเลข TR' },
  { id: 'move_files', title: 'ย้ายรูปไปยังโฟลเดอร์เอกสาร' },
  { id: 'save_record', title: 'บันทึกทะเบียนและยืนยันรายการ LINE' }
];

interface SaveProgressStep {
  id: DocumentSaveProgressStepId;
  title: string;
  status: DocumentSaveProgressStatus;
  detail?: string;
}

const AI_RESCAN_ZONE_FIELDS: Record<AIRescanZone, Array<keyof OrderRecord>> = {
  1: ['col3', 'col4', 'col6'],
  2: ['col7', 'col8', 'col9', 'col10', 'col11', 'col12'],
  3: ['col13', 'col14'],
  4: ['col16', 'col17', 'col18', 'col19'],
  5: ['col22', 'col23', 'col24', 'col26', 'col27'],
  6: ['col30', 'col31', 'col33', 'col35'],
  7: ['col37', 'col38']
};

const AI_RESCAN_FIELD_LABELS: Partial<Record<keyof OrderRecord, string>> = {
  col3: 'หมวดหมู่',
  col4: 'เลขที่ PO',
  col6: 'เลขที่ DO / เอกสาร',
  col7: 'วันที่เอกสาร',
  col8: 'ร้านค้า / ผู้จำหน่าย',
  col9: 'ผู้ขับ / ผู้ส่ง',
  col10: 'ทะเบียนรถ',
  col11: 'รายการสินค้า',
  col12: 'สเปกสินค้า',
  col13: 'น้ำหนัก Gross ต้นทาง',
  col14: 'น้ำหนัก Tare ต้นทาง',
  col16: 'วันที่ชั่งปลายทาง',
  col17: 'เลขที่ตั๋วชั่งปลายทาง',
  col18: 'น้ำหนัก Gross ปลายทาง',
  col19: 'น้ำหนัก Tare ปลายทาง',
  col22: 'ปริมาณ / จำนวน',
  col23: 'หน่วยนับ',
  col24: 'ราคาต่อหน่วย',
  col26: 'ประเภทรถ',
  col27: 'ค่าขนส่งต่อหน่วย',
  col30: 'รูปแบบการชำระ',
  col31: 'ชำระให้ผู้จำหน่าย',
  col33: 'ชำระค่าขนส่ง',
  col35: 'ยอดชำระรวม',
  col37: 'สถานที่ส่งมอบ',
  col38: 'หมายเหตุ'
};

interface VerifyModalProps {
  isOpen: boolean;
  orderData: Partial<OrderRecord> | null;
  billImage: string | null;
  storeSuggestion?: Partial<StoreMerchant>;
  stores: StoreMerchant[];
  projects?: ProjectRecord[];
  pos?: PurchaseOrder[];
  existingOrders?: OrderRecord[];
  lineInboxItems?: LineBillInboxItem[];
  onClose: () => void;
  onSaveOrder: (
    order: OrderRecord,
    storeToSave?: StoreMerchant,
    onProgress?: (update: DocumentSaveProgressUpdate) => void
  ) => boolean | Promise<boolean>;
  onCorrectAndPairOriginWeighbridge?: (ticket: OrderRecord, doOrderId: string) => Promise<boolean>;
  onSwitchToPO?: (draftPO: Partial<PurchaseOrder>) => void;
  onRecoverLineImage?: (orderId: string) => Promise<{
    image: string;
    driveFileId: string;
    driveFolderId?: string;
  }>;
}

export const VerifyModal: React.FC<VerifyModalProps> = ({
  isOpen,
  orderData,
  billImage,
  storeSuggestion,
  stores,
  projects = [],
  pos = [],
  existingOrders = [],
  lineInboxItems = [],
  onClose,
  onSaveOrder,
  onCorrectAndPairOriginWeighbridge,
  onSwitchToPO,
  onRecoverLineImage
}) => {
  const [currentImage, setCurrentImage] = useState<string | null>(billImage || null);
  const [form, setForm] = useState<Partial<OrderRecord>>({});
  const [saveToStoreDirectory, setSaveToStoreDirectory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showSaveProgress, setShowSaveProgress] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SaveProgressStep[]>([]);
  const [selectedDocType, setSelectedDocType] = useState<DocumentType>('delivery_order');
  const [showAllCols, setShowAllCols] = useState(false);
  const [showDocTypeSwitcher, setShowDocTypeSwitcher] = useState(false);
  const [enableDestScale, setEnableDestScale] = useState(false);
  const [enableWeighbridgePricing, setEnableWeighbridgePricing] = useState(false);
  const [enableDOWeighing, setEnableDOWeighing] = useState(false);
  const [projectMissingError, setProjectMissingError] = useState(false);
  const [remappedNotice, setRemappedNotice] = useState<string | null>(null);
  const [isRecoveringLineImage, setIsRecoveringLineImage] = useState(false);
  const [isRescanningAI, setIsRescanningAI] = useState(false);
  const [isRescanningZone, setIsRescanningZone] = useState<AIRescanZone | null>(null);
  const [correctedWeighbridgeDoId, setCorrectedWeighbridgeDoId] = useState('');
  const [confirmOriginWeighbridgeCorrection, setConfirmOriginWeighbridgeCorrection] = useState(false);
  const [zoneRescanProposal, setZoneRescanProposal] = useState<{
    zone: AIRescanZone;
    data: Partial<OrderRecord>;
  } | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [hasAttachedImage, setHasAttachedImage] = useState(false);
  const [pairedWeighbridgeInboxId, setPairedWeighbridgeInboxId] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const zoneRescanGeneration = useRef(0);
  const isExistingOrder = Boolean(orderData?.id && existingOrders.some(order => order.id === orderData.id));
  const canCorrectStoredDocumentToOriginTicket = Boolean(
    orderData?.status === 'verified' &&
    ['delivery_order', 'concrete', 'full_logistics', 'tax_invoice'].includes(orderData.docType || '')
  );
  const requiresTrNumber = ['delivery_order', 'concrete', 'full_logistics'].includes(selectedDocType);

  useEffect(() => {
    zoneRescanGeneration.current += 1;
    setIsRescanningZone(null);
    setZoneRescanProposal(null);
    if (orderData) {
      setSaveToStoreDirectory(false);
      const normalized = { ...orderData };
      if (!normalized.id || !existingOrders.some(order => order.id === normalized.id)) {
        normalized.col1 = '';
      }
      const c13 = Number(normalized.col13) || 0;
      const c14 = Number(normalized.col14) || 0;
      if (c13 > 0 && c14 > 0 && c13 >= c14 && !normalized.col15) {
        normalized.col15 = c13 - c14;
      }

      const c18 = Number(normalized.col18) || 0;
      const c19 = Number(normalized.col19) || 0;
      if (c18 > 0 && c19 > 0 && c18 >= c19 && !normalized.col20) {
        normalized.col20 = c18 - c19;
      }

      if (!normalized.rawAiSnapshot || Object.keys(normalized.rawAiSnapshot).length === 0) {
        normalized.rawAiSnapshot = {
          rawDocNo: normalized.col17 || normalized.col6 || '',
          rawRefPoNo: normalized.col4 || '',
          rawRefDoNo: normalized.referenceDocNo || '',
          rawDate: normalized.col7 || normalized.col16 || '',
          rawGrossWeightKg: Number(normalized.col13) || Number(normalized.col18) || 0,
          rawTareWeightKg: Number(normalized.col14) || Number(normalized.col19) || 0,
          rawNetWeightKg: Number(normalized.col15) || Number(normalized.col20) || 0
        } as any;
      }

      // Auto-infer Column 3 (หมวดหมู่วัสดุ) if empty or generic
      const matchedPOForCat = normalized.col4
        ? pos.find(p => isExactDocNumberReference(p.poNumber, normalized.col4))
        : undefined;
      const matchedStoreForCat = normalized.col8
        ? stores.find(s => s.name.trim().toLowerCase() === normalized.col8!.trim().toLowerCase())
        : undefined;
      normalized.col3 = inferMaterialCategory(
        normalized.col11,
        matchedStoreForCat?.category || storeSuggestion?.category,
        matchedPOForCat?.category,
        normalized.col3,
        normalized.col12
      );

      setForm(normalized);
      setCurrentImage(billImage || normalized.image || null);
      setProjectMissingError(false);
      setRemappedNotice(null);
      setHasAttachedImage(false);
      setIsRecoveringLineImage(false);
      setPairedWeighbridgeInboxId(normalized.pairedWeighbridgeInboxId || '');
      setCorrectedWeighbridgeDoId('');
      setConfirmOriginWeighbridgeCorrection(false);

      // Preserve a document type already classified by the shared OCR pipeline.
      let detectedType: DocumentType = normalized.docType || 'delivery_order';
      if (!normalized.docType) {
        const netO = Number(normalized.col13) || Number(normalized.col15) || 0;
        const netD = Number(normalized.col18) || Number(normalized.col20) || 0;
        const item = (normalized.col11 || '').toLowerCase();
        const doNum = (normalized.col6 || '').toLowerCase();

        if (netD > 0 && netO === 0) {
          detectedType = 'dest_weighbridge';
        } else if (doNum.includes('inv') || doNum.includes('tax') || item.includes('ภาษี')) {
          detectedType = 'tax_invoice';
        } else {
          detectedType = 'delivery_order';
        }
      }

      setSelectedDocType(detectedType);

      // Only enable destination scale if col18 or col20 has a genuine non-zero value different from origin
      const hasDistinctDestWeight = (Number(normalized.col18) > 0 || Number(normalized.col20) > 0) &&
        Number(normalized.col18) !== Number(normalized.col13);
      setEnableDestScale(Boolean(hasDistinctDestWeight));

      // Check if weighbridge already has explicit pricing recorded
      const hasExplicitPricing = Number(normalized.col24) > 0 || Number(normalized.col27) > 0 || Number(normalized.col29) > 0;
      setEnableWeighbridgePricing(Boolean(hasExplicitPricing));

      // Check if DO has truck scale weights (Gross/Tare/Net)
      const hasDOWeighing = Number(normalized.col13) > 0 || Number(normalized.col14) > 0 || Number(normalized.col15) > 0;
      setEnableDOWeighing(Boolean(hasDOWeighing));
    }
    setShowAllCols(false);
  }, [orderData, isOpen]);

  // Sync billImage into currentImage when it arrives async (e.g. fetched from LINE API after modal opens)
  useEffect(() => {
    if (billImage && billImage.length > 50) {
      setCurrentImage(billImage);
    }
  }, [billImage]);

  const dbCatalog = React.useMemo(
    () => buildDatabaseCatalog(stores, projects, pos, existingOrders),
    [stores, projects, pos, existingOrders]
  );

  // Prioritize items from the currently linked PO (if col4 matches a PO) at the top of the item options list
  const poAwareItemOptions = React.useMemo<CatalogOption[]>(() => {
    const matchedPO = form.col4 ? pos.find(p => isExactDocNumberReference(p.poNumber, form.col4)) : undefined;
    if (!matchedPO || !matchedPO.items || matchedPO.items.length === 0) {
      return dbCatalog.items;
    }
    const poOpts: CatalogOption[] = matchedPO.items.map(it => ({
      value: it.itemDescription,
      subLabel: [
        it.specCode ? `สเปก: ${it.specCode}` : '',
        `สั่ง ${it.orderedQty} ${it.unit}`,
        it.unitPrice ? `฿${it.unitPrice.toLocaleString()}/${it.unit}` : ''
      ].filter(Boolean).join(' • '),
      badge: `🎯 ใน PO ${matchedPO.poNumber}`,
      meta: {
        specCode: it.specCode,
        unit: it.unit,
        unitPrice: it.unitPrice,
        storeName: matchedPO.storeName
      }
    }));
    const poKeys = new Set(poOpts.map(o => o.value.trim().toLowerCase()));
    const rest = dbCatalog.items.filter(o => !poKeys.has(o.value.trim().toLowerCase()));
    return [...poOpts, ...rest];
  }, [form.col4, pos, dbCatalog.items]);

  // Document type flags keep the OCR classification aligned with the selected form.
  const isWeighbridge = selectedDocType === 'weighbridge';
  const isDestWeighbridge = selectedDocType === 'dest_weighbridge';
  const isDeliveryOrder = selectedDocType === 'delivery_order' || selectedDocType === 'concrete';
  const isCorrectingStoredWeighbridge = Boolean(
    isExistingOrder &&
    canCorrectStoredDocumentToOriginTicket &&
    selectedDocType === 'weighbridge' &&
    orderData?.docType !== 'weighbridge' &&
    orderData?.docType !== 'dest_weighbridge'
  );
  const occupiedOriginDoIds = getOccupiedOriginWeighbridgeDoIds(existingOrders);
  const eligibleOriginWeighbridgeDOs = existingOrders.filter(order =>
    order.id !== orderData?.id &&
    order.status === 'verified' &&
    Boolean(order.col1.trim()) &&
    !occupiedOriginDoIds.has(order.id) &&
    isDeliveryOrderPairingCandidate(order)
  );
  const isContractorChargeOrder = ['delivery_order', 'concrete', 'full_logistics'].includes(selectedDocType);
  const requiresRecipient = isContractorChargeOrder;
  const contractorChargeItems: OrderItemDetail[] = form.lineItems?.length
    ? form.lineItems.map(item => ({
        ...item,
        contractorChargeDecision: item.contractorChargeDecision || 'chargeable'
      }))
    : [{
        id: 'main',
        itemDescription: form.col11 || '',
        specCode: form.col12 || '',
        qty: Number(form.col22) || 0,
        unit: form.col23 || '',
        unitPrice: Number(form.col24) || undefined,
        totalAmount: Number(form.col25) || undefined,
        contractorChargeDecision: 'chargeable'
      }];
  const contractorChargeMode = contractorChargeItems.every(item => item.contractorChargeDecision === 'not_chargeable')
    ? 'not_chargeable'
    : 'chargeable';
  const isTaxInvoice = selectedDocType === 'tax_invoice';
  const isPO = selectedDocType === 'purchase_order';
  const isFullLogistics = selectedDocType === 'full_logistics';
  const availableWeighbridgeInboxItems = lineInboxItems.filter(item =>
    item.status === 'pending_review' &&
    item.detectedDocType === 'weighbridge' &&
    item.id !== form.lineInboxId
  );
  const pairedWeighbridgeInboxItem = availableWeighbridgeInboxItems.find(
    item => item.id === pairedWeighbridgeInboxId
  );

  const validationWarnings = React.useMemo(() => {
    const warnings: string[] = [];
    const isValidDate = (value?: string) => {
      if (!value) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };

    if (!isValidDate(form.col7)) {
      warnings.push(form.col7 ? 'วันที่เอกสาร (ช่อง 7) ไม่อยู่ในรูปแบบ YYYY-MM-DD หรือไม่มีวันที่จริง' : 'ยังไม่มีวันที่เอกสาร (ช่อง 7)');
    }
    if (isDestWeighbridge && !isValidDate(form.col16)) {
      warnings.push(form.col16 ? 'วันที่ชั่งปลายทาง (ช่อง 16) ไม่ถูกต้อง' : 'ยังไม่มีวันที่ชั่งปลายทาง (ช่อง 16)');
    }

    const primaryDocNumber = isPO ? form.col4 : isDestWeighbridge ? form.col17 || form.col6 : form.col6;
    if (!primaryDocNumber?.trim()) {
      warnings.push(isPO ? 'ยังไม่มีเลขที่ใบสั่งซื้อ (ช่อง 4)' : 'ยังไม่มีเลขที่เอกสารหลัก');
    }
    if (isPO && !form.col8?.trim()) {
      warnings.push('ยังระบุผู้ขาย/ร้านค้า (ช่อง 8) ไม่ได้ — ตรวจจากช่องผู้ขายในใบสั่งซื้อก่อนยืนยัน');
    }

    const numericFields: Array<[keyof OrderRecord, string]> = [
      ['col13', 'น้ำหนัก Gross ต้นทาง'],
      ['col14', 'น้ำหนัก Tare ต้นทาง'],
      ['col15', 'น้ำหนักสุทธิต้นทาง'],
      ['col18', 'น้ำหนัก Gross ปลายทาง'],
      ['col19', 'น้ำหนัก Tare ปลายทาง'],
      ['col20', 'น้ำหนักสุทธิปลายทาง'],
      ['col22', 'ปริมาณ'],
      ['col24', 'ราคาต่อหน่วย'],
      ['col25', 'ยอดค่าสินค้า'],
      ['col27', 'ค่าขนส่งต่อหน่วย'],
      ['col28', 'ยอดค่าขนส่ง'],
      ['col29', 'ยอดรวม'],
      ['col31', 'ยอดชำระผู้ขาย'],
      ['col32', 'ยอดค้างผู้ขาย'],
      ['col33', 'ยอดชำระขนส่ง'],
      ['col34', 'ยอดค้างขนส่ง'],
      ['col35', 'ยอดชำระรวม'],
      ['col36', 'ยอดค้างรวม']
    ];
    for (const [field, label] of numericFields) {
      const value = form[field];
      if (value !== undefined && value !== null && value !== '' && !Number.isFinite(Number(value))) {
        warnings.push(`${label} ต้องเป็นตัวเลข`);
      } else if (field !== 'col21' && Number(value) < 0) {
        warnings.push(`${label} ต้องไม่ติดลบ`);
      }
    }

    const weightChecks: Array<[keyof OrderRecord, keyof OrderRecord, keyof OrderRecord, string]> = [
      ['col13', 'col14', 'col15', 'ต้นทาง'],
      ['col18', 'col19', 'col20', 'ปลายทาง']
    ];
    for (const [grossField, tareField, netField, label] of weightChecks) {
      const gross = Number(form[grossField]) || 0;
      const tare = Number(form[tareField]) || 0;
      const net = Number(form[netField]) || 0;
      if (gross > 0 && tare > 0 && gross < tare) {
        warnings.push(`น้ำหนัก Gross ${label} น้อยกว่า Tare — ระบบคงตัวเลขตามที่อ่านได้และไม่สลับให้`);
      } else if (gross > 0 && tare > 0 && net > gross) {
        warnings.push(`น้ำหนักสุทธิ ${label} มากกว่า Gross`);
      } else if (gross > 0 && tare > 0 && net > 0 && gross >= tare && net !== gross - tare) {
        warnings.push(`น้ำหนักสุทธิ ${label} ไม่เท่ากับ Gross ลบ Tare`);
      }
    }
    return warnings;
  }, [form, isDestWeighbridge, isPO]);

  if (!isOpen || !orderData) return null;

  // Determine which zones are relevant for the current document type
  const showWeightsOrigin = showAllCols || isWeighbridge || isFullLogistics || enableDOWeighing || Number(form.col13) > 0 || Number(form.col15) > 0;
  const showWeightsDest = showAllCols || isFullLogistics || isDestWeighbridge || (isWeighbridge && enableDestScale) || Boolean(form.col17) || Number(form.col18) > 0 || Number(form.col20) > 0;

  // Auto-calculation functions
  const handleWeightChange = (field: 'col13' | 'col14' | 'col18' | 'col19', value: number) => {
    const nextForm = { ...form, [field]: value };

    // Zone 3: Net Origin = Gross - Tare
    const grossO = Number(field === 'col13' ? value : nextForm.col13) || 0;
    const tareO = Number(field === 'col14' ? value : nextForm.col14) || 0;
    const netO = grossO >= tareO ? grossO - tareO : Number(nextForm.col15) || 0;
    nextForm.col15 = netO;

    // Zone 4: Net Dest = Dest Gross - Dest Tare
    const grossD = Number(field === 'col18' ? value : nextForm.col18) || 0;
    const tareD = Number(field === 'col19' ? value : nextForm.col19) || 0;
    const netD = grossD >= tareD ? grossD - tareD : Number(nextForm.col20) || 0;
    nextForm.col20 = netD;

    // Weight Diff
    if (netO > 0 && netD > 0) {
      nextForm.col21 = netO - netD;
    }

    setForm(nextForm);
    recalculateFinancials(nextForm);
  };

  // 1-Click Swap for Zone 3 (col13 <-> col14)
  const handleSwapOriginWeights = () => {
    const newCol13 = Number(form.col14) || 0;
    const newCol14 = Number(form.col13) || 0;
    const newCol15 = Math.max(0, newCol13 - newCol14);
    const nextForm: Partial<OrderRecord> = {
      ...form,
      col13: newCol13,
      col14: newCol14,
      col15: newCol15
    };
    if ((nextForm.col23 || '').includes('ตัน') && newCol15 > 0) {
      nextForm.col22 = Number((newCol15 / 1000).toFixed(2));
    }
    setForm(nextForm);
    recalculateFinancials(nextForm);
  };

  // 1-Click Swap for Zone 4 (col18 <-> col19)
  const handleSwapDestWeights = () => {
    const newCol18 = Number(form.col19) || 0;
    const newCol19 = Number(form.col18) || 0;
    const newCol20 = Math.max(0, newCol18 - newCol19);
    const nextForm: Partial<OrderRecord> = {
      ...form,
      col18: newCol18,
      col19: newCol19,
      col20: newCol20
    };
    if (Number(nextForm.col15) > 0 && newCol20 > 0) {
      nextForm.col21 = Number(nextForm.col15) - newCol20;
    }
    setForm(nextForm);
  };

  const handleFinancialChange = (field: 'col22' | 'col24' | 'col27' | 'col31' | 'col33' | 'col35', value: number) => {
    const nextForm = { ...form, [field]: value };
    recalculateFinancials(nextForm);
  };

  const recalculateFinancials = (currentForm: Partial<OrderRecord>) => {
    const qty = Number(currentForm.col22) || 0;
    const price = Number(currentForm.col24) || 0;
    const goodsTotal = qty * price;
    currentForm.col25 = Number(goodsTotal.toFixed(2));

    const freightRate = Number(currentForm.col27) || 0;
    const freightTotal = qty * freightRate;
    currentForm.col28 = Number(freightTotal.toFixed(2));

    const grandTotal = goodsTotal + freightTotal;
    currentForm.col29 = Number(grandTotal.toFixed(2));

    const paidSeller = Number(currentForm.col31) || 0;
    const paidFreight = Number(currentForm.col33) || 0;
    currentForm.col32 = Number(Math.max(0, goodsTotal - paidSeller).toFixed(2));
    currentForm.col34 = Number(Math.max(0, freightTotal - paidFreight).toFixed(2));

    const totalPaid = Number(currentForm.col35) !== undefined && Number(currentForm.col35) > 0 
      ? Number(currentForm.col35) 
      : paidSeller + paidFreight;
    currentForm.col35 = Number(totalPaid.toFixed(2));
    currentForm.col36 = Number(Math.max(0, grandTotal - totalPaid).toFixed(2));

    setForm({ ...currentForm });
  };

  const handleTextChange = (field: keyof OrderRecord, value: string) => {
    if (field === 'col2' && value.trim()) {
      setProjectMissingError(false);
    }
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const updateContractorChargeDecision = (
    itemIndex: number,
    decision: OrderItemDetail['contractorChargeDecision']
  ) => {
    const nextItems = [...contractorChargeItems];
    const currentItem = nextItems[itemIndex];
    if (!currentItem) return;
    nextItems[itemIndex] = {
      ...currentItem,
      id: currentItem.id || crypto.randomUUID(),
      contractorChargeDecision: decision
    };
    setForm(previous => ({ ...previous, lineItems: nextItems }));
  };

  const applyContractorChargeDecisionToAll = (decision: OrderItemDetail['contractorChargeDecision']) => {
    setForm(previous => ({
      ...previous,
      lineItems: contractorChargeItems.map(item => ({
        ...item,
        id: item.id || crypto.randomUUID(),
        contractorChargeDecision: decision
      }))
    }));
  };

  const handleDocTypeSelect = (docType: DocumentType) => {
    if (isRescanningAI || isRescanningZone !== null) return;
    setConfirmOriginWeighbridgeCorrection(false);
    if (docType !== 'weighbridge') setCorrectedWeighbridgeDoId('');
    if (docType !== 'delivery_order' && docType !== 'concrete') {
      setPairedWeighbridgeInboxId('');
    }
    if (docType === 'delivery_order' && selectedDocType === 'weighbridge') {
      setRemappedNotice('ใบส่งของจากร้านค้าและตั๋วชั่งต้นทางใช้แบบฟอร์มรับของกลุ่มเดียวกัน ระบบคงชนิดเอกสาร “ตั๋วชั่งต้นทาง” จาก OCR และเก็บน้ำหนักช่อง 13–15');
      return;
    }
    setZoneRescanProposal(null);
    setSelectedDocType(docType);
    const updated = remapLineBillToDocType(form, docType);

    if (docType === 'delivery_order' && Number(updated.col15) > 0) {
      setEnableDOWeighing(true);
    }

    // Auto-adjust default unit or vehicle based on doc type
    if (docType === 'concrete') {
      if (!updated.col23 || updated.col23 === 'ตัน') updated.col23 = 'คิว';
      if (!updated.col26) updated.col26 = 'รถโม่คอนกรีต';
      if (!updated.col3) updated.col3 = 'งานคอนกรีตผสมเสร็จ';
    } else if (docType === 'delivery_order') {
      if (!updated.col23 || updated.col23 === 'ตัน') {
        updated.col23 = Number(updated.col15) > 0 ? 'ตัน' : 'รายการ';
      }
      if (!updated.col26) updated.col26 = 'สิบล้อ/หกล้อ';
    } else if (docType === 'weighbridge') {
      setEnableDOWeighing(true);
      if (!updated.col23) updated.col23 = 'ตัน';
      if (!updated.col26) updated.col26 = 'พ่วง 18 ล้อ';
      if (!updated.col3) updated.col3 = 'งานหิน/ดิน/ทราย';
    }

    setForm(updated);
    setRemappedNotice(
      docType === 'dest_weighbridge'
        ? '⚡ ย้ายเลขที่ตั๋วไปช่อง 17 และน้ำหนักไปช่อง 18–20 ให้อัตโนมัติแล้ว (ไม่ต้องให้ AI อ่านใหม่)'
        : docType === 'delivery_order'
        ? '⚡ ย้ายเลขที่บิลไปช่อง 6 (DO) และน้ำหนักไปช่อง 13–15 ให้อัตโนมัติแล้ว (ไม่ต้องให้ AI อ่านใหม่)'
        : docType === 'weighbridge'
        ? '⚡ เตรียมเลขตั๋วและน้ำหนักต้นทางช่อง 13–15 ให้ตรวจทานจากภาพก่อนจับคู่ DO'
        : docType === 'tax_invoice'
        ? '⚡ สลับเป็นโหมดใบเสร็จ/ใบกำกับภาษีอัตโนมัติแล้ว (ไม่ต้องให้ AI อ่านใหม่)'
        : '⚡ เตรียมข้อมูลสำหรับโอนเข้าใบสั่งซื้อ (PO) เรียบร้อยแล้ว'
    );
  };

  const handleOptionalAIRescan = async () => {
    const imgToScan = currentImage || billImage || form.image;
    if (!imgToScan || isRescanningAI || isRescanningZone !== null) return;
    setZoneRescanProposal(null);
    setIsRescanningAI(true);
    setRemappedNotice('🤖 กำลังให้ AI อ่านข้อมูลใหม่เฉพาะตามประเภทเอกสารที่เลือก...');
    try {
      const res = await rescanBillForTargetDocType(imgToScan, selectedDocType, form);
      if (res.success && res.orderData) {
        if (selectedDocType === 'purchase_order' && res.poData && onSwitchToPO) {
          onSwitchToPO(res.poData);
          onClose();
          return;
        }
        setForm(res.orderData);
        if (Number(res.orderData.col15) > 0) setEnableDOWeighing(true);
        setRemappedNotice('✅ AI อ่านข้อมูลใหม่ตามประเภทเอกสารที่เลือกเรียบร้อยแล้ว!');
      } else {
        setRemappedNotice(`⚠️ ${res.error || 'ไม่สามารถสแกนใหม่ได้ แต่ข้อมูลเดิมยังอยู่ครบ'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      setRemappedNotice(`⚠️ สแกนภาพไม่สำเร็จ: ${message} (ข้อมูลเดิมยังอยู่ครบ)`);
    } finally {
      setIsRescanningAI(false);
    }
  };

  const handleZoneAIRescan = async (zone: AIRescanZone) => {
    const imgToScan = currentImage || billImage || form.image;
    if (!imgToScan || isRescanningAI || isRescanningZone !== null) return;
    const requestGeneration = ++zoneRescanGeneration.current;
    setIsRescanningZone(zone);
    setZoneRescanProposal(null);
    try {
      const result = await rescanBillForTargetDocType(imgToScan, selectedDocType, form);
      if (requestGeneration !== zoneRescanGeneration.current) return;
      if (!result.success || !result.orderData) {
        throw new Error(result.error || 'AI ไม่ได้ส่งผลการอ่านกลับมา');
      }

      const zoneData: Partial<OrderRecord> = {};
      for (const field of AI_RESCAN_ZONE_FIELDS[zone]) {
        const value = result.orderData[field];
        if (value !== undefined) {
          Object.assign(zoneData, { [field]: value });
        }
      }
      setZoneRescanProposal({ zone, data: zoneData });
      setRemappedNotice(`AI อ่านโซน ${zone} แล้ว กรุณาเทียบค่าก่อนยืนยันนำไปใช้`);
    } catch (error) {
      if (requestGeneration !== zoneRescanGeneration.current) return;
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      setRemappedNotice(`⚠️ อ่านโซน ${zone} ไม่สำเร็จ: ${message} (ข้อมูลเดิมยังอยู่ครบ)`);
    } finally {
      if (requestGeneration === zoneRescanGeneration.current) {
        setIsRescanningZone(null);
      }
    }
  };

  const getZoneRescanChanges = (zone: AIRescanZone) => {
    if (!zoneRescanProposal || zoneRescanProposal.zone !== zone) return [];
    return AI_RESCAN_ZONE_FIELDS[zone]
      .filter(field => zoneRescanProposal.data[field] !== undefined)
      .filter(field =>
        String(form[field] ?? '').trim() !== String(zoneRescanProposal.data[field] ?? '').trim()
      );
  };

  const applyZoneAIRescan = () => {
    if (!zoneRescanProposal) return;
    const { zone, data } = zoneRescanProposal;
    const nextForm: Partial<OrderRecord> = { ...form, ...data };

    if (zone === 3) {
      const gross = Number(nextForm.col13) || 0;
      const tare = Number(nextForm.col14) || 0;
      nextForm.col15 = gross >= tare ? gross - tare : Number(nextForm.col15) || 0;
      setEnableDOWeighing(gross > 0 || tare > 0 || Number(nextForm.col15) > 0);
    } else if (zone === 4) {
      const gross = Number(nextForm.col18) || 0;
      const tare = Number(nextForm.col19) || 0;
      nextForm.col20 = gross >= tare ? gross - tare : Number(nextForm.col20) || 0;
      if (Number(nextForm.col15) > 0 && Number(nextForm.col20) > 0) {
        nextForm.col21 = Number(nextForm.col15) - Number(nextForm.col20);
      }
    }

    if (zone === 3 || zone === 5 || zone === 6) {
      recalculateFinancials(nextForm);
    } else {
      setForm(nextForm);
    }
    setZoneRescanProposal(null);
    setRemappedNotice(`ยืนยันใช้ผล AI เฉพาะโซน ${zone} แล้ว โซนอื่นคงข้อมูลเดิม`);
  };

  const renderZoneRescanButton = (zone: AIRescanZone) => (
    <button
      type="button"
      onClick={() => void handleZoneAIRescan(zone)}
      disabled={!(currentImage || billImage || form.image) || isRescanningAI || isRescanningZone !== null || isPreparingImage}
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-indigo-800 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={isRescanningZone === zone ? `AI กำลังอ่านโซน ${zone}` : `ให้ AI อ่านโซน ${zone} ใหม่`}
      title={`อ่านเอกสารด้วย AI แล้วเสนอเปลี่ยนเฉพาะข้อมูลโซน ${zone}`}
    >
      <Sparkles className={`h-3.5 w-3.5 ${isRescanningZone === zone ? 'animate-pulse' : ''}`} />
      {isRescanningZone === zone ? `กำลังอ่านโซน ${zone}...` : 'AI อ่านใหม่'}
    </button>
  );

  const renderZoneRescanReview = (zone: AIRescanZone) => {
    if (!zoneRescanProposal || zoneRescanProposal.zone !== zone) return null;
    const changedFields = getZoneRescanChanges(zone);
    const availableFields = AI_RESCAN_ZONE_FIELDS[zone].filter(
      field => zoneRescanProposal.data[field] !== undefined
    );
    const formatValue = (value: unknown) =>
      value === undefined || value === null || String(value).trim() === ''
        ? '— (ว่าง)'
        : String(value);

    return (
      <div
        className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs"
        aria-live="polite"
      >
        <p className="font-semibold text-indigo-950">
          ตรวจผลอ่านโซน {zone} — จะไม่เปลี่ยนข้อมูลจนกว่าจะกดยืนยัน
        </p>
        {availableFields.length === 0 ? (
          <p className="text-slate-700">AI ไม่ได้ส่งค่าที่ใช้ได้สำหรับโซนนี้กลับมา ข้อมูลเดิมยังอยู่ครบ</p>
        ) : changedFields.length === 0 ? (
          <p className="text-slate-700">ค่าที่ AI อ่านได้ตรงกับข้อมูลปัจจุบัน ไม่มีรายการเปลี่ยนแปลง</p>
        ) : (
          <div className="space-y-1.5">
            {changedFields.map(field => (
              <div key={field} className="grid gap-1 rounded-md bg-white px-2.5 py-2 sm:grid-cols-[minmax(0,0.8fr)_1fr_1fr]">
                <span className="font-semibold text-slate-700">{AI_RESCAN_FIELD_LABELS[field] || String(field)}</span>
                <span className="break-words text-slate-600">เดิม: {formatValue(form[field])}</span>
                <span className="break-words font-semibold text-indigo-900">AI: {formatValue(zoneRescanProposal.data[field])}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setZoneRescanProposal(null)}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
          >
            ยกเลิก
          </button>
          {changedFields.length > 0 && (
            <button
              type="button"
              onClick={applyZoneAIRescan}
              className="min-h-10 rounded-lg bg-indigo-700 px-3 py-2 font-bold text-white hover:bg-indigo-800"
            >
              ยืนยันใช้ค่า AI เฉพาะโซนนี้
            </button>
          )}
        </div>
      </div>
    );
  };

  const handleRecoverLineImage = async () => {
    if (!form.id || !onRecoverLineImage || isRecoveringLineImage) return;
    setIsRecoveringLineImage(true);
    setRemappedNotice('กำลังดึงภาพต้นฉบับจาก LINE และจัดเก็บใน Google Drive...');
    try {
      const recovered = await onRecoverLineImage(form.id);
      setCurrentImage(recovered.image);
      setForm(previous => ({
        ...previous,
        image: recovered.image,
        driveFileId: recovered.driveFileId,
        driveFolderId: recovered.driveFolderId
      }));
      setRemappedNotice('กู้ภาพจาก LINE และบันทึกเข้า Google Drive แล้ว');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      setRemappedNotice(`⚠️ กู้ภาพจาก LINE ไม่สำเร็จ: ${message}`);
    } finally {
      setIsRecoveringLineImage(false);
    }
  };

  const handleAttachImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setRemappedNotice('⚠️ กรุณาเลือกไฟล์รูปภาพ เช่น JPG, PNG หรือ WEBP');
      return;
    }

    setIsPreparingImage(true);
    setRemappedNotice('กำลังเตรียมรูปภาพสำหรับแนบ...');
    try {
      const image = await optimizeImageForAI(file);
      setCurrentImage(image);
      setForm(previous => ({ ...previous, image }));
      setHasAttachedImage(true);
      setRemappedNotice('แนบรูปแล้ว — กดบันทึกเพื่อแนบอย่างเดียว หรือกดปุ่ม AI เพื่ออ่านข้อมูลจากรูป');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      setRemappedNotice(`⚠️ เตรียมรูปภาพไม่สำเร็จ: ${message}`);
    } finally {
      setIsPreparingImage(false);
    }
  };

  const buildFinalizedOrder = (overrideExistingOrder?: OrderRecord): { finalizedOrder: OrderRecord; storeToSave?: StoreMerchant } => {
    const finalizedOrder: OrderRecord = {
      id: overrideExistingOrder ? overrideExistingOrder.id : (form.id || 'ord-' + Date.now()),
      docType: selectedDocType,
      documentTitle: form.documentTitle || overrideExistingOrder?.documentTitle,
      docTypeEvidence: form.docTypeEvidence || overrideExistingOrder?.docTypeEvidence,
      docTypeConfidence: form.docTypeConfidence ?? overrideExistingOrder?.docTypeConfidence,
      col1: overrideExistingOrder
        ? (selectedDocType === 'weighbridge' ? '' : overrideExistingOrder.col1)
        : requiresTrNumber
          ? (form.col1 || '').trim()
          : '',
      col2: (form.col2 || '').trim(),
      col3: form.col3 || (selectedDocType === 'concrete' ? 'คอนกรีต' : 'ทั่วไป'),
      col4: form.col4 || '',
      col5: form.col5 || '',
      col6: form.col6 || '',
      col7: form.col7 || '',
      col8: form.col8 || '',
      col9: form.col9 || '',
      col10: form.col10 || '',
      col11: form.col11 || '',
      col12: form.col12 || '',
      col13: showWeightsOrigin ? (Number(form.col13) || 0) : 0,
      col14: showWeightsOrigin ? (Number(form.col14) || 0) : 0,
      col15: showWeightsOrigin ? (Number(form.col15) || 0) : 0,
      col16: showWeightsDest ? (form.col16 || '') : '',
      col17: showWeightsDest ? (form.col17 || '') : '',
      col18: showWeightsDest ? (Number(form.col18) || 0) : 0,
      col19: showWeightsDest ? (Number(form.col19) || 0) : 0,
      col20: showWeightsDest ? (Number(form.col20) || 0) : 0,
      col21: showWeightsDest ? (Number(form.col21) || 0) : 0,
      col22: Number(form.col22) || 0,
      col23: form.col23 || '',
      col24: (isWeighbridge && !enableWeighbridgePricing && !showAllCols) ? 0 : (Number(form.col24) || 0),
      col25: (isWeighbridge && !enableWeighbridgePricing && !showAllCols) ? 0 : (Number(form.col25) || 0),
      col26: form.col26 || '',
      col27: (isWeighbridge && !enableWeighbridgePricing && !showAllCols) ? 0 : (Number(form.col27) || 0),
      col28: (isWeighbridge && !enableWeighbridgePricing && !showAllCols) ? 0 : (Number(form.col28) || 0),
      col29: (isWeighbridge && !enableWeighbridgePricing && !showAllCols) ? 0 : (Number(form.col29) || 0),
      col30: form.col30 || '',
      col31: (showAllCols || selectedDocType === 'tax_invoice') ? (Number(form.col31) || 0) : 0,
      col32: (showAllCols || selectedDocType === 'tax_invoice') ? (Number(form.col32) || 0) : 0,
      col33: (showAllCols || selectedDocType === 'tax_invoice') ? (Number(form.col33) || 0) : 0,
      col34: (showAllCols || selectedDocType === 'tax_invoice') ? (Number(form.col34) || 0) : 0,
      col35: (showAllCols || selectedDocType === 'tax_invoice') ? (Number(form.col35) || 0) : 0,
      col36: (showAllCols || selectedDocType === 'tax_invoice') ? (Number(form.col36) || 0) : 0,
      col37: form.col37 || '',
      col38: form.col38 || '',
      referenceDocNo: form.referenceDocNo || '',
      referenceSource: form.referenceSource || 'form_field',
      linkedViaDocNo: form.linkedViaDocNo || overrideExistingOrder?.linkedViaDocNo || '',
      poMatchStatus: form.poMatchStatus,
      destMatchStatus: form.destMatchStatus,
      matchedDestTicketId: form.matchedDestTicketId,
      autoActionFlags: form.autoActionFlags,
      autoFlagsVerified: Boolean(form.id) ? true : form.autoFlagsVerified,
      lineItems: isContractorChargeOrder
        ? contractorChargeItems.map(item => ({ ...item, id: item.id || crypto.randomUUID() }))
        : form.lineItems,
      image: currentImage || billImage || form.image || overrideExistingOrder?.image || null,
      aiExtracted: true,
      status: 'verified',
      createdAt: overrideExistingOrder?.createdAt || form.createdAt || new Date().toISOString(),
      lineInboxId: form.lineInboxId || overrideExistingOrder?.lineInboxId,
      pairedWeighbridgeInboxId: pairedWeighbridgeInboxId || undefined,
      lineMessageId: form.lineMessageId || overrideExistingOrder?.lineMessageId,
      lineUserId: form.lineUserId || overrideExistingOrder?.lineUserId,
      lineSenderName: form.lineSenderName || overrideExistingOrder?.lineSenderName,
      lineSenderAvatar: form.lineSenderAvatar || overrideExistingOrder?.lineSenderAvatar,
      lineGroupId: form.lineGroupId || overrideExistingOrder?.lineGroupId,
      lineGroupName: form.lineGroupName || overrideExistingOrder?.lineGroupName,
      lineReceivedAt: form.lineReceivedAt || overrideExistingOrder?.lineReceivedAt,
      rawAiSnapshot: form.rawAiSnapshot || overrideExistingOrder?.rawAiSnapshot
    };

    let storeToSave: StoreMerchant | undefined;
    if (saveToStoreDirectory && finalizedOrder.col8) {
      const existingStore = stores.find(
        s => s.name.trim().toLowerCase() === finalizedOrder.col8.trim().toLowerCase()
      );

      if (!existingStore) {
        storeToSave = {
          id: 'store-' + Date.now(),
          name: finalizedOrder.col8,
          category: finalizedOrder.col3 || storeSuggestion?.category || 'ทั่วไป',
          taxId: storeSuggestion?.taxId || '',
          phone: storeSuggestion?.phone || '',
          contactPerson: storeSuggestion?.contactPerson || '',
          address: storeSuggestion?.address || '',
          creditTerms: finalizedOrder.col30 || 'เครดิต 30 วัน',
          totalOrders: 1,
          totalPurchases: finalizedOrder.col29,
          totalPaid: finalizedOrder.col35,
          totalDebt: finalizedOrder.col36,
          lastOrderDate: finalizedOrder.col7,
          primaryGoods: [finalizedOrder.col11],
          notes: 'บันทึกอัตโนมัติจากการสแกนบิล'
        };
        finalizedOrder.storeId = storeToSave.id;
      } else {
        finalizedOrder.storeId = existingStore.id;
      }
    }

    return { finalizedOrder, storeToSave };
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    // Strict Mandatory Check: "ชื่อโครงการ (ช่อง 2)" must be present before confirming save
    if (!form.col2 || !form.col2.trim()) {
      setProjectMissingError(true);
      return;
    }

    if (requiresRecipient && !form.col9?.trim()) {
      setSaveError('กรุณาระบุผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมาที่ช่อง 9 ก่อนบันทึก');
      return;
    }
    if (isContractorChargeOrder && contractorChargeItems.some(item => !item.contractorChargeDecision)) {
      setSaveError('กรุณาเลือกทุกรายการว่าจะนำไปหักผู้รับเหมา หรือไม่นำหักเพราะบริษัทซื้อใช้เอง');
      return;
    }

    if (isCorrectingStoredWeighbridge) {
      if (!confirmOriginWeighbridgeCorrection) {
        setSaveError('กรุณายืนยันว่าตรวจภาพแล้วและเอกสารเป็นตั๋วชั่งต้นทาง');
        return;
      }
      if (!correctedWeighbridgeDoId) {
        setSaveError('กรุณาเลือก DO ที่ยืนยันแล้วเพื่อจับคู่ตั๋วชั่งต้นทาง');
        return;
      }
      if (!onCorrectAndPairOriginWeighbridge) {
        setSaveError('ระบบยังไม่พร้อมสำหรับการแก้ประเภทและจับคู่ย้อนหลัง กรุณาแจ้งผู้ดูแลระบบ');
        return;
      }
      const ticketNumber = form.col6?.trim();
      const netWeight = Number(form.col15) ||
        Math.max(0, (Number(form.col13) || 0) - (Number(form.col14) || 0));
      if (!ticketNumber || netWeight <= 0) {
        setSaveError('กรุณาตรวจเลขที่ตั๋วชั่งและน้ำหนักสุทธิจากภาพให้ครบก่อนจับคู่');
        return;
      }
      setIsSaving(true);
      setSaveError('');
      try {
        const { finalizedOrder } = buildFinalizedOrder();
        if (await onCorrectAndPairOriginWeighbridge(finalizedOrder, correctedWeighbridgeDoId)) {
          onClose();
        } else {
          setSaveError('ยังแก้ประเภทและจับคู่ไม่ได้ กรุณาตรวจสอบข้อความแจ้งเตือนแล้วลองอีกครั้ง');
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'แก้ประเภทและจับคู่ไม่สำเร็จ');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const { finalizedOrder, storeToSave } = buildFinalizedOrder();
    setIsSaving(true);
    setSaveError('');
    setSaveCompleted(false);
    setShowSaveProgress(true);
    setSaveProgress(SAVE_PROGRESS_STEPS.map(step => ({
      ...step,
      status: 'pending'
    })));
    const reportProgress = (update: DocumentSaveProgressUpdate) => {
      setSaveProgress(previous => previous.map(step =>
        step.id === update.stepId
          ? { ...step, status: update.status, detail: update.detail }
          : step
      ));
    };
    try {
      if (await onSaveOrder(finalizedOrder, storeToSave, reportProgress)) {
        setSaveCompleted(true);
      } else {
        setSaveError('ยังบันทึกไม่ได้ กรุณาตรวจสอบข้อความแจ้งเตือนแล้วลองอีกครั้ง');
        setSaveProgress(previous => previous.map(step =>
          step.status === 'running'
            ? { ...step, status: 'error', detail: 'ขั้นตอนนี้ไม่สำเร็จ ตรวจสอบข้อความแจ้งเตือนและลองอีกครั้ง' }
            : step
        ));
      }
    } catch (err: any) {
      const message = err?.message || 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง';
      setSaveError(message);
      setSaveProgress(previous => previous.map(step =>
        step.status === 'running'
          ? { ...step, status: 'error', detail: message }
          : step
      ));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-2 md:p-4 overflow-hidden">
      <div className="bg-white rounded-2xl max-w-[1750px] w-full h-[95vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        
        {/* Top Header */}
        <div className="p-3 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-amber-300" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <span>{isExistingOrder ? 'แก้ไขข้อมูลเอกสาร' : 'ตรวจสอบและบันทึกเอกสารใหม่'}</span>
                <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                  เลือกประเภทบิลเพื่อกรองฟิลด์ที่จำเป็น
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                ระบบปรับการแสดงฟิลด์ตามประเภทบิลอัตโนมัติ เพื่อให้ตรวจทานได้รวดเร็ว ไม่แสดงช่องที่ไม่เกี่ยวข้อง
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Split Screen Container */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 overflow-hidden">
          
          {/* Left Column: Image Viewer with Rotate & Crop (5 Cols) */}
          <div className="md:col-span-5 bg-slate-950 p-3 flex flex-col h-full overflow-hidden">
            {form.id && form.lineInboxId && !form.driveFileId && onRecoverLineImage && (
              <div className="mb-2 rounded-lg border border-sky-700 bg-slate-900 p-2.5">
                <button
                  type="button"
                  onClick={handleRecoverLineImage}
                  disabled={isRecoveringLineImage}
                  className="min-h-10 w-full px-3 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Download className={`w-4 h-4 ${isRecoveringLineImage ? 'animate-bounce' : ''}`} />
                  {isRecoveringLineImage ? 'กำลังดึงภาพจาก LINE...' : 'ดึงภาพจาก LINE เข้า Google Drive'}
                </button>
                <p className="mt-1.5 text-[11px] leading-4 text-slate-300">
                  ใช้ได้เมื่อ LINE ยังเปิดให้ดึงภาพต้นฉบับ และรายการนี้มีรหัส LINE
                </p>
              </div>
            )}
            {!form.id && (
              <div className="mb-2 flex items-center gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="เลือกภาพเอกสารแนบ"
                  onChange={handleAttachImage}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isPreparingImage || isRescanningAI || isRescanningZone !== null}
                  className="min-h-10 px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-sky-300" />
                  {isPreparingImage ? 'กำลังเตรียมรูป...' : currentImage ? 'เปลี่ยนรูปแนบ' : 'เลือกภาพแนบ'}
                </button>
                <span className="text-[11px] text-slate-400">
                  {currentImage ? 'แนบอย่างเดียวได้ หรือสั่ง AI อ่านก็ได้' : 'แนบรูปโดยไม่อ่าน AI ก็ได้'}
                </span>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <ImageDocViewer
                image={currentImage}
                title="ภาพเอกสารต้นฉบับ"
                onImageChange={(newImg) => setCurrentImage(newImg)}
              />
            </div>
          </div>

          {/* Right Column: Dynamic Form tailored by Bill Type (7 Cols) */}
          <div className="md:col-span-7 bg-white p-4 overflow-y-auto space-y-3.5 flex flex-col h-full text-xs">
            {/* Top Toolbar: Active Document Mode & Optional Switcher */}
            <div className="bg-slate-100 p-2 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>ประเภทเอกสาร:</span>
                  </span>
                  <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                    isDestWeighbridge
                      ? 'bg-teal-50 text-teal-900 border-teal-300'
                      : isTaxInvoice
                      ? 'bg-amber-50 text-amber-900 border-amber-300'
                      : isPO
                      ? 'bg-indigo-50 text-indigo-900 border-indigo-300'
                      : 'bg-sky-50 text-sky-900 border-sky-300'
                  }`}>
                    {isDestWeighbridge
                      ? '⚖️ ตั๋วชั่งน้ำหนักปลายทาง (ช่อง 18–20)'
                      : isTaxInvoice
                      ? '🧾 ใบเสร็จรับเงิน / ใบกำกับภาษี'
                      : isPO
                      ? '📝 ใบสั่งซื้อสินค้า (PO)'
                      : '📦 ใบส่งของ / ใบส่งสินค้า (DO • ช่อง 13–15)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDocTypeSwitcher(!showDocTypeSwitcher)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white text-blue-700 border border-blue-300 hover:bg-blue-50 transition cursor-pointer shadow-2xs"
                  >
                    {showDocTypeSwitcher ? 'ซ่อนตัวเลือกประเภทบิล ▴' : 'สลับประเภทเอกสาร ▾'}
                  </button>
                  {(currentImage || billImage || form.image) && (
                    <button
                      type="button"
                      disabled={isRescanningAI || isRescanningZone !== null || isPreparingImage}
                      onClick={handleOptionalAIRescan}
                      title="ปกติเมื่อสลับประเภทบิล ระบบจะย้ายช่องข้อมูลให้อัตโนมัติทันที แต่หากต้องการให้ AI อ่านซ้ำเฉพาะตามประเภทนี้สามารถกดปุ่มนี้ได้"
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100 transition cursor-pointer disabled:opacity-50"
                    >
                      {isRescanningAI
                        ? '🤖 กำลังอ่าน...'
                        : hasAttachedImage
                          ? '🤖 ให้ AI อ่านรูปตามประเภทนี้'
                          : '🤖 ให้ AI อ่านใหม่ตามประเภทนี้ (ทางเลือก)'}
                    </button>
                  )}
                </div>
                
                {/* Toggle Show All 39 Cols button */}
                <button
                  type="button"
                  onClick={() => setShowAllCols(!showAllCols)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                    showAllCols 
                      ? 'bg-blue-600 text-white shadow-xs' 
                      : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {showAllCols ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showAllCols ? 'ซ่อนฟิลด์ที่ไม่จำเป็น' : 'แสดงทุกฟิลด์ (ครบ 39 ช่อง)'}</span>
                </button>
              </div>

              {/* Document Type Selector Grouped by Store vs Company (Shown only when user wants to switch doc type) */}
              {showDocTypeSwitcher && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 animate-fadeIn">
                {/* กลุ่ม 1: บิลจากร้านค้า / ผู้จำหน่าย */}
                <div className="p-1.5 rounded-lg border border-sky-200 bg-sky-50/40 space-y-1">
                  <div className="text-[10px] font-bold text-sky-900 px-1 flex items-center justify-between">
                    <span>🏪 บิลจากร้านค้า / ผู้จำหน่าย</span>
                    <span className="text-[9px] text-sky-700">ช่อง 13-15 & โซน 5-6</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {/* 1. Delivery Order */}
                    <button
                      type="button"
                      onClick={() => {
                        handleDocTypeSelect('delivery_order');
                        setShowDocTypeSwitcher(false);
                      }}
                      className={`p-2 rounded-lg text-left border transition cursor-pointer ${
                        selectedDocType === 'delivery_order' ||
                        selectedDocType === 'concrete' ||
                        (selectedDocType === 'weighbridge' && !isCorrectingStoredWeighbridge)
                          ? 'bg-sky-50 border-sky-500 text-sky-950 shadow-xs ring-1 ring-sky-500'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Boxes className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span className="truncate">ใบส่งของ / ตั๋วชั่งต้นทาง</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">DO หรือ ตั๋วชั่งต้นทาง (ช่อง 13–15)</div>
                    </button>

                    {isExistingOrder && canCorrectStoredDocumentToOriginTicket && (
                        <button
                          type="button"
                          onClick={() => {
                            handleDocTypeSelect('weighbridge');
                            setShowDocTypeSwitcher(false);
                          }}
                          className={`col-span-2 rounded-lg border p-2 text-left transition ${
                            selectedDocType === 'weighbridge'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-500'
                              : 'border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 text-xs font-bold">
                            <Scale className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                            <span>แก้เป็นตั๋วชั่งต้นทางที่จำแนกผิด</span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-600">
                            ตรวจเลขตั๋วและน้ำหนักจากภาพ แล้วเลือก DO ที่ยืนยันแล้วเพื่อจับคู่
                          </div>
                        </button>
                      )}

                    {/* 2. Tax Invoice */}
                    <button
                      type="button"
                      onClick={() => {
                        handleDocTypeSelect('tax_invoice');
                        setShowDocTypeSwitcher(false);
                      }}
                      className={`p-2 rounded-lg text-left border transition cursor-pointer ${
                        selectedDocType === 'tax_invoice'
                          ? 'bg-amber-50 border-amber-500 text-amber-950 shadow-xs ring-1 ring-amber-500'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Receipt className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="truncate">ใบเสร็จ/กำกับภาษี</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">บิลการเงิน/ภาษีจากร้านค้า</div>
                    </button>
                  </div>
                </div>

                {/* กลุ่ม 2: เอกสารของบริษัทเรา / หน้างาน */}
                <div className="p-1.5 rounded-lg border border-indigo-200 bg-indigo-50/40 space-y-1">
                  <div className="text-[10px] font-bold text-indigo-950 px-1 flex items-center justify-between">
                    <span>🏢 เอกสารของบริษัทเรา / ตรวจรับหน้างาน</span>
                    <span className="text-[9px] text-indigo-700">PO & ช่อง 18-20</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {/* 3. Purchase Order */}
                    <button
                      type="button"
                      onClick={() => {
                        handleDocTypeSelect('purchase_order');
                        setShowDocTypeSwitcher(false);
                      }}
                      className={`p-2 rounded-lg text-left border transition cursor-pointer ${
                        selectedDocType === 'purchase_order'
                          ? 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-xs ring-1 ring-indigo-500'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="truncate">ใบสั่งซื้อ (PO)</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">ของบริษัทออกให้ร้านค้า</div>
                    </button>

                    {/* 4. Destination Weighbridge Ticket (Col 18-20) */}
                    <button
                      type="button"
                      onClick={() => {
                        handleDocTypeSelect('dest_weighbridge');
                        setShowDocTypeSwitcher(false);
                      }}
                      className={`p-2 rounded-lg text-left border transition cursor-pointer ${
                        selectedDocType === 'dest_weighbridge'
                          ? 'bg-teal-50 border-teal-500 text-teal-950 shadow-xs ring-1 ring-teal-500'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Scale className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <span className="truncate">ตั๋วชั่งน้ำหนัก</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">ของบริษัท (ช่อง 18-20)</div>
                    </button>
                  </div>
                </div>
              </div>
              )}
              {remappedNotice && (
                <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-semibold flex items-center justify-between">
                  <span>{remappedNotice}</span>
                  <button
                    type="button"
                    onClick={() => setRemappedNotice(null)}
                    className="text-emerald-700 hover:text-emerald-950 text-[10px] font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
              {isCorrectingStoredWeighbridge && (
                <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3" aria-label="แก้ประเภทและจับคู่ตั๋วชั่งต้นทาง">
                  <p className="text-xs font-bold text-amber-950">
                    ตรวจภาพว่าเป็นตั๋วชั่งต้นทางก่อนดำเนินการ
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-900">
                    จะเปลี่ยนประเภทของระเบียนเดิมและผูกเข้ากับ DO ที่เลือกเท่านั้น ไม่สร้างเอกสารซ้ำ ระบบไม่จับคู่ให้อัตโนมัติ และไม่รับตั๋วชั่งปลายทางในขั้นตอนนี้
                  </p>
                  <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-white p-2.5 text-xs leading-relaxed text-slate-800">
                    <input
                      type="checkbox"
                      checked={confirmOriginWeighbridgeCorrection}
                      onChange={event => setConfirmOriginWeighbridgeCorrection(event.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-emerald-700"
                    />
                    <span>ยืนยันว่าตรวจภาพแล้ว และเอกสารนี้เป็นตั๋วชั่งต้นทาง ไม่ใช่ใบส่งของ ใบกำกับภาษี หรือตั๋วชั่งปลายทาง</span>
                  </label>
                  <label className="block text-xs font-semibold text-slate-800" htmlFor="corrected-weighbridge-do">
                    เลือก DO ที่ตรวจสอบแล้ว
                  </label>
                  <select
                    id="corrected-weighbridge-do"
                    value={correctedWeighbridgeDoId}
                    onChange={event => {
                      setCorrectedWeighbridgeDoId(event.target.value);
                      setConfirmOriginWeighbridgeCorrection(false);
                    }}
                    className="min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900"
                    required
                  >
                    <option value="">เลือกเลข TR · เลข DO · ร้านค้า...</option>
                    {eligibleOriginWeighbridgeDOs.map(order => (
                      <option key={order.id} value={order.id}>
                        {order.col1} · DO {order.col6} · {order.col8 || 'ไม่ทราบร้าน'}
                      </option>
                    ))}
                  </select>
                  {eligibleOriginWeighbridgeDOs.length === 0 && (
                    <p className="text-[11px] font-medium text-rose-800" role="status">
                      ไม่มี DO ที่ยืนยันแล้วพร้อมเลข TR ให้เลือก ต้องตรวจรับ DO ก่อนจึงจับคู่ย้อนหลังได้
                    </p>
                  )}
                </section>
              )}
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3">
              
              {/* ==================== LINE OA BOT SOURCE METADATA BANNER (SEPARATE FROM PROJECT col2) ==================== */}
              {(form.lineSenderName || form.lineGroupName) && (
                <div className="p-3 rounded-xl border border-emerald-300 bg-emerald-50/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[10px]">
                      💬 บิลจาก LINE OA Bot
                    </span>
                    {form.lineSenderName && (
                      <span className="text-emerald-950 font-semibold">
                        👤 ผู้ส่ง: <strong className="font-bold">{form.lineSenderName}</strong>
                      </span>
                    )}
                    {form.lineGroupName && (
                      <span className="text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-200 font-medium">
                        👥 กลุ่ม LINE: <strong>{form.lineGroupName}</strong>
                      </span>
                    )}
                    {form.lineReceivedAt && (
                      <span className="text-[11px] text-emerald-700 font-mono">
                        🕒 {new Date(form.lineReceivedAt).toLocaleString('th-TH')}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-200">
                    🔒 เก็บชื่อกลุ่ม LINE แยกต่างหาก (ไม่ผูกเข้าช่อง 2 โครงการอัตโนมัติ)
                  </span>
                </div>
              )}

              {/* ==================== MANDATORY PROJECT (col2) VALIDATION ALERT ==================== */}
              {projectMissingError && (!form.col2 || !form.col2.trim()) && (
                <div className="p-3 rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-950 flex items-center justify-between gap-2 animate-fadeIn">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <div>
                      <div className="font-bold text-xs sm:text-sm">
                        กรุณาระบุหรือเลือก "2. ชื่อโครงการ / หน้างาน" ก่อน{isExistingOrder ? 'บันทึกการแก้ไข' : 'ยืนยันบันทึก'}
                      </div>
                      <p className="text-[11px] text-rose-800">
                        ระบบกำหนดให้ช่องที่ 2 (ชื่อโครงการ) ต้องมีข้อมูลเสมอ และแยกอิสระจากชื่อกลุ่ม LINE เพื่อป้องกันข้อมูลโครงการคลาดเคลื่อนภายหลัง
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-rose-600 text-white text-[10px] font-bold shrink-0">
                    จำเป็นต้องระบุ (ช่อง 2)
                  </span>
                </div>
              )}

              {validationWarnings.length > 0 && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950"
                >
                  <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>พบข้อมูลที่ควรตรวจสอบก่อนยืนยัน (ระบบไม่แก้ค่าให้เอง)</span>
                  </div>
                  <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-[11px]">
                    {validationWarnings.map(warning => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}

              {/* Auto Store Directory Option */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                <div className="text-[11px] text-slate-700">
                  <span className="font-bold">บทบาทคู่ค้าจาก AI: </span>
                  {form.documentIssuerRole === 'supplier_issued'
                    ? 'เอกสารจากผู้ขาย/ร้านค้า'
                    : form.documentIssuerRole === 'buyer_company_issued'
                      ? 'เอกสารจากผู้ซื้อ/บริษัท'
                      : 'ยังยืนยันบทบาทผู้ซื้อ/ผู้ขายไม่ได้'}
                  {Number(form.partyRoleConfidence) > 0 && ` (${Math.round(Number(form.partyRoleConfidence))}%)`}
                  {form.documentIssuerName && ` • ผู้ออกเอกสาร: ${form.documentIssuerName}`}
                </div>
                {form.partyRoleEvidence && (
                  <div className="text-[10px] text-slate-500">
                    หลักฐาน: {form.partyRoleEvidence}
                  </div>
                )}
                <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={saveToStoreDirectory}
                    onChange={(e) => setSaveToStoreDirectory(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>ยืนยันชื่อผู้ขายในช่อง 8 แล้ว และบันทึกลงทะเบียนร้านค้า</span>
                </label>
                <p className="text-[10px] text-slate-500">
                  ระบบไม่เลือกบันทึกให้ล่วงหน้า โปรดตรวจชื่อผู้ขายในช่อง 8 กับภาพเอกสารก่อนเลือกตัวเลือกนี้
                </p>
              </div>

              {/* ==================== AUTO-ACTION VERIFICATION BANNER (MANDATORY HUMAN REVIEW) ==================== */}
              {(form.poMatchStatus === 'auto_flagged' ||
                form.destMatchStatus === 'auto_flagged' ||
                (form.autoActionFlags && form.autoActionFlags.length > 0 && !form.autoFlagsVerified)) && (
                <div className="p-3 rounded-xl border-2 border-amber-400 bg-amber-50/90 text-amber-950 space-y-2 animate-fadeIn">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-bold text-xs flex items-center gap-1.5 text-amber-950">
                        <span>🚩 รายการที่ระบบทำอัตโนมัติ — กรุณาตรวจสอบและยืนยันความถูกต้อง</span>
                      </div>
                      <ul className="list-disc list-inside text-[11px] text-amber-900 space-y-0.5 font-medium">
                        {form.poMatchStatus === 'auto_flagged' && form.col4 && (
                          <li>ชนใบสั่งซื้อ (PO) ช่อง 4 อัตโนมัติตามเลขอ้างอิง: <strong>{form.col4}</strong></li>
                        )}
                        {form.destMatchStatus === 'auto_flagged' && (
                          <li>ชนตั๋วชั่งน้ำหนักปลายทาง โซน 4 อัตโนมัติตามเลขอ้างอิง DO: <strong>{form.col17 || form.linkedViaDocNo}</strong></li>
                        )}
                        {(form.autoActionFlags || []).map((flag, idx) => (
                          <li key={idx}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm(prev => ({
                          ...prev,
                          poMatchStatus: prev.col4 ? 'verified' : prev.poMatchStatus,
                          destMatchStatus: (prev.col17 || Number(prev.col20) > 0 || prev.linkedViaDocNo) ? 'verified' : prev.destMatchStatus,
                          autoFlagsVerified: true
                        }))
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer transition shrink-0"
                    >
                      ✅ ยืนยันความถูกต้องทั้งหมด
                    </button>
                  </div>
                </div>
              )}

              {(form.documentTitle || form.docTypeEvidence) && (
                <div className={`p-2.5 rounded-xl border text-xs space-y-1 ${
                  Number(form.docTypeConfidence) > 0 && Number(form.docTypeConfidence) < 70
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}>
                  <div className="font-bold">
                    ชื่อเอกสารจากภาพ: {form.documentTitle || 'อ่านชื่อหัวเอกสารไม่ชัด'}
                    {Number(form.docTypeConfidence) > 0 && (
                      <span className="ml-2 font-medium">คะแนนที่ AI ประเมิน {form.docTypeConfidence}/100 (ไม่ใช่ค่าความแม่นยำที่สอบเทียบแล้ว)</span>
                    )}
                  </div>
                  {form.docTypeEvidence && <div>หลักฐานที่ AI ใช้: {form.docTypeEvidence}</div>}
                  {Number(form.docTypeConfidence) > 0 && Number(form.docTypeConfidence) < 70 && (
                    <div className="font-semibold">หลักฐานประเภทเอกสารยังไม่ชัด กรุณาตรวจชื่อบนบิลและเลือกประเภทให้ตรงกับเอกสารจริง</div>
                  )}
                </div>
              )}

              {/* Active Document Type Banner */}
              <div className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                selectedDocType === 'delivery_order' ? 'bg-sky-50 border-sky-200 text-sky-900' :
                selectedDocType === 'dest_weighbridge' ? 'bg-teal-50 border-teal-300 text-teal-950' :
                selectedDocType === 'weighbridge' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
                selectedDocType === 'tax_invoice' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                selectedDocType === 'purchase_order' ? 'bg-indigo-50 border-indigo-200 text-indigo-900' :
                'bg-slate-100 border-slate-200 text-slate-800'
              }`}>
                <div className="flex items-center gap-2">
                  {selectedDocType === 'delivery_order' && <Boxes className="w-4 h-4 text-sky-600 shrink-0" />}
                  {(selectedDocType === 'dest_weighbridge' || selectedDocType === 'weighbridge') && <Scale className="w-4 h-4 text-teal-600 shrink-0" />}
                  {selectedDocType === 'tax_invoice' && <Receipt className="w-4 h-4 text-amber-600 shrink-0" />}
                  {selectedDocType === 'purchase_order' && <FileText className="w-4 h-4 text-indigo-600 shrink-0" />}
                  <div>
                    <span className="font-bold block">
                      {selectedDocType === 'delivery_order' ? 'ฟอร์มใบส่งของ (DO) — เก็บตารางหลัก 39 คอลัมน์ (น้ำหนักต้นทาง ช่อง 13, 14, 15)' :
                       selectedDocType === 'dest_weighbridge' ? 'ฟอร์มตั๋วชั่งน้ำหนักปลายทาง — เก็บลง [โซน 4: ช่อง 18, 19, 20] เพื่อชนบิลกับ DO' :
                       selectedDocType === 'weighbridge' ? 'ฟอร์มตั๋วชั่งต้นทาง (ใช้แบบฟอร์มรับใบส่งของ — เก็บลงช่อง 13, 14, 15; ระบบคงชนิดเอกสารจาก OCR)' :
                       selectedDocType === 'tax_invoice' ? 'ฟอร์มใบเสร็จรับเงิน / ใบกำกับภาษี (Tax Invoice)' :
                       selectedDocType === 'purchase_order' ? 'ฟอร์มใบสั่งซื้อสินค้า (PO)' : 'ฟอร์มโลจิสติกส์เต็มรูปแบบ'}
                    </span>
                    <span className="text-[11px] block opacity-80">
                      {showAllCols ? 'แสดงทุกฟิลด์ (ครบ 39 คอลัมน์)' :
                       selectedDocType === 'delivery_order' ? 'แสดงฟิลด์ใบส่งของ (DO) และน้ำหนักต้นทาง ช่อง 13 (หนัก Gross), 14 (เบา Tare), 15 (สุทธิ Net)' :
                       selectedDocType === 'dest_weighbridge' ? 'บันทึก 18. หนักเข้า (Gross), 19. เบาออก (Tare), 20. น้ำหนักสุทธิ (Net) เพื่อนำไปชนกับใบส่งของ (DO)' :
                       selectedDocType === 'weighbridge' ? 'ใช้ข้อมูลต้นทางช่อง 13-15 และคงชนิดเอกสารตั๋วชั่งที่ OCR ตรวจพบ' :
                       selectedDocType === 'tax_invoice' ? 'แสดงเฉพาะเลขผู้เสียภาษี 13 หลัก รายการสินค้า และยอดเงิน (ซ่อนน้ำหนักตราชั่ง)' :
                       'ระบบปรับฟิลด์ตามบริบทเอกสาร'}
                    </span>
                  </div>
                </div>
                {!showAllCols && (
                  <span className="text-[10px] bg-white border border-slate-300 text-slate-700 px-2 py-0.5 rounded-md font-semibold shrink-0 shadow-2xs">
                    ฟอร์มเฉพาะบิล
                  </span>
                )}
              </div>

              {/* Purchase Order Warning / Switch Banner if user selected PO in this modal */}
              {isPO && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs animate-fadeIn">
                  <div className="font-bold text-indigo-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <span>เอกสารนี้เป็น "ใบสั่งซื้อสินค้า (PO)"</span>
                  </div>
                  <p className="text-indigo-800 text-[11px]">
                    ระบบมีโมดูลบริหารจัดการใบสั่งซื้อ (PO Management) โดยเฉพาะที่มีตารางคุมสเปกสินค้า เงื่อนไขตัดส่งมอบ และระบบชนบิลอัตโนมัติ
                  </p>
                  {onSwitchToPO && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchToPO(convertOrderDraftToPODraft(form, currentImage));
                        onClose();
                      }}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer text-xs"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>สลับไปเปิดหน้าต่างจัดการใบสั่งซื้อ (PO Edit View) ทันที</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </button>
                  )}
                </div>
              )}

              {/* ==================== 1. TAILORED FORM FOR DELIVERY ORDER (DO / CONCRETE) ==================== */}
              {!showAllCols && isDeliveryOrder && (
                <div className="space-y-3">
                  {form.lineInboxId && !isExistingOrder && pairedWeighbridgeInboxItem && (
                    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-950">
                        <Scale className="h-4 w-4" />
                        <span>ชุดเอกสารจากกล่องพัก LINE</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-emerald-900">
                        แนบตั๋วชั่งต้นทาง {pairedWeighbridgeInboxItem.extractedData.col6 || '(ไม่มีเลขที่)'} กับ DO นี้เป็นเอกสารแยก; ใช้น้ำหนักจากตั๋วในโซน 3 และคงปริมาณตาม DO หากน้ำหนักใน DO ต่างจากตั๋ว ระบบจะแสดงคำเตือนให้ตรวจสอบ
                      </p>
                    </div>
                  )}
                  {/* Card 1: Document Reference & Site */}
                  <div className="border border-sky-200 rounded-xl p-3 bg-sky-50/20 space-y-2">
                    <div className="font-bold text-sky-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                        <span>[ใบส่งของ] ข้อมูลเอกสาร & โครงการ</span>
                      </span>
                      <span className="text-[11px] text-sky-700 font-mono">DO & Site Details</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-[11px] font-bold text-sky-950 mb-0.5">
                          6. เลขที่ DO / ใบส่งของ (เล่มที่/เลขที่) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col6 || ''}
                          onChange={(e) => handleTextChange('col6', e.target.value)}
                          className="w-full p-2 border border-sky-300 rounded-lg bg-white font-mono font-bold text-sky-900"
                          placeholder="เช่น 03/0125 (เล่มที่/เลขที่) หรือ DO-xxxxx"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="block text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                            <span>4. เลขที่ PO อ้างอิง (เล่มที่/เลขที่)</span>
                            {form.referenceSource === 'handwritten' && (
                              <span className="text-[10px] font-normal text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">✍️ ลายมือ</span>
                            )}
                            {form.referenceSource === 'notes' && (
                              <span className="text-[10px] font-normal text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">💬 ในหมายเหตุ</span>
                            )}
                          </label>
                        </div>
                        <input
                          type="text"
                          value={form.col4 || ''}
                          onChange={(e) => {
                            handleTextChange('col4', e.target.value);
                            handleTextChange('referenceDocNo', e.target.value);
                          }}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono text-slate-800"
                          placeholder="PO-xxxxx (AI เติมให้อัตโนมัติ)"
                        />
                        {pos && pos.length > 0 && (() => {
                          const matchedPO = form.col4
                            ? pos.find(p => isExactDocNumberReference(p.poNumber, form.col4))
                            : undefined;
                          return (
                            <div className="mt-1 space-y-1">
                              {matchedPO && (
                                <div className="px-2 py-1 rounded bg-emerald-50 border border-emerald-300 text-[10px] font-bold text-emerald-800 space-y-0.5">
                                  <div className="flex items-center justify-between gap-1">
                                    <span>✅ ชนกับ PO: {matchedPO.poNumber}</span>
                                    <span className="font-normal text-emerald-700 truncate max-w-[110px]">{matchedPO.storeName}</span>
                                  </div>
                                  {form.col4 && form.col4.trim() !== matchedPO.poNumber && (
                                    <div className="flex items-center justify-between pt-0.5 border-t border-emerald-200/60">
                                      <span className="text-[9px] font-normal text-emerald-700">บิลระบุ "{form.col4}" (ชนอัตโนมัติ)</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleTextChange('col4', matchedPO.poNumber);
                                          handleTextChange('referenceDocNo', matchedPO.poNumber);
                                        }}
                                        className="text-[9px] bg-white hover:bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded border border-emerald-300 font-semibold cursor-pointer"
                                      >
                                        ใช้รหัสเต็ม {matchedPO.poNumber}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                <span>หรือเลือก PO:</span>
                                <select
                                  className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1 py-0.5 max-w-[130px] truncate"
                                  value={matchedPO ? matchedPO.poNumber : (form.col4 || '')}
                                  onChange={(e) => {
                                    const pickedNo = e.target.value;
                                    if (pickedNo) {
                                      const pickedPO = pos.find(p => p.poNumber === pickedNo);
                                      setForm(prev => ({
                                        ...prev,
                                        col4: pickedNo,
                                        referenceDocNo: pickedNo,
                                        col2: (!prev.col2 || prev.col2 === 'โครงการทั่วไป') && pickedPO?.projectId ? pickedPO.projectId : prev.col2,
                                        col3: (!prev.col3 || prev.col3 === 'ทั่วไป' || prev.col3 === 'วัสดุก่อสร้างทั่วไป') && pickedPO?.category ? pickedPO.category : prev.col3,
                                        col8: (!prev.col8 || prev.col8 === 'ไม่ระบุผู้ขาย') && pickedPO?.storeName ? pickedPO.storeName : prev.col8,
                                        col37: !prev.col37 && pickedPO?.deliveryLocation ? pickedPO.deliveryLocation : prev.col37
                                      }));
                                    }
                                  }}
                                >
                                  <option value="">-- เลือก PO ในระบบ --</option>
                                  {pos.map(p => (
                                    <option key={p.id} value={p.poNumber}>
                                      {p.poNumber} ({p.storeName})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">7. วันที่ส่งมอบ</label>
                        <input
                          type="date"
                          value={form.col7 || ''}
                          onChange={(e) => handleTextChange('col7', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          2. โครงการ / หน้างาน <span className="text-rose-500">* (ต้องระบุก่อนบันทึก)</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col2 || ''}
                          onChange={(val) => handleTextChange('col2', val)}
                          onSelectOption={(opt) => {
                            handleTextChange('col2', opt.value);
                            if (!form.col37 && opt.meta?.location) {
                              handleTextChange('col37', opt.meta.location);
                            }
                          }}
                          options={dbCatalog.projects}
                          showStatusBadge={true}
                          fieldLabel="โครงการ"
                          className={`w-full p-2 border rounded-lg bg-white font-semibold ${
                            !form.col2?.trim() ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/30' : 'border-slate-300'
                          }`}
                          placeholder="เลือกหรือพิมพ์ชื่อโครงการ (จำเป็นต้องระบุ)"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="block text-[11px] font-semibold text-slate-700">3. หมวดหมู่ (วัสดุ)</label>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold" title="ระบบวิเคราะห์และดึงให้อัตโนมัติจากชื่อสินค้า ร้านค้า หรือ PO (แก้ไขได้)">
                            ✨ ออโต้
                          </span>
                        </div>
                        <SmartDatabaseInput
                          value={form.col3 || ''}
                          onChange={(val) => handleTextChange('col3', val)}
                          options={dbCatalog.categories}
                          showStatusBadge={false}
                          fieldLabel="หมวดหมู่วัสดุ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-slate-800"
                          placeholder="เช่น หิน/ดิน/ทราย, คอนกรีต, เหล็ก"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">10. ทะเบียนรถขนส่ง</label>
                        <SmartDatabaseInput
                          value={form.col10 || ''}
                          onChange={(val) => handleTextChange('col10', val)}
                          options={dbCatalog.licensePlates}
                          showStatusBadge={true}
                          fieldLabel="ทะเบียนรถ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                          placeholder="เช่น 70-1234 กทม."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Merchant & Goods */}
                  <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2 shadow-2xs">
                    <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                        <span>คู่ค้าผู้จำหน่าย & รายการสินค้าส่งมอบ</span>
                      </span>
                      <span className="text-[11px] text-slate-500">คลิกเพื่อกรองเลือกจากฐานข้อมูล หรือพิมพ์ใหม่</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          8. ผู้จำหน่าย / ร้านค้า <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col8 || ''}
                          onChange={(val) => handleTextChange('col8', val)}
                          onSelectOption={(opt) => {
                            handleTextChange('col8', opt.value);
                            if (opt.meta?.category && (!form.col3 || form.col3 === 'ทั่วไป')) {
                              handleTextChange('col3', opt.meta.category);
                            }
                          }}
                          options={dbCatalog.stores}
                          isStoreField={true}
                          showStatusBadge={true}
                          fieldLabel="ร้านค้า"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                          placeholder="เช่น บจก. สหพาณิชย์ หรือ แพลนท์ CPAC"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                          9. ผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมา
                          {requiresRecipient && <span className="text-rose-500"> *</span>}
                        </label>
                        {isContractorChargeOrder && (
                          <div className="mb-1.5">
                            <label htmlFor="contractor-charge-mode" className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                              สถานะการหักค่าวัสดุ
                            </label>
                            <select
                              id="contractor-charge-mode"
                              value={contractorChargeMode}
                              onChange={event => applyContractorChargeDecisionToAll(
                                event.target.value === 'not_chargeable' ? 'not_chargeable' : 'chargeable'
                              )}
                              className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                            >
                              <option value="chargeable">นำไปหักผู้รับเหมา (ใช้ข้อมูลผู้รับเหมาด้านล่าง)</option>
                              <option value="not_chargeable">ไม่นำหัก (บริษัทซื้อใช้เอง)</option>
                            </select>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              ค่าเริ่มต้นนำไปหักทุกรายการ คุณสามารถเปลี่ยนรายการที่ไม่นำหักได้ด้านล่าง
                            </p>
                          </div>
                        )}
                        <SmartDatabaseInput
                          required={requiresRecipient}
                          value={form.col9 || ''}
                          onChange={(val) => handleTextChange('col9', val)}
                          options={dbCatalog.buyersAndStaff}
                          showStatusBadge={false}
                          fieldLabel="ผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมา"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="ชื่อบริษัทหรือวิศวกรผู้รับของ"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-blue-950 mb-0.5">
                          11. รายการสินค้าหลัก <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col11 || ''}
                          onChange={(val) => {
                            const nextCol3 = inferMaterialCategory(val, undefined, undefined, undefined);
                            setForm(prev => ({
                              ...prev,
                              col11: val,
                              col3: (!prev.col3 || prev.col3 === 'ทั่วไป' || prev.col3 === 'วัสดุก่อสร้างทั่วไป' || nextCol3 !== 'วัสดุก่อสร้างทั่วไป')
                                ? nextCol3
                                : prev.col3
                            }));
                          }}
                          onSelectOption={(opt) => {
                            const inferredCat = inferMaterialCategory(opt.value, undefined, undefined, undefined);
                            const nextForm = {
                              ...form,
                              pairedWeighbridgeInboxId: pairedWeighbridgeInboxId || undefined,
                              col11: opt.value,
                              col3: (!form.col3 || form.col3 === 'ทั่วไป' || form.col3 === 'วัสดุก่อสร้างทั่วไป' || inferredCat !== 'วัสดุก่อสร้างทั่วไป')
                                ? inferredCat
                                : form.col3
                            };
                            if (!nextForm.col12 && opt.meta?.specCode) {
                              nextForm.col12 = opt.meta.specCode;
                            }
                            if ((!nextForm.col23 || nextForm.col23 === 'รายการ') && opt.meta?.unit) {
                              nextForm.col23 = opt.meta.unit;
                            }
                            if (!nextForm.col24 && opt.meta?.unitPrice) {
                              nextForm.col24 = Number(opt.meta.unitPrice) || 0;
                            }
                            recalculateFinancials(nextForm);
                          }}
                          options={poAwareItemOptions}
                          showStatusBadge={true}
                          fieldLabel="รายการสินค้า"
                          className="w-full p-2 border border-blue-300 rounded-lg bg-white font-bold text-blue-900"
                          placeholder="เช่น เหล็กเส้นกลม RB9, ท่อ PVC 2 นิ้ว, 280 KSC Cube"
                        />
                        {/(?:หมายเหตุ|Remark|Note|เงื่อนไข|สถานที่ส่ง|จัดส่งที่|ส่งที่|ติดต่อ|โทร\.?)/i.test(form.col11 || '') && (
                          <div className="mt-1 flex items-center justify-between gap-1 bg-amber-50 border border-amber-200 rounded px-2 py-1 text-[10px] text-amber-900">
                            <span>💡 พบข้อความหมายเหตุปะปนในชื่อสินค้า</span>
                            <button
                              type="button"
                              onClick={() => {
                                const raw = (form.col11 || '').trim();
                                const splitRegex = /^(.*?)(?:\s+[-–—|/]+\s*|\s*[(（]\s*|\s+)((?:หมายเหตุ|Remark|Note|เงื่อนไข|สถานที่ส่ง|จัดส่งที่|ส่งที่|ติดต่อ|โทร\.?).*)$/i;
                                const m = splitRegex.exec(raw);
                                if (m && m[1]?.trim()) {
                                  const cleanName = m[1].trim();
                                  const extracted = m[2].replace(/[)）]$/, '').replace(/^(?:หมายเหตุ|Remark|Note)\s*[:：-]?\s*/i, '').trim();
                                  setForm(prev => ({
                                    ...prev,
                                    col11: cleanName,
                                    col38: prev.col38 ? `${prev.col38} | ${extracted}` : extracted
                                  }));
                                }
                              }}
                              className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold cursor-pointer shrink-0"
                            >
                              ✂️ แยกหมายเหตุไปช่อง 38
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                          12. สเปก / Code / Slump <span className="text-slate-400 font-normal">(ทางเลือก - เว้นว่างได้หากไม่มีสเปกเฉพาะ)</span>
                        </label>
                        <SmartDatabaseInput
                          value={form.col12 || ''}
                          onChange={(val) => handleTextChange('col12', val)}
                          options={dbCatalog.specs}
                          showStatusBadge={false}
                          fieldLabel="สเปก"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono text-slate-700"
                          placeholder="เช่น SD40, Slump 10±2.5 cm, มอก. (หรือเว้นว่างได้)"
                        />
                      </div>
                    </div>

                    {/* Multi-item Breakdown Table (If present) */}
                    {form.lineItems && form.lineItems.length > 0 && (
                      <div className="mt-2.5 p-2 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-800">
                          <span className="flex items-center gap-1.5 text-sky-900">
                            <Boxes className="w-3.5 h-3.5 text-sky-600" />
                            <span>รายการสินค้าย่อยในใบส่งของ ({form.lineItems.length} รายการ)</span>
                          </span>
                          <span className="text-[10px] text-slate-500 font-normal">สามารถคลิกกรองเลือกชื่อสินค้าจากฐานข้อมูล หรือย้ายแถวหมายเหตุออกได้</span>
                        </div>
                        <div className="overflow-visible border border-slate-200 rounded bg-white">
                          <table className="w-full text-[11px] text-left border-collapse">
                            <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                              <tr>
                                <th className="p-1.5 w-8 text-center">#</th>
                                <th className="p-1.5">รายการสินค้า (Description)</th>
                                <th className="p-1.5 w-24">สเปก</th>
                                <th className="p-1.5 text-right w-16">จำนวน</th>
                                <th className="p-1.5 text-center w-20">หน่วย</th>
                                <th className="p-1.5 text-right w-20">ราคา/หน่วย</th>
                                <th className="p-1.5 text-right w-24">รวมเงิน</th>
                                <th className="p-1.5 text-center w-14">จัดการ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {form.lineItems.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50 align-top">
                                  <td className="p-1.5 text-center text-slate-400 font-mono pt-2.5">{idx + 1}</td>
                                  <td className="p-1.5 font-medium text-slate-900">
                                    <SmartDatabaseInput
                                      value={item.itemDescription || ''}
                                      onChange={(val) => {
                                        const nextLines = [...(form.lineItems || [])];
                                        nextLines[idx] = { ...nextLines[idx], itemDescription: val };
                                        setForm(prev => ({ ...prev, lineItems: nextLines }));
                                      }}
                                      onSelectOption={(opt) => {
                                        const nextLines = [...(form.lineItems || [])];
                                        nextLines[idx] = {
                                          ...nextLines[idx],
                                          itemDescription: opt.value,
                                          specCode: nextLines[idx].specCode || opt.meta?.specCode || '',
                                          unit: nextLines[idx].unit || opt.meta?.unit || 'ชิ้น',
                                          unitPrice: nextLines[idx].unitPrice || opt.meta?.unitPrice || 0
                                        };
                                        setForm(prev => ({ ...prev, lineItems: nextLines }));
                                      }}
                                      options={poAwareItemOptions}
                                      showStatusBadge={true}
                                      fieldLabel="สินค้าย่อย"
                                      className="w-full p-1 border border-slate-200 rounded bg-white text-[11px]"
                                    />
                                  </td>
                                  <td className="p-1.5">
                                    <input
                                      type="text"
                                      value={item.specCode || ''}
                                      onChange={(e) => {
                                        const nextLines = [...(form.lineItems || [])];
                                        nextLines[idx] = { ...nextLines[idx], specCode: e.target.value };
                                        setForm(prev => ({ ...prev, lineItems: nextLines }));
                                      }}
                                      className="w-full p-1 border border-slate-200 rounded bg-white font-mono text-[11px]"
                                      placeholder="-"
                                    />
                                  </td>
                                  <td className="p-1.5">
                                    <input
                                      type="number"
                                      step="any"
                                      value={item.qty || 0}
                                      onChange={(e) => {
                                        const q = parseFloat(e.target.value) || 0;
                                        const nextLines = [...(form.lineItems || [])];
                                        const p = Number(nextLines[idx].unitPrice) || 0;
                                        nextLines[idx] = { ...nextLines[idx], qty: q, totalAmount: Number((q * p).toFixed(2)) };
                                        setForm(prev => ({ ...prev, lineItems: nextLines }));
                                      }}
                                      className="w-full p-1 border border-slate-200 rounded bg-white text-right font-mono font-bold text-[11px]"
                                    />
                                  </td>
                                  <td className="p-1.5">
                                    <SmartDatabaseInput
                                      value={item.unit || ''}
                                      onChange={(val) => {
                                        const nextLines = [...(form.lineItems || [])];
                                        nextLines[idx] = { ...nextLines[idx], unit: val };
                                        setForm(prev => ({ ...prev, lineItems: nextLines }));
                                      }}
                                      options={dbCatalog.units}
                                      showStatusBadge={false}
                                      fieldLabel="หน่วย"
                                      className="w-full p-1 border border-slate-200 rounded bg-white text-center text-[11px]"
                                    />
                                  </td>
                                  <td className="p-1.5 text-right font-mono text-slate-700 pt-2">
                                    {item.unitPrice ? `฿${item.unitPrice.toLocaleString()}` : '-'}
                                  </td>
                                  <td className="p-1.5 text-right font-mono font-bold text-slate-900 pt-2">
                                    {item.totalAmount ? `฿${item.totalAmount.toLocaleString()}` : '-'}
                                  </td>
                                  <td className="p-1.5 text-center pt-1.5">
                                    <div className="flex items-center justify-center gap-0.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const textToMove = [item.itemDescription, item.specCode].filter(Boolean).join(' ').trim();
                                          const nextLines = (form.lineItems || []).filter((_, i) => i !== idx);
                                          setForm(prev => ({
                                            ...prev,
                                            lineItems: nextLines,
                                            col38: prev.col38 ? `${prev.col38} | ${textToMove}` : textToMove
                                          }));
                                        }}
                                        className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded transition cursor-pointer"
                                        title="ย้ายแถวนี้ไปไว้ในช่อง 38. หมายเหตุ"
                                      >
                                        💬
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const nextLines = (form.lineItems || []).filter((_, i) => i !== idx);
                                          setForm(prev => ({ ...prev, lineItems: nextLines }));
                                        }}
                                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition cursor-pointer"
                                        title="ลบแถวนี้"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {isContractorChargeOrder && (
                    <section className="mt-3 space-y-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-bold text-violet-950">รายการวัสดุที่นำไปหักผู้รับเหมา</h4>
                          <p className="mt-0.5 text-[10px] text-violet-800">รายการเริ่มต้นนำไปหักผู้รับเหมาตามช่อง 9; เปลี่ยนสถานะเฉพาะรายการที่บริษัทซื้อใช้เองได้</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => applyContractorChargeDecisionToAll('chargeable')}
                            className="rounded-lg bg-violet-700 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
                          >
                            เลือกทั้งหมดเพื่อหัก
                          </button>
                          <button
                            type="button"
                            onClick={() => applyContractorChargeDecisionToAll('not_chargeable')}
                            className="rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-violet-900"
                          >
                            ไม่นำหัก (บริษัทซื้อใช้เอง)
                          </button>
                        </div>
                      </div>

                      <p className="rounded-lg border border-violet-100 bg-white px-2 py-1.5 text-[10px] text-violet-900">
                        ผู้รับเหมาอ้างอิงจากช่อง 9: <strong>{form.col9?.trim() || 'ยังไม่ได้ระบุ'}</strong>
                      </p>

                      <div className="divide-y divide-violet-100 rounded-lg border border-violet-100 bg-white">
                        {contractorChargeItems.map((item, index) => (
                          <div key={item.id || index} className="grid gap-2 p-2 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
                            <div className="min-w-0 text-[11px]">
                              <div className="truncate font-semibold text-slate-800">{item.itemDescription || form.col11 || `รายการ ${index + 1}`}</div>
                              <div className="text-[10px] text-slate-500">{item.qty || form.col22 || 0} {item.unit || form.col23}</div>
                            </div>
                            <select
                              aria-label={`สถานะหักค่าวัสดุรายการ ${item.itemDescription || form.col11 || index + 1}`}
                              value={item.contractorChargeDecision || ''}
                              onChange={event => updateContractorChargeDecision(
                                index,
                                event.target.value as OrderItemDetail['contractorChargeDecision']
                              )}
                              className="rounded-lg border border-slate-300 px-2 py-2 text-[11px]"
                            >
                              <option value="">ยังไม่ระบุ</option>
                              <option value="chargeable">นำไปหักผู้รับเหมา</option>
                              <option value="not_chargeable">ไม่นำหัก (บริษัทซื้อใช้เอง)</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Card 2.5: Optional/Auto-detected Truck Weighing for Delivery Orders that have scale weights */}
                  <div className="border border-emerald-200 rounded-xl p-3 bg-emerald-50/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-emerald-900 text-xs flex items-center gap-1.5">
                        <Scale className="w-4 h-4 text-emerald-600" />
                        <span>[โซน 3] น้ำหนักตราชั่งรถบรรทุก (กรณีสินค้าชั่งน้ำหนัก)</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {renderZoneRescanButton(3)}
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-emerald-900 bg-white px-2.5 py-1 rounded-lg border border-emerald-300 shadow-2xs hover:bg-emerald-50 transition">
                          <input
                            type="checkbox"
                            checked={enableDOWeighing}
                            onChange={(e) => {
                              setEnableDOWeighing(e.target.checked);
                              if (e.target.checked && (!form.col23 || form.col23 === 'รายการ')) {
                                handleTextChange('col23', 'ตัน');
                              }
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
                          />
                          <span>{enableDOWeighing ? 'เปิดบันทึกชั่งน้ำหนักอยู่' : '⚖️ ใบส่งของนี้มีการชั่งน้ำหนักรถบรรทุก'}</span>
                        </label>
                      </div>
                    </div>
                    {renderZoneRescanReview(3)}

                    {enableDOWeighing && (
                      <div className="space-y-2 pt-1 animate-fadeIn">
                        <div className="flex items-center justify-between text-[11px] text-emerald-800 bg-emerald-100/60 px-2.5 py-1 rounded-lg">
                          <span>💡 <strong>หมายเหตุต้นทาง:</strong> บิลโรงโม่มักชั่งรถเปล่าตอนเข้า (Tare) และชั่งรถมีของตอนออก (Gross) ระบบจัดให้ช่อง 13 เป็นค่าหนัก (Gross) เสมอ</span>
                          <button
                            type="button"
                            onClick={handleSwapOriginWeights}
                            className="px-2 py-0.5 bg-white hover:bg-emerald-50 text-emerald-900 border border-emerald-300 rounded font-bold text-[10px] cursor-pointer shrink-0 shadow-2xs transition"
                            title="คลิกเพื่อสลับตัวเลขระหว่างช่อง 13 กับ ช่อง 14"
                          >
                            ⇄ สลับค่า 13 ↔ 14
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                              13. น้ำหนักหนัก / รวมของ (Gross กก.)
                            </label>
                            <input
                              type="number"
                              value={form.col13 !== undefined ? form.col13 : ''}
                              onChange={(e) => handleWeightChange('col13', parseFloat(e.target.value) || 0)}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900 text-sm"
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                              14. น้ำหนักเบา / รถเปล่า (Tare กก.)
                            </label>
                            <input
                              type="number"
                              value={form.col14 !== undefined ? form.col14 : ''}
                              onChange={(e) => handleWeightChange('col14', parseFloat(e.target.value) || 0)}
                              className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900 text-sm"
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-emerald-900 mb-0.5">
                              15. น้ำหนักสุทธิต้นทาง (Net กก.)
                            </label>
                            <input
                              type="number"
                              readOnly
                              value={form.col15 || 0}
                              className="w-full p-2 border border-emerald-400 rounded-lg bg-emerald-100 text-right font-mono font-bold text-emerald-950 text-sm"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] bg-white p-2 rounded-lg border border-emerald-200 text-emerald-900">
                          <span className="flex items-center gap-1 font-medium">
                            <Info className="w-3.5 h-3.5 text-emerald-600" />
                            <span>ระบบคำนวณปริมาณเป็นตันให้อัตโนมัติ:</span>
                          </span>
                          <span className="font-mono font-bold">
                            {((Number(form.col15) || 0) / 1000).toFixed(2)} ตัน (นำเข้าช่องที่ 22)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card 3: Quantity & Billing */}
                  <div className="border border-purple-200 rounded-xl p-3 bg-purple-50/20 space-y-2">
                    <div className="font-bold text-purple-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                        <span>ปริมาณ & จำนวนเงินสินค้า</span>
                      </span>
                      <span className="text-[11px] font-mono font-bold text-purple-800">
                        รวมทั้งสิ้น: ฿{(form.col29 || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          22. ปริมาณ / จำนวน <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={form.col22 !== undefined ? form.col22 : ''}
                          onChange={(e) => handleFinancialChange('col22', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900"
                          placeholder="เช่น 10, 50, 7.5"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">23. หน่วยนับ</label>
                        <SmartDatabaseInput
                          value={form.col23 || ''}
                          onChange={(val) => handleTextChange('col23', val)}
                          options={dbCatalog.units}
                          showStatusBadge={false}
                          fieldLabel="หน่วยนับ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-center font-medium"
                          placeholder="เช่น เส้น, ถุง, คิว, แผ่น, กล่อง"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">24. ราคาต่อหน่วย (บาท)</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col24 !== undefined ? form.col24 : ''}
                          onChange={(e) => handleFinancialChange('col24', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-purple-900 mb-0.5">25. รวมค่าสินค้า (บาท)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col25 || 0}
                          className="w-full p-2 border border-purple-300 rounded-lg bg-purple-50 text-right font-mono font-bold text-purple-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-blue-900 mb-0.5">29. รวมทั้งสิ้น (บาท)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col29 || 0}
                          className="w-full p-2 border border-blue-400 rounded-lg bg-blue-100 text-right font-mono font-bold text-blue-950"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Delivery Location & Notes (Decoupled from Zone 6 Payment) */}
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                    <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
                        <span>สถานที่ส่งมอบ & บันทึกการรับของหน้างาน</span>
                      </span>
                      <span className="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        📌 โซน 6 (การชำระเงิน): จะตรวจรับและตั้งหนี้ในระบบ RR & บัญชี
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                          37. สถานที่ส่งมอบ / จุดเท <span className="text-slate-400 font-normal">(หน้างาน)</span>
                        </label>
                        <SmartDatabaseInput
                          value={form.col37 || ''}
                          onChange={(val) => handleTextChange('col37', val)}
                          options={dbCatalog.locations}
                          showStatusBadge={true}
                          fieldLabel="สถานที่ส่งมอบ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="เช่น อาคาร 2 หรือ จุดเทฐานราก หรือ คลังสินค้าไซต์"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                          38. หมายเหตุการส่งของ / ข้อความกำกับบนบิล
                        </label>
                        <input
                          type="text"
                          value={form.col38 || ''}
                          onChange={(e) => handleTextChange('col38', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="บันทึกหน้างาน หรือข้อความที่พบบนใบส่งของ"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 2A. TAILORED FORM FOR DESTINATION WEIGHBRIDGE TICKET (ตั๋วชั่งน้ำหนัก ช่อง 18-20) ==================== */}
              {!showAllCols && isDestWeighbridge && (
                <div className="space-y-3">
                  {/* Card 1: Destination Ticket Info & Truck */}
                  <div className="border border-teal-300 rounded-xl p-3 bg-teal-50/20 space-y-2">
                    <div className="font-bold text-teal-950 text-xs flex items-center justify-between flex-wrap gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-600"></span>
                        <span>[ตั๋วชั่งน้ำหนัก] ข้อมูลตั๋วชั่งปลายทาง & รถบรรทุก (สำหรับชนบิลเข้า DO)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDocTypeSelect('delivery_order')}
                        className="text-[11px] bg-white hover:bg-sky-50 text-sky-800 border border-sky-300 px-2 py-0.5 rounded-md font-semibold cursor-pointer transition"
                      >
                        สลับเป็นใบส่งของ DO (ชั่งต้นทาง ช่อง 13-15) →
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-teal-950 mb-0.5">
                          17. เลขที่ตั๋วชั่งน้ำหนัก <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col17 || form.col6 || ''}
                          onChange={(e) => {
                            handleTextChange('col17', e.target.value);
                            handleTextChange('col6', e.target.value);
                          }}
                          className="w-full p-2 border border-teal-300 rounded-lg bg-white font-mono font-bold text-teal-900"
                          placeholder="เลขที่ตั๋วชั่ง"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">16. วันที่ชั่งน้ำหนัก</label>
                        <input
                          type="date"
                          value={form.col16 || form.col7 || ''}
                          onChange={(e) => {
                            handleTextChange('col16', e.target.value);
                            handleTextChange('col7', e.target.value);
                          }}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          10. ทะเบียนรถบรรทุก <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col10 || ''}
                          onChange={(val) => handleTextChange('col10', val)}
                          options={dbCatalog.licensePlates}
                          showStatusBadge={true}
                          fieldLabel="ทะเบียนรถ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono font-bold text-blue-800"
                          placeholder="เช่น 70-1234"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-sky-900 mb-0.5">🔗 อ้างอิงเลข DO ในตั๋ว (เพื่อชนอัตโนมัติ)</label>
                        <input
                          type="text"
                          value={form.referenceDocNo || ''}
                          onChange={(e) => handleTextChange('referenceDocNo', e.target.value)}
                          className="w-full p-2 border border-sky-300 rounded-lg bg-white font-mono text-sky-900"
                          placeholder="เลข DO ในตั๋ว หรือเว้นว่างเพื่อชนด้วยมือ"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">8. ร้านค้า / แหล่งที่มา</label>
                        <SmartDatabaseInput
                          value={form.col8 || ''}
                          onChange={(val) => handleTextChange('col8', val)}
                          options={dbCatalog.stores}
                          isStoreField={true}
                          showStatusBadge={true}
                          fieldLabel="ร้านค้า"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                          placeholder="ชื่อร้านค้า หรือ โรงโม่ต้นทาง"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-teal-950 mb-0.5">11. ชนิดสินค้า</label>
                        <SmartDatabaseInput
                          value={form.col11 || ''}
                          onChange={(val) => handleTextChange('col11', val)}
                          options={poAwareItemOptions}
                          showStatusBadge={true}
                          fieldLabel="ชนิดสินค้า"
                          className="w-full p-2 border border-teal-300 rounded-lg bg-white font-bold text-teal-900"
                          placeholder="เช่น หินคลุก, ทรายหยาบ, ดินถม"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          2. โครงการ / หน้างาน <span className="text-rose-500">* (ต้องระบุก่อนบันทึก)</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col2 || ''}
                          onChange={(val) => handleTextChange('col2', val)}
                          onSelectOption={(opt) => {
                            handleTextChange('col2', opt.value);
                            if (!form.col37 && opt.meta?.location) {
                              handleTextChange('col37', opt.meta.location);
                            }
                          }}
                          options={dbCatalog.projects}
                          showStatusBadge={true}
                          fieldLabel="โครงการ"
                          className={`w-full p-2 border rounded-lg bg-white font-semibold ${
                            !form.col2?.trim() ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/30' : 'border-slate-300'
                          }`}
                          placeholder="เลือกหรือพิมพ์ชื่อโครงการ (จำเป็นต้องระบุ)"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Zone 4 Destination Scale Weights (Col 18, 19, 20) */}
                  <div className="border border-teal-400 rounded-xl p-3.5 bg-teal-50/50 space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                        <Scale className="w-4 h-4 text-teal-600" />
                        <span>[โซน 4] ส่วนเก็บน้ำหนักตั๋วชั่ง (ช่อง 18, 19, 20)</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {renderZoneRescanButton(4)}
                        <button
                          type="button"
                          onClick={handleSwapDestWeights}
                          className="px-2.5 py-1 bg-white hover:bg-teal-50 text-teal-900 border border-teal-300 rounded-lg font-bold text-[11px] cursor-pointer shadow-2xs transition"
                          title="คลิกเพื่อสลับตัวเลขระหว่างช่อง 18 กับ ช่อง 19"
                        >
                          ⇄ สลับค่า 18 ↔ 19
                        </button>
                      </div>
                    </div>
                    {renderZoneRescanReview(4)}

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          18. หนักเข้า (Gross กก.)
                        </label>
                        <input
                          type="number"
                          value={form.col18 !== undefined ? form.col18 : ''}
                          onChange={(e) => handleWeightChange('col18', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-teal-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900 text-sm"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          19. เบาออก (Tare กก.)
                        </label>
                        <input
                          type="number"
                          value={form.col19 !== undefined ? form.col19 : ''}
                          onChange={(e) => handleWeightChange('col19', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-teal-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900 text-sm"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-teal-950 mb-0.5">
                          20. น้ำหนักสุทธิ (Net กก.)
                        </label>
                        <input
                          type="number"
                          readOnly
                          value={form.col20 || 0}
                          className="w-full p-2 border border-teal-500 rounded-lg bg-teal-100 text-right font-mono font-bold text-teal-950 text-sm"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white p-2 rounded-lg border border-teal-200 text-teal-900">
                      <span className="flex items-center gap-1 font-medium">
                        <Info className="w-3.5 h-3.5 text-teal-600" />
                        <span>เมื่อบันทึกแล้ว ระบบจะนำไปชนกับน้ำหนักต้นทางในใบส่งของ (DO ช่อง 15) เพื่อคำนวณผลต่าง (ช่อง 21)</span>
                      </span>
                      <span className="font-mono font-bold">
                        {((Number(form.col20) || 0) / 1000).toFixed(2)} ตัน
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 2B. TAILORED FORM FOR ORIGIN WEIGHBRIDGE TICKET (กรณีใช้แทน DO ช่อง 13-15) ==================== */}
              {!showAllCols && isWeighbridge && (
                <div className="space-y-3">
                  {/* Card 1: Ticket & Truck */}
                  <div className="border border-emerald-200 rounded-xl p-3 bg-emerald-50/20 space-y-2">
                    <div className="font-bold text-emerald-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <span>[ตั๋วชั่ง] ข้อมูลตั๋ว & รถบรรทุก</span>
                      </span>
                      <span className="text-[11px] text-emerald-700 font-mono">Weighbridge Ticket</span>
                    </div>

                    {/* 3-Way Supply Chain Matching Helper Banner */}
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                      <Link2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold text-emerald-950">การชนบิล 3 ฝ่าย (PO ↔ DO ↔ ตั๋วชั่ง):</span>
                        <p className="text-[11px] text-emerald-800 leading-relaxed">
                          ตั๋วชั่งน้ำหนักส่วนใหญ่จะอ้างอิงไปหา <strong>เลขที่ใบส่งของ (DO)</strong> หรือมีลายมือเขียนเลข PO กำกับไว้ในบิล — กรุณาตรวจทานเลขอ้างอิงด้านล่างเพื่อเชื่อมโยงตัดยอดส่งมอบอัตโนมัติ
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-emerald-950 mb-0.5">
                          6. เลขที่ตั๋วชั่ง <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col6 || ''}
                          onChange={(e) => handleTextChange('col6', e.target.value)}
                          className="w-full p-2 border border-emerald-300 rounded-lg bg-white font-mono font-bold text-emerald-900"
                          placeholder="WB-xxxxx หรือ เลขที่ตั๋ว"
                        />
                      </div>

                      {/* Reference to Delivery Order (DO) */}
                      <div className="border border-sky-200 p-2 rounded-lg bg-sky-50/40">
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="block text-[11px] font-bold text-sky-950 flex items-center gap-1.5">
                            <span>🔗 เลขที่ใบส่งของ (DO) อ้างอิง</span>
                            {form.referenceSource === 'handwritten' && (
                              <span className="text-[10px] font-normal text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">✍️ ลายมือ</span>
                            )}
                            {form.referenceSource === 'notes' && (
                              <span className="text-[10px] font-normal text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">💬 ในหมายเหตุ</span>
                            )}
                          </label>
                        </div>
                        <input
                          type="text"
                          value={form.referenceDocNo || ''}
                          onChange={(e) => handleTextChange('referenceDocNo', e.target.value)}
                          className="w-full p-2 border border-sky-300 rounded-lg bg-white font-mono font-semibold text-sky-900"
                          placeholder="DO-xxxxx (AI เติมให้อัตโนมัติ)"
                        />
                        {existingOrders && existingOrders.filter(o => o.docType === 'delivery_order' || o.col6).length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                            <span>หรือเลือก DO:</span>
                            <select
                              className="text-[10px] bg-white border border-slate-200 rounded px-1 py-0.5 max-w-[130px] truncate"
                              value={form.referenceDocNo || ''}
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleTextChange('referenceDocNo', e.target.value);
                                }
                              }}
                            >
                              <option value="">-- เลือก DO ในระบบ --</option>
                              {existingOrders.filter(o => o.col6).map(o => (
                                <option key={o.id} value={o.col6}>
                                  {o.col6} ({o.col8 || o.col11})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">4. เลขที่ PO อ้างอิง (ถ้ามี)</label>
                        <input
                          type="text"
                          value={form.col4 || ''}
                          onChange={(e) => handleTextChange('col4', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono text-slate-800"
                          placeholder="PO-xxxxx (ถ้ามีเขียนไว้)"
                        />
                        {pos && pos.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                            <span>เลือก PO:</span>
                            <select
                              className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1 py-0.5 max-w-[120px] truncate"
                              value={form.col4 || ''}
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleTextChange('col4', e.target.value);
                                }
                              }}
                            >
                              <option value="">-- PO ในระบบ --</option>
                              {pos.map(p => (
                                <option key={p.id} value={p.poNumber}>
                                  {p.poNumber}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">7. วันที่ชั่ง</label>
                        <input
                          type="date"
                          value={form.col7 || ''}
                          onChange={(e) => handleTextChange('col7', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          10. ทะเบียนรถบรรทุก <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col10 || ''}
                          onChange={(e) => handleTextChange('col10', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono font-bold text-slate-900"
                          placeholder="เช่น 70-1234 กทม."
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          8. โรงโม่ / ลานทราย / ผู้จำหน่าย <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col8 || ''}
                          onChange={(e) => handleTextChange('col8', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                          placeholder="ชื่อโรงโม่หิน หรือ ท่าทราย"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-emerald-950 mb-0.5">
                          11. ชนิดสินค้า <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col11 || ''}
                          onChange={(e) => handleTextChange('col11', e.target.value)}
                          className="w-full p-2 border border-emerald-300 rounded-lg bg-white font-bold text-emerald-900"
                          placeholder="เช่น หินคลุก, หิน 1, ทรายหยาบ, ดินถม"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          2. โครงการ / หน้างาน <span className="text-rose-500">* (ต้องระบุก่อนบันทึก)</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col2 || ''}
                          onChange={(val) => handleTextChange('col2', val)}
                          options={dbCatalog.projects}
                          showStatusBadge={true}
                          fieldLabel="โครงการ"
                          className={`w-full p-2 border rounded-lg bg-white font-semibold ${
                            !form.col2?.trim() ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/30' : 'border-slate-300'
                          }`}
                          placeholder="เลือกหรือพิมพ์ชื่อโครงการ"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Zone 3 Origin Scale Weights */}
                  <div className="border border-emerald-300 rounded-xl p-3 bg-emerald-50/40 space-y-2 shadow-2xs">
                    <div className="font-bold text-emerald-950 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Scale className="w-4 h-4 text-emerald-600" />
                        <span>[โซน 3] น้ำหนักตราชั่งรถบรรทุก (ต้นทาง)</span>
                      </span>
                      <span className="text-[11px] text-emerald-800 font-mono font-semibold">
                        หนักเข้า - เบาออก = น้ำหนักสุทธิ (กก.)
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          13. หนักเข้า (Gross กก.)
                        </label>
                        <input
                          type="number"
                          value={form.col13 !== undefined ? form.col13 : ''}
                          onChange={(e) => handleWeightChange('col13', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900 text-sm"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                          14. เบาออก (Tare กก.)
                        </label>
                        <input
                          type="number"
                          value={form.col14 !== undefined ? form.col14 : ''}
                          onChange={(e) => handleWeightChange('col14', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900 text-sm"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-emerald-900 mb-0.5">
                          15. น้ำหนักสุทธิ (Net กก.)
                        </label>
                        <input
                          type="number"
                          readOnly
                          value={form.col15 || 0}
                          className="w-full p-2 border border-emerald-400 rounded-lg bg-emerald-100 text-right font-mono font-bold text-emerald-950 text-sm"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] bg-white p-2 rounded-lg border border-emerald-200 text-emerald-900">
                      <span className="flex items-center gap-1 font-medium">
                        <Info className="w-3.5 h-3.5 text-emerald-600" />
                        <span>ระบบคำนวณปริมาณเป็นตันให้อัตโนมัติ:</span>
                      </span>
                      <span className="font-mono font-bold">
                        {((Number(form.col15) || 0) / 1000).toFixed(2)} ตัน (นำเข้าช่องที่ 22)
                      </span>
                    </div>

                    {/* Zone 4 Optional Control: Prevents duplication of Zone 3 */}
                    <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between">
                      <div className="text-[11px] text-slate-600 flex items-center gap-1.5">
                        <Scale className="w-3.5 h-3.5 text-slate-500" />
                        <span>หน้างานมีตราชั่งปลายทางหรือไม่?</span>
                        <span className="text-[10px] text-slate-500 hidden sm:inline">(ปกติชั่งเฉพาะต้นทาง ปิดไว้เพื่อไม่ให้ข้อมูลซ้ำซ้อน)</span>
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-emerald-900 bg-white px-2.5 py-1 rounded-lg border border-emerald-300 shadow-2xs hover:bg-emerald-50 transition">
                        <input
                          type="checkbox"
                          checked={enableDestScale}
                          onChange={(e) => setEnableDestScale(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>เปิดบันทึกชั่งปลายทาง & ผลต่าง</span>
                      </label>
                    </div>

                    {/* Zone 4: Shown ONLY IF explicitly enabled by user */}
                    {enableDestScale && (
                      <div className="mt-2 p-2.5 bg-teal-50 rounded-lg border border-teal-300 space-y-2 animate-fadeIn">
                        <div className="font-bold text-teal-900 text-xs flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-teal-600"></span>
                            <span>[โซน 4] น้ำหนักชั่งตรวจรับปลายทาง ณ ไซต์งาน</span>
                          </span>
                          <span className="text-[11px] font-mono font-bold text-rose-600">
                            ผลต่างตกหล่น (ต้นทาง - ปลายทาง): {form.col21 || 0} กก.
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">18. หนักปลายทาง (กก.)</label>
                            <input
                              type="number"
                              value={form.col18 !== undefined ? form.col18 : ''}
                              onChange={(e) => handleWeightChange('col18', parseFloat(e.target.value) || 0)}
                              className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">19. เบาปลายทาง (กก.)</label>
                            <input
                              type="number"
                              value={form.col19 !== undefined ? form.col19 : ''}
                              onChange={(e) => handleWeightChange('col19', parseFloat(e.target.value) || 0)}
                              className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-teal-900 mb-0.5">20. สุทธิปลายทาง (กก.)</label>
                            <input
                              type="number"
                              readOnly
                              value={form.col20 || 0}
                              className="w-full p-1.5 border border-teal-300 rounded-lg bg-teal-100 text-right font-mono font-bold text-teal-950"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card 3: Delivered Inbound Tonnage (Decoupled from RR Zone 5 Pricing & Zone 6 Payments) */}
                  <div className="border border-emerald-300 rounded-xl p-3 bg-emerald-50/20 space-y-2.5">
                    <div className="font-bold text-emerald-950 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                        <span>[ตัดยอดส่งมอบ] ปริมาณรับเข้าหน้างานจริง (ตัน)</span>
                      </span>
                      <span className="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        📌 โซน 5 (คิดราคา) & โซน 6 (การชำระเงิน): จะคำนวณในระบบ RR
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="bg-white p-2.5 rounded-lg border border-emerald-200 flex items-center justify-between">
                        <div>
                          <label className="block text-[11px] font-bold text-emerald-950">
                            22. ปริมาณสุทธิส่งมอบ (ตัน) <span className="text-rose-500">*</span>
                          </label>
                          <span className="text-[10px] text-emerald-700">แปลงจากน้ำหนักสุทธิ กก. (col15 / 1000)</span>
                        </div>
                        <input
                          type="number"
                          step="any"
                          required
                          value={form.col22 !== undefined ? form.col22 : ''}
                          onChange={(e) => handleFinancialChange('col22', parseFloat(e.target.value) || 0)}
                          className="w-32 p-1.5 border border-emerald-300 rounded-lg bg-emerald-50 text-right font-mono font-bold text-emerald-950 text-base"
                        />
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            26. ประเภทรถบรรทุก
                          </label>
                          <span className="text-[10px] text-slate-500">สำหรับตรวจสอบขนาดบรรทุก</span>
                        </div>
                        <input
                          type="text"
                          value={form.col26 || ''}
                          onChange={(e) => handleTextChange('col26', e.target.value)}
                          className="w-36 p-1.5 border border-slate-300 rounded-lg bg-white text-xs font-medium"
                          placeholder="พ่วง 18 ล้อ, สิบล้อ"
                        />
                      </div>
                    </div>

                    {/* Optional Pricing Accordion: Only if user explicitly wants to enter price on this ticket */}
                    <div className="pt-2 border-t border-emerald-200/60">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setEnableWeighbridgePricing(!enableWeighbridgePricing)}
                          className="text-xs text-emerald-800 font-semibold flex items-center gap-1.5 hover:text-emerald-950 transition cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{enableWeighbridgePricing ? 'ซ่อนการระบุราคา/ค่าขนส่ง' : '⚙️ บันทึกราคาหรือค่าขนส่งเพิ่มเติมในตั๋วนี้ (ทางเลือกเฉพาะกรณีตั๋วระบุราคา)'}</span>
                        </button>
                        {enableWeighbridgePricing && (
                          <span className="text-[11px] font-mono font-bold text-blue-700">
                            รวมทั้งสิ้น: ฿{(form.col29 || 0).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {enableWeighbridgePricing && (
                        <div className="mt-2 p-2.5 bg-white rounded-lg border border-purple-200 space-y-2 animate-fadeIn">
                          <div className="text-[11px] text-purple-900 font-semibold">
                            การคิดราคาและค่าขนส่งต่อตัน (ระบบ RR):
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">24. ราคาหิน/ทรายต่อตัน (บาท)</label>
                              <input
                                type="number"
                                step="any"
                                value={form.col24 !== undefined ? form.col24 : ''}
                                onChange={(e) => handleFinancialChange('col24', parseFloat(e.target.value) || 0)}
                                className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono text-xs"
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-700 mb-0.5">27. ค่าขนส่ง/ตัน (บาท)</label>
                              <input
                                type="number"
                                step="any"
                                value={form.col27 !== undefined ? form.col27 : ''}
                                onChange={(e) => handleFinancialChange('col27', parseFloat(e.target.value) || 0)}
                                className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono text-xs"
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-purple-900 mb-0.5">25. รวมค่าสินค้า (บาท)</label>
                              <input
                                type="number"
                                readOnly
                                value={form.col25 || 0}
                                className="w-full p-1.5 border border-purple-200 rounded-lg bg-purple-50 text-right font-mono text-xs text-purple-950 font-bold"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-blue-900 mb-0.5">29. รวมทั้งสิ้น (บาท)</label>
                              <input
                                type="number"
                                readOnly
                                value={form.col29 || 0}
                                className="w-full p-1.5 border border-blue-300 rounded-lg bg-blue-50 text-right font-mono text-xs text-blue-950 font-bold"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card 4: Location & Notes */}
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                    <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
                        <span>สถานที่ส่งมอบ & บันทึกตั๋วชั่ง</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">37. จุดลงหิน/ทราย / กม.</label>
                        <input
                          type="text"
                          value={form.col37 || ''}
                          onChange={(e) => handleTextChange('col37', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="เช่น กองหิน กม. 12+400 หรือ แพลนท์ผสม"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">38. หมายเหตุ</label>
                        <input
                          type="text"
                          value={form.col38 || ''}
                          onChange={(e) => handleTextChange('col38', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="บันทึกหน้างาน"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 3. TAILORED FORM FOR TAX INVOICE (ใบเสร็จ/ใบกำกับภาษี) ==================== */}
              {!showAllCols && isTaxInvoice && (
                <div className="space-y-3">
                  {/* Card 1: Tax Invoice Info & Merchant */}
                  <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/20 space-y-2">
                    <div className="font-bold text-amber-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                        <span>[ใบเสร็จ/กำกับภาษี] ข้อมูลเอกสาร & คู่ค้า</span>
                      </span>
                      <span className="text-[11px] text-amber-700 font-mono">Tax Invoice & VAT</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-amber-950 mb-0.5">
                          6. เลขที่ใบกำกับภาษี / ใบเสร็จ <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={form.col6 || ''}
                          onChange={(e) => handleTextChange('col6', e.target.value)}
                          className="w-full p-2 border border-amber-300 rounded-lg bg-white font-mono font-bold text-amber-900"
                          placeholder="INV-xxxxx หรือ TAX-xxxxx"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">4. เลขที่ PO อ้างอิง</label>
                        <input
                          type="text"
                          value={form.col4 || ''}
                          onChange={(e) => handleTextChange('col4', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono text-slate-800"
                          placeholder="PO-xxxxx (ถ้ามี)"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">7. วันที่ออกเอกสาร</label>
                        <input
                          type="date"
                          value={form.col7 || ''}
                          onChange={(e) => handleTextChange('col7', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">เลขประจำตัวผู้เสียภาษี 13 หลัก</label>
                        <input
                          type="text"
                          value={storeSuggestion?.taxId || ''}
                          readOnly
                          className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 font-mono text-slate-800"
                          placeholder="เลขผู้เสียภาษี 13 หลัก"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          8. ชื่อบริษัทผู้ขาย / ร้านค้า <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col8 || ''}
                          onChange={(val) => handleTextChange('col8', val)}
                          options={dbCatalog.stores}
                          isStoreField={true}
                          showStatusBadge={true}
                          fieldLabel="ร้านค้า"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                          placeholder="ชื่อบริษัทผู้ออกใบกำกับภาษี"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          2. โครงการ / หน้างาน <span className="text-rose-500">* (ต้องระบุ)</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col2 || ''}
                          onChange={(val) => handleTextChange('col2', val)}
                          options={dbCatalog.projects}
                          showStatusBadge={true}
                          fieldLabel="โครงการ"
                          className={`w-full p-2 border rounded-lg bg-white font-semibold ${
                            !form.col2?.trim() ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/30' : 'border-slate-300'
                          }`}
                          placeholder="เลือกหรือพิมพ์ชื่อโครงการ (จำเป็น)"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                          9. ผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมา
                        </label>
                        <SmartDatabaseInput
                          value={form.col9 || ''}
                          onChange={(val) => handleTextChange('col9', val)}
                          options={dbCatalog.buyersAndStaff}
                          showStatusBadge={false}
                          fieldLabel="ผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมา"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="ชื่อบริษัทผู้ซื้อ หรือ ผู้เบิก"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Items & Financials */}
                  <div className="border border-purple-200 rounded-xl p-3 bg-purple-50/20 space-y-2">
                    <div className="font-bold text-purple-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                        <span>รายการสินค้า & ยอดเงินภาษี</span>
                      </span>
                      <span className="text-[11px] font-mono font-bold text-blue-800">
                        ยอดรวมสุทธิ: ฿{(form.col29 || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-blue-950 mb-0.5">
                          11. รายการสินค้า / บริการ <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col11 || ''}
                          onChange={(val) => handleTextChange('col11', val)}
                          options={poAwareItemOptions}
                          showStatusBadge={true}
                          fieldLabel="รายการสินค้า"
                          className="w-full p-2 border border-blue-300 rounded-lg bg-white font-bold text-blue-900"
                          placeholder="รายละเอียดสินค้าหรือบริการตามใบเสร็จ"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">22. จำนวน</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col22 !== undefined ? form.col22 : ''}
                          onChange={(e) => handleFinancialChange('col22', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">23. หน่วย</label>
                        <SmartDatabaseInput
                          value={form.col23 || ''}
                          onChange={(val) => handleTextChange('col23', val)}
                          options={dbCatalog.units}
                          showStatusBadge={false}
                          fieldLabel="หน่วยนับ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-center font-medium"
                          placeholder="รายการ, ชิ้น, งาน"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-purple-900 mb-0.5">25. มูลค่าก่อนภาษี (บาท)</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col25 !== undefined ? form.col25 : ''}
                          onChange={(e) => setForm(prev => ({ ...prev, col25: parseFloat(e.target.value) || 0 }))}
                          className="w-full p-2 border border-purple-300 rounded-lg bg-purple-50 text-right font-mono font-bold text-purple-900"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="block text-[11px] font-bold text-blue-900 mb-0.5">
                          29. ยอดรวมสุทธิทั้งสิ้น (รวมภาษีมูลค่าเพิ่ม) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={form.col29 !== undefined ? form.col29 : ''}
                          onChange={(e) => setForm(prev => ({ ...prev, col29: parseFloat(e.target.value) || 0 }))}
                          className="w-full p-2 border border-blue-400 rounded-lg bg-blue-100 text-right font-mono font-bold text-blue-950 text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Payment Status */}
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                    <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
                        <span>เงื่อนไขและการชำระเงิน</span>
                      </span>
                      <span className="text-[11px] font-mono font-bold text-rose-700">
                        คงค้างชำระ: ฿{(form.col36 || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">30. รูปแบบการชำระ</label>
                        <select
                          value={form.col30 || ''}
                          onChange={(e) => handleTextChange('col30', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-xs"
                        >
                          <option value="">ยังไม่ระบุ</option>
                          <option value="โอนเงิน">โอนเงินธนาคาร</option>
                          <option value="เงินสด">เงินสด</option>
                          <option value="เช็ค">เช็คสั่งจ่าย</option>
                          <option value="เครดิต 30 วัน">เครดิต 30 วัน</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">31. ชำระให้ผู้จำหน่ายแล้ว</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col31 !== undefined ? form.col31 : ''}
                          onChange={(e) => handleFinancialChange('col31', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-800 mb-0.5">35. ยอดชำระแล้วรวม</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col35 !== undefined ? form.col35 : ''}
                          onChange={(e) => handleFinancialChange('col35', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-emerald-300 rounded-lg bg-emerald-50 text-right font-mono font-bold text-emerald-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-rose-800 mb-0.5">36. ยอดคงค้างชำระ</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col36 || 0}
                          className="w-full p-2 border border-rose-300 rounded-lg bg-rose-50 text-right font-mono font-bold text-rose-900"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ==================== 4. COMPLETE 39-COLUMN FULL FORM (WHEN showAllCols IS TOGGLED) ==================== */}
              {(showAllCols || isFullLogistics) && (
                <div className="space-y-3">
                  {/* Zone 1: Reference & Project */}
                  <div className="border border-orange-200 rounded-xl p-3 bg-orange-50/20 space-y-2">
                    <div className="font-bold text-orange-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
                        <span>[โซน 1] เอกสารอ้างอิงหลัก & โครงการ (คอลัมน์ 1 - 6)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {renderZoneRescanButton(1)}
                        <span className="text-[11px] text-orange-700 font-mono">Reference & Logistics</span>
                      </div>
                    </div>
                    {renderZoneRescanReview(1)}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">1. เลข TR</label>
                        <input
                          type="text"
                          value={form.col1 || ''}
                          readOnly
                          aria-readonly="true"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-slate-100 font-mono text-slate-700"
                        />
                        <p className="mt-1 text-[10px] text-slate-500">
                          {isExistingOrder
                            ? 'เลข TR ที่บันทึกแล้วไม่สามารถแก้ไขได้'
                            : 'ระบบจะกำหนดเลขจากฐานข้อมูลเมื่อยืนยัน โดยเข้าคิวป้องกันเลขซ้ำ'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          2. โครงการ / หน้างาน <span className="text-rose-500">* (ต้องระบุ)</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col2 || ''}
                          onChange={(val) => handleTextChange('col2', val)}
                          options={dbCatalog.projects}
                          showStatusBadge={true}
                          fieldLabel="โครงการ"
                          className={`w-full p-2 border rounded-lg bg-white font-semibold ${
                            !form.col2?.trim() ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/30' : 'border-slate-300'
                          }`}
                          placeholder="เลือกหรือพิมพ์ชื่อโครงการ (จำเป็น)"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">3. หมวดหมู่</label>
                        <input
                          type="text"
                          value={form.col3 || ''}
                          onChange={(e) => handleTextChange('col3', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="เช่น งานเหล็ก, คอนกรีต, หิน/ทราย"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">4. เลขที่ PO</label>
                        <input
                          type="text"
                          value={form.col4 || ''}
                          onChange={(e) => handleTextChange('col4', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                          placeholder="PO-xxxxx"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5" title="สำหรับระบบรับวางบิลในอนาคต (โซน 5-6) ไม่ใช้ชนบิลโซน 1-4">
                          5. เลขที่ RR (ระบบรับวางบิลในอนาคต)
                        </label>
                        <input
                          type="text"
                          value={form.col5 || ''}
                          onChange={(e) => handleTextChange('col5', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                          placeholder="RR-xxxxx (ระบบรับวางบิล)"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-orange-950 mb-0.5">
                          6. DO / เลขที่ตั๋ว / ใบส่งของ <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={form.col6 || ''}
                          onChange={(e) => handleTextChange('col6', e.target.value)}
                          className="w-full p-2 border border-orange-300 rounded-lg bg-white font-mono font-bold text-orange-900"
                          placeholder="DO-xxxxx หรือ เลขที่บิล"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Zone 2: Date, Merchant & Goods */}
                  <div className="border border-sky-200 rounded-xl p-3 bg-sky-50/20 space-y-2">
                    <div className="font-bold text-sky-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                        <span>[โซน 2] วันที่ ร้านค้าผู้จำหน่าย & รายการสินค้า (คอลัมน์ 7 - 12)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {renderZoneRescanButton(2)}
                        <span className="text-[11px] text-sky-700">Merchant & Products</span>
                      </div>
                    </div>
                    {renderZoneRescanReview(2)}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">7. วันที่ (YYYY-MM-DD)</label>
                        <input
                          type="date"
                          value={form.col7 || ''}
                          onChange={(e) => handleTextChange('col7', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-800 mb-0.5">
                          8. ผู้จำหน่าย / ร้านค้า <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col8 || ''}
                          onChange={(val) => handleTextChange('col8', val)}
                          options={dbCatalog.stores}
                          isStoreField={true}
                          showStatusBadge={true}
                          fieldLabel="ร้านค้า"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          9. ผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมา
                          {requiresRecipient && <span className="text-rose-500"> *</span>}
                        </label>
                        <SmartDatabaseInput
                          required={requiresRecipient}
                          value={form.col9 || ''}
                          onChange={(val) => handleTextChange('col9', val)}
                          options={dbCatalog.buyersAndStaff}
                          showStatusBadge={false}
                          fieldLabel="ผู้รับสินค้า / ผู้ซื้อ / ผู้รับเหมา"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">10. ทะเบียนรถขนส่ง</label>
                        <SmartDatabaseInput
                          value={form.col10 || ''}
                          onChange={(val) => handleTextChange('col10', val)}
                          options={dbCatalog.licensePlates}
                          showStatusBadge={true}
                          fieldLabel="ทะเบียนรถ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-blue-950 mb-0.5">
                          11. รายการสินค้า <span className="text-rose-500">*</span>
                        </label>
                        <SmartDatabaseInput
                          required
                          value={form.col11 || ''}
                          onChange={(val) => handleTextChange('col11', val)}
                          options={poAwareItemOptions}
                          showStatusBadge={true}
                          fieldLabel="รายการสินค้า"
                          className="w-full p-2 border border-blue-300 rounded-lg bg-white font-bold text-blue-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">12. สเปก / Code / Slump</label>
                        <SmartDatabaseInput
                          value={form.col12 || ''}
                          onChange={(val) => handleTextChange('col12', val)}
                          options={dbCatalog.specs}
                          showStatusBadge={false}
                          fieldLabel="สเปก"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Zone 3: Origin Weights */}
                  <div className="border border-emerald-200 rounded-xl p-3 bg-emerald-50/20 space-y-2">
                    <div className="font-bold text-emerald-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <span>[โซน 3] น้ำหนักต้นทางจากตราชั่งรถบรรทุก (คอลัมน์ 13 - 15)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {renderZoneRescanButton(3)}
                        <span className="text-[11px] text-emerald-700 font-mono">Gross - Tare = Net Weight</span>
                      </div>
                    </div>
                    {renderZoneRescanReview(3)}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">13. หนักเข้า (Gross กก.)</label>
                        <input
                          type="number"
                          value={form.col13 !== undefined ? form.col13 : ''}
                          onChange={(e) => handleWeightChange('col13', parseFloat(e.target.value) || 0)}
                          className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">14. เบาออก (Tare กก.)</label>
                        <input
                          type="number"
                          value={form.col14 !== undefined ? form.col14 : ''}
                          onChange={(e) => handleWeightChange('col14', parseFloat(e.target.value) || 0)}
                          className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-800 mb-0.5">15. สุทธิ (Net กก.)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col15 || 0}
                          className="w-full p-1.5 border border-emerald-300 rounded-lg bg-emerald-50 text-right font-mono font-bold text-emerald-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Zone 4: Destination Weights */}
                  <div className="border border-teal-200 rounded-xl p-3 bg-teal-50/20 space-y-2">
                    <div className="font-bold text-teal-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
                        <span>[โซน 4] น้ำหนักปลายทางหน้างาน & ผลต่างน้ำหนัก (คอลัมน์ 16 - 21)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {renderZoneRescanButton(4)}
                        <span className="text-[10px] font-mono font-bold text-rose-600">
                          ผลต่าง: {form.col21 || 0} กก.
                        </span>
                      </div>
                    </div>
                    {renderZoneRescanReview(4)}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">16. วันที่ปลายทาง</label>
                        <input
                          type="date"
                          value={form.col16 || ''}
                          onChange={(e) => handleTextChange('col16', e.target.value)}
                          className="w-full p-1.5 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">17. ตั๋วปลายทาง</label>
                        <input
                          type="text"
                          value={form.col17 || ''}
                          onChange={(e) => handleTextChange('col17', e.target.value)}
                          className="w-full p-1.5 border border-slate-300 rounded-lg bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">18. หนักปลายทาง (กก.)</label>
                        <input
                          type="number"
                          value={form.col18 !== undefined ? form.col18 : ''}
                          onChange={(e) => handleWeightChange('col18', parseFloat(e.target.value) || 0)}
                          className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">19. เบาปลายทาง (กก.)</label>
                        <input
                          type="number"
                          value={form.col19 !== undefined ? form.col19 : ''}
                          onChange={(e) => handleWeightChange('col19', parseFloat(e.target.value) || 0)}
                          className="w-full p-1.5 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] font-bold text-teal-800 mb-0.5">20. สุทธิปลายทาง (กก.)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col20 || 0}
                          className="w-full p-1.5 border border-teal-300 rounded-lg bg-teal-50 text-right font-mono font-bold text-teal-800"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] font-bold text-rose-800 mb-0.5">21. ผลต่างน้ำหนักตกหล่น (กก.)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col21 || 0}
                          className="w-full p-1.5 border border-rose-300 rounded-lg bg-rose-50 text-right font-mono font-bold text-rose-800"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Zone 5: Billing & Freight */}
                  <div className="border border-purple-200 rounded-xl p-3 bg-purple-50/20 space-y-2">
                    <div className="font-bold text-purple-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                        <span>[โซน 5] จำนวน ปริมาณ ราคา & ค่าสินค้า (คอลัมน์ 22 - 29)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {renderZoneRescanButton(5)}
                        <span className="text-[11px] font-mono font-bold text-blue-700">
                          ยอดรวมสุทธิ: ฿{(form.col29 || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {renderZoneRescanReview(5)}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          22. ปริมาณ / จำนวน <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={form.col22 !== undefined ? form.col22 : ''}
                          onChange={(e) => handleFinancialChange('col22', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono font-bold text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">23. หน่วยนับ</label>
                        <input
                          type="text"
                          value={form.col23 || ''}
                          onChange={(e) => handleTextChange('col23', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-center font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">24. ราคาต่อหน่วย (บาท)</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col24 !== undefined ? form.col24 : ''}
                          onChange={(e) => handleFinancialChange('col24', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-purple-900 mb-0.5">25. รวมค่าสินค้า (บาท)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col25 || 0}
                          className="w-full p-2 border border-purple-300 rounded-lg bg-purple-50 text-right font-mono font-bold text-purple-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">26. ประเภทรถ</label>
                        <input
                          type="text"
                          value={form.col26 || ''}
                          onChange={(e) => handleTextChange('col26', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">27. ค่าขนส่ง/หน่วย</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col27 !== undefined ? form.col27 : ''}
                          onChange={(e) => handleFinancialChange('col27', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-purple-900 mb-0.5">28. รวมค่าขนส่ง (บาท)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col28 || 0}
                          className="w-full p-2 border border-purple-300 rounded-lg bg-purple-50 text-right font-mono font-bold text-purple-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-blue-900 mb-0.5">29. รวมทั้งสิ้น (บาท)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col29 || 0}
                          className="w-full p-2 border border-blue-400 rounded-lg bg-blue-100 text-right font-mono font-bold text-blue-950"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Zone 6: Payment Tracking */}
                  <div className="border border-rose-200 rounded-xl p-3 bg-rose-50/20 space-y-2">
                    <div className="font-bold text-rose-900 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                        <span>[โซน 6] เงื่อนไขการชำระเงิน & ยอดคงค้าง (คอลัมน์ 30 - 36)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {renderZoneRescanButton(6)}
                        <span className="text-[11px] font-mono font-bold text-rose-700">
                          หนี้ค้างชำระ: ฿{(form.col36 || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {renderZoneRescanReview(6)}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">30. รูปแบบการชำระ</label>
                        <select
                          value={form.col30 || ''}
                          onChange={(e) => handleTextChange('col30', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="">ยังไม่ระบุ</option>
                          <option value="โอนเงิน">โอนเงินธนาคาร</option>
                          <option value="เครดิต 30 วัน">เครดิต 30 วัน</option>
                          <option value="เครดิต 15 วัน">เครดิต 15 วัน</option>
                          <option value="เครดิต 60 วัน">เครดิต 60 วัน</option>
                          <option value="เงินสด">เงินสด</option>
                          <option value="เช็ค">เช็คสั่งจ่าย</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">31. ชำระให้ผู้จำหน่ายแล้ว</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col31 !== undefined ? form.col31 : ''}
                          onChange={(e) => handleFinancialChange('col31', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white text-right font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-emerald-800 mb-0.5">35. ยอดชำระแล้วรวม</label>
                        <input
                          type="number"
                          step="any"
                          value={form.col35 !== undefined ? form.col35 : ''}
                          onChange={(e) => handleFinancialChange('col35', parseFloat(e.target.value) || 0)}
                          className="w-full p-2 border border-emerald-300 rounded-lg bg-emerald-50 text-right font-mono font-bold text-emerald-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-rose-800 mb-0.5">36. ยอดคงค้างชำระ (บาท)</label>
                        <input
                          type="number"
                          readOnly
                          value={form.col36 || 0}
                          className="w-full p-2 border border-rose-300 rounded-lg bg-rose-50 text-right font-mono font-bold text-rose-900"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Zone 7: Location & Remarks */}
                  <div className="border border-slate-300 rounded-xl p-3 bg-slate-50 space-y-2">
                    <div className="font-bold text-slate-800 text-xs flex items-center justify-between flex-wrap gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
                        <span>[โซน 7] สถานที่ส่งมอบ & หมายเหตุ (คอลัมน์ 37 - 38)</span>
                      </span>
                      {renderZoneRescanButton(7)}
                    </div>
                    {renderZoneRescanReview(7)}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                          37. สถานที่ส่งมอบ / จุดเท / กม.
                        </label>
                        <SmartDatabaseInput
                          value={form.col37 || ''}
                          onChange={(val) => handleTextChange('col37', val)}
                          options={dbCatalog.locations}
                          showStatusBadge={true}
                          fieldLabel="สถานที่ส่งมอบ"
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="เช่น หน้างาน กม. 42+500 หรือ คลังสินค้า C"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">38. หมายเหตุ</label>
                        <input
                          type="text"
                          value={form.col38 || ''}
                          onChange={(e) => handleTextChange('col38', e.target.value)}
                          className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                          placeholder="ระบุข้อความเพิ่มเติมหรือบันทึกหน้างาน"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Submit Action */}
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSaving}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition cursor-pointer text-xs"
                >
                  ยกเลิก
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  {saveError && (
                    <div role="alert" className="max-w-md text-xs font-semibold text-red-700">
                      <span>{saveError}</span>
                    </div>
                  )}
                  {!form.col2?.trim() && (
                    <span className="text-[11px] font-bold text-amber-900 bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>ต้องระบุ "2. ชื่อโครงการ (ช่อง 2)" ก่อน{isExistingOrder ? 'บันทึกการแก้ไข' : 'ยืนยันบันทึก'}</span>
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2.5 rounded-xl font-bold transition flex items-center gap-2 shadow-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 active:scale-95 text-xs md:text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {isSaving
                            ? isExistingOrder
                              ? isCorrectingStoredWeighbridge
                                ? 'กำลังแก้ประเภทและจับคู่...'
                                : 'กำลังบันทึกการแก้ไข...'
                          : form.lineInboxId
                            ? selectedDocType === 'dest_weighbridge'
                              ? 'กำลังย้ายรูปตั๋วชั่งปลายทางและบันทึก...'
                              : 'กำลังย้ายรูปและบันทึก...'
                            : 'กำลังบันทึกเอกสาร...'
                        : isExistingOrder
                            ? isCorrectingStoredWeighbridge
                              ? 'แก้ประเภทและจับคู่ DO'
                              : 'บันทึกการแก้ไข'
                            : form.lineInboxId
                              ? 'ยืนยันตรวจรับและบันทึกเอกสาร'
                              : 'บันทึกเอกสาร'}
                    </span>
                  </button>
                </div>
              </div>

            </form>

          </div>

        </div>

      </div>
      {showSaveProgress && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="save-progress-title">
          <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <header className={`rounded-t-2xl border-b px-5 py-4 ${saveProgress.some(step => step.status === 'error') ? 'border-red-200 bg-red-50' : saveCompleted ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-start gap-3">
                {saveProgress.some(step => step.status === 'error')
                  ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  : saveCompleted
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    : <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600" />}
                <div>
                  <h2 id="save-progress-title" className="text-base font-bold text-slate-900">
                    {saveProgress.some(step => step.status === 'error')
                      ? 'ตรวจพบขั้นตอนที่ไม่สำเร็จ'
                      : saveCompleted
                        ? 'ดำเนินการเสร็จสิ้น'
                        : 'กำลังตรวจสอบและบันทึกเอกสาร'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {saveProgress.some(step => step.status === 'error')
                      ? 'ตรวจดูขั้นตอนที่ผิดพลาดก่อนกลับไปแก้ไข ระบบยังเก็บข้อมูลที่กรอกไว้'
                      : saveCompleted
                        ? 'ตรวจผลการบันทึก แล้วกดยืนยันเพื่อปิดหน้าต่าง'
                        : 'กำลังทำงานตามลำดับ กรุณาอย่าปิดหน้าต่างระหว่างบันทึก'}
                  </p>
                </div>
              </div>
            </header>
            <ol className="max-h-[55vh] space-y-2 overflow-y-auto p-5">
              {saveProgress.map(step => (
                <li key={step.id} className={`flex gap-3 rounded-xl border p-3 ${step.status === 'error' ? 'border-red-200 bg-red-50' : step.status === 'success' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
                  <span className="mt-0.5 shrink-0" aria-hidden="true">
                    {step.status === 'running'
                      ? <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                      : step.status === 'success'
                        ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        : step.status === 'error'
                          ? <AlertCircle className="h-5 w-5 text-red-600" />
                          : <Circle className={`h-5 w-5 ${step.status === 'skipped' ? 'text-slate-300' : 'text-slate-400'}`} />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${step.status === 'error' ? 'text-red-800' : 'text-slate-800'}`}>{step.title}</p>
                    {step.detail && <p className={`mt-1 break-words text-xs leading-relaxed ${step.status === 'error' ? 'text-red-700' : 'text-slate-600'}`}>{step.detail}</p>}
                    {step.status === 'error' && step.id === 'drive_check' && (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-relaxed text-amber-900">
                        หากพบ HTTP 404 ให้ตรวจ Settings → Google Drive ว่า URL เป็น Web App deployment ที่ยังใช้งานและลงท้ายด้วย /exec จากนั้นกดทดสอบ Google Drive แล้วกลับมาลองใหม่
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {!isSaving && (
              <footer className="flex justify-end gap-2 border-t border-slate-200 p-4">
                {saveCompleted ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-11 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-emerald-700"
                  >
                    ยืนยันผลและปิดหน้าต่าง
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSaveProgress(false)}
                    className="min-h-11 rounded-xl bg-slate-800 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
                  >
                    รับทราบ กลับไปแก้ไข
                  </button>
                )}
              </footer>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
