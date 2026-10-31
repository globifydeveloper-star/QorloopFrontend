import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { DemoProvider } from './demo';
import { useAuth } from './auth/AuthContext';
import { matchView, CONNECTED_VIEWS, VIEW_PERMISSION } from './routes/paths';
import { AcceptInvitationPage } from './components/auth/AcceptInvitationPage';
import { LoginPage } from './components/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './components/auth/PasswordResetPages';
import { MfaSetupPage, MfaVerifyPage } from './components/auth/MfaPages';
import { NoAccessPage, NotFoundPage, SessionExpiredPage } from './components/auth/SystemPages';
import { ErrorState, LoadingState } from './components/common/States';
import { TeamView } from './components/views/TeamView';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { UploadModal } from './components/modals/UploadModal';

// Views
import { DashboardView } from './components/views/DashboardView';
import { UploadReviewView } from './components/views/UploadReviewView';
import { ColumnMappingView } from './components/views/ColumnMappingView';
import { CatalogueView } from './components/views/CatalogueView';
import { ProductDetailView } from './components/views/ProductDetailView';
import { NewProductsView } from './components/views/NewProductsView';
import { StockMismatchesView } from './components/views/StockMismatchesView';
import { PriceDiscrepanciesView } from './components/views/PriceDiscrepanciesView';
import { GenerateFilesView } from './components/views/GenerateFilesView';
import { OnboardingCompleteView } from './components/views/OnboardingCompleteView';
import { MarkupsView } from './components/views/MarkupsView';
import { TemplatesView } from './components/views/TemplatesView';
import { SettingsView } from './components/views/SettingsView';
import { UploadsHistoryView } from './components/views/UploadsHistoryView';
import { CategoryMappingView } from './components/views/CategoryMappingView';
import { CategoriesView } from './components/views/CategoriesView';
import { CategoryDetailView } from './components/views/CategoryDetailView';
import { realCatalogueEnabled } from './lib/features';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

/** The signed-in application. Sample-data screens stay available but are labelled until their endpoints exist. */
const MainContent: React.FC = () => {
  const { currentView, toasts, dismissToast } = useApp();
  const { can } = useAuth();
  const location = useLocation();

  if (!matchView(location.pathname)) {
    return (
      <div className="flex min-h-screen bg-[#F2F7F6]">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0"><Header /><main className="flex-1"><NotFoundPage /></main></div>
        <ToastContainer toasts={toasts} dismissToast={dismissToast} />
      </div>
    );
  }

  // Full-screen wizard (sample data until the onboarding endpoints exist)
  if (currentView === 'onboarding') {
    return (
      <>
        <OnboardingCompleteView />
        <ToastContainer toasts={toasts} dismissToast={dismissToast} />
      </>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'uploads':
        return <UploadsHistoryView />;
      case 'upload-review':
        return <UploadReviewView />;
      case 'column-mapping':
        return <ColumnMappingView />;
      case 'catalogue':
        return <CatalogueView />;
      case 'product-detail':
        return <ProductDetailView />;
      case 'new-products':
      case 'new-product':
        return <NewProductsView />;
      // The category screens are reachable only on the real catalogue; the demo build keeps its old routing.
      case 'categories':
        return realCatalogueEnabled() ? <CategoriesView /> : <DashboardView />;
      case 'category-detail':
        return realCatalogueEnabled() ? <CategoryDetailView /> : <DashboardView />;
      case 'reports':
      case 'reports-stock':
        return <StockMismatchesView />;
      case 'reports-price-discrepancies':
        return <PriceDiscrepanciesView />;
      case 'outputs-generate':
        return <GenerateFilesView />;
      case 'markups':
        return <MarkupsView />;
      case 'category-mapping':
        return <CategoryMappingView />;
      case 'templates':
        return <TemplatesView />;
      case 'settings':
        return <SettingsView />;
      case 'team':
        return <TeamView />;
      default:
        return <DashboardView />;
    }
  };

  const needed = VIEW_PERMISSION[currentView];
  const allowed = !needed || can(needed);

  return (
    <div className="flex min-h-screen bg-[#F2F7F6]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        {allowed && !CONNECTED_VIEWS.has(currentView) && (
          <div role="note" className="px-8 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-900">
            <b>Sample data.</b> This screen is not connected to the server yet; what you see here is not your store&apos;s real data.
          </div>
        )}
        <main className="flex-1 overflow-y-auto">{allowed ? renderView() : <NoAccessPage />}</main>
      </div>
      <UploadModal />
      <ToastContainer toasts={toasts} dismissToast={dismissToast} />
    </div>
  );
};

const ToastContainer: React.FC<{
  toasts: { id: string; message: string; type: string }[];
  dismissToast: (id: string) => void;
}> = ({ toasts, dismissToast }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center justify-between gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-lg text-xs font-medium text-gray-900 animate-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-[#027864] shrink-0" />
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            {toast.type === 'info' && (
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
            )}
            {toast.type === 'warning' && (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="text-gray-400 hover:text-gray-600 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

const FullPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex items-center justify-center bg-[#F2F7F6]">{children}</div>
);

/** Sends a visitor to the right step for their session state. Pages behind this never render for anyone else. */
const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, error, retry } = useAuth();
  const location = useLocation();
  switch (status) {
    case 'loading': return <FullPage><LoadingState label="Loading your workspace…" /></FullPage>;
    case 'error': return <FullPage><ErrorState error={error} onRetry={error?.status === 404 ? undefined : retry} title={error?.status === 404 ? 'We could not find this store' : 'We could not reach Qorloop'} /></FullPage>;
    case 'unauthenticated': return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    case 'expired': return <Navigate to="/session-expired" replace />;
    case 'mfa_setup_required': return <Navigate to="/mfa/setup" replace />;
    case 'mfa_required': return <Navigate to="/mfa/verify" replace />;
    default: return <>{children}</>;
  }
};

/** Pages for visitors who are not fully signed in. A signed-in user is sent to the app instead. */
const Guest: React.FC<{ children: React.ReactNode; allow?: 'mfa_setup_required' | 'mfa_required' }> = ({ children, allow }) => {
  const { status } = useAuth();
  if (status === 'loading') return <FullPage><LoadingState /></FullPage>;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  if (allow) {
    if (status === allow) return <>{children}</>;
    if (status === 'mfa_setup_required') return <Navigate to="/mfa/setup" replace />;
    if (status === 'mfa_required') return <Navigate to="/mfa/verify" replace />;
    return <Navigate to={status === 'expired' ? '/session-expired' : '/login'} replace />;
  }
  return <>{children}</>;
};

export default function App() {
  return (
    <Routes>
      {/* No public store registration or sign-up route exists: accounts are created by invitation only. */}
      <Route path="/login" element={<Guest><LoginPage /></Guest>} />
      <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
      <Route path="/forgot-password" element={<Guest><ForgotPasswordPage /></Guest>} />
      <Route path="/password/reset" element={<ResetPasswordPage />} />
      <Route path="/session-expired" element={<SessionExpiredPage />} />
      <Route path="/mfa/setup" element={<Guest allow="mfa_setup_required"><MfaSetupPage /></Guest>} />
      <Route path="/mfa/verify" element={<Guest allow="mfa_required"><MfaVerifyPage /></Guest>} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <DemoProvider>
              <AppProvider>
                <MainContent />
              </AppProvider>
            </DemoProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
