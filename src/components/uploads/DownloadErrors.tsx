import React, { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { ApiError } from '../../api/client';
import { friendlyError } from '../../api/errors';
import { EMPTY_ERRORS_FILE, ERRORS_XLSX_LIMIT, uploadsApi } from '../../api/uploads';
import { RequestId } from '../common/States';
import { saveBlob } from './shared';

export const DOWNLOAD_ERRORS_LABEL = 'Download errors (.xlsx)';

export interface DownloadFailure {
  message: string;
  /** Shown with a Copy button so the user can quote it to support. Never set for a network failure. */
  requestId?: string;
}

const PREFIX = 'Could not download the errors';

/** What the user is told when GET /api/uploads/:id/errors.xlsx did not produce a file. */
export function downloadFailure(e: unknown): DownloadFailure {
  if (e instanceof ApiError && e.code === EMPTY_ERRORS_FILE) {
    return { message: `${PREFIX}: the server sent an empty file. Please try again.`, requestId: e.requestId };
  }
  const f = friendlyError(e);
  switch (f.kind) {
    // The shared wording, exactly, and no Request ID (none came from the backend).
    case 'network': return { message: f.message };
    // A 401 has already sent the app to the session-expired screen (client.ts).
    case 'session': return { message: `${PREFIX}: please sign in again.`, requestId: f.requestId };
    case 'forbidden': return { message: `${PREFIX}: you do not have permission to download this file.`, requestId: f.requestId };
    case 'not_found': return { message: `${PREFIX}: the errors file for this upload was not found.`, requestId: f.requestId };
    case 'server': return { message: `${PREFIX}: Qorloop could not prepare the file. ${f.message}`, requestId: f.requestId };
    default: return { message: e instanceof ApiError ? `${PREFIX}: ${e.message}` : `${PREFIX}. Please try again.`, requestId: f.requestId };
  }
}

/**
 * "Download errors (.xlsx)": fetches the row errors workbook and hands it to the browser. Used in the review stage's
 * Row errors panel, the "Rows with errors" tile of an applied upload, and applied rows in the uploads list.
 * Pass `fileName` where several of these share a screen, so each button has its own accessible name.
 */
export const DownloadErrorsButton: React.FC<{
  id: string;
  fileName?: string;
  /** Show that the file lists at most ERRORS_XLSX_LIMIT errors. */
  capped?: boolean;
  align?: 'start' | 'end';
}> = ({ id, fileName, capped = false, align = 'end' }) => {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DownloadFailure | null>(null);
  // Set synchronously so a double click cannot send a second request before `busy` renders.
  const inFlight = useRef(false);

  const download = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const file = await uploadsApi.downloadErrors(id);
      saveBlob(file.blob, file.fileName);
    } catch (e) {
      console.error('[uploads] downloading the errors file failed', e);
      setFailure(downloadFailure(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const label = busy ? 'Preparing…' : DOWNLOAD_ERRORS_LABEL;
  return (
    <div className={`flex flex-col gap-1 ${align === 'end' ? 'items-end text-right' : 'items-start text-left'}`}>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        aria-busy={busy}
        aria-label={fileName ? `${label} for ${fileName}` : undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#027864] bg-white border border-[#027864]/40 rounded-lg hover:bg-[#E3FAF3] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        {label}
      </button>
      {capped && <p className="text-[11px] text-gray-500">The file lists up to {ERRORS_XLSX_LIMIT.toLocaleString('en-US')} errors</p>}
      {failure && (
        <div role="alert" className="max-w-[280px] whitespace-normal space-y-0.5">
          <p className="text-[11px] text-red-600">{failure.message}</p>
          {failure.requestId && <RequestId id={failure.requestId} />}
        </div>
      )}
    </div>
  );
};
