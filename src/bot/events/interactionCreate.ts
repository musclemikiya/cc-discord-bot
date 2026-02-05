import {
  Client,
  Events,
  Interaction,
  StringSelectMenuInteraction,
  TextChannel,
  Message,
} from 'discord.js';
import { sessionManager } from '../../claude/sessionManager.js';
import { projectScanner } from '../../claude/projectScanner.js';
import { executeClaudeCommand } from '../../claude/executor.js';
import { processOutput } from '../../claude/outputProcessor.js';
import { logger } from '../../utils/logger.js';

export function handleInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isStringSelectMenu()) {
      return;
    }

    if (interaction.customId !== 'project_select') {
      return;
    }

    await handleProjectSelect(interaction);
  });
}

async function handleProjectSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const selectedValue = interaction.values[0];
  const threadId = interaction.channelId;
  const userId = interaction.user.id;

  if (!selectedValue) {
    await interaction.update({
      content: 'エラー: プロジェクトが選択されていません。',
      components: [],
    });
    return;
  }

  logger.info(
    { userId, threadId, selectedProject: selectedValue },
    'Project selected'
  );

  // Validate the selected project path
  const projectPath = projectScanner.getProjectPath(selectedValue);

  if (!projectPath || !projectScanner.isValidPath(projectPath)) {
    await interaction.update({
      content: 'エラー: 無効なプロジェクトが選択されました。',
      components: [],
    });
    return;
  }

  // Reset session and set working directory (creates fresh session for new project)
  sessionManager.resetSession(threadId);
  sessionManager.setWorkingDir(threadId, projectPath);

  // Check for pending prompt
  const pending = sessionManager.consumePendingPrompt(threadId);

  if (!pending) {
    await interaction.update({
      content: `プロジェクト「${selectedValue}」を選択しました。コマンドを入力してください。`,
      components: [],
    });
    return;
  }

  // Update the interaction to show processing
  await interaction.update({
    content: `プロジェクト「${selectedValue}」で処理中...`,
    components: [],
  });

  try {
    // Execute Claude command (no resumeSessionId for first execution after project selection)
    const result = await executeClaudeCommand({
      prompt: pending.prompt,
      workingDir: projectPath,
    });

    // Get the channel to send the response
    const channel = interaction.channel;

    if (!channel || !(channel instanceof TextChannel)) {
      logger.error({ threadId }, 'Failed to get channel for response');
      return;
    }

    // Fetch the original message to reply to it
    let originalMessage: Message | null = null;
    try {
      originalMessage = await channel.messages.fetch(pending.messageId);
    } catch {
      logger.warn({ messageId: pending.messageId }, 'Could not fetch original message');
    }

    if (!result.success) {
      const errorMessage = `エラーが発生しました: ${result.error ?? '不明なエラー'}`;
      if (originalMessage) {
        await originalMessage.reply(errorMessage);
      } else {
        await channel.send(errorMessage);
      }
      return;
    }

    // Save Claude session ID for future resumption
    if (result.claudeSessionId) {
      sessionManager.setClaudeSessionId(threadId, result.claudeSessionId);
    }

    // Process and send output
    const processed = processOutput(result.output);

    if (processed.type === 'message') {
      if (originalMessage) {
        await originalMessage.reply(processed.content);
      } else {
        await channel.send(processed.content);
      }
    } else {
      // Send as file attachment
      const buffer = Buffer.from(processed.content, 'utf-8');
      const payload = {
        content: '出力が長いためファイルとして添付しました。',
        files: [
          {
            attachment: buffer,
            name: processed.fileName ?? 'claude-response.txt',
          },
        ],
      };

      if (originalMessage) {
        await originalMessage.reply(payload);
      } else {
        await channel.send(payload);
      }
    }

    logger.info(
      { userId, threadId, outputType: processed.type, claudeSessionId: result.claudeSessionId },
      'Command completed successfully after project selection'
    );
  } catch (error) {
    logger.error({ error, userId, threadId }, 'Error processing command after project selection');

    const channel = interaction.channel;
    if (channel && channel instanceof TextChannel) {
      await channel.send('システムエラーが発生しました。しばらくしてから再試行してください。');
    }
  }
}
