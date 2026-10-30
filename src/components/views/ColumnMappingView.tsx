import React from 'react';
import { useApp } from '../../context/AppContext';
import { useDemo } from '../../demo';
import { ColumnMappingPanel } from '../common/ColumnMappingPanel';
import { realUploadsEnabled } from '../../lib/features';
import { RealColumnMappingView } from '../uploads/RealColumnMappingView';

const DemoColumnMappingView: React.FC = () => {
  const { navigate, showToast } = useApp();
  const { pendingMapping, completeMapping, cancelMapping } = useDemo();

  if (!pendingMapping) {
    return (
      <div className="p-8 max-w-4xl mx-auto animate-in fade-in duration-150">
        <p className="text-sm text-gray-500">No pending column mapping.</p>
      </div>
    );
  }

  const sourceName =
    pendingMapping.source === 'erp' ? 'ERP' : pendingMapping.source.charAt(0).toUpperCase() + pendingMapping.source.slice(1);
  const isEditing = !!pendingMapping.editingTemplateId;
  const fromFileMapping = !!pendingMapping.fromFileMapping;

  const handleSave = (mapping: Record<string, string>, templateName: string) => {
    const r = completeMapping(mapping, templateName);
    if (r === 'review') {
      navigate('upload-review');
    } else {
      showToast(`${sourceName} file mapping saved. Next ${sourceName} upload will use it.`, 'success');
      navigate('templates');
    }
  };

  const handleCancel = () => {
    cancelMapping();
    navigate(fromFileMapping ? 'templates' : 'dashboard');
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumb */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          {fromFileMapping ? (
            <>
              <button onClick={handleCancel} className="hover:text-gray-800 text-blue-600 hover:underline">
                File mapping
              </button>
              <span>/</span>
              <span className="text-gray-700">{sourceName}</span>
            </>
          ) : (
            <>
              <button onClick={() => navigate('uploads')} className="hover:text-gray-800 text-blue-600 hover:underline">
                Uploads
              </button>
              <span>/</span>
              <span className="text-gray-600">{pendingMapping.fileName}</span>
              <span>/</span>
              <span className="text-gray-700">Map columns</span>
            </>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {isEditing ? `Edit ${sourceName} file mapping` : `Map ${sourceName} file columns`}
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          For each Qorloop field, pick the column in the {sourceName} file that holds it.
          {fromFileMapping && <> Sample values come from <span className="font-mono">{pendingMapping.fileName}</span>.</>}
        </p>
      </div>

      <ColumnMappingPanel
        source={pendingMapping.source}
        sourceName={sourceName}
        headers={pendingMapping.headers}
        rows={pendingMapping.rows}
        initialMapping={pendingMapping.suggested}
        initialTemplateName={pendingMapping.templateName ?? `${sourceName} ${pendingMapping.source === 'erp' ? 'item master' : 'export'}`}
        onSave={handleSave}
        onCancel={handleCancel}
        saveButtonLabel={fromFileMapping ? 'Save mapping' : 'Save and continue'}
      />
    </div>
  );
};

export const ColumnMappingView: React.FC = () => (realUploadsEnabled() ? <RealColumnMappingView /> : <DemoColumnMappingView />);
