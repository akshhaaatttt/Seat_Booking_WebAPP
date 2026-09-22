import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { EmptyState, Loading } from './Feedback';

/**
 * Client-side gating is a convenience only — every protected endpoint is
 * enforced again on the server.
 */
export function ProtectedRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  if (adminOnly && !isAdmin) {
    return (
      <main className="page">
        <EmptyState
          title="Administrators only"
          description="Your account does not have access to the admin panel."
        />
      </main>
    );
  }

  return <>{children}</>;
}
