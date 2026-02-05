import {
  Client,
  Message,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { isUserAllowed } from '../../auth/accessControl.js';
import { executeClaudeCommand } from '../../claude/executor.js';
import { sessionManager } from '../../claude/sessionManager.js';
import { projectScanner } from '../../claude/projectScanner.js';
import { processOutput } from '../../claude/outputProcessor.js';
import { logger } from '../../utils/logger.js';

export async function handleMention(message: Message, client: Client): Promise<void> {
  const userId = message.author.id;

  // Access control check
  if (!isUserAllowed(userId)) {
    await message.reply('権限がありません。このボットは許可されたユーザーのみ使用できます。');
    return;
  }

  // Extract prompt by removing the mention
  const prompt = extractPrompt(message.content, client.user?.id ?? '');

  // Handle /project command for re-selecting project
  if (prompt.trim() === '/project') {
    const threadId = getThreadId(message);
    await showProjectSelector(message, threadId, '');
    return;
  }

  if (!prompt.trim()) {
    await message.reply('コマンドを入力してください。例: @Bot このコードを確認してください');
    return;
  }

  // Get thread ID for session management
  const threadId = getThreadId(message);

  logger.info(
    { userId, threadId, promptLength: prompt.length },
    'Processing command'
  );

  // Check if project is selected for this thread
  if (!sessionManager.hasWorkingDir(threadId)) {
    await showProjectSelector(message, threadId, prompt);
    return;
  }

  // Send "processing" indicator
  const processingMessage = await message.reply('処理中...');
  const workingDir = sessionManager.getWorkingDir(threadId);

  try {
    // Ensure internal session exists
    sessionManager.getOrCreateSession(threadId);

    // Get Claude CLI session ID for resuming (if exists)
    const resumeSessionId = sessionManager.getClaudeSessionId(threadId);

    // Execute Claude command with the selected working directory
    const result = await executeClaudeCommand({
      prompt,
      resumeSessionId,
      workingDir,
    });

    // Delete processing message
    await processingMessage.delete().catch(() => {
      // Ignore deletion errors
    });

    if (!result.success) {
      await message.reply(`エラーが発生しました: ${result.error ?? '不明なエラー'}`);
      return;
    }

    // Save Claude session ID for future resumption
    if (result.claudeSessionId) {
      sessionManager.setClaudeSessionId(threadId, result.claudeSessionId);
    }

    // Process and send output
    const processed = processOutput(result.output);

    if (processed.type === 'message') {
      await message.reply(processed.content);
    } else {
      // Send as file attachment
      const buffer = Buffer.from(processed.content, 'utf-8');
      await message.reply({
        content: '出力が長いためファイルとして添付しました。',
        files: [
          {
            attachment: buffer,
            name: processed.fileName ?? 'claude-response.txt',
          },
        ],
      });
    }

    logger.info(
      { userId, threadId, outputType: processed.type, claudeSessionId: result.claudeSessionId },
      'Command completed successfully'
    );
  } catch (error) {
    logger.error({ error, userId, threadId }, 'Error processing command');

    // Delete processing message if still exists
    await processingMessage.delete().catch(() => {
      // Ignore deletion errors
    });

    await message.reply('システムエラーが発生しました。しばらくしてから再試行してください。');
  }
}

function extractPrompt(content: string, botUserId: string): string {
  // Remove all mentions of the bot
  const mentionPattern = new RegExp(`<@!?${botUserId}>`, 'g');
  return content.replace(mentionPattern, '').trim();
}

function getThreadId(message: Message): string {
  // If the message is in a thread, use the thread ID
  // Otherwise, use the channel ID as the "thread" identifier
  if (message.thread) {
    return message.thread.id;
  }
  return message.channelId;
}

async function showProjectSelector(
  message: Message,
  threadId: string,
  prompt: string
): Promise<void> {
  const projects = projectScanner.getProjects();

  if (projects.length === 0) {
    await message.reply(
      'エラー: 利用可能なプロジェクトがありません。設定を確認してください。'
    );
    return;
  }

  // Store the pending prompt if provided
  if (prompt) {
    sessionManager.getOrCreateSession(threadId);
    sessionManager.setPendingPrompt(threadId, {
      prompt,
      messageId: message.id,
      channelId: message.channelId,
      userId: message.author.id,
      createdAt: new Date(),
    });
  }

  // Build select menu options
  const options = projects.slice(0, 25).map((project) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(project.name)
      .setValue(project.name)
      .setDescription(project.path.slice(0, 100))
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('project_select')
    .setPlaceholder('プロジェクトを選択')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu
  );

  await message.reply({
    content: 'プロジェクトを選択してください：',
    components: [row],
  });

  logger.debug(
    { threadId, projectCount: projects.length },
    'Displayed project selector'
  );
}
