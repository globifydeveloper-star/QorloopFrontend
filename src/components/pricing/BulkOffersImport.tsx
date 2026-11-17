import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pricingApi } from '../../api/pricing';
import { productsApi, type ProductItem } from '../../api/products';
import { collectCatalogue } from '../catalogue/catalogueExport';
import { saveBlob } from '../uploads/shared';
import { invalidatePriced, pricingErrorText } from './shared';
import { previewOffers, type OfferRow } from './bulkOffers';

const HEADERS = ['Barcode', 'Action', 'Offer price (QAR)', 'Starts (Qatar time)', 'Ends (Qatar time)'];
const MAX_ROWS = 500;

export const BulkOffersImport: React.FC<{ selectedIds: readonly string[]; onClose: () => void }> = ({ selectedIds, onClose }) => {
  const qc = useQueryClient();
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  const catalogue = async (): Promise<ProductItem[]> => {
    const products = await collectCatalogue(productsApi.list, { tab: 'all' }, new AbortController().signal, () => undefined);
    return selectedIds.length ? products.filter(p => selectedIds.includes(p.id)) : products;
  };
  const template = async () => {
    setBusy(true); setMessage('');
    try {
      const XLSX = await import('xlsx');
      const products = await catalogue();
      const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...products.map(p => [p.barcode, 'set', '', '', ''])]);
      sheet['!cols'] = HEADERS.map(h => ({ wch: h.includes('time') ? 26 : 22 }));
      for (let i = 1; i <= products.length; i++) { const cell = sheet[`A${i + 1}`]; if (cell) cell.t = 's'; }
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Offers');
      saveBlob(new Blob([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as BlobPart]), 'qorloop-bulk-offers.xlsx');
      setMessage(`Template includes ${products.length} products. Fill only the rows you want to change; remove the rest.`);
    } catch (error) { setMessage(pricingErrorText(error)); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setReady(false); setRows([]); setFailures([]); setProgress(0); setMessage('');
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error('The file has no sheet.');
      const values = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
      if (!values.length || values.length > MAX_ROWS) throw new Error(`Include 1 to ${MAX_ROWS} offer rows.`);
      if (!HEADERS.every(h => Object.keys(values[0]).includes(h))) throw new Error(`Use these columns: ${HEADERS.join(', ')}.`);
      // Excel often turns a typed local date into a serial. Read it as Qatar wall time.
      const normalized = values.map(row => {
        const copy = { ...row };
        for (const header of HEADERS.slice(3)) {
          if (typeof copy[header] === 'number') {
            const parts = XLSX.SSF.parse_date_code(copy[header]);
            copy[header] = parts ? `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')} ${String(parts.H).padStart(2, '0')}:${String(parts.M).padStart(2, '0')}` : copy[header];
          }
        }
        return copy;
      });
      const preview = previewOffers(normalized, await catalogue());
      setRows(preview); setReady(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read the offer file.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy || !ready || rows.some(r => r.error)) return;
    setBusy(true); setProgress(0); setFailures([]); setMessage('');
    const failed: string[] = [];
    for (const row of rows) {
      try {
        if (row.action === 'clear') await pricingApi.deleteOffer(row.product!.id);
        else await pricingApi.setOffer(row.product!.id, { price: row.price!, validFrom: row.validFrom, validUntil: row.validUntil });
      } catch (error) { failed.push(`${row.barcode}: ${pricingErrorText(error)}`); }
      setProgress(n => n + 1);
    }
    invalidatePriced(qc);
    void qc.invalidateQueries({ queryKey: ['pricing', 'active-offers'] });
    setFailures(failed); setReady(false); setBusy(false);
    setMessage(`${rows.length - failed.length} of ${rows.length} offer changes saved${failed.length ? `; ${failed.length} failed` : ''}.`);
  };
  const invalid = rows.filter(r => r.error);
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Bulk update offers" className="bg-white border border-gray-200 rounded-2xl p-5 shadow-lg space-y-3 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
    <div>
      <div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold text-gray-900">Bulk update offers</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close bulk offers" className="px-2 py-1 rounded border border-gray-300 disabled:opacity-50">Close</button></div>
      <p className="text-xs text-gray-600 mt-1">Download the Excel template, enter a different offer price for each product, and optionally set start and end times in Qatar time (YYYY-MM-DD HH:mm). Use Action “clear” to remove an offer. Each offer applies on every marketplace.</p>
      <p className="text-xs text-gray-600 mt-1">{selectedIds.length ? `The template and import are limited to the ${selectedIds.length} ticked products.` : 'No rows ticked: the template covers the whole catalogue.'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" disabled={busy} onClick={() => void template()} className="rounded-lg border border-gray-300 px-3 py-2 font-semibold disabled:opacity-50">Download template</button>
      <label className="font-semibold">Choose completed Excel file <input aria-label="Offer Excel file" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} className="block mt-1 font-normal" /></label>
    </div>
    {busy && <p role="status" className="text-xs">{rows.length && !ready ? `Updating ${progress} of ${rows.length}…` : 'Reading products and offers…'}</p>}
    {message && <p role="status" className="text-xs text-gray-700">{message}</p>}
    {rows.length > 0 && <div className="space-y-2">
      <p className="text-xs font-semibold">{rows.length} rows · {invalid.length} errors · {rows.filter(r => r.action === 'set').length} set · {rows.filter(r => r.action === 'clear').length} clear</p>
      <div className="max-h-72 overflow-auto border rounded-lg"><table className="w-full text-xs"><thead><tr className="bg-gray-50"><th className="p-2 text-left">Barcode</th><th className="p-2 text-left">Product</th><th className="p-2 text-left">Action</th><th className="p-2 text-left">Price</th><th className="p-2 text-left">Result</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{r.barcode}</td><td className="p-2">{r.product?.nameEn ?? '—'}</td><td className="p-2">{r.action}</td><td className="p-2">{r.price ?? '—'}</td><td className={`p-2 ${r.error ? 'text-red-700' : 'text-green-700'}`}>{r.error ?? 'Ready'}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-gray-500">Changes are sent one product at a time. If one fails, successful changes remain saved.</p>
      <button type="button" disabled={busy || !ready || invalid.length > 0} onClick={() => void apply()} className="rounded-lg bg-[#027864] text-white px-4 py-2 text-xs font-semibold disabled:opacity-50">Apply {rows.length} offer changes</button>
    </div>}
    {failures.length > 0 && <div role="alert" className="text-xs text-red-700">{failures.map(f => <p key={f}>{f}</p>)}</div>}
    </section>
  </div>;
};
