import type { Client } from 'discord.js';
import { handleReady } from './ready.js';
import { handleMessageCreate } from './messageCreate.js';
import { handleInteractionCreate } from './interactionCreate.js';

export function registerEvents(client: Client): void {
  handleReady(client);
  handleMessageCreate(client);
  handleInteractionCreate(client);
}
