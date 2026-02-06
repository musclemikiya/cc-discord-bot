import {
  Client,
  Message,
  MessageCreateOptions,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { isUserAllowed } from '../../auth/accessControl.js';
import { enqueue, getQueueSize, isRunning } from '../../claude/executionQueue.js';
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
    let threadCtx: ThreadContext;
    try {
      threadCtx = await getOrCreateThread(message);
    } catch (error) {
      logger.error({ error, userId }, 'Failed to create thread for /project');
      await message.reply('スレッドの作成に失敗しました。ボットにスレッド作成権限があるか確認してください。');
      return;
    }
    await showProjectSelector(message, threadCtx, '');
    return;
  }

  if (!prompt.trim()) {
    await message.reply('コマンドを入力してください。例: @Bot このコードを確認してください');
    return;
  }

  // Create or get thread for session management
  let threadCtx: ThreadContext;
  try {
    threadCtx = await getOrCreateThread(message);
  } catch (error) {
    logger.error({ error, userId }, 'Failed to create thread');
    await message.reply('スレッドの作成に失敗しました。ボットにスレッド作成権限があるか確認してください。');
    return;
  }

  const { threadId, sendReply } = threadCtx;

  logger.info(
    { userId, threadId, promptLength: prompt.length },
    'Processing command'
  );

  // Check if project is selected for this thread
  if (!sessionManager.hasWorkingDir(threadId)) {
    await showProjectSelector(message, threadCtx, prompt);
    return;
  }

  // Send "processing" indicator with queue status
  const queueSize = getQueueSize();
  const queueStatus = isRunning() ? `（キュー待機中: ${queueSize + 1}番目）` : '';
  const processingMessage = await sendReply(`処理中...${queueStatus}`);
  const workingDir = sessionManager.getWorkingDir(threadId);

  try {
    // Ensure internal session exists
    sessionManager.getOrCreateSession(threadId);

    // Get Claude CLI session ID for resuming (if exists)
    const resumeSessionId = sessionManager.getClaudeSessionId(threadId);

    // Execute Claude command through the execution queue
    const result = await enqueue({
      prompt,
      resumeSessionId,
      workingDir,
    });

    // Delete processing message
    await processingMessage.delete().catch(() => {
      // Ignore deletion errors
    });

    if (!result.success) {
      await sendReply(`エラーが発生しました: ${result.error ?? '不明なエラー'}`);
      return;
    }

    // Save Claude session ID for future resumption
    if (result.claudeSessionId) {
      sessionManager.setClaudeSessionId(threadId, result.claudeSessionId);
    }

    // Process and send output
    const processed = processOutput(result.output);

    if (processed.type === 'message') {
      await sendReply(processed.content);
    } else {
      // Send as file attachment
      const buffer = Buffer.from(processed.content, 'utf-8');
      await sendReply({
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

    await sendReply('システムエラーが発生しました。しばらくしてから再試行してください。');
  }
}

function extractPrompt(content: string, botUserId: string): string {
  // Remove all mentions of the bot
  const mentionPattern = new RegExp(`<@!?${botUserId}>`, 'g');
  return content.replace(mentionPattern, '').trim();
}

interface ThreadContext {
  threadId: string;
  sendReply: (options: string | MessageCreateOptions) => Promise<Message>;
}

async function getOrCreateThread(message: Message): Promise<ThreadContext> {
  // スレッド内 → 既存スレッドを継続
  if (message.channel.isThread()) {
    return {
      threadId: message.channel.id,
      sendReply: (options) => message.reply(options),
    };
  }

  // チャンネル → 新規スレッド作成
  if (!(message.channel instanceof TextChannel)) {
    throw new Error('スレッドを作成できないチャンネルタイプです。');
  }

  const now = new Date();
  const timestamp = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const threadName = `Claude | ${message.author.displayName} | ${timestamp}`.slice(0, 100);

  const thread = await message.startThread({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
  });

  return {
    threadId: thread.id,
    sendReply: (options) => thread.send(options),
  };
}

async function showProjectSelector(
  message: Message,
  threadCtx: ThreadContext,
  prompt: string
): Promise<void> {
  const { threadId, sendReply } = threadCtx;
  const projects = projectScanner.getProjects();

  if (projects.length === 0) {
    await sendReply(
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
      channelId: threadId,
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

  await sendReply({
    content: 'プロジェクトを選択してください：',
    components: [row],
  });

  logger.debug(
    { threadId, projectCount: projects.length },
    'Displayed project selector'
  );
}
