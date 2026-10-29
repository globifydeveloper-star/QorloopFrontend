import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { AuthLayout } from './AuthLayout';

/** SYS-005 */
export const SessionExpiredPage: React.FC = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthLayout title="Your session has expired" subtitle="For your security you were signed out after a period of inactivity.">
      <button onClick={() => void logout().then(() => navigate('/login', { replace: true }))} className="w-full h-11 rounded-[10px] text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F]">
        Sign in again
      </button>
    </AuthLayout>
  );
};

/** SYS-001 */
export const NotFoundPage: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
    <div className="text-5xl font-bold text-gray-200">404</div>
    <div className="text-lg font-semibold text-gray-900">Page not found</div>
    <Link to="/" className="mt-2 text-sm font-semibold text-[#027864] hover:underline">Go to the dashboard</Link>
  </div>
);

/** SYS-002: the server said no (or the UI knows the role cannot reach this page). */
export const NoAccessPage: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
    <div className="text-5xl font-bold text-gray-200">403</div>
    <div className="text-lg font-semibold text-gray-900">You do not have access to this page</div>
    <p className="text-sm text-gray-500 max-w-sm">Ask your store Owner or an Admin if you need it.</p>
    <Link to="/" className="mt-2 text-sm font-semibold text-[#027864] hover:underline">Go to the dashboard</Link>
  </div>
);
