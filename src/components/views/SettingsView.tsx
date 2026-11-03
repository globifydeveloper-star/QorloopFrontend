import React, { useState } from 'react';
import { Store, Shield, Bell, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDemo } from '../../demo';
import { realSettingsEnabled } from '../../lib/features';
import { RealSettingsView } from '../settings/RealSettingsView';

export const SettingsView: React.FC = () => {
  return realSettingsEnabled() ? <RealSettingsView /> : <DemoSettingsView />;
};

const DemoSettingsView: React.FC = () => {
  const { showToast } = useApp();
  const { state } = useDemo();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    showToast('Settings saved successfully!');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-150">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Store & System Settings
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Configure parameters for {state.tenant.name} ({state.tenant.branch}), currency rules and reconciliation tolerances.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Store Profile */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Store className="w-4 h-4 text-[#027864]" />
            <h2 className="text-sm font-bold text-gray-900">Store Profile</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium text-gray-700 mb-1">
                Store Name
              </label>
              <input
                type="text"
                readOnly
                value={state.tenant.name}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-medium text-gray-800"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                Branch Location
              </label>
              <input
                type="text"
                readOnly
                value={`${state.tenant.branch}, ${state.tenant.country}`}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-medium text-gray-800"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                ERP Integration
              </label>
              <input
                type="text"
                readOnly
                value={state.tenant.erpName}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-medium text-gray-800"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                Base Currency & Timezone
              </label>
              <input
                type="text"
                readOnly
                value={`${state.tenant.currency} (${state.tenant.timezone})`}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-medium text-gray-800"
              />
            </div>
          </div>
        </div>

        {/* Reconciliation Rules */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Shield className="w-4 h-4 text-[#027864]" />
            <h2 className="text-sm font-bold text-gray-900">Reconciliation Rules</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-medium text-gray-700 mb-1">
                Price Tolerance (QAR)
              </label>
              <input
                type="text"
                readOnly
                value={`${state.settings.priceTolerance.toFixed(2)} QAR`}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-mono font-medium text-gray-800"
              />
              <span className="text-[10px] text-gray-400 mt-1 block">
                Prices differing by more than this trigger a mismatch.
              </span>
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                Rounding Step
              </label>
              <input
                type="text"
                readOnly
                value={`${state.settings.roundingStep.toFixed(2)} QAR`}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-mono font-medium text-gray-800"
              />
              <span className="text-[10px] text-gray-400 mt-1 block">
                Rounding applied to computed expected prices.
              </span>
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                Stale File Warning (Hours)
              </label>
              <input
                type="text"
                readOnly
                value={`${state.settings.staleHours} hours`}
                className="w-full border border-gray-200 rounded-lg p-2.5 bg-gray-50 font-mono font-medium text-gray-800"
              />
              <span className="text-[10px] text-gray-400 mt-1 block">
                Uploads older than this display as stale on dashboard.
              </span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
