import React, { useState, useMemo, useEffect } from 'react';
import {
  OrderRecord,
  OrderItemDetail,
  PurchaseOrder,
  StoreMerchant,
  SystemSettings,
  AppUser,
  BillingNoteRecord,
  BillingNoteLineAdjustment,
  BillingWeightBasis,
  BillingScopeMode,
  BillingVatMode
} from '../types';
import { DEFAULT_COMPANY_LOGO_URL } from '../utils/systemConfig';
import { isDocNumberMatch } from '../utils/poReconciliation';
import { ImageDocViewer } from './ImageDocViewer';
import {
  FileCheck2,
  Printer,
  Download,
  CheckCircle2,
  Search,
  Stamp,
  RotateCcw,
  Trash2,
  Edit3,
  Eye,
  ArrowRight,
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Scale,
  Truck,
  Calculator,
  Paperclip,
  Upload,
  Plus,
  Layers,
  ChevronDown,
  ChevronUp,
  Filter,
  SlidersHorizontal,
  X,
  HelpCircle,
  Info,
  Sparkles,
  Check,
  AlertCircle,
  Building2,
  CheckCircle,
  Coins
} from 'lucide-react';

interface PurchasingBillingViewProps {
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  stores: StoreMerchant[];
  billingNotes: BillingNoteRecord[];
  systemSettings: SystemSettings;
  currentUser: AppUser;
  canManageBilling: boolean;
  onSaveBillingNote: (note: BillingNoteRecord, isNew: boolean) => void;
  onStampExpressRR: (billingNoteId: string, rrNumber: string) => void;
  onUnbillBillingNote: (billingNoteId: string) => void;
  onDeleteBillingNote: (billingNoteId: string) => void;
  onInspectOrder: (order: OrderRecord) => void;
  showToast: (msg: string, type?: 'success' | 'info') => void;
}

const parseCreditDays = (creditTerms?: string): number => {
  if (!creditTerms) return 30;
  const match = creditTerms.match(/(\d+)/);
  return match ? Number(match[1]) : 30;
};

const addDaysToDateStr = (dateStr: string, days: number): string => {
  try {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    d.setDate(d.getDate() + (Number(days) || 0));
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

export const PurchasingBillingView: React.FC<PurchasingBillingViewProps> = ({
  orders,
  pos,
  stores,
  billingNotes,
  systemSettings,
  currentUser,
  canManageBilling,
  onSaveBillingNote,
  onStampExpressRR,
  onUnbillBillingNote,
  onDeleteBillingNote,
  onInspectOrder,
  showToast
}) => {
  const [activeStepTab, setActiveStepTab] = useState<'step1' | 'step2' | 'step3_4'>('step1');
  const [logoError, setLogoError] = useState(false);

  // Step 1 Filter & Form State
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [doWeighTypeFilter, setDoWeighTypeFilter] = useState<'all' | 'general_non_weighed' | 'weighed'>('all');
  const [doBillingStateFilter, setDoBillingStateFilter] = useState<'all' | 'unbilled_only'>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState<string>('');
  const [supplierCode, setSupplierCode] = useState<string>('');
  const [billingDate, setBillingDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [creditDays, setCreditDays] = useState<number>(30);
  const [dueDate, setDueDate] = useState<string>(() => addDaysToDateStr(new Date().toISOString().slice(0, 10), 30));

  const [weightBasis, setWeightBasis] = useState<BillingWeightBasis | ''>('');
  const [billingScope, setBillingScope] = useState<BillingScopeMode | ''>('');
  const [vatMode, setVatMode] = useState<BillingVatMode | ''>('');
  const [roundingAdjustment, setRoundingAdjustment] = useState<number>(0);
  const [supplierInvoiceTargetAmount, setSupplierInvoiceTargetAmount] = useState<string>('');
  const [billingNotesText, setBillingNotesText] = useState<string>('');
  const [attachmentImage, setAttachmentImage] = useState<string | null>(null);
  const [attachmentFileName, setAttachmentFileName] = useState<string>('');
  const [previewAttachmentModal, setPreviewAttachmentModal] = useState<{
    image: string;
    title: string;
  } | null>(null);
  const [bulkUnitPriceInput, setBulkUnitPriceInput] = useState<string>('');
  const [bulkFreightRateInput, setBulkFreightRateInput] = useState<string>('');
  const [showProductGroupPricing, setShowProductGroupPricing] = useState<boolean>(false);
  const [isPricingToolsOpen, setIsPricingToolsOpen] = useState<boolean>(false);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);
  const [showWorkflowGuide, setShowWorkflowGuide] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [productGroupPriceInputs, setProductGroupPriceInputs] = useState<
    Record<string, { unitPrice: string; freightRate: string }>
  >({});

  // Selected DO IDs, custom sub-items per DO, and per-lineKey custom overrides in Step 1
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [customOrderSubItems, setCustomOrderSubItems] = useState<
    Record<string, OrderItemDetail[]>
  >({});
  const [rowOverrides, setRowOverrides] = useState<
    Record<
      string,
      {
        itemDescription?: string;
        specCode?: string;
        qty?: number;
        unit?: string;
        unitPrice?: number;
        materialAmount?: number;
        truckType?: string;
        freightRate?: number;
        freightAmount?: number;
      }
    >
  >({});

  // Step 2 & Step 3/4 Selected Billing Note
  const [activeNoteIdForPreview, setActiveNoteIdForPreview] = useState<string>(() =>
    billingNotes[0]?.id || ''
  );
  const [rrInputByNoteId, setRrInputByNoteId] = useState<Record<string, string>>({});
  const [confirmUnbillId, setConfirmUnbillId] = useState<string | null>(null);
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);
  const [noteStatusFilter, setNoteStatusFilter] = useState<'all' | 'pending_rr' | 'rr_stamped_billed'>('all');

  useEffect(() => {
    if (!activeNoteIdForPreview && billingNotes.length > 0) {
      setActiveNoteIdForPreview(billingNotes[0].id);
    }
  }, [billingNotes, activeNoteIdForPreview]);

  // All valid DOs (excluding destination weighbridge and standalone tax invoices)
  const allDeliveryOrders = useMemo(() => {
    return orders.filter(
      o => o.docType !== 'dest_weighbridge' && o.docType !== 'tax_invoice'
    );
  }, [orders]);

  // Set of order IDs locked in other billing notes
  const lockedOrderMap = useMemo(() => {
    const map = new Map<string, BillingNoteRecord>();
    billingNotes.forEach(bn => {
      if (editingNoteId && bn.id === editingNoteId) return;
      bn.orderIds.forEach(oid => {
        map.set(oid, bn);
      });
    });
    return map;
  }, [billingNotes, editingNoteId]);

  // DOs displayed in Step 1 (Shows ALL DOs by default, or only unbilled if toggled)
  const availableDOsForStep1 = useMemo(() => {
    return allDeliveryOrders.filter(o => {
      const isEditingThis = editingNoteId && selectedOrderIds.includes(o.id);
      const isAlreadyBilledOrLocked =
        !isEditingThis &&
        (o.billingStatus === 'BILLED' ||
          Boolean(o.col5 && o.col5.trim() !== '') ||
          lockedOrderMap.has(o.id));

      if (doBillingStateFilter === 'unbilled_only' && isAlreadyBilledOrLocked) {
        return false;
      }
      if (selectedSupplier && (o.col8 || '').trim() !== selectedSupplier.trim()) {
        return false;
      }
      if (projectFilter !== 'all' && (o.col2 || '') !== projectFilter) {
        return false;
      }
      const hasWeights = Number(o.col15) > 0 || Number(o.col20) > 0 || o.docType === 'weighbridge';
      if (doWeighTypeFilter === 'general_non_weighed' && hasWeights) return false;
      if (doWeighTypeFilter === 'weighed' && !hasWeights) return false;
      if (dateFrom && (o.col7 || '') < dateFrom) return false;
      if (dateTo && (o.col7 || '') > dateTo) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const match =
          (o.col1 || '').toLowerCase().includes(q) ||
          (o.col6 || '').toLowerCase().includes(q) ||
          (o.col4 || '').toLowerCase().includes(q) ||
          (o.col5 || '').toLowerCase().includes(q) ||
          (o.col8 || '').toLowerCase().includes(q) ||
          (o.col11 || '').toLowerCase().includes(q) ||
          (o.col10 || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    allDeliveryOrders,
    editingNoteId,
    selectedOrderIds,
    lockedOrderMap,
    doBillingStateFilter,
    selectedSupplier,
    projectFilter,
    doWeighTypeFilter,
    dateFrom,
    dateTo,
    searchQuery
  ]);

  // Selectable (unbilled) DOs currently visible in Step 1
  const selectableVisibleDOs = useMemo(() => {
    return availableDOsForStep1.filter(o => {
      const isEditingThis = editingNoteId && selectedOrderIds.includes(o.id);
      if (isEditingThis) return true;
      if (o.billingStatus === 'BILLED' || (o.col5 && o.col5.trim() !== '')) return false;
      if (lockedOrderMap.has(o.id)) return false;
      return true;
    });
  }, [availableDOsForStep1, editingNoteId, selectedOrderIds, lockedOrderMap]);

  // All Suppliers list with both total DO count and unbilled DO count
  const supplierOptions = useMemo(() => {
    const stats = new Map<string, { total: number; unbilled: number }>();
    stores.forEach(s => {
      const sName = (s.name || '').trim();
      if (sName && !stats.has(sName)) {
        stats.set(sName, { total: 0, unbilled: 0 });
      }
    });
    allDeliveryOrders.forEach(o => {
      const sName = (o.col8 || '').trim();
      if (!sName) return;
      const cur = stats.get(sName) || { total: 0, unbilled: 0 };
      cur.total += 1;
      const isBilled =
        (o.billingStatus === 'BILLED' || (o.col5 && o.col5.trim() !== '') || lockedOrderMap.has(o.id)) &&
        !(editingNoteId && selectedOrderIds.includes(o.id));
      if (!isBilled) {
        cur.unbilled += 1;
      }
      stats.set(sName, cur);
    });
    return Array.from(stats.entries()).sort((a, b) => {
      if (b[1].total !== a[1].total) return b[1].total - a[1].total;
      return a[0].localeCompare(b[0], 'th');
    });
  }, [allDeliveryOrders, stores, lockedOrderMap, editingNoteId, selectedOrderIds]);

  const topPendingSuppliers = useMemo(() => {
    return supplierOptions.filter(([_, stat]) => stat.unbilled > 0).slice(0, 4);
  }, [supplierOptions]);

  const projectOptions = useMemo(() => {
    return Array.from(
      new Set(allDeliveryOrders.map(o => (o.col2 || '').trim()).filter(Boolean))
    );
  }, [allDeliveryOrders]);

  // Auto-fill credit days and supplier code when supplier changes
  const handleSelectSupplier = (supplierName: string, isManualChange = false) => {
    const isSwitchingSupplier =
      isManualChange && selectedSupplier && selectedSupplier !== supplierName;
    setSelectedSupplier(supplierName);
    const matchedStore = stores.find(
      s => s.name.trim().toLowerCase() === supplierName.trim().toLowerCase()
    );
    const days = parseCreditDays(matchedStore?.creditTerms);
    setCreditDays(days);
    setDueDate(addDaysToDateStr(billingDate, days));
    if (matchedStore?.id) {
      setSupplierCode(matchedStore.id);
    } else if (!supplierName) {
      setSupplierCode('');
    }
    if (isSwitchingSupplier && !editingNoteId) {
      setSelectedOrderIds([]);
      setCustomOrderSubItems({});
      setRowOverrides({});
      setWeightBasis('');
      setBillingScope('');
      setVatMode('');
    }
  };

  // Helper: Get effective sub-items for an OrderRecord (supports multi-item DOs & user-added sub-items)
  const getEffectiveSubItemsForOrder = React.useCallback(
    (ord: OrderRecord): OrderItemDetail[] => {
      if (customOrderSubItems[ord.id] && customOrderSubItems[ord.id].length > 0) {
        return customOrderSubItems[ord.id];
      }
      if (ord.lineItems && ord.lineItems.length > 0) {
        return ord.lineItems;
      }
      return [
        {
          id: `${ord.id}-0`,
          itemDescription: ord.col11 || 'ไม่ระบุรายการวัสดุ',
          specCode: ord.col12 || '',
          qty: Number(ord.col22) || 0,
          unit: (ord.col23 || 'ตัน').trim(),
          unitPrice: Number(ord.col24) || 0,
          totalAmount: Number(ord.col25) || 0
        }
      ];
    },
    [customOrderSubItems]
  );

  // Add a new sub-item to a DO in Step 1 (for general DOs that have multiple items on one bill)
  const handleAddSubItemToOrder = (ord: OrderRecord) => {
    if (!selectedOrderIds.includes(ord.id)) {
      handleToggleSelectOrder(ord.id, ord.col8);
    }
    const existing = getEffectiveSubItemsForOrder(ord);
    const nextIdx = existing.length;
    const newSubItem: OrderItemDetail = {
      id: `${ord.id}-${Date.now()}-${nextIdx}`,
      itemDescription: '',
      specCode: '',
      qty: 1,
      unit: existing[0]?.unit || (ord.col23 || 'ชิ้น').trim(),
      unitPrice: 0,
      totalAmount: 0
    };
    setCustomOrderSubItems(prev => ({
      ...prev,
      [ord.id]: [...existing, newSubItem]
    }));
    showToast(`เพิ่มรายการย่อยที่ #${nextIdx + 1} ในใบส่งของ ${ord.col6 || ord.col1} แล้ว`);
  };

  // Remove an extra sub-item from a DO in Step 1
  const handleRemoveSubItemFromOrder = (ord: OrderRecord, subIdx: number) => {
    const existing = getEffectiveSubItemsForOrder(ord);
    if (existing.length <= 1) return;
    const nextList = existing.filter((_, idx) => idx !== subIdx);
    setCustomOrderSubItems(prev => ({
      ...prev,
      [ord.id]: nextList
    }));
    setRowOverrides(prev => {
      const cleaned: typeof rowOverrides = {};
      Object.keys(prev).forEach(k => {
        if (!k.startsWith(`${ord.id}__`) && k !== ord.id) {
          cleaned[k] = prev[k];
        }
      });
      nextList.forEach((_, newIdx) => {
        const oldIdx = newIdx >= subIdx ? newIdx + 1 : newIdx;
        const oldVal = prev[`${ord.id}__${oldIdx}`];
        if (oldVal) {
          cleaned[`${ord.id}__${newIdx}`] = oldVal;
        }
      });
      return cleaned;
    });
  };

  // Compute weight & financial line adjustments for selected DOs (supporting multiple sub-items per DO)
  const computedLines: BillingNoteLineAdjustment[] = useMemo(() => {
    const selectedOrders = selectedOrderIds
      .map(id => orders.find(o => o.id === id))
      .filter((o): o is OrderRecord => Boolean(o));

    const allLines: BillingNoteLineAdjustment[] = [];

    selectedOrders.forEach(ord => {
      const subItems = getEffectiveSubItemsForOrder(ord);
      const isMultiItemDO = subItems.length > 1;
      const originKg = Number(ord.col15) || 0;
      const destKg = Number(ord.col20) || 0;

      let chosenWeightKg = 0;
      if (weightBasis === 'none_qty') {
        chosenWeightKg = 0;
      } else if (weightBasis === 'origin') {
        chosenWeightKg = originKg > 0 ? originKg : destKg;
      } else if (weightBasis === 'dest') {
        chosenWeightKg = destKg > 0 ? destKg : originKg;
      } else if (weightBasis === 'min') {
        if (originKg > 0 && destKg > 0) {
          chosenWeightKg = Math.min(originKg, destKg);
        } else {
          chosenWeightKg = originKg > 0 ? originKg : destKg;
        }
      }

      subItems.forEach((sub, subIdx) => {
        const lineKey = `${ord.id}__${subIdx}`;
        const ov = rowOverrides[lineKey] || (subIdx === 0 ? rowOverrides[ord.id] : undefined) || {};

        const unit = (ov.unit !== undefined ? ov.unit : sub.unit || ord.col23 || 'ตัน').trim();
        const unitLower = unit.toLowerCase();

        // For single-item weighed DO, convert chosenWeightKg -> Ton/Kg if applicable.
        // For multi-item DOs (or 'none_qty'), use each sub-item's quantity directly.
        let defaultQty = Number(sub.qty) || (subIdx === 0 ? Number(ord.col22) || 0 : 0);
        if (!isMultiItemDO && weightBasis !== 'none_qty' && chosenWeightKg > 0) {
          if (unitLower.includes('ตัน') || unitLower.includes('ton')) {
            defaultQty = Number((chosenWeightKg / 1000).toFixed(3));
          } else if (unitLower.includes('กก') || unitLower.includes('กิโล') || unitLower.includes('kg')) {
            defaultQty = chosenWeightKg;
          }
        }

        const qty = ov.qty !== undefined ? ov.qty : defaultQty;
        const defaultUnitPrice =
          Number(sub.unitPrice) > 0
            ? Number(sub.unitPrice)
            : subIdx === 0
            ? Number(ord.col24) || 0
            : 0;
        const unitPrice = ov.unitPrice !== undefined ? ov.unitPrice : defaultUnitPrice;

        const materialAmount =
          ov.materialAmount !== undefined
            ? ov.materialAmount
            : Number((qty * unitPrice).toFixed(2));

        const truckType =
          ov.truckType !== undefined ? ov.truckType : subIdx === 0 ? ord.col26 || '' : '';
        const freightRate =
          ov.freightRate !== undefined
            ? ov.freightRate
            : subIdx === 0
            ? Number(ord.col27) || 0
            : 0;
        const freightAmount =
          ov.freightAmount !== undefined
            ? ov.freightAmount
            : freightRate > 0
            ? Number((qty * freightRate).toFixed(2))
            : subIdx === 0
            ? Number(ord.col28) || 0
            : 0;

        let lineTotal = materialAmount + freightAmount;
        if (billingScope === 'material_only') {
          lineTotal = materialAmount;
        } else if (billingScope === 'transport_only') {
          lineTotal = freightAmount;
        }

        const itemDesc =
          ov.itemDescription !== undefined
            ? ov.itemDescription
            : sub.itemDescription || ord.col11 || '-';

        allLines.push({
          lineKey,
          orderId: ord.id,
          subItemIndex: subIdx,
          trNo: ord.col1 || '-',
          doNo: ord.col6 || '-',
          poNo: ord.col4 || '-',
          date: ord.col7 || '-',
          projectName: ord.col2 || 'ไม่ระบุโครงการ',
          category: ord.col3 || '-',
          itemDescription: itemDesc,
          specCode: ov.specCode !== undefined ? ov.specCode : sub.specCode || ord.col12 || '',
          originNetKg: subIdx === 0 ? originKg : 0,
          destNetKg: subIdx === 0 ? destKg : 0,
          chosenWeightKg: subIdx === 0 ? chosenWeightKg : 0,
          qty,
          unit,
          unitPrice,
          materialAmount,
          truckType,
          freightRate,
          freightAmount,
          lineTotal: Number(lineTotal.toFixed(2))
        });
      });
    });

    return allLines;
  }, [
    selectedOrderIds,
    orders,
    getEffectiveSubItemsForOrder,
    rowOverrides,
    weightBasis,
    billingScope
  ]);

  // Distinct product/material groups across selected DOs (for setting different prices per product type)
  const distinctProductGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        groupKey: string;
        itemDescription: string;
        unit: string;
        lineKeys: string[];
        doCount: number;
        totalQty: number;
        currentUnitPrice: number;
        currentFreightRate: number;
      }
    >();

    computedLines.forEach(line => {
      const lKey = line.lineKey || `${line.orderId}__0`;
      const cleanName = (line.itemDescription || 'ไม่ระบุรายการวัสดุ').trim();
      const cleanUnit = (line.unit || 'หน่วย').trim();
      const groupKey = `${cleanName.toLowerCase()}__${cleanUnit.toLowerCase()}`;

      const existing = map.get(groupKey);
      if (!existing) {
        map.set(groupKey, {
          groupKey,
          itemDescription: cleanName,
          unit: cleanUnit,
          lineKeys: [lKey],
          doCount: 1,
          totalQty: Number(line.qty) || 0,
          currentUnitPrice: Number(line.unitPrice) || 0,
          currentFreightRate: Number(line.freightRate) || 0
        });
      } else {
        existing.lineKeys.push(lKey);
        existing.doCount += 1;
        existing.totalQty = Number((existing.totalQty + (Number(line.qty) || 0)).toFixed(3));
        if (existing.currentUnitPrice === 0 && Number(line.unitPrice) > 0) {
          existing.currentUnitPrice = Number(line.unitPrice);
        }
        if (existing.currentFreightRate === 0 && Number(line.freightRate) > 0) {
          existing.currentFreightRate = Number(line.freightRate);
        }
      }
    });

    return Array.from(map.values());
  }, [computedLines]);

  // Totals in Step 1
  const step1Totals = useMemo(() => {
    const rawLinesSum = computedLines.reduce((acc, l) => acc + l.lineTotal, 0);
    const totalMaterial = computedLines.reduce((acc, l) => acc + l.materialAmount, 0);
    const totalFreight = computedLines.reduce((acc, l) => acc + l.freightAmount, 0);
    const totalOriginKg = computedLines.reduce((acc, l) => acc + l.originNetKg, 0);
    const totalDestKg = computedLines.reduce((acc, l) => acc + l.destNetKg, 0);
    const totalChosenKg = computedLines.reduce((acc, l) => acc + l.chosenWeightKg, 0);

    let subtotalAmount = Number(rawLinesSum.toFixed(2));
    let vatAmount = 0;
    let netBeforeRounding = subtotalAmount;

    if (vatMode === 'exclude_7') {
      vatAmount = Number((subtotalAmount * 0.07).toFixed(2));
      netBeforeRounding = Number((subtotalAmount + vatAmount).toFixed(2));
    } else if (vatMode === 'include_7') {
      netBeforeRounding = Number(rawLinesSum.toFixed(2));
      subtotalAmount = Number((netBeforeRounding / 1.07).toFixed(2));
      vatAmount = Number((netBeforeRounding - subtotalAmount).toFixed(2));
    }

    const netTotalAmount = Number(
      (netBeforeRounding + (Number(roundingAdjustment) || 0)).toFixed(2)
    );

    const targetVal = Number(supplierInvoiceTargetAmount);
    const hasTarget = supplierInvoiceTargetAmount.trim() !== '' && !isNaN(targetVal) && targetVal > 0;
    const diffWithTarget = hasTarget ? Number((targetVal - netTotalAmount).toFixed(2)) : 0;

    return {
      rawLinesSum,
      totalMaterial,
      totalFreight,
      totalOriginKg,
      totalDestKg,
      totalChosenKg,
      subtotalAmount,
      vatAmount,
      netBeforeRounding,
      netTotalAmount,
      hasTarget,
      targetVal,
      diffWithTarget
    };
  }, [computedLines, vatMode, roundingAdjustment, supplierInvoiceTargetAmount]);

  const handleToggleSelectOrder = (orderId: string, orderSupplier: string) => {
    setSelectedOrderIds(prev => {
      const exists = prev.includes(orderId);
      if (exists) {
        return prev.filter(id => id !== orderId);
      } else {
        if (!selectedSupplier && orderSupplier) {
          handleSelectSupplier(orderSupplier);
        }
        return [...prev, orderId];
      }
    });
  };

  const handleSelectAllVisible = () => {
    const visibleIds = selectableVisibleDOs.map(o => o.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedOrderIds.includes(id));
    if (allSelected) {
      setSelectedOrderIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      if (!selectedSupplier && selectableVisibleDOs[0]?.col8) {
        handleSelectSupplier(selectableVisibleDOs[0].col8);
      }
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  // Handle uploading & compressing Supplier Billing Note / Invoice Attachment
  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachmentFileName(file.name);

    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      if (!result) return;

      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            setAttachmentImage(canvas.toDataURL('image/jpeg', 0.82));
          } else {
            setAttachmentImage(result);
          }
          showToast(`แนบเอกสารใบวางบิล "${file.name}" เรียบร้อยแล้ว`);
        };
        img.src = result;
      } else {
        setAttachmentImage(result);
        showToast(`แนบไฟล์ใบวางบิล "${file.name}" เรียบร้อยแล้ว`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAutoMatchRoundingToTarget = () => {
    if (!step1Totals.hasTarget) return;
    const requiredRounding = Number(
      (step1Totals.targetVal - step1Totals.netBeforeRounding).toFixed(2)
    );
    setRoundingAdjustment(requiredRounding);
    showToast(`ปรับเศษสตางค์ ${requiredRounding >= 0 ? '+' : ''}${requiredRounding.toFixed(2)} บาท ให้ตรงใบวางบิลแล้ว`);
  };

  // Bulk apply unit price (col24) to all selected DO lines in Step 1
  const handleBulkApplyUnitPrice = () => {
    const val = Number(bulkUnitPriceInput);
    if (selectedOrderIds.length === 0) {
      showToast('กรุณาติ๊กเลือกรายการใบส่งของ (DO) ในตารางก่อนกำหนดราคา', 'info');
      return;
    }
    if (isNaN(val) || val < 0 || bulkUnitPriceInput.trim() === '') {
      showToast('กรุณากรอกราคาต่อหน่วยที่ต้องการใช้', 'info');
      return;
    }
    setRowOverrides(prev => {
      const next = { ...prev };
      computedLines.forEach(line => {
        const lKey = line.lineKey || `${line.orderId}__0`;
        next[lKey] = {
          ...next[lKey],
          qty: line.qty,
          unitPrice: val,
          materialAmount: Number((line.qty * val).toFixed(2))
        };
      });
      return next;
    });
    showToast(
      `กำหนดราคาต่อหน่วย ฿${val.toLocaleString('th-TH', {
        minimumFractionDigits: 2
      })} ให้ทุกรายการที่เลือก (${computedLines.length} รายการ จาก ${selectedOrderIds.length} ใบ DO) แล้ว`
    );
  };

  // Bulk apply freight rate (col27) to all selected DO lines in Step 1
  const handleBulkApplyFreightRate = () => {
    const rate = Number(bulkFreightRateInput);
    if (selectedOrderIds.length === 0) {
      showToast('กรุณาติ๊กเลือกรายการใบส่งของ (DO) ในตารางก่อนกำหนดเรทค่าขนส่ง', 'info');
      return;
    }
    if (isNaN(rate) || rate < 0 || bulkFreightRateInput.trim() === '') {
      showToast('กรุณากรอกเรทค่าขนส่งต่อหน่วยที่ต้องการใช้', 'info');
      return;
    }
    setRowOverrides(prev => {
      const next = { ...prev };
      computedLines.forEach(line => {
        const lKey = line.lineKey || `${line.orderId}__0`;
        next[lKey] = {
          ...next[lKey],
          qty: line.qty,
          freightRate: rate,
          freightAmount: Number((line.qty * rate).toFixed(2))
        };
      });
      return next;
    });
    showToast(
      `กำหนดเรทค่าขนส่ง ฿${rate.toLocaleString('th-TH', {
        minimumFractionDigits: 2
      })}/หน่วย ให้ทุกรายการที่เลือกแล้ว`
    );
  };

  // Apply unit price & optional freight rate to a specific product group (when items have different prices)
  const handleApplyPriceToProductGroup = (groupKey: string) => {
    const group = distinctProductGroups.find(g => g.groupKey === groupKey);
    if (!group) return;
    const inputs = productGroupPriceInputs[groupKey];
    const priceStr =
      inputs?.unitPrice !== undefined
        ? inputs.unitPrice
        : group.currentUnitPrice > 0
        ? String(group.currentUnitPrice)
        : '';
    const freightStr = inputs?.freightRate !== undefined ? inputs.freightRate : '';

    const hasPrice = priceStr.trim() !== '' && !isNaN(Number(priceStr)) && Number(priceStr) >= 0;
    const hasFreight =
      freightStr.trim() !== '' && !isNaN(Number(freightStr)) && Number(freightStr) >= 0;

    if (!hasPrice && !hasFreight) {
      showToast(`กรุณากรอกราคา/หน่วย หรือเรทขนส่งสำหรับ "${group.itemDescription}" ก่อนกดใช้ราคา`, 'info');
      return;
    }

    setRowOverrides(prev => {
      const next = { ...prev };
      computedLines.forEach(line => {
        const lKey = line.lineKey || `${line.orderId}__0`;
        if (!group.lineKeys.includes(lKey)) return;
        const nextPrice = hasPrice ? Number(priceStr) : line.unitPrice;
        const nextFreightRate = hasFreight ? Number(freightStr) : line.freightRate;
        next[lKey] = {
          ...next[lKey],
          qty: line.qty,
          unitPrice: nextPrice,
          materialAmount: Number((line.qty * nextPrice).toFixed(2)),
          ...(hasFreight
            ? {
                freightRate: nextFreightRate,
                freightAmount: Number((line.qty * nextFreightRate).toFixed(2))
              }
            : {})
        };
      });
      return next;
    });

    showToast(
      `อัปเดตราคา "${group.itemDescription}" (${group.lineKeys.length} รายการ) เรียบร้อยแล้ว`
    );
  };

  // Apply prices across ALL product groups at once
  const handleApplyAllProductGroupPrices = () => {
    let updatedLinesCount = 0;
    setRowOverrides(prev => {
      const next = { ...prev };
      distinctProductGroups.forEach(group => {
        const inputs = productGroupPriceInputs[group.groupKey];
        if (!inputs) return;
        const hasPrice =
          inputs.unitPrice !== undefined &&
          inputs.unitPrice.trim() !== '' &&
          !isNaN(Number(inputs.unitPrice)) &&
          Number(inputs.unitPrice) >= 0;
        const hasFreight =
          inputs.freightRate !== undefined &&
          inputs.freightRate.trim() !== '' &&
          !isNaN(Number(inputs.freightRate)) &&
          Number(inputs.freightRate) >= 0;
        if (!hasPrice && !hasFreight) return;

        computedLines.forEach(line => {
          const lKey = line.lineKey || `${line.orderId}__0`;
          if (!group.lineKeys.includes(lKey)) return;
          updatedLinesCount++;
          const nextPrice = hasPrice ? Number(inputs.unitPrice) : line.unitPrice;
          const nextFreightRate = hasFreight ? Number(inputs.freightRate) : line.freightRate;
          next[lKey] = {
            ...next[lKey],
            qty: line.qty,
            unitPrice: nextPrice,
            materialAmount: Number((line.qty * nextPrice).toFixed(2)),
            ...(hasFreight
              ? {
                  freightRate: nextFreightRate,
                  freightAmount: Number((line.qty * nextFreightRate).toFixed(2))
                }
              : {})
          };
        });
      });
      return next;
    });

    if (updatedLinesCount > 0) {
      showToast(`ใช้ราคาแยกตามชนิดสินค้าสำเร็จรวม ${updatedLinesCount} รายการ!`);
    } else {
      showToast('กรุณากรอกราคาต่อหน่วยในตารางแยกตามชนิดสินค้าอย่างน้อย 1 ชนิดก่อนกดปุ่มนี้', 'info');
    }
  };

  // Pull unit price from linked Purchase Order (PO) automatically for each sub-item in selected DOs
  const handlePullPriceFromLinkedPO = () => {
    if (selectedOrderIds.length === 0) {
      showToast('กรุณาติ๊กเลือกใบส่งของ (DO) ในตารางก่อนดึงราคาจากใบสั่งซื้อ (PO)', 'info');
      return;
    }
    let matchedCount = 0;
    setRowOverrides(prev => {
      const next = { ...prev };
      computedLines.forEach(line => {
        const lKey = line.lineKey || `${line.orderId}__0`;
        const ord = orders.find(o => o.id === line.orderId);
        if (!ord) return;
        const matchedPO = pos.find(
          p =>
            (ord.col4 && isDocNumberMatch(p.poNumber, ord.col4)) ||
            (ord.referenceDocNo && isDocNumberMatch(p.poNumber, ord.referenceDocNo))
        );
        if (matchedPO && matchedPO.items && matchedPO.items.length > 0) {
          const lineNameLower = (line.itemDescription || '').trim().toLowerCase();
          const itemMatch =
            matchedPO.items.find(
              it =>
                (lineNameLower &&
                  (it.itemDescription || '').toLowerCase().includes(lineNameLower)) ||
                (lineNameLower &&
                  lineNameLower.includes((it.itemDescription || '').toLowerCase())) ||
                (line.specCode &&
                  it.specCode &&
                  line.specCode.toLowerCase() === it.specCode.toLowerCase())
            ) ||
            (matchedPO.items.length === 1 ? matchedPO.items[0] : undefined);

          if (itemMatch && Number(itemMatch.unitPrice) > 0) {
            matchedCount++;
            const poPrice = Number(itemMatch.unitPrice);
            next[lKey] = {
              ...next[lKey],
              qty: line.qty,
              unitPrice: poPrice,
              materialAmount: Number((line.qty * poPrice).toFixed(2))
            };
          }
        }
      });
      return next;
    });
    if (matchedCount > 0) {
      showToast(`ดึงราคาแยกตามรายการสินค้าจากใบสั่งซื้อ (PO) สำเร็จ ${matchedCount} รายการ!`);
    } else {
      showToast('ไม่พบรายการสินค้าใน PO ที่ตรงกับรายการที่เลือก หรือใน PO ไม่ได้ระบุราคาไว้', 'info');
    }
  };

  const generateNextBillingNoteId = (): string => {
    const ym = (billingDate || new Date().toISOString().slice(0, 10)).slice(0, 7).replace('-', '');
    const prefix = `BN-${ym}-`;
    let maxSeq = 0;
    billingNotes.forEach(bn => {
      if (bn.id.startsWith(prefix)) {
        const n = parseInt(bn.id.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const resetStep1Form = () => {
    setEditingNoteId(null);
    setSelectedOrderIds([]);
    setCustomOrderSubItems({});
    setRowOverrides({});
    setProductGroupPriceInputs({});
    setSupplierInvoiceNo('');
    setWeightBasis('');
    setBillingScope('');
    setVatMode('');
    setRoundingAdjustment(0);
    setSupplierInvoiceTargetAmount('');
    setBillingNotesText('');
    setAttachmentImage(null);
    setAttachmentFileName('');
    setWizardStep(1);
  };

  const handleSaveStep1BillingNote = () => {
    if (computedLines.length === 0) {
      showToast('กรุณาติ๊กเลือกใบส่งของ (DO) อย่างน้อย 1 รายการเพื่อสร้างชุดรับวางบิล', 'info');
      return;
    }
    if (!weightBasis) {
      showToast('กรุณาเลือก "เกณฑ์ปริมาณ / น้ำหนักคิดเงิน" (ไม่ชั่งน้ำหนัก ช่อง 22 / ต้นทาง ช่อง 15 / ปลายทาง ช่อง 20 / MIN) ในหัวข้อที่ 2 ก่อนสร้างชุดรับวางบิล', 'info');
      return;
    }
    if (!billingScope) {
      showToast('กรุณาเลือก "ขอบเขตยอดที่รับวางบิล" ในหัวข้อที่ 2 ก่อนสร้างชุดรับวางบิล', 'info');
      return;
    }
    if (!vatMode) {
      showToast('กรุณาเลือก "การคิดภาษีมูลค่าเพิ่ม (VAT)" ในหัวข้อที่ 2 ก่อนสร้างชุดรับวางบิล', 'info');
      return;
    }
    const inferredSupplier =
      selectedSupplier.trim() ||
      orders.find(o => o.id === selectedOrderIds[0])?.col8 ||
      'ไม่ระบุร้านค้า';

    const matchedStore = stores.find(
      s => s.name.trim().toLowerCase() === inferredSupplier.trim().toLowerCase()
    );

    const nowIso = new Date().toISOString();
    const isNew = !editingNoteId;
    const existingNote = editingNoteId ? billingNotes.find(b => b.id === editingNoteId) : undefined;
    const noteId = editingNoteId || generateNextBillingNoteId();

    const record: BillingNoteRecord = {
      id: noteId,
      supplierName: inferredSupplier,
      supplierCode: supplierCode.trim() || matchedStore?.id || 'SUP-001',
      supplierTaxId: matchedStore?.taxId || '-',
      supplierInvoiceNo: supplierInvoiceNo.trim() || '-',
      billingDate,
      creditDays,
      dueDate,
      weightBasis,
      billingScope,
      vatMode,
      orderIds: Array.from(new Set(computedLines.map(l => l.orderId))),
      lines: computedLines,
      subtotalAmount: step1Totals.subtotalAmount,
      vatAmount: step1Totals.vatAmount,
      roundingAdjustment: Number(roundingAdjustment) || 0,
      supplierInvoiceTargetAmount: step1Totals.hasTarget ? step1Totals.targetVal : undefined,
      netTotalAmount: step1Totals.netTotalAmount,
      expressRrNumber: existingNote?.expressRrNumber,
      rrStampedAt: existingNote?.rrStampedAt,
      rrStampedBy: existingNote?.rrStampedBy,
      attachmentImage: attachmentImage || null,
      attachmentFileName: attachmentFileName || undefined,
      status: existingNote?.status || 'draft',
      notes: billingNotesText.trim(),
      createdBy: existingNote?.createdBy || currentUser.fullName,
      createdAt: existingNote?.createdAt || nowIso,
      updatedAt: nowIso
    };

    onSaveBillingNote(record, isNew);
    setActiveNoteIdForPreview(record.id);
    resetStep1Form();
    setActiveStepTab('step2');
  };

  const handleLoadNoteIntoStep1 = (note: BillingNoteRecord) => {
    if (note.status === 'rr_stamped_billed') {
      showToast('ชุดวางบิลนี้ประทับเลข RR ล็อกบิลแล้ว หากต้องการแก้ไขกรุณากดปลดล็อก (Unbill) ใน Step 4 ก่อน', 'info');
      return;
    }
    setEditingNoteId(note.id);
    setSelectedSupplier(note.supplierName);
    setSupplierCode(note.supplierCode || '');
    setSupplierInvoiceNo(note.supplierInvoiceNo === '-' ? '' : note.supplierInvoiceNo);
    setBillingDate(note.billingDate);
    setCreditDays(note.creditDays);
    setDueDate(note.dueDate);
    setWeightBasis(note.weightBasis);
    setBillingScope(note.billingScope);
    setVatMode(note.vatMode);
    setRoundingAdjustment(note.roundingAdjustment || 0);
    setSupplierInvoiceTargetAmount(
      note.supplierInvoiceTargetAmount ? String(note.supplierInvoiceTargetAmount) : ''
    );
    setBillingNotesText(note.notes || '');
    setAttachmentImage(note.attachmentImage || null);
    setAttachmentFileName(note.attachmentFileName || '');
    setSelectedOrderIds(Array.from(new Set(note.orderIds)));

    const subItemsMap: Record<string, OrderItemDetail[]> = {};
    const overrides: typeof rowOverrides = {};
    const countByOrder: Record<string, number> = {};

    note.lines.forEach(l => {
      const subIdx = countByOrder[l.orderId] || 0;
      countByOrder[l.orderId] = subIdx + 1;
      const lKey = `${l.orderId}__${subIdx}`;

      if (!subItemsMap[l.orderId]) {
        subItemsMap[l.orderId] = [];
      }
      subItemsMap[l.orderId].push({
        id: `${l.orderId}-${subIdx}`,
        itemDescription: l.itemDescription,
        specCode: l.specCode || '',
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        totalAmount: l.materialAmount
      });

      overrides[lKey] = {
        itemDescription: l.itemDescription,
        specCode: l.specCode,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        materialAmount: l.materialAmount,
        truckType: l.truckType,
        freightRate: l.freightRate,
        freightAmount: l.freightAmount
      };
    });

    setCustomOrderSubItems(subItemsMap);
    setRowOverrides(overrides);
    setActiveStepTab('step1');
  };

  // Export CSV / TXT for Express Accounting Software
  const handleExportExpressFile = (
    note: BillingNoteRecord,
    format: 'csv' | 'txt',
    mode: 'clean_import' | 'with_summary' = 'clean_import'
  ) => {
    const headers = [
      'BILLING_NOTE_NO',
      'SUPPLIER_CODE',
      'SUPPLIER_NAME',
      'SUPPLIER_TAX_ID',
      'SUPPLIER_INVOICE_NO',
      'BILLING_DATE',
      'DUE_DATE',
      'TR_NO',
      'DO_NO',
      'PO_NO',
      'DOC_DATE',
      'PROJECT_NAME',
      'CATEGORY',
      'ITEM_DESCRIPTION',
      'ORIGIN_NET_KG',
      'DEST_NET_KG',
      'CHOSEN_WEIGHT_KG',
      'QTY',
      'UNIT',
      'UNIT_PRICE',
      'MATERIAL_AMOUNT',
      'TRUCK_TYPE',
      'FREIGHT_RATE',
      'FREIGHT_AMOUNT',
      'LINE_NET_TOTAL',
      'EXPRESS_RR_NO'
    ];

    const sep = format === 'txt' ? '\t' : ',';
    const escapeCell = (val: string | number) => {
      const s = String(val ?? '');
      if (format === 'txt') return s.replace(/\t|\r|\n/g, ' ');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = note.lines.map(l =>
      [
        note.id,
        note.supplierCode || '',
        note.supplierName,
        note.supplierTaxId || '',
        note.supplierInvoiceNo || '',
        note.billingDate,
        note.dueDate,
        l.trNo,
        l.doNo,
        l.poNo,
        l.date,
        l.projectName,
        l.category,
        l.itemDescription,
        l.originNetKg,
        l.destNetKg,
        l.chosenWeightKg,
        l.qty,
        l.unit,
        l.unitPrice.toFixed(2),
        l.materialAmount.toFixed(2),
        l.truckType,
        l.freightRate.toFixed(2),
        l.freightAmount.toFixed(2),
        l.lineTotal.toFixed(2),
        note.expressRrNumber || ''
      ]
        .map(escapeCell)
        .join(sep)
    );

    // Summary footer row is added only when full statement mode is requested (avoiding import rejection in Express)
    if (mode === 'with_summary') {
      rows.push(
        [
          note.id,
          note.supplierCode || '',
          note.supplierName,
          '',
          note.supplierInvoiceNo || '',
          note.billingDate,
          note.dueDate,
          'SUMMARY',
          `รวม ${note.lines.length} ใบส่งของ`,
          '',
          '',
          '',
          `เกณฑ์น้ำหนัก: ${note.weightBasis}`,
          `ก่อนภาษี: ${note.subtotalAmount.toFixed(2)} | VAT: ${note.vatAmount.toFixed(2)} | ปรับเศษ: ${note.roundingAdjustment.toFixed(2)}`,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          note.netTotalAmount.toFixed(2),
          note.expressRrNumber || ''
        ]
          .map(escapeCell)
          .join(sep)
      );
    }

    const content = '\uFEFF' + [headers.join(sep), ...rows].join('\r\n');
    const mimeType =
      format === 'txt' ? 'text/plain;charset=utf-8;' : 'text/csv;charset=utf-8;';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filePrefix = mode === 'clean_import' ? 'Express_RR_CleanImport_' : 'Express_RR_Statement_';
    link.download = `${filePrefix}${note.id}_${note.supplierName.replace(/\s+/g, '_')}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (note.status === 'draft') {
      onSaveBillingNote(
        {
          ...note,
          status: 'exported_express',
          updatedAt: new Date().toISOString()
        },
        false
      );
    }
    showToast(`ส่งออกไฟล์สำหรับโปรแกรม Express (.${format.toUpperCase()}) เรียบร้อยแล้ว`);
  };

  const activePreviewNote = useMemo(() => {
    return (
      billingNotes.find(b => b.id === activeNoteIdForPreview) ||
      billingNotes[0] ||
      null
    );
  }, [billingNotes, activeNoteIdForPreview]);

  // Top KPI counts
  const unbilledDOCount = useMemo(() => {
    return allDeliveryOrders.filter(
      o =>
        o.billingStatus !== 'BILLED' &&
        !(o.col5 && o.col5.trim() !== '') &&
        !lockedOrderMap.has(o.id)
    ).length;
  }, [allDeliveryOrders, lockedOrderMap]);

  const pendingRRNotesCount = billingNotes.filter(
    b => b.status !== 'rr_stamped_billed'
  ).length;
  const completedRRNotesCount = billingNotes.filter(
    b => b.status === 'rr_stamped_billed'
  ).length;

  const filteredNotesForStep34 = useMemo(() => {
    return billingNotes.filter(b => {
      if (noteStatusFilter === 'pending_rr') return b.status !== 'rr_stamped_billed';
      if (noteStatusFilter === 'rr_stamped_billed') return b.status === 'rr_stamped_billed';
      return true;
    });
  }, [billingNotes, noteStatusFilter]);

  return (
    <div className="space-y-4">
      {/* Top 3-Step Lifecycle Pipeline (Hidden when printing Step 2 A4 sheet) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3.5 print:hidden">
        {/* Header row with title & workflow guide toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-2xs">
              <FileCheck2 className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">
                  ระบบรับวางบิลฝ่ายจัดซื้อ · เชื่อมต่อโปรแกรม Express
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] font-bold border border-emerald-200">
                  3 ขั้นตอนชัดเจน
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                กระบวนการตรวจรับบิลจากผู้จำหน่าย → พิมพ์ใบสรุปปะหน้า A4 → ส่งออก Express → ประทับเลข RR ปิดงาน
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowWorkflowGuide(prev => !prev)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                showWorkflowGuide
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <HelpCircle className="w-4 h-4 text-indigo-400" />
              <span>{showWorkflowGuide ? 'ซ่อนคำแนะนำขั้นตอน' : '💡 ดูผังขั้นตอนการทำงาน (Workflow)'}</span>
            </button>
          </div>
        </div>

        {/* Expandable Interactive Workflow Guide Card */}
        {showWorkflowGuide && (
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-xl p-4 space-y-3 border border-indigo-900 shadow-md animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-indigo-800/60 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>ผังการทำงานระบบรับวางบิล 3 ขั้นตอนหลัก (ฝ่ายจัดซื้อ & ฝ่ายบัญชี)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowWorkflowGuide(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ ปิด
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-white/10 rounded-lg p-3 space-y-1.5 border border-white/10">
                <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
                  <span className="w-5 h-5 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center text-[11px] font-extrabold">1</span>
                  <span>ขั้นที่ 1: ตรวจ & จัดชุดวางบิล (จัดซื้อ)</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  ได้รับใบวางบิลจากร้านค้า → <strong>เลือกร้านค้า</strong> → <strong>ติ๊กเลือกบิล DO</strong> ในรอบนี้ → <strong>ระบุราคาและเกณฑ์คิดเงิน</strong> → เทียบยอดรวมให้ตรงกับใบแจ้งหนี้ร้านค้า
                </p>
              </div>

              <div className="bg-white/10 rounded-lg p-3 space-y-1.5 border border-white/10">
                <div className="flex items-center gap-1.5 font-bold text-sky-300 text-xs">
                  <span className="w-5 h-5 rounded-full bg-sky-400 text-slate-900 flex items-center justify-center text-[11px] font-extrabold">2</span>
                  <span>ขั้นที่ 2: พิมพ์ A4 & ส่ง Express (จัดซื้อ/บัญชี)</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  พิมพ์<strong>ใบสรุปปะหน้า A4</strong> สำหรับลงนาม 3 ฝ่าย (จัดซื้อ/ตรวจบิล/อนุมัติ) และดาวน์โหลดไฟล์ <strong>.CSV / .TXT</strong> ไปนำเข้าโปรแกรม Express
                </p>
              </div>

              <div className="bg-white/10 rounded-lg p-3 space-y-1.5 border border-white/10">
                <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-xs">
                  <span className="w-5 h-5 rounded-full bg-emerald-400 text-slate-900 flex items-center justify-center text-[11px] font-extrabold">3</span>
                  <span>ขั้นที่ 3: ประทับเลข RR ปิดงาน (บัญชี)</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  เมื่อฝ่ายบัญชีบันทึกซื้อเชื่อใน Express ได้ <strong>เลขที่ RR</strong> แล้ว นำเลขมากรอก ระบบจะ <strong>Auto-Stamp ช่อง 5</strong> ลงใน DO ทุกใบและล็อกบิล <code className="text-emerald-300 font-mono">BILLED</code> ทันที
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Main 3-Step Interactive Pipeline Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* Step 1 Card */}
          <button
            type="button"
            onClick={() => setActiveStepTab('step1')}
            className={`text-left p-3 rounded-xl border transition cursor-pointer relative overflow-hidden ${
              activeStepTab === 'step1'
                ? 'bg-blue-50/70 border-blue-500 shadow-2xs ring-1 ring-blue-500/30'
                : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[11px] font-bold ${activeStepTab === 'step1' ? 'text-blue-900' : 'text-slate-600'}`}>
                1. ตรวจ & จัดชุดวางบิล
              </span>
              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                unbilledDOCount > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-200 text-slate-700'
              }`}>
                {unbilledDOCount} รอวางบิล
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              เลือกร้านค้า · ติ๊ก DO · ตั้งราคา · ตรวจยอดให้ตรง
            </div>
          </button>

          {/* Step 2 Card */}
          <button
            type="button"
            onClick={() => setActiveStepTab('step2')}
            className={`text-left p-3 rounded-xl border transition cursor-pointer relative overflow-hidden ${
              activeStepTab === 'step2'
                ? 'bg-indigo-50/70 border-indigo-500 shadow-2xs ring-1 ring-indigo-500/30'
                : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[11px] font-bold ${activeStepTab === 'step2' ? 'text-indigo-900' : 'text-slate-600'}`}>
                2. ใบสรุป A4 & ส่ง Express
              </span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 font-mono text-[10px] font-bold">
                {billingNotes.length} ชุด
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              ใบปะหน้าสรุป 3 ฝ่าย · Export .CSV / .TXT
            </div>
          </button>

          {/* Step 3 Card */}
          <button
            type="button"
            onClick={() => setActiveStepTab('step3_4')}
            className={`text-left p-3 rounded-xl border transition cursor-pointer relative overflow-hidden ${
              activeStepTab === 'step3_4'
                ? 'bg-emerald-50/70 border-emerald-500 shadow-2xs ring-1 ring-emerald-500/30'
                : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[11px] font-bold ${activeStepTab === 'step3_4' ? 'text-emerald-900' : 'text-slate-600'}`}>
                3. บันทึกเลข RR ปิดงาน
              </span>
              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                pendingRRNotesCount > 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
              }`}>
                {pendingRRNotesCount > 0 ? `รอ RR ${pendingRRNotesCount}` : 'ครบแล้ว'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              กรอกเลข RR จาก Express → Auto-Stamp ช่อง 5
            </div>
          </button>
        </div>
      </div>

      {/* =====================================================================
          STEP 1: ชนข้อมูล DO กับ ใบวางบิล Supplier (4 Guided Steps)
      ===================================================================== */}
      {activeStepTab === 'step1' && (
        <div className="space-y-4 print:hidden">
          {editingNoteId && (
            <div className="bg-amber-50/90 border border-amber-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs text-amber-900 shadow-2xs">
              <div className="flex items-center gap-2 font-semibold">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <span>กำลังแก้ไขชุดรับวางบิลเลขที่ <strong className="font-mono font-bold">{editingNoteId}</strong></span>
              </div>
              <button
                type="button"
                onClick={resetStep1Form}
                className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 text-xs font-semibold hover:bg-amber-100 cursor-pointer"
              >
                ยกเลิกแก้ไข (สร้างชุดใหม่)
              </button>
            </div>
          )}

          {/* Active 4-Step Wizard Stepper */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-2xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-black shadow-2xs">
                  {wizardStep}
                </span>
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <span>ขั้นตอนที่ {wizardStep} จาก 4:</span>
                    <span className="text-blue-700">
                      {wizardStep === 1 && '1. ข้อมูลร้านค้าและใบวางบิล Supplier'}
                      {wizardStep === 2 && '2. เลือกใบส่งของ (DO) ที่จะวางบิลรอบนี้'}
                      {wizardStep === 3 && '3. กำหนดเกณฑ์คิดเงิน & ตรวจสอบราคาสินค้า'}
                      {wizardStep === 4 && '4. ตรวจสอบความถูกต้องของยอดรวม (Reconciliation) & ยืนยันบันทึก'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {wizardStep === 1 && 'เลือกร้านค้าและกรอกข้อมูลตามใบวางบิลกระดาษของร้านค้า'}
                    {wizardStep === 2 && `ติ๊กเลือกใบส่งของ DO ของ "${selectedSupplier || 'ร้านค้า'}" ที่นำมาวางบิล`}
                    {wizardStep === 3 && 'เลือกเกณฑ์น้ำหนัก ขอบเขตยอด ภาษี VAT และตรวจเช็คราคาต่อหน่วย'}
                    {wizardStep === 4 && 'เปรียบเทียบยอดคำนวณกับยอดบิลร้านค้า และยืนยันสร้างชุดรับวางบิล'}
                  </div>
                </div>
              </div>

              {/* Clickable 4-Step Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {/* Step 1 Pill */}
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 text-left cursor-pointer ${
                    wizardStep === 1
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-600/20'
                      : selectedSupplier
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                      : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                    wizardStep === 1
                      ? 'bg-white text-blue-600'
                      : selectedSupplier
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-500 text-white'
                  }`}>
                    {selectedSupplier && wizardStep !== 1 ? '✓' : '1'}
                  </span>
                  <div className="truncate">
                    <div className="leading-tight text-[11px]">1. ร้านค้า & บิล</div>
                    <div className={`text-[10px] font-normal truncate ${wizardStep === 1 ? 'text-blue-100' : 'text-slate-500'}`}>
                      {selectedSupplier ? selectedSupplier : 'ยังไม่ระบุ'}
                    </div>
                  </div>
                </button>

                {/* Step 2 Pill */}
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedSupplier) {
                      showToast('กรุณาเลือกร้านค้าในขั้นตอนที่ 1 ก่อน', 'info');
                      return;
                    }
                    setWizardStep(2);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 text-left cursor-pointer ${
                    wizardStep === 2
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-2 ring-indigo-600/20'
                      : selectedOrderIds.length > 0
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                      : selectedSupplier
                      ? 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                      : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                    wizardStep === 2
                      ? 'bg-white text-indigo-600'
                      : selectedOrderIds.length > 0
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-300 text-slate-700'
                  }`}>
                    {selectedOrderIds.length > 0 && wizardStep !== 2 ? '✓' : '2'}
                  </span>
                  <div className="truncate">
                    <div className="leading-tight text-[11px]">2. เลือกใบ DO</div>
                    <div className={`text-[10px] font-normal truncate ${wizardStep === 2 ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {selectedOrderIds.length > 0 ? `${selectedOrderIds.length} ใบ` : 'ยังไม่เลือก'}
                    </div>
                  </div>
                </button>

                {/* Step 3 Pill */}
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedSupplier) {
                      showToast('กรุณาเลือกร้านค้าในขั้นตอนที่ 1 ก่อน', 'info');
                      return;
                    }
                    if (selectedOrderIds.length === 0) {
                      showToast('กรุณาเลือกใบส่งของ (DO) ในขั้นตอนที่ 2 ก่อน', 'info');
                      return;
                    }
                    setWizardStep(3);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 text-left cursor-pointer ${
                    wizardStep === 3
                      ? 'bg-teal-700 text-white border-teal-700 shadow-xs ring-2 ring-teal-700/20'
                      : weightBasis && billingScope && vatMode
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                      : selectedOrderIds.length > 0
                      ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                      : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                    wizardStep === 3
                      ? 'bg-white text-teal-700'
                      : weightBasis && billingScope && vatMode
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-300 text-slate-700'
                  }`}>
                    {weightBasis && billingScope && vatMode && wizardStep !== 3 ? '✓' : '3'}
                  </span>
                  <div className="truncate">
                    <div className="leading-tight text-[11px]">3. เกณฑ์ & ราคา</div>
                    <div className={`text-[10px] font-normal truncate ${wizardStep === 3 ? 'text-teal-100' : 'text-slate-500'}`}>
                      {weightBasis ? 'กำหนดแล้ว' : 'รอกำหนด'}
                    </div>
                  </div>
                </button>

                {/* Step 4 Pill */}
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedSupplier) {
                      showToast('กรุณาเลือกร้านค้าในขั้นตอนที่ 1 ก่อน', 'info');
                      return;
                    }
                    if (selectedOrderIds.length === 0) {
                      showToast('กรุณาเลือกใบส่งของ (DO) ในขั้นตอนที่ 2 ก่อน', 'info');
                      return;
                    }
                    if (!weightBasis || !billingScope || !vatMode) {
                      showToast('กรุณากำหนดเกณฑ์คำนวณและภาษีในขั้นตอนที่ 3 ก่อน', 'info');
                      return;
                    }
                    setWizardStep(4);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 text-left cursor-pointer ${
                    wizardStep === 4
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs ring-2 ring-slate-900/20'
                      : selectedOrderIds.length > 0 && weightBasis && billingScope && vatMode
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                      : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                    wizardStep === 4
                      ? 'bg-emerald-400 text-slate-950'
                      : selectedOrderIds.length > 0 && weightBasis && billingScope && vatMode
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-300 text-slate-700'
                  }`}>
                    4
                  </span>
                  <div className="truncate">
                    <div className="leading-tight text-[11px]">4. ตรวจสอบ & บันทึก</div>
                    <div className={`text-[10px] font-normal truncate ${wizardStep === 4 ? 'text-slate-300' : 'text-slate-500'}`}>
                      ฿{step1Totals.netTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* =================================================================
              SUB-STEP 1: ข้อมูลร้านค้าและใบวางบิลจริง
          ================================================================= */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xs font-black shadow-2xs">
                      1
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        ขั้นตอนที่ 1: ข้อมูลร้านค้าและใบวางบิลจากซัพพลายเออร์
                      </h3>
                      <p className="text-xs text-slate-500">
                        เลือกร้านค้าที่นำเอกสารมาวางบิล และระบุยอดเงินตามบิลกระดาษเพื่อใช้ตรวจทานยอดผลต่าง
                      </p>
                    </div>
                  </div>

                  {/* Attachment indicator if file exists */}
                  <div className="flex items-center gap-2">
                    {attachmentImage && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewAttachmentModal({
                            image: attachmentImage,
                            title: `เอกสารใบวางบิล: ${attachmentFileName || supplierInvoiceNo || selectedSupplier || 'แนบไว้'}`
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-indigo-100"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                        <span>ดูไฟล์แนบ ({attachmentFileName || 'เอกสาร'})</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Supplier Chips if none selected */}
                {!selectedSupplier && topPendingSuppliers.length > 0 && (
                  <div className="bg-amber-50/70 rounded-xl p-3 border border-amber-200 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-amber-700" />
                      <span>เลือกร้านค้าด่วนที่มีบิลรอวางบิล:</span>
                    </span>
                    {topPendingSuppliers.map(([sName, stat]) => (
                      <button
                        key={sName}
                        type="button"
                        onClick={() => handleSelectSupplier(sName, true)}
                        className="px-3 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 font-semibold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      >
                        <span>{sName}</span>
                        <span className="px-1.5 py-0.2 rounded-full bg-amber-200 text-amber-900 text-[10px] font-mono font-bold">
                          {stat.unbilled} ใบ
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Main Form Fields: Clean 6-Field Grid (Directly Visible, Never Hidden!) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {/* 1.1 Supplier Select */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      1.1 ร้านค้า / ผู้จำหน่าย <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={selectedSupplier}
                      onChange={e => handleSelectSupplier(e.target.value, true)}
                      className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold transition ${
                        selectedSupplier
                          ? 'border-slate-300 text-slate-900 bg-white ring-1 ring-blue-500/20'
                          : 'border-amber-400 bg-amber-50/40 text-amber-950 ring-2 ring-amber-400/30'
                      }`}
                    >
                      <option value="">-- เลือกร้านค้า / แสดงทั้งหมด ({supplierOptions.length}) --</option>
                      {supplierOptions.map(([sName, stat]) => (
                        <option key={sName} value={sName}>
                          {sName} ({stat.unbilled} รอวางบิล · รวม {stat.total})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 1.2 Invoice Number */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      1.2 เลขที่ใบวางบิล / ใบแจ้งหนี้
                    </label>
                    <input
                      type="text"
                      value={supplierInvoiceNo}
                      onChange={e => setSupplierInvoiceNo(e.target.value)}
                      placeholder="เช่น INV-6903-088"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 bg-white"
                    />
                  </div>

                  {/* 1.3 Target Invoice Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        1.3 ยอดเงินตามใบวางบิลร้านค้า (บาท)
                      </label>
                      <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1 rounded">
                        เป้าหมายเทียบยอด
                      </span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={supplierInvoiceTargetAmount}
                      onChange={e => setSupplierInvoiceTargetAmount(e.target.value)}
                      placeholder="กรอกยอดเงินตามกระดาษบิล..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 bg-white"
                    />
                  </div>

                  {/* 1.4 Billing Date & Due Date */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        1.4 วันที่วางบิล & ครบกำหนด
                      </label>
                      <span className="text-[10px] text-slate-500 font-mono">เครดิต {creditDays} วัน</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="date"
                        value={billingDate}
                        onChange={e => {
                          setBillingDate(e.target.value);
                          setDueDate(addDaysToDateStr(e.target.value, creditDays));
                        }}
                        className="w-full px-2 py-2 rounded-xl border border-slate-300 text-[11px] font-mono text-slate-900 bg-white"
                        title="วันที่รับวางบิล"
                      />
                      <input
                        type="date"
                        value={dueDate}
                        onChange={e => setDueDate(e.target.value)}
                        className="w-full px-2 py-2 rounded-xl border border-slate-300 text-[11px] font-mono text-slate-900 bg-white"
                        title="วันครบกำหนดชำระ"
                      />
                    </div>
                  </div>

                  {/* 1.5 Supplier Code Express */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      1.5 รหัสเจ้าหนี้ Express
                    </label>
                    <input
                      type="text"
                      value={supplierCode}
                      onChange={e => setSupplierCode(e.target.value)}
                      placeholder="เช่น SUP-001 (ถ้ามี)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>

                  {/* 1.6 File Attachment - Directly Visible (Never Hidden!) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      1.6 แนบเอกสารใบวางบิล (รูปภาพ / PDF)
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800 flex items-center gap-1.5 cursor-pointer shadow-2xs shrink-0">
                        <Upload className="w-3.5 h-3.5 text-indigo-600" />
                        <span>{attachmentImage ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์แนบ'}</span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleAttachmentUpload}
                          className="hidden"
                        />
                      </label>

                      {attachmentImage && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewAttachmentModal({
                                image: attachmentImage,
                                title: `เอกสารใบวางบิล: ${attachmentFileName || supplierInvoiceNo || selectedSupplier || 'แนบไว้'}`
                              })
                            }
                            className="p-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 cursor-pointer"
                            title="ดูเอกสาร"
                          >
                            <Paperclip className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachmentImage(null);
                              setAttachmentFileName('');
                            }}
                            className="p-2 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 cursor-pointer"
                            title="ลบไฟล์แนบ"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}

                      <span className="text-[11px] text-slate-500 truncate" title={attachmentFileName || ''}>
                        {attachmentFileName || (attachmentImage ? 'แนบไฟล์แล้ว' : 'ยังไม่ได้แนบ')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Selected Supplier Status Summary Banner */}
                {selectedSupplier && (
                  <div className="bg-blue-50/80 rounded-xl p-3.5 border border-blue-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-blue-950 text-sm">
                          เลือกร้านค้า: {selectedSupplier}
                        </div>
                        <div className="text-blue-800 text-xs">
                          พบใบส่งของ (DO) ในระบบรอวางบิลทั้งหมด{' '}
                          <strong className="font-mono font-bold text-blue-950">
                            {availableDOsForStep1.filter(o => !lockedOrderMap.has(o.id) && o.col5 !== 'BILLED').length}
                          </strong>{' '}
                          ใบ (จากทั้งหมด {availableDOsForStep1.length} ใบ)
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWizardStep(2)}
                        className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm flex items-center gap-2 cursor-pointer transition"
                      >
                        <span>ไปเลือกใบส่งของ (DO) ➔</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Navigation for Step 1 */}
              <div className="bg-slate-100 rounded-2xl p-3 border border-slate-200/90 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="text-slate-600 font-medium">
                  {selectedSupplier ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>ระบุร้านค้าเรียบร้อย พร้อมเลือกใบส่งของ</span>
                    </span>
                  ) : (
                    <span className="text-amber-800 font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <span>กรุณาเลือกร้านค้า/ผู้จำหน่าย เพื่อเปิดไปยังขั้นตอนที่ 2</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!selectedSupplier) {
                      showToast('กรุณาเลือกร้านค้า/ผู้จำหน่ายก่อนดำเนินการต่อ', 'info');
                      return;
                    }
                    setWizardStep(2);
                  }}
                  disabled={!selectedSupplier}
                  className={`px-6 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 shadow-xs cursor-pointer ${
                    selectedSupplier
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span>ถัดไป: ไปเลือกใบส่งของ (DO) ที่จะวางบิลรอบนี้</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* =================================================================
              SUB-STEP 2: ตรวจสอบและเลือกใบส่งของ (DO) ที่จะวางบิลรอบนี้
          ================================================================= */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              {/* Context Summary Banner */}
              <div className="bg-slate-900 text-white rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500 text-white flex items-center justify-center font-bold">
                    2
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">ร้านค้าที่กำลังวางบิล:</div>
                    <div className="font-bold text-sm text-white flex items-center gap-2">
                      <span>{selectedSupplier || 'ยังไม่ได้ระบุร้านค้า'}</span>
                      {supplierInvoiceNo && (
                        <span className="text-xs font-mono font-normal text-indigo-300">
                          (เลขที่บิล: {supplierInvoiceNo})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="text-[10px] text-slate-400">ยอดตามบิลร้านค้า:</div>
                    <div className="font-mono font-bold text-amber-300">
                      {supplierInvoiceTargetAmount
                        ? `฿${Number(supplierInvoiceTargetAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                        : 'ไม่ได้ระบุ'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer border border-slate-700 transition"
                  >
                    ✏️ แก้ไขข้อมูลร้านค้า/บิล
                  </button>
                </div>
              </div>

              {/* Main DO Table Card */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden space-y-0">
            {/* Section Header */}
            <div className="px-4 py-3 border-b border-slate-200/80 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-2xs">
                  2
                </span>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    ตรวจสอบและเลือกใบส่งของ (DO) ที่จะวางบิลรอบนี้
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {selectedSupplier
                      ? `กำลังแสดงใบส่งของของ "${selectedSupplier}" — ติ๊กเลือกบิลที่ร้านค้านำมาวางบิลรอบนี้`
                      : 'กรุณาเลือกร้านค้าใน [ขั้นตอนที่ 1] เพื่อแสดงรายการใบส่งของ (DO)'}
                  </p>
                </div>
              </div>

              {/* Status pill */}
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 font-semibold font-mono">
                  เลือกแล้ว {selectedOrderIds.length} ใบ DO · {computedLines.length} รายการสินค้า
                </span>
              </div>
            </div>

            {/* Main Single-Line Data Toolbar */}
            <div className="px-3.5 py-2.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5 bg-white text-xs">
              {/* Left: Selection Controls */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-semibold text-slate-800 cursor-pointer shadow-2xs"
                >
                  {selectableVisibleDOs.length > 0 &&
                  selectableVisibleDOs.every(o => selectedOrderIds.includes(o.id))
                    ? 'ยกเลิกเลือก'
                    : `เลือกทั้งหมด (${selectableVisibleDOs.length})`}
                </button>

                {/* State Segmented Tab */}
                <div className="flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDoBillingStateFilter('all')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                      doBillingStateFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ทั้งหมด ({availableDOsForStep1.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDoBillingStateFilter('unbilled_only')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                      doBillingStateFilter === 'unbilled_only'
                        ? 'bg-amber-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    เฉพาะรอวางบิล
                  </button>
                </div>

                {/* Weigh Type Segmented Tab */}
                <div className="hidden sm:flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDoWeighTypeFilter('all')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                      doWeighTypeFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ทุกประเภท
                  </button>
                  <button
                    type="button"
                    onClick={() => setDoWeighTypeFilter('general_non_weighed')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                      doWeighTypeFilter === 'general_non_weighed'
                        ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="บิลสินค้าทั่วไปที่ไม่ชั่งน้ำหนัก"
                  >
                    ไม่ชั่ง นน.
                  </button>
                  <button
                    type="button"
                    onClick={() => setDoWeighTypeFilter('weighed')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                      doWeighTypeFilter === 'weighed'
                        ? 'bg-teal-700 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="บิลชั่งน้ำหนัก หิน ดิน ทราย"
                  >
                    ชั่งน้ำหนัก
                  </button>
                </div>
              </div>

              {/* Right: Search, Filter Toggle & Pricing Tools Button */}
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="ค้นหา DO, PO, ทะเบียน..."
                    className="pl-7 pr-2 py-1 rounded-lg border border-slate-300 text-xs bg-white w-40 sm:w-48 focus:outline-none focus:ring-1 focus:ring-slate-800"
                  />
                </div>

                {/* Filter Toggle */}
                <button
                  type="button"
                  onClick={() => setIsFilterDrawerOpen(prev => !prev)}
                  className={`p-1.5 rounded-lg border transition cursor-pointer ${
                    isFilterDrawerOpen || projectFilter !== 'all' || dateFrom || dateTo
                      ? 'bg-slate-100 border-slate-300 text-slate-900'
                      : 'border-slate-300 hover:bg-slate-100 text-slate-600'
                  }`}
                  title="ตัวกรองโครงการ & วันที่"
                >
                  <Filter className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter Sub-Drawer (Clean & Non-Intrusive) */}
            {isFilterDrawerOpen && (
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">โครงการ:</span>
                  <select
                    value={projectFilter}
                    onChange={e => setProjectFilter(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs"
                  >
                    <option value="all">ทุกโครงการ</option>
                    {projectOptions.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">ตั้งแต่วันที่:</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="px-2 py-0.5 rounded border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">ถึงวันที่:</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="px-2 py-0.5 rounded border border-slate-300 bg-white text-xs font-mono"
                  />
                </div>

                {(projectFilter !== 'all' || dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setProjectFilter('all');
                      setDateFrom('');
                      setDateTo('');
                    }}
                    className="text-[11px] text-rose-600 font-semibold hover:underline cursor-pointer"
                  >
                    ล้างตัวกรอง
                  </button>
                )}
              </div>
            )}

            {/* DO Data Table - Dedicated to Selection (Pricing Handled in Step 3) */}
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-900 text-slate-100 sticky top-0 z-10 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3 text-center w-8">เลือก</th>
                    <th className="py-2.5 px-2.5">วันที่ / เลข DO</th>
                    <th className="py-2.5 px-2.5">โครงการ / ไซต์งาน</th>
                    <th className="py-2.5 px-2.5">ทะเบียนรถ / ผู้ส่ง</th>
                    <th className="py-2.5 px-2.5">รายการวัสดุ / สินค้า</th>
                    <th className="py-2.5 px-2 text-right">นน.ต้นทาง</th>
                    <th className="py-2.5 px-2 text-right">นน.ปลายทาง</th>
                    <th className="py-2.5 px-2 text-right">ปริมาณ (22)</th>
                    <th className="py-2.5 px-2.5 text-center">สถานะ</th>
                    <th className="py-2.5 px-2 text-center w-8">ดู</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {availableDOsForStep1.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-500 text-xs bg-slate-50/40">
                        {!selectedSupplier ? (
                          <div className="space-y-2 max-w-md mx-auto">
                            <Building2 className="w-8 h-8 text-amber-500 mx-auto" />
                            <div className="font-bold text-slate-800 text-xs">
                              กรุณาเลือกร้านค้า / ผู้จำหน่าย ใน [ขั้นตอนที่ 1] ด้านบน
                            </div>
                            <p className="text-[11px] text-slate-500">
                              ระบบจะดึงเฉพาะใบส่งของ (DO) ของร้านค้านั้นขึ้นมาให้ตรวจทานและติ๊กเลือกจัดชุดวางบิล
                            </p>
                          </div>
                        ) : (
                          <div>ไม่พบใบส่งของ (DO) ของร้านนี้ตามเงื่อนไขที่เลือก</div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    availableDOsForStep1.map(ord => {
                      const isSelected = selectedOrderIds.includes(ord.id);
                      const isEditingThis = editingNoteId && selectedOrderIds.includes(ord.id);
                      const lockedInNote = !isEditingThis ? lockedOrderMap.get(ord.id) : undefined;
                      const isAlreadyBilled =
                        !isEditingThis &&
                        (ord.billingStatus === 'BILLED' || Boolean(ord.col5 && ord.col5.trim() !== ''));
                      const isDisabledForNewBilling = isAlreadyBilled || Boolean(lockedInNote);

                      const subItems = getEffectiveSubItemsForOrder(ord);
                      const isMultiItemDO = subItems.length > 1;
                      const originKg = Number(ord.col15) || 0;
                      const destKg = Number(ord.col20) || 0;

                      return (
                        <React.Fragment key={ord.id}>
                          {subItems.map((sub, subIdx) => {
                            const lKey = `${ord.id}__${subIdx}`;
                            const isFirstSubRow = subIdx === 0;

                            return (
                              <tr
                                key={lKey}
                                className={`transition ${
                                  isSelected
                                    ? isFirstSubRow
                                      ? 'bg-blue-50/50'
                                      : 'bg-indigo-50/30'
                                    : isDisabledForNewBilling
                                    ? 'bg-slate-50 text-slate-400'
                                    : 'hover:bg-slate-50/60'
                                }`}
                              >
                                <td className="py-2.5 px-3 text-center">
                                  {!isFirstSubRow ? (
                                    <span className="text-[10px] font-mono text-slate-400">
                                      #{subIdx + 1}
                                    </span>
                                  ) : isAlreadyBilled ? (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]"
                                      title={`วางบิลแล้ว (RR: ${ord.col5 || 'BILLED'})`}
                                    >
                                      RR
                                    </span>
                                  ) : lockedInNote ? (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[10px]"
                                      title={`อยู่ในชุดรับวางบิล ${lockedInNote.id}`}
                                    >
                                      ชุดนี้
                                    </span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => handleToggleSelectOrder(ord.id, ord.col8)}
                                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer"
                                    />
                                  )}
                                </td>

                                <td className="py-2.5 px-2.5">
                                  {isFirstSubRow ? (
                                    <>
                                      <div className="font-mono font-bold text-slate-900 flex items-center gap-1">
                                        <span>{ord.col6 || ord.col1}</span>
                                        {isMultiItemDO && (
                                          <span className="text-[10px] font-normal text-indigo-600">
                                            ({subItems.length} รายการ)
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono">
                                        {ord.col7} · {ord.col1}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-[10px] text-slate-400 font-mono pl-2">
                                      ↳ รายการที่ {subIdx + 1}/{subItems.length}
                                    </div>
                                  )}
                                </td>

                                <td className="py-2.5 px-2.5 max-w-[160px]">
                                  {isFirstSubRow ? (
                                    <>
                                      <div className="font-medium text-slate-900 truncate">
                                        {ord.col8 || '-'}
                                      </div>
                                      <div className="text-[10px] text-slate-400 truncate">
                                        {ord.col2 || 'ไม่ระบุโครงการ'}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 truncate block">
                                      {ord.col2 || '-'}
                                    </span>
                                  )}
                                </td>

                                <td className="py-2.5 px-2.5 max-w-[140px]">
                                  {isFirstSubRow ? (
                                    <>
                                      <div className="font-mono text-slate-800 truncate">
                                        {ord.col10 || '-'}
                                      </div>
                                      <div className="text-[10px] text-slate-400 truncate">
                                        {ord.col9 || 'ไม่ระบุผู้ขับ'}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-mono block">
                                      {ord.col10 || '-'}
                                    </span>
                                  )}
                                </td>

                                {/* Item Description */}
                                <td className="py-2.5 px-2.5 min-w-[180px]">
                                  <div className="font-medium text-slate-800">
                                    {sub.itemDescription || ord.col11 || '-'}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    PO: {ord.col4 || '-'}
                                  </div>
                                </td>

                                <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                                  {isFirstSubRow && originKg > 0 ? originKg.toLocaleString() : '-'}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                                  {isFirstSubRow && destKg > 0 ? destKg.toLocaleString() : '-'}
                                </td>

                                {/* Quantity & Unit */}
                                <td className="py-2.5 px-2 text-right font-mono text-slate-800">
                                  {Number(sub.qty || (isFirstSubRow ? ord.col22 : 0) || 0).toLocaleString()}{' '}
                                  <span className="text-[10px] text-slate-400">{sub.unit || ord.col23 || ''}</span>
                                </td>

                                {/* Status Badge */}
                                <td className="py-2.5 px-2 text-center">
                                  {isAlreadyBilled ? (
                                    <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono text-[10px]">
                                      วางบิลแล้ว ({ord.col5})
                                    </span>
                                  ) : lockedInNote ? (
                                    <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-mono text-[10px]">
                                      อยู่ในชุด {lockedInNote.id}
                                    </span>
                                  ) : (
                                    <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-mono text-[10px] font-bold">
                                      รอวางบิล
                                    </span>
                                  )}
                                </td>

                                <td className="py-2.5 px-2 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {isFirstSubRow ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => onInspectOrder(ord)}
                                          className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                                          title="ดูบิลและ 39 คอลัมน์"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        {isSelected && !isAlreadyBilled && (
                                          <button
                                            type="button"
                                            onClick={() => handleAddSubItemToOrder(ord)}
                                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 cursor-pointer flex items-center gap-0.5"
                                            title="เพิ่มรายการย่อยในใบส่งของ (DO) นี้"
                                          >
                                            <Plus className="w-3 h-3" />
                                            <span>ย่อย</span>
                                          </button>
                                        )}
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveSubItemFromOrder(ord, subIdx)}
                                        className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
                                        title="ลบรายการย่อยนี้ออกจากใบ DO"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Navigation for Step 2 */}
            <div className="bg-slate-100 rounded-2xl p-3 border border-slate-200/90 flex flex-wrap items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="px-4 py-2.5 rounded-xl font-semibold text-xs border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer transition shadow-2xs"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ: ข้อมูลร้านค้า & บิล</span>
              </button>

              <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                <span className="px-3 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 font-mono font-bold">
                  เลือกแล้ว {selectedOrderIds.length} ใบ DO · {computedLines.length} รายการสินค้า
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (selectedOrderIds.length === 0) {
                    showToast('กรุณาติ๊กเลือกใบส่งของ (DO) ในตารางอย่างน้อย 1 ใบก่อนดำเนินการต่อ', 'info');
                    return;
                  }
                  setWizardStep(3);
                }}
                disabled={selectedOrderIds.length === 0}
                className={`px-6 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 shadow-xs cursor-pointer ${
                  selectedOrderIds.length > 0
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span>ถัดไป: กำหนดเกณฑ์คำนวณ & ตรวจสอบราคาสินค้า</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* =================================================================
            SUB-STEP 3: กำหนดเกณฑ์คิดเงิน & ตรวจสอบราคาสินค้า
        ================================================================= */}
        {wizardStep === 3 && (
          <div className="space-y-4">
            {/* Context Summary Banner */}
            <div className="bg-slate-900 text-white rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-teal-500 text-white flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">ร้านค้า / ชุดบิล:</div>
                  <div className="font-bold text-sm text-white flex items-center gap-2">
                    <span>{selectedSupplier}</span>
                    <span className="text-xs font-normal text-teal-300">
                      (เลือกไว้ {selectedOrderIds.length} ใบ DO · {computedLines.length} รายการ)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setWizardStep(2)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer border border-slate-700 transition"
                >
                  📋 เปลี่ยนรายการ DO ที่เลือก
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-xl bg-teal-600 text-white flex items-center justify-center text-xs font-black shadow-2xs">
                    3
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ขั้นตอนที่ 3: กำหนดเกณฑ์คิดเงิน & ตรวจสอบราคาสินค้า
                    </h3>
                    <p className="text-xs text-slate-500">
                      เลือกเกณฑ์ปริมาณ/น้ำหนัก ขอบเขต และภาษี VAT ที่ตรงกับใบวางบิลของร้านค้า
                    </p>
                  </div>
                </div>

              {/* Status Indicator */}
              <div className="flex items-center gap-1.5 text-xs">
                {computedLines.some(l => (l.unitPrice || 0) <= 0) && selectedOrderIds.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                    <span>มีรายการรอราคา</span>
                  </span>
                ) : selectedOrderIds.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-bold flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>ราคาสินค้าครบถ้วน</span>
                  </span>
                ) : null}
              </div>
            </div>

            {/* Criteria Selection Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 3.1 Weight Basis Segmented Control */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                  3.1 เกณฑ์ปริมาณ / น้ำหนักคิดเงิน <span className="text-rose-500">*</span>
                </label>
                <div
                  className={`inline-flex flex-wrap items-center p-0.5 rounded-xl border transition w-full ${
                    weightBasis ? 'bg-slate-100 border-slate-200' : 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setWeightBasis('none_qty');
                      setRowOverrides({});
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer text-center ${
                      weightBasis === 'none_qty'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="สำหรับบิลสินค้าทั่วไปที่ไม่มีการชั่งน้ำหนัก เช่น ปูนถุง เหล็ก ท่อ (ใช้จำนวนตามช่อง 22)"
                  >
                    📦 ไม่ชั่ง นน. (22)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWeightBasis('origin');
                      setRowOverrides({});
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer text-center ${
                      weightBasis === 'origin'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="ใช้น้ำหนักต้นทาง (ช่อง 15)"
                  >
                    ⚖️ ต้นทาง (15)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWeightBasis('dest');
                      setRowOverrides({});
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer text-center ${
                      weightBasis === 'dest'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="ใช้น้ำหนักปลายทาง (ช่อง 20)"
                  >
                    ⚖️ ปลายทาง (20)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWeightBasis('min');
                      setRowOverrides({});
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition cursor-pointer text-center ${
                      weightBasis === 'min'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="ใช้น้ำหนักที่น้อยกว่า MIN(15,20)"
                  >
                    ⚖️ MIN(15,20)
                  </button>
                </div>
              </div>

              {/* 3.2 Scope Select */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                  3.2 ขอบเขตยอดที่รับวางบิล <span className="text-rose-500">*</span>
                </label>
                <select
                  value={billingScope}
                  onChange={e => setBillingScope(e.target.value as BillingScopeMode | '')}
                  className={`w-full px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
                    billingScope
                      ? 'border-slate-300 text-slate-900 bg-white'
                      : 'border-amber-300 text-amber-900 bg-amber-50/50'
                  }`}
                >
                  <option value="">-- เลือกขอบเขตยอด --</option>
                  <option value="both">รวมค่าวัสดุ + ค่าขนส่ง (29)</option>
                  <option value="material_only">เฉพาะค่าวัสดุ (25)</option>
                  <option value="transport_only">เฉพาะค่าขนส่ง (28)</option>
                </select>
              </div>

              {/* 3.3 VAT Select */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                  3.3 การคิดภาษีมูลค่าเพิ่ม (VAT) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={vatMode}
                  onChange={e => setVatMode(e.target.value as BillingVatMode | '')}
                  className={`w-full px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
                    vatMode
                      ? 'border-slate-300 text-slate-900 bg-white'
                      : 'border-amber-300 text-amber-900 bg-amber-50/50'
                  }`}
                >
                  <option value="">-- เลือกประเภท VAT --</option>
                  <option value="exclude_7">แยก VAT 7%</option>
                  <option value="include_7">รวม VAT 7% ในราคา</option>
                  <option value="none">ไม่มี VAT (0%)</option>
                </select>
              </div>
            </div>

            {/* Missing Price Notice & Quick Action */}
            {selectedOrderIds.length > 0 && computedLines.some(l => (l.unitPrice || 0) <= 0) && (
              <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs text-amber-950">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    พบ <strong>{computedLines.filter(l => (l.unitPrice || 0) <= 0).length}</strong> รายการสินค้าที่ยังไม่ได้ระบุราคาต่อหน่วย (ระบุราคาในตารางด้านล่าง หรือใช้เครื่องมือดึงราคา)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePullPriceFromLinkedPO}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition cursor-pointer shadow-2xs"
                  >
                    ดึงราคาตาม PO อัตโนมัติ
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPricingToolsOpen(prev => !prev)}
                    className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 font-semibold transition cursor-pointer"
                  >
                    {isPricingToolsOpen ? 'ซ่อนเครื่องมือกำหนดราคา' : 'เปิดเครื่องมือกำหนดราคา'}
                  </button>
                </div>
              </div>
            )}

            {/* Dedicated Pricing Tools Card in Step 3 */}
            {isPricingToolsOpen && (
              <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-2">
                  <span className="font-bold text-indigo-950">
                    🛠️ เครื่องมือกำหนดราคาด่วนสำหรับ {computedLines.length} รายการ:
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsPricingToolsOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handlePullPriceFromLinkedPO}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition cursor-pointer shadow-2xs"
                  >
                    ⚡ ดึงราคาตาม PO
                  </button>

                  <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-300">
                    <span className="text-[11px] text-slate-600">ราคาเดียวทุกรายการ:</span>
                    <input
                      type="number"
                      step="0.01"
                      value={bulkUnitPriceInput}
                      onChange={e => setBulkUnitPriceInput(e.target.value)}
                      placeholder="0.00"
                      className="w-16 px-1.5 py-0.5 rounded border border-slate-200 text-right font-mono text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={handleBulkApplyUnitPrice}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold cursor-pointer"
                    >
                      ใช้ราคานี้
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-300">
                    <span className="text-[11px] text-slate-600">เรทค่าขนส่ง:</span>
                    <input
                      type="number"
                      step="0.01"
                      value={bulkFreightRateInput}
                      onChange={e => setBulkFreightRateInput(e.target.value)}
                      placeholder="0.00"
                      className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-right font-mono text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={handleBulkApplyFreightRate}
                      className="px-2 py-0.5 rounded bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold cursor-pointer"
                    >
                      ใช้เรทนี้
                    </button>
                  </div>

                  {distinctProductGroups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setShowProductGroupPricing(prev => !prev)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        showProductGroupPricing
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-indigo-300 text-indigo-900 hover:bg-indigo-50'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>กำหนดราคาแยกตามชนิดสินค้า ({distinctProductGroups.length})</span>
                    </button>
                  )}
                </div>

                {showProductGroupPricing && distinctProductGroups.length > 0 && (
                  <div className="bg-white rounded-xl border border-indigo-200 p-2.5 space-y-2">
                    <div className="font-bold text-slate-800 text-[11px]">
                      กำหนดราคาแยกตามชนิดสินค้า:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {distinctProductGroups.map(group => (
                        <div key={group.groupKey} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                          <div className="font-semibold text-slate-900 truncate">
                            {group.itemDescription} ({group.totalQty.toLocaleString('th-TH')} {group.unit})
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-500">ราคา/หน่วย:</span>
                            <input
                              type="number"
                              step="0.01"
                              value={productGroupPriceInputs[group.groupKey]?.unitPrice ?? (group.currentUnitPrice > 0 ? String(group.currentUnitPrice) : '')}
                              onChange={e => {
                                const val = e.target.value;
                                setProductGroupPriceInputs(prev => ({
                                  ...prev,
                                  [group.groupKey]: {
                                    ...prev[group.groupKey],
                                    unitPrice: val,
                                    freightRate: prev[group.groupKey]?.freightRate ?? (group.currentFreightRate > 0 ? String(group.currentFreightRate) : '')
                                  }
                                }));
                              }}
                              placeholder="0.00"
                              className="w-16 px-1.5 py-0.5 rounded border border-slate-300 text-right font-mono bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleApplyPriceToProductGroup(group.groupKey)}
                              className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-semibold cursor-pointer"
                            >
                              ใช้
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Itemized Price Review Table in Step 3 */}
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="font-bold text-xs text-slate-800">
                  ตรวจสอบและปรับราคาต่อหน่วยของรายการในชุดวางบิล ({computedLines.length} รายการ):
                </span>
                <span className="text-[11px] text-slate-500">
                  แก้ไขราคาต่อหน่วยหรือยอดเงินในช่องได้โดยตรง
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100/90 text-slate-600 font-semibold sticky top-0">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">เลขที่ DO / โครงการ</th>
                      <th className="py-2 px-3">รายการสินค้า</th>
                      <th className="py-2 px-3 text-right">ปริมาณ/นน.</th>
                      <th className="py-2 px-3 text-right">หน่วย</th>
                      <th className="py-2 px-3 text-right w-24">ราคา/หน่วย (บาท)</th>
                      <th className="py-2 px-3 text-right w-24">ยอดค่าวัสดุ</th>
                      <th className="py-2 px-3 text-right w-20">ค่าขนส่ง</th>
                      <th className="py-2 px-3 text-right">ยอดรวมบรรทัด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {computedLines.map((line, idx) => {
                      const lKey = line.lineKey || `${line.orderId}__0`;
                      const isPriceMissing = (line.unitPrice || 0) <= 0;

                      return (
                        <tr key={lKey} className={`hover:bg-slate-50 ${isPriceMissing ? 'bg-amber-50/40' : ''}`}>
                          <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono">
                            <div className="font-bold text-slate-900 flex items-center gap-1">
                              <span>{line.doNo && line.doNo !== '-' ? line.doNo : (line.trNo && line.trNo !== '-' ? line.trNo : line.orderId)}</span>
                              {line.subItemIndex !== undefined && line.subItemIndex > 0 && (
                                <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1 py-0.2 rounded font-medium">
                                  #{line.subItemIndex + 1}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[130px]" title={line.projectName}>
                              {line.projectName}
                              {line.poNo && line.poNo !== '-' ? ` · PO: ${line.poNo}` : ''}
                            </div>
                          </td>
                          <td className="py-1 px-2 font-medium text-slate-800">
                            <input
                              type="text"
                              value={line.itemDescription || ''}
                              onChange={e => {
                                const nextDesc = e.target.value;
                                setRowOverrides(prev => ({
                                  ...prev,
                                  [lKey]: {
                                    ...prev[lKey],
                                    itemDescription: nextDesc
                                  }
                                }));
                              }}
                              className="w-full px-1.5 py-0.5 rounded border border-transparent hover:border-slate-200 focus:border-indigo-400 bg-transparent focus:bg-white text-xs text-slate-800 focus:outline-none"
                              placeholder="ชื่อรายการสินค้า"
                            />
                          </td>
                          <td className="py-1 px-2 text-right font-mono text-slate-700">
                            <input
                              type="number"
                              step="0.001"
                              value={line.qty || ''}
                              onChange={e => {
                                const nextQty = Number(e.target.value) || 0;
                                setRowOverrides(prev => ({
                                  ...prev,
                                  [lKey]: {
                                    ...prev[lKey],
                                    qty: nextQty,
                                    unitPrice: line.unitPrice,
                                    materialAmount: Number((nextQty * line.unitPrice).toFixed(2)),
                                    freightAmount:
                                      line.freightRate > 0
                                        ? Number((nextQty * line.freightRate).toFixed(2))
                                        : (prev[lKey]?.freightAmount ?? line.freightAmount)
                                  }
                                }));
                              }}
                              className="w-16 px-1 py-0.5 rounded border border-transparent hover:border-slate-200 focus:border-indigo-400 bg-transparent focus:bg-white text-right font-mono text-xs text-slate-800 focus:outline-none"
                            />
                          </td>
                          <td className="py-1 px-2 text-right text-slate-500">
                            <input
                              type="text"
                              value={line.unit || ''}
                              onChange={e => {
                                const nextUnit = e.target.value;
                                setRowOverrides(prev => ({
                                  ...prev,
                                  [lKey]: {
                                    ...prev[lKey],
                                    unit: nextUnit
                                  }
                                }));
                              }}
                              className="w-12 px-1 py-0.5 rounded border border-transparent hover:border-slate-200 focus:border-indigo-400 bg-transparent focus:bg-white text-right text-xs text-slate-600 focus:outline-none"
                              placeholder="หน่วย"
                            />
                          </td>
                          <td className="py-1 px-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={line.unitPrice || ''}
                              onChange={e => {
                                const nextPrice = Number(e.target.value) || 0;
                                setRowOverrides(prev => ({
                                  ...prev,
                                  [lKey]: {
                                    ...prev[lKey],
                                    qty: line.qty,
                                    unitPrice: nextPrice,
                                    materialAmount: Number((line.qty * nextPrice).toFixed(2))
                                  }
                                }));
                              }}
                              placeholder="0.00"
                              className={`w-20 px-1.5 py-0.5 rounded border text-right font-mono text-xs ${
                                isPriceMissing
                                  ? 'border-amber-400 bg-amber-50 text-amber-950 font-bold'
                                  : 'border-slate-300 bg-white text-slate-900'
                              }`}
                            />
                          </td>
                          <td className="py-1 px-2 text-right font-mono text-slate-800">
                            {line.materialAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-1 px-2 text-right font-mono text-slate-600">
                            {line.freightAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            ฿{line.lineTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Bottom Navigation for Step 3 */}
            <div className="bg-slate-100 rounded-2xl p-3 border border-slate-200/90 flex flex-wrap items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={() => setWizardStep(2)}
                className="px-4 py-2.5 rounded-xl font-semibold text-xs border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-2 cursor-pointer transition shadow-2xs"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ: เลือกใบส่งของ DO</span>
              </button>

              <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                {weightBasis && billingScope && vatMode ? (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>กำหนดเกณฑ์และภาษีครบถ้วน พร้อมตรวจยอดรวม</span>
                  </span>
                ) : (
                  <span className="text-amber-800 font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span>กรุณาเลือกเกณฑ์ 3.1, 3.2, 3.3 ให้ครบ</span>
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!weightBasis) {
                    showToast('กรุณาเลือกเกณฑ์ปริมาณ/น้ำหนักคิดเงินก่อน', 'info');
                    return;
                  }
                  if (!billingScope) {
                    showToast('กรุณาเลือกขอบเขตยอดที่รับวางบิลก่อน', 'info');
                    return;
                  }
                  if (!vatMode) {
                    showToast('กรุณาเลือกการคิดภาษีมูลค่าเพิ่ม (VAT) ก่อน', 'info');
                    return;
                  }
                  setWizardStep(4);
                }}
                disabled={!weightBasis || !billingScope || !vatMode}
                className={`px-6 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 shadow-xs cursor-pointer ${
                  weightBasis && billingScope && vatMode
                    ? 'bg-teal-700 hover:bg-teal-800 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span>ถัดไป: ตรวจสอบยอดรวม Reconciliation & ยืนยันบันทึก</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* =================================================================
            SUB-STEP 4: ตรวจสอบความถูกต้องของยอดรวม (Reconciliation) & ยืนยันบันทึก
        ================================================================= */}
        {wizardStep === 4 && (
          <div className="space-y-4">
            {/* Context Summary Banner */}
            <div className="bg-slate-900 text-white rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black">
                  4
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">ตรวจสอบยอดรวมและบันทึกชุดรับวางบิล:</div>
                  <div className="font-bold text-sm text-white flex items-center gap-2">
                    <span>{selectedSupplier}</span>
                    <span className="text-xs font-normal text-emerald-300">
                      ({selectedOrderIds.length} ใบ DO · {computedLines.length} รายการ)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setWizardStep(3)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer border border-slate-700 transition"
                >
                  ⚙️ แก้ไขเกณฑ์ & ราคา
                </button>
              </div>
            </div>

            {/* Reconciliation Comparison Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Supplier Invoice Target */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-600" />
                    <span>ยอดตามใบวางบิลร้านค้า (Supplier Invoice)</span>
                  </div>
                  {supplierInvoiceNo && (
                    <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      เลขที่: {supplierInvoiceNo}
                    </span>
                  )}
                </div>

                <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200 space-y-2">
                  <div className="text-xs text-amber-900 font-semibold">ยอดเงินตามกระดาษบิล:</div>
                  <div className="text-3xl font-mono font-black text-amber-950">
                    {step1Totals.hasTarget
                      ? `฿${Number(supplierInvoiceTargetAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                      : 'ไม่ได้ระบุยอดเป้าหมาย'}
                  </div>
                  <div className="text-[11px] text-amber-800 flex items-center justify-between pt-1">
                    <span>วันที่รับวางบิล: {billingDate}</span>
                    <span>ครบกำหนด: {dueDate} ({creditDays} วัน)</span>
                  </div>
                </div>
              </div>

              {/* Card 2: System Calculated Amounts */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    <Calculator className="w-4 h-4 text-emerald-600" />
                    <span>ยอดคำนวณจาก DO ของระบบ (System Calculation)</span>
                  </div>
                  <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                    {selectedOrderIds.length} ใบ DO
                  </span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-slate-600 py-1 border-b border-slate-100">
                    <span>ยอดรวมก่อนภาษี (Subtotal):</span>
                    <span className="font-mono font-bold text-slate-900">
                      ฿{step1Totals.subtotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 py-1 border-b border-slate-100">
                    <span>ภาษีมูลค่าเพิ่ม (VAT 7%):</span>
                    <span className="font-mono font-bold text-sky-700">
                      ฿{step1Totals.vatAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 py-1 border-b border-slate-100">
                    <span>ปรับปรุงเศษสตางค์ (Rounding):</span>
                    <span className="font-mono font-bold text-slate-700">
                      {roundingAdjustment >= 0 ? '+' : ''}{roundingAdjustment.toFixed(2)} บาท
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="font-bold text-slate-900 text-sm">ยอดสุทธิชุดรับวางบิล:</span>
                    <span className="text-2xl font-mono font-black text-emerald-700">
                      ฿{step1Totals.netTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Reconciliation Comparison Status Banner */}
            {step1Totals.hasTarget && (
              <div className={`rounded-2xl p-4 border flex flex-wrap items-center justify-between gap-3 text-xs shadow-2xs ${
                step1Totals.diffWithTarget === 0
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}>
                <div className="flex items-center gap-2.5">
                  {step1Totals.diffWithTarget === 0 ? (
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  )}
                  <div>
                    <div className="font-bold text-sm">
                      {step1Totals.diffWithTarget === 0
                        ? '✓ ยอดคำนวณตรงกับใบวางบิลของร้านค้า 100% (ไม่มีผลต่าง)'
                        : `พบผลต่างยอดเงิน: ${step1Totals.diffWithTarget > 0 ? '+' : ''}${step1Totals.diffWithTarget.toFixed(2)} บาท`}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      {step1Totals.diffWithTarget === 0
                        ? 'ข้อมูลตรวจสอบความถูกต้องเรียบร้อย พร้อมบันทึกและส่งต่อฝ่ายบัญชี'
                        : 'สามารถกรอกเศษสตางค์หรือกดปุ่มปรับให้ตรงด้านล่าง เพื่อให้ยอดสุทธิตรงกับใบวางบิลร้านค้าทันที'}
                    </div>
                  </div>
                </div>

                {step1Totals.diffWithTarget !== 0 && (
                  <button
                    type="button"
                    onClick={handleAutoMatchRoundingToTarget}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer shadow-xs transition"
                  >
                    ⚡ ปรับเศษสตางค์ให้ตรงทันที
                  </button>
                )}
              </div>
            )}

            {/* Dedicated Rounding Adjustment Panel - Clearly Visible (Never Hidden!) */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center">
                    <Coins className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      ปรับเศษสตางค์ (Rounding Adjustment)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      ระบุเศษสตางค์เพื่อปรับปรุงยอดสุทธิให้ตรงกับใบวางบิลกระดาษของร้านค้า (ส่งออกไป Express เป็นรายการปรับปรุง)
                    </p>
                  </div>
                </div>

                {step1Totals.hasTarget && step1Totals.diffWithTarget !== 0 && (
                  <button
                    type="button"
                    onClick={handleAutoMatchRoundingToTarget}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <span>⚡ ปรับเศษสตางค์ให้ตรงทันที</span>
                    <span className="font-mono text-[11px] text-amber-300">
                      ({step1Totals.diffWithTarget > 0 ? '+' : ''}{step1Totals.diffWithTarget.toFixed(2)} บ.)
                    </span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <label className="font-semibold text-slate-700">ระบุยอดปรับเศษสตางค์ (บาท):</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      value={roundingAdjustment}
                      onChange={e => setRoundingAdjustment(Number(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-28 px-3 py-1.5 rounded-xl border border-slate-300 font-mono text-sm text-slate-900 bg-white font-bold text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  </div>
                  <span className="text-slate-500">บาท</span>
                </div>

                {/* Quick Rounding Presets / Reset */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRoundingAdjustment(0)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-semibold cursor-pointer"
                  >
                    รีเซ็ต (0.00)
                  </button>
                  {step1Totals.hasTarget && step1Totals.diffWithTarget !== 0 && (
                    <button
                      type="button"
                      onClick={handleAutoMatchRoundingToTarget}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-[11px] font-bold cursor-pointer"
                    >
                      ปรับเท่าผลต่าง ({step1Totals.diffWithTarget > 0 ? '+' : ''}{step1Totals.diffWithTarget.toFixed(2)})
                    </button>
                  )}
                </div>

                <div className="ml-auto text-xs text-slate-500 font-mono">
                  ยอดสุทธิหลังปรับเศษสตางค์:{' '}
                  <strong className="text-emerald-700 text-sm font-bold">
                    ฿{step1Totals.netTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
              </div>
            </div>

            {/* Included Delivery Orders Summary Table */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="font-bold text-xs text-slate-800">
                  สรุปรายการใบส่งของ (DO) ที่จะรวมในชุดรับวางบิลนี้ ({selectedOrderIds.length} ใบ):
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  เกณฑ์: {weightBasis === 'none_qty' ? 'ไม่ชั่ง นน.' : weightBasis === 'origin' ? 'นน.ต้นทาง' : weightBasis === 'dest' ? 'นน.ปลายทาง' : 'MIN'} · {vatMode === 'exclude_7' ? 'แยก VAT' : vatMode === 'include_7' ? 'รวม VAT' : 'ไม่มี VAT'}
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">เลขที่ DO</th>
                      <th className="py-2 px-3">วันที่</th>
                      <th className="py-2 px-3">โครงการ</th>
                      <th className="py-2 px-3">สินค้า</th>
                      <th className="py-2 px-3 text-right">ปริมาณ/นน.</th>
                      <th className="py-2 px-3 text-right">ยอดรวม (บาท)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedOrderIds.map((oId, idx) => {
                      const ord = orders.find(o => o.id === oId);
                      if (!ord) return null;
                      const linesForThisOrder = computedLines.filter(l => l.orderId === oId);
                      const doTotal = linesForThisOrder.reduce((sum, l) => sum + (l.lineTotal || 0), 0);
                      const totalQty = linesForThisOrder.reduce((sum, l) => sum + (l.qty || 0), 0);

                      return (
                        <tr key={oId} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-900">{ord.col6 || ord.col1}</td>
                          <td className="py-2 px-3 text-slate-600">{ord.col7 || '-'}</td>
                          <td className="py-2 px-3 text-slate-700 truncate max-w-[150px]">{ord.col2 || '-'}</td>
                          <td className="py-2 px-3 text-slate-800">
                            {linesForThisOrder.map(l => l.itemDescription).join(', ') || ord.col11 || '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-700">
                            {totalQty.toLocaleString('th-TH', { minimumFractionDigits: 2 })} {linesForThisOrder[0]?.unit || ''}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            ฿{doTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes field */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                หมายเหตุชุดรับวางบิล (ถ้ามี):
              </label>
              <input
                type="text"
                value={billingNotesText}
                onChange={e => setBillingNotesText(e.target.value)}
                placeholder="เช่น ใบวางบิลรอบวันที่ 1-15, วางบิลโดยคุณสมชาย..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 bg-white"
              />
            </div>

            {/* Final Action Bar for Step 4 */}
            <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-md flex flex-wrap items-center justify-between gap-4 text-xs">
              <button
                type="button"
                onClick={() => setWizardStep(3)}
                className="px-4 py-2.5 rounded-xl font-semibold text-xs border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-2 cursor-pointer transition shadow-2xs"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ: แก้ไขราคาหรือเกณฑ์</span>
              </button>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[10px] text-slate-400">ยอดสุทธิที่จะบันทึก:</div>
                  <div className="text-xl font-mono font-black text-emerald-400">
                    ฿{step1Totals.netTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveStep1BillingNote}
                  disabled={selectedOrderIds.length === 0 || !weightBasis || !billingScope || !vatMode}
                  className={`px-7 py-3 rounded-xl font-black text-sm transition flex items-center gap-2.5 shadow-md cursor-pointer ${
                    selectedOrderIds.length > 0 && weightBasis && billingScope && vatMode
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle className="w-5 h-5 text-slate-950" />
                  <span>
                    {editingNoteId ? 'บันทึกการแก้ไขชุดรับวางบิล' : '✅ ยืนยันบันทึกชุดรับวางบิล'} → ไปขั้นตอนที่ 2 (พิมพ์ A4)
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      )}

      {/* =====================================================================
          STEP 2: สร้างชุดเอกสารรับวางบิล (A4/PDF) & ส่งออกไฟล์ Express (.CSV / .TXT)
      ===================================================================== */}
      {activeStepTab === 'step2' && (
        <div className="space-y-4">
          {/* Action & Selector Bar (Hidden when printing) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4 print:hidden">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-bold text-slate-700">เลือกชุดรับวางบิล:</label>
              <select
                value={activePreviewNote?.id || ''}
                onChange={e => setActiveNoteIdForPreview(e.target.value)}
                className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white min-w-[280px]"
              >
                {billingNotes.length === 0 && (
                  <option value="">-- ยังไม่มีชุดรับวางบิล (สร้างที่ Step 1 ก่อน) --</option>
                )}
                {billingNotes.map(bn => (
                  <option key={bn.id} value={bn.id}>
                    {bn.id} · {bn.supplierName} (฿
                    {bn.netTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })})
                    {bn.expressRrNumber ? ` [RR: ${bn.expressRrNumber}]` : ' [รอเลข RR]'}
                  </option>
                ))}
              </select>

              {activePreviewNote && activePreviewNote.status !== 'rr_stamped_billed' && (
                <button
                  type="button"
                  onClick={() => handleLoadNoteIntoStep1(activePreviewNote)}
                  className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>แก้ไขรายการใน Step 1</span>
                </button>
              )}
            </div>

            {activePreviewNote && (
              <div className="flex flex-wrap items-center gap-2">
                {activePreviewNote.attachmentImage && (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewAttachmentModal({
                        image: activePreviewNote.attachmentImage!,
                        title: `เอกสารใบวางบิลแนบ: ${activePreviewNote.id} (${activePreviewNote.supplierName})`
                      })
                    }
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Paperclip className="w-4 h-4" />
                    <span>ดูใบวางบิลแนบ</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleExportExpressFile(activePreviewNote, 'csv', 'clean_import')}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="ส่งออกเฉพาะรายการสินค้าสำหรับนำเข้าโปรแกรม Express โดยตรง (Clean Import ไม่มีบรรทัดสรุป เพื่อป้องกันโปรแกรม Express ปฏิเสธไฟล์)"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export .CSV (Express Clean)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportExpressFile(activePreviewNote, 'txt', 'clean_import')}
                  className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="ส่งออกไฟล์แท็บคั่น (.TXT) สำหรับ Import ซื้อเชื่อใน Express"
                >
                  <Download className="w-4 h-4" />
                  <span>Export .TXT (Express Clean)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportExpressFile(activePreviewNote, 'csv', 'with_summary')}
                  className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="ส่งออกรายงานตรวจทาน (.CSV) พร้อมแถวสรุปยอด Subtotal, VAT และยอดสุทธิท้ายตาราง"
                >
                  <FileText className="w-4 h-4" />
                  <span>Statement สรุป (.CSV)</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>พิมพ์ใบสรุปชุดรับวางบิล (A4 / PDF)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStepTab('step3_4')}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <span>ไปที่ Step 4 (กรอกเลข RR)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {!activePreviewNote ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
              <FileText className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="text-sm font-bold text-slate-800">
                ยังไม่มีชุดเอกสารรับวางบิล
              </div>
              <p className="text-xs text-slate-500">
                กรุณาเลือกใบส่งของ (DO) และกดสร้างชุดรับวางบิลใน Step 1 ก่อนครับ
              </p>
              <button
                type="button"
                onClick={() => setActiveStepTab('step1')}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
              >
                กลับไปที่ Step 1
              </button>
            </div>
          ) : (
            /* A4 Printable Cover Sheet for Express RR Entry */
            <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-xs max-w-5xl mx-auto space-y-5 print:border-0 print:shadow-none print:p-0">
              {/* Company Letterhead */}
              <div className="border-b-2 border-slate-900 pb-4 flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-xl border border-slate-200 bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden">
                    <img
                      src={
                        !logoError
                          ? systemSettings.companyLogoUrl || DEFAULT_COMPANY_LOGO_URL
                          : DEFAULT_COMPANY_LOGO_URL
                      }
                      alt={systemSettings.companyName}
                      className="w-full h-full object-contain"
                      onError={() => setLogoError(true)}
                    />
                  </div>
                  <div className="space-y-0.5">
                    <h1 className="text-lg font-extrabold text-slate-900">
                      {systemSettings.companyName}
                    </h1>
                    <p className="text-xs text-slate-600">{systemSettings.companyAddress}</p>
                    <p className="text-xs text-slate-600 font-mono">
                      เลขประจำตัวผู้เสียภาษี: {systemSettings.companyTaxId} · โทร:{' '}
                      {systemSettings.companyPhone}
                      {systemSettings.companyEmail
                        ? ` · E-Mail: ${systemSettings.companyEmail}`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-extrabold text-slate-900">
                    ใบสรุปชุดรับวางบิลฝ่ายจัดซื้อ (สำหรับคีย์ซื้อเชื่อ Express RR)
                  </div>
                  <div className="text-xs font-mono font-bold text-indigo-700 mt-0.5">
                    เลขที่ชุดรับวางบิล: {activePreviewNote.id}
                  </div>
                  <div className="text-xs font-mono text-slate-600 mt-0.5">
                    เลขที่ RR (Express):{' '}
                    <strong className="text-slate-900">
                      {activePreviewNote.expressRrNumber || '____________________'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Express Accounting Data-Entry Header Box */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 rounded-xl p-4 border border-slate-300 text-xs">
                <div className="space-y-1">
                  <div>
                    <span className="text-slate-500">รหัสผู้จำหน่าย (Express):</span>{' '}
                    <strong className="font-mono text-slate-900">
                      {activePreviewNote.supplierCode || '-'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">ชื่อร้านค้า / ผู้จำหน่าย:</span>{' '}
                    <strong className="text-slate-900">{activePreviewNote.supplierName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">เลขประจำตัวผู้เสียภาษีร้านค้า:</span>{' '}
                    <strong className="font-mono text-slate-800">
                      {activePreviewNote.supplierTaxId || '-'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">เลขที่ใบวางบิล/ใบแจ้งหนี้ Supplier:</span>{' '}
                    <strong className="font-mono text-slate-900">
                      {activePreviewNote.supplierInvoiceNo || '-'}
                    </strong>
                  </div>
                </div>

                <div className="space-y-1">
                  <div>
                    <span className="text-slate-500">วันที่รับวางบิล:</span>{' '}
                    <strong className="font-mono text-slate-900">
                      {activePreviewNote.billingDate}
                    </strong>{' '}
                    · <span className="text-slate-500">เครดิต:</span>{' '}
                    <strong>{activePreviewNote.creditDays} วัน</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">วันครบกำหนดชำระ (Due Date):</span>{' '}
                    <strong className="font-mono text-rose-700">
                      {activePreviewNote.dueDate}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">เกณฑ์ปริมาณ/น้ำหนักที่ใช้คำนวณ:</span>{' '}
                    <strong className="text-slate-900">
                      {activePreviewNote.weightBasis === 'none_qty'
                        ? 'ไม่ชั่งน้ำหนัก — ใช้ปริมาณตามใบส่งของ (ช่อง 22)'
                        : activePreviewNote.weightBasis === 'origin'
                        ? 'น้ำหนักสุทธิต้นทาง (ช่อง 15)'
                        : activePreviewNote.weightBasis === 'dest'
                        ? 'น้ำหนักสุทธิปลายทาง (ช่อง 20)'
                        : 'น้ำหนักที่น้อยกว่า MIN(ช่อง 15, ช่อง 20)'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">ขอบเขตการวางบิล:</span>{' '}
                    <strong className="text-slate-900">
                      {activePreviewNote.billingScope === 'both'
                        ? 'รวมค่าวัสดุ + ค่าขนส่ง (ช่อง 29)'
                        : activePreviewNote.billingScope === 'material_only'
                        ? 'เฉพาะค่าวัสดุ (ช่อง 25)'
                        : 'เฉพาะค่าขนส่ง (ช่อง 28)'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] text-left border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800 border-b border-slate-300">
                      <th className="py-2 px-2 border-r border-slate-300 text-center">#</th>
                      <th className="py-2 px-2 border-r border-slate-300">วันที่</th>
                      <th className="py-2 px-2 border-r border-slate-300">เลขที่ DO (ช่อง 6)</th>
                      <th className="py-2 px-2 border-r border-slate-300">เลขที่ PO</th>
                      <th className="py-2 px-2 border-r border-slate-300">โครงการ (ช่อง 2)</th>
                      <th className="py-2 px-2 border-r border-slate-300">รายการวัสดุ (ช่อง 11)</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right">นน.ต้นทาง</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right">นน.ปลายทาง</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right">ปริมาณ</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right">ราคา/หน่วย</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right">ค่าวัสดุ (25)</th>
                      <th className="py-2 px-2 border-r border-slate-300 text-right">ค่าขนส่ง (28)</th>
                      <th className="py-2 px-2 text-right">รวมสุทธิ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {activePreviewNote.lines.map((line, idx) => {
                      const sameDoLines = activePreviewNote.lines.filter(
                        l => l.orderId === line.orderId
                      );
                      const subOrderIdx = sameDoLines.findIndex(
                        l => (l.lineKey || `${l.orderId}__0`) === (line.lineKey || `${line.orderId}__0`)
                      );
                      const isLastLineOfMultiDO =
                        sameDoLines.length > 1 && subOrderIdx === sameDoLines.length - 1;
                      const doSubTotal = sameDoLines.reduce((acc, l) => acc + l.lineTotal, 0);

                      return (
                        <React.Fragment key={line.lineKey || `${line.orderId}-${idx}`}>
                          <tr>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-center font-mono">
                              {idx + 1}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 font-mono">
                              {line.date}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 font-mono font-bold text-slate-900">
                              {line.doNo}
                              {sameDoLines.length > 1 && (
                                <span className="ml-1 text-[10px] font-normal text-indigo-700">
                                  ({subOrderIdx + 1}/{sameDoLines.length})
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 font-mono">
                              {line.poNo}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300">
                              {line.projectName}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300">
                              {line.itemDescription}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-right font-mono">
                              {line.originNetKg > 0 ? line.originNetKg.toLocaleString() : '-'}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-right font-mono">
                              {line.destNetKg > 0 ? line.destNetKg.toLocaleString() : '-'}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-right font-mono font-semibold">
                              {line.qty.toLocaleString()} {line.unit}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-right font-mono">
                              {line.unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-right font-mono">
                              {line.materialAmount.toLocaleString('th-TH', {
                                minimumFractionDigits: 2
                              })}
                            </td>
                            <td className="py-1.5 px-2 border-r border-slate-300 text-right font-mono">
                              {line.freightAmount.toLocaleString('th-TH', {
                                minimumFractionDigits: 2
                              })}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">
                              {line.lineTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                          {isLastLineOfMultiDO && (
                            <tr className="bg-indigo-50/60 text-[10px] font-mono text-indigo-950">
                              <td
                                colSpan={10}
                                className="py-1 px-2 border-r border-slate-300 text-right font-sans font-bold"
                              >
                                รวมเฉพาะใบ DO เลขที่ {line.doNo} ({sameDoLines.length} รายการย่อย):
                              </td>
                              <td colSpan={3} className="py-1 px-2 text-right font-bold">
                                ฿{doSubTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-900 font-mono text-xs">
                    <tr>
                      <td colSpan={10} className="py-2 px-3 text-right font-sans font-bold text-slate-700">
                        รวมยอดก่อนภาษี (Subtotal):
                      </td>
                      <td colSpan={3} className="py-2 px-3 text-right font-bold text-slate-900">
                        ฿
                        {activePreviewNote.subtotalAmount.toLocaleString('th-TH', {
                          minimumFractionDigits: 2
                        })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={10} className="py-1.5 px-3 text-right font-sans font-bold text-slate-700">
                        ภาษีมูลค่าเพิ่ม (VAT 7%):
                      </td>
                      <td colSpan={3} className="py-1.5 px-3 text-right font-bold text-slate-900">
                        ฿
                        {activePreviewNote.vatAmount.toLocaleString('th-TH', {
                          minimumFractionDigits: 2
                        })}
                      </td>
                    </tr>
                    {activePreviewNote.roundingAdjustment !== 0 && (
                      <tr>
                        <td colSpan={10} className="py-1.5 px-3 text-right font-sans font-bold text-slate-700">
                          ปรับเศษสตางค์ / ส่วนลดท้ายบิล:
                        </td>
                        <td colSpan={3} className="py-1.5 px-3 text-right font-bold text-slate-900">
                          {activePreviewNote.roundingAdjustment > 0 ? '+' : ''}
                          {activePreviewNote.roundingAdjustment.toLocaleString('th-TH', {
                            minimumFractionDigits: 2
                          })}
                        </td>
                      </tr>
                    )}
                    <tr className="bg-slate-900 text-white">
                      <td colSpan={10} className="py-2.5 px-3 text-right font-sans font-bold">
                        ยอดรวมสุทธิตั้งหนี้ในโปรแกรม Express (รวม {new Set(activePreviewNote.orderIds).size} ใบส่งของ DO · {activePreviewNote.lines.length} รายการสินค้า):
                      </td>
                      <td colSpan={3} className="py-2.5 px-3 text-right text-sm font-extrabold">
                        ฿
                        {activePreviewNote.netTotalAmount.toLocaleString('th-TH', {
                          minimumFractionDigits: 2
                        })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* 3-Party Signature Section */}
              <div className="grid grid-cols-3 gap-6 pt-6 text-center text-xs text-slate-700">
                <div className="border border-slate-300 rounded-xl p-4 space-y-6">
                  <div className="font-bold text-slate-900">
                    ผู้รับวางบิล / ฝ่ายจัดซื้อ
                  </div>
                  <div className="border-b border-dotted border-slate-400 mx-6" />
                  <div className="text-[11px] text-slate-500">
                    ({activePreviewNote.createdBy}) · วันที่ ____/____/____
                  </div>
                </div>
                <div className="border border-slate-300 rounded-xl p-4 space-y-6">
                  <div className="font-bold text-slate-900">
                    ผู้ตรวจสอบ / บัญชี (ผู้คีย์ Express RR)
                  </div>
                  <div className="border-b border-dotted border-slate-400 mx-6" />
                  <div className="text-[11px] text-slate-500">
                    เลขที่ RR: {activePreviewNote.expressRrNumber || '______________'} · วันที่ ____/____/____
                  </div>
                </div>
                <div className="border border-slate-300 rounded-xl p-4 space-y-6">
                  <div className="font-bold text-slate-900">
                    ผู้อนุมัติตั้งหนี้ / ผู้บริหาร
                  </div>
                  <div className="border-b border-dotted border-slate-400 mx-6" />
                  <div className="text-[11px] text-slate-500">
                    ({systemSettings.reportSignatoryApprovedBy}) · วันที่ ____/____/____
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          STEP 3 & STEP 4: นำเข้า Express & บันทึกเลขที่ RR กลับเพื่อ Auto-Stamp ช่อง 5
      ===================================================================== */}
      {activeStepTab === 'step3_4' && (
        <div className="space-y-4 print:hidden">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              เมื่อนำใบสรุปหรือไฟล์ <code className="font-mono">.CSV/.TXT</code> ไปออก <strong>เลขที่ใบรับสินค้า/ซื้อเชื่อ (RR)</strong> ในโปรแกรม Express แล้ว ให้นำเลขที่ RR มากรอกด้านล่างเพื่อประทับลง <strong>ช่อง 5 (เลขที่ RR)</strong> ของใบ DO ทุกใบและล็อกสถานะ <code className="font-mono font-bold">BILLED</code> อัตโนมัติ
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setNoteStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  noteStatusFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                ทั้งหมด ({billingNotes.length})
              </button>
              <button
                type="button"
                onClick={() => setNoteStatusFilter('pending_rr')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  noteStatusFilter === 'pending_rr'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                รอเลข RR ({pendingRRNotesCount})
              </button>
              <button
                type="button"
                onClick={() => setNoteStatusFilter('rr_stamped_billed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  noteStatusFilter === 'rr_stamped_billed'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                ประทับเลข RR แล้ว ({completedRRNotesCount})
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-900 text-slate-100">
                  <tr>
                    <th className="py-3 px-3">เลขชุดวางบิล</th>
                    <th className="py-3 px-3">ร้านค้า / เลข Invoice</th>
                    <th className="py-3 px-3">วันที่วางบิล / ครบกำหนด</th>
                    <th className="py-3 px-3 text-center">จำนวน DO</th>
                    <th className="py-3 px-3 text-right">ยอดสุทธิตั้งหนี้</th>
                    <th className="py-3 px-3">สถานะ</th>
                    <th className="py-3 px-3">Step 4: กรอกเลข RR จาก Express (Auto-Stamp ช่อง 5)</th>
                    <th className="py-3 px-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredNotesForStep34.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        ยังไม่มีรายการชุดรับวางบิลในหมวดนี้
                      </td>
                    </tr>
                  ) : (
                    filteredNotesForStep34.map(bn => {
                      const isStamped = bn.status === 'rr_stamped_billed';
                      const rrInputVal =
                        rrInputByNoteId[bn.id] !== undefined
                          ? rrInputByNoteId[bn.id]
                          : bn.expressRrNumber || '';

                      return (
                        <tr
                          key={bn.id}
                          className={isStamped ? 'bg-emerald-50/30' : 'hover:bg-slate-50'}
                        >
                          <td className="py-3 px-3">
                            <div className="font-mono font-bold text-slate-900">{bn.id}</div>
                            <div className="text-[11px] text-slate-500">
                              เกณฑ์:{' '}
                              {bn.weightBasis === 'none_qty'
                                ? 'ไม่ชั่ง นน. (ช่อง 22)'
                                : bn.weightBasis === 'origin'
                                ? 'ต้นทาง (15)'
                                : bn.weightBasis === 'dest'
                                ? 'ปลายทาง (20)'
                                : 'MIN(15,20)'}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900">{bn.supplierName}</div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              Invoice: {bn.supplierInvoiceNo} · รหัส: {bn.supplierCode || '-'}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono">
                            <div className="text-slate-800">{bn.billingDate}</div>
                            <div className="text-[11px] text-rose-600">ครบกำหนด: {bn.dueDate}</div>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-bold text-slate-900">
                            <div>{new Set(bn.orderIds).size} ใบ DO</div>
                            {bn.lines.length > new Set(bn.orderIds).size && (
                              <div className="text-[10px] text-indigo-700 font-normal">
                                ({bn.lines.length} รายการย่อย)
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                            ฿{bn.netTotalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-3">
                            {isStamped ? (
                              <div className="text-emerald-700 font-bold">
                                BILLED · ประทับเลข RR แล้ว
                                <div className="text-[10px] font-mono text-slate-500 font-normal">
                                  RR: {bn.expressRrNumber}
                                </div>
                              </div>
                            ) : bn.status === 'exported_express' ? (
                              <span className="text-blue-700 font-semibold">
                                ส่งออก Express แล้ว · รอเลข RR
                              </span>
                            ) : (
                              <span className="text-amber-700 font-semibold">
                                รอส่งออก / รอเลข RR
                              </span>
                            )}
                          </td>

                          {/* Step 4 RR Auto-Stamp Box */}
                          <td className="py-3 px-3 min-w-[270px]">
                            {!isStamped ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={rrInputVal}
                                  onChange={e =>
                                    setRrInputByNoteId(prev => ({
                                      ...prev,
                                      [bn.id]: e.target.value
                                    }))
                                  }
                                  placeholder="กรอกเลข RR เช่น RR6903-0015"
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 bg-white w-44 focus:outline-none focus:border-emerald-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const cleanRR = rrInputVal.trim();
                                    if (!cleanRR) {
                                      showToast('กรุณากรอกเลขที่ RR จากโปรแกรม Express ก่อนกดบันทึก', 'info');
                                      return;
                                    }
                                    onStampExpressRR(bn.id, cleanRR);
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Auto-Stamp ช่อง 5</span>
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-emerald-900 bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-300">
                                  col5 = {bn.expressRrNumber}
                                </span>
                                {canManageBilling && (
                                  <>
                                    {confirmUnbillId === bn.id ? (
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onUnbillBillingNote(bn.id);
                                            setConfirmUnbillId(null);
                                          }}
                                          className="px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                                        >
                                          ยืนยันปลดล็อก
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmUnbillId(null)}
                                          className="px-2 py-1 rounded bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                                        >
                                          ยกเลิก
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmUnbillId(bn.id)}
                                        className="px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
                                        title="ปลดล็อกสถานะ BILLED เพื่อแก้ไขเลข RR หรือแก้ไขรายการ"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                        <span>ปลดล็อก/แก้ RR</span>
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </td>

                           {/* Actions */}
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {bn.attachmentImage && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewAttachmentModal({
                                      image: bn.attachmentImage!,
                                      title: `เอกสารใบวางบิลแนบ: ${bn.id} (${bn.supplierName})`
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-900 flex items-center gap-1 cursor-pointer"
                                  title="เปิดดูรูป/เอกสารใบวางบิลของร้านค้าที่แนบไว้"
                                >
                                  <Paperclip className="w-3.5 h-3.5" />
                                  <span>ใบวางบิลแนบ</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveNoteIdForPreview(bn.id);
                                  setActiveStepTab('step2');
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-800 flex items-center gap-1 cursor-pointer"
                                title="เปิดใบสรุป A4 และส่งออกไฟล์ Express"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>ใบสรุป/CSV</span>
                              </button>

                              {!isStamped && (
                                <button
                                  type="button"
                                  onClick={() => handleLoadNoteIntoStep1(bn)}
                                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                                  title="แก้ไขรายการ DO ในชุดวางบิลนี้"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {canManageBilling && (
                                <>
                                  {confirmDeleteNoteId === bn.id ? (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onDeleteBillingNote(bn.id);
                                          setConfirmDeleteNoteId(null);
                                        }}
                                        className="px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                                      >
                                        ยืนยันลบ
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteNoteId(null)}
                                        className="px-2 py-1 rounded bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                                      >
                                        ยกเลิก
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteNoteId(bn.id)}
                                      className="p-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 cursor-pointer"
                                      title="ลบชุดรับวางบิลนี้ (และคืนสถานะ DO ให้กลับมาวางบิลใหม่ได้)"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
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
      )}

      {/* Fullscreen Modal to View Attached Supplier Billing Note / Invoice */}
      {previewAttachmentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Paperclip className="w-4 h-4 text-amber-400" />
                <span>{previewAttachmentModal.title}</span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachmentModal(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-slate-950">
              {previewAttachmentModal.image.startsWith('data:application/pdf') ? (
                <iframe
                  src={previewAttachmentModal.image}
                  title={previewAttachmentModal.title}
                  className="w-full h-full border-0"
                />
              ) : (
                <ImageDocViewer
                  image={previewAttachmentModal.image}
                  title={previewAttachmentModal.title}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
