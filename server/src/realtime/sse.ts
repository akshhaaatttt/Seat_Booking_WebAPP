import type { Request, Response } from 'express';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { RealtimeEvent } from './events.js';
import { realtimePublisher } from './publisher.js';

/**
 * Server-Sent Events was chosen over WebSocket because seat updates are
 * strictly server → client, SSE rides on plain HTTP (no upgrade handshake, no
 * extra dependency), and the browser's EventSource reconnects automatically
 * after a network drop — which is precisely the "user loses connectivity"
 * edge case this app has to survive.
 */
export function openSeatStream(showId: string, req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering so events are flushed immediately.
    'X-Accel-Buffering': 'no',
  });

  const send = (event: RealtimeEvent): void => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // Tell EventSource how long to wait before reconnecting, then greet the client.
  res.write('retry: 3000\n\n');
  send({ type: 'CONNECTED', showId, at: Date.now() });

  const unsubscribe = realtimePublisher.subscribe(showId, send);

  // Comment frames keep intermediaries from closing an idle connection.
  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, config.realtime.heartbeatIntervalSeconds * 1000);
  heartbeat.unref();

  const close = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on('close', close);
  res.on('error', (error) => {
    logger.debug('sse stream error', { showId, error: error.message });
    close();
  });
}
