import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Upload,
  BarChart2,
  Package,
  Tag,
  FileSpreadsheet,
  Settings,
  HelpCircle,
  BookOpen,
  LogOut,
  Users,
  History,
  ChevronDown,
  ChevronRight,
  FilePen,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ViewType } from '../../types';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../api/types';
import { isEntryActive, readAdminOpen, visibleNav, writeAdminOpen, type NavEntry } from './navMenu';
import logo from '../../assets/qorloop-logo.png';

type NavItem = { label: string; view: ViewType; icon: React.ElementType; active: boolean; count?: number; countTone?: 'brand' | 'muted' };

const ICONS: Partial<Record<ViewType, React.ElementType>> = {
  dashboard: LayoutDashboard,
  'update-files': FilePen,
  uploads: Upload,
  'outputs-generate': FileSpreadsheet,
  'how-it-works': BookOpen,
  catalogue: Package,
  markups: Tag,
  reports: BarChart2,
  activity: History,
  templates: FileSpreadsheet,
  team: Users,
  settings: Settings,
  onboarding: HelpCircle,
};

export const Sidebar: React.FC = () => {
  const { currentView, navigate, logout } = useApp();
  const { me, can } = useAuth();
  const tenantName = me?.tenant.name ?? '';
  const userName = me?.user.name ?? '';
  const userId = me?.user.id;
  const roleLabel = me ? ROLE_LABELS[me.role] : '';
  // Navigation follows the permissions the server returned for this session (navMenu.ts). The server still enforces them.
  const groups = visibleNav(can);

  // Admin starts collapsed and remembers each user's choice. Opening a screen that lives in it opens the group.
  const [adminOpen, setAdminOpenState] = useState(() => readAdminOpen(userId));
  useEffect(() => setAdminOpenState(readAdminOpen(userId)), [userId]);
  const setAdminOpen = (open: boolean) => {
    setAdminOpenState(open);
    writeAdminOpen(userId, open);
  };
  const adminHasActive = groups.some((g) => g.id === 'admin' && g.items.some((i) => isEntryActive(i, currentView)));
  useEffect(() => {
    if (!adminHasActive) return;
    setAdminOpenState(true);
    writeAdminOpen(userId, true);
  }, [adminHasActive, currentView, userId]);

  const toItem = (e: NavEntry): NavItem => ({
    label: e.label,
    view: e.view,
    icon: ICONS[e.view] ?? FileSpreadsheet,
    active: isEntryActive(e, currentView),
  });

  const NavButton: React.FC<{ item: NavItem }> = ({ item }) => {
    const Icon = item.icon;
    const active = item.active;
    return (
      <button
        onClick={() => navigate(item.view)}
        aria-current={active ? 'page' : undefined}
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

        {groups.map((g) => {
          const collapsible = g.id === 'admin';
          const open = !collapsible || adminOpen;
          const listId = `nav-group-${g.id}`;
          return (
            <div key={g.id} role="group" aria-label={g.title}>
              {collapsible ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  data-has-active={adminHasActive ? 'true' : undefined}
                  onClick={() => setAdminOpen(!open)}
                  className={`w-full flex items-center justify-between px-3 pt-3.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-[1.2px] hover:text-white ${
                    !open && adminHasActive ? 'text-[#00FFD2]' : 'text-[#5F8F86]'
                  }`}
                >
                  <span>{g.title}</span>
                  {open ? <ChevronDown className="w-3.5 h-3.5" aria-hidden /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden />}
                </button>
              ) : (
                <div className="px-3 pt-3.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#5F8F86]">{g.title}</div>
              )}
              {open && (
                <nav id={listId} className="space-y-0.5">
                  {g.items.map((e) => (
                    <NavButton key={e.view} item={toItem(e)} />
                  ))}
                </nav>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div className="pt-3 mt-6 border-t border-[#8CFFE7]/10">
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
