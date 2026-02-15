/**
 * @fileoverview Barrel export for the API layer.
 */

export {
  flowRoutes,
  contactRoutes,
  templateRoutes,
  tagRoutes,
  customFieldRoutes,
  analyticsRoutes,
  campaignRoutes,
  systemRoutes,
  trackingRoutes,
} from './routes/index.js';
export { authMiddleware, tenancyMiddleware } from './middleware/index.js';
