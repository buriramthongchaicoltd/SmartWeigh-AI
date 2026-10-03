import * as XLSX from 'xlsx';
import { OrderRecord, StoreMerchant, PurchaseOrder } from '../types';
import { reconcilePO } from './poReconciliation';

export function exportAllDataToExcel(orders: OrderRecord[], stores: StoreMerchant[], pos?: PurchaseOrder[]) {
  const workbook = XLSX.utils.book_new();

  // 1. Prepare 39 Columns Sheet
  const orderRows = orders.map((r, idx) => ({
    "ลำดับ": idx + 1,
    // โซน 1
    "1. เลข TR": r.col1 || '',
    "2. โครงการ": r.col2 || '',
    "3. หมวดหมู่": r.col3 || '',
    "4. PO": r.col4 || '',
    "5. RR": r.col5 || '',
    "6. DO / ตั๋ว": r.col6 || '',
    // โซน 2
    "7. วันที่": r.col7 || '',
    "8. ผู้จำหน่าย / ร้านค้า": r.col8 || '',
    "9. ผู้รับเหมา / ผู้ซื้อ": r.col9 || '',
    "10. ทะเบียนรถ": r.col10 || '',
    "11. รายการสินค้า": r.col11 || '',
    "12. สเปก / Code": r.col12 || '',
    // โซน 3
    "13. หนักต้นทาง (กก.)": Number(r.col13) || 0,
    "14. เบาต้นทาง (กก.)": Number(r.col14) || 0,
    "15. สุทธิต้นทาง (กก.)": Number(r.col15) || 0,
    // โซน 4
    "16. วันที่ปลายทาง": r.col16 || '',
    "17. ตั๋วปลายทาง": r.col17 || '',
    "18. หนักปลายทาง (กก.)": Number(r.col18) || 0,
    "19. เบาปลายทาง (กก.)": Number(r.col19) || 0,
    "20. สุทธิปลายทาง (กก.)": Number(r.col20) || 0,
    "21. ผลต่าง (กก.)": Number(r.col21) || 0,
    // โซน 5
    "22. ปริมาณ": Number(r.col22) || 0,
    "23. หน่วย": r.col23 || '',
    "24. ราคา/หน่วย (บาท)": Number(r.col24) || 0,
    "25. ค่าสินค้า (บาท)": Number(r.col25) || 0,
    "26. ประเภทรถ": r.col26 || '',
    "27. ค่าบรรทุก/หน่วย": Number(r.col27) || 0,
    "28. รวมค่าขนส่ง (บาท)": Number(r.col28) || 0,
    "29. รวมทั้งสิ้น (บาท)": Number(r.col29) || 0,
    // โซน 6
    "30. รูปแบบจ่าย": r.col30 || '',
    "31. จ่ายผู้ขายแล้ว (บาท)": Number(r.col31) || 0,
    "32. ค้างผู้ขาย (บาท)": Number(r.col32) || 0,
    "33. จ่ายขนส่งแล้ว (บาท)": Number(r.col33) || 0,
    "34. ค้างขนส่ง (บาท)": Number(r.col34) || 0,
    "35. ชำระแล้วรวม (บาท)": Number(r.col35) || 0,
    "36. ยอดค้างรวม (บาท)": Number(r.col36) || 0,
    // โซน 7
    "37. สถานที่ส่ง / กม.": r.col37 || '',
    "38. หมายเหตุ": r.col38 || '',
    "สถานะการตรวจ": r.status === 'verified' ? 'ตรวจสอบแล้ว' : 'รอตรวจสอบ',
    "ผู้ส่งบิล (LINE)": r.lineSenderName || '',
    "กลุ่ม LINE ที่ส่งบิล (แยกจากชื่อโครงการ)": r.lineGroupName || ''
  }));

  const orderSheet = XLSX.utils.json_to_sheet(orderRows);
  XLSX.utils.book_append_sheet(workbook, orderSheet, "ประวัติคำสั่งซื้อ_39คอลัมน์");

  // 2. Prepare Stores Sheet with live recalculated metrics from orders (matching syncStoreFinancials)
  const storeRows = stores.map((s, idx) => {
    const storeOrders = orders.filter(
      o => (o.storeId === s.id || (o.col8 && o.col8.trim().toLowerCase() === s.name.trim().toLowerCase())) &&
           o.docType !== 'dest_weighbridge'
    );

    const hasPricedDeliveryOrder = storeOrders.some(
      o => o.docType !== 'tax_invoice' && (Number(o.col29) > 0 || Number(o.col25) > 0)
    );

    let livePurchases = 0;
    let livePaid = 0;
    let liveDebt = 0;
    let effectiveOrderCount = 0;
    let liveLastDate = s.lastOrderDate || '-';

    storeOrders.forEach(o => {
      const isDuplicateTaxInvoice = o.docType === 'tax_invoice' && (Boolean(o.linkedViaDocNo) || hasPricedDeliveryOrder);
      if (!isDuplicateTaxInvoice) {
        effectiveOrderCount++;
        livePurchases += Number(o.col29) || Number(o.col25) || 0;
      }
      livePaid += Number(o.col35) || Number(o.col31) || 0;
      liveDebt += Number(o.col36) || Number(o.col32) || 0;
      if (o.col7 && (liveLastDate === '-' || o.col7 > liveLastDate)) {
        liveLastDate = o.col7;
      }
    });

    const orderCount = storeOrders.length > 0 ? effectiveOrderCount : s.totalOrders;
    const finalPurchases = storeOrders.length > 0 ? livePurchases : s.totalPurchases;
    const finalPaid = storeOrders.length > 0 ? livePaid : s.totalPaid;
    const finalDebt = storeOrders.length > 0 ? liveDebt : s.totalDebt;

    return {
      "ลำดับ": idx + 1,
      "ชื่อร้านค้า / คู่ค้า": s.name,
      "หมวดหมู่": s.category,
      "เลขผู้เสียภาษี": s.taxId || '-',
      "เบอร์โทรศัพท์": s.phone || '-',
      "ผู้ติดต่อ": s.contactPerson || '-',
      "ที่อยู่": s.address || '-',
      "เงื่อนไขการชำระ": s.creditTerms || '-',
      "จำนวนรายการสั่งซื้อ": orderCount,
      "ยอดสั่งซื้อรวม (บาท)": finalPurchases,
      "ชำระแล้วรวม (บาท)": finalPaid,
      "ยอดคงค้างชำระ (บาท)": finalDebt,
      "วันที่สั่งล่าสุด": liveLastDate,
      "สินค้าหลัก": (s.primaryGoods || []).join(', '),
      "หมายเหตุ": s.notes || ''
    };
  });

  const storeSheet = XLSX.utils.json_to_sheet(storeRows);
  XLSX.utils.book_append_sheet(workbook, storeSheet, "ทะเบียนร้านค้า_คู่ค้า");

  // 3. Prepare Purchase Orders Sheet if available
  if (pos && pos.length > 0) {
    const poRows = pos.map((p, idx) => {
      const recon = reconcilePO(p, orders);
      const unit = p.items?.[0]?.unit || 'หน่วย';
      return {
        "ลำดับ": idx + 1,
        "เลขที่ PO": p.poNumber,
        "วันที่ออกเอกสาร": p.orderDate,
        "กำหนดส่งมอบ": p.deliveryDueDate || '-',
        "ผู้จำหน่าย / ร้านค้า": p.storeName,
        "โครงการ": p.projectId,
        "หมวดหมู่": p.category,
        "หน่วยนับ": unit,
        "ปริมาณสั่งซื้อ": p.totalQty,
        "ยอดเงินรวม (บาท)": p.totalAmount,
        "ส่งมอบแล้ว": recon.deliveredQty,
        "ยอดเงินส่งมอบ (บาท)": recon.deliveredAmount,
        "คงเหลือยังไม่ส่ง": recon.remainingQty,
        "ยอดเงินคงเหลือ (บาท)": recon.remainingAmount,
        "ความคืบหน้า (%)": recon.percentageDelivered + '%',
        "สถานะ": recon.status === 'completed' ? 'ส่งมอบครบแล้ว' :
                 recon.status === 'partially_delivered' ? 'ส่งมอบบางส่วน' :
                 recon.status === 'cancelled' ? 'ยกเลิก' : 'รอส่งมอบ',
        "เงื่อนไขชำระ": p.creditTerms || '-',
        "สถานที่ส่ง": p.deliveryLocation || '-',
        "ผู้สั่งซื้อ": p.orderedBy || '-',
        "ผู้อนุมัติ": p.approvedBy || '-',
        "หมายเหตุ": [
          p.notes || '',
          recon.isMultiItem ? `[PO หลายรายการ (${p.items.length} รายการ): ความคืบหน้าคิดตามมูลค่าส่งมอบ]` : '',
          recon.hasUnitMismatch ? `[⚠️ ตั๋วหน่วยไม่ตรงกับ PO: ${recon.unitMismatchWarnings?.join('; ')}]` : ''
        ].filter(Boolean).join(' ')
      };
    });
    const poSheet = XLSX.utils.json_to_sheet(poRows);
    XLSX.utils.book_append_sheet(workbook, poSheet, "ใบสั่งซื้อ_PO");
  }

  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `ระบบจัดการร้านค้า_ใบสั่งซื้อ_และประวัติบิล_39คอลัมน์_${today}.xlsx`);
}

export function exportStoreStatement(store: StoreMerchant, orders: OrderRecord[]) {
  const workbook = XLSX.utils.book_new();
  const storeOrders = orders.filter(
    o => (o.storeId === store.id || (o.col8 && o.col8.trim().toLowerCase() === store.name.trim().toLowerCase())) &&
         o.docType !== 'dest_weighbridge'
  );

  const rows = storeOrders.map((r, idx) => ({
    "ลำดับ": idx + 1,
    "เลข TR": r.col1,
    "วันที่": r.col7,
    "โครงการ": r.col2,
    "เลข DO / ตั๋ว": r.col6,
    "เลข PO": r.col4,
    "รายการสินค้า": r.col11,
    "ปริมาณ": r.col22,
    "หน่วย": r.col23,
    "ราคา/หน่วย": r.col24,
    "ค่าสินค้า": r.col25,
    "ค่าขนส่ง": r.col28,
    "รวมทั้งสิ้น": r.col29,
    "ชำระแล้ว": r.col35,
    "ยอดคงค้าง": r.col36,
    "เงื่อนไขการจ่าย": r.col30,
    "หมายเหตุ": r.col38
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement");

  const safeName = store.name.replace(/[/\\?%*:|"<>]/g, '_');
  const today = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `Statement_${safeName}_${today}.xlsx`);
}
