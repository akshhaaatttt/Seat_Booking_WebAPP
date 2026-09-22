import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { parseQuery, pathParam } from '../middleware/validate.js';
import * as bookingService from '../services/bookingService.js';
import * as eventService from '../services/eventService.js';
import * as seatService from '../services/seatService.js';
import * as showService from '../services/showService.js';
import { adminBookingQuerySchema } from '../validation/schemas.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/events', (_req, res) => {
  res.status(200).json({ events: eventService.listEvents({ includeInactive: true }) });
});

adminRouter.get('/shows', (_req, res) => {
  res.status(200).json({ shows: showService.listAllShows({ includeInactive: true }) });
});

adminRouter.get('/layouts', (_req, res) => {
  res.status(200).json({ layouts: showService.listLayouts() });
});

adminRouter.get('/shows/:showId/seats', (req, res) => {
  res.status(200).json(seatService.getSeatMap(pathParam(req, 'showId'), null));
});

adminRouter.get('/bookings', (req, res) => {
  const filters = parseQuery(adminBookingQuerySchema, req);
  const { bookings, total } = bookingService.listAllBookings(filters);
  res.status(200).json({ bookings, total, limit: filters.limit, offset: filters.offset });
});

adminRouter.get('/bookings/:id', (req, res) => {
  res.status(200).json({ booking: bookingService.getBookingAsAdmin(pathParam(req, 'id')) });
});
