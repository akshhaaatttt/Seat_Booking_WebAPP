import type { Booking, EventSummary, Hold, SeatMap, Show, User } from '../types';

/**
 * Thin fetch wrapper. The dev server proxies /api to the backend, so requests
 * are same-origin and the httpOnly session cookie travels automatically — the
 * token is never stored in JavaScript.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** A 409 means the world changed underneath us: refresh and let the user retry. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.details,
    );
  }

  return payload as T;
}

const body = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(value) });

export const api = {
  register: (input: { name: string; email: string; password: string }) =>
    call<{ user: User }>('/auth/register', body(input)).then((r) => r.user),

  login: (input: { email: string; password: string }) =>
    call<{ user: User }>('/auth/login', body(input)).then((r) => r.user),

  logout: () => call<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: () => call<{ user: User }>('/auth/me').then((r) => r.user),

  listEvents: () => call<{ events: EventSummary[] }>('/events').then((r) => r.events),

  getEvent: (eventId: string) => call<{ event: EventSummary }>(`/events/${eventId}`).then((r) => r.event),

  listShows: (eventId: string) =>
    call<{ shows: Show[] }>(`/events/${eventId}/shows`).then((r) => r.shows),

  getSeatMap: (showId: string) => call<SeatMap>(`/shows/${showId}/seats`),

  getMyHold: (showId: string) =>
    call<{ hold: Hold | null }>(`/shows/${showId}/my-hold`).then((r) => r.hold),

  holdSeats: (showId: string, showSeatIds: string[]) =>
    call<{ hold: Hold }>(`/shows/${showId}/holds`, body({ showSeatIds })).then((r) => r.hold),

  releaseHold: (holdGroupId: string) =>
    call<{ releasedSeats: number }>(`/holds/${holdGroupId}`, { method: 'DELETE' }),

  confirmBooking: (showId: string, holdGroupId: string) =>
    call<{ booking: Booking }>(`/shows/${showId}/book`, body({ holdGroupId })).then((r) => r.booking),

  listBookings: () => call<{ bookings: Booking[] }>('/bookings').then((r) => r.bookings),

  getBooking: (bookingId: string) =>
    call<{ booking: Booking }>(`/bookings/${bookingId}`).then((r) => r.booking),

  cancelBooking: (bookingId: string) =>
    call<{ booking: Booking }>(`/bookings/${bookingId}/cancel`, { method: 'POST' }).then((r) => r.booking),

  admin: {
    events: () => call<{ events: EventSummary[] }>('/admin/events').then((r) => r.events),
    shows: () => call<{ shows: Show[] }>('/admin/shows').then((r) => r.shows),
    seats: (showId: string) => call<SeatMap>(`/admin/shows/${showId}/seats`),
    bookings: (params: { search?: string; status?: string; limit?: number; offset?: number } = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') query.set(key, String(value));
      }
      const suffix = query.toString() ? `?${query}` : '';
      return call<{ bookings: Booking[]; total: number; limit: number; offset: number }>(
        `/admin/bookings${suffix}`,
      );
    },
    createEvent: (input: { title: string; description: string; category: string; venue: string }) =>
      call<{ event: EventSummary }>('/events', body(input)).then((r) => r.event),
    updateEvent: (id: string, patch: Record<string, unknown>) =>
      call<{ event: EventSummary }>(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
        (r) => r.event,
      ),
    deleteEvent: (id: string) =>
      call<{ deleted: boolean; event: EventSummary | null }>(`/events/${id}`, { method: 'DELETE' }),
    createShow: (
      eventId: string,
      input: { startsAt: number; screen: string; layoutKey: string; basePrice: number },
    ) => call<{ show: Show }>(`/events/${eventId}/shows`, body(input)).then((r) => r.show),
    updateShow: (id: string, patch: Record<string, unknown>) =>
      call<{ show: Show }>(`/shows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.show),
    deleteShow: (id: string) =>
      call<{ deleted: boolean; show: Show | null }>(`/shows/${id}`, { method: 'DELETE' }),
    layouts: () => call<{ layouts: { layoutKey: string; seatCount: number }[] }>('/admin/layouts').then((r) => r.layouts),
  },
};
