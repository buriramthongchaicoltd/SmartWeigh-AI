import { DocumentType, OrderRecord, PurchaseOrder, StoreMerchant } from '../types';

/**
 * Instant 0-Second Document Type Remapper for LINE OA Bot Inbox & VerifyModal.
 *
 * Why this solves the verifier's workflow:
 * When the LINE OA Bot receives a bill image, Gemini extracts all fields across all zones
 * and stores them in `rawAiSnapshot`.
 * If the verifier changes the Document Type (e.g. from `delivery_order` -> `dest_weighbridge` or `tax_invoice`),
 * this function immediately remaps Document Numbers (`col6` <-> `col17` <-> `col4`),
 * Scale Weights (`col13-15` <-> `col18-20`), and Dates (`col7` <-> `col16`) in 0 seconds
 * WITHOUT needing to call the AI API again.
 *
 * STRICT RULE: `col2` (ชื่อโครงการ) is ALWAYS kept separate from `lineGroupName` (ชื่อกลุ่ม LINE).
 */
export function remapLineBillToDocType(
  currentData: Partial<OrderRecord>,
  targetDocType: DocumentType
): Partial<OrderRecord> {
  const snap: Record<string, any> = (currentData.rawAiSnapshot as Record<string, any>) || {};
  const next: Partial<OrderRecord> = {
    ...currentData,
    docType: targetDocType
  };

  // Determine the primary document number on the paper
  const primaryBillNo =
    snap.rawDocNo ||
    (currentData.docType === 'dest_weighbridge'
      ? currentData.col17 || currentData.col6
      : currentData.col6 || currentData.col17 || currentData.col4) ||
    '';

  const refPoNo = snap.rawRefPoNo || currentData.col4 || '';
  const refDoNo = snap.rawRefDoNo || currentData.referenceDocNo || '';

  // Determine the primary scale weights on the paper (from snapshot or current Zone 3 / Zone 4)
  let grossKg =
    Number(snap.rawGrossWeightKg) ||
    Number(currentData.col13) ||
    Number(currentData.col18) ||
    0;
  let tareKg =
    Number(snap.rawTareWeightKg) ||
    Number(currentData.col14) ||
    Number(currentData.col19) ||
    0;
  if (grossKg > 0 && tareKg > 0 && grossKg < tareKg) {
    const tmp = grossKg;
    grossKg = tareKg;
    tareKg = tmp;
  }
  const netKg =
    grossKg > 0 && tareKg > 0
      ? grossKg - tareKg
      : Number(snap.rawNetWeightKg) || Number(currentData.col15) || Number(currentData.col20) || 0;
  let destGrossKg =
    Number(snap.rawDestGrossWeightKg) || Number(currentData.col18) || 0;
  let destTareKg =
    Number(snap.rawDestTareWeightKg) || Number(currentData.col19) || 0;
  if (destGrossKg > 0 && destTareKg > 0 && destGrossKg < destTareKg) {
    [destGrossKg, destTareKg] = [destTareKg, destGrossKg];
  }
  const destNetKg =
    destGrossKg > 0 && destTareKg > 0
      ? destGrossKg - destTareKg
      : Number(snap.rawDestNetWeightKg) || Number(currentData.col20) || 0;

  const docDate =
    snap.rawDate ||
    currentData.col7 ||
    currentData.col16 ||
    new Date().toISOString().split('T')[0];

  if (targetDocType === 'dest_weighbridge') {
    // Destination Weighbridge Ticket -> Store ticket number in col17, weights in Zone 4 (col18-20)
    next.col17 = primaryBillNo;
    next.col16 = docDate;
    next.col7 = docDate;
    next.col6 = refDoNo || '';
    next.referenceDocNo = refDoNo || refPoNo || '';
    next.col18 = grossKg;
    next.col19 = tareKg;
    next.col20 = netKg;
    next.col13 = 0;
    next.col14 = 0;
    next.col15 = 0;
    next.col21 = 0;
    if (netKg > 0) {
      next.col22 = Number((netKg / 1000).toFixed(2));
      next.col23 = 'ตัน';
    }
  } else if (targetDocType === 'delivery_order' || targetDocType === 'weighbridge' || targetDocType === 'concrete') {
    // Delivery Order (DO) -> Store DO number in col6, weights in Zone 3 (col13-15)
    next.col6 = primaryBillNo;
    next.col7 = docDate;
    next.col4 = refPoNo !== primaryBillNo ? refPoNo : (currentData.col4 || '');
    next.referenceDocNo = next.col4 || '';
    next.col13 = grossKg;
    next.col14 = tareKg;
    next.col15 = netKg;
    next.col16 = '';
    next.col17 = '';
    next.col18 = 0;
    next.col19 = 0;
    next.col20 = 0;
    next.col21 = 0;
    if (netKg > 0 && (!next.col23 || next.col23.includes('ตัน'))) {
      next.col22 = Number((netKg / 1000).toFixed(2));
      next.col23 = 'ตัน';
    }
  } else if (targetDocType === 'tax_invoice') {
    // Tax Invoice / Receipt -> Store Invoice number in col6, clear scale weights
    next.col6 = primaryBillNo;
    next.col7 = docDate;
    next.col4 = refPoNo !== primaryBillNo ? refPoNo : (currentData.col4 || '');
    next.col13 = 0;
    next.col14 = 0;
    next.col15 = 0;
    next.col16 = '';
    next.col17 = '';
    next.col18 = 0;
    next.col19 = 0;
    next.col20 = 0;
    next.col21 = 0;
    if (!next.col30 || next.col30 === 'รอตรวจรับ / RR') {
      next.col30 = 'โอนเงิน';
    }
  } else if (targetDocType === 'purchase_order') {
    next.col4 = primaryBillNo || refPoNo;
    next.col6 = primaryBillNo;
    next.col7 = docDate;
  } else if (targetDocType === 'full_logistics') {
    next.col4 = refPoNo !== primaryBillNo ? refPoNo : (currentData.col4 || '');
    next.col6 = primaryBillNo;
    next.col7 = docDate;
    next.col13 = grossKg;
    next.col14 = tareKg;
    next.col15 = netKg;
    next.col16 = snap.rawDestDate || currentData.col16 || '';
    next.col17 = snap.rawDestDocNo || currentData.col17 || '';
    next.col18 = destGrossKg;
    next.col19 = destTareKg;
    next.col20 = destNetKg;
    next.col21 = netKg > 0 && destNetKg > 0 ? netKg - destNetKg : 0;
  }

  // Strictly preserve col2 as entered by verifier (never copy lineGroupName into col2!)
  next.col2 = currentData.col2 || '';

  return next;
}

/**
 * Converts an OrderRecord draft (from LINE Inbox or VerifyModal) into a PurchaseOrder draft
 * while preserving LINE OA Bot sender/group metadata and keeping projectId strictly separate from lineGroupName.
 */
export function convertOrderDraftToPODraft(
  data: Partial<OrderRecord>,
  imageOverride?: string | null
): PurchaseOrder {
  const today = new Date().toISOString().split('T')[0];
  const snap: Record<string, any> = (data.rawAiSnapshot as Record<string, any>) || {};
  const poNum =
    snap.rawDocNo ||
    data.col4 ||
    data.col6 ||
    data.col17 ||
    `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const items =
    data.lineItems && data.lineItems.length > 0
      ? data.lineItems.map((item, idx) => ({
          id: `item-${Date.now()}-${idx}`,
          itemDescription: item.itemDescription || 'รายการสินค้า',
          specCode: item.specCode || '',
          orderedQty: Number(item.qty) || 1,
          unit: item.unit || 'ชิ้น',
          unitPrice: Number(item.unitPrice) || 0,
          totalAmount: Number(item.totalAmount) || (Number(item.qty) || 1) * (Number(item.unitPrice) || 0)
        }))
      : [
          {
            id: `item-${Date.now()}-0`,
            itemDescription: data.col11 || snap.rawItemDescription || 'สินค้าจัดซื้อ',
            specCode: data.col12 || snap.rawSpecCode || '',
            orderedQty: Number(data.col22) || 1,
            unit: data.col23 || 'ชิ้น',
            unitPrice: Number(data.col24) || 0,
            totalAmount: Number(data.col25) || Number(data.col29) || 0
          }
        ];

  const totalQty = items.reduce((s, i) => s + (Number(i.orderedQty) || 0), 0);
  const sumAmount = items.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);

  return {
    id: `po-${Date.now()}`,
    poNumber: poNum,
    orderDate: data.col7 || snap.rawDate || today,
    deliveryDueDate: '',
    projectId: (data.col2 || '').trim(), // Strictly empty unless verifier already selected a project!
    storeName: data.col8 || snap.rawStoreName || '',
    category: data.col3 || snap.rawCategory || 'งานจัดซื้อทั่วไป',
    items,
    totalQty: totalQty || 1,
    totalAmount: Number(data.col29) || Number(data.col25) || sumAmount,
    status: 'pending',
    creditTerms: data.col30 || 'เครดิต 30 วัน',
    deliveryLocation: data.col37 || '',
    orderedBy: data.col9 || '',
    notes: data.col38 || '',
    image: imageOverride || data.image || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lineInboxId: data.lineInboxId,
    lineMessageId: data.lineMessageId,
    lineUserId: data.lineUserId,
    lineSenderName: data.lineSenderName,
    lineGroupId: data.lineGroupId,
    lineGroupName: data.lineGroupName,
    lineReceivedAt: data.lineReceivedAt
  };
}

/**
 * Optional on-demand AI Re-Scan for a specific document type when the verifier explicitly clicks
 * "🤖 ให้ AI อ่านข้อมูลใหม่ตามประเภทที่เลือก"
 */
export async function rescanBillForTargetDocType(
  imageBase64: string,
  targetDocType: DocumentType,
  preserveMetadata?: Partial<OrderRecord>
): Promise<{
  success: boolean;
  orderData?: Partial<OrderRecord>;
  poData?: Partial<PurchaseOrder>;
  storeSuggestion?: Partial<StoreMerchant>;
  error?: string;
}> {
  const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(imageBase64);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  if (targetDocType === 'purchase_order') {
    const resp = await fetch('/api/scan-po', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mimeType })
    });
    const result = await resp.json();
    if (!resp.ok || !result.success) {
      return { success: false, error: result.error || 'ไม่สามารถอ่านใบสั่งซื้อใหม่ได้' };
    }
    const poRaw = result.data || {};
    const orderEquivalent: Partial<OrderRecord> = {
      ...preserveMetadata,
      docType: 'purchase_order',
      col2: preserveMetadata?.col2 || '', // Never overwrite col2 with group name
      col3: poRaw.category || preserveMetadata?.col3 || 'งานจัดซื้อทั่วไป',
      col4: poRaw.poNumber || '',
      col6: poRaw.poNumber || '',
      col7: poRaw.orderDate || new Date().toISOString().split('T')[0],
      col8: poRaw.storeName || '',
      col9: poRaw.orderedBy || '',
      col11: poRaw.items?.[0]?.itemDescription || 'รายการสั่งซื้อตาม PO',
      col12: poRaw.items?.[0]?.specCode || '',
      col22: Number(poRaw.totalQty) || 1,
      col23: poRaw.items?.[0]?.unit || 'รายการ',
      col24: Number(poRaw.items?.[0]?.unitPrice) || 0,
      col25: Number(poRaw.totalAmount) || 0,
      col29: Number(poRaw.totalAmount) || 0,
      col30: poRaw.creditTerms || 'เครดิต 30 วัน',
      col37: poRaw.deliveryLocation || '',
      col38: poRaw.notes || '',
      lineItems: (poRaw.items || []).map((it: any) => ({
        itemDescription: it.itemDescription,
        specCode: it.specCode || '',
        qty: Number(it.orderedQty) || 1,
        unit: it.unit || 'หน่วย',
        unitPrice: Number(it.unitPrice) || 0,
        totalAmount: Number(it.totalAmount) || 0
      }))
    };
    return {
      success: true,
      orderData: orderEquivalent,
      poData: {
        ...poRaw,
        projectId: preserveMetadata?.col2 || '',
        image: imageBase64,
        lineInboxId: preserveMetadata?.lineInboxId,
        lineMessageId: preserveMetadata?.lineMessageId,
        lineUserId: preserveMetadata?.lineUserId,
        lineSenderName: preserveMetadata?.lineSenderName,
        lineGroupId: preserveMetadata?.lineGroupId,
        lineGroupName: preserveMetadata?.lineGroupName,
        lineReceivedAt: preserveMetadata?.lineReceivedAt
      }
    };
  }

  const resp = await fetch('/api/scan-bill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      mimeType,
      docType: targetDocType
    })
  });
  const result = await resp.json();
  if (!resp.ok || !result.success) {
    return { success: false, error: result.error || 'ไม่สามารถอ่านข้อมูลเอกสารใหม่ได้' };
  }

  const scannedData: Partial<OrderRecord> = {
    ...(result.data || {}),
    docType: targetDocType,
    col2: preserveMetadata?.col2 || '', // Keep verifier's project name or empty
    lineInboxId: preserveMetadata?.lineInboxId,
    lineMessageId: preserveMetadata?.lineMessageId,
    lineUserId: preserveMetadata?.lineUserId,
    lineSenderName: preserveMetadata?.lineSenderName,
    lineSenderAvatar: preserveMetadata?.lineSenderAvatar,
    lineGroupId: preserveMetadata?.lineGroupId,
    lineGroupName: preserveMetadata?.lineGroupName,
    lineReceivedAt: preserveMetadata?.lineReceivedAt
  };

  return {
    success: true,
    orderData: scannedData,
    storeSuggestion: result.storeSuggestion
  };
}
