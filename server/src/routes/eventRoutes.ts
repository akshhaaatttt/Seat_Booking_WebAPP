import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody, pathParam } from '../middleware/validate.js';
import * as eventService from '../services/eventService.js';
import * as showService from '../services/showService.js';
import { createEventSchema, createShowSchema, updateEventSchema } from '../validation/schemas.js';

export const eventRouter = Router();

function isAdmin(req: { user?: { role: string } }): boolean {
  return req.user?.role === 'ADMIN';
}

eventRouter.get('/', (req, res) => {
  res.status(200).json({ events: eventService.listEvents({ includeInactive: isAdmin(req) }) });
});

eventRouter.get('/:id', (req, res) => {
  res.status(200).json({ event: eventService.getEvent(pathParam(req, 'id'), { includeInactive: isAdmin(req) }) });
});

eventRouter.get('/:eventId/shows', (req, res) => {
  res.status(200).json({
    shows: showService.listShowsForEvent(pathParam(req, 'eventId'), { includeInactive: isAdmin(req) }),
  });
});

eventRouter.post('/', requireAdmin, validateBody(createEventSchema), (req, res) => {
  res.status(201).json({ event: eventService.createEvent(req.body) });
});

eventRouter.patch('/:id', requireAdmin, validateBody(updateEventSchema), (req, res) => {
  res.status(200).json({ event: eventService.updateEvent(pathParam(req, 'id'), req.body) });
});

eventRouter.delete('/:id', requireAdmin, (req, res) => {
  const result = eventService.removeEvent(pathParam(req, 'id'));
  res.status(200).json(result);
});

eventRouter.post('/:eventId/shows', requireAdmin, validateBody(createShowSchema), (req, res) => {
  res.status(201).json({ show: showService.createShow({ eventId: pathParam(req, 'eventId'), ...req.body }) });
});
