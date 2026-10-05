import React, { useState, useMemo } from 'react';
import { 
  Search, 
  RotateCcw, 
  FileImage, 
  Copy, 
  Trash2, 
  CheckCircle, 
  Layers, 
  Eye, 
  CheckSquare, 
  Upload, 
  Sparkles,
  SlidersHorizontal,
  Scale,
  Link2,
  X,
  AlertCircle,
  Flag
} from 'lucide-react';
import { OrderRecord, PurchaseOrder, StoreMerchant } from '../types';
import { isDocNumberMatch, extractDocReferences } from '../utils/poReconciliation';
import { hasUnverifiedAutoActions, getOrderAutoFlagSummary } from '../utils/systemConfig';

interface TableView39ColsProps {
  viewMode?: 'orders' | 'dest_wb' | 'tax_inv';
  onSwitchTab?: (tab: 'orders' | 'dest_wb' | 'tax_inv' | 'billing') => void;
  orders: OrderRecord[];
  pos?: PurchaseOrder[];
  stores: StoreMerchant[];
  onInspectOrder: (order: OrderRecord) => void;
  onDuplicateOrder: (order: OrderRecord) => void;
  onDeleteOrder: (id: string, skipConfirm?: boolean) => void;
  onUpdateOrder: (order: OrderRecord) => void;
  onLinkOrderToPO?: (orderId: string, poNumber: string) => void;
  onUnlinkOrderFromPO?: (orderId: string) => void;
  onVerifyAutoFlags?: (orderId: string, scope?: 'all' | 'po' | 'dest') => void;
  onOpenStoreModal?: (storeName: string) => void;
  onOpenScan?: () => void;
  externalFilter?: string | null;
}

type ViewPreset = 'all' | 'weighbridge' | 'delivery_order' | 'concrete' | 'tax_invoice' | 'custom';

export const TableView39Cols: React.FC<TableView39ColsProps> = ({
  viewMode = 'orders',
  onSwitchTab,
  orders,
  pos = [],
  stores,
  onInspectOrder,
  onDuplicateOrder,
  onDeleteOrder,
  onUpdateOrder,
  onLinkOrderToPO,
  onUnlinkOrderFromPO,
  onVerifyAutoFlags,
  onOpenStoreModal,
  onOpenScan,
  externalFilter
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedDocTypeFilter, setSelectedDocTypeFilter] = useState('');
  const [isCompact, setIsCompact] = useState(false);
  const [showZoneToggles, setShowZoneToggles] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<ViewPreset>('all');
  const [confirmBatchAction, setConfirmBatchAction] = useState<'paid' | 'delete' | null>(null);
  
  // Sync external filter when prop changes (from KPI stat card clicks or Projects menu filter)
  React.useEffect(() => {
    if (externalFilter === undefined || externalFilter === null) return;
    const knownStatuses = ['unpaid', 'paid', 'diff_alert', 'duplicates', 'auto_flagged'];
    if (externalFilter === '' || externalFilter === 'all') {
      setSelectedStatus('');
      setSelectedProject('');
      setCurrentPreset('all');
      setSelectedDocTypeFilter('');
      setVisibleZones({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true });
    } else if (externalFilter === 'weighbridge') {
      setSelectedStatus('');
      setCurrentPreset('weighbridge');
      setSelectedDocTypeFilter('weighbridge');
      setVisibleZones({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 7: true });
    } else if (externalFilter === 'delivery_order') {
      setSelectedStatus('');
      setCurrentPreset('delivery_order');
      setSelectedDocTypeFilter('delivery_order');
      setVisibleZones({ 1: true, 2: true, 3: false, 4: false, 5: true, 6: false, 7: true });
    } else if (knownStatuses.includes(externalFilter)) {
      setSelectedStatus(externalFilter);
    } else {
      // Project name passed from ProjectsManagementView
      setSelectedProject(externalFilter);
      setSelectedStatus('');
    }
  }, [externalFilter]);
  
  // Zone visibility toggles
  const [visibleZones, setVisibleZones] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true
  });

  // Selected row IDs for batch actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Manual match modal state for destination weighbridge tickets, POs & tax invoices
  const [matchingDestTicket, setMatchingDestTicket] = useState<OrderRecord | null>(null);
  const [matchingDOForPO, setMatchingDOForPO] = useState<OrderRecord | null>(null);
  const [matchingDOForDest, setMatchingDOForDest] = useState<OrderRecord | null>(null);
  const [matchingTaxInvoice, setMatchingTaxInvoice] = useState<OrderRecord | null>(null);
  const [selectedDOIdsForTaxMatch, setSelectedDOIdsForTaxMatch] = useState<string[]>([]);
  const [holdingSearchTerm, setHoldingSearchTerm] = useState('');
  const [holdingMatchFilter, setHoldingMatchFilter] = useState<'all' | 'unmatched' | 'matched' | 'auto_flagged'>('all');

  // Hover preview state for inspecting bill images & verifying document matching directly from doc numbers
  const [hoveredDocPreview, setHoveredDocPreview] = useState<{
    rowId: string;
    trNo: string;
    zoneBadge: string;
    docTypeLabel: string;
    docNo: string;
    imageUrl?: string | null;
    matchStatus?: 'auto_flagged' | 'verified' | 'manual';
    referenceNote?: string;
    details: { label: string; value: string; highlight?: boolean; alert?: boolean }[];
    compareDetails?: { label: string; originVal: string; destVal: string; isMatch?: boolean }[];
    rect: { top: number; left: number; bottom: number; right: number };
  } | null>(null);

  const openDocHoverPreview = (
    e: React.MouseEvent<HTMLElement>,
    payload: Omit<NonNullable<typeof hoveredDocPreview>, 'rect'>
  ) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHoveredDocPreview({
      ...payload,
      rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
    });
  };

  const closeDocHoverPreview = () => {
    setHoveredDocPreview(null);
  };

  const allDestTickets = useMemo(() => {
    return orders.filter(o => o.docType === 'dest_weighbridge');
  }, [orders]);

  const unmatchedDestTickets = useMemo(() => {
    return allDestTickets.filter(o => !o.linkedViaDocNo);
  }, [allDestTickets]);

  const allTaxInvoices = useMemo(() => {
    return orders.filter(o => o.docType === 'tax_invoice');
  }, [orders]);

  const unmatchedTaxInvoices = useMemo(() => {
    return allTaxInvoices.filter(o => !o.linkedViaDocNo);
  }, [allTaxInvoices]);

  const candidateDOsForDestMatch = useMemo(() => {
    if (!matchingDestTicket) return [];
    const destPlate = (matchingDestTicket.col10 || '').replace(/[^0-9ก-ฮa-zA-Z]/g, '');
    const destRef = (matchingDestTicket.referenceDocNo || '').trim();
    
    // Sort candidates: candidate with matching referenceDocNo or same plate first, then other orders without dest weights
    return orders
      .filter(o => o.docType !== 'dest_weighbridge' && o.docType !== 'tax_invoice' && Number(o.col18) === 0)
      .sort((a, b) => {
        const aRefMatch = Boolean(destRef && (isDocNumberMatch(destRef, a.col6) || isDocNumberMatch(destRef, a.col1)));
        const bRefMatch = Boolean(destRef && (isDocNumberMatch(destRef, b.col6) || isDocNumberMatch(destRef, b.col1)));
        if (aRefMatch && !bRefMatch) return -1;
        if (!aRefMatch && bRefMatch) return 1;

        const aPlate = (a.col10 || '').replace(/[^0-9ก-ฮa-zA-Z]/g, '');
        const bPlate = (b.col10 || '').replace(/[^0-9ก-ฮa-zA-Z]/g, '');
        const aMatch = destPlate && aPlate && (aPlate === destPlate || aPlate.includes(destPlate));
        const bMatch = destPlate && bPlate && (bPlate === destPlate || bPlate.includes(destPlate));
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
  }, [orders, matchingDestTicket]);

  const candidateDOsForTaxMatch = useMemo(() => {
    if (!matchingTaxInvoice) return [];
    const targetVendor = (matchingTaxInvoice.col8 || '').trim().toLowerCase();
    const targetRef = (matchingTaxInvoice.referenceDocNo || matchingTaxInvoice.col4 || '').trim();
    const targetRefLower = targetRef.toLowerCase();

    return orders
      .filter(o => o.docType !== 'dest_weighbridge' && o.docType !== 'tax_invoice')
      .sort((a, b) => {
        const aVendor = (a.col8 || '').trim().toLowerCase();
        const bVendor = (b.col8 || '').trim().toLowerCase();
        const aRefMatch = Boolean(
          targetRef && (
            isDocNumberMatch(targetRef, a.col6) ||
            isDocNumberMatch(targetRef, a.col4) ||
            (a.col6 || '').toLowerCase().includes(targetRefLower) ||
            (a.col4 || '').toLowerCase().includes(targetRefLower)
          )
        );
        const bRefMatch = Boolean(
          targetRef && (
            isDocNumberMatch(targetRef, b.col6) ||
            isDocNumberMatch(targetRef, b.col4) ||
            (b.col6 || '').toLowerCase().includes(targetRefLower) ||
            (b.col4 || '').toLowerCase().includes(targetRefLower)
          )
        );
        if (aRefMatch && !bRefMatch) return -1;
        if (!aRefMatch && bRefMatch) return 1;

        const aVendorMatch = targetVendor && aVendor && (aVendor.includes(targetVendor) || targetVendor.includes(aVendor));
        const bVendorMatch = targetVendor && bVendor && (bVendor.includes(targetVendor) || targetVendor.includes(bVendor));
        if (aVendorMatch && !bVendorMatch) return -1;
        if (!aVendorMatch && bVendorMatch) return 1;
        return 0;
      });
  }, [orders, matchingTaxInvoice]);

  const handleExecuteManualMatchDest = (targetDO: OrderRecord) => {
    if (!matchingDestTicket) return;
    const snap = matchingDestTicket.rawAiSnapshot;
    let grossD = Number(matchingDestTicket.col18) || Number(matchingDestTicket.col13) || Number(snap?.rawGrossWeightKg) || 0;
    let tareD = Number(matchingDestTicket.col19) || Number(matchingDestTicket.col14) || Number(snap?.rawTareWeightKg) || 0;
    if (grossD > 0 && tareD > 0 && grossD < tareD) {
      const tmp = grossD;
      grossD = tareD;
      tareD = tmp;
    }
    const netD =
      Number(matchingDestTicket.col20) ||
      (grossD > 0 ? Math.max(0, grossD - tareD) : 0) ||
      Number(matchingDestTicket.col15) ||
      Number(snap?.rawNetWeightKg) ||
      Number(matchingDestTicket.col22) ||
      0;
    const netO = Number(targetDO.col15) || 0;
    const diff = (netO > 0 && netD > 0) ? (netO - netD) : 0;

    const mergedDO: OrderRecord = {
      ...targetDO,
      col16: matchingDestTicket.col16 || matchingDestTicket.col7 || new Date().toISOString().split('T')[0],
      col17: matchingDestTicket.col17 || matchingDestTicket.col6 || matchingDestTicket.col1 || '',
      col18: grossD,
      col19: tareD,
      col20: netD,
      col21: diff,
      destMatchStatus: 'verified',
      matchedDestTicketId: matchingDestTicket.id,
      col38: targetDO.col38 
        ? `${targetDO.col38} | ชนตั๋วปลายทางด้วยมือ: ${matchingDestTicket.col17 || matchingDestTicket.col6 || ''}` 
        : `ชนตั๋วปลายทางด้วยมือ: ${matchingDestTicket.col17 || matchingDestTicket.col6 || ''}`
    };

    onUpdateOrder(mergedDO);
    onUpdateOrder({
      ...matchingDestTicket,
      col16: mergedDO.col16,
      col17: mergedDO.col17,
      col18: grossD,
      col19: tareD,
      col20: netD,
      linkedViaDocNo: targetDO.col6 || targetDO.col1,
      destMatchStatus: 'verified',
      autoFlagsVerified: true
    });
    setMatchingDestTicket(null);
  };

  // Reverse Manual Match: User clicks "ชนตั๋วปลายทาง" from a DO row in Zone 4 and picks an unlinked Dest Ticket
  const handleExecuteManualMatchDOToDest = (destTicket: OrderRecord) => {
    if (!matchingDOForDest) return;
    const snap = destTicket.rawAiSnapshot;
    let grossD = Number(destTicket.col18) || Number(destTicket.col13) || Number(snap?.rawGrossWeightKg) || 0;
    let tareD = Number(destTicket.col19) || Number(destTicket.col14) || Number(snap?.rawTareWeightKg) || 0;
    if (grossD > 0 && tareD > 0 && grossD < tareD) {
      const tmp = grossD;
      grossD = tareD;
      tareD = tmp;
    }
    const netD =
      Number(destTicket.col20) ||
      (grossD > 0 ? Math.max(0, grossD - tareD) : 0) ||
      Number(destTicket.col15) ||
      Number(snap?.rawNetWeightKg) ||
      Number(destTicket.col22) ||
      0;
    const netO = Number(matchingDOForDest.col15) || 0;
    const diff = (netO > 0 && netD > 0) ? (netO - netD) : 0;

    const mergedDO: OrderRecord = {
      ...matchingDOForDest,
      col16: destTicket.col16 || destTicket.col7 || new Date().toISOString().split('T')[0],
      col17: destTicket.col17 || destTicket.col6 || destTicket.col1,
      col18: grossD,
      col19: tareD,
      col20: netD,
      col21: diff,
      destMatchStatus: 'verified',
      matchedDestTicketId: destTicket.id,
      col38: matchingDOForDest.col38
        ? `${matchingDOForDest.col38} | ชนตั๋วปลายทางด้วยมือ: ${destTicket.col17 || destTicket.col6 || ''}`
        : `ชนตั๋วปลายทางด้วยมือ: ${destTicket.col17 || destTicket.col6 || ''}`
    };

    onUpdateOrder(mergedDO);
    onUpdateOrder({
      ...destTicket,
      col16: mergedDO.col16,
      col17: mergedDO.col17,
      col18: grossD,
      col19: tareD,
      col20: netD,
      linkedViaDocNo: matchingDOForDest.col6 || matchingDOForDest.col1,
      destMatchStatus: 'verified',
      autoFlagsVerified: true
    });
    setMatchingDOForDest(null);
  };

  const handleUnlinkDestTicket = (ticket: OrderRecord) => {
    // Also clear Zone 4 on any DO that had this ticket linked
    const linkedDO = orders.find(
      o =>
        o.docType !== 'dest_weighbridge' &&
        o.docType !== 'tax_invoice' &&
        (o.matchedDestTicketId === ticket.id ||
          (ticket.linkedViaDocNo && (isDocNumberMatch(o.col6, ticket.linkedViaDocNo) || isDocNumberMatch(o.col1, ticket.linkedViaDocNo))) ||
          (ticket.col17 && isDocNumberMatch(o.col17, ticket.col17)))
    );
    if (linkedDO) {
      const filteredFlags = (linkedDO.autoActionFlags || []).filter(f => !f.includes('ตั๋วชั่งปลายทาง'));
      onUpdateOrder({
        ...linkedDO,
        col16: '',
        col17: '',
        col18: 0,
        col19: 0,
        col20: 0,
        col21: 0,
        destMatchStatus: undefined,
        matchedDestTicketId: undefined,
        autoActionFlags: filteredFlags
      });
    }
    onUpdateOrder({
      ...ticket,
      linkedViaDocNo: '',
      destMatchStatus: undefined
    });
  };

  const handleUnlinkDestFromDO = (doRecord: OrderRecord) => {
    const linkedTicket = allDestTickets.find(
      t =>
        t.id === doRecord.matchedDestTicketId ||
        (t.linkedViaDocNo && (isDocNumberMatch(t.linkedViaDocNo, doRecord.col6) || isDocNumberMatch(t.linkedViaDocNo, doRecord.col1))) ||
        (doRecord.col17 && isDocNumberMatch(t.col17, doRecord.col17))
    );
    if (linkedTicket) {
      onUpdateOrder({
        ...linkedTicket,
        linkedViaDocNo: '',
        destMatchStatus: undefined
      });
    }
    const filteredFlags = (doRecord.autoActionFlags || []).filter(f => !f.includes('ตั๋วชั่งปลายทาง'));
    onUpdateOrder({
      ...doRecord,
      col16: '',
      col17: '',
      col18: 0,
      col19: 0,
      col20: 0,
      col21: 0,
      destMatchStatus: undefined,
      matchedDestTicketId: undefined,
      autoActionFlags: filteredFlags
    });
  };

  // Match Tax Invoice into 1 or multiple selected DOs (updating Zone 5 if unpriced & Zone 6 Payment status)
  const handleExecuteManualMatchTaxInvoice = (targetDOIds: string[]) => {
    if (!matchingTaxInvoice || targetDOIds.length === 0) return;
    const invNo = matchingTaxInvoice.col6 || matchingTaxInvoice.col1 || 'ใบกำกับภาษี';
    const invPaid = Number(matchingTaxInvoice.col35) || Number(matchingTaxInvoice.col31) || 0;
    const invUnpaid = Number(matchingTaxInvoice.col36) || 0;
    const isFullyPaid = invUnpaid === 0 && invPaid > 0;
    const paymentMethod = matchingTaxInvoice.col30 || (isFullyPaid ? 'โอนเงิน' : 'เครดิต');
    const matchedDONos: string[] = [];

    if (targetDOIds.length === 1) {
      const targetDO = orders.find(o => o.id === targetDOIds[0]);
      if (targetDO) {
        matchedDONos.push(targetDO.col6 || targetDO.col1);
        const hasDOPrice = Number(targetDO.col29) > 0;
        const finalGrand = hasDOPrice ? Number(targetDO.col29) : (Number(matchingTaxInvoice.col29) || 0);
        const finalGoods = hasDOPrice ? Number(targetDO.col25) : (Number(matchingTaxInvoice.col25) || finalGrand);
        const finalFreight = hasDOPrice ? Number(targetDO.col28) : (Number(matchingTaxInvoice.col28) || 0);
        const finalPaid = invPaid > 0 ? invPaid : (isFullyPaid ? finalGrand : 0);
        const finalUnpaid = Math.max(0, finalGrand - finalPaid);

        const mergedDO: OrderRecord = {
          ...targetDO,
          col24: hasDOPrice ? targetDO.col24 : (Number(matchingTaxInvoice.col24) || targetDO.col24),
          col25: finalGoods,
          col28: finalFreight,
          col29: finalGrand,
          col30: paymentMethod,
          col31: finalPaid,
          col32: finalUnpaid,
          col35: finalPaid,
          col36: finalUnpaid,
          col38: targetDO.col38
            ? `${targetDO.col38} | ชนใบกำกับภาษี: ${invNo}`
            : `ชนใบกำกับภาษี: ${invNo}`
        };
        onUpdateOrder(mergedDO);
      }
    } else {
      // 1-to-N Match: 1 Tax Invoice covering multiple DOs
      targetDOIds.forEach(doId => {
        const targetDO = orders.find(o => o.id === doId);
        if (targetDO) {
          matchedDONos.push(targetDO.col6 || targetDO.col1);
          const doGrand = Number(targetDO.col29) || 0;
          const doGoods = Number(targetDO.col25) || doGrand;
          const doFreight = Number(targetDO.col28) || 0;
          const mergedDO: OrderRecord = {
            ...targetDO,
            col30: paymentMethod,
            col31: isFullyPaid ? doGoods : 0,
            col32: isFullyPaid ? 0 : doGoods,
            col33: isFullyPaid ? doFreight : 0,
            col34: isFullyPaid ? 0 : doFreight,
            col35: isFullyPaid ? doGrand : 0,
            col36: isFullyPaid ? 0 : doGrand,
            col38: targetDO.col38
              ? `${targetDO.col38} | ชนใบกำกับภาษีรวม: ${invNo}`
              : `ชนใบกำกับภาษีรวม: ${invNo}`
          };
          onUpdateOrder(mergedDO);
        }
      });
    }

    onUpdateOrder({
      ...matchingTaxInvoice,
      linkedViaDocNo: matchedDONos.join(', ')
    });
    setMatchingTaxInvoice(null);
    setSelectedDOIdsForTaxMatch([]);
  };

  const handleUnlinkTaxInvoice = (inv: OrderRecord) => {
    onUpdateOrder({
      ...inv,
      linkedViaDocNo: ''
    });
  };

  // Promote a standalone Tax Invoice / Cash Receipt directly into the 39-Column DO table (when no separate DO exists)
  const handlePromoteTaxInvoiceToDirectDO = (taxOrder: OrderRecord) => {
    const promoted: OrderRecord = {
      ...taxOrder,
      docType: 'delivery_order',
      col38: taxOrder.col38
        ? `${taxOrder.col38} | บิลซื้อตรงพร้อมใบเสร็จ/กำกับภาษี`
        : 'บิลซื้อตรงพร้อมใบเสร็จ/กำกับภาษี (ไม่มี DO แยก)'
    };
    onUpdateOrder(promoted);
  };

  // Distinct dropdown options
  const projects = useMemo(() => {
    return Array.from(new Set(orders.map(o => o.col2).filter(Boolean)));
  }, [orders]);

  const categories = useMemo(() => {
    return Array.from(new Set(orders.map(o => o.col3).filter(Boolean)));
  }, [orders]);

  const storeNames = useMemo(() => {
    return Array.from(new Set(orders.map(o => o.col8).filter(Boolean)));
  }, [orders]);

  const autoFlaggedDOCount = useMemo(() => {
    return orders.filter(
      o => o.docType !== 'dest_weighbridge' && o.docType !== 'tax_invoice' && hasUnverifiedAutoActions(o)
    ).length;
  }, [orders]);

  // Helper to check if a DO row involves truck scale weighing (Origin Zone 3 or Destination Zone 4)
  const isWeighedOrderRow = React.useCallback(
    (row: OrderRecord) => {
      if (
        Number(row.col13) > 0 ||
        Number(row.col15) > 0 ||
        Number(row.col18) > 0 ||
        Number(row.col20) > 0 ||
        Boolean(row.col17) ||
        Boolean(row.matchedDestTicketId) ||
        row.docType === 'weighbridge'
      ) {
        return true;
      }
      // Also check if a destination weighbridge ticket in allDestTickets links to this DO
      return allDestTickets.some(
        t =>
          t.id !== row.id &&
          t.linkedViaDocNo &&
          ((row.col6 && isDocNumberMatch(t.linkedViaDocNo, row.col6)) ||
            (row.col1 && isDocNumberMatch(t.linkedViaDocNo, row.col1)))
      );
    },
    [allDestTickets]
  );

  // Counts for the 3 main view modes
  const doModeCounts = useMemo(() => {
    const baseDOs = orders.filter(o => o.docType !== 'dest_weighbridge' && o.docType !== 'tax_invoice');
    const weighed = baseDOs.filter(o => isWeighedOrderRow(o)).length;
    const general = baseDOs.length - weighed;
    return {
      all: baseDOs.length,
      general,
      weighed
    };
  }, [orders, isWeighedOrderRow]);

  // Filtering logic for the Main 39-Column DO / Origin Weighbridge Table
  const filteredOrders = useMemo(() => {
    return orders.filter(row => {
      // Keep the 39-column table strictly for DO records by default
      // (dest_weighbridge and tax_invoice have their own separate menus)
      if (row.docType === 'dest_weighbridge' || row.docType === 'tax_invoice') {
        return false;
      }
      const hasWeighing = isWeighedOrderRow(row);
      if (selectedDocTypeFilter === 'delivery_order' && hasWeighing) return false;
      if (selectedDocTypeFilter === 'weighbridge' && !hasWeighing) return false;
      if (selectedProject && row.col2 !== selectedProject) return false;
      if (selectedStore && row.col8 !== selectedStore) return false;
      if (selectedCategory && row.col3 !== selectedCategory) return false;
      if (selectedStatus === 'paid' && Number(row.col36) > 0) return false;
      if (selectedStatus === 'unpaid' && Number(row.col36) <= 0) return false;
      if (selectedStatus === 'diff_alert' && Number(row.col21) === 0) return false;
      if (selectedStatus === 'auto_flagged' && !hasUnverifiedAutoActions(row)) return false;
      if (selectedStatus === 'weighbridge' && !hasWeighing) return false;

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const searchStr = `${row.col1} ${row.col2} ${row.col3} ${row.col4} ${row.col6} ${row.col8} ${row.col9} ${row.col10} ${row.col11} ${row.col37} ${row.col38}`.toLowerCase();
        if (!searchStr.includes(term)) return false;
      }

      return true;
    });
  }, [orders, selectedDocTypeFilter, selectedProject, selectedStore, selectedCategory, selectedStatus, searchTerm, isWeighedOrderRow]);

  // Handle Preset Switching (Syncs both visible column zones and DO type filter)
  const applyPreset = (preset: ViewPreset, syncDocFilter = true) => {
    setCurrentPreset(preset);
    if (preset === 'all') {
      if (syncDocFilter) setSelectedDocTypeFilter('');
      setVisibleZones({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true });
    } else if (preset === 'delivery_order') {
      // DO สินค้าทั่วไป (ไม่ชั่งน้ำหนัก): ซ่อนโซน 3-4 (น้ำหนักตราชั่ง) และโซน 6 (การเงิน RR) เพื่อให้ตารางกระชับอ่านง่าย
      if (syncDocFilter) setSelectedDocTypeFilter('delivery_order');
      setVisibleZones({ 1: true, 2: true, 3: false, 4: false, 5: true, 6: false, 7: true });
    } else if (preset === 'weighbridge') {
      // DO สินค้าที่มีการชั่งน้ำหนัก: แสดงโซน 1, 2, 3 (ชั่งต้นทาง), 4 (ชั่งปลายทาง & ผลต่าง), 5 (ปริมาณ/ราคา), 7 (สถานที่/หมายเหตุ)
      if (syncDocFilter) setSelectedDocTypeFilter('weighbridge');
      setVisibleZones({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 7: true });
    } else if (preset === 'concrete') {
      if (syncDocFilter) setSelectedDocTypeFilter('delivery_order');
      setVisibleZones({ 1: true, 2: true, 3: false, 4: false, 5: true, 6: false, 7: true });
    } else if (preset === 'tax_invoice') {
      setVisibleZones({ 1: true, 2: true, 3: false, 4: false, 5: true, 6: true, 7: false });
    }
  };

  const toggleZone = (zoneNum: number) => {
    setCurrentPreset('custom');
    setVisibleZones(prev => ({ ...prev, [zoneNum]: !prev[zoneNum] }));
  };

  const handleDocTypeFilterChange = (docType: string) => {
    setSelectedDocTypeFilter(docType);
    if (docType === 'weighbridge') {
      applyPreset('weighbridge', false);
    } else if (docType === 'delivery_order') {
      applyPreset('delivery_order', false);
    } else {
      applyPreset('all', false);
    }
  };

  const resetAllFilters = () => {
    setSearchTerm('');
    setSelectedDocTypeFilter('');
    setSelectedProject('');
    setSelectedStore('');
    setSelectedCategory('');
    setSelectedStatus('');
    applyPreset('all');
    setSelectedIds([]);
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredOrders.length && filteredOrders.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredOrders.map(o => o.id));
    }
  };

  const handleBatchMarkAsPaid = () => {
    if (selectedIds.length === 0) return;
    selectedIds.forEach(id => {
      const row = orders.find(o => o.id === id);
      if (row) {
        const grand = Number(row.col29) || 0;
        const goods = Number(row.col25) || 0;
        const freight = Number(row.col28) || 0;
        onUpdateOrder({
          ...row,
          col31: goods,
          col32: 0,
          col33: freight,
          col34: 0,
          col35: grand,
          col36: 0
        });
      }
    });
    setSelectedIds([]);
    setConfirmBatchAction(null);
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    selectedIds.forEach(id => onDeleteOrder(id, true));
    setSelectedIds([]);
    setConfirmBatchAction(null);
  };

  const fmtNum = (val: any) => {
    if (val === undefined || val === null || val === '') return '-';
    const n = Number(val);
    return isNaN(n) ? '-' : n.toLocaleString('th-TH');
  };

  const fmtCurrency = (val: any) => {
    if (val === undefined || val === null || val === '') return '฿0.00';
    const n = Number(val);
    return isNaN(n) ? '฿0.00' : '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const cellPadding = isCompact ? 'py-1.5 px-2.5' : 'py-2 px-3';

  const filteredDestTickets = useMemo(() => {
    return allDestTickets.filter(t => {
      if (holdingMatchFilter === 'unmatched' && t.linkedViaDocNo) return false;
      if (holdingMatchFilter === 'matched' && !t.linkedViaDocNo) return false;
      if (holdingMatchFilter === 'auto_flagged' && t.destMatchStatus !== 'auto_flagged' && !hasUnverifiedAutoActions(t)) return false;
      if (holdingSearchTerm.trim()) {
        const q = holdingSearchTerm.toLowerCase();
        const s = `${t.col1} ${t.col6} ${t.col17} ${t.col8} ${t.col10} ${t.col11} ${t.linkedViaDocNo || ''} ${t.referenceDocNo || ''}`.toLowerCase();
        if (!s.includes(q)) return false;
      }
      return true;
    });
  }, [allDestTickets, holdingMatchFilter, holdingSearchTerm]);

  const filteredTaxInvoices = useMemo(() => {
    return allTaxInvoices.filter(inv => {
      if (holdingMatchFilter === 'unmatched' && inv.linkedViaDocNo) return false;
      if (holdingMatchFilter === 'matched' && !inv.linkedViaDocNo) return false;
      if (holdingSearchTerm.trim()) {
        const q = holdingSearchTerm.toLowerCase();
        const s = `${inv.col1} ${inv.col6} ${inv.col4} ${inv.col8} ${inv.col11} ${inv.linkedViaDocNo || ''} ${inv.referenceDocNo || ''}`.toLowerCase();
        if (!s.includes(q)) return false;
      }
      return true;
    });
  }, [allTaxInvoices, holdingMatchFilter, holdingSearchTerm]);

  return (
    <div className="space-y-3">
      {/* Dedicated Top-Level Tab View 1: ตั๋วชั่งน้ำหนักรถบรรทุกปลายทาง (dest_wb) */}
      {viewMode === 'dest_wb' && (
        <div className="space-y-3 animate-fadeIn">
          {/* KPI Summary Bar for Destination Weighbridge */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-xs text-slate-500 font-medium">ตั๋วชั่งปลายทางทั้งหมด</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{allDestTickets.length} <span className="text-xs font-normal text-slate-500">ใบ</span></div>
              <div className="text-[11px] text-slate-400 mt-0.5">น้ำหนักสุทธิปลายทางรวม {(allDestTickets.reduce((s, t) => s + (Number(t.col20) || 0), 0) / 1000).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ตัน</div>
            </div>
            <div className="bg-amber-50/50 p-3.5 rounded-xl border border-amber-200 shadow-2xs">
              <div className="text-xs text-amber-800 font-semibold">⚠️ รอชนบิลเข้า DO</div>
              <div className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">{unmatchedDestTickets.length} <span className="text-xs font-normal text-amber-700">ใบ</span></div>
              <div className="text-[11px] text-amber-700/80 mt-0.5">ยังไม่ได้ผูกเข้ากับใบส่งของต้นทาง</div>
            </div>
            <div className="bg-emerald-50/50 p-3.5 rounded-xl border border-emerald-200 shadow-2xs">
              <div className="text-xs text-emerald-800 font-semibold">✅ ชนบิลเข้า [โซน 4] แล้ว</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">{allDestTickets.length - unmatchedDestTickets.length} <span className="text-xs font-normal text-emerald-700">ใบ</span></div>
              <div className="text-[11px] text-emerald-700/80 mt-0.5">โอนน้ำหนักเข้า DO และคำนวณผลต่างแล้ว</div>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={holdingSearchTerm}
                onChange={(e) => setHoldingSearchTerm(e.target.value)}
                placeholder="ค้นหาเลขตั๋วปลายทาง, ทะเบียนรถ, ร้านค้า, สินค้า, เลข DO..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:bg-white outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setHoldingMatchFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  holdingMatchFilter === 'all' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ทั้งหมด ({allDestTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setHoldingMatchFilter('unmatched')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  holdingMatchFilter === 'unmatched' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                ⚠️ รอชนบิล ({unmatchedDestTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setHoldingMatchFilter('matched')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  holdingMatchFilter === 'matched' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                ✅ ชนบิลแล้ว ({allDestTickets.length - unmatchedDestTickets.length})
              </button>
            </div>
          </div>

          {/* Destination Weighbridge Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            {filteredDestTickets.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Scale className="w-8 h-8 text-teal-500 mx-auto" />
                <p className="text-sm font-bold text-slate-700">ไม่พบรายการตั๋วชั่งน้ำหนักปลายทาง</p>
                <p className="text-xs text-slate-500">สามารถกดปุ่ม &quot;สแกนบิลด้วย AI&quot; ด้านบนเพื่อสแกนตั๋วชั่งน้ำหนักขาเข้าหน้างาน</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left sticky-grid-table">
                  <thead className="sticky top-0 z-20 bg-teal-700 text-white font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">เลข TR</th>
                      <th className="py-2.5 px-3">สถานะการชนบิล</th>
                      <th className="py-2.5 px-3">17. เลขที่ตั๋วปลายทาง</th>
                      <th className="py-2.5 px-3">16. วันที่ชั่งปลายทาง</th>
                      <th className="py-2.5 px-3">10. ทะเบียนรถ</th>
                      <th className="py-2.5 px-3">8. ร้านค้า / ต้นทาง</th>
                      <th className="py-2.5 px-3">11. รายการสินค้า</th>
                      <th className="py-2.5 px-3 text-right">18. หนักปลาย (กก.)</th>
                      <th className="py-2.5 px-3 text-right">19. เบาปลาย (กก.)</th>
                      <th className="py-2.5 px-3 text-right bg-teal-800 font-bold">20. สุทธิปลายทาง (กก.)</th>
                      <th className="py-2.5 px-3 text-center">จัดการชนบิล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredDestTickets.map(ticket => {
                      const snap = ticket.rawAiSnapshot;
                      const tGross = Number(ticket.col18) || Number(ticket.col13) || Number(snap?.rawGrossWeightKg) || 0;
                      const tTare = Number(ticket.col19) || Number(ticket.col14) || Number(snap?.rawTareWeightKg) || 0;
                      const tNet =
                        Number(ticket.col20) ||
                        (tGross > 0 ? Math.max(0, tGross - tTare) : 0) ||
                        Number(ticket.col15) ||
                        Number(snap?.rawNetWeightKg) ||
                        Number(ticket.col22) ||
                        0;
                      const tDocNo = ticket.col17 || ticket.col6 || ticket.col1;
                      const handleTicketHover = (e: React.MouseEvent<HTMLElement>) => {
                        openDocHoverPreview(e, {
                          rowId: ticket.id,
                          trNo: ticket.col1,
                          zoneBadge: 'โซน 4 • ตั๋วชั่งน้ำหนักปลายทาง',
                          docTypeLabel: 'ตั๋วชั่งน้ำหนักปลายทาง (Destination Weighbridge)',
                          docNo: tDocNo,
                          imageUrl: ticket.image,
                          matchStatus: ticket.destMatchStatus,
                          referenceNote: ticket.linkedViaDocNo
                            ? `✅ ชนเข้ากับ DO: ${ticket.linkedViaDocNo}`
                            : ticket.referenceDocNo
                            ? `🔗 อ้างถึง DO ในบิล: ${ticket.referenceDocNo}`
                            : '⚠️ รอชนเข้ากับใบส่งของ (DO)',
                          details: [
                            { label: 'เลขที่ตั๋วปลายทาง (ช่อง 17)', value: tDocNo, highlight: true },
                            { label: 'วันที่ชั่งปลายทาง (ช่อง 16)', value: ticket.col16 || ticket.col7 || '-' },
                            { label: 'ทะเบียนรถ (ช่อง 10)', value: ticket.col10 || '-' },
                            { label: 'หนักเข้า / เบาออก', value: `${fmtNum(tGross)} / ${fmtNum(tTare)} กก.` },
                            { label: 'น้ำหนักสุทธิปลายทาง (ช่อง 20)', value: `${fmtNum(tNet)} กก.`, highlight: true }
                          ]
                        });
                      };
                      return (
                      <tr key={ticket.id} className="hover:bg-teal-50/30 transition">
                        <td className="py-2.5 px-3 font-mono font-bold text-teal-900">
                          <button
                            onClick={() => onInspectOrder(ticket)}
                            onMouseEnter={handleTicketHover}
                            onMouseLeave={closeDocHoverPreview}
                            className="hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>{ticket.col1}</span>
                            {ticket.image && <FileImage className="w-3.5 h-3.5 text-teal-600" />}
                          </button>
                        </td>
                         <td className="py-2.5 px-3">
                          {ticket.linkedViaDocNo ? (
                            <div className="flex flex-col items-start gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                ✅ ชนเข้า DO: {ticket.linkedViaDocNo}
                              </span>
                              {ticket.destMatchStatus === 'auto_flagged' ? (
                                <div className="flex items-center gap-1">
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                    🚩 ชนอัตโนมัติ (รอตรวจ)
                                  </span>
                                  {onVerifyAutoFlags && (
                                    <button
                                      type="button"
                                      onClick={() => onVerifyAutoFlags(ticket.id, 'dest')}
                                      className="px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold cursor-pointer transition"
                                    >
                                      ✅ ยืนยัน
                                    </button>
                                  )}
                                </div>
                              ) : ticket.destMatchStatus === 'verified' ? (
                                <span className="text-[9px] text-emerald-700 font-semibold">✓ ตรวจสอบยืนยันแล้ว</span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              ⚠️ รอชนบิลเข้า DO
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          <span
                            onMouseEnter={handleTicketHover}
                            onMouseLeave={closeDocHoverPreview}
                            onClick={() => onInspectOrder(ticket)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-900 cursor-pointer"
                          >
                            <span>{tDocNo}</span>
                            {ticket.image && <FileImage className="w-3 h-3 text-teal-600" />}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{ticket.col16 || ticket.col7 || '-'}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{ticket.col10 || '-'}</td>
                        <td className="py-2.5 px-3 text-slate-800">{ticket.col8 || '-'}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{ticket.col11 || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{fmtNum(tGross)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{fmtNum(tTare)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-900 bg-teal-50/60">{fmtNum(tNet)}</td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setMatchingDestTicket(ticket)}
                              className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-md font-bold text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer transition"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>{ticket.linkedViaDocNo ? 'เปลี่ยน DO' : 'ชนบิลเข้า DO'}</span>
                            </button>
                            {ticket.linkedViaDocNo && (
                              <button
                                type="button"
                                onClick={() => handleUnlinkDestTicket(ticket)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-medium cursor-pointer transition"
                                title="ยกเลิกสถานะการชนบิล"
                              >
                                ยกเลิกชน
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onInspectOrder(ticket)}
                              className="p-1 text-slate-600 hover:bg-slate-100 rounded-md transition cursor-pointer"
                              title="ดูรูป/แก้ไข"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteOrder(ticket.id)}
                              className="p-1 text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                              title="ลบ"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dedicated Top-Level Tab View 2: ใบเสร็จรับเงิน / ใบกำกับภาษี (tax_inv) */}
      {viewMode === 'tax_inv' && (
        <div className="space-y-3 animate-fadeIn">
          {/* KPI Summary Bar for Tax Invoices */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-xs text-slate-500 font-medium">ใบเสร็จ / ใบกำกับภาษีทั้งหมด</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{allTaxInvoices.length} <span className="text-xs font-normal text-slate-500">ใบ</span></div>
              <div className="text-[11px] text-slate-400 mt-0.5">เอกสารการเงินในระบบ</div>
            </div>
            <div className="bg-amber-50/50 p-3.5 rounded-xl border border-amber-200 shadow-2xs">
              <div className="text-xs text-amber-800 font-semibold">⚠️ รอชนบิลเข้า DO</div>
              <div className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">{unmatchedTaxInvoices.length} <span className="text-xs font-normal text-amber-700">ใบ</span></div>
              <div className="text-[11px] text-amber-700/80 mt-0.5">รอผูกเข้ากับใบส่งของ</div>
            </div>
            <div className="bg-emerald-50/50 p-3.5 rounded-xl border border-emerald-200 shadow-2xs">
              <div className="text-xs text-emerald-800 font-semibold">✅ ชนบิลเข้า [โซน 5-6] แล้ว</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">{allTaxInvoices.length - unmatchedTaxInvoices.length} <span className="text-xs font-normal text-emerald-700">ใบ</span></div>
              <div className="text-[11px] text-emerald-700/80 mt-0.5">อัปเดตสถานะการชำระเงินใน DO แล้ว</div>
            </div>
            <div className="bg-blue-50/40 p-3.5 rounded-xl border border-blue-200 shadow-2xs">
              <div className="text-xs text-blue-900 font-semibold">มูลค่ารวมตามใบกำกับภาษี</div>
              <div className="text-xl font-bold text-blue-700 mt-1 tabular-nums">
                {fmtCurrency(allTaxInvoices.reduce((s, i) => s + (Number(i.col29) || 0), 0))}
              </div>
              <div className="text-[11px] text-blue-600/80 mt-0.5">ยอดรวมสุทธิในใบกำกับภาษีทั้งหมด</div>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={holdingSearchTerm}
                onChange={(e) => setHoldingSearchTerm(e.target.value)}
                placeholder="ค้นหาเลขที่ใบกำกับภาษี, ร้านค้า, รายการสินค้า, เลข DO/PO อ้างอิง..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:bg-white outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setHoldingMatchFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  holdingMatchFilter === 'all' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ทั้งหมด ({allTaxInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => setHoldingMatchFilter('unmatched')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  holdingMatchFilter === 'unmatched' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                }`}
              >
                ⚠️ รอชนบิล ({unmatchedTaxInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => setHoldingMatchFilter('matched')}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  holdingMatchFilter === 'matched' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                ✅ ชนบิลแล้ว ({allTaxInvoices.length - unmatchedTaxInvoices.length})
              </button>
            </div>
          </div>

          {/* Tax Invoices Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            {filteredTaxInvoices.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-sm font-bold text-slate-700">ไม่พบรายการใบเสร็จรับเงิน / ใบกำกับภาษี</p>
                <p className="text-xs text-slate-500">สามารถกดปุ่ม &quot;สแกนบิลด้วย AI&quot; ด้านบนเพื่อสแกนใบเสร็จรับเงินหรือใบกำกับภาษี</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left sticky-grid-table">
                  <thead className="sticky top-0 z-20 bg-amber-600 text-white font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">เลข TR</th>
                      <th className="py-2.5 px-3">สถานะการชนบิล</th>
                      <th className="py-2.5 px-3">6. เลขที่ใบกำกับภาษี/ใบเสร็จ</th>
                      <th className="py-2.5 px-3">7. วันที่ออกบิล</th>
                      <th className="py-2.5 px-3">8. ร้านค้าผู้ขาย</th>
                      <th className="py-2.5 px-3">อ้างอิง PO / DO</th>
                      <th className="py-2.5 px-3">11. รายการสินค้า</th>
                      <th className="py-2.5 px-3 text-right">25. มูลค่าสินค้า</th>
                      <th className="py-2.5 px-3 text-right bg-amber-700 font-bold">29. ยอดรวมทั้งสิ้น</th>
                      <th className="py-2.5 px-3">30. รูปแบบจ่าย</th>
                      <th className="py-2.5 px-3 text-right">35. ชำระแล้ว</th>
                      <th className="py-2.5 px-3 text-right">36. ค้างชำระ</th>
                      <th className="py-2.5 px-3 text-center">จัดการชนบิล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredTaxInvoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-amber-50/30 transition">
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-900">
                          <button onClick={() => onInspectOrder(inv)} className="hover:underline flex items-center gap-1 cursor-pointer">
                            <span>{inv.col1}</span>
                            {inv.image && <FileImage className="w-3.5 h-3.5 text-amber-600" />}
                          </button>
                        </td>
                        <td className="py-2.5 px-3">
                          {inv.linkedViaDocNo ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              ✅ ชนเข้า DO: {inv.linkedViaDocNo}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              ⚠️ รอชนบิลเข้า DO
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{inv.col6 || '-'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{inv.col7 || '-'}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{inv.col8 || '-'}</td>
                        <td className="py-2.5 px-3 font-mono text-blue-700">{inv.referenceDocNo || inv.col4 || '-'}</td>
                        <td className="py-2.5 px-3 text-slate-800 max-w-[180px] truncate">{inv.col11 || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{fmtCurrency(inv.col25)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-950 bg-amber-50/60">{fmtCurrency(inv.col29)}</td>
                        <td className="py-2.5 px-3 text-slate-700">{inv.col30 || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-semibold">{fmtCurrency(inv.col35)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-rose-600 font-semibold">{fmtCurrency(inv.col36)}</td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setMatchingTaxInvoice(inv);
                                setSelectedDOIdsForTaxMatch([]);
                              }}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-bold text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer transition"
                              title="ชนบิลเพื่อนำยอดชำระเงิน (โซน 6) ไปใส่ในใบส่งของ (DO)"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>{inv.linkedViaDocNo ? 'ชนเพิ่ม/เปลี่ยน DO' : 'ชนบิลเข้า DO'}</span>
                            </button>
                            {!inv.linkedViaDocNo && (
                              <button
                                type="button"
                                onClick={() => handlePromoteTaxInvoiceToDirectDO(inv)}
                                className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 rounded-md font-semibold text-[11px] cursor-pointer transition"
                                title="สำหรับบิลซื้อสดหน้าร้านที่ไม่มีใบส่งของ (DO) แยก — ส่งเข้าตาราง 39 คอลัมน์โดยตรง"
                              >
                                📥 รับของตรง
                              </button>
                            )}
                            {inv.linkedViaDocNo && (
                              <button
                                type="button"
                                onClick={() => handleUnlinkTaxInvoice(inv)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-medium cursor-pointer transition"
                                title="ยกเลิกสถานะการชนบิล"
                              >
                                ยกเลิกชน
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onInspectOrder(inv)}
                              className="p-1 text-slate-600 hover:bg-slate-100 rounded-md transition cursor-pointer"
                              title="ดูรูป/แก้ไข"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteOrder(inv.id)}
                              className="p-1 text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                              title="ลบ"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main 39-Column DO View (when viewMode === 'orders') */}
      {viewMode === 'orders' && (
        <>
          {/* Compact Notification Bar if there are unmatched Dest Weighbridge or Tax Invoices in their tabs */}
          {(unmatchedDestTickets.length > 0 || unmatchedTaxInvoices.length > 0) && (
            <div className="bg-white px-3.5 py-2.5 rounded-xl border border-teal-200 shadow-2xs flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <Link2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>มีเอกสารรอชนบิลเข้ากับใบส่งของ (DO) ในแถบแยก:</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {unmatchedDestTickets.length > 0 && onSwitchTab && (
                  <button
                    type="button"
                    onClick={() => onSwitchTab('dest_wb')}
                    className="px-3 py-1 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-300 rounded-lg font-bold text-xs cursor-pointer transition flex items-center gap-1.5"
                  >
                    <span>🏁 ไปที่แถบ ตั๋วชั่งปลายทาง ({unmatchedDestTickets.length} ใบรอชน)</span>
                  </button>
                )}
                {unmatchedTaxInvoices.length > 0 && onSwitchTab && (
                  <button
                    type="button"
                    onClick={() => onSwitchTab('tax_inv')}
                    className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg font-bold text-xs cursor-pointer transition flex items-center gap-1.5"
                  >
                    <span>🧾 ไปที่แถบ ใบเสร็จ/กำกับภาษี ({unmatchedTaxInvoices.length} ใบรอชน)</span>
                  </button>
                )}
              </div>
            </div>
          )}

      {/* Control Bar: View Presets, Zone Toggles, Filters & Search */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-3">
        
        {/* Preset Selector Row */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mr-1">
              <Eye className="w-3.5 h-3.5 text-blue-600" />
              <span>มุมมองตามประเภทบิล:</span>
            </span>

            <div className="inline-flex items-center p-0.5 bg-slate-100/90 rounded-lg text-xs gap-0.5 flex-wrap">
              <button
                type="button"
                onClick={() => applyPreset('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentPreset === 'all' 
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="แสดงบิลใบส่งของ (DO) ทั้งหมด และเปิดครบทั้ง 39 คอลัมน์ (โซน 1–7)"
              >
                <span>📋 ทั้งหมด 39 คอลัมน์</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  currentPreset === 'all' ? 'bg-blue-100 text-blue-800 font-bold' : 'bg-slate-200/80 text-slate-600'
                }`}>
                  {doModeCounts.all}
                </span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('delivery_order')}
                className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentPreset === 'delivery_order' 
                    ? 'bg-white text-sky-700 shadow-2xs font-semibold' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="กรองเฉพาะ DO สินค้าทั่วไป/คอนกรีต/เหล็ก/ท่อ ที่ไม่ชั่งน้ำหนักรถบรรทุก พร้อมซ่อนโซนตราชั่ง (โซน 3–4) อัตโนมัติ"
              >
                <span>📦 DO สินค้าทั่วไป</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  currentPreset === 'delivery_order' ? 'bg-sky-100 text-sky-800 font-bold' : 'bg-slate-200/80 text-slate-600'
                }`}>
                  {doModeCounts.general}
                </span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('weighbridge')}
                className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  currentPreset === 'weighbridge' 
                    ? 'bg-white text-emerald-700 shadow-2xs font-semibold' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="กรองเฉพาะ DO สินค้าที่มีการชั่งน้ำหนักรถบรรทุก (หิน/ดิน/ทราย/แอสฟัลต์) พร้อมแสดงโซน 3 (ชั่งต้นทาง) และโซน 4 (ชั่งปลายทาง & ผลต่าง)"
              >
                <span>⚖️ DO สินค้าที่มีการชั่งน้ำหนัก</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  currentPreset === 'weighbridge' ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-slate-200/80 text-slate-600'
                }`}>
                  {doModeCounts.weighed}
                </span>
              </button>
            </div>
            {currentPreset === 'delivery_order' && (
              <span className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md font-medium">
                ซ่อนโซนชั่งน้ำหนัก 3–4 อัตโนมัติ (ตารางกระชับ)
              </span>
            )}
            {currentPreset === 'weighbridge' && (
              <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-medium">
                แสดงโซน 3 (ชั่งต้นทาง) + โซน 4 (ชั่งปลายทาง & ผลต่าง)
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            {/* Quick Auto-Flag Review Pill (Mandatory Human Review for Automated System Actions) */}
            {autoFlaggedDOCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedStatus(selectedStatus === 'auto_flagged' ? '' : 'auto_flagged')}
                className={`text-xs px-2.5 py-1 border rounded-lg flex items-center gap-1.5 transition cursor-pointer font-bold ${
                  selectedStatus === 'auto_flagged'
                    ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                    : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                }`}
                title="คลิกเพื่อกรองดูเฉพาะรายการที่ระบบทำอัตโนมัติ (ชนบิลอัตโนมัติ / สแกน AI / คำนวณหน่วย) เพื่อตรวจสอบและกดยืนยัน"
              >
                <Flag className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                <span>🚩 รอตรวจรายการอัตโนมัติ ({autoFlaggedDOCount})</span>
              </button>
            )}

            {/* Toggle Zone Customization Bar */}
            <button
              type="button"
              onClick={() => setShowZoneToggles(!showZoneToggles)}
              className={`text-xs px-2.5 py-1 border rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                showZoneToggles
                  ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
              }`}
              title="เปิด/ปิดแถบเลือกซ่อน-แสดงโซนคอลัมน์ 1-7"
            >
              <Layers className="w-3 h-3 text-blue-600" />
              <span>เลือกโซนคอลัมน์</span>
            </button>

            {/* Density switcher */}
            <button
              onClick={() => setIsCompact(!isCompact)}
              className="text-slate-600 hover:text-slate-900 text-xs px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition cursor-pointer"
              title="สลับความกะทัดรัดของตาราง"
            >
              <SlidersHorizontal className="w-3 h-3 text-slate-400" />
              <span>{isCompact ? 'มุมมองสบายตา' : 'มุมมองกะทัดรัด'}</span>
            </button>

            {/* Quick reset */}
            <button
              onClick={resetAllFilters}
              className="text-slate-500 hover:text-slate-800 text-xs px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>รีเซ็ต</span>
            </button>
          </div>
        </div>

        {/* Individual Zone Visibility Badges (Collapsible so the toolbar stays uncluttered) */}
        {showZoneToggles && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs pb-1 animate-fadeIn">
          <span className="text-slate-500 font-medium mr-1 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            <span>ปรับเปิด-ปิดโซน:</span>
          </span>

          <button
            type="button"
            onClick={() => toggleZone(1)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer ${
              visibleZones[1] 
                ? 'bg-orange-50 text-orange-800 border border-orange-200' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            1. โครงการ & อ้างอิง (2-6)
          </button>

          <button
            type="button"
            onClick={() => toggleZone(2)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer ${
              visibleZones[2] 
                ? 'bg-sky-50 text-sky-800 border border-sky-200' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            2. วันที่ คู่ค้า สินค้า (7-12)
          </button>

          <button
            type="button"
            onClick={() => toggleZone(3)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
              visibleZones[3] 
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            <span>3. หนักต้นทาง (13-15)</span>
            {!visibleZones[3] && orders.some(o => (o.docType === 'delivery_order' || !o.docType) && (Number(o.col13) > 0 || Number(o.col15) > 0)) && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="มี DO ชั่งน้ำหนักซ่อนอยู่" />
            )}
          </button>

          <button
            type="button"
            onClick={() => toggleZone(4)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer ${
              visibleZones[4] 
                ? 'bg-teal-50 text-teal-800 border border-teal-200' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            4. ปลายทาง & ผลต่าง (16-21)
          </button>

          <button
            type="button"
            onClick={() => toggleZone(5)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer ${
              visibleZones[5] 
                ? 'bg-purple-50 text-purple-800 border border-purple-200' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            5. คิดเงิน & บรรทุก (22-29)
          </button>

          <button
            type="button"
            onClick={() => toggleZone(6)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer ${
              visibleZones[6] 
                ? 'bg-rose-50 text-rose-800 border border-rose-200' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            6. การชำระเงิน (30-36)
          </button>

          <button
            type="button"
            onClick={() => toggleZone(7)}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition cursor-pointer ${
              visibleZones[7] 
                ? 'bg-slate-100 text-slate-800 border border-slate-300' 
                : 'bg-slate-100 text-slate-400 opacity-60'
            }`}
          >
            7. เพิ่มเติม (37-38)
          </button>
        </div>
        )}

        {/* Filter Dropdowns & Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 pt-2 border-t border-slate-100">
          {/* Search box */}
          <div className="relative md:col-span-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาเลข TR, โครงการ, หมวดหมู่, ร้านค้า, ทะเบียน, สินค้า, DO..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none"
            />
          </div>

          {/* Filter by Project */}
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 cursor-pointer"
          >
            <option value="">ทุกโครงการ ({projects.length})</option>
            {projects.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* Filter by Category (Column 3) */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 cursor-pointer"
          >
            <option value="">ทุกหมวดวัสดุ/งาน ({categories.length})</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Filter by Merchant / Store */}
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 cursor-pointer"
          >
            <option value="">ทุกร้านค้า ({storeNames.length})</option>
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Filter by Status */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 cursor-pointer"
          >
            <option value="">ทุกสถานะ / การตรวจสอบ</option>
            {autoFlaggedDOCount > 0 && (
              <option value="auto_flagged">🚩 รอตรวจรายการอัตโนมัติ ({autoFlaggedDOCount})</option>
            )}
            <option value="unpaid">⚠️ มียอดค้างชำระ</option>
            <option value="paid">✅ ชำระครบถ้วนแล้ว</option>
            <option value="diff_alert">⚖️ มีผลต่างน้ำหนัก</option>
          </select>
        </div>

        {/* Batch Actions Toolbar if selected */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs animate-fadeIn">
            <div className="flex items-center gap-2 text-blue-900 font-semibold">
              <CheckSquare className="w-4 h-4 text-blue-600" />
              <span>เลือก {selectedIds.length} รายการ</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {confirmBatchAction === 'paid' ? (
                <div className="flex items-center gap-1.5 bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-md">
                  <span className="font-bold text-emerald-900">ยืนยันปรับชำระครบ {selectedIds.length} รายการ?</span>
                  <button
                    type="button"
                    onClick={handleBatchMarkAsPaid}
                    className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold cursor-pointer"
                  >
                    ยืนยัน
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBatchAction(null)}
                    className="px-2 py-0.5 bg-white text-slate-700 rounded font-medium cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBatchAction('paid')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>ปรับเป็นชำระครบ</span>
                </button>
              )}

              {confirmBatchAction === 'delete' ? (
                <div className="flex items-center gap-1.5 bg-rose-100 border border-rose-300 px-2.5 py-1 rounded-md">
                  <span className="font-bold text-rose-900">ยืนยันลบ {selectedIds.length} รายการ?</span>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer"
                  >
                    ยืนยันลบ
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBatchAction(null)}
                    className="px-2 py-0.5 bg-white text-slate-700 rounded font-medium cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBatchAction('delete')}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ลบรายการที่เลือก</span>
                </button>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Main Table Container: Flawless geometry & Pinned Columns */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-2xs overflow-hidden flex flex-col">
        <div className="overflow-x-auto table-scroll max-h-[calc(100vh-320px)] relative">
          <table className="w-max min-w-full text-xs text-left sticky-grid-table">
            <thead className="sticky top-0 z-30 font-medium select-none bg-slate-100 shadow-xs">
              
              {/* Zone Top Spans Header Row: Row 1 */}
              <tr className="text-center text-[11px] font-bold tracking-wider uppercase">
                {/* Checkbox Pinned Header: spans 2 rows */}
                <th 
                  rowSpan={2} 
                  className="sticky-col-checkbox sticky top-0 left-0 z-50 bg-slate-200 text-slate-800 p-2 text-center select-none"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filteredOrders.length && filteredOrders.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5 align-middle"
                  />
                </th>

                {/* Col 1 (TR Number & Color-Coded Bill Icons) Pinned Header: spans 2 rows */}
                <th 
                  rowSpan={2} 
                  className="sticky-col-tr sticky top-0 left-[44px] z-50 bg-slate-200 text-slate-900 py-2 px-2.5 shadow-[4px_0_10px_-2px_rgba(0,0,0,0.12)] text-left"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-slate-900 text-xs">1. เลข TR & บิลในแถว</span>
                    <div className="flex items-center gap-1 text-[9px] font-semibold normal-case">
                      <span className="px-1 rounded bg-blue-100 text-blue-800 border border-blue-300" title="สีน้ำเงิน = ใบสั่งซื้อ (PO)">PO</span>
                      <span className="px-1 rounded bg-sky-100 text-sky-800 border border-sky-300" title="สีฟ้า = ใบส่งของ DO (โซน 1–3)">DO</span>
                      <span className="px-1 rounded bg-teal-100 text-teal-900 border border-teal-300" title="สีเขียวอมฟ้า = ตั๋วชั่งปลายทาง (โซน 4)">ปลายทาง</span>
                    </div>
                  </div>
                </th>

                {/* Zone 1 Span: Columns 2 - 6 (5 columns) */}
                {visibleZones[1] && (
                  <th colSpan={5} className="bg-orange-600 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 1] โครงการ & เอกสารอ้างอิง (คอลัมน์ 2 - 6)
                  </th>
                )}

                {/* Zone 2 Span: Columns 7 - 12 (6 columns) */}
                {visibleZones[2] && (
                  <th colSpan={6} className="bg-sky-600 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 2] วันที่ คู่ค้า & สินค้า (คอลัมน์ 7 - 12)
                  </th>
                )}

                {/* Zone 3 Span: Columns 13 - 15 (3 columns) */}
                {visibleZones[3] && (
                  <th colSpan={3} className="bg-emerald-600 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 3] น้ำหนักต้นทาง (คอลัมน์ 13 - 15)
                  </th>
                )}

                {/* Zone 4 Span: Columns 16 - 21 (6 columns) */}
                {visibleZones[4] && (
                  <th colSpan={6} className="bg-teal-600 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 4] ปลายทาง & ผลต่าง (คอลัมน์ 16 - 21)
                  </th>
                )}

                {/* Zone 5 Span: Columns 22 - 29 (8 columns) */}
                {visibleZones[5] && (
                  <th colSpan={8} className="bg-purple-600 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 5] คิดเงิน & ค่าบรรทุก (คอลัมน์ 22 - 29)
                  </th>
                )}

                {/* Zone 6 Span: Columns 30 - 36 (7 columns) */}
                {visibleZones[6] && (
                  <th colSpan={7} className="bg-rose-600 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 6] การชำระเงิน (คอลัมน์ 30 - 36)
                  </th>
                )}

                {/* Zone 7 Span: Columns 37 - 38 (2 columns) */}
                {visibleZones[7] && (
                  <th colSpan={2} className="bg-slate-700 text-white py-1 px-3 text-xs font-semibold">
                    [โซน 7] เพิ่มเติม (คอลัมน์ 37 - 38)
                  </th>
                )}

                {/* Action Pinned Header: spans 2 rows */}
                <th 
                  rowSpan={2} 
                  className="sticky-col-actions sticky top-0 right-0 z-50 bg-slate-800 text-white p-2 shadow-[-4px_0_10px_-2px_rgba(0,0,0,0.12)] text-center text-xs font-semibold"
                >
                  39. จัดการ
                </th>
              </tr>

              {/* Individual Column Sub-headers: Row 2 */}
              <tr className="bg-slate-100 text-slate-700 font-semibold text-[11px]">
                {/* Zone 1 Columns (2 - 6) */}
                {visibleZones[1] && (
                  <>
                    <th className={`min-w-[160px] max-w-[200px] bg-slate-100 text-slate-800 ${cellPadding}`}>2. โครงการ</th>
                    <th
                      className={`min-w-[120px] bg-slate-100 text-slate-700 ${cellPadding}`}
                      title="หมวดหมู่วัสดุ / ประเภทงานก่อสร้าง (เช่น หิน/ดิน/ทราย, คอนกรีตผสมเสร็จ, เหล็ก, ปูน, วัสดุก่อสร้างทั่วไป)"
                    >
                      3. หมวดหมู่ (วัสดุ)
                    </th>
                    <th className={`min-w-[110px] bg-slate-100 font-mono text-slate-700 ${cellPadding}`}>4. PO</th>
                    <th className={`min-w-[110px] bg-slate-100 font-mono text-slate-700 ${cellPadding}`}>5. RR</th>
                    <th className={`min-w-[120px] bg-slate-100 font-mono text-slate-700 ${cellPadding}`}>6. DO / ตั๋ว</th>
                  </>
                )}

                {/* Zone 2 Columns (7 - 12) */}
                {visibleZones[2] && (
                  <>
                    <th className={`min-w-[105px] bg-slate-100 font-mono text-slate-700 ${cellPadding}`}>7. วันที่</th>
                    <th className={`min-w-[180px] max-w-[240px] bg-slate-100 text-sky-950 font-bold ${cellPadding}`}>8. ผู้จำหน่าย / ร้านค้า</th>
                    <th className={`min-w-[140px] max-w-[190px] bg-slate-100 text-slate-700 ${cellPadding}`}>9. ผู้รับเหมา / ผู้ซื้อ</th>
                    <th className={`min-w-[115px] bg-slate-100 font-mono text-slate-700 ${cellPadding}`}>10. ทะเบียนรถ</th>
                    <th className={`min-w-[160px] max-w-[220px] bg-slate-100 text-slate-900 font-bold ${cellPadding}`}>11. รายการสินค้า</th>
                    <th className={`min-w-[120px] bg-slate-100 font-mono text-slate-600 ${cellPadding}`}>12. สเปก / Code</th>
                  </>
                )}

                {/* Zone 3 Columns (13 - 15) */}
                {visibleZones[3] && (
                  <>
                    <th className={`min-w-[105px] bg-slate-100 text-right font-mono ${cellPadding}`}>13. หนักต้น</th>
                    <th className={`min-w-[105px] bg-slate-100 text-right font-mono ${cellPadding}`}>14. เบาต้น</th>
                    <th className={`min-w-[115px] text-right text-emerald-900 bg-emerald-100 font-bold font-mono ${cellPadding}`}>15. สุทธิต้นทาง</th>
                  </>
                )}

                {/* Zone 4 Columns (16 - 21) */}
                {visibleZones[4] && (
                  <>
                    <th className={`min-w-[100px] bg-slate-100 font-mono ${cellPadding}`}>16. วันที่ปลาย</th>
                    <th className={`min-w-[110px] bg-slate-100 font-mono ${cellPadding}`}>17. ตั๋วปลายทาง</th>
                    <th className={`min-w-[105px] bg-slate-100 text-right font-mono ${cellPadding}`}>18. หนักปลาย</th>
                    <th className={`min-w-[105px] bg-slate-100 text-right font-mono ${cellPadding}`}>19. เบาปลาย</th>
                    <th className={`min-w-[115px] text-right text-teal-900 bg-teal-100 font-bold font-mono ${cellPadding}`}>20. สุทธิปลาย</th>
                    <th className={`min-w-[110px] text-right text-rose-800 bg-rose-100 font-bold font-mono ${cellPadding}`}>21. ผลต่าง(กก.)</th>
                  </>
                )}

                {/* Zone 5 Columns (22 - 29) */}
                {visibleZones[5] && (
                  <>
                    <th className={`min-w-[95px] bg-slate-100 text-right font-mono ${cellPadding}`}>22. ปริมาณ</th>
                    <th className={`min-w-[75px] bg-slate-100 text-center ${cellPadding}`}>23. หน่วย</th>
                    <th className={`min-w-[105px] bg-slate-100 text-right font-mono ${cellPadding}`}>24. ราคา/หน่วย</th>
                    <th className={`min-w-[125px] text-right text-purple-900 bg-purple-100 font-semibold font-mono ${cellPadding}`}>25. รวมค่าสินค้า</th>
                    <th className={`min-w-[105px] bg-slate-100 ${cellPadding}`}>26. ประเภทรถ</th>
                    <th className={`min-w-[105px] bg-slate-100 text-right font-mono ${cellPadding}`}>27. บรรทุก/หน่วย</th>
                    <th className={`min-w-[125px] text-right text-purple-900 bg-purple-100 font-semibold font-mono ${cellPadding}`}>28. รวมค่าขนส่ง</th>
                    <th className={`min-w-[135px] text-right text-blue-900 bg-blue-100 font-bold font-mono ${cellPadding}`}>29. รวมทั้งสิ้น</th>
                  </>
                )}

                {/* Zone 6 Columns (30 - 36) */}
                {visibleZones[6] && (
                  <>
                    <th className={`min-w-[105px] bg-slate-100 ${cellPadding}`}>30. รูปแบบจ่าย</th>
                    <th className={`min-w-[115px] bg-slate-100 text-right font-mono ${cellPadding}`}>31. จ่ายผู้ขาย</th>
                    <th className={`min-w-[115px] bg-slate-100 text-right font-mono text-amber-700 ${cellPadding}`}>32. ค้างผู้ขาย</th>
                    <th className={`min-w-[115px] bg-slate-100 text-right font-mono ${cellPadding}`}>33. จ่ายขนส่ง</th>
                    <th className={`min-w-[115px] bg-slate-100 text-right font-mono text-amber-700 ${cellPadding}`}>34. ค้างขนส่ง</th>
                    <th className={`min-w-[125px] bg-slate-100 text-right font-mono text-emerald-800 font-semibold ${cellPadding}`}>35. ชำระแล้วรวม</th>
                    <th className={`min-w-[130px] text-right font-mono text-rose-800 bg-rose-100 font-bold ${cellPadding}`}>36. ยอดค้างรวม</th>
                  </>
                )}

                {/* Zone 7 Columns (37 - 38) */}
                {visibleZones[7] && (
                  <>
                    <th className={`min-w-[150px] max-w-[200px] bg-slate-100 ${cellPadding}`}>37. สถานที่ส่ง/กม.</th>
                    <th className={`min-w-[180px] max-w-[240px] bg-slate-100 ${cellPadding}`}>38. หมายเหตุ</th>
                  </>
                )}
              </tr>
            </thead>

            {/* Table Rows Body */}
            <tbody className="bg-white">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={40} className="p-16 text-center text-slate-400">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-2xs">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-bold text-slate-800">ยังไม่มีข้อมูลคำสั่งซื้อในระบบ</p>
                        <p className="text-xs text-slate-500">
                          เริ่มต้นด้วยการสแกนบิล ตั๋วชั่ง หรือใบส่งของจริงผ่านระบบ Gemini AI Vision
                        </p>
                      </div>
                      {onOpenScan && (
                        <button
                          onClick={onOpenScan}
                          className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4 text-blue-200" />
                          <span>สแกนบิลด้วย AI ทันที</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((row) => {
                  const isSelected = selectedIds.includes(row.id);
                  const isUnpaid = Number(row.col36) > 0;

                  // Resolve linked documents for this row (Zones 1-4 & Tax Invoice)
                  const matchedPO = row.col4
                    ? pos.find(p => isDocNumberMatch(p.poNo, row.col4) || (p.poId && isDocNumberMatch(p.poId, row.col4)))
                    : undefined;

                  const linkedDestTicket = allDestTickets.find(
                    t =>
                      t.id !== row.id &&
                      ((row.matchedDestTicketId && t.id === row.matchedDestTicketId) ||
                        (t.linkedViaDocNo &&
                          ((row.col6 && isDocNumberMatch(t.linkedViaDocNo, row.col6)) ||
                            (row.col1 && isDocNumberMatch(t.linkedViaDocNo, row.col1)))) ||
                        (row.col17 &&
                          ((t.col17 && isDocNumberMatch(t.col17, row.col17)) ||
                            (t.col6 && isDocNumberMatch(t.col6, row.col17)) ||
                            (t.col1 && isDocNumberMatch(t.col1, row.col17)))))
                  );

                  const linkedTaxInvoice = allTaxInvoices.find(
                    inv =>
                      inv.linkedViaDocNo &&
                      ((row.col6 && inv.linkedViaDocNo.split(',').some(ref => isDocNumberMatch(ref.trim(), row.col6))) ||
                        (row.col1 && inv.linkedViaDocNo.split(',').some(ref => isDocNumberMatch(ref.trim(), row.col1))))
                  );

                  // Resolve effective Zone 4 fields so any row showing a Zone 4 document ALWAYS displays its Zone 4 data
                  const destSnap = linkedDestTicket?.rawAiSnapshot || (row.docType === 'dest_weighbridge' ? row.rawAiSnapshot : undefined);
                  const effectiveCol16 =
                    row.col16 ||
                    linkedDestTicket?.col16 ||
                    linkedDestTicket?.col7 ||
                    ((row.col17 || linkedDestTicket) ? row.col7 : '');
                  const effectiveCol17 =
                    row.col17 ||
                    linkedDestTicket?.col17 ||
                    linkedDestTicket?.col6 ||
                    linkedDestTicket?.col1 ||
                    '';
                  let effectiveCol18 =
                    Number(row.col18) ||
                    Number(linkedDestTicket?.col18) ||
                    Number(linkedDestTicket?.col13) ||
                    Number(destSnap?.rawGrossWeightKg) ||
                    0;
                  let effectiveCol19 =
                    Number(row.col19) ||
                    Number(linkedDestTicket?.col19) ||
                    Number(linkedDestTicket?.col14) ||
                    Number(destSnap?.rawTareWeightKg) ||
                    0;
                  if (effectiveCol18 > 0 && effectiveCol19 > 0 && effectiveCol18 < effectiveCol19) {
                    const tmp = effectiveCol18;
                    effectiveCol18 = effectiveCol19;
                    effectiveCol19 = tmp;
                  }
                  const effectiveCol20 =
                    Number(row.col20) ||
                    (effectiveCol18 > 0 ? Math.max(0, effectiveCol18 - effectiveCol19) : 0) ||
                    Number(linkedDestTicket?.col20) ||
                    Number(linkedDestTicket?.col15) ||
                    Number(destSnap?.rawNetWeightKg) ||
                    Number(linkedDestTicket?.col22) ||
                    0;
                  const originNetWeight = Number(row.col15) || 0;
                  const weightDiff =
                    originNetWeight > 0 && effectiveCol20 > 0
                      ? originNetWeight - effectiveCol20
                      : Number(row.col21) || 0;
                  const hasZone4Doc = Boolean(effectiveCol17 || effectiveCol18 > 0 || effectiveCol20 > 0 || linkedDestTicket);
                  const hasOriginWeighbridge =
                    row.docType !== 'dest_weighbridge' &&
                    (Number(row.col13) > 0 || Number(row.col15) > 0 || row.docType === 'weighbridge');

                  // Helper payloads for hover preview on PO, DO/Origin, and Destination Ticket
                  const triggerPOHover = (e: React.MouseEvent<HTMLElement>) => {
                    if (!row.col4) return;
                    openDocHoverPreview(e, {
                      rowId: row.id,
                      trNo: row.col1,
                      zoneBadge: 'โซน 1 • คอลัมน์ 4 (ใบสั่งซื้อ PO)',
                      docTypeLabel: 'ใบสั่งซื้อ (Purchase Order)',
                      docNo: row.col4,
                      imageUrl: matchedPO?.image,
                      matchStatus: row.poMatchStatus,
                      referenceNote:
                        row.referenceSource === 'handwritten'
                          ? '✍️ อ้างอิงจากลายมือบนเอกสาร DO'
                          : row.referenceSource === 'notes'
                          ? '💬 อ้างอิงจากช่องหมายเหตุในเอกสาร'
                          : '📄 อ้างอิงจากช่องเลขที่ PO ในบิล',
                      details: [
                        { label: 'เลขที่ใบสั่งซื้อ (PO)', value: row.col4, highlight: true },
                        { label: 'โครงการ', value: matchedPO?.project || row.col2 || '-' },
                        { label: 'ร้านค้า / ผู้ขาย', value: matchedPO?.supplierName || row.col8 || '-' },
                        { label: 'รายการสินค้า', value: matchedPO?.items?.map(i => i.description).join(', ') || row.col11 || '-' },
                        {
                          label: 'ปริมาณสั่งซื้อรวม',
                          value: matchedPO ? `${fmtNum(matchedPO.totalOrderedQty)} (ส่งแล้ว ${fmtNum(matchedPO.totalDeliveredQty)})` : `${fmtNum(row.col22)} ${row.col23 || ''}`
                        }
                      ],
                      compareDetails: [
                        {
                          label: 'เลข PO อ้างอิง',
                          originVal: matchedPO?.poNo || row.col4,
                          destVal: `DO อ้างถึง: ${row.col4}`,
                          isMatch: true
                        },
                        {
                          label: 'ร้านค้าผู้จำหน่าย',
                          originVal: matchedPO?.supplierName || '-',
                          destVal: row.col8 || '-',
                          isMatch: !matchedPO?.supplierName || matchedPO.supplierName.trim() === (row.col8 || '').trim()
                        }
                      ]
                    });
                  };

                  const triggerDOHover = (e: React.MouseEvent<HTMLElement>) => {
                    const docNum = row.col6 || row.col1 || '-';
                    openDocHoverPreview(e, {
                      rowId: row.id,
                      trNo: row.col1,
                      zoneBadge: 'โซน 1–3 • คอลัมน์ 6–15 (ใบส่งของ DO / ข้อมูลและน้ำหนักต้นทาง)',
                      docTypeLabel: 'ใบส่งของ (Delivery Order - โซน 1–3)',
                      docNo: `DO: ${docNum}`,
                      imageUrl: row.image,
                      matchStatus: row.autoFlagsVerified ? 'verified' : hasUnverifiedAutoActions(row) ? 'auto_flagged' : 'manual',
                      referenceNote: row.col4 ? `🔗 อ้างอิงใบสั่งซื้อ PO: ${row.col4}` : 'ยังไม่ได้ผูกเลขที่ PO',
                      details: [
                        { label: 'เลขที่ใบส่งของ DO (ช่อง 6)', value: docNum, highlight: true },
                        { label: 'โครงการ / หมวดหมู่ (ช่อง 2-3)', value: `${row.col2 || '-'} (${row.col3 || '-'})` },
                        { label: 'วันที่ออกบิล (ช่อง 7)', value: row.col7 || '-' },
                        { label: 'ร้านค้าผู้ขาย (ช่อง 8)', value: row.col8 || '-' },
                        { label: 'ทะเบียนรถ (ช่อง 10)', value: row.col10 || '-' },
                        { label: 'สินค้า (ช่อง 11)', value: `${row.col11 || '-'} (${fmtNum(row.col22)} ${row.col23 || ''})` },
                        {
                          label: 'น้ำหนักชั่งต้นทาง โซน 3 (ช่อง 13-15)',
                          value: hasOriginWeighbridge
                            ? `เข้า ${fmtNum(row.col13)} | ออก ${fmtNum(row.col14)} | สุทธิ ${fmtNum(row.col15)} กก.`
                            : 'ไม่มีข้อมูลชั่งน้ำหนักต้นทางใน DO นี้',
                          highlight: hasOriginWeighbridge
                        }
                      ]
                    });
                  };

                  const triggerDestHover = (e: React.MouseEvent<HTMLElement>) => {
                    if (!hasZone4Doc) return;
                    const destDocNo = effectiveCol17 || 'ตั๋วชั่งปลายทาง';
                    const destImg = linkedDestTicket?.image || (row.docType === 'dest_weighbridge' ? row.image : undefined);
                    const refDoText =
                      linkedDestTicket?.referenceDocNo ||
                      linkedDestTicket?.linkedViaDocNo ||
                      row.col6 ||
                      row.col1;
                    openDocHoverPreview(e, {
                      rowId: row.id,
                      trNo: row.col1,
                      zoneBadge: 'โซน 4 • คอลัมน์ 16-21 (ตั๋วชั่งน้ำหนักปลายทาง)',
                      docTypeLabel: 'ตั๋วชั่งน้ำหนักปลายทาง (Destination Weighbridge)',
                      docNo: destDocNo,
                      imageUrl: destImg,
                      matchStatus: row.destMatchStatus || linkedDestTicket?.destMatchStatus,
                      referenceNote: `🔗 ชนเข้ากับใบส่งของ DO: ${refDoText}`,
                      details: [
                        { label: 'เลขที่ตั๋วปลายทาง (ช่อง 17)', value: destDocNo, highlight: true },
                        { label: 'วันที่ชั่งปลายทาง (ช่อง 16)', value: effectiveCol16 || '-' },
                        { label: 'ทะเบียนรถในตั๋ว', value: linkedDestTicket?.col10 || row.col10 || '-' },
                        { label: 'หนักเข้าปลายทาง (ช่อง 18)', value: `${fmtNum(effectiveCol18)} กก.` },
                        { label: 'เบาออกปลายทาง (ช่อง 19)', value: `${fmtNum(effectiveCol19)} กก.` },
                        {
                          label: 'น้ำหนักสุทธิปลายทาง (ช่อง 20)',
                          value: effectiveCol20 > 0 ? `${fmtNum(effectiveCol20)} กก.` : '⚠️ รอระบุน้ำหนัก',
                          highlight: effectiveCol20 > 0,
                          alert: effectiveCol20 === 0
                        },
                        {
                          label: 'ผลต่าง ต้นทาง-ปลายทาง (ช่อง 21)',
                          value: weightDiff !== 0 ? `${weightDiff > 0 ? '+' : ''}${fmtNum(weightDiff)} กก.` : '0 กก. (ตรงกัน)',
                          alert: Math.abs(weightDiff) > 0
                        }
                      ],
                      compareDetails: [
                        {
                          label: 'เลขเอกสารที่ชนกัน',
                          originVal: `DO: ${row.col6 || row.col1}`,
                          destVal: `ตั๋วปลายทาง: ${destDocNo}`,
                          isMatch: true
                        },
                        {
                          label: 'ทะเบียนรถขนส่ง',
                          originVal: row.col10 || '-',
                          destVal: linkedDestTicket?.col10 || row.col10 || '-',
                          isMatch:
                            !linkedDestTicket?.col10 ||
                            !row.col10 ||
                            linkedDestTicket.col10.replace(/[^0-9ก-ฮa-zA-Z]/g, '') ===
                              row.col10.replace(/[^0-9ก-ฮa-zA-Z]/g, '')
                        },
                        {
                          label: 'เทียบน้ำหนักสุทธิ',
                          originVal: `${fmtNum(originNetWeight)} กก. (DO โซน 3)`,
                          destVal: `${fmtNum(effectiveCol20)} กก. (ปลายทาง โซน 4)`,
                          isMatch: originNetWeight === 0 || effectiveCol20 === 0 || Math.abs(originNetWeight - effectiveCol20) <= 50
                        }
                      ]
                    });
                  };

                  return (
                    <tr 
                      key={row.id} 
                      className={`group transition-colors ${
                        isSelected ? 'bg-blue-50 font-medium' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      {/* Col 0: Checkbox (Pinned Left 0) */}
                      <td className={`sticky-col-checkbox sticky left-0 z-20 text-center transition-colors ${
                        isSelected ? 'bg-blue-50' : 'bg-white group-hover:bg-slate-50'
                      } ${cellPadding}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(row.id)}
                          className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5 align-middle"
                        />
                      </td>

                      {/* Col 1: TR Number & Color-Coded Bill Icons in Single Compact Row (Pinned Left 44px) */}
                      <td className={`sticky-col-tr sticky left-[44px] z-20 shadow-[4px_0_10px_-2px_rgba(0,0,0,0.08)] transition-colors whitespace-nowrap ${
                        isSelected ? 'bg-blue-50' : 'bg-white group-hover:bg-slate-50'
                      } ${cellPadding}`}>
                        <div className="flex items-center justify-between gap-3 whitespace-nowrap">
                          {/* Left: TR Number + Compact Inline Status Flags */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => onInspectOrder(row)}
                              onMouseEnter={triggerDOHover}
                              onMouseLeave={closeDocHoverPreview}
                              className="font-mono font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left text-xs shrink-0"
                              title={`เลข TR: ${row.col1} (คลิกเพื่อเปิดตรวจสอบข้อมูลบิล)`}
                            >
                              {row.col1 || '-'}
                            </button>

                            {hasUnverifiedAutoActions(row) && (
                              <span className="inline-flex items-center gap-0.5 shrink-0">
                                <span
                                  onClick={() => onInspectOrder(row)}
                                  className="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-400 cursor-pointer hover:bg-amber-200"
                                  title={`รายการที่ระบบทำอัตโนมัติ (รอผู้ใช้ตรวจสอบ):\n• ${getOrderAutoFlagSummary(row).join('\n• ')}`}
                                >
                                  🚩{getOrderAutoFlagSummary(row).length}
                                </span>
                                {onVerifyAutoFlags && (
                                  <button
                                    type="button"
                                    onClick={() => onVerifyAutoFlags(row.id, 'all')}
                                    className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition"
                                    title="กดยืนยันความถูกต้องของรายการอัตโนมัติในบิลนี้ทั้งหมด"
                                  >
                                    ✓
                                  </button>
                                )}
                              </span>
                            )}

                            {!hasUnverifiedAutoActions(row) && row.autoFlagsVerified && (
                              <span
                                className="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
                                title={`ตรวจสอบยืนยันรายการอัตโนมัติแล้วโดย ${row.autoFlagsVerifiedBy || 'ผู้ใช้งาน'}`}
                              >
                                ✓
                              </span>
                            )}

                            {(row.lineSenderName || row.lineGroupName || row.lineInboxId) && (
                              <span
                                className="inline-flex items-center px-1 py-0.2 rounded text-[8px] font-bold bg-[#06C755]/15 text-emerald-900 border border-[#06C755]/40 shrink-0"
                                title={`รับจาก LINE OA | ผู้ส่ง: ${row.lineSenderName || '-'} | กลุ่ม LINE: ${row.lineGroupName || '-'}`}
                              >
                                💬
                              </span>
                            )}
                          </div>

                          {/* Right: Color-Coded Bill Icons (Hover to preview bill image & match details) */}
                          <div className="inline-flex items-center gap-1 shrink-0">
                            {/* 1. Blue Bill Icon = ใบสั่งซื้อ PO (คอลัมน์ 4) */}
                            {row.col4 ? (
                              <button
                                type="button"
                                onMouseEnter={triggerPOHover}
                                onMouseLeave={closeDocHoverPreview}
                                onClick={() => setMatchingDOForPO(row)}
                                className="relative p-1 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300 transition cursor-pointer"
                              >
                                <FileImage className="w-3.5 h-3.5" />
                                {row.poMatchStatus === 'auto_flagged' && (
                                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 ring-1 ring-white" />
                                )}
                                {row.poMatchStatus === 'verified' && (
                                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setMatchingDOForPO(row)}
                                className="p-1 rounded-md bg-slate-50 hover:bg-blue-50 text-slate-300 hover:text-blue-600 border border-dashed border-slate-300 hover:border-blue-300 transition cursor-pointer"
                                title="ยังไม่ได้ชน PO (คลิกเพื่อเลือกชน PO)"
                              >
                                <FileImage className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* 2. Sky-Blue Bill Icon = ใบส่งของ DO (โซน 1–3 คอลัมน์ 6–15) */}
                            {row.docType !== 'dest_weighbridge' && (
                              <button
                                type="button"
                                onMouseEnter={triggerDOHover}
                                onMouseLeave={closeDocHoverPreview}
                                onClick={() => onInspectOrder(row)}
                                className="relative p-1 rounded-md bg-sky-100 hover:bg-sky-200 text-sky-700 border border-sky-300 transition cursor-pointer"
                              >
                                <FileImage className="w-3.5 h-3.5" />
                                {hasOriginWeighbridge && (
                                  <span
                                    className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white"
                                  />
                                )}
                              </button>
                            )}

                            {/* 3. Teal Bill Icon = ตั๋วชั่งน้ำหนักปลายทาง (โซน 4 คอลัมน์ 16–21) */}
                            {hasZone4Doc ? (
                              <button
                                type="button"
                                onMouseEnter={triggerDestHover}
                                onMouseLeave={closeDocHoverPreview}
                                onClick={() => {
                                  if (!visibleZones[4]) {
                                    setVisibleZones(prev => ({ ...prev, 4: true }));
                                  }
                                  if (linkedDestTicket) {
                                    onInspectOrder(linkedDestTicket);
                                  } else {
                                    setMatchingDOForDest(row);
                                  }
                                }}
                                className={`relative p-1 rounded-md border transition cursor-pointer ${
                                  effectiveCol20 > 0
                                    ? 'bg-teal-100 hover:bg-teal-200 text-teal-800 border-teal-400'
                                    : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-400'
                                }`}
                              >
                                <FileImage className="w-3.5 h-3.5" />
                                {row.destMatchStatus === 'auto_flagged' && (
                                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 ring-1 ring-white" />
                                )}
                                {row.destMatchStatus === 'verified' && (
                                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setMatchingDOForDest(row)}
                                className="p-1 rounded-md bg-slate-50 hover:bg-teal-50 text-slate-300 hover:text-teal-600 border border-dashed border-slate-300 hover:border-teal-300 transition cursor-pointer"
                                title="ยังไม่มีตั๋วชั่งปลายทาง โซน 4 (คลิกเพื่อชนตั๋วปลายทาง)"
                              >
                                <FileImage className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* 4. Purple Bill Icon = ใบรับวางบิล RR / ใบกำกับภาษี (ถ้ามี) */}
                            {(row.col5 || linkedTaxInvoice) && (
                              <button
                                type="button"
                                onMouseEnter={(e) => {
                                  const invDoc = linkedTaxInvoice?.col6 || row.col5 || '-';
                                  openDocHoverPreview(e, {
                                    rowId: row.id,
                                    trNo: row.col1,
                                    zoneBadge: 'โซน 1 คอลัมน์ 5 / โซน 5-6 (เอกสารวางบิล/ใบเสร็จ)',
                                    docTypeLabel: linkedTaxInvoice ? 'ใบกำกับภาษี / ใบเสร็จรับเงิน' : 'ใบรับวางบิล (RR)',
                                    docNo: invDoc,
                                    imageUrl: linkedTaxInvoice?.image || row.image,
                                    details: [
                                      { label: 'เลขที่เอกสาร', value: invDoc, highlight: true },
                                      { label: 'อ้างอิง DO', value: row.col6 || row.col1 },
                                      { label: 'ยอดสุทธิรวมภาษี (ช่อง 31)', value: fmtCurrency(row.col31), highlight: true }
                                    ]
                                  });
                                }}
                                onMouseLeave={closeDocHoverPreview}
                                onClick={() => onInspectOrder(linkedTaxInvoice || row)}
                                className="p-1 rounded-md bg-purple-100 hover:bg-purple-200 text-purple-700 border border-purple-300 transition cursor-pointer"
                              >
                                <FileImage className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Zone 1: Columns 2 - 6 */}
                      {visibleZones[1] && (
                        <>
                          <td className={`font-medium text-slate-900 truncate max-w-[200px] ${cellPadding}`} title={row.col2}>
                            {row.col2 || '-'}
                          </td>
                          <td className={`text-slate-600 truncate max-w-[120px] ${cellPadding}`} title={row.col3}>
                            {row.col3 || '-'}
                          </td>
                          <td className={`font-mono text-xs whitespace-nowrap ${cellPadding}`}>
                            {row.col4 ? (
                              <div className="flex items-center gap-1 whitespace-nowrap">
                                <span
                                  onMouseEnter={triggerPOHover}
                                  onMouseLeave={closeDocHoverPreview}
                                  onClick={() => setMatchingDOForPO(row)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold cursor-pointer"
                                >
                                  <FileImage className="w-3 h-3 text-blue-600 shrink-0" />
                                  <span>{row.col4}</span>
                                </span>
                                {row.poMatchStatus === 'auto_flagged' && (
                                  <span className="inline-flex items-center gap-0.5 font-sans">
                                    <span className="text-[9px] bg-amber-100 text-amber-900 border border-amber-300 px-1 py-0.2 rounded font-bold" title="ชน PO อัตโนมัติ (รอตรวจสอบ)">
                                      🚩
                                    </span>
                                    {onVerifyAutoFlags && (
                                      <button
                                        type="button"
                                        onClick={() => onVerifyAutoFlags(row.id, 'po')}
                                        className="text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white px-1 py-0.2 rounded font-bold cursor-pointer"
                                        title="ยืนยันการชน PO อัตโนมัติ"
                                      >
                                        ✓
                                      </button>
                                    )}
                                  </span>
                                )}
                                {row.poMatchStatus === 'verified' && (
                                  <span className="text-[10px] text-emerald-600 font-sans font-bold" title="ยืนยัน PO แล้ว">
                                    ✓
                                  </span>
                                )}
                                {row.referenceSource === 'handwritten' && (
                                  <span className="text-[9px] bg-amber-50 text-amber-800 border border-amber-200 px-1 rounded font-sans" title="อ้างอิงจากลายมือบนเอกสาร">✍️</span>
                                )}
                                {row.referenceSource === 'notes' && (
                                  <span className="text-[9px] bg-sky-50 text-sky-800 border border-sky-200 px-1 rounded font-sans" title="อ้างอิงจากหมายเหตุ">💬</span>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setMatchingDOForPO(row)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 hover:bg-blue-50 text-amber-800 hover:text-blue-700 border border-amber-200 hover:border-blue-300 text-[10px] font-sans font-semibold cursor-pointer transition"
                                title="เลือกชนบิลเข้ากับใบสั่งซื้อ (PO) ด้วยมือ"
                              >
                                <Link2 className="w-2.5 h-2.5" />
                                <span>ชน PO</span>
                              </button>
                            )}
                          </td>
                          <td
                            className={`font-mono text-xs whitespace-nowrap ${cellPadding}`}
                            title="คอลัมน์ 5 เลขที่ใบรับสินค้า/ซื้อเชื่อ (RR) จากโปรแกรม Express (Auto-Stamp จากเมนูรับวางบิล)"
                          >
                            {row.col5 ? (
                              <button
                                type="button"
                                onClick={() => onSwitchTab && onSwitchTab('billing')}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold cursor-pointer"
                                title={`วางบิลแล้ว (BILLED) • ชุดวางบิล: ${row.billingNoteId || '-'} • เลข RR: ${row.col5}`}
                              >
                                <span>{row.col5}</span>
                                <span className="text-[9px] font-sans bg-emerald-600 text-white px-1 rounded">
                                  BILLED
                                </span>
                              </button>
                            ) : row.billingStatus === 'IN_BILLING' && row.billingNoteId ? (
                              <button
                                type="button"
                                onClick={() => onSwitchTab && onSwitchTab('billing')}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-bold cursor-pointer"
                                title="อยู่ในชุดรับวางบิลแล้ว รอกรอกเลขที่ RR จากโปรแกรม Express"
                              >
                                <span>รอ RR ({row.billingNoteId})</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onSwitchTab && onSwitchTab('billing')}
                                className="text-slate-400 hover:text-sky-700 text-[10px] italic font-sans cursor-pointer"
                                title="คลิกเพื่อไปที่เมนูรับวางบิลฝ่ายจัดซื้อ (Express RR)"
                              >
                                รอวางบิล (RR)
                              </button>
                            )}
                          </td>
                          <td className={`font-mono font-bold text-slate-800 whitespace-nowrap ${cellPadding}`}>
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              <span
                                onMouseEnter={triggerDOHover}
                                onMouseLeave={closeDocHoverPreview}
                                onClick={() => onInspectOrder(row)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200 cursor-pointer"
                              >
                                <FileImage className="w-3 h-3 text-sky-600 shrink-0" />
                                <span>{row.col6 || '-'}</span>
                              </span>
                              {row.referenceDocNo && row.referenceDocNo !== row.col6 && row.referenceDocNo !== row.col4 && (
                                <span className="text-[9px] font-normal text-sky-700 bg-sky-50 px-1 rounded border border-sky-200 font-sans" title={`อ้างถึง DO: ${row.referenceDocNo}`}>
                                  🔗 {row.referenceDocNo}
                                </span>
                              )}
                            </div>
                          </td>
                        </>
                      )}

                      {/* Zone 2: Columns 7 - 12 */}
                      {visibleZones[2] && (
                        <>
                          <td className={`text-slate-600 font-mono whitespace-nowrap ${cellPadding}`}>{row.col7 || '-'}</td>
                          <td className={`font-semibold text-slate-900 truncate max-w-[240px] ${cellPadding}`}>
                            {onOpenStoreModal ? (
                              <button
                                onClick={() => onOpenStoreModal(row.col8)}
                                className="text-left hover:text-blue-600 hover:underline cursor-pointer truncate block w-full"
                                title="คลิกดูประวัติร้านค้านี้"
                              >
                                {row.col8 || '-'}
                              </button>
                            ) : (
                              <span>{row.col8 || '-'}</span>
                            )}
                          </td>
                          <td className={`text-slate-600 truncate max-w-[190px] ${cellPadding}`} title={row.col9}>{row.col9 || '-'}</td>
                          <td className={`font-mono font-medium text-slate-800 bg-slate-50 whitespace-nowrap ${cellPadding}`}>{row.col10 || '-'}</td>
                          <td className={`font-bold text-slate-900 truncate max-w-[220px] ${cellPadding}`} title={row.col11}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate">{row.col11 || '-'}</span>
                              {row.lineItems && row.lineItems.length > 1 && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200" title={`มีสินค้า ${row.lineItems.length} รายการในบิลนี้`}>
                                  +{row.lineItems.length}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`text-slate-500 font-mono truncate max-w-[120px] ${cellPadding}`}>{row.col12 || '-'}</td>
                        </>
                      )}

                      {/* Zone 3: Columns 13 - 15 */}
                      {visibleZones[3] && (
                        <>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>
                            {Number(row.col13) > 0 ? fmtNum(row.col13) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>
                            {Number(row.col14) > 0 ? fmtNum(row.col14) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className={`text-right font-mono tabular-nums font-bold text-emerald-700 bg-emerald-50 ${cellPadding}`}>
                            {Number(row.col15) > 0 ? fmtNum(row.col15) : <span className="text-slate-300">-</span>}
                          </td>
                        </>
                      )}

                       {/* Zone 4: Columns 16 - 21 (Always populated from row or linkedDestTicket) */}
                      {visibleZones[4] && (
                        <>
                          <td className={`text-slate-700 font-mono whitespace-nowrap ${cellPadding}`}>
                            {effectiveCol16 || '-'}
                          </td>
                          <td className={`font-mono text-slate-700 whitespace-nowrap ${cellPadding}`}>
                            {hasZone4Doc ? (
                              <div className="flex items-center gap-1 whitespace-nowrap">
                                <span
                                  onMouseEnter={triggerDestHover}
                                  onMouseLeave={closeDocHoverPreview}
                                  onClick={() => onInspectOrder(linkedDestTicket || row)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-50 hover:bg-teal-100 border border-teal-200 font-bold text-teal-900 cursor-pointer"
                                >
                                  <FileImage className="w-3 h-3 text-teal-600 shrink-0" />
                                  <span>{effectiveCol17 || 'ตั๋วปลายทาง'}</span>
                                </span>
                                {row.destMatchStatus === 'auto_flagged' && (
                                  <span className="inline-flex items-center gap-0.5 font-sans">
                                    <span className="text-[9px] bg-amber-100 text-amber-900 border border-amber-300 px-1 py-0.2 rounded font-bold" title="ชนตั๋วปลายทางอัตโนมัติ (รอตรวจสอบ)">
                                      🚩
                                    </span>
                                    {onVerifyAutoFlags && (
                                      <button
                                        type="button"
                                        onClick={() => onVerifyAutoFlags(row.id, 'dest')}
                                        className="text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white px-1 py-0.2 rounded font-bold cursor-pointer"
                                        title="ยืนยันการชนตั๋วชั่งปลายทางอัตโนมัติ"
                                      >
                                        ✓
                                      </button>
                                    )}
                                  </span>
                                )}
                                {row.destMatchStatus === 'verified' && (
                                  <span className="text-[10px] text-emerald-600 font-sans font-bold" title="ยืนยันตั๋วปลายทางแล้ว">
                                    ✓
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setMatchingDOForDest(row)}
                                  className="text-[9px] px-1 py-0.2 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-sans cursor-pointer"
                                  title="เปลี่ยนหรือยกเลิกตั๋วชั่งปลายทางที่ชนไว้"
                                >
                                  จัดการ
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setMatchingDOForDest(row)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-[9px] font-sans font-bold shadow-2xs cursor-pointer transition"
                                title="เลือกตั๋วชั่งน้ำหนักปลายทางมาชนเข้าโซน 4 ด้วยมือ"
                              >
                                <Link2 className="w-2.5 h-2.5" />
                                <span>ชนตั๋วปลายทาง</span>
                              </button>
                            )}
                          </td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>
                            {effectiveCol18 > 0 ? (
                              fmtNum(effectiveCol18)
                            ) : hasZone4Doc ? (
                              <span className="text-[10px] text-amber-600 font-sans">รอระบุ</span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>
                            {effectiveCol19 > 0 ? (
                              fmtNum(effectiveCol19)
                            ) : hasZone4Doc ? (
                              <span className="text-[10px] text-amber-600 font-sans">รอระบุ</span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className={`text-right font-mono tabular-nums font-bold text-teal-700 bg-teal-50 ${cellPadding}`}>
                            {effectiveCol20 > 0 ? (
                              fmtNum(effectiveCol20)
                            ) : hasZone4Doc ? (
                              <button
                                type="button"
                                onClick={() => onInspectOrder(linkedDestTicket || row)}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-sans font-semibold cursor-pointer"
                                title="คลิกเพื่อกรอกหรือตรวจสอบน้ำหนักสุทธิปลายทาง"
                              >
                                ⚠️ กรอก นน.
                              </button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className={`text-right font-mono tabular-nums font-bold ${cellPadding} ${
                            weightDiff > 0
                              ? 'text-rose-600 bg-rose-50'
                              : weightDiff < 0
                              ? 'text-amber-700 bg-amber-50'
                              : hasZone4Doc && effectiveCol20 > 0 && originNetWeight > 0
                              ? 'text-emerald-700 bg-emerald-50'
                              : 'text-slate-300'
                          }`}>
                            {weightDiff > 0
                              ? `+${fmtNum(weightDiff)}`
                              : weightDiff < 0
                              ? fmtNum(weightDiff)
                              : hasZone4Doc && effectiveCol20 > 0 && originNetWeight > 0
                              ? '0 (ตรงกัน)'
                              : '-'}
                          </td>
                        </>
                      )}

                      {/* Zone 5: Columns 22 - 29 */}
                      {visibleZones[5] && (
                        <>
                          <td className={`text-right font-mono tabular-nums font-bold text-slate-900 ${cellPadding}`}>{fmtNum(row.col22)}</td>
                          <td className={`text-center text-slate-600 ${cellPadding}`}>{row.col23 || '-'}</td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>{fmtNum(row.col24)}</td>
                          <td className={`text-right font-mono tabular-nums font-semibold text-purple-700 bg-purple-50 ${cellPadding}`}>{fmtCurrency(row.col25)}</td>
                          <td className={`text-slate-600 text-[11px] truncate max-w-[105px] ${cellPadding}`}>{row.col26 || '-'}</td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>{fmtNum(row.col27)}</td>
                          <td className={`text-right font-mono tabular-nums font-semibold text-purple-700 bg-purple-50 ${cellPadding}`}>{fmtCurrency(row.col28)}</td>
                          <td className={`text-right font-mono tabular-nums font-bold text-blue-700 bg-blue-50 ${cellPadding}`}>{fmtCurrency(row.col29)}</td>
                        </>
                      )}

                      {/* Zone 6: Columns 30 - 36 */}
                      {visibleZones[6] && (
                        <>
                          <td className={`text-slate-700 text-[11px] ${cellPadding}`}>
                            <span className="text-slate-700 font-medium">
                              {row.col30 || 'โอนเงิน'}
                            </span>
                          </td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>{fmtCurrency(row.col31)}</td>
                          <td className={`text-right font-mono tabular-nums text-amber-700 ${cellPadding}`}>{fmtCurrency(row.col32)}</td>
                          <td className={`text-right font-mono tabular-nums text-slate-700 ${cellPadding}`}>{fmtCurrency(row.col33)}</td>
                          <td className={`text-right font-mono tabular-nums text-amber-700 ${cellPadding}`}>{fmtCurrency(row.col34)}</td>
                          <td className={`text-right font-mono tabular-nums font-semibold text-emerald-700 ${cellPadding}`}>{fmtCurrency(row.col35)}</td>
                          <td className={`text-right font-mono tabular-nums font-bold ${cellPadding} ${
                            isUnpaid ? 'text-rose-700 bg-rose-50' : 'text-slate-400'
                          }`}>
                            {fmtCurrency(row.col36)}
                          </td>
                        </>
                      )}

                      {/* Zone 7: Columns 37 - 38 */}
                      {visibleZones[7] && (
                        <>
                          <td className={`text-slate-600 truncate max-w-[200px] ${cellPadding}`} title={row.col37}>{row.col37 || '-'}</td>
                          <td className={`text-slate-500 truncate max-w-[240px] ${cellPadding}`} title={row.col38}>{row.col38 || '-'}</td>
                        </>
                      )}

                      {/* Col 39: Actions Column (Pinned Right 0) */}
                      <td className={`sticky-col-actions sticky right-0 z-20 text-center shadow-[-4px_0_10px_-2px_rgba(0,0,0,0.08)] transition-colors ${
                        isSelected ? 'bg-blue-50' : 'bg-white group-hover:bg-slate-50'
                      } ${cellPadding}`}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onInspectOrder(row)}
                            title="ดูตั๋วบิล / ตรวจสอบฟิลด์"
                            className="p-1 text-blue-600 hover:bg-blue-100/70 rounded-md transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteOrder(row.id)}
                            title="ลบรายการ"
                            className="p-1 text-rose-600 hover:bg-rose-100/70 rounded-md transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary / Count Bar */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <div>
            แสดง <span className="font-semibold text-slate-800 tabular-nums">{filteredOrders.length}</span> รายการใบส่งของ / ตั๋วต้นทาง (DO)
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>ตรึงคอลัมน์สำคัญ (เลข TR / จัดการ) พร้อมระบบปรับตามประเภทบิล</span>
            </span>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Modal: Manual Match Destination Ticket to Origin DO/Ticket */}
      {matchingDestTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold text-sm">
                  🏁
                </span>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">ชนบิลตั๋วชั่งปลายทางเข้ากับเที่ยวส่งมอบ (DO)</h3>
                  <p className="text-[11px] text-slate-500">
                    เลือกใบส่งของ (DO) หรือตั๋วต้นทาง ที่ต้องการหยอดน้ำหนักปลายทางลงใน [โซน 4]
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMatchingDestTicket(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Source Destination Ticket Summary Card */}
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs space-y-1.5">
              <div className="font-bold text-teal-950 flex items-center justify-between">
                <span>ตั๋วปลายทาง: {matchingDestTicket.col17 || matchingDestTicket.col6 || matchingDestTicket.col1}</span>
                <span className="font-mono text-teal-800">วันที่: {matchingDestTicket.col16 || matchingDestTicket.col7}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] text-teal-900">
                <div>
                  <span className="text-teal-600 block">ทะเบียนรถ:</span>
                  <span className="font-bold font-mono text-xs">{matchingDestTicket.col10 || '-'}</span>
                </div>
                <div>
                  <span className="text-teal-600 block">หนักเข้า (18):</span>
                  <span className="font-mono">{Number(matchingDestTicket.col18).toLocaleString()} กก.</span>
                </div>
                <div>
                  <span className="text-teal-600 block">เบาออก (19):</span>
                  <span className="font-mono">{Number(matchingDestTicket.col19).toLocaleString()} กก.</span>
                </div>
                <div>
                  <span className="text-teal-600 block">สุทธิปลายทาง (20):</span>
                  <span className="font-mono font-bold text-teal-950">{Number(matchingDestTicket.col20).toLocaleString()} กก.</span>
                </div>
              </div>
              {matchingDestTicket.col38 && (
                <div className="text-[11px] text-teal-700 pt-0.5">
                  หมายเหตุ: {matchingDestTicket.col38}
                </div>
              )}
            </div>

            {/* Candidate DOs List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  เลือกใบส่งของ (DO) หรือ ตั๋วต้นทาง ที่ตรงกัน ({candidateDOsForDestMatch.length} รายการที่ยังไม่มีน้ำหนักปลายทาง):
                </span>
              </div>

              {candidateDOsForDestMatch.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-xs">
                  ไม่พบใบส่งของหรือตั๋วต้นทางที่ยังค้างน้ำหนักปลายทาง
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {candidateDOsForDestMatch.map((cand) => {
                    const destTextRefs = extractDocReferences(matchingDestTicket.col38);
                    const destRefCandidates = [matchingDestTicket.referenceDocNo, ...destTextRefs.doNumbers].filter(Boolean) as string[];
                    const isRefMatch = Boolean(cand.col6 && destRefCandidates.some(r => isDocNumberMatch(cand.col6, r)));
                    const isPlateMatch = cand.col10 && matchingDestTicket.col10 && 
                      cand.col10.replace(/[^0-9ก-ฮa-zA-Z]/g, '') === matchingDestTicket.col10.replace(/[^0-9ก-ฮa-zA-Z]/g, '');
                    
                    return (
                      <div 
                        key={cand.id}
                        className={`p-3 rounded-xl border transition flex flex-wrap items-center justify-between gap-2 text-xs ${
                          isRefMatch
                            ? 'bg-blue-50/80 border-blue-400 ring-1 ring-blue-300'
                            : isPlateMatch 
                            ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200' 
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold font-mono text-slate-900">{cand.col1}</span>
                            <span className="text-slate-700 font-mono font-semibold">DO: {cand.col6 || '-'}</span>
                            {isRefMatch && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-600 text-white">
                                🔗 เลขที่ DO อ้างอิงตรงกัน
                              </span>
                            )}
                            {isPlateMatch && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                💡 ข้อมูลช่วยสังเกต (ชนมือ): ทะเบียนตรงกัน
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>วันที่: {cand.col7}</span>
                            <span>ทะเบียน: <strong className="font-mono text-slate-800">{cand.col10 || '-'}</strong></span>
                            <span>ร้าน: {cand.col8}</span>
                            <span>สินค้า: {cand.col11}</span>
                            {Number(cand.col15) > 0 && (
                              <span className="text-emerald-700 font-mono font-semibold">สุทธิเที่ยวต้นทาง: {Number(cand.col15).toLocaleString()} กก.</span>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => handleExecuteManualMatchDest(cand)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition cursor-pointer shadow-2xs flex items-center gap-1.5"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>ชนบิลเข้าใบนี้</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setMatchingDestTicket(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Manual Match Tax Invoice / Receipt to Origin DO(s) */}
      {matchingTaxInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center font-bold text-sm">
                  🧾
                </span>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">ชนบิลใบเสร็จรับเงิน / ใบกำกับภาษี เข้ากับใบส่งของ (DO)</h3>
                  <p className="text-[11px] text-slate-500">
                    เลือกใบส่งของ (DO) 1 ใบ หรือหลายใบ เพื่อนำข้อมูลราคาและสถานะการชำระเงินไปเติมใน [โซน 5 และ โซน 6]
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setMatchingTaxInvoice(null);
                  setSelectedDOIdsForTaxMatch([]);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Source Tax Invoice Summary Card */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-1.5">
              <div className="font-bold text-amber-950 flex items-center justify-between">
                <span>เลขที่ใบกำกับภาษี/ใบเสร็จ: {matchingTaxInvoice.col6 || matchingTaxInvoice.col1}</span>
                <span className="font-mono text-amber-800">วันที่: {matchingTaxInvoice.col7}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] text-amber-900">
                <div>
                  <span className="text-amber-700 block">ร้านค้าผู้ขาย:</span>
                  <span className="font-bold text-xs">{matchingTaxInvoice.col8 || '-'}</span>
                </div>
                <div>
                  <span className="text-amber-700 block">ยอดรวมสุทธิ (29):</span>
                  <span className="font-mono font-bold text-amber-950">{fmtCurrency(matchingTaxInvoice.col29)}</span>
                </div>
                <div>
                  <span className="text-amber-700 block">ชำระแล้ว (35):</span>
                  <span className="font-mono text-emerald-700 font-bold">{fmtCurrency(matchingTaxInvoice.col35)}</span>
                </div>
                <div>
                  <span className="text-amber-700 block">ค้างชำระ (36):</span>
                  <span className="font-mono text-rose-700 font-bold">{fmtCurrency(matchingTaxInvoice.col36)}</span>
                </div>
              </div>
            </div>

            {/* Candidate DOs List (supports single 1-click or multi-select) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  เลือกใบส่งของ (DO) ที่ต้องการนำยอดการเงินไปอัปเดต ({candidateDOsForTaxMatch.length} รายการ):
                </span>
                {selectedDOIdsForTaxMatch.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleExecuteManualMatchTaxInvoice(selectedDOIdsForTaxMatch)}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-2xs cursor-pointer transition"
                  >
                    ยืนยันชนบิลกับ {selectedDOIdsForTaxMatch.length} DO ที่เลือก
                  </button>
                )}
              </div>

              {candidateDOsForTaxMatch.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500 text-xs space-y-2">
                  <p>ยังไม่มีใบส่งของ (DO) ในตาราง 39 คอลัมน์ให้ชนบิล</p>
                  <button
                    type="button"
                    onClick={() => {
                      handlePromoteTaxInvoiceToDirectDO(matchingTaxInvoice);
                      setMatchingTaxInvoice(null);
                    }}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold text-xs cursor-pointer transition"
                  >
                    📥 บรรจุใบกำกับภาษีนี้เป็นรายการรับของตรงในตาราง 39 คอลัมน์ (กรณีไม่มี DO แยก)
                  </button>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {candidateDOsForTaxMatch.map((cand) => {
                    const isSameVendor = cand.col8 && matchingTaxInvoice.col8 &&
                      cand.col8.trim().toLowerCase() === matchingTaxInvoice.col8.trim().toLowerCase();
                    const isChecked = selectedDOIdsForTaxMatch.includes(cand.id);

                    return (
                      <div
                        key={cand.id}
                        className={`p-3 rounded-xl border transition flex flex-wrap items-center justify-between gap-2 text-xs ${
                          isChecked
                            ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-300'
                            : isSameVendor
                            ? 'bg-emerald-50/50 border-emerald-200'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedDOIdsForTaxMatch(prev =>
                                prev.includes(cand.id) ? prev.filter(x => x !== cand.id) : [...prev, cand.id]
                              );
                            }}
                            className="mt-1 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                          />
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold font-mono text-slate-900">{cand.col1}</span>
                              <span className="text-slate-600 font-mono font-semibold">DO: {cand.col6 || '-'}</span>
                              {cand.col4 && <span className="text-indigo-600 font-mono text-[11px]">PO: {cand.col4}</span>}
                              {isSameVendor && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  ⭐ ร้านค้าตรงกัน
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>วันที่: {cand.col7}</span>
                              <span>ร้าน: <strong>{cand.col8}</strong></span>
                              <span>สินค้า: {cand.col11} ({cand.col22} {cand.col23})</span>
                              <span className="font-mono font-semibold text-blue-800">ยอดใน DO: {fmtCurrency(cand.col29)}</span>
                            </div>
                          </div>
                        </label>

                        <button
                          type="button"
                          onClick={() => handleExecuteManualMatchTaxInvoice([cand.id])}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition cursor-pointer shadow-2xs flex items-center gap-1.5"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>ชนเข้า DO นี้ทันที</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  handlePromoteTaxInvoiceToDirectDO(matchingTaxInvoice);
                  setMatchingTaxInvoice(null);
                }}
                className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                📥 บรรจุเป็นบิลรับของตรง (กรณีซื้อสดไม่มี DO แยก)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMatchingTaxInvoice(null);
                  setSelectedDOIdsForTaxMatch([]);
                }}
                className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Manual Match DO to Purchase Order (PO — Zone 1 Col 4) */}
      {matchingDOForPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                  🔗
                </span>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">ชนบิลใบส่งของ (DO) เข้ากับใบสั่งซื้อ (PO — โซน 1 ช่อง 4) ด้วยมือ</h3>
                  <p className="text-[11px] text-slate-500">
                    สำหรับกรณีในบิลไม่มีเลข PO อ้างอิง หรือต้องการเปลี่ยน/ยกเลิกใบสั่งซื้อด้วยตัวเอง (ยืนยันทันทีเมื่อเลือก)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMatchingDOForPO(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs space-y-1">
              <div className="font-bold text-blue-950 flex items-center justify-between">
                <span>ใบส่งของ (DO): {matchingDOForPO.col6 || matchingDOForPO.col1} (TR: {matchingDOForPO.col1})</span>
                <span className="font-mono text-blue-800">วันที่: {matchingDOForPO.col7}</span>
              </div>
              <div className="text-[11px] text-blue-900 flex flex-wrap gap-x-4 gap-y-1">
                <span>ร้านค้า: <strong>{matchingDOForPO.col8 || '-'}</strong></span>
                <span>สินค้า: <strong>{matchingDOForPO.col11 || '-'}</strong> ({matchingDOForPO.col22} {matchingDOForPO.col23})</span>
                <span>PO ปัจจุบัน: <strong className="font-mono">{matchingDOForPO.col4 || 'ยังไม่ผูก PO'}</strong></span>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {pos.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-xs">
                  ยังไม่มีใบสั่งซื้อ (PO) ในระบบ
                </div>
              ) : (
                pos.map(po => {
                  const isCurrent = Boolean(matchingDOForPO.col4 && isDocNumberMatch(matchingDOForPO.col4, po.poNumber));
                  const isSameStore = Boolean(
                    matchingDOForPO.col8 &&
                    po.storeName &&
                    matchingDOForPO.col8.trim().toLowerCase() === po.storeName.trim().toLowerCase()
                  );
                  return (
                    <div
                      key={po.id}
                      className={`p-3 rounded-xl border transition flex flex-wrap items-center justify-between gap-2 text-xs ${
                        isCurrent
                          ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                          : isSameStore
                          ? 'bg-emerald-50/50 border-emerald-200'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold font-mono text-blue-900">{po.poNumber}</span>
                          <span className="text-slate-700 font-semibold">{po.storeName}</span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-600 text-white">
                              ผูกอยู่ปัจจุบัน
                            </span>
                          )}
                          {isSameStore && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              💡 ร้านค้าเดียวกัน
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3">
                          <span>โครงการ: {po.projectId || '-'}</span>
                          <span>โควตาสั่งซื้อ: {po.totalQty} {(po.items && po.items[0]?.unit) || 'หน่วย'}</span>
                          <span>ยอดรวม: {fmtCurrency(po.totalAmount)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (onLinkOrderToPO) {
                            onLinkOrderToPO(matchingDOForPO.id, po.poNumber);
                          } else {
                            onUpdateOrder({
                              ...matchingDOForPO,
                              col4: po.poNumber,
                              poMatchStatus: 'verified'
                            });
                          }
                          setMatchingDOForPO(null);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs cursor-pointer transition flex items-center gap-1"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>{isCurrent ? 'ยืนยันผูก PO นี้' : 'ชนเข้า PO นี้'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              {matchingDOForPO.col4 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onUnlinkOrderFromPO) {
                      onUnlinkOrderFromPO(matchingDOForPO.id);
                    } else {
                      onUpdateOrder({ ...matchingDOForPO, col4: '', poMatchStatus: undefined });
                    }
                    setMatchingDOForPO(null);
                  }}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold cursor-pointer transition"
                >
                  ยกเลิกการผูก PO ของบิลนี้
                </button>
              ) : <div />}
              <button
                type="button"
                onClick={() => setMatchingDOForPO(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reverse Manual Match from DO Row (Zone 4) -> Pick a Destination Weighbridge Ticket */}
      {matchingDOForDest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold text-sm">
                  ⚖️
                </span>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">เลือกตั๋วชั่งน้ำหนักปลายทางมาชนเข้า [โซน 4] ด้วยมือ</h3>
                  <p className="text-[11px] text-slate-500">
                    สำหรับใบส่งของ (DO) ที่ต้องการเลือกตั๋วชั่งปลายทางมาผูก หรือต้องการยกเลิก/เปลี่ยนตั๋วปลายทาง
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMatchingDOForDest(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs space-y-1">
              <div className="font-bold text-teal-950 flex items-center justify-between">
                <span>ใบส่งของต้นทาง (DO): {matchingDOForDest.col6 || matchingDOForDest.col1}</span>
                <span className="font-mono text-teal-800">วันที่: {matchingDOForDest.col7}</span>
              </div>
              <div className="text-[11px] text-teal-900 flex flex-wrap gap-x-4 gap-y-1">
                <span>ทะเบียนรถ: <strong className="font-mono">{matchingDOForDest.col10 || '-'}</strong></span>
                <span>ร้านค้า: <strong>{matchingDOForDest.col8 || '-'}</strong></span>
                <span>สุทธิต้นทาง (15): <strong className="font-mono">{Number(matchingDOForDest.col15).toLocaleString()} กก.</strong></span>
                {matchingDOForDest.col17 && (
                  <span>ตั๋วปลายทางที่ผูกอยู่: <strong className="font-mono">{matchingDOForDest.col17}</strong></span>
                )}
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {allDestTickets.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-xs">
                  ยังไม่มีตั๋วชั่งน้ำหนักปลายทางในระบบ (สามารถสแกนเพิ่มได้จากปุ่มสแกนบิลด้านบน)
                </div>
              ) : (
                allDestTickets.map(ticket => {
                  const ticketRefs = extractDocReferences(ticket.col38);
                  const refList = [ticket.referenceDocNo, ...ticketRefs.doNumbers].filter(Boolean) as string[];
                  const isRefMatch = Boolean(matchingDOForDest.col6 && refList.some(r => isDocNumberMatch(matchingDOForDest.col6, r)));
                  const isPlateMatch = Boolean(
                    matchingDOForDest.col10 &&
                    ticket.col10 &&
                    matchingDOForDest.col10.replace(/[^0-9ก-ฮa-zA-Z]/g, '') === ticket.col10.replace(/[^0-9ก-ฮa-zA-Z]/g, '')
                  );
                  return (
                    <div
                      key={ticket.id}
                      className={`p-3 rounded-xl border transition flex flex-wrap items-center justify-between gap-2 text-xs ${
                        isRefMatch
                          ? 'bg-blue-50/80 border-blue-400 ring-1 ring-blue-300'
                          : isPlateMatch
                          ? 'bg-emerald-50/70 border-emerald-300'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold font-mono text-teal-900">ตั๋ว #{ticket.col17 || ticket.col6 || ticket.col1}</span>
                          <span className="font-mono text-slate-600">วันที่: {ticket.col16 || ticket.col7}</span>
                          {isRefMatch && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-600 text-white">
                              🔗 เลขที่ DO อ้างอิงตรงกัน
                            </span>
                          )}
                          {isPlateMatch && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              💡 ทะเบียนรถตรงกัน
                            </span>
                          )}
                          {ticket.linkedViaDocNo && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                              ผูกอยู่กับ DO: {ticket.linkedViaDocNo}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3">
                          <span>ทะเบียน: <strong className="font-mono">{ticket.col10 || '-'}</strong></span>
                          <span>หนักเข้า: {Number(ticket.col18).toLocaleString()} กก.</span>
                          <span>เบาออก: {Number(ticket.col19).toLocaleString()} กก.</span>
                          <span className="font-bold text-teal-800 font-mono">สุทธิปลายทาง: {Number(ticket.col20).toLocaleString()} กก.</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExecuteManualMatchDOToDest(ticket)}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold text-xs cursor-pointer transition flex items-center gap-1"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>เลือกชนตั๋วนี้</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              {(matchingDOForDest.col17 || Number(matchingDOForDest.col20) > 0) ? (
                <button
                  type="button"
                  onClick={() => {
                    handleUnlinkDestFromDO(matchingDOForDest);
                    setMatchingDOForDest(null);
                  }}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold cursor-pointer transition"
                >
                  ล้างข้อมูลตั๋วปลายทาง (ยกเลิกการชนโซน 4)
                </button>
              ) : <div />}
              <button
                type="button"
                onClick={() => setMatchingDOForDest(null)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Hover Popover: Quick Bill Image & Document Match Verification Preview */}
      {hoveredDocPreview && (
        <div
          className="fixed z-50 pointer-events-none transition-all duration-150"
          style={{
            top: Math.max(12, Math.min(window.innerHeight - 440, hoveredDocPreview.rect.top - 20)),
            left: Math.min(window.innerWidth - 420, hoveredDocPreview.rect.right + 12)
          }}
        >
          <div className="w-[390px] bg-white rounded-2xl shadow-2xl border-2 border-slate-800/15 overflow-hidden text-xs">
            {/* Header */}
            <div className="bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] text-sky-300 font-semibold">{hoveredDocPreview.zoneBadge}</div>
                <div className="font-bold text-sm font-mono truncate">
                  {hoveredDocPreview.docNo}{' '}
                  <span className="text-[11px] font-sans font-normal text-slate-300">
                    (แถว {hoveredDocPreview.trNo})
                  </span>
                </div>
              </div>
              {hoveredDocPreview.matchStatus === 'auto_flagged' && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                  🚩 ชนอัตโนมัติ (รอตรวจ)
                </span>
              )}
              {hoveredDocPreview.matchStatus === 'verified' && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-500 text-white font-bold text-[10px]">
                  ✓ ยืนยันการชนแล้ว
                </span>
              )}
            </div>

            {/* Bill Image Preview */}
            <div className="bg-slate-950 relative flex items-center justify-center h-52 border-b border-slate-200 overflow-hidden">
              {hoveredDocPreview.imageUrl ? (
                <img
                  src={hoveredDocPreview.imageUrl}
                  alt={hoveredDocPreview.docNo}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-center px-4 py-6 text-slate-400 space-y-1">
                  <FileImage className="w-8 h-8 mx-auto text-slate-500 opacity-60" />
                  <div className="font-semibold text-slate-300">ไม่มีไฟล์รูปแนบในเอกสารเลขที่ {hoveredDocPreview.docNo}</div>
                  <div className="text-[10px] text-slate-400">แสดงข้อมูลสรุปจากเอกสารเพื่อใช้ตรวจสอบการชนบิล</div>
                </div>
              )}
              {hoveredDocPreview.referenceNote && (
                <div className="absolute bottom-2 left-2 right-2 bg-slate-900/85 backdrop-blur-xs text-white px-2.5 py-1 rounded-lg text-[10px] font-medium truncate border border-white/15">
                  {hoveredDocPreview.referenceNote}
                </div>
              )}
            </div>

            {/* Side-by-side Match Verification Check */}
            {hoveredDocPreview.compareDetails && hoveredDocPreview.compareDetails.length > 0 && (
              <div className="bg-blue-50/70 px-3.5 py-2 border-b border-blue-100 space-y-1">
                <div className="text-[10px] font-bold text-blue-900 uppercase tracking-wide">
                  🔍 ตรวจสอบความถูกต้องของการชนบิล
                </div>
                {hoveredDocPreview.compareDetails.map((cmp, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px] gap-2">
                    <span className="text-slate-500 shrink-0">{cmp.label}:</span>
                    <div className="font-mono font-semibold text-slate-800 truncate text-right">
                      <span>{cmp.originVal}</span>
                      <span className="mx-1 text-slate-400">↔</span>
                      <span className={cmp.isMatch ? 'text-emerald-700' : 'text-amber-700'}>{cmp.destVal}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Key Data Fields */}
            <div className="p-3 space-y-1 bg-white">
              {hoveredDocPreview.details.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500">{item.label}:</span>
                  <span
                    className={`font-mono text-right truncate max-w-[220px] ${
                      item.alert
                        ? 'font-bold text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded'
                        : item.highlight
                        ? 'font-bold text-slate-900 bg-slate-100 px-1.5 py-0.2 rounded'
                        : 'text-slate-700'
                    }`}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
