import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { realOnboardingEnabled } from '../../lib/features';
import { pathFor } from '../../routes/paths';

/** Consume the upload entry once, so closing the modal or refreshing never reopens it. */
export const OnboardingRouteActions: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { openUploadModal } = useApp();
  const { can } = useAuth();
  useEffect(() => {
    if (!realOnboardingEnabled() || !can('uploads.upload') || location.pathname !== pathFor('uploads')) return;
    const params = new URLSearchParams(location.search);
    const start = params.get('start');
    if (start !== 'erp' && start !== 'marketplace') return;
    openUploadModal(start);
    params.delete('start');
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true });
  }, [location.pathname, location.search, location.hash, openUploadModal, can, navigate]);
  return null;
};
