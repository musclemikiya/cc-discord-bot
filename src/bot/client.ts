import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { registerEvents } from './events/index.js';

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  registerEvents(client);

  return client;
}

export async function startBot(): Promise<Client> {
  const client = createClient();

  try {
    await client.login(config.discord.token);
    logger.info('Bot login successful');
    return client;
  } catch (error) {
    logger.error({ error }, 'Failed to login to Discord');
    throw error;
  }
}
