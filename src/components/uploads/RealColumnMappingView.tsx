import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { uploadsApi } from '../../api/uploads';
import { ApiError } from '../../api/client';
import { ColumnMappingPanel } from '../common/ColumnMappingPanel';
import { SOURCE_LABELS, StatusBadge, StatusProgress, UPLOADS_LIST_KEY, errorText, uploadKey, uploadPath, useUploadStatus } from './shared';

/** Below this suggestion confidence (0..1) the user is asked to double-check the pre-filled columns. */
const LOW_CONFIDENCE = 0.5;

/** Column mapping for an upload in needs_mapping, using the headers, suggestion and fields the backend returns. */
export const RealColumnMappingView: React.FC = () => {
  const [params] = useSearchParams();
  const id = params.get('upload');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const status = useUploadStatus(id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!id) return <Shell><p className="text-sm text-gray-500">No upload selected. Open one from <Link to="/uploads" className="text-[#027864] hover:underline">Uploads</Link>.</p></Shell>;
  if (status.isPending) return <Shell><p className="text-sm text-gray-500">Loading…</p></Shell>;
  if (status.isError) return <Shell><p role="alert" className="text-sm text-red-600">{errorText(status.error)}</p></Shell>;

  const upload = status.data;
  const sourceName = SOURCE_LABELS[upload.source] ?? upload.source;

  if (upload.status === 'uploading' || upload.status === 'processing') {
    return <Shell title={upload.fileName}><div className="bg-white border border-gray-200 rounded-xl p-4"><StatusProgress upload={upload} /></div></Shell>;
  }
  if (upload.status !== 'needs_mapping') {
    return (
      <Shell title={upload.fileName}>
        <p className="text-sm text-gray-600 flex items-center gap-2">
          This upload does not need column mapping (<StatusBadge status={upload.status} />).
          <Link to={uploadPath(upload)} className="text-[#027864] hover:underline font-medium">Open it</Link>
        </p>
      </Shell>
    );
  }

  const headers = upload.headers ?? [];
  const fields = upload.fields ?? [];
  const suggestion = upload.mappingSuggestion;
  // Keep only suggestions that point at a real column of this file.
  const suggested = Object.fromEntries(Object.entries(suggestion?.fields ?? {}).filter(([, h]) => headers.includes(h)));
  const lowConfidence = suggestion !== undefined && suggestion.confidence < LOW_CONFIDENCE;

  const save = async (mapping: Record<string, string>, name: string) => {
    setSaving(true);
    setError(null);
    try {
      const fieldsOut = Object.fromEntries(Object.entries(mapping).filter(([, h]) => h));
      const saveAs = name.trim();
      await uploadsApi.saveMapping(upload.id, saveAs ? { fields: fieldsOut, saveAs } : { fields: fieldsOut });
      await qc.invalidateQueries({ queryKey: uploadKey(upload.id) });
      void qc.invalidateQueries({ queryKey: UPLOADS_LIST_KEY });
      navigate(`/uploads/review?upload=${encodeURIComponent(upload.id)}`);
    } catch (e) {
      const fe = e instanceof ApiError ? Object.values(e.fieldErrors) : [];
      setError([errorText(e), ...fe].join(' '));
      setSaving(false);
    }
  };

  return (
    <Shell title={`Map ${sourceName} file columns`} crumb={upload.fileName}>
      <p className="text-xs text-gray-500 -mt-4">For each Qorloop field, pick the column in the {sourceName} file that holds it.</p>
      {!can('uploads.map') ? (
        <p role="note" className="text-sm text-gray-600">You can view this upload, but your role cannot map its columns.</p>
      ) : (
        <>
          {lowConfidence && Object.keys(suggested).length > 0 && (
            <div role="note" className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span><b>Check this mapping.</b> Qorloop is not sure about the columns it picked for this file. Review each one before you continue.</span>
            </div>
          )}
          {error && <div role="alert" className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}
          <fieldset disabled={saving}>
            <ColumnMappingPanel
              key={upload.id}
              source={upload.source}
              sourceName={sourceName}
              headers={headers}
              rows={[]}
              fields={fields}
              missingRequired={suggestion?.missingRequired ?? []}
              initialMapping={suggested}
              initialTemplateName=""
              requireTemplateName={false}
              onSave={(m, n) => void save(m, n)}
              onCancel={() => navigate('/uploads')}
              saveButtonLabel={saving ? 'Saving…' : 'Save and continue'}
            />
          </fieldset>
        </>
      )}
    </Shell>
  );
};

const Shell: React.FC<{ title?: string; crumb?: string; children: React.ReactNode }> = ({ title, crumb, children }) => (
  <div className="p-8 max-w-5xl mx-auto space-y-6">
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <Link to="/uploads" className="text-blue-600 hover:underline">Uploads</Link>
        {crumb && <><span>/</span><span className="text-gray-600">{crumb}</span></>}
        <span>/</span><span className="text-gray-700">Map columns</span>
      </div>
      {title && <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>}
    </div>
    {children}
  </div>
);
