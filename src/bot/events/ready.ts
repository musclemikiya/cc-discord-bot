import type { Client } from 'discord.js';
import { logger } from '../../utils/logger.js';

export function handleReady(client: Client): void {
  client.on('ready', () => {
    if (client.user) {
      logger.info(
        { username: client.user.tag, id: client.user.id },
        'Bot is ready and connected'
      );
    }
  });
}
