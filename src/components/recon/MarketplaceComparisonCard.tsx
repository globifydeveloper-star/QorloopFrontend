import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, GitCompare } from 'lucide-react';
import { ApiError } from '../../api/client';
import { productsApi, type MarketplacesDiffer } from '../../api/products';
import type { ReconMarketplaceSummary } from '../../api/recon';
import { pathFor } from '../../routes/paths';
import { count } from '../pricing/priceChange';
import { freshnessText, marketplaceName } from './shared';

/** The Catalogue with two marketplaces side by side, optionally only where they differ (?marketplace=&compare=&differ=). */
export const compareLink = (a: string, b: string, differ?: MarketplacesDiffer) =>
  `${pathFor('catalogue')}?${new URLSearchParams({ marketplace: a, compare: b, ...(differ ? { differ } : {}) })}`;

const KINDS: { differ: MarketplacesDiffer; label: string; testId: string }[] = [
  { differ: 'any', label: 'Products that differ', testId: 'compare-any' },
  { differ: 'price', label: 'Price differs', testId: 'compare-price' },
  { differ: 'availability', label: 'Availability differs', testId: 'compare-availability' },
];

/** A 400 from a backend that cannot compare two marketplaces, in plain words; anything else is a load error. */
function problemText(e: unknown): string {
  if (e instanceof ApiError && e.status === 400) {
    const d = e.details.find(x => x.path === 'compareMarketplaceId' || x.path === 'marketplaceId');
    return d?.message ?? 'This server cannot compare two marketplaces yet.';
  }
  return 'We could not load the comparison. Try again later.';
}

/**
 * The Dashboard's "Talabat vs Snoonu": how many products differ between two marketplaces' latest files, compared with
 * each other (not with the catalogue). Each count is the server's (GET /api/products ... &marketplacesDiffer=…&limit=1,
 * its tab count "all") and opens the Catalogue with that comparison. Needs two marketplaces with a file and products.view.
 */
export const MarketplaceComparisonCard: React.FC<{ marketplaces: ReconMarketplaceSummary[] }> = ({ marketplaces }) => {
  const withFile = marketplaces.filter(m => m.hasData);
  const ids: string[] = withFile.map(m => m.marketplaceId);
  const [pair, setPair] = useState<[string, string]>(() => [ids[0] ?? '', ids[1] ?? '']);
  // Marketplaces come and go (an upload, a switch): keep the pair valid, else the first two.
  const valid = ids.includes(pair[0]) && ids.includes(pair[1]) && pair[0] !== pair[1];
  const [a, b] = valid ? pair : [ids[0] ?? '', ids[1] ?? ''];
  const idsKey = ids.join();
  useEffect(() => { if (!valid && ids.length >= 2) setPair([ids[0]!, ids[1]!]); }, [valid, idsKey]);

  const files = withFile.filter(m => m.marketplaceId === a || m.marketplaceId === b).map(m => m.lastUploadAt).join('|');
  const results = useQueries({
    queries: KINDS.map(k => ({
      // Under ['products'], so a catalogue change refreshes it; a new file (lastUploadAt) asks again.
      queryKey: ['products', 'marketplace-compare', a, b, k.differ, files] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => productsApi.list({ tab: 'all', marketplaceId: a, compareMarketplaceId: b, marketplacesDiffer: k.differ, limit: 1 }, signal).then(p => p.counts.all),
      enabled: Boolean(a && b),
      retry: false,
    })),
  });
  if (ids.length < 2 || !a || !b) return null;

  const aName = marketplaceName(a);
  const bName = marketplaceName(b);
  const error = results.find(r => r.isError)?.error;
  const choose = (which: 0 | 1, id: string) => {
    const next: [string, string] = which === 0 ? [id, b] : [a, id];
    // Choosing the other side's marketplace swaps them.
    if (next[0] === next[1]) next[1 - which] = which === 0 ? a : b;
    setPair(next);
  };
  const stale = withFile.filter(m => (m.marketplaceId === a || m.marketplaceId === b) && m.stale);

  return (
    <section aria-labelledby="mp-compare-heading" className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 id="mp-compare-heading" className="inline-flex items-center gap-2 text-sm font-bold text-gray-900">
            <GitCompare className="w-4 h-4 text-[#027864]" aria-hidden /> {aName} vs {bName}
          </h2>
          <p className="mt-1 text-[11px] text-gray-500">
            The two marketplaces compared with each other, from their latest files. A product on only one of them counts as different.
          </p>
        </div>
        {ids.length > 2 && (
          <div className="flex items-center gap-2 text-xs">
            <label className="sr-only" htmlFor="mp-compare-a">First marketplace</label>
            <select id="mp-compare-a" value={a} onChange={e => choose(0, e.target.value)} className="h-8 px-2 border border-gray-300 rounded-lg bg-white">
              {ids.map(id => <option key={id} value={id}>{marketplaceName(id)}</option>)}
            </select>
            <span className="text-gray-500">vs</span>
            <label className="sr-only" htmlFor="mp-compare-b">Second marketplace</label>
            <select id="mp-compare-b" value={b} onChange={e => choose(1, e.target.value)} className="h-8 px-2 border border-gray-300 rounded-lg bg-white">
              {ids.map(id => <option key={id} value={id}>{marketplaceName(id)}</option>)}
            </select>
          </div>
        )}
      </header>

      {stale.length > 0 && (
        <p role="note" data-testid="compare-stale" className="text-[11px] font-semibold text-amber-800">
          {stale.map(m => freshnessText(m)).filter(Boolean).join('; ')}. Upload a fresh file for a reliable comparison.
        </p>
      )}

      {error ? (
        <p role="status" data-testid="compare-problem" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{problemText(error)}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {KINDS.map((k, i) => {
            const r = results[i]!;
            const value = r.data;
            return (
              <Link key={k.differ} to={compareLink(a, b, k.differ)}
                aria-label={`${k.label}: ${value === undefined ? 'loading' : count(value)}. Open them in the Catalogue`}
                className="block rounded-xl border border-gray-200 bg-[#F8FBFA] p-3 hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864]">
                <span className="text-[11px] font-medium text-gray-500 flex items-center justify-between">{k.label}<ChevronRight className="w-3.5 h-3.5" aria-hidden /></span>
                <span data-testid={k.testId} className={`mt-1 block text-2xl font-bold ${value ? 'text-gray-900' : 'text-[#027864]'}`}>
                  {value === undefined ? '…' : count(value)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <Link to={compareLink(a, b)} data-testid="compare-open" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#027864] hover:underline">
        See {aName} and {bName} side by side in the Catalogue <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </section>
  );
};
