import { Router } from 'express';
import { pathParam } from '../middleware/validate.js';
import { authedUser, requireAuth } from '../middleware/auth.js';
import * as bookingService from '../services/bookingService.js';

export const bookingRouter = Router();

bookingRouter.use(requireAuth);

bookingRouter.get('/', (req, res) => {
  res.status(200).json({ bookings: bookingService.listMyBookings(authedUser(req).id) });
});

bookingRouter.get('/:id', (req, res) => {
  const user = authedUser(req);
  res.status(200).json({ booking: bookingService.getBookingForUser(pathParam(req, 'id'), user) });
});

bookingRouter.post('/:id/cancel', (req, res) => {
  res.status(200).json({ booking: bookingService.cancelBooking(pathParam(req, 'id'), authedUser(req).id) });
});
