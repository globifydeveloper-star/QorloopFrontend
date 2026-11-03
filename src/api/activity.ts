import { api } from './client';

export const ACTIVITY_GROUPS = ['price', 'stock_uploads', 'catalogue', 'team_security'] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];
export type SafeValue = string | number | boolean | null | Record<string, string | number | boolean | null>;
export interface ActivityItem {
  id: string; time: string;
  actor: { id: string | null; name: string; email: string | null };
  type: string; group: ActivityGroup; summary: string;
  beforeAfter: { field: string; before: SafeValue; after: SafeValue }[];
  scope: 'product' | 'tenant'; productId: string | null; uploadId: string | null;
}
export interface ActivityPage { items: ActivityItem[]; nextCursor: string | null }
export interface ProductHistoryPage extends ActivityPage { coverageNotice: string }
export interface ActivityFilters {
  eventType?: ActivityGroup; actorId?: string; from?: string; to?: string; productId?: string;
}
export interface ActivityQuery extends ActivityFilters { limit?: number; cursor?: string }
const queryOf = (q: ActivityQuery) => ({
  eventType: q.eventType, actorId: q.actorId, from: q.from, to: q.to, productId: q.productId, limit: q.limit, cursor: q.cursor,
});
export const activityApi = {
  list: (q: ActivityQuery = {}, signal?: AbortSignal) => api<ActivityPage>('/api/activity', { query: queryOf(q), signal }),
  history: (id: string, q: ActivityQuery = {}, signal?: AbortSignal) => api<ProductHistoryPage>(`/api/products/${encodeURIComponent(id)}/history`, { query: queryOf(q), signal }),
};
