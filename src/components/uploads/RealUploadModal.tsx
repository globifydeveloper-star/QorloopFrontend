import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UploadStepError, completeUpload, uploadFile, validateFile } from '../../api/directUpload';
import { UPLOAD_SOURCES } from '../../api/types';
import type { UploadContains, UploadSource } from '../../api/types';
import { SOURCE_LABELS, StatusProgress, UPLOADS_LIST_KEY, errorText, failureCopy, formatBytes, uploadPath, useUploadStatus } from './shared';

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending'; fraction: number }
  | { kind: 'processing'; id: string }
  | { kind: 'error'; message: string; retry: 'restart' | { completeId: string } };

/** Upload modal wired to /api/uploads: create -> PUT to storage -> complete -> poll status. */
export const RealUploadModal: React.FC = () => {
  const { isUploadModalOpen, closeUploadModal, uploadModalPreselectedSource, showToast } = useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [source, setSource] = useState<UploadSource>(uploadModalPreselectedSource || 'talabat');
  const [contains, setContains] = useState<UploadContains>('full');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isUploadModalOpen) return;
    setSource(uploadModalPreselectedSource || 'talabat');
    setContains('full');
    setFile(null);
    setPhase({ kind: 'idle' });
  }, [isUploadModalOpen, uploadModalPreselectedSource]);

  const processingId = phase.kind === 'processing' ? phase.id : null;
  const status = useUploadStatus(processingId);
  const detail = status.data;

  // Leave the modal once the backend has settled on what happens next.
  useEffect(() => {
    if (!processingId || !detail) return;
    if (detail.status === 'needs_mapping' || detail.status === 'needs_review') {
      void qc.invalidateQueries({ queryKey: UPLOADS_LIST_KEY });
      closeUploadModal();
      navigate(uploadPath(detail));
    } else if (detail.status === 'rejected' || detail.status === 'failed' || detail.status === 'discarded') {
      void qc.invalidateQueries({ queryKey: UPLOADS_LIST_KEY });
      const copy = failureCopy(detail);
      setPhase({ kind: 'error', message: copy ? `${copy.title}: ${copy.detail} ${copy.next}` : 'This upload was discarded.', retry: 'restart' });
    }
  }, [processingId, detail, qc, closeUploadModal, navigate]);
  useEffect(() => {
    if (!processingId || !status.isError) return;
    console.error('[uploads] reading upload status failed', status.error);
    setPhase({ kind: 'error', message: `The file was uploaded, but its status could not be read: ${errorText(status.error)}`, retry: 'restart' });
  }, [processingId, status.isError, status.error]);

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    const f = files[0];
    const invalid = validateFile(f);
    setFile(invalid ? null : f);
    setPhase(invalid ? { kind: 'error', message: invalid, retry: 'restart' } : { kind: 'idle' });
  };

  const start = async () => {
    if (!file) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase({ kind: 'sending', fraction: 0 });
    try {
      const id = await uploadFile({
        source, contains, file, signal: ctrl.signal,
        onProgress: fraction => setPhase({ kind: 'sending', fraction }),
      });
      setPhase({ kind: 'processing', id });
    } catch (e) {
      if (e instanceof UploadStepError && e.aborted) { setPhase({ kind: 'idle' }); return; }
      console.error(`[uploads] upload failed at step "${e instanceof UploadStepError ? e.step : 'unknown'}"`, e instanceof UploadStepError ? e.original : e);
      // The bytes are stored but /complete failed: retrying complete is safe (idempotent).
      const retry = e instanceof UploadStepError && e.step === 'complete' && e.uploadId ? { completeId: e.uploadId } : 'restart' as const;
      setPhase({ kind: 'error', message: errorText(e), retry });
    } finally {
      abortRef.current = null;
      void qc.invalidateQueries({ queryKey: UPLOADS_LIST_KEY });
    }
  };

  const retryComplete = async (id: string) => {
    setPhase({ kind: 'sending', fraction: 1 });
    try {
      await completeUpload(id);
      setPhase({ kind: 'processing', id });
    } catch (e) {
      console.error('[uploads] retrying complete failed', e instanceof UploadStepError ? e.original : e);
      setPhase({ kind: 'error', message: errorText(e), retry: { completeId: id } });
    }
  };

  const close = () => {
    abortRef.current?.abort();
    if (phase.kind === 'processing') showToast('The file is still being processed. You can follow it on the Uploads page.', 'info');
    closeUploadModal();
  };

  if (!isUploadModalOpen) return null;
  const busy = phase.kind === 'sending' || phase.kind === 'processing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[1px]" onClick={close} />
      <div role="dialog" aria-modal="true" aria-labelledby="upload-title" className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 text-gray-900 z-10 border border-gray-100">
        <div className="flex items-start justify-between pb-3">
          <div>
            <h2 id="upload-title" className="text-xl font-bold text-gray-900 tracking-tight">Upload file</h2>
            <p className="text-xs text-gray-500 mt-1">Select the source, choose the file and upload it.</p>
          </div>
          <button onClick={close} aria-label="Close" className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <fieldset disabled={busy} className="space-y-5 pt-3">
          <div>
            <div className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">1. Source</div>
            <div className="grid grid-cols-5 gap-1.5 p-1 bg-gray-50 border border-gray-200 rounded-lg">
              {UPLOAD_SOURCES.map(id => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={source === id}
                  onClick={() => setSource(id)}
                  className={`py-2 px-1 text-xs font-medium rounded-md text-center truncate ${source === id ? 'bg-[#E3FAF3] text-[#027864] font-semibold border border-[#027864]/30' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {SOURCE_LABELS[id]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">2. File contains</div>
            <div className="space-y-2">
              {([['full', 'All products (full list)', 'Products not in the file will be flagged as missing.'],
                ['partial', 'Only some products (partial update)', 'Only the products in this file will be updated.']] as const).map(([value, title, hint]) => (
                <label key={value} className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${contains === value ? 'border-[#027864] bg-[#E3FAF3]/30' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="contains" checked={contains === value} onChange={() => setContains(value)} className="mt-0.5 accent-[#027864]" />
                  <div>
                    <div className="text-xs font-semibold text-gray-900">{title}</div>
                    <div className="text-[11px] text-gray-500">{hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">3. Choose file</div>
            <div
              onClick={() => !busy && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); if (!busy) pick(e.dataTransfer.files); }}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer bg-gray-50/50 ${dragOver ? 'border-[#027864]' : 'border-gray-300 hover:border-gray-400'}`}
            >
              <Upload className="w-5 h-5 mx-auto mb-2 text-gray-500" />
              <p className="text-xs font-medium text-gray-700">Drag and drop your file here</p>
              <p className="text-[11px] text-[#027864] mt-0.5 font-medium">or click to browse</p>
              <p className="text-[10px] text-gray-400 mt-1">.xlsx, .xls or .csv up to 25 MB</p>
            </div>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" data-testid="upload-input" onChange={e => pick(e.target.files)} />
            {file && (
              <div className="mt-3 flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs">
                <span className="font-medium text-gray-900 truncate">{file.name}</span>
                <span className="text-[10px] text-gray-500 shrink-0 ml-2">{formatBytes(file.size)}</span>
              </div>
            )}
          </div>
        </fieldset>

        <div className="mt-4 space-y-2">
          {phase.kind === 'sending' && (
            <StatusProgress upload={{ status: 'uploading', step: phase.fraction >= 1 ? 'Finishing upload' : 'Sending file', progress: phase.fraction * 100 }} />
          )}
          {phase.kind === 'processing' && (
            <StatusProgress upload={detail ?? { status: 'processing', step: 'Waiting for the server', progress: null }} />
          )}
          {phase.kind === 'error' && (
            <div role="alert" className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 flex items-center justify-between gap-2">
              <span>{phase.message}</span>
              {typeof phase.retry === 'object' && (
                <button type="button" onClick={() => void retryComplete((phase.retry as { completeId: string }).completeId)} className="font-semibold underline shrink-0">
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button type="button" onClick={close} className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            {phase.kind === 'processing' ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!file || busy || (phase.kind === 'error' && phase.retry !== 'restart')}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#027864] rounded-lg hover:bg-[#02604F] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase.kind === 'sending' ? 'Uploading…' : phase.kind === 'processing' ? 'Processing…' : phase.kind === 'error' && phase.retry === 'restart' && file ? 'Upload again' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};
