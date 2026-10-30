import React, { useState, useMemo } from 'react';
import { ERP_FIELDS, MARKETPLACE_FIELDS, SheetRow, SourceId } from '../../demo';

export interface ColumnMappingPanelProps {
  source: SourceId;
  sourceName?: string;
  headers: string[];
  rows: SheetRow[];
  initialMapping?: Record<string, string>;
  initialTemplateName?: string;
  onSave: (fields: Record<string, string>, templateName: string) => void;
  onCancel?: () => void;
  saveButtonLabel?: string;
  compact?: boolean;
  /** Qorloop fields to map. Defaults to the demo's ERP/marketplace field lists; real uploads pass the backend's. */
  fields?: { key: string; label: string; required: boolean }[];
  /** When false the mapping name is optional (an empty name means "don't save this layout"). */
  requireTemplateName?: boolean;
  /** Required field keys nothing was matched to; each gets a hint until a column is picked. */
  missingRequired?: string[];
}

export const ColumnMappingPanel: React.FC<ColumnMappingPanelProps> = ({
  source,
  sourceName = source === 'erp' ? 'ERP' : source.charAt(0).toUpperCase() + source.slice(1),
  headers,
  rows,
  initialMapping = {},
  initialTemplateName = `${sourceName} ${source === 'erp' ? 'item master' : 'export'}`,
  onSave,
  onCancel,
  saveButtonLabel = 'Save mapping',
  compact = false,
  fields: fieldsProp,
  requireTemplateName = true,
  missingRequired = [],
}) => {
  const fields = useMemo(() => fieldsProp ?? (source === 'erp' ? ERP_FIELDS : MARKETPLACE_FIELDS), [fieldsProp, source]);

  const [mapping, setMapping] = useState<Record<string, string>>(() => initialMapping);
  const [templateName, setTemplateName] = useState(initialTemplateName);

  const unmappedHeaders = headers.filter((h) => !Object.values(mapping).includes(h));
  const requiredFields = fields.filter((f) => f.required);
  const allRequiredMapped = requiredFields.every((f) => mapping[f.key]);

  const previewRows = rows.slice(0, 5);

  const nameOk = !requireTemplateName || Boolean(templateName.trim());

  const handleSave = () => {
    if (!allRequiredMapped || !nameOk) return;
    onSave(mapping, templateName);
  };

  return (
    <div className={`space-y-4 ${compact ? 'text-xs' : ''}`}>
      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
            <tr>
              <th className="py-2.5 px-4 font-semibold">Qorloop field</th>
              <th className="py-2.5 px-4 font-semibold">Required</th>
              <th className="py-2.5 px-4 font-semibold">File column</th>
              <th className="py-2.5 px-4 font-semibold">Sample value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fields.map((field) => {
              const chosenHeader = mapping[field.key] || '';
              const sampleValue = chosenHeader && previewRows[0] ? (previewRows[0][chosenHeader] ?? '') : '';
              return (
                <tr key={field.key} className="hover:bg-gray-50/70">
                  <td className="py-2.5 px-4 font-medium text-gray-900">
                    {field.label}
                    {!chosenHeader && missingRequired.includes(field.key) && (
                      <div className="text-[11px] font-normal text-red-600 mt-0.5">
                        Not found in this file automatically. Pick the column that holds it.
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    {field.required ? (
                      <span className="text-red-600 font-bold">Yes</span>
                    ) : (
                      <span className="text-gray-400">No</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={chosenHeader}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                      className={`w-full px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864] ${!chosenHeader && field.required ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
                        }`}
                    >
                      <option value="">— Select column —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 px-4 text-gray-500 font-mono truncate max-w-[200px]">
                    {String(sampleValue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Template Name */}
      <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-xs space-y-1.5">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700">
          File mapping name{!requireTemplateName && <span className="normal-case font-normal text-gray-400"> (optional)</span>}
        </label>
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder={`e.g. ${sourceName} export`}
          className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
        />
        <p className="text-[11px] text-gray-500">
          Qorloop will recognise this file layout automatically on future uploads.
        </p>
      </div>

      {/* Preview Table */}
      {previewRows.length > 0 && Object.keys(mapping).some((k) => mapping[k]) && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="px-3.5 py-2 border-b border-gray-100">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
              Preview ({previewRows.length} rows)
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                  {fields.filter((f) => mapping[f.key]).map((f) => (
                    <th key={f.key} className="py-2 px-3 font-semibold whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    {fields.filter((f) => mapping[f.key]).map((f) => (
                      <td key={f.key} className="py-2 px-3 text-gray-700 whitespace-nowrap truncate max-w-[180px]">
                        {String(row[mapping[f.key]] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unmapped Columns */}
      {unmappedHeaders.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 shadow-xs">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
            Unmapped columns in file ({unmappedHeaders.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {unmappedHeaders.map((h) => (
              <span key={h} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-[11px] text-gray-600">
                {h}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2.5 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!allRequiredMapped || !nameOk}
          className="px-4 py-1.5 text-xs font-semibold text-white bg-[#027864] rounded-lg hover:bg-[#02604F] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
        >
          {saveButtonLabel}
        </button>
      </div>
    </div>
  );
};
