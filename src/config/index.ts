import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  discord: z.object({
    token: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
    applicationId: z.string().optional(),
  }),
  auth: z.object({
    allowedUserIds: z.array(z.string()).min(1, 'At least one ALLOWED_USER_ID is required'),
  }),
  claude: z.object({
    workingDir: z.string().default(process.cwd()),
    timeoutMs: z.number().default(300000),
  }),
  projects: z.object({
    baseDir: z.string(),
    allowList: z.array(z.string()),
    denyList: z.array(z.string()),
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const allowedUserIdsRaw = process.env['ALLOWED_USER_IDS'] ?? '';
  const allowedUserIds = allowedUserIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const projectsAllowListRaw = process.env['PROJECTS_ALLOW_LIST'] ?? '';
  const projectsAllowList = projectsAllowListRaw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const projectsDenyListRaw = process.env['PROJECTS_DENY_LIST'] ?? 'node_modules,.git';
  const projectsDenyList = projectsDenyListRaw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const rawConfig = {
    discord: {
      token: process.env['DISCORD_BOT_TOKEN'] ?? '',
      applicationId: process.env['DISCORD_APPLICATION_ID'],
    },
    auth: {
      allowedUserIds,
    },
    claude: {
      workingDir: process.env['CLAUDE_WORKING_DIR'] ?? process.cwd(),
      timeoutMs: parseInt(process.env['CLAUDE_TIMEOUT_MS'] ?? '300000', 10),
    },
    projects: {
      baseDir: process.env['PROJECTS_BASE_DIR'] ?? `${process.env['HOME']}/Development`,
      allowList: projectsAllowList,
      denyList: projectsDenyList,
    },
    logging: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  };

  return configSchema.parse(rawConfig);
}

export const config = loadConfig();
