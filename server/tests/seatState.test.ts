import { describe, expect, it } from 'vitest';
import { AppError } from '../src/domain/errors.js';
import {
  assertTransition,
  canTransition,
  requiredStatusFor,
  resultingStatusFor,
  type SeatStatus,
  type SeatTransition,
} from '../src/domain/seatState.js';

describe('seat state machine', () => {
  const legal: [SeatStatus, SeatTransition, SeatStatus][] = [
    ['AVAILABLE', 'HOLD', 'HELD'],
    ['HELD', 'BOOK', 'BOOKED'],
    ['HELD', 'EXPIRE', 'AVAILABLE'],
    ['HELD', 'RELEASE', 'AVAILABLE'],
    ['BOOKED', 'CANCEL', 'AVAILABLE'],
  ];

  it.each(legal)('allows %s --%s--> %s', (from, transition, to) => {
    expect(canTransition(from, transition)).toBe(true);
    expect(requiredStatusFor(transition)).toBe(from);
    expect(resultingStatusFor(transition)).toBe(to);
  });

  const illegal: [string, SeatStatus, SeatTransition][] = [
    ['BOOKED cannot be held again', 'BOOKED', 'HOLD'],
    ['BOOKED cannot be booked twice', 'BOOKED', 'BOOK'],
    ['AVAILABLE cannot be booked directly', 'AVAILABLE', 'BOOK'],
    ['AVAILABLE cannot expire', 'AVAILABLE', 'EXPIRE'],
    ['AVAILABLE cannot be cancelled', 'AVAILABLE', 'CANCEL'],
    ['HELD cannot be held by someone else', 'HELD', 'HOLD'],
    ['HELD cannot be cancelled', 'HELD', 'CANCEL'],
    ['BOOKED cannot expire', 'BOOKED', 'EXPIRE'],
    ['BOOKED cannot be released', 'BOOKED', 'RELEASE'],
  ];

  it.each(illegal)('rejects: %s', (_name, from, transition) => {
    expect(canTransition(from, transition)).toBe(false);
    expect(() => assertTransition('A1', from, transition)).toThrow(AppError);
  });

  it('reports illegal transitions as 409 conflicts with a readable message', () => {
    try {
      assertTransition('A1', 'BOOKED', 'HOLD');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
      expect((error as AppError).message).toBe('Seat A1 is already booked.');
    }
  });

  it('tells a user that a held seat is simply unavailable', () => {
    try {
      assertTransition('B7', 'HELD', 'HOLD');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).message).toBe('Seat B7 is no longer available.');
    }
  });
});
