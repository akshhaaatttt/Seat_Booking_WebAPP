import type { ReactNode } from 'react';

export function Banner({
  kind,
  children,
  onDismiss,
}: {
  kind: 'error' | 'success' | 'info' | 'warn';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function StreamIndicator({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  const copy = {
    live: 'Live updates on',
    connecting: 'Reconnecting…',
    offline: 'Live updates off',
  } as const;
  return (
    <span className="stream-pill" title="Seat availability updates in real time">
      <span className={`dot dot-${status}`} aria-hidden="true" />
      {copy[status]}
    </span>
  );
}
