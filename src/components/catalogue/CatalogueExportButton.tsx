import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { productsApi, type ProductListQuery } from '../../api/products';
import type { Category } from '../../api/categories';
import { ApiError } from '../../api/client';
import { friendlyError } from '../../api/errors';
import { saveBlob } from '../uploads/shared';
import { catalogueWorkbook, collectCatalogue } from './catalogueExport';

export const CatalogueExportButton: React.FC<{ filter: ProductListQuery; categories: Map<string, Category>; disabled?: boolean }> = ({ filter, categories, disabled }) => {
  const controller = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const run = async () => {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setLoaded(0); setError(null); setMessage('');
    try {
      const products = await collectCatalogue(productsApi.list, filter, current.signal, setLoaded);
      const bytes = await catalogueWorkbook(products, categories);
      current.signal.throwIfAborted();
      saveBlob(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `qorloop-catalogue-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setMessage(`Exported ${products.length.toLocaleString()} ${products.length === 1 ? 'product' : 'products'}.`);
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof ApiError ? friendlyError(cause).message : cause instanceof Error ? cause.message : 'Could not export the catalogue. Please try again.');
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setLoaded(null);
    }
  };
  return <div className="space-y-1">
    <button type="button" onClick={() => void run()} disabled={disabled || loaded !== null} aria-busy={loaded !== null}
      title="Export every product matching the current tab, search and category, including rows not loaded on screen."
      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#027864] bg-white border border-[#027864]/40 rounded-lg hover:bg-[#E3FAF3] disabled:opacity-50">
      {loaded === null ? <Download className="h-3.5 w-3.5" aria-hidden /> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {loaded === null ? 'Export Excel' : `Exporting ${loaded.toLocaleString()}…`}
    </button>
    <p className="max-w-56 text-[10px] text-gray-500">Includes every product matching the current tab and filters.</p>
    <p role="status" className="text-[11px] text-gray-600">{message}</p>
    {error && <p role="alert" className="max-w-64 text-[11px] text-red-700">{error}</p>}
  </div>;
};
