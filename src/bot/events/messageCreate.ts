import type { Client } from 'discord.js';
import { handleMention } from '../handlers/mentionHandler.js';
import { logger } from '../../utils/logger.js';

export function handleMessageCreate(client: Client): void {
  client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if the bot is mentioned
    if (!client.user) return;
    if (!message.mentions.has(client.user)) return;

    logger.debug(
      {
        messageId: message.id,
        authorId: message.author.id,
        channelId: message.channelId,
      },
      'Received mention'
    );

    await handleMention(message, client);
  });
}
