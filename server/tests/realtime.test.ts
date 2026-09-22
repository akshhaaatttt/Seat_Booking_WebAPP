import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  app,
  authed,
  createShow,
  createUser,
  resetDatabase,
  type TestShow,
  type TestUser,
} from './helpers/fixtures.js';
import { config } from '../src/config/index.js';
import type { RealtimeEvent, SeatStatusChangedEvent } from '../src/realtime/events.js';
import { realtimePublisher } from '../src/realtime/publisher.js';
import { sweepExpiredHolds } from '../src/services/holdExpirationService.js';

describe('realtime seat events', () => {
  let show: TestShow;
  let alice: TestUser;
  let bob: TestUser;
  let received: SeatStatusChangedEvent[];
  let unsubscribe: () => void;

  beforeEach(async () => {
    resetDatabase();
    show = createShow();
    alice = await createUser({ name: 'Alice' });
    bob = await createUser({ name: 'Bob' });
    received = [];
    unsubscribe = realtimePublisher.subscribe(show.showId, (event: RealtimeEvent) => {
      if (event.type === 'SEAT_STATUS_CHANGED') received.push(event);
    });
  });

  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
  });

  const hold = async (user: TestUser, labels: string[]): Promise<string> => {
    const response = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds(...labels) })
      .expect(201);
    return response.body.hold.holdGroupId;
  };

  it('broadcasts one HELD event per seat when seats are held', async () => {
    await hold(alice, ['A1', 'A2']);

    expect(received).toHaveLength(2);
    expect(received.map((event) => event.label).sort()).toEqual(['A1', 'A2']);
    expect(received.every((event) => event.status === 'HELD' && event.reason === 'HELD')).toBe(true);
    expect(received[0]).toMatchObject({
      type: 'SEAT_STATUS_CHANGED',
      showId: show.showId,
      holdUserId: alice.id,
    });
    expect(received[0]?.holdExpiresAt).toBeGreaterThan(Date.now());
  });

  it('broadcasts BOOKED when a hold is converted', async () => {
    const group = await hold(alice, ['A1']);
    received.length = 0;

    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: group })
      .expect(201);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ label: 'A1', status: 'BOOKED', reason: 'BOOKED' });
  });

  it('broadcasts RELEASED when a hold is given up', async () => {
    const group = await hold(alice, ['A1']);
    received.length = 0;

    await request(app).delete(`/api/holds/${group}`).set(authed(alice.token)).expect(200);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ label: 'A1', status: 'AVAILABLE', reason: 'RELEASED' });
  });

  it('broadcasts EXPIRED when the sweeper releases a hold', async () => {
    await hold(alice, ['A1']);
    received.length = 0;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + config.holds.durationSeconds * 1000 + 1);
    sweepExpiredHolds();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ label: 'A1', status: 'AVAILABLE', reason: 'EXPIRED' });
  });

  it('broadcasts CANCELLED when a booking is cancelled', async () => {
    const group = await hold(alice, ['A1']);
    const booking = await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: group })
      .expect(201);
    received.length = 0;

    await request(app)
      .post(`/api/bookings/${booking.body.booking.id}/cancel`)
      .set(authed(alice.token))
      .expect(200);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ label: 'A1', status: 'AVAILABLE', reason: 'CANCELLED' });
  });

  it('publishes nothing when the operation fails and rolls back', async () => {
    await hold(bob, ['A2']);
    received.length = 0;

    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: show.seatIds('A1', 'A2', 'A3') })
      .expect(409);

    expect(received).toHaveLength(0);
  });

  it('does not leak events between shows', async () => {
    const otherShow = createShow();
    await request(app)
      .post(`/api/shows/${otherShow.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: otherShow.seatIds('A1') })
      .expect(201);

    expect(received).toHaveLength(0);
  });
});

describe('Server-Sent Events transport', () => {
  let server: Server;
  let baseUrl: string;
  let show: TestShow;
  let alice: TestUser;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    if (typeof address === 'object' && address) baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    resetDatabase();
    show = createShow();
    alice = await createUser({ name: 'Alice' });
  });

  it('streams a seat change to a connected listener without polling', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/shows/${show.showId}/stream`, {
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events: SeatStatusChangedEvent[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const read = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf('\n\n');
          while (index !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
            if (dataLine) {
              const parsed = JSON.parse(dataLine.slice(6));
              if (parsed.type === 'SEAT_STATUS_CHANGED') events.push(parsed);
            }
            index = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // aborted at the end of the test
      }
    })();

    // Give the subscription a moment to register before changing anything.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: show.seatIds('A1') })
      .expect(201);

    const deadline = Date.now() + 3000;
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    controller.abort();
    await read;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ label: 'A1', status: 'HELD', reason: 'HELD' });
  });

  it('returns 404 for a stream on an unknown show', async () => {
    const response = await fetch(`${baseUrl}/api/shows/${'0'.repeat(8)}-0000-4000-8000-000000000000/stream`);
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });
});
