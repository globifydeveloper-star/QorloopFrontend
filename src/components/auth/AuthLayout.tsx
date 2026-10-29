import React from 'react';
import { ShieldCheck, RefreshCw, LineChart } from 'lucide-react';
import logo from '../../assets/qorloop-logo.png';

const features = [
  { icon: RefreshCw, title: 'Connect', text: 'Bring your ERP and every marketplace file into one catalogue.' },
  { icon: LineChart, title: 'Predict', text: 'Spot stock and price mismatches before customers do.' },
  { icon: ShieldCheck, title: 'Act', text: 'Generate corrected marketplace files in one click.' },
];

/** The existing sign-in design (brand panel + form column), shared by every authentication screen. */
export const AuthLayout: React.FC<{ title: string; subtitle?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="min-h-screen flex bg-[#F2F7F6]">
    <div className="q-hero hidden lg:flex w-[46%] flex-col justify-between p-12 text-white relative overflow-hidden">
      <img src={logo} alt="Qorloop" className="h-16 w-auto self-start" />
      <div className="max-w-md">
        <div className="text-[11px] font-bold tracking-[1.6px] uppercase text-[#8CFFE7]">Marketplace & catalogue operations</div>
        <h1 className="mt-3 text-[38px] leading-[1.1] font-bold tracking-tight">One catalogue. Every marketplace. Always in sync.</h1>
        <p className="mt-4 text-[15px] text-[#A9D9CF] leading-relaxed">
          Qorloop keeps your ERP prices, marketplace prices and stock aligned across Talabat, Snoonu, Rafeeq and more.
        </p>
        <div className="mt-8 space-y-3">
          {features.map(f => (
            <div key={f.title} className="flex items-start gap-3 rounded-xl bg-white/[0.06] border border-[#8CFFE7]/15 p-3.5">
              <div className="w-9 h-9 rounded-lg bg-[#00D9A9]/15 text-[#00FFD2] flex items-center justify-center shrink-0">
                <f.icon className="w-[18px] h-[18px]" />
              </div>
              <div>
                <div className="text-sm font-semibold">{f.title}</div>
                <div className="text-[13px] text-[#A9D9CF]">{f.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-xs text-[#7FA8A0]">© 2026 Qorloop · Connect Predict Act</div>
    </div>
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-[400px]">
        <div className="lg:hidden mb-8 rounded-2xl bg-[#031E1B] p-5">
          <img src={logo} alt="Qorloop" className="h-12 w-auto" />
        </div>
        <h2 className="text-[28px] font-bold tracking-tight text-gray-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  </div>
);
