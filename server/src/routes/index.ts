import { Router } from 'express';
import { adminRouter } from './adminRoutes.js';
import { authRouter } from './authRoutes.js';
import { bookingRouter } from './bookingRoutes.js';
import { eventRouter } from './eventRoutes.js';
import { holdRouter } from './holdRoutes.js';
import { showRouter } from './showRoutes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', time: Date.now() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/events', eventRouter);
apiRouter.use('/shows', showRouter);
apiRouter.use('/holds', holdRouter);
apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/admin', adminRouter);
