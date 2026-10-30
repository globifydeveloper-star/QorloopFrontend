import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload, Info, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDemo, SAMPLE_FILES } from '../../demo';
import type { MarketplaceId, SourceId } from '../../demo';
import { useAuth } from '../../auth/AuthContext';
import { realUploadsEnabled } from '../../lib/features';
import { RealUploadModal } from '../uploads/RealUploadModal';

const DemoUploadModal: React.FC = () => {
  const { isUploadModalOpen, closeUploadModal, uploadModalPreselectedSource, navigate, showToast } = useApp();
  const { state, uploadFile, uploadSample } = useDemo();

  const [source, setSource] = useState<SourceId>(uploadModalPreselectedSource || 'talabat');
  const [fileMode, setFileMode] = useState<'full' | 'partial'>('full');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bug fix per task: re-sync source whenever modal opens
  useEffect(() => {
    if (isUploadModalOpen) {
      setSource(uploadModalPreselectedSource || 'talabat');
      setSelectedFile(null);
      setError(null);
      setUploading(false);
      setFileMode('full');
    }
  }, [isUploadModalOpen, uploadModalPreselectedSource]);

  const sources: { id: SourceId; label: string }[] = [
    { id: 'erp', label: `ERP (${state.tenant.erpName})` },
    { id: 'talabat', label: 'Talabat' },
    { id: 'snoonu', label: 'Snoonu' },
    { id: 'rafeeq', label: 'Rafeeq' },
    { id: 'keeta', label: 'Keeta' },
  ];

  const sourceName = sources.find((s) => s.id === source)?.label || 'source';

  // Check if a template exists for this source
  const hasTemplate = state.inputTemplates.some((t) => t.source === source);
  const sampleFile = SAMPLE_FILES.find((f) => f.source === source);

  const handleFileSelect = (files: FileList | null) => {
    if (!files?.length) return;
    setSelectedFile(files[0]);
    setError(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, []);

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadFile(source, selectedFile, fileMode);
      closeUploadModal();
      if (result.next === 'mapping') {
        navigate('column-mapping');
      } else if (result.next === 'review') {
        navigate('upload-review');
      } else if (result.next === 'error') {
        setError(result.message);
        setUploading(false);
        return;
      }
    } catch (err) {
      setError('Failed to read file');
      setUploading(false);
    }
  };

  const handleUseSample = async () => {
    setUploading(true);
    setError(null);
    try {
      const result = await uploadSample(source, fileMode);
      closeUploadModal();
      if (result.next === 'mapping') {
        navigate('column-mapping');
      } else if (result.next === 'review') {
        navigate('upload-review');
      } else if (result.next === 'error') {
        setError(result.message);
        setUploading(false);
        return;
      }
    } catch (err) {
      setError('Failed to load sample file');
      setUploading(false);
    }
  };

  if (!isUploadModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Dim backdrop */}
      <div
        className="fixed inset-0 bg-black/45 backdrop-blur-[1px] transition-opacity"
        onClick={closeUploadModal}
      />

      {/* Modal Dialog */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 text-gray-900 z-10 border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between pb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Upload file</h2>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Select the source, choose the file and upload it.
            </p>
          </div>
          <button
            onClick={closeUploadModal}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 pt-3">
          {/* Step 1: Source */}
          <div>
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">
              1. Source
            </label>
            <div className="grid grid-cols-5 gap-1.5 p-1 bg-gray-50 border border-gray-200 rounded-lg">
              {sources.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setSource(item.id); setSelectedFile(null); setError(null); }}
                  className={`py-2 px-1 text-xs font-medium rounded-md transition-all text-center truncate ${source === item.id
                      ? 'bg-[#E3FAF3] text-[#027864] font-semibold border border-[#027864]/30 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: File contains */}
          <div>
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">
              2. File contains
            </label>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${fileMode === 'full'
                    ? 'border-[#027864] bg-[#E3FAF3]/30'
                    : 'border-gray-200 hover:bg-gray-50'
                  }`}
              >
                <input
                  type="radio"
                  name="fileContent"
                  checked={fileMode === 'full'}
                  onChange={() => setFileMode('full')}
                  className="mt-0.5 accent-[#027864]"
                />
                <div>
                  <div className="text-xs font-semibold text-gray-900">
                    All products (full list)
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Products not in the file will be flagged as missing.
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${fileMode === 'partial'
                    ? 'border-[#027864] bg-[#E3FAF3]/30'
                    : 'border-gray-200 hover:bg-gray-50'
                  }`}
              >
                <input
                  type="radio"
                  name="fileContent"
                  checked={fileMode === 'partial'}
                  onChange={() => setFileMode('partial')}
                  className="mt-0.5 accent-[#027864]"
                />
                <div>
                  <div className="text-xs font-semibold text-gray-900">
                    Only some products (partial update)
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Only the products in this file will be updated.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Step 3: Choose file */}
          <div>
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wider mb-2">
              3. Choose file
            </label>

            {/* Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors bg-gray-50/50 ${dragOver ? 'border-[#027864] bg-[#E3FAF3]/20' : 'border-gray-300 hover:border-gray-400'
                }`}
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2 text-gray-500">
                <Upload className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-gray-700">
                Drag and drop your file here
              </p>
              <p className="text-[11px] text-[#027864] hover:underline mt-0.5 font-medium">
                or click to browse
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                .xlsx, .xls or .csv up to 25 MB
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />

            {/* Sample file link */}
            {sampleFile && (
              <button
                onClick={handleUseSample}
                disabled={uploading}
                className="mt-2 flex items-center gap-1.5 text-xs text-[#027864] font-medium hover:underline disabled:opacity-50"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Use today's sample file
              </button>
            )}

            {/* Selected file card */}
            {selectedFile && (
              <div className="mt-3 flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-emerald-600 rounded text-white flex items-center justify-center font-bold text-xs">
                    X
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-900">
                      {selectedFile.name}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {(selectedFile.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                {error}
              </div>
            )}
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50/70 p-2.5 rounded-lg border border-blue-100">
            <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
            <span>
              {source === 'keeta' && !hasTemplate
                ? "First Keeta file: you'll match the columns once."
                : `Qorloop will recognise the layout if you've uploaded a ${sourceName} file before.`}
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={closeUploadModal}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUploadSubmit}
            disabled={!selectedFile || uploading}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#027864] rounded-lg hover:bg-[#02604F] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Real /api/uploads flow when VITE_REAL_UPLOADS=true, the demo store otherwise. Not shown to roles without uploads.upload. */
export const UploadModal: React.FC = () => {
  const { can } = useAuth();
  if (!can('uploads.upload')) return null;
  return realUploadsEnabled() ? <RealUploadModal /> : <DemoUploadModal />;
};
