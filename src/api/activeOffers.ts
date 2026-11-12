import { api } from './client';

export interface ActiveOffer {
  productId: string;
  nameEn: string;
  barcode: string;
  erpPrice: number;
  price: number;
  validFrom: string | null;
  validUntil: string | null;
}

export interface ActiveOffersPage {
  asOf: string;
  total: number;
  page: number;
  limit: number;
  items: ActiveOffer[];
}

export const activeOffersApi = {
  list: (page = 1, limit = 20, signal?: AbortSignal) =>
    api<ActiveOffersPage>('/api/pricing/active-offers', { query: { page, limit }, signal }),
};
