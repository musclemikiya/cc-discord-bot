import pino from 'pino';
import { config } from '../config/index.js';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = isProduction
  ? pino({ level: config.logging.level })
  : pino({
      level: config.logging.level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
