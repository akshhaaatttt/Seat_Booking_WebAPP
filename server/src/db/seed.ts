import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import { newId } from '../domain/ids.js';
import { rupeesToPaise } from '../domain/money.js';
import * as showRepository from '../repositories/showRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import * as bookingService from '../services/bookingService.js';
import * as eventService from '../services/eventService.js';
import * as holdService from '../services/holdService.js';
import * as seatRepository from '../repositories/seatRepository.js';
import * as showService from '../services/showService.js';
import { closeDb, getDb } from './index.js';
import { migrate } from './migrate.js';

/**
 * Development credentials. These are intentionally weak and documented in the
 * README; production deployments must never run this seed.
 */
export const SEED_USERS = [
  { email: 'admin@seatbox.dev', password: 'Admin@12345', name: 'Asha Menon', role: 'ADMIN' as const },
  { email: 'aria@example.com', password: 'User@12345', name: 'Aria Kapoor', role: 'USER' as const },
  { email: 'dev@example.com', password: 'User@12345', name: 'Dev Sharma', role: 'USER' as const },
  { email: 'nina@example.com', password: 'User@12345', name: 'Nina Rao', role: 'USER' as const },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function at(daysFromNow: number, hour: number, minute: number): number {
  const date = new Date(Date.now() + daysFromNow * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function clearTransactionalData(): void {
  const db = getDb();
  db.transaction(() => {
    // Ordered to respect foreign keys; `seats` is catalogue data kept by migrate().
    for (const table of ['booking_seats', 'bookings', 'holds', 'show_seats', 'shows', 'events', 'users']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  })();
}

export async function seed(): Promise<void> {
  migrate();
  clearTransactionalData();

  const users = [];
  for (const spec of SEED_USERS) {
    const row = userRepository.insertUser({
      id: newId(),
      email: spec.email,
      passwordHash: await bcrypt.hash(spec.password, config.security.bcryptRounds),
      name: spec.name,
      role: spec.role,
      createdAt: Date.now(),
    });
    users.push(row);
  }
  const [, aria, dev, nina] = users;

  const catalogue = [
    {
      title: 'Avengers: Secret Wars',
      description:
        'The multiverse collides in the final chapter of the Multiverse Saga. IMAX presentation with Dolby Atmos sound.',
      category: 'Movie',
      venue: 'PVR Orion Mall, Bengaluru',
      shows: [
        { days: 1, hour: 19, minute: 30, screen: 'IMAX Screen 1', layout: 'cinema-50', price: 250 },
        { days: 1, hour: 22, minute: 45, screen: 'IMAX Screen 1', layout: 'cinema-50', price: 300 },
        { days: 2, hour: 13, minute: 0, screen: 'Screen 3', layout: 'cinema-50', price: 200 },
        { days: 4, hour: 19, minute: 30, screen: 'IMAX Screen 1', layout: 'cinema-50', price: 250 },
      ],
    },
    {
      title: 'IPL Final 2026',
      description:
        'The title decider under lights. Gates open two hours before the first ball; stand seating with covered views.',
      category: 'Sports',
      venue: 'M. A. Chidambaram Stadium, Chennai',
      shows: [
        { days: 6, hour: 19, minute: 0, screen: 'North Stand', layout: 'stadium-80', price: 900 },
        { days: 6, hour: 19, minute: 0, screen: 'East Stand', layout: 'stadium-80', price: 1200 },
      ],
    },
    {
      title: 'Tech Conference 2026',
      description:
        'A single-track day on distributed systems, developer experience and the economics of running software at scale.',
      category: 'Conference',
      venue: 'Jio World Convention Centre, Mumbai',
      shows: [
        { days: 9, hour: 9, minute: 30, screen: 'Main Hall', layout: 'cinema-50', price: 1500 },
        { days: 10, hour: 9, minute: 30, screen: 'Main Hall', layout: 'cinema-50', price: 1500 },
      ],
    },
    {
      title: 'Stand-up Comedy Night',
      description:
        'An intimate 70-minute set of brand-new material. Strictly 18+, latecomers are seated at the interval.',
      category: 'Comedy',
      venue: 'The Habitat, Mumbai',
      shows: [
        { days: 2, hour: 20, minute: 0, screen: 'Lounge', layout: 'lounge-24', price: 400 },
        { days: 3, hour: 20, minute: 0, screen: 'Lounge', layout: 'lounge-24', price: 400 },
        { days: 3, hour: 22, minute: 0, screen: 'Lounge', layout: 'lounge-24', price: 350 },
      ],
    },
  ];

  const createdShows: { showId: string; eventTitle: string }[] = [];
  for (const entry of catalogue) {
    const event = eventService.createEvent({
      title: entry.title,
      description: entry.description,
      category: entry.category,
      venue: entry.venue,
    });
    for (const show of entry.shows) {
      const created = showService.createShow({
        eventId: event.id,
        startsAt: at(show.days, show.hour, show.minute),
        screen: show.screen,
        layoutKey: show.layout,
        basePrice: rupeesToPaise(show.price),
      });
      createdShows.push({ showId: created.id, eventTitle: entry.title });
    }
  }

  // Populate some shows with real activity, created through the same services a
  // user would drive, so the seeded state satisfies every invariant.
  const firstShow = createdShows[0]!.showId;
  const comedyShow = createdShows.find((show) => show.eventTitle === 'Stand-up Comedy Night')!.showId;

  bookSeats(dev!.id, firstShow, ['C4', 'C5']);
  bookSeats(nina!.id, firstShow, ['A1', 'A2', 'A3']);
  bookSeats(aria!.id, comedyShow, ['B3']);

  // Live holds with genuine, still-valid expiry times.
  holdSeats(nina!.id, firstShow, ['E7', 'E8']);
  holdSeats(dev!.id, comedyShow, ['A1']);

  console.log('Seed complete:');
  console.log(`  users   : ${users.length} (1 admin, ${users.length - 1} standard)`);
  console.log(`  events  : ${catalogue.length}`);
  console.log(`  shows   : ${createdShows.length}`);
  console.log(`  bookings: 3 confirmed, 2 live holds (expire in ${config.holds.durationSeconds}s)`);
}

function seatIdsFor(showId: string, labels: string[]): string[] {
  const seats = seatRepository.findShowSeatsByLabels(showId, labels);
  if (seats.length !== labels.length) {
    throw new Error(`Seed error: could not resolve seats ${labels.join(', ')} for show ${showId}`);
  }
  return seats.map((seat) => seat.id);
}

function holdSeats(userId: string, showId: string, labels: string[]) {
  return holdService.holdSeats({ userId, showId, showSeatIds: seatIdsFor(showId, labels) });
}

function bookSeats(userId: string, showId: string, labels: string[]): void {
  const hold = holdSeats(userId, showId, labels);
  bookingService.confirmBooking({ userId, showId, holdGroupId: hold.holdGroupId });
}

const isEntrypoint = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isEntrypoint) {
  seed()
    .then(() => {
      // Show the resulting inventory split so the seed is verifiable at a glance.
      const counts = seatRepository.countsByStatus(showRepository.listAllShows({ includeInactive: true })[0]!.id);
      console.log(`  first show seats: ${JSON.stringify(counts)}`);
      closeDb();
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
      closeDb();
    });
}
