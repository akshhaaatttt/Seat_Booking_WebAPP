import { Router } from 'express';
import { authedUser, requireAuth } from '../middleware/auth.js';
import { pathParam, validateBody } from '../middleware/validate.js';
import * as bookingService from '../services/bookingService.js';
import * as holdService from '../services/holdService.js';
import * as seatService from '../services/seatService.js';
import * as showService from '../services/showService.js';
import { confirmBookingSchema, createHoldSchema } from '../validation/schemas.js';

export const showRouter = Router();

showRouter.get('/:id', (req, res) => {
  res.status(200).json({ show: showService.getShow(pathParam(req, 'id')) });
});

showRouter.get('/:showId/seats', (req, res) => {
  const viewerId = req.user?.id ?? null;
  res.status(200).json(seatService.getSeatMap(pathParam(req, 'showId'), viewerId));
});

showRouter.get('/:showId/my-hold', requireAuth, (req, res) => {
  const hold = holdService.getActiveHoldForUser(authedUser(req).id, pathParam(req, 'showId'));
  res.status(200).json({ hold });
});

showRouter.post('/:showId/holds', requireAuth, validateBody(createHoldSchema), (req, res) => {
  const hold = holdService.holdSeats({
    userId: authedUser(req).id,
    showId: pathParam(req, 'showId'),
    showSeatIds: req.body.showSeatIds,
  });
  res.status(201).json({ hold });
});

showRouter.post('/:showId/book', requireAuth, validateBody(confirmBookingSchema), (req, res) => {
  const { booking } = bookingService.confirmBooking({
    userId: authedUser(req).id,
    showId: pathParam(req, 'showId'),
    holdGroupId: req.body.holdGroupId,
  });
  res.status(201).json({ booking });
});
