import { Router } from 'express';
import { authedUser, clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import * as authService from '../services/authService.js';
import { loginSchema, registerSchema } from '../validation/schemas.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { user, session } = await authService.register(req.body);
    setSessionCookie(res, session.token, session.expiresInSeconds);
    res.status(201).json({ user, token: session.token });
  }),
);

authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { user, session } = await authService.login(req.body);
    setSessionCookie(res, session.token, session.expiresInSeconds);
    res.status(200).json({ user, token: session.token });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.status(200).json({ user: authedUser(req) });
});
