import {
  Client,
  Events,
  Interaction,
  StringSelectMenuInteraction,
  TextChannel,
  ThreadChannel,
  Message,
} from 'discord.js';
import { sessionManager } from '../../claude/sessionManager.js';
import { projectScanner } from '../../claude/projectScanner.js';
import { enqueue, getQueueSize, isRunning } from '../../claude/executionQueue.js';
import { processOutput } from '../../claude/outputProcessor.js';
import { logger } from '../../utils/logger.js';

function isSendableChannel(channel: unknown): channel is TextChannel | ThreadChannel {
  return channel instanceof TextChannel || channel instanceof ThreadChannel;
}

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

  // スレッド名をプロジェクト名に変更
  const channel = interaction.channel;
  if (channel instanceof ThreadChannel) {
    await channel.setName(selectedValue).catch((err) => {
      logger.warn({ error: err, threadId }, 'Failed to rename thread');
    });
  }

  // Check for pending prompt
  const pending = sessionManager.consumePendingPrompt(threadId);

  if (!pending) {
    await interaction.update({
      content: `プロジェクト「${selectedValue}」を選択しました。コマンドを入力してください。`,
      components: [],
    });
    return;
  }

  // Detect /plan prefix in pending prompt
  let planMode = false;
  let effectivePrompt = pending.prompt;

  if (pending.prompt.trim().startsWith('/plan')) {
    planMode = true;
    effectivePrompt = pending.prompt.trim().slice('/plan'.length).trim();
  }

  // Update the interaction to show processing with queue status
  const queueSize = getQueueSize();
  const queueStatus = isRunning() ? `（キュー待機中: ${queueSize + 1}番目）` : '';
  await interaction.update({
    content: `プロジェクト「${selectedValue}」で処理中...${queueStatus}`,
    components: [],
  });

  try {
    // Execute Claude command through the execution queue (no resumeSessionId for first execution)
    const result = await enqueue({
      prompt: effectivePrompt,
      workingDir: projectPath,
      planMode,
    });

    // Get the channel to send the response
    const channel = interaction.channel;

    if (!channel || !isSendableChannel(channel)) {
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

    // planMode時: 全文をmdファイルとして添付
    if (result.fullOutput) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const buf = Buffer.from(result.fullOutput, 'utf-8');
      const planPayload = {
        content: '実装計画の詳細:',
        files: [{ attachment: buf, name: `plan-${timestamp}.md` }],
      };

      if (originalMessage) {
        await originalMessage.reply(planPayload);
      } else {
        await channel.send(planPayload);
      }
    }

    logger.info(
      { userId, threadId, outputType: processed.type, planMode, claudeSessionId: result.claudeSessionId },
      'Command completed successfully after project selection'
    );
  } catch (error) {
    logger.error({ error, userId, threadId }, 'Error processing command after project selection');

    const channel = interaction.channel;
    if (channel && isSendableChannel(channel)) {
      await channel.send('システムエラーが発生しました。しばらくしてから再試行してください。');
    }
  }
}
