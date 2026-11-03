import React, { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectionUnavailable, subscribeConnection } from '../../api/connectivity';

export const connectionTiming = { retryMs: 15_000 };
export const OfflineBanner: React.FC = () => {
  const unavailable = useSyncExternalStore(subscribeConnection, connectionUnavailable, () => false);
  const qc = useQueryClient();
  useEffect(() => {
    if (!unavailable) return;
    const retry = () => { if (navigator.onLine !== false) void qc.refetchQueries({ type: 'active' }); };
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, connectionTiming.retryMs);
    return () => { window.removeEventListener('online', retry); window.clearInterval(timer); };
  }, [unavailable, qc]);
  if (!unavailable) return null;
  return <div role="status" className="sticky top-0 z-50 px-6 py-3 bg-amber-50 border-b border-amber-300 text-sm text-amber-900 text-center">
    {navigator.onLine === false ? 'You are offline.' : 'We could not connect to Qorloop.'} We will retry when the connection is back.
  </div>;
};
