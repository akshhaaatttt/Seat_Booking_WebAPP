import { Router } from 'express';
import { pathParam } from '../middleware/validate.js';
import { authedUser, requireAuth } from '../middleware/auth.js';
import * as holdService from '../services/holdService.js';

export const holdRouter = Router();

/** `:holdId` accepts either a hold group id or a single hold row id. */
holdRouter.delete('/:holdId', requireAuth, (req, res) => {
  const result = holdService.releaseHold(authedUser(req).id, pathParam(req, 'holdId'));
  res.status(200).json(result);
});
