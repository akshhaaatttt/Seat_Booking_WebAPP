import { useEffect, useRef, useState } from 'react';

/**
 * Counts down to a server-supplied deadline.
 *
 * The device clock is not trusted: `serverTime` from the same response is used
 * to compute an offset, so a user with a skewed clock still sees the right
 * number. This timer is presentation only — the backend decides whether a hold
 * is actually still valid.
 */
export function useCountdown(
  expiresAt: number | null,
  serverTime: number | null,
  onExpire?: () => void,
): number {
  const [remaining, setRemaining] = useState(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (expiresAt === null) {
      setRemaining(0);
      return;
    }

    const clockOffset = serverTime === null ? 0 : serverTime - Date.now();
    let fired = false;

    const tick = (): void => {
      const left = expiresAt - (Date.now() + clockOffset);
      setRemaining(Math.max(0, left));
      if (left <= 0 && !fired) {
        fired = true;
        onExpireRef.current?.();
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [expiresAt, serverTime]);

  return remaining;
}
