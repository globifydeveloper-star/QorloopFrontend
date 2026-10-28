import React, { createContext, useContext, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { matchView, pathFor } from '../routes/paths';
import {
  INITIAL_CATEGORIES,
  INITIAL_OUTPUT_FILES,
  INITIAL_PRODUCTS,
  INITIAL_TEAM_MEMBERS,
} from '../data/mockData';
import {
  INITIAL_CATEGORY_PRICE_RULES,
  INITIAL_PRICING_SETTINGS,
  PRODUCE_PRODUCTS,
  PRODUCT_PRICE_SEED,
} from '../data/pricingData';
import {
  BulkPriceAction,
  ParsedPriceRow,
  ResolvedPrice,
  formatNow,
  getBulkPatch,
  resolveMarketplacePrice,
} from '../lib/pricing';
import {
  CategoryItem,
  CategoryPriceRule,
  CompareReference,
  MarketplaceId,
  OutputFileRecord,
  PricingSettings,
  Product,
  TeamMember,
  ViewType,
} from '../types';

interface ToastInfo {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

interface AppContextType {
  currentView: ViewType;
  selectedProductId: string;
  selectedCategoryId: string;
  selectedBranch: string;
  setSelectedBranch: (branch: string) => void;
  products: Product[];
  categories: CategoryItem[];
  outputFiles: OutputFileRecord[];
  teamMembers: TeamMember[];
  isUploadModalOpen: boolean;
  uploadModalPreselectedSource: MarketplaceId | 'erp';
  toasts: ToastInfo[];
  navigate: (
    view: ViewType,
    options?: {
      productId?: string;
      categoryId?: string;
      preselectedUpload?: MarketplaceId | 'erp';
      marketplaceFilter?: MarketplaceId;
      id?: string;
    }
  ) => void;
  openUploadModal: (source?: MarketplaceId | 'erp') => void;
  closeUploadModal: () => void;
  updateProduct: (product: Product) => void;
  addProduct: (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>) => void;
  deleteProduct: (id: string) => void;
  updateCategory: (category: CategoryItem) => void;
  generateMarketplaceFiles: (
    selectedMarketplaces: MarketplaceId[],
    fileContent: 'mismatches' | 'all',
    format: 'xlsx' | 'csv',
    changeCounts?: Partial<Record<MarketplaceId, number>>
  ) => void;
  inviteTeamMember: (email: string, role: TeamMember['role']) => void;
  showToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  dismissToast: (id: string) => void;

  // Marketplace Price
  pricingSettings: PricingSettings;
  updatePricingSettings: (patch: Partial<PricingSettings>) => void;
  categoryPriceRules: CategoryPriceRule[];
  upsertCategoryPriceRule: (rule: CategoryPriceRule) => void;
  removeCategoryPriceRule: (id: string) => void;
  /** What reports and generated files compare marketplaces against. */
  compareReference: CompareReference;
  setCompareReference: (ref: CompareReference) => void;
  getMarketplacePrice: (product: Product, marketplace?: MarketplaceId) => ResolvedPrice;
  bulkUpdatePrices: (productIds: string[], action: BulkPriceAction) => number;
  importMarketplacePrices: (rows: ParsedPriceRow[]) => { updated: number; notFound: number };

  /** Marketplace pre-selected when a report is opened from the dashboard. */
  marketplaceFilter: MarketplaceId | null;
  /** Signs out on the server and returns to the sign-in page. */
  logout: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const withSeededPrices = (list: Product[]): Product[] =>
  list.map((p) => (PRODUCT_PRICE_SEED[p.id] ? { ...p, ...PRODUCT_PRICE_SEED[p.id] } : p));

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Real URLs: the current screen comes from the address bar. `navigate(view)` below keeps the old call sites working.
  const location = useLocation();
  const router = useNavigate();
  const auth = useAuth();
  const matched = matchView(location.pathname);
  const currentView: ViewType = matched?.view ?? 'dashboard';
  const [pickedProductId, setSelectedProductId] = useState<string>('987654');
  const selectedProductId = matched?.view === 'product-detail' && matched.id ? matched.id : pickedProductId;
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('snacks-confectionery');
  const [selectedBranch, setSelectedBranch] = useState<string>('Doha Fresh Markets');
  const [products, setProducts] = useState<Product[]>(() =>
    withSeededPrices([...INITIAL_PRODUCTS, ...PRODUCE_PRODUCTS])
  );
  const [categories, setCategories] = useState<CategoryItem[]>(INITIAL_CATEGORIES);
  const [outputFiles, setOutputFiles] = useState<OutputFileRecord[]>(INITIAL_OUTPUT_FILES);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(INITIAL_TEAM_MEMBERS);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadModalPreselectedSource, setUploadModalPreselectedSource] = useState<MarketplaceId | 'erp'>('talabat');
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(INITIAL_PRICING_SETTINGS);
  const [categoryPriceRules, setCategoryPriceRules] = useState<CategoryPriceRule[]>(
    INITIAL_CATEGORY_PRICE_RULES
  );
  const [compareReference, setCompareReference] = useState<CompareReference>('marketplace');
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceId | null>(null);
  const logout = () => {
    void auth.logout().then(() => router('/login', { replace: true }));
  };

  const showToast = (message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      dismissToast(id);
    }, 4000);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const navigate = (
    view: ViewType,
    options?: {
      productId?: string;
      categoryId?: string;
      preselectedUpload?: MarketplaceId | 'erp';
      marketplaceFilter?: MarketplaceId;
      id?: string;
    }
  ) => {
    if (options?.productId) setSelectedProductId(options.productId);
    if (options?.categoryId) setSelectedCategoryId(options.categoryId);
    if (options?.preselectedUpload) setUploadModalPreselectedSource(options.preselectedUpload);
    if (options?.id) setSelectedProductId(options.id);
    setMarketplaceFilter(options?.marketplaceFilter ?? null);
    router(pathFor(view, options?.productId ?? options?.id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openUploadModal = (source: MarketplaceId | 'erp' = 'talabat') => {
    setUploadModalPreselectedSource(source);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    setIsUploadModalOpen(false);
  };

  const updateProduct = (updated: Product) => {
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    showToast(`Updated "${updated.nameEn}" successfully`);
  };

  const addProduct = (newProdData: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>) => {
    const newId = Math.floor(100000 + Math.random() * 900000).toString();
    const newProd: Product = {
      ...newProdData,
      id: newId,
      createdAt: '08 Oct 2026 10:15',
      updatedAt: '08 Oct 2026 10:15',
      updatedBy: 'Omar Haddad',
    };
    setProducts((prev) => [newProd, ...prev]);
    showToast(`Product "${newProd.nameEn}" created successfully!`);
    navigate('catalogue');
  };

  const deleteProduct = (id: string) => {
    const prod = products.find((p) => p.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast(`Deleted "${prod?.nameEn || 'Product'}"`, 'info');
    navigate('catalogue');
  };

  const updateCategory = (updated: CategoryItem) => {
    setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    showToast(`Category "${updated.nameEn}" updated`);
  };

  const generateMarketplaceFiles = (
    selectedMarketplaces: MarketplaceId[],
    fileContent: 'mismatches' | 'all',
    format: 'xlsx' | 'csv',
    changeCounts?: Partial<Record<MarketplaceId, number>>
  ) => {
    const now = formatNow();
    const stamp = now.split(' ').slice(0, 3).join('');
    const newFiles: OutputFileRecord[] = selectedMarketplaces.map((mp) => {
      const counts: Record<MarketplaceId, number> = {
        talabat: 50,
        snoonu: 41,
        rafeeq: 63,
        keeta: 0,
      };
      const changes = changeCounts?.[mp] ?? counts[mp];
      const prefix = mp.charAt(0).toUpperCase() + mp.slice(1);
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      return {
        id: 'out-' + Date.now() + '-' + mp,
        generatedOn: now,
        marketplace: mp,
        fileName: `${prefix}_Price_${stamp}.${ext}`,
        productsInFile: fileContent === 'mismatches' ? changes : 12480,
        changes,
        generatedBy: 'Omar Haddad',
        status: 'Ready',
        fileType: format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)',
        priceReference: compareReference,
      };
    });

    setOutputFiles((prev) => [...newFiles, ...prev]);
    showToast(
      `Generated ${selectedMarketplaces.length} marketplace output files using ${
        compareReference === 'marketplace' ? 'Marketplace prices' : 'ERP prices'
      }`
    );
  };

  const inviteTeamMember = (email: string, role: TeamMember['role']) => {
    if (!email) return;
    const newMember: TeamMember = {
      id: 'tm-' + Date.now(),
      email,
      role,
      status: 'Invited',
      invitedAt: '08 Oct 2026 10:22',
    };
    setTeamMembers((prev) => [...prev, newMember]);
    showToast(`Invitation sent to ${email}`);
  };

  // ---------------------------------------------------------------------------
  // Marketplace Price
  // ---------------------------------------------------------------------------

  const updatePricingSettings = (patch: Partial<PricingSettings>) => {
    setPricingSettings((prev) => ({ ...prev, ...patch }));
  };

  const upsertCategoryPriceRule = (rule: CategoryPriceRule) => {
    setCategoryPriceRules((prev) => {
      const existing = prev.find((r) => r.id === rule.id || r.category === rule.category);
      if (existing) return prev.map((r) => (r === existing ? { ...rule, id: existing.id } : r));
      return [...prev, rule];
    });
  };

  const removeCategoryPriceRule = (id: string) => {
    setCategoryPriceRules((prev) => prev.filter((r) => r.id !== id));
  };

  const getMarketplacePrice = (product: Product, marketplace?: MarketplaceId) =>
    resolveMarketplacePrice(product, pricingSettings, categoryPriceRules, marketplace);

  const bulkUpdatePrices = (productIds: string[], action: BulkPriceAction) => {
    const ids = new Set(productIds);
    const now = formatNow();
    setProducts((prev) =>
      prev.map((p) => {
        if (!ids.has(p.id)) return p;
        const next: Product = {
          ...p,
          ...getBulkPatch(p, action, pricingSettings, categoryPriceRules),
          updatedAt: now,
          updatedBy: 'Omar Haddad',
        };
        next.sellingPrice = resolveMarketplacePrice(next, pricingSettings, categoryPriceRules).price;
        return next;
      })
    );
    return ids.size;
  };

  const importMarketplacePrices = (rows: ParsedPriceRow[]) => {
    const byBarcode = new Map(rows.map((r) => [r.barcode, r.price]));
    const known = new Set(products.map((p) => p.barcode));
    const updated = rows.filter((r) => known.has(r.barcode)).length;
    const now = formatNow();
    setProducts((prev) =>
      prev.map((p) => {
        const price = byBarcode.get(p.barcode);
        if (price === undefined) return p;
        return {
          ...p,
          priceRule: { mode: 'fixed', value: price },
          sellingPrice: price,
          updatedAt: now,
          updatedBy: 'Omar Haddad',
        };
      })
    );
    return { updated, notFound: rows.length - updated };
  };

  return (
    <AppContext.Provider
      value={{
        currentView,
        selectedProductId,
        selectedCategoryId,
        selectedBranch,
        setSelectedBranch,
        products,
        categories,
        outputFiles,
        teamMembers,
        isUploadModalOpen,
        uploadModalPreselectedSource,
        toasts,
        navigate,
        openUploadModal,
        closeUploadModal,
        updateProduct,
        addProduct,
        deleteProduct,
        updateCategory,
        generateMarketplaceFiles,
        inviteTeamMember,
        showToast,
        dismissToast,
        pricingSettings,
        updatePricingSettings,
        categoryPriceRules,
        upsertCategoryPriceRule,
        removeCategoryPriceRule,
        compareReference,
        setCompareReference,
        getMarketplacePrice,
        bulkUpdatePrices,
        importMarketplacePrices,
        marketplaceFilter,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
