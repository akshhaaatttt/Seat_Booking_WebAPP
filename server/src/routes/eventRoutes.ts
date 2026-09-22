import { Router } from 'express';
import { pathParam } from '../middleware/validate.js';
import * as eventService from '../services/eventService.js';
import * as showService from '../services/showService.js';

export const eventRouter = Router();

eventRouter.get('/', (_req, res) => {
  res.status(200).json({ events: eventService.listEvents({ includeInactive: false }) });
});

eventRouter.get('/:id', async (req, res) => {
  const event = eventService.getEvent(pathParam(req, 'id'), { includeInactive: false });
  res.status(200).json({ event });
});

eventRouter.get('/:eventId/shows', (req, res) => {
  res.status(200).json({
    shows: showService.listShowsForEvent(pathParam(req, 'eventId'), { includeInactive: false }),
  });
});
