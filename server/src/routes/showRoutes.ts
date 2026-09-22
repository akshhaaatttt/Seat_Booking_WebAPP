import { Router } from 'express';
import { authedUser, requireAdmin, requireAuth } from '../middleware/auth.js';
import { validateBody, pathParam } from '../middleware/validate.js';
import { openSeatStream } from '../realtime/sse.js';
import * as bookingService from '../services/bookingService.js';
import * as holdService from '../services/holdService.js';
import * as seatService from '../services/seatService.js';
import * as showService from '../services/showService.js';
import { confirmBookingSchema, createHoldSchema, updateShowSchema } from '../validation/schemas.js';

export const showRouter = Router();

showRouter.get('/:id', (req, res) => {
  res.status(200).json({ show: showService.getShow(pathParam(req, 'id')) });
});

showRouter.patch('/:id', requireAdmin, validateBody(updateShowSchema), (req, res) => {
  res.status(200).json({ show: showService.updateShow(pathParam(req, 'id'), req.body) });
});

showRouter.delete('/:id', requireAdmin, (req, res) => {
  res.status(200).json(showService.removeShow(pathParam(req, 'id')));
});

/** Seat availability is public information; ownership details are not. */
showRouter.get('/:showId/seats', (req, res) => {
  const viewerId = req.user?.id ?? null;
  res.status(200).json(seatService.getSeatMap(pathParam(req, 'showId'), viewerId));
});

/** Live seat updates for this show (Server-Sent Events). */
showRouter.get('/:showId/stream', (req, res) => {
  showService.getShow(pathParam(req, 'showId')); // 404s for an unknown show before upgrading.
  openSeatStream(pathParam(req, 'showId'), req, res);
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
  const { booking, alreadyExisted } = bookingService.confirmBooking({
    userId: authedUser(req).id,
    showId: pathParam(req, 'showId'),
    holdGroupId: req.body.holdGroupId,
  });
  res.status(alreadyExisted ? 200 : 201).json({ booking });
});
