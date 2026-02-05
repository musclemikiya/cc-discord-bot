import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export function isUserAllowed(userId: string): boolean {
  const allowed = config.auth.allowedUserIds.includes(userId);

  if (!allowed) {
    logger.warn({ userId }, 'Unauthorized user attempted to use bot');
  }

  return allowed;
}
