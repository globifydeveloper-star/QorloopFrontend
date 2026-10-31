import { ApiError, api } from './client';

/**
 * Categories API (/api/categories…). Mirrors the backend's categories module:
 *   packages/shared/src/contracts.ts (createCategory, updateCategory, assignFromErp)
 *   apps/api/src/products/categories.service.ts (responses)
 * The tree is two levels deep: top-level categories and their subcategories.
 */

const enc = encodeURIComponent;

export interface Category {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  sort: number;
  /** Products filed under this category (or subcategory). */
  productCount: number;
}

export interface CategoryNode extends Category {
  children: Category[];
}

export interface ErpCategorySuggestion {
  erpCategory: string;
  products: number;
  /** Products with this ERP category and no Qorloop category yet. */
  unassigned: number;
}

export interface CreateCategoryRequest {
  nameEn: string;
  nameAr?: string;
  /** Set to create a subcategory under a top-level category. */
  parentId?: string | null;
  sort?: number;
}

export interface UpdateCategoryRequest {
  nameEn?: string;
  nameAr?: string | null;
  parentId?: string | null;
  sort?: number;
}

/** POST /:id/assign-from-erp takes 1..50 ERP category texts. */
export const ASSIGN_ERP_MAX = 50;

export const categoriesApi = {
  tree: (signal?: AbortSignal) => api<CategoryNode[]>('/api/categories', { signal }),
  /** Needs categories.manage. */
  erpSuggestions: (signal?: AbortSignal) => api<ErpCategorySuggestion[]>('/api/categories/erp-suggestions', { signal }),
  create: (body: CreateCategoryRequest) => api<Category>('/api/categories', { method: 'POST', body }),
  update: (id: string, body: UpdateCategoryRequest) => api<Category>(`/api/categories/${enc(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api<{ id: string; deleted: boolean }>(`/api/categories/${enc(id)}`, { method: 'DELETE' }),
  /** Files uncategorised products whose ERP category is one of `erpCategories` under this (top-level) category. */
  assignFromErp: (id: string, erpCategories: string[]) =>
    api<{ updated: number }>(`/api/categories/${enc(id)}/assign-from-erp`, { method: 'POST', body: { erpCategories } }),
};

const IN_USE_LABELS: Record<string, [string, string]> = {
  products: ['product', 'products'],
  children: ['subcategory', 'subcategories'],
  mappings: ['marketplace mapping', 'marketplace mappings'],
  priceRules: ['price rule', 'price rules'],
};

/**
 * What a 409 from DELETE (or a move in PATCH) says is still using the category, from its `{ path, count }` details:
 * e.g. "12 products, 2 subcategories". Undefined when the error carries no counts.
 */
export function inUseSummary(e: unknown): string | undefined {
  if (!(e instanceof ApiError) || e.status !== 409) return undefined;
  const parts = (e.details as { path?: string; count?: number }[])
    .filter(d => d.path && typeof d.count === 'number' && d.count > 0)
    .map(d => {
      const [one, many] = IN_USE_LABELS[d.path!] ?? [d.path!, d.path!];
      return `${d.count} ${d.count === 1 ? one : many}`;
    });
  return parts.length ? parts.join(', ') : undefined;
}

/** Flat id → category lookup over the tree (subcategories included). */
export function indexCategories(tree: CategoryNode[] | undefined): Map<string, Category> {
  const map = new Map<string, Category>();
  for (const c of tree ?? []) {
    map.set(c.id, c);
    for (const s of c.children) map.set(s.id, s);
  }
  return map;
}
