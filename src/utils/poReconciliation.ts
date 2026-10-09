import { OrderRecord, PurchaseOrder, POReconciliation, POStatus, ConvertedOrderUnitDetail, MatchedDeliveryShipment } from '../types';

export function isMatchedOriginWeighbridge(order: OrderRecord): boolean {
  return order.docType === 'weighbridge' && Boolean(order.matchedOriginDoId);
}

export function isDeliveryOrderPairingCandidate(order: Pick<OrderRecord, 'docType' | 'col6'>): boolean {
  if (!order.col6?.trim()) return false;
  return !['weighbridge', 'dest_weighbridge', 'tax_invoice', 'purchase_order'].includes(order.docType || '');
}

export function resolveOriginWeighbridgePairs(orders: OrderRecord[]): Map<string, OrderRecord[]> {
  const deliveryOrders = orders.filter(isDeliveryOrderPairingCandidate);
  const deliveryOrderIds = new Set(deliveryOrders.map(order => order.id));
  const pairsByDoId = new Map<string, OrderRecord[]>();
  const resolvedTicketIds = new Set<string>();
  const ambiguousReferenceTicketIds = new Set<string>();

  orders.forEach(ticket => {
    if (ticket.docType !== 'weighbridge' || !ticket.matchedOriginDoId) return;
    resolvedTicketIds.add(ticket.id);
    if (!deliveryOrderIds.has(ticket.matchedOriginDoId)) return;
    const tickets = pairsByDoId.get(ticket.matchedOriginDoId) || [];
    tickets.push(ticket);
    pairsByDoId.set(ticket.matchedOriginDoId, tickets);
  });

  const legacyTicketsByDoId = new Map<string, OrderRecord[]>();
  orders.forEach(ticket => {
    if (ticket.docType !== 'weighbridge' || resolvedTicketIds.has(ticket.id)) return;
    if (ticket.linkedViaDocNo?.trim()) {
      const matchingDOs = deliveryOrders.filter(order =>
        isExactDocNumberReference(order.col6, ticket.linkedViaDocNo)
      );
      if (matchingDOs.length > 1) {
        ambiguousReferenceTicketIds.add(ticket.id);
        return;
      }
      if (matchingDOs.length === 1) {
        const doId = matchingDOs[0].id;
        const tickets = legacyTicketsByDoId.get(doId) || [];
        tickets.push(ticket);
        legacyTicketsByDoId.set(doId, tickets);
        resolvedTicketIds.add(ticket.id);
        return;
      }
    }
  });

  legacyTicketsByDoId.forEach((tickets, doId) => {
    if (tickets.length !== 1 || pairsByDoId.has(doId)) return;
    pairsByDoId.set(doId, tickets);
  });

  const deliveryOrdersByTr = new Map<string, OrderRecord[]>();
  deliveryOrders.forEach(order => {
    const trNumber = order.col1.trim();
    if (!trNumber) return;
    const sameTrOrders = deliveryOrdersByTr.get(trNumber) || [];
    sameTrOrders.push(order);
    deliveryOrdersByTr.set(trNumber, sameTrOrders);
  });
  const unmatchedTicketsByTr = new Map<string, OrderRecord[]>();
  orders.forEach(ticket => {
    if (
      ticket.docType !== 'weighbridge' ||
      resolvedTicketIds.has(ticket.id) ||
      ambiguousReferenceTicketIds.has(ticket.id)
    ) {
      return;
    }
    const trNumber = ticket.col1.trim();
    if (!trNumber) return;
    const sameTrTickets = unmatchedTicketsByTr.get(trNumber) || [];
    sameTrTickets.push(ticket);
    unmatchedTicketsByTr.set(trNumber, sameTrTickets);
  });

  unmatchedTicketsByTr.forEach((tickets, trNumber) => {
    const matchingDOs = deliveryOrdersByTr.get(trNumber) || [];
    if (matchingDOs.length !== 1 || tickets.length !== 1) return;
    const doId = matchingDOs[0].id;
    if (pairsByDoId.has(doId)) return;
    pairsByDoId.set(doId, tickets);
    resolvedTicketIds.add(tickets[0].id);
  });

  return pairsByDoId;
}

export function getOccupiedOriginWeighbridgeDoIds(orders: OrderRecord[]): Set<string> {
  const deliveryOrders = orders.filter(isDeliveryOrderPairingCandidate);
  const deliveryOrderIds = new Set(deliveryOrders.map(order => order.id));
  const occupiedDoIds = new Set(resolveOriginWeighbridgePairs(orders).keys());

  orders.forEach(ticket => {
    if (ticket.docType !== 'weighbridge') return;
    if (ticket.matchedOriginDoId && deliveryOrderIds.has(ticket.matchedOriginDoId)) return;

    if (ticket.linkedViaDocNo?.trim()) {
      const referencedDOs = deliveryOrders.filter(order =>
        isExactDocNumberReference(order.col6, ticket.linkedViaDocNo)
      );
      if (referencedDOs.length > 0) {
        referencedDOs.forEach(order => occupiedDoIds.add(order.id));
        return;
      }
    }

    const trNumber = ticket.col1.trim();
    if (!trNumber) return;
    const matchingDOs = deliveryOrders.filter(order => order.col1.trim() === trNumber);
    matchingDOs.forEach(order => occupiedDoIds.add(order.id));
  });

  return occupiedDoIds;
}

export function getOriginWeighbridgeMismatchWarning(
  doNumber: string,
  ticketNumber: string,
  doWeights: Pick<Partial<OrderRecord>, 'col13' | 'col14' | 'col15'>,
  ticketWeights: Pick<Partial<OrderRecord>, 'col13' | 'col14' | 'col15'>
): string | undefined {
  const fields = [
    { key: 'col13', label: 'หนักต้นทาง' },
    { key: 'col14', label: 'เบาต้นทาง' },
    { key: 'col15', label: 'สุทธิต้นทาง' }
  ] as const;
  const differences = fields.flatMap(({ key, label }) => {
    const doValue = Number(doWeights[key]) || 0;
    const ticketValue = Number(ticketWeights[key]) || 0;
    return doValue > 0 && ticketValue > 0 && doValue !== ticketValue
      ? [`${label}: DO ${doValue.toLocaleString()} / ตั๋ว ${ticketValue.toLocaleString()} กก.`]
      : [];
  });
  if (!differences.length) return undefined;
  return `⚠️ น้ำหนักตั๋วชั่งต้นทางไม่ตรงกับ DO ${doNumber} (ตั๋ว ${ticketNumber}): ${differences.join(', ')} — ใช้ค่าน้ำหนักจากตั๋วในโซน 3`;
}

/**
 * Normalizes document reference numbers by stripping whitespace, dashes, slashes,
 * and converting to uppercase for deterministic matching without guessing.
 */
export function normalizeDocNumber(docNo?: string | null): string {
  if (!docNo) return '';
  return docNo.toString().replace(/[\s\-_/]/g, '').toUpperCase();
}

/**
 * Strips common prefixes (DO, PO, TR, RR, INV, TAX) for robust prefix-tolerant matching
 * (e.g. DO-8891 and 8891 represent the same real-world delivery document)
 */
export function stripDocPrefix(docNo?: string | null): string {
  if (!docNo) return '';
  return normalizeDocNumber(docNo).replace(/^(?:DO|PO|TR|RR|INV|TAX)/i, '');
}

/**
 * Strips leading zeros from numeric strings (e.g. "0045" -> "45") while keeping at least 1 digit
 */
function stripLeadingZeros(val: string): string {
  return val.replace(/^0+(?=\d)/, '');
}

/**
 * Parses a raw document string into its book part (เล่มที่ - before "/") and document number part (เลขที่ - after "/")
 * when formatted with "/" (e.g. "02/0045" or "DO-02/0045")
 */
function parseDocAndBookParts(docNo?: string | null): {
  hasSlash: boolean;
  bookPart: string;
  docNoPart: string;
} {
  if (!docNo) return { hasSlash: false, bookPart: '', docNoPart: '' };
  const raw = docNo.toString().trim();
  if (raw.includes('/')) {
    const parts = raw.split('/');
    if (parts.length === 2) {
      const left = stripDocPrefix(parts[0]);
      const right = stripDocPrefix(parts[1]);
      if (left && right) {
        return { hasSlash: true, bookPart: left, docNoPart: right };
      }
    }
  }
  return { hasSlash: false, bookPart: '', docNoPart: stripDocPrefix(raw) };
}

/**
 * Checks if two document numbers match, supporting:
 * 1. Exact & prefix-tolerant equality (e.g. "PO-02/0045" === "02/0045")
 * 2. Both have "เล่มที่/เลขที่" (or swapped "เลขที่/เล่มที่"):
 *    - Matches if both parts match (e.g. "02/0045" <-> "02/0045" or "0045/02")
 *    - Strictly rejects if same เลขที่ but DIFFERENT เล่มที่ (e.g. "01/0045" !== "02/0045")
 * 3. One has "เล่มที่/เลขที่" (e.g. "02/0045") and the other only wrote "เลขที่" (e.g. "0045" or "PO-0045"):
 *    - Matches against the primary "เลขที่" part after "/" (never matches against the short book number)
 */
export function isDocNumberMatch(docA?: string | null, docB?: string | null): boolean {
  const normA = normalizeDocNumber(docA);
  const normB = normalizeDocNumber(docB);
  if (!normA || !normB) return false;

  const parsedA = parseDocAndBookParts(docA);
  const parsedB = parseDocAndBookParts(docB);

  // Case 1: Both documents explicitly contain "/" (both specify เล่มที่ and เลขที่)
  if (parsedA.hasSlash && parsedB.hasSlash) {
    const aBook = stripLeadingZeros(parsedA.bookPart);
    const aDoc = stripLeadingZeros(parsedA.docNoPart);
    const bBook = stripLeadingZeros(parsedB.bookPart);
    const bDoc = stripLeadingZeros(parsedB.docNoPart);

    // Direct match: เล่มที่/เลขที่ === เล่มที่/เลขที่
    if (aBook === bBook && aDoc === bDoc) return true;
    // Swapped order match: เล่มที่/เลขที่ === เลขที่/เล่มที่
    if (aBook === bDoc && aDoc === bBook && aBook !== aDoc) return true;
    // Same เลขที่ but different เล่มที่ (e.g. 01/0045 vs 02/0045) -> MUST NOT MATCH!
    return false;
  }

  // Case 2: Only one document has "/" (e.g. stored as "02/0045" เล่มที่/เลขที่, while reference only wrote "0045")
  if (parsedA.hasSlash !== parsedB.hasSlash) {
    const withSlash = parsedA.hasSlash ? parsedA : parsedB;
    const single = parsedA.hasSlash ? parsedB : parsedA;

    if (single.docNoPart.length >= 2) {
      // Exact match against combined (in case single omitted the slash e.g. "020045")
      const strippedA = stripDocPrefix(normA);
      const strippedB = stripDocPrefix(normB);
      if (strippedA === strippedB) return true;

      // Primary match: compare single reference number against "เลขที่" (docNoPart, after "/")
      if (single.docNoPart === withSlash.docNoPart) return true;
      const singleNoZero = stripLeadingZeros(single.docNoPart);
      const docNoZero = stripLeadingZeros(withSlash.docNoPart);
      if (singleNoZero.length >= 2 && singleNoZero === docNoZero) return true;

      // Fallback for legacy records formatted as "เลขที่/เล่มที่" where left part is clearly the longer running number (>= 3 chars)
      if (withSlash.bookPart.length >= 3 && withSlash.bookPart.length > withSlash.docNoPart.length) {
        if (single.docNoPart === withSlash.bookPart) return true;
        const leftNoZero = stripLeadingZeros(withSlash.bookPart);
        if (singleNoZero.length >= 2 && singleNoZero === leftNoZero) return true;
      }
    }
    return false;
  }

  // Case 3: Neither document has "/"
  if (normA === normB) return true;
  const strippedA = stripDocPrefix(normA);
  const strippedB = stripDocPrefix(normB);
  if (strippedA.length >= 2 && strippedB.length >= 2) {
    if (strippedA === strippedB) return true;
    const noZeroA = stripLeadingZeros(strippedA);
    const noZeroB = stripLeadingZeros(strippedB);
    if (noZeroA.length >= 2 && noZeroA === noZeroB) return true;
  }
  return false;
}

/**
 * Matches complete document references only. Prefix and whitespace differences
 * are tolerated; separators, book numbers, and leading zeroes remain significant.
 */
export function isExactDocNumberReference(docA?: string | null, docB?: string | null): boolean {
  const normalize = (value?: string | null) => {
    if (!value) return { prefix: '', reference: '' };
    const prefixMatch = value.trim().toUpperCase().match(/^(P\.?O\.?|D\.?O\.?|T\.?R\.?|R\.?R\.?|I\.?N\.?V\.?|TAX)\s*(?:NO\.?)?\s*[-:#]?\s*/i);
    return {
      prefix: prefixMatch?.[1].replace(/\./g, '') || '',
      reference: value
        .trim()
        .toUpperCase()
        .replace(/^(?:P\.?O\.?|D\.?O\.?|T\.?R\.?|R\.?R\.?|I\.?N\.?V\.?|TAX)\s*(?:NO\.?)?\s*[-:#]?\s*/i, '')
        .replace(/\s+/g, '')
    };
  };
  const normalizedA = normalize(docA);
  const normalizedB = normalize(docB);
  return Boolean(
    normalizedA.reference &&
    normalizedB.reference &&
    normalizedA.reference === normalizedB.reference &&
    (!normalizedA.prefix || !normalizedB.prefix || normalizedA.prefix === normalizedB.prefix)
  );
}

/**
 * Normalizes unit strings to canonical forms for accurate reconciliation
 */
export function normalizeUnit(unit?: string | null): string {
  if (!unit) return '';
  const u = unit.toString().trim().toLowerCase();
  if (['ตัน', 'ton', 'tons', 't'].includes(u)) return 'ตัน';
  if (['กก.', 'กก', 'กิโลกรัม', 'kg', 'kgs', 'kilogram'].includes(u)) return 'กก.';
  if (['คิว', 'ลบ.ม.', 'm3', 'cu.m.', 'คิวบิกเมตร'].includes(u)) return 'คิว';
  if (['เส้น', 'bar', 'bars'].includes(u)) return 'เส้น';
  if (['ถุง', 'bag', 'bags'].includes(u)) return 'ถุง';
  if (['แผ่น', 'sheet', 'sheets'].includes(u)) return 'แผ่น';
  if (['กล่อง', 'box', 'boxes'].includes(u)) return 'กล่อง';
  if (['ชิ้น', 'piece', 'pcs', 'ea'].includes(u)) return 'ชิ้น';
  if (['ม้วน', 'roll', 'rolls'].includes(u)) return 'ม้วน';
  if (['ถัง', 'drum', 'bucket'].includes(u)) return 'ถัง';
  if (['ชุด', 'set', 'sets'].includes(u)) return 'ชุด';
  if (['ท่อน'].includes(u)) return 'ท่อน';
  if (['เที่ยว', 'trip'].includes(u)) return 'เที่ยว';
  return unit.trim();
}

/**
 * Extracts potential PO and DO numbers from unstructured text (e.g. remarks, notes, handwritten text)
 * Recognizes prefixes such as: PO, DO, P.O., D/O, ใบสั่งซื้อ, ใบส่งของ, บิลส่งของ, บิลเลขที่, อ้างอิง, Ref, ตาม PO, ตาม DO
 */
export function extractDocReferences(text?: string | null): { poNumbers: string[]; doNumbers: string[] } {
  if (!text) return { poNumbers: [], doNumbers: [] };

  const poNumbers: string[] = [];
  const doNumbers: string[] = [];

  // Match PO patterns: PO-2024-001, PO: 24-001, ใบสั่งซื้อ 0045/02, P.O. 9981, Ref PO: 123, อ้างอิง PO: 456, สัญญา 789
  const poRegex = /(?:PO|ใบสั่งซื้อ|สั่งซื้อ|P[/.]?O[.]?|Ref(?:\s*PO)?|อ้างอิง(?:\s*PO)?|ตาม(?:\s*PO)?|สัญญา)\s*[:#№.\s-]*([A-Za-z0-9\-_/]+)/gi;
  let poMatch: RegExpExecArray | null;
  while ((poMatch = poRegex.exec(text)) !== null) {
    if (poMatch[1] && poMatch[1].length >= 2) {
      // Preserve "/" so isDocNumberMatch can distinguish เลขที่/เล่มที่
      poNumbers.push(poMatch[1].trim().toUpperCase());
    }
  }

  // Match DO patterns: DO-8891, DO: 0125/03, ใบส่งของ 4401, บิลส่งของ 9021, D/O 551, Ref DO: 889, อ้างอิง DO: 77, บิลเลขที่ 402
  const doRegex = /(?:DO|ใบส่งของ|บิลส่งของ|D[/.]?O[.]?|บิลเลขที่|บิล|Ref(?:\s*DO)?|อ้างอิง(?:\s*DO)?|ส่งตาม(?:\s*DO)?)\s*[:#№.\s-]*([A-Za-z0-9\-_/]+)/gi;
  let doMatch: RegExpExecArray | null;
  while ((doMatch = doRegex.exec(text)) !== null) {
    if (doMatch[1] && doMatch[1].length >= 2) {
      // Preserve "/" so isDocNumberMatch can distinguish เลขที่/เล่มที่
      doNumbers.push(doMatch[1].trim().toUpperCase());
    }
  }

  return { poNumbers, doNumbers };
}

/**
 * Reconciles a Purchase Order against inbound tickets/bills (OrderRecord)
 * 3-Way Matching Logic:
 * 1. Direct PO Matching (DO or Weighbridge has col4, referenceDocNo, or remarks pointing to PO)
 * 2. Transitive DO Matching (Weighbridge ticket references DO, and that DO references this PO)
 * 3. Paired Shipment Grouping (Pairs DO + Weighbridge to eliminate double counting of delivered quantities)
 * 4. Automatic unit conversion (kg <-> ton)
 */
export function reconcilePO(po: PurchaseOrder, orders: OrderRecord[]): POReconciliation {
  const normalizedPoNum = normalizeDocNumber(po.poNumber);
  const rawPrimaryPOUnit = po.items?.[0]?.unit || 'ชิ้น';
  const primaryPOUnit = normalizeUnit(rawPrimaryPOUnit);
  
  if (!normalizedPoNum) {
    return {
      po,
      linkedOrders: [],
      pairedShipments: [],
      deliveredQty: 0,
      deliveredAmount: 0,
      remainingQty: po.totalQty,
      remainingAmount: po.totalAmount,
      percentageDelivered: 0,
      isOverDelivered: false,
      status: po.status || 'pending',
      primaryUnit: rawPrimaryPOUnit,
      hasUnitMismatch: false,
      unitMismatchWarnings: [],
      unitConversions: {},
      linkedMatchTypes: {}
    };
  }

  const linkedMatchTypes: Record<string, { type: 'direct_po' | 'via_do' | 'manual'; refDoc?: string; source?: string }> = {};

  // Step 1: Find all orders that directly reference this PO
  // (via col4 form field, referenceDocNo, or handwritten/notes in col38)
  const directLinkedOrders: OrderRecord[] = [];
  const knownDONumbers = new Map<string, OrderRecord>(); // normalized DO number -> DO order

  orders.forEach(ord => {
    const col4Val = ord.col4;
    const refVal = ord.referenceDocNo;
    const textRefs = extractDocReferences(ord.col38);

    const matchesDirectPO = 
      isExactDocNumberReference(col4Val, po.poNumber) ||
      isExactDocNumberReference(refVal, po.poNumber) ||
      textRefs.poNumbers.some(p => isExactDocNumberReference(p, po.poNumber));

    if (matchesDirectPO) {
      directLinkedOrders.push(ord);

      let source = ord.referenceSource || 'form_field';
      if (!isExactDocNumberReference(col4Val, po.poNumber) && isExactDocNumberReference(refVal, po.poNumber)) {
        source = ord.referenceSource || 'handwritten';
      } else if (!isExactDocNumberReference(col4Val, po.poNumber) && !isExactDocNumberReference(refVal, po.poNumber) && textRefs.poNumbers.some(p => isExactDocNumberReference(p, po.poNumber))) {
        source = 'notes';
      }

      linkedMatchTypes[ord.id] = {
        type: 'direct_po',
        refDoc: po.poNumber,
        source
      };

      // If this direct order is a Delivery Order (DO), record its DO number
      const doNum = normalizeDocNumber(ord.col6);
      if (doNum) {
        knownDONumbers.set(doNum, ord);
      }
    }
  });

  // Step 2: Find orders (especially Weighbridge tickets) that reference any of the DOs linked to this PO
  // (Transitive: Weighbridge Ticket -> DO -> PO)
  const transitiveOrders: OrderRecord[] = [];

  if (knownDONumbers.size > 0) {
    orders.forEach(ord => {
      // Skip if already directly linked
      if (directLinkedOrders.some(d => d.id === ord.id)) return;

      const refVal = ord.referenceDocNo;
      const col6Val = ord.col6;
      const linkedViaVal = ord.linkedViaDocNo;
      const textRefs = extractDocReferences(ord.col38);

      let matchedDOOrder: OrderRecord | undefined;
      let matchedDONum = '';

      for (const [doNum, doOrd] of knownDONumbers.entries()) {
        const directDONum = doOrd.col6;
        if (
          isExactDocNumberReference(refVal, directDONum) ||
          isExactDocNumberReference(col6Val, directDONum) ||
          isExactDocNumberReference(linkedViaVal, directDONum) ||
          textRefs.doNumbers.some(d => isExactDocNumberReference(d, directDONum))
        ) {
          matchedDOOrder = doOrd;
          matchedDONum = directDONum;
          break;
        }
      }

      if (matchedDOOrder) {
        // Tag with transitive reference
        ord.linkedViaDocNo = matchedDONum;
        transitiveOrders.push(ord);

        linkedMatchTypes[ord.id] = {
          type: 'via_do',
          refDoc: matchedDONum,
          source: ord.referenceSource || 'form_field'
        };
      }
    });
  }

  // Combined linked orders (distinct)
  const allLinkedOrders = [...directLinkedOrders, ...transitiveOrders];

  // Check if there are physical delivery documents (DO / Origin Weighbridge / Concrete) linked to this PO
  const hasPhysicalDeliveries = allLinkedOrders.some(
    o => o.docType !== 'tax_invoice' && o.docType !== 'dest_weighbridge'
  );

  // Step 3: Build Paired Shipments to prevent double counting
  // Pairs DO with its matching Weighbridge ticket(s)
  const pairedShipments: MatchedDeliveryShipment[] = [];
  const processedOrderIds = new Set<string>();

  // Pre-exclude secondary tickets that should not count as separate physical shipments:
  // 1) Tax invoices when physical delivery bills already exist for this PO (or when the tax invoice is already merged into a DO)
  // 2) Destination weighbridge tickets that were already merged into a DO (where that DO is already in allLinkedOrders)
  allLinkedOrders.forEach(ord => {
    if (ord.docType === 'tax_invoice' && (ord.linkedViaDocNo || hasPhysicalDeliveries)) {
      processedOrderIds.add(ord.id);
    }
  });

  // Process DO orders and find their matching weighbridge tickets
  allLinkedOrders.forEach(ord => {
    if (processedOrderIds.has(ord.id)) return;

    const isDO = ord.docType === 'delivery_order' || ord.docType === 'concrete' || (!ord.docType && Number(ord.col13) === 0);
    const doNum = normalizeDocNumber(ord.col6);
    const directDONum = ord.col6;

    if (isDO && doNum) {
      // Look for ALL weighbridge tickets referencing this DO (1-to-N Split Shipments or paired Dest Weighbridge)
      const matchingWBs = allLinkedOrders.filter(o => 
        !processedOrderIds.has(o.id) &&
        o.id !== ord.id &&
        (o.docType === 'weighbridge' || o.docType === 'dest_weighbridge' || Number(o.col13) > 0 || Number(o.col15) > 0 || Number(o.col18) > 0 || Number(o.col20) > 0) &&
        (o.docType === 'weighbridge' && o.matchedOriginDoId !== undefined
          ? o.matchedOriginDoId === ord.id
          : (
              isExactDocNumberReference(o.referenceDocNo, directDONum) ||
              isExactDocNumberReference(o.linkedViaDocNo, directDONum) ||
              isExactDocNumberReference(o.col6, directDONum) ||
              extractDocReferences(o.col38).doNumbers.some(d => isExactDocNumberReference(d, directDONum))
            ))
      );

      if (matchingWBs.length > 0) {
        // PAIRED SHIPMENT: DO paired with 1 or multiple Weighbridge tickets
        processedOrderIds.add(ord.id);
        matchingWBs.forEach(wb => processedOrderIds.add(wb.id));

        const totalWbNetKg = matchingWBs.reduce((sum, wb) => sum + (Number(wb.col15) || Number(wb.col20) || 0), 0);
        const doQty = Number(ord.col22) || 0;
        const effectiveUnit = primaryPOUnit || ord.col23 || 'ตัน';
        
        // Effective quantity: prefer certified weighbridge net weight if ton/kg, otherwise DO qty
        let effectiveQty = doQty;
        if (effectiveUnit === 'ตัน' && totalWbNetKg > 0 && doQty === 0) {
          effectiveQty = Number((totalWbNetKg / 1000).toFixed(3));
        } else if (effectiveUnit === 'ตัน' && totalWbNetKg > 0 && matchingWBs.some(w => w.docType !== 'dest_weighbridge')) {
          effectiveQty = Number((totalWbNetKg / 1000).toFixed(3));
        } else if (effectiveUnit === 'กก.' && totalWbNetKg > 0) {
          effectiveQty = totalWbNetKg;
        } else if (effectiveQty === 0 && totalWbNetKg > 0) {
          effectiveQty = Number((totalWbNetKg / 1000).toFixed(3));
        }

        const wbSumAmount = matchingWBs.reduce((sum, wb) => sum + (Number(wb.col29) || Number(wb.col25) || 0), 0);
        let effectiveAmount = Number(ord.col29) || Number(ord.col25) || wbSumAmount || 0;
        
        // If neither DO nor WB has price on physical slip, derive from PO unit price (Bridge to RR)
        if (effectiveAmount === 0 && effectiveQty > 0 && po.items && po.items.length > 0) {
          const matchedItem = po.items.find(i => 
            (ord.col11 && i.itemDescription.toLowerCase().includes(ord.col11.toLowerCase())) ||
            (ord.col12 && i.specCode && i.specCode.toLowerCase().includes(ord.col12.toLowerCase()))
          ) || po.items[0];
          if (matchedItem && matchedItem.unitPrice > 0) {
            effectiveAmount = Number((effectiveQty * matchedItem.unitPrice).toFixed(2));
          }
        }

        const wbLabels = matchingWBs.map(wb => wb.col17 || wb.col6 || wb.col1 || 'ตั๋วชั่ง').join(', ');

        pairedShipments.push({
          id: `shipment-${ord.id}-${matchingWBs[0].id}`,
          doOrder: ord,
          weighbridgeOrder: matchingWBs[0],
          weighbridgeOrders: matchingWBs,
          effectiveQty,
          effectiveUnit,
          effectiveAmount,
          matchType: 'paired_do_wb',
          referenceDocNo: ord.col6,
          linkedViaDocNo: wbLabels,
          referenceSource: matchingWBs[0].referenceSource || ord.referenceSource || 'form_field'
        });
        return;
      }
    }
  });

  // Process remaining unpaired orders
  allLinkedOrders.forEach(ord => {
    if (processedOrderIds.has(ord.id)) return;
    // Skip dest_weighbridge if it was already merged into a DO
    if (ord.docType === 'dest_weighbridge' && ord.linkedViaDocNo && hasPhysicalDeliveries) {
      processedOrderIds.add(ord.id);
      return;
    }
    processedOrderIds.add(ord.id);

    const isWB = ord.docType === 'weighbridge' || ord.docType === 'dest_weighbridge' || Number(ord.col13) > 0 || Number(ord.col15) > 0 || Number(ord.col18) > 0 || Number(ord.col20) > 0;
    const netWeightKg = Number(ord.col15) || Number(ord.col20) || 0;
    const rawQty = Number(ord.col22) || 0;
    const effectiveUnit = primaryPOUnit || ord.col23 || (isWB ? 'ตัน' : 'ชิ้น');

    let effectiveQty = rawQty;
    if (effectiveUnit === 'ตัน') {
      if (rawQty === 0 && netWeightKg > 0) {
        effectiveQty = Number((netWeightKg / 1000).toFixed(3));
      } else if (ord.col23 === 'กก.' || (!ord.col23 && rawQty > 1000)) {
        effectiveQty = Number((rawQty / 1000).toFixed(3));
      }
    } else if (effectiveUnit === 'กก.') {
      if (rawQty === 0 && netWeightKg > 0) {
        effectiveQty = netWeightKg;
      }
    } else if (effectiveQty === 0 && netWeightKg > 0) {
      effectiveQty = Number((netWeightKg / 1000).toFixed(3));
    }

    let effectiveAmount = Number(ord.col29) || Number(ord.col25) || 0;
    
    // If ticket has no price on physical slip, derive from PO unit price (Bridge to RR)
    if (effectiveAmount === 0 && effectiveQty > 0 && po.items && po.items.length > 0) {
      const matchedItem = po.items.find(i => 
        (ord.col11 && i.itemDescription.toLowerCase().includes(ord.col11.toLowerCase())) ||
        (ord.col12 && i.specCode && i.specCode.toLowerCase().includes(ord.col12.toLowerCase()))
      ) || po.items[0];
      if (matchedItem && matchedItem.unitPrice > 0) {
        effectiveAmount = Number((effectiveQty * matchedItem.unitPrice).toFixed(2));
      }
    }

    pairedShipments.push({
      id: `shipment-${ord.id}`,
      doOrder: !isWB ? ord : undefined,
      weighbridgeOrder: isWB ? ord : undefined,
      weighbridgeOrders: isWB ? [ord] : undefined,
      effectiveQty,
      effectiveUnit,
      effectiveAmount,
      matchType: isWB ? 'weighbridge_only' : 'do_only',
      referenceDocNo: ord.referenceDocNo || ord.col6,
      linkedViaDocNo: ord.linkedViaDocNo,
      referenceSource: ord.referenceSource || (ord.col4 ? 'form_field' : 'notes')
    });
  });

  // Calculate total delivered quantity and delivered amount
  let deliveredQty = 0;
  let deliveredAmount = 0;
  let hasUnitMismatch = false;
  const unitMismatchWarnings: string[] = [];
  const unitConversions: Record<string, ConvertedOrderUnitDetail> = {};

  pairedShipments.forEach(ship => {
    deliveredQty += ship.effectiveQty;
    deliveredAmount += ship.effectiveAmount;

    // Track conversion & mismatch for auditing
    const activeOrder = ship.doOrder || ship.weighbridgeOrder;
    if (activeOrder) {
      const orderUnit = normalizeUnit(ship.effectiveUnit);
      if (orderUnit && primaryPOUnit && orderUnit !== primaryPOUnit) {
        hasUnitMismatch = true;
        unitMismatchWarnings.push(
          `ตั๋ว ${activeOrder.col1 || activeOrder.col6}: ระบุหน่วย '${ship.effectiveUnit}' ไม่ตรงกับ PO ที่สั่งเป็น '${rawPrimaryPOUnit}'`
        );
      }
      const pairNote = ship.matchType === 'paired_do_wb' 
        ? (ship.weighbridgeOrders && ship.weighbridgeOrders.length > 1
            ? `จับคู่ DO [${ship.doOrder?.col6 || '-'}] ↔ ตั๋วชั่ง ${ship.weighbridgeOrders.length} เที่ยว [${ship.weighbridgeOrders.map(w => w.col6 || w.col1).join(', ')}]`
            : `จับคู่ DO [${ship.doOrder?.col6 || '-'}] ↔ ตั๋วชั่ง [${ship.weighbridgeOrder?.col6 || '-'}]`)
        : `ส่งมอบเดี่ยว (${ship.effectiveQty} ${ship.effectiveUnit})`;

      unitConversions[activeOrder.id] = {
        originalQty: Number(activeOrder.col22) || Number(activeOrder.col15) || 0,
        originalUnit: activeOrder.col23 || (activeOrder.col15 ? 'กก.' : rawPrimaryPOUnit),
        convertedQty: ship.effectiveQty,
        targetUnit: ship.effectiveUnit,
        note: pairNote
      };
    }
  });

  // Item-level reconciliation for multi-item POs
  const isMultiItem = Boolean(po.items && po.items.length > 1);
  const itemReconciliations = (po.items || []).map(poItem => {
    const normItemName = (poItem.itemDescription || '').trim().toLowerCase();
    const normItemCode = (poItem.specCode || '').trim().toLowerCase();
    const itemTargetUnit = normalizeUnit(poItem.unit);

    let itemDeliveredQty = 0;
    let itemDeliveredAmt = 0;
    let matchCount = 0;

    if (!isMultiItem) {
      // Single-item PO: all delivered shipments belong to this item
      itemDeliveredQty = deliveredQty;
      itemDeliveredAmt = deliveredAmount;
      matchCount = pairedShipments.length;
    } else {
      // Multi-item PO: match shipments/orders specifically to this item
      pairedShipments.forEach(ship => {
        const orderToCheck = ship.doOrder || ship.weighbridgeOrder;
        if (!orderToCheck) return;

        let isMatch = false;
        let matchedQty = 0;
        let matchedAmt = 0;

        // Check if order has breakdown lineItems
        if (orderToCheck.lineItems && orderToCheck.lineItems.length > 0) {
          const matchingLines = orderToCheck.lineItems.filter(line => {
            const desc = (line.itemDescription || '').trim().toLowerCase();
            const spec = (line.specCode || '').trim().toLowerCase();
            return (normItemName && (desc.includes(normItemName) || normItemName.includes(desc))) ||
                   (normItemCode && spec && normItemCode === spec);
          });

          if (matchingLines.length > 0) {
            isMatch = true;
            matchingLines.forEach(l => {
              matchedQty += Number(l.qty) || 0;
              matchedAmt += Number(l.totalAmount) || ((Number(l.qty) || 0) * (Number(l.unitPrice) || poItem.unitPrice || 0));
            });
          }
        }

        // If no line items matched, check header-level col11 and col12
        if (!isMatch) {
          const col11Desc = (orderToCheck.col11 || '').trim().toLowerCase();
          const col12Spec = (orderToCheck.col12 || '').trim().toLowerCase();
          if (
            (normItemName && (col11Desc.includes(normItemName) || normItemName.includes(col11Desc))) ||
            (normItemCode && col12Spec && normItemCode === col12Spec)
          ) {
            isMatch = true;
            matchedQty = ship.effectiveQty;
            matchedAmt = ship.effectiveAmount || (ship.effectiveQty * poItem.unitPrice);
          }
        }

        if (isMatch) {
          matchCount++;
          // Convert unit if necessary (e.g. kg to ton)
          if (itemTargetUnit === 'ตัน' && ship.effectiveUnit === 'กก.') {
            itemDeliveredQty += Number((matchedQty / 1000).toFixed(3));
          } else {
            itemDeliveredQty += matchedQty;
          }
          itemDeliveredAmt += matchedAmt;
        }
      });
    }

    const itemOrderedQty = Number(poItem.orderedQty) || 0;
    const itemPercentage = itemOrderedQty > 0
      ? Math.min(100, Math.round((itemDeliveredQty / itemOrderedQty) * 100))
      : 0;
    const itemRemainingQty = Math.max(0, Number((poItem.orderedQty - itemDeliveredQty).toFixed(2)));
    const itemRemainingAmt = Math.max(0, (poItem.totalAmount || (poItem.orderedQty * poItem.unitPrice)) - itemDeliveredAmt);

    let itemStatus: POStatus = 'pending';
    if (itemOrderedQty > 0 && itemDeliveredQty >= itemOrderedQty) {
      itemStatus = 'completed';
    } else if (itemDeliveredQty > 0) {
      itemStatus = 'partially_delivered';
    }

    return {
      item: poItem,
      deliveredQty: Number(itemDeliveredQty.toFixed(2)),
      deliveredAmount: itemDeliveredAmt,
      remainingQty: itemRemainingQty,
      remainingAmount: itemRemainingAmt,
      percentageDelivered: itemPercentage,
      status: itemStatus,
      matchedOrdersCount: matchCount
    };
  });

  const totalOrderedQty = Number(po.totalQty) || 0;
  const quantityPercentageDelivered = totalOrderedQty > 0
    ? Math.min(100, Math.round((deliveredQty / totalOrderedQty) * 100))
    : 0;
  const financialPercentageDelivered = po.totalAmount > 0 
    ? Math.min(100, Math.round((deliveredAmount / po.totalAmount) * 100))
    : quantityPercentageDelivered;

  // For multi-item POs, financial percentage is the true aggregate progress
  const percentageDelivered = isMultiItem ? financialPercentageDelivered : quantityPercentageDelivered;

  const remainingQty = Math.max(0, po.totalQty - deliveredQty);
  const remainingAmount = Math.max(0, po.totalAmount - deliveredAmount);
  const isOverDelivered =
    (po.totalAmount > 0 && deliveredAmount > po.totalAmount) ||
    (!isMultiItem && po.totalQty > 0 && deliveredQty > po.totalQty);

  // Derive status
  let status: POStatus = po.status;
  if (po.status !== 'cancelled') {
    if (isMultiItem) {
      const allCompleted = itemReconciliations.length > 0 &&
        itemReconciliations.every(ir => ir.status === 'completed');
      const amountComplete = po.totalAmount > 0 && deliveredAmount >= po.totalAmount;
      const anyDelivered = itemReconciliations.some(ir => ir.deliveredQty > 0) || deliveredAmount > 0;
      if (allCompleted || amountComplete) {
        status = 'completed';
      } else if (anyDelivered) {
        status = 'partially_delivered';
      } else {
        status = 'pending';
      }
    } else {
      if (deliveredQty <= 0) {
        status = 'pending';
      } else if (
        (po.totalQty > 0 && deliveredQty >= po.totalQty) ||
        (po.totalQty <= 0 && po.totalAmount > 0 && deliveredAmount >= po.totalAmount)
      ) {
        status = 'completed';
      } else {
        status = 'partially_delivered';
      }
    }
  }

  return {
    po,
    linkedOrders: allLinkedOrders,
    pairedShipments,
    deliveredQty: Number(deliveredQty.toFixed(2)),
    deliveredAmount,
    remainingQty: Number(remainingQty.toFixed(2)),
    remainingAmount,
    percentageDelivered,
    financialPercentageDelivered,
    quantityPercentageDelivered,
    isMultiItem,
    itemReconciliations,
    isOverDelivered,
    status,
    primaryUnit: rawPrimaryPOUnit,
    hasUnitMismatch,
    unitMismatchWarnings,
    unitConversions,
    linkedMatchTypes
  };
}

/**
 * Finds orders that explicitly reference this PO in col4, referenceDocNo, or col38.
 * Store/vendor similarity and missing PO references are not candidate-link evidence.
 */
export function findCandidateUnlinkedOrders(po: PurchaseOrder, orders: OrderRecord[]): OrderRecord[] {
  return orders
    .filter(ord => {
      if (!isDeliveryOrderPairingCandidate(ord)) return false;

      // Already linked to this PO
      if (isExactDocNumberReference(ord.col4, po.poNumber)) return false;

      const textRefs = extractDocReferences(ord.col38);
      const mentionsPO =
        isExactDocNumberReference(ord.referenceDocNo, po.poNumber) ||
        textRefs.poNumbers.some(p => isExactDocNumberReference(p, po.poNumber));

      return mentionsPO;
    })
    .sort((a, b) => {
      const aRefs = extractDocReferences(a.col38);
      const bRefs = extractDocReferences(b.col38);
      const aHasRef = isExactDocNumberReference(a.referenceDocNo, po.poNumber) || aRefs.poNumbers.some(p => isExactDocNumberReference(p, po.poNumber));
      const bHasRef = isExactDocNumberReference(b.referenceDocNo, po.poNumber) || bRefs.poNumbers.some(p => isExactDocNumberReference(p, po.poNumber));
      if (aHasRef && !bHasRef) return -1;
      if (!aHasRef && bHasRef) return 1;
      return 0;
    });
}

/**
 * Reconciles a list of Purchase Orders against orders
 */
export function reconcileAllPOs(pos: PurchaseOrder[], orders: OrderRecord[]): POReconciliation[] {
  return pos.map(po => reconcilePO(po, orders));
}

// ============================================================================
// SMART DUPLICATE BILL & PO DETECTION ENGINE (ระบบตรวจสอบการนำเข้าบิลซ้ำ 3 ระดับ)
// ============================================================================

export interface DuplicateCheckMatch {
  matchedOrder: OrderRecord;
  level: 'exact' | 'suspected' | 'cross_vendor';
  reasonTitle: string;
  reasonDetail: string;
  matchedFields: string[];
}

export interface PODuplicateCheckMatch {
  matchedPO: PurchaseOrder;
  level: 'exact' | 'suspected';
  reasonTitle: string;
  reasonDetail: string;
}

function normalizeVendorName(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/^(บริษัท|บจก\.?|หจก\.?|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วนสามัญ|ร้าน|ท่าทราย|โรงโม่หิน|แพล้นปูน)\s*/g, '')
    .replace(/\s*(จำกัด\s*\(มหาชน\)|จำกัด|มหาชน|\(สำนักงานใหญ่\)|สำนักงานใหญ่|\(สาขา.*?\))\s*/g, '')
    .replace(/[^a-z0-9ก-๙]/g, '');
}

function isSameOrSimilarVendor(v1?: string | null, v2?: string | null): boolean {
  const n1 = normalizeVendorName(v1);
  const n2 = normalizeVendorName(v2);
  if (!n1 || !n2 || n1.includes('ไม่ระบุ') || n2.includes('ไม่ระบุ')) return false;
  return n1 === n2;
}

function normalizeLicensePlate(plate?: string | null): string {
  if (!plate) return '';
  return plate.trim().toLowerCase().replace(/[^0-9a-zก-ฮ]/g, '');
}

/**
 * Checks if a candidate OrderRecord (being scanned or manually entered) duplicates any existing OrderRecord.
 * Key Rule:
 * - Store bills (DO / Origin Weighbridge / Concrete / Tax Invoice) are scoped per Store (Vendor).
 * - Same Bill Number + SAME Store = 'exact' duplicate (Hard Blocked).
 * - Same Bill Number + DIFFERENT Store = 'cross_vendor' (Allowed! Never blocked, because different stores have their own bill books).
 */
export function checkDuplicateOrder(
  candidate: Partial<OrderRecord>,
  existingOrders: OrderRecord[],
  currentImage?: string | null
): DuplicateCheckMatch[] {
  const matches: DuplicateCheckMatch[] = [];
  const candId = candidate.id || '';
  const candDocType = candidate.docType || 'delivery_order';
  const candImage = currentImage || candidate.image || null;

  const candDocNo = (candDocType === 'dest_weighbridge'
    ? (candidate.col17 || candidate.col6 || '')
    : (candidate.col6 || '')
  ).trim();

  const candDate = (candDocType === 'dest_weighbridge'
    ? (candidate.col16 || candidate.col7 || '')
    : (candidate.col7 || '')
  ).trim();

  const candPlate = normalizeLicensePlate(candidate.col10);
  const candOriginNet = Number(candidate.col15) || 0;
  const candOriginGross = Number(candidate.col13) || 0;
  const candDestNet = Number(candidate.col20) || 0;
  const candDestGross = Number(candidate.col18) || 0;
  const candTotalAmt = Number(candidate.col29) || Number(candidate.col25) || 0;
  const candQty = Number(candidate.col22) || 0;
  const candItem = (candidate.col11 || '').trim().toLowerCase();

  for (const existing of existingOrders) {
    // Never compare an existing record against itself when editing
    if (candId && existing.id === candId) continue;

    const existDocType = existing.docType || 'delivery_order';
    const existDocNo = (existDocType === 'dest_weighbridge'
      ? (existing.col17 || existing.col6 || '')
      : (existing.col6 || '')
    ).trim();
    const existDate = (existDocType === 'dest_weighbridge'
      ? (existing.col16 || existing.col7 || '')
      : (existing.col7 || '')
    ).trim();

    // 1. Check Exact Image Match (Same image payload uploaded twice)
    if (candImage && existing.image && candImage.length > 200 && candImage === existing.image) {
      matches.push({
        matchedOrder: existing,
        level: 'exact',
        reasonTitle: '🚨 รูปภาพบิลซ้ำ 100% (ไฟล์ภาพเดียวกัน)',
        reasonDetail: `ภาพถ่ายใบนี้เคยถูกนำเข้าแล้วในรหัส ${existing.col1} (${existDocNo || 'ไม่ระบุเลขบิล'})`,
        matchedFields: ['รูปภาพเอกสารเดียวกัน', `รหัส ${existing.col1}`]
      });
      continue;
    }

    // Group compatibility check
    const isBothDestWB = candDocType === 'dest_weighbridge' && existDocType === 'dest_weighbridge';
    const isBothTaxInv = candDocType === 'tax_invoice' && existDocType === 'tax_invoice';
    const isBothOriginDO =
      candDocType !== 'dest_weighbridge' &&
      candDocType !== 'tax_invoice' &&
      existDocType !== 'dest_weighbridge' &&
      existDocType !== 'tax_invoice';

    const isSameDocGroup = isBothDestWB || isBothTaxInv || isBothOriginDO;

    // 2. Check Document Number Match (Supports เล่มที่/เลขที่ via isDocNumberMatch)
    if (candDocNo && existDocNo && isDocNumberMatch(candDocNo, existDocNo)) {
      const sameVendor = isSameOrSimilarVendor(candidate.col8, existing.col8);

      // Internal Company Destination Weighbridge Ticket: Issued by our own company scale
      if (isBothDestWB) {
        const sameDateOrBlank = !candDate || !existDate || candDate === existDate;
        if (sameDateOrBlank) {
          matches.push({
            matchedOrder: existing,
            level: 'exact',
            reasonTitle: `🚨 เลขที่ตั๋วชั่งปลายทางของบริษัทซ้ำ (${candDocNo})`,
            reasonDetail: `ตรงกับตั๋วชั่งปลายทาง ${existing.col1} วันที่ ${existDate || '-'} ทะเบียน ${existing.col10 || '-'}`,
            matchedFields: [`เลขตั๋ว: ${existDocNo}`, `วันที่: ${existDate || '-'}`]
          });
          continue;
        }
      }

      // Store Bills (DO / Origin Weighbridge / Concrete / Tax Invoice):
      // ONLY block when BOTH the Bill Number AND the Store Name match!
      if (isSameDocGroup && sameVendor) {
        matches.push({
          matchedOrder: existing,
          level: 'exact',
          reasonTitle: `🚨 เลขที่บิลซ้ำในร้านค้าเดียวกัน (${candDocNo})`,
          reasonDetail: `บิลเลขที่ "${candDocNo}" ของร้าน "${existing.col8}" มีอยู่ในระบบแล้วในรหัส ${existing.col1}`,
          matchedFields: [
            `เลขที่บิล: ${existDocNo}`,
            `ร้านค้าเดียวกัน: ${existing.col8}`,
            `วันที่: ${existDate || '-'}`
          ]
        });
        continue;
      } else if (isSameDocGroup && !sameVendor) {
        // Different Store with the same Bill Number -> ALLOWED (Not blocked!)
        matches.push({
          matchedOrder: existing,
          level: 'cross_vendor',
          reasonTitle: `✅ คนละร้านค้า (บันทึกได้ปกติ): เลขที่บิล ${candDocNo} ตรงกับบิลของร้านอื่น`,
          reasonDetail: `ในระบบมีบิลเลขที่ "${existDocNo}" ของร้าน "${existing.col8 || 'ไม่ระบุ'}" (${existing.col1}) แต่เนื่องจากใบนี้เป็นของร้าน "${candidate.col8 || 'คนละร้าน'}" ระบบจึงอนุญาตให้บันทึกได้ตามปกติ`,
          matchedFields: [`เลขที่บิล: ${existDocNo}`, `ร้านในระบบ: ${existing.col8 || '-'}`]
        });
        continue;
      }
    }

    // 3. Check Physical Weight or Financial Fingerprint ONLY when DocNo is blank/missing
    // (If both bills have explicit and DIFFERENT document numbers, they are separate trips/bills!)
    if (!isSameDocGroup) continue;
    if (candDocNo && existDocNo && !isDocNumberMatch(candDocNo, existDocNo)) continue;

    const existPlate = normalizeLicensePlate(existing.col10);
    const samePlate = Boolean(candPlate && existPlate && candPlate.length >= 3 && candPlate === existPlate);
    const sameDate = Boolean(candDate && existDate && candDate === existDate);
    const sameVendor = isSameOrSimilarVendor(candidate.col8, existing.col8);

    // Must be the same store (or both dest_weighbridge of our company) to trigger a fingerprint duplicate
    if (!isBothDestWB && !sameVendor) continue;

    // 3A: Same Date + Same Store + Same Truck Plate + Identical Scale Weight (> 0) when bill number is missing
    const existOriginNet = Number(existing.col15) || 0;
    const existOriginGross = Number(existing.col13) || 0;
    const existDestNet = Number(existing.col20) || 0;
    const existDestGross = Number(existing.col18) || 0;

    const sameOriginWeight =
      (candOriginNet > 0 && candOriginNet === existOriginNet) ||
      (candOriginGross > 0 && candOriginGross === existOriginGross);

    const sameDestWeight =
      (candDestNet > 0 && candDestNet === existDestNet) ||
      (candDestGross > 0 && candDestGross === existDestGross);

    if (sameDate && samePlate && (sameOriginWeight || sameDestWeight)) {
      const weightText = sameOriginWeight
        ? `สุทธิต้นทาง ${candOriginNet.toLocaleString()} กก.`
        : `สุทธิปลายทาง ${candDestNet.toLocaleString()} กก.`;
      matches.push({
        matchedOrder: existing,
        level: 'suspected',
        reasonTitle: '🚨 พบข้อมูลชั่งน้ำหนักซ้ำในร้านและวันเดียวกัน',
        reasonDetail: `ร้าน "${existing.col8}" วันที่ ${existDate} รถทะเบียน ${existing.col10} มีน้ำหนัก ${weightText} เท่ากับบิล ${existing.col1} เป๊ะ`,
        matchedFields: [`วันที่: ${existDate}`, `ทะเบียน: ${existing.col10}`, weightText]
      });
      continue;
    }

    // 3B: Same Date + Same Vendor + Same Total Amount (> 0) + Same Quantity & Item (when DocNo is blank)
    const existTotalAmt = Number(existing.col29) || Number(existing.col25) || 0;
    const existQty = Number(existing.col22) || 0;
    const existItem = (existing.col11 || '').trim().toLowerCase();

    if (
      sameDate &&
      sameVendor &&
      candTotalAmt > 0 &&
      candTotalAmt === existTotalAmt &&
      candQty > 0 &&
      candQty === existQty &&
      candItem === existItem
    ) {
      matches.push({
        matchedOrder: existing,
        level: 'suspected',
        reasonTitle: '🚨 พบบิลร้านเดียวกัน วันเดียวกัน ยอดเงินและปริมาณซ้ำกัน',
        reasonDetail: `ร้าน "${existing.col8}" วันที่ ${existDate} สินค้า "${existing.col11}" จำนวน ${existQty} ${existing.col23 || ''} ยอดรวม ฿${existTotalAmt.toLocaleString()} มีอยู่แล้วใน ${existing.col1}`,
        matchedFields: [
          `วันที่: ${existDate}`,
          `ร้านค้า: ${existing.col8}`,
          `ยอดรวม: ฿${existTotalAmt.toLocaleString()}`
        ]
      });
    }
  }

  // Sort exact matches first, then suspected, then cross_vendor
  const priority = { exact: 0, suspected: 1, cross_vendor: 2 };
  return matches.sort((a, b) => priority[a.level] - priority[b.level]);
}

/**
 * Checks if a candidate PurchaseOrder (PO) duplicates any existing PO.
 */
export function checkDuplicatePO(
  candidate: Partial<PurchaseOrder>,
  existingPOs: PurchaseOrder[],
  currentImage?: string | null
): PODuplicateCheckMatch[] {
  const matches: PODuplicateCheckMatch[] = [];
  const candId = candidate.id || '';
  const candPONo = (candidate.poNumber || '').trim();
  const candImage = currentImage || candidate.image || null;

  for (const existing of existingPOs) {
    if (candId && existing.id === candId) continue;

    if (candImage && existing.image && candImage.length > 200 && candImage === existing.image) {
      matches.push({
        matchedPO: existing,
        level: 'exact',
        reasonTitle: '🚨 รูปภาพใบสั่งซื้อ (PO) ซ้ำ 100%',
        reasonDetail: `ภาพถ่ายใบสั่งซื้อนี้เคยถูกบันทึกไว้แล้วในเลขที่ ${existing.poNumber} (${existing.storeName})`
      });
      continue;
    }

    if (candPONo && existing.poNumber && isDocNumberMatch(candPONo, existing.poNumber)) {
      matches.push({
        matchedPO: existing,
        level: 'exact',
        reasonTitle: `🚨 เลขที่ใบสั่งซื้อซ้ำ (${candPONo})`,
        reasonDetail: `ใบสั่งซื้อเลขที่ "${existing.poNumber}" ของร้าน "${existing.storeName}" (ยอด ฿${(existing.totalAmount || 0).toLocaleString()}) มีอยู่ในระบบแล้ว`
      });
      continue;
    }

    if (
      candidate.orderDate &&
      candidate.orderDate === existing.orderDate &&
      isSameOrSimilarVendor(candidate.storeName, existing.storeName) &&
      Number(candidate.totalAmount) > 0 &&
      Number(candidate.totalAmount) === Number(existing.totalAmount)
    ) {
      matches.push({
        matchedPO: existing,
        level: 'suspected',
        reasonTitle: '⚠️ พบใบสั่งซื้อร้านเดียวกัน วันเดียวกัน และยอดเงินเท่ากัน',
        reasonDetail: `ร้าน "${existing.storeName}" วันที่ ${existing.orderDate} ยอดรวม ฿${existing.totalAmount.toLocaleString()} มีอยู่แล้วใน ${existing.poNumber}`
      });
    }
  }

  return matches;
}

/**
 * Builds a lookup map of duplicate orders currently inside the orders array
 * so the table can highlight any duplicate rows with a warning badge.
 */
export function getDuplicateOrderMap(
  orders: OrderRecord[]
): Record<string, { count: number; matchedTRs: string[]; matchedDocNo: string; level: 'exact' | 'suspected' }> {
  const map: Record<string, { count: number; matchedTRs: string[]; matchedDocNo: string; level: 'exact' | 'suspected' }> = {};

  for (let i = 0; i < orders.length; i++) {
    const ord = orders[i];
    const dups = checkDuplicateOrder(ord, orders, ord.image).filter(
      d => d.level === 'exact' || d.level === 'suspected'
    );
    if (dups.length > 0) {
      const hasExact = dups.some(d => d.level === 'exact');
      map[ord.id] = {
        count: dups.length,
        matchedTRs: dups.map(d => d.matchedOrder.col1),
        matchedDocNo: ord.col6 || ord.col17 || ord.col1,
        level: hasExact ? 'exact' : 'suspected'
      };
    }
  }

  return map;
}
