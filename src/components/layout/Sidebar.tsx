import React from 'react';
import {
  LayoutDashboard,
  Upload,
  BarChart2,
  Package,
  Tag,
  Network,
  FileSpreadsheet,
  Settings,
  HelpCircle,
  LogOut,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ViewType } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../api/types';
import { VIEW_PERMISSION } from '../../routes/paths';
import logo from '../../assets/qorloop-logo.png';

type NavItem = { label: string; view: ViewType; icon: React.ElementType; count?: number; countTone?: 'brand' | 'muted' };

export const Sidebar: React.FC = () => {
  const { currentView, navigate, logout } = useApp();
  const { me, can } = useAuth();
  const tenantName = me?.tenant.name ?? '';
  const userName = me?.user.name ?? '';
  const roleLabel = me ? ROLE_LABELS[me.role] : '';
  // Navigation follows the permissions the server returned for this session. The server still enforces them.
  const allowed = (view: ViewType) => {
    const needed = VIEW_PERMISSION[view];
    return !needed || can(needed);
  };

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Main',
      items: [
        { label: 'Dashboard', view: 'dashboard', icon: LayoutDashboard },
        { label: 'Uploads', view: 'uploads', icon: Upload },
        { label: 'Reports', view: 'reports', icon: BarChart2 },
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { label: 'Catalogue', view: 'catalogue', icon: Package },
        { label: 'Marketplace price', view: 'markups', icon: Tag },
        { label: 'Category mapping', view: 'category-mapping', icon: Network },
      ],
    },
    {
      title: 'Outputs',
      items: [
        { label: 'Generated files', view: 'outputs-generate', icon: FileSpreadsheet },
        { label: 'Templates', view: 'templates', icon: FileSpreadsheet },
      ],
    },
  ];

  const isNavActive = (view: ViewType) => {
    if (currentView === view) return true;
    if (view === 'reports' && (currentView === 'reports-stock' || currentView === 'reports-price-discrepancies' || currentView === 'reports-price-mismatches')) {
      return true;
    }
    if (view === 'uploads' && (currentView === 'upload-review' || currentView === 'column-mapping')) return true;
    if (
      view === 'catalogue' &&
      (currentView === 'product-detail' ||
        currentView === 'new-product' ||
        currentView === 'new-products' ||
        currentView === 'categories' ||
        currentView === 'category-detail')
    ) {
      return true;
    }
    return false;
  };

  const NavButton: React.FC<{ item: NavItem }> = ({ item }) => {
    const Icon = item.icon;
    const active = isNavActive(item.view);
    return (
      <button
        onClick={() => navigate(item.view)}
        className={`relative w-full flex items-center gap-3 px-3 py-2 text-[13.5px] rounded-[10px] transition-colors text-left ${
          active
            ? 'bg-gradient-to-r from-[#00D9A9]/20 to-[#00D9A9]/[0.04] text-white font-semibold'
            : 'text-[#BFD6D1] font-medium hover:text-white hover:bg-white/[0.05]'
        }`}
      >
        {active && (
          <span className="absolute -left-3.5 top-2 h-5 w-[3px] rounded-r bg-[#00FFD2] shadow-[0_0_12px_#00FFD2]" />
        )}
        <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-[#00FFD2]' : 'text-[#7FA8A0]'}`} />
        <span className="truncate">{item.label}</span>
        {item.count !== undefined && (
          <span
            className={`ml-auto text-[11px] font-bold rounded-full px-1.5 min-w-[20px] text-center ${
              item.countTone === 'brand' ? 'bg-[#00D9A9] text-[#031E1B]' : 'bg-white/10 text-[#BFD6D1]'
            }`}
          >
            {item.count}
          </span>
        )}
      </button>
    );
  };

  const initials = userName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="q-sidebar w-[248px] shrink-0 h-screen sticky top-0 flex flex-col justify-between pt-5 pb-4 px-3.5 z-20 overflow-y-auto">
      <div>
        {/* Brand */}
        <button onClick={() => navigate('dashboard')} className="px-2.5 pb-5 block select-none" title="Qorloop">
          <img src={logo} alt="Qorloop — Connect Predict Act" className="h-[52px] w-auto" />
        </button>

        {/* Workspace */}
        <div className="mx-1 mb-3 flex items-center gap-2.5 rounded-xl border border-[#8CFFE7]/15 bg-white/[0.06] px-3 py-2.5">
          <div className="w-[30px] h-[30px] shrink-0 rounded-lg bg-gradient-to-br from-[#00D9A9] to-[#027864] text-[#031E1B] text-[13px] font-extrabold flex items-center justify-center">
            {tenantName
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white truncate">{tenantName}</div>
            <div className="text-[11px] text-[#8FB8B0] truncate">{roleLabel}</div>
          </div>
        </div>

        {sections.filter((sec) => sec.items.some((i) => allowed(i.view))).map((sec) => (
          <div key={sec.title}>
            <div className="px-3 pt-3.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#5F8F86]">
              {sec.title}
            </div>
            <nav className="space-y-0.5">
              {sec.items.filter((item) => allowed(item.view)).map((item) => (
                <NavButton key={item.label} item={item} />
              ))}
            </nav>
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div className="pt-3 mt-6 border-t border-[#8CFFE7]/10 space-y-0.5">
        {allowed('team') && <NavButton item={{ label: 'Team', view: 'team', icon: Users }} />}
        {allowed('settings') && <NavButton item={{ label: 'Settings', view: 'settings', icon: Settings }} />}
        <NavButton item={{ label: 'Help & onboarding', view: 'onboarding', icon: HelpCircle }} />

        <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2.5">
          <div className="w-8 h-8 rounded-full bg-[#D9D9D9] text-[#06443D] text-xs font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white truncate">{userName}</div>
            <div className="text-[11px] text-[#8FB8B0] truncate">{roleLabel}</div>
          </div>
          <button onClick={logout} title="Sign out" className="p-1 rounded-md text-[#7FA8A0] hover:text-white hover:bg-white/10">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
