import React, { useMemo, useState } from 'react';
import { FileText, Printer, RotateCcw, Search } from 'lucide-react';
import { ContractorChargeDocument, ContractorChargeLine, OrderItemDetail, OrderRecord, PurchaseOrder } from '../types';
import { isExactDocNumberReference } from '../utils/poReconciliation';

interface ContractorBillingViewProps {
  orders: OrderRecord[];
  pos: PurchaseOrder[];
  documents: ContractorChargeDocument[];
  isLoading: boolean;
  loadError: string;
  currentUserName: string;
  companyName: string;
  companyAddress: string;
  onReload: () => void;
  onIssueDocument: (document: ContractorChargeDocument) => Promise<void>;
  onCancelDocument: (id: string) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'info' | 'error') => void;
}

interface ChargeCandidate {
  key: string;
  order: OrderRecord;
  item: OrderItemDetail;
  po: PurchaseOrder;
  contractorName: string;
  availableQty: number;
}

const money = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const makeDocumentNumber = () => {
  const date = new Date();
  const datePart = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `CM-${datePart}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
};

export const ContractorBillingView: React.FC<ContractorBillingViewProps> = ({
  orders,
  pos,
  documents,
  isLoading,
  loadError,
  currentUserName,
  companyName,
  companyAddress,
  onReload,
  onIssueDocument,
  onCancelDocument,
  showToast
}) => {
  const [contractorName, setContractorName] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [deductFromContractor, setDeductFromContractor] = useState(true);
  const [documentNotes, setDocumentNotes] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<ContractorChargeDocument | null>(null);
  const [cancelConfirmationId, setCancelConfirmationId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const chargedQtyBySource = useMemo(() => {
    const totals = new Map<string, number>();
    for (const document of documents) {
      if (document.status !== 'issued') continue;
      for (const line of document.lines) {
        const key = `${line.sourceOrderId}::${line.sourceItemId}`;
        totals.set(key, (totals.get(key) || 0) + line.quantity);
      }
    }
    return totals;
  }, [documents]);

  const candidates = useMemo<ChargeCandidate[]>(() => {
    const result: ChargeCandidate[] = [];
    for (const order of orders) {
      if (!['delivery_order', 'concrete', 'full_logistics'].includes(order.docType || '')) continue;
      const assignedContractor = order.col9.trim();
      if (!assignedContractor) continue;
      const po = pos.find(candidate => isExactDocNumberReference(order.col4, candidate.poNumber));
      if (!po) continue;
      for (const item of order.lineItems || []) {
        if (!item.id || item.contractorChargeDecision !== 'chargeable') continue;
        const totalQty = Number(item.qty) || 0;
        const charged = chargedQtyBySource.get(`${order.id}::${item.id}`) || 0;
        const availableQty = Math.max(0, totalQty - charged);
        if (availableQty <= 0) continue;
        result.push({
          key: `${order.id}::${item.id}`,
          order,
          item,
          po,
          contractorName: assignedContractor,
          availableQty
        });
      }
    }
    return result;
  }, [orders, pos, chargedQtyBySource]);

  const contractorOptions = [...new Set(candidates.map(candidate => candidate.contractorName))]
    .sort((left, right) => left.localeCompare(right, 'th'));
  const visibleCandidates = candidates.filter(candidate => candidate.contractorName === contractorName);
  const selectedCandidates = visibleCandidates.filter(candidate => selectedKeys.includes(candidate.key));
  const totalAmount = Math.round(selectedCandidates.reduce((sum, candidate) => {
    const quantity = Number(quantities[candidate.key] ?? candidate.availableQty);
    const unitPrice = Number(prices[candidate.key] ?? candidate.item.unitPrice ?? 0);
    return sum + Math.round(quantity * unitPrice * 100) / 100;
  }, 0) * 100) / 100;

  const toggleCandidate = (candidate: ChargeCandidate) => {
    setSelectedKeys(previous => previous.includes(candidate.key)
      ? previous.filter(key => key !== candidate.key)
      : [...previous, candidate.key]);
  };

  const selectAllVisible = () => setSelectedKeys(visibleCandidates.map(candidate => candidate.key));

  const handleIssueDocument = async () => {
    if (!contractorName || selectedCandidates.length === 0) {
      showToast('เลือกผู้รับเหมาและรายการ DO อย่างน้อยหนึ่งรายการก่อนออกเอกสาร', 'error');
      return;
    }

    const lines: ContractorChargeLine[] = selectedCandidates.map(candidate => {
      const quantity = Number(quantities[candidate.key] ?? candidate.availableQty);
      const unitPrice = Number(prices[candidate.key] ?? candidate.item.unitPrice ?? 0);
      return {
        id: crypto.randomUUID(),
        sourceOrderId: candidate.order.id,
        sourceItemId: candidate.item.id!,
        sourcePoId: candidate.po.id,
        sourcePoNumber: candidate.po.poNumber,
        sourceDoNumber: candidate.order.col6,
        projectName: candidate.order.col2,
        itemDescription: candidate.item.itemDescription,
        specCode: candidate.item.specCode,
        quantity,
        unit: candidate.item.unit,
        unitPrice,
        totalAmount: Math.round(quantity * unitPrice * 100) / 100
      };
    });

    const invalidLine = lines.find(line =>
      !Number.isFinite(line.quantity) || line.quantity <= 0 ||
      line.quantity > (candidates.find(candidate =>
        candidate.order.id === line.sourceOrderId && candidate.item.id === line.sourceItemId
      )?.availableQty || 0) ||
      !Number.isFinite(line.unitPrice) || line.unitPrice <= 0
    );
    if (invalidLine) {
      showToast('ตรวจสอบจำนวนคงเหลือและกรอกราคาต่อหน่วยให้ครบก่อนออกเอกสาร', 'error');
      return;
    }

    const projectNames = [...new Set(lines.map(line => line.projectName).filter(Boolean))];
    const now = new Date().toISOString();
    const document: ContractorChargeDocument = {
      id: crypto.randomUUID(),
      documentNumber: makeDocumentNumber(),
      contractorName,
      issueDate: now.slice(0, 10),
      projectName: projectNames.length === 1 ? projectNames[0] : 'หลายโครงการ',
      deductFromContractor,
      status: 'issued',
      subtotalAmount: totalAmount,
      lines,
      notes: documentNotes.trim() || undefined,
      createdBy: currentUserName,
      createdAt: now,
      updatedAt: now
    };

    setIsSaving(true);
    try {
      await onIssueDocument(document);
      setSelectedKeys([]);
      setQuantities({});
      setPrices({});
      setDocumentNotes('');
      setDeductFromContractor(true);
      setSelectedDocument(document);
      showToast(`ออกเอกสารแนบ ${document.documentNumber} แล้ว`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelDocument = async (documentId: string) => {
    setIsSaving(true);
    try {
      await onCancelDocument(documentId);
      setCancelConfirmationId('');
      showToast('ยกเลิกเอกสารแล้ว และคืนจำนวนให้เลือกทำเอกสารใหม่ได้');
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <span>โหลดเอกสารแนบหักผู้รับเหมาไม่สำเร็จ: {loadError}</span>
          <button type="button" onClick={onReload} className="rounded-lg border border-rose-300 bg-white px-3 py-2 font-semibold">ลองโหลดใหม่</button>
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">เอกสารแนบหักค่าวัสดุผู้รับเหมา</h2>
          <p className="mt-1 text-xs text-slate-600">เลือกเฉพาะรายการ DO ที่กำหนดให้หักไว้แล้ว เพื่อแนบกับเอกสารเบิกค่างาน</p>
          <p className="mt-1 text-[11px] text-slate-500">เอกสารภายใน ไม่ใช่ใบกำกับภาษี และไม่เปลี่ยนยอดเจ้าหนี้ร้านค้า</p>
        </div>
        {isLoading && <span role="status" className="text-xs text-slate-500">กำลังโหลดเอกสาร...</span>}
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><FileText className="h-4 w-4 text-violet-700" />รายการ DO ที่รอทำเอกสาร</h3>
            <select
              aria-label="เลือกผู้รับเหมา"
              value={contractorName}
              onChange={event => {
                setContractorName(event.target.value);
                setSelectedKeys([]);
              }}
              className="min-w-56 rounded-lg border border-slate-300 px-3 py-2 text-xs"
            >
              <option value="">เลือกผู้รับเหมา</option>
              {contractorOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>ผู้รับเหมาจากช่อง 9 · ราคาใส่ได้ในเอกสาร แม้ PO ไม่มีราคา</span>
            <button type="button" disabled={!contractorName || visibleCandidates.length === 0} onClick={selectAllVisible} className="font-bold text-violet-700 disabled:opacity-40">เลือก DO ทั้งหมด</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead><tr className="border-b bg-slate-50 text-slate-600"><th className="p-2">เลือก</th><th className="p-2">วัสดุ / DO / PO</th><th className="p-2">จำนวนที่เลือก</th><th className="p-2">ราคา/หน่วย</th><th className="p-2">ยอด</th></tr></thead>
              <tbody>
                {visibleCandidates.map(candidate => {
                  const selected = selectedKeys.includes(candidate.key);
                  const quantity = Number(quantities[candidate.key] ?? candidate.availableQty);
                  const unitPrice = Number(prices[candidate.key] ?? candidate.item.unitPrice ?? 0);
                  return (
                    <tr key={candidate.key} className="border-b last:border-0">
                      <td className="p-2"><input aria-label={`เลือก ${candidate.item.itemDescription} จาก DO ${candidate.order.col6}`} type="checkbox" checked={selected} onChange={() => toggleCandidate(candidate)} /></td>
                      <td className="p-2">
                        <div className="font-semibold text-slate-800">{candidate.item.itemDescription || 'ไม่ระบุวัสดุ'}</div>
                        <div className="text-slate-500">DO {candidate.order.col6} · PO {candidate.po.poNumber} · {candidate.order.col2}</div>
                        <div className="text-slate-400">คงเหลือ {candidate.availableQty} {candidate.item.unit}</div>
                      </td>
                      <td className="p-2"><input aria-label="จำนวนเรียกเก็บ" type="number" min="0.001" max={candidate.availableQty} step="any" value={quantities[candidate.key] ?? candidate.availableQty} onChange={event => setQuantities(previous => ({ ...previous, [candidate.key]: event.target.value }))} disabled={!selected} className="w-24 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100" /> <span>{candidate.item.unit}</span></td>
                      <td className="p-2"><input aria-label="ราคาต่อหน่วย" type="number" min="0.01" step="0.01" value={prices[candidate.key] ?? candidate.item.unitPrice ?? ''} onChange={event => setPrices(previous => ({ ...previous, [candidate.key]: event.target.value }))} disabled={!selected} className="w-28 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100" /></td>
                      <td className="p-2 text-right font-semibold">{selected ? money(quantity * unitPrice) : '—'}</td>
                    </tr>
                  );
                })}
                {visibleCandidates.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-500">
                    {contractorName ? 'ไม่พบรายการ DO ที่พร้อมทำเอกสารสำหรับผู้รับเหมานี้' : 'เลือกผู้รับเหมาเพื่อดู DO ที่กำหนดให้หัก'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="h-fit space-y-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
          <h3 className="text-sm font-bold text-violet-950">สรุปเอกสารแนบ</h3>
          <div className="rounded-lg border border-violet-100 bg-white p-3 text-xs">
            <div>ผู้รับเหมา: <strong>{contractorName || 'ยังไม่เลือก'}</strong></div>
            <div className="mt-1">เลือกแล้ว: <strong>{selectedCandidates.length}</strong> รายการ</div>
            <div className="mt-2 border-t pt-2 text-right text-sm font-bold">รวม {money(totalAmount)} บาท</div>
          </div>
          <label className="block text-xs font-semibold text-slate-700">
            หมายเหตุ
            <textarea value={documentNotes} onChange={event => setDocumentNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={deductFromContractor} onChange={event => setDeductFromContractor(event.target.checked)} className="mt-0.5" />
            นำเอกสารฉบับนี้ไปหักค่าวัสดุจากผู้รับเหมา
          </label>
          <button type="button" disabled={isSaving || isLoading || !contractorName || selectedCandidates.length === 0} onClick={() => void handleIssueDocument()} className="w-full rounded-lg bg-violet-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">
            {isSaving ? 'กำลังออกเอกสาร...' : 'ออกเอกสารแนบ'}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b px-4 py-3 text-sm font-bold text-slate-800">ประวัติเอกสารแนบ</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead><tr className="border-b bg-slate-50 text-slate-600"><th className="p-3">เลขที่เอกสาร</th><th className="p-3">วันที่</th><th className="p-3">ผู้รับเหมา</th><th className="p-3">รายการ</th><th className="p-3 text-right">รวม</th><th className="p-3">สถานะ/จัดการ</th></tr></thead>
            <tbody>
              {documents.map(document => (
                <tr key={document.id} className="border-b last:border-0">
                  <td className="p-3 font-semibold">{document.documentNumber}</td>
                  <td className="p-3">{document.issueDate}</td>
                  <td className="p-3">{document.contractorName}</td>
                  <td className="p-3">{document.lines.length} รายการ</td>
                  <td className="p-3 text-right">{money(document.subtotalAmount)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={document.status === 'issued' ? 'text-emerald-700' : 'text-slate-500'}>
                        {document.status === 'issued'
                          ? (document.deductFromContractor ? 'ออกแล้ว · หักผู้รับเหมา' : 'ออกแล้ว · ไม่หัก')
                          : 'ยกเลิก'}
                      </span>
                      <button type="button" onClick={() => setSelectedDocument(document)} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-semibold"><Search className="h-3 w-3" />ดู/พิมพ์</button>
                      {document.status === 'issued' && (cancelConfirmationId === document.id
                        ? <><button type="button" disabled={isSaving} onClick={() => void handleCancelDocument(document.id)} className="font-semibold text-rose-700">ยืนยันยกเลิก</button><button type="button" onClick={() => setCancelConfirmationId('')} className="text-slate-600">กลับ</button></>
                        : <button type="button" onClick={() => setCancelConfirmationId(document.id)} className="inline-flex items-center gap-1 font-semibold text-rose-700"><RotateCcw className="h-3 w-3" />ยกเลิก</button>)}
                    </div>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">ยังไม่มีเอกสารแนบหัก</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDocument && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 print:static print:block print:bg-white print:p-0">
          <div className="contractor-charge-print relative max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-8 shadow-xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:p-0 print:shadow-none">
            <div className="contractor-charge-no-print absolute right-4 top-4 flex gap-2">
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white"><Printer className="h-4 w-4" />พิมพ์เอกสาร</button>
              <button type="button" onClick={() => setSelectedDocument(null)} className="rounded-lg border px-3 py-2 text-xs font-semibold">ปิด</button>
            </div>
            <style>{`@media print { body * { visibility: hidden !important; } .contractor-charge-print, .contractor-charge-print * { visibility: visible !important; } .contractor-charge-print { position: absolute !important; inset: 0 !important; width: 100% !important; } .contractor-charge-no-print { display: none !important; } }`}</style>
            <div className="mb-6 border-b-2 border-slate-800 pb-4 pr-36">
              <h1 className="text-xl font-bold">{companyName}</h1>
              <p className="mt-1 text-xs">{companyAddress}</p>
              <h2 className="mt-5 text-center text-lg font-bold">เอกสารสรุปค่าวัสดุผู้รับเหมา</h2>
              <p className="mt-1 text-center text-xs">เอกสารภายในสำหรับประกอบการเบิกค่างาน — ไม่ใช่ใบกำกับภาษี</p>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div>เลขที่: <strong>{selectedDocument.documentNumber}</strong></div>
              <div>วันที่: <strong>{selectedDocument.issueDate}</strong></div>
              <div>ผู้รับเหมา: <strong>{selectedDocument.contractorName}</strong></div>
              <div>โครงการ: <strong>{selectedDocument.projectName}</strong></div>
              <div className="col-span-2">การใช้งาน: <strong>{selectedDocument.deductFromContractor ? 'นำไปหักจากผู้รับเหมา' : 'เอกสารประกอบ ไม่หักเงิน'}</strong></div>
            </div>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-slate-100"><th className="border p-2">ลำดับ</th><th className="border p-2 text-left">วัสดุ</th><th className="border p-2">PO / DO</th><th className="border p-2">จำนวน</th><th className="border p-2">ราคา/หน่วย</th><th className="border p-2">รวม</th></tr></thead>
              <tbody>{selectedDocument.lines.map((line, index) => (
                <tr key={line.id}>
                  <td className="border p-2 text-center">{index + 1}</td>
                  <td className="border p-2">{line.itemDescription}{line.specCode ? ` (${line.specCode})` : ''}</td>
                  <td className="border p-2 text-center">{line.sourcePoNumber}<br />{line.sourceDoNumber}</td>
                  <td className="border p-2 text-right">{line.quantity} {line.unit}</td>
                  <td className="border p-2 text-right">{money(line.unitPrice)}</td>
                  <td className="border p-2 text-right">{money(line.totalAmount)}</td>
                </tr>
              ))}</tbody>
            </table>
            <div className="mt-3 text-right text-sm font-bold">รวมทั้งสิ้น {money(selectedDocument.subtotalAmount)} บาท</div>
            {selectedDocument.notes && <p className="mt-3 text-xs">หมายเหตุ: {selectedDocument.notes}</p>}
            <div className="mt-16 grid grid-cols-2 gap-16 text-center text-xs">
              <div><div className="mb-2 border-b border-slate-500" />ผู้รับเหมา / ผู้รับทราบ</div>
              <div><div className="mb-2 border-b border-slate-500" />ผู้จัดทำ ({selectedDocument.createdBy})</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
