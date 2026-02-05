import type { ClaudeExecuteOptions, ClaudeExecuteResult } from '../types/index.js';
import { executeClaudeCommand } from './executor.js';
import { logger } from '../utils/logger.js';

const MAX_QUEUE_SIZE = 5;
const QUEUE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

interface QueueEntry {
  options: ClaudeExecuteOptions;
  resolve: (result: ClaudeExecuteResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const queue: QueueEntry[] = [];
let running = false;

function processNext(): void {
  if (queue.length === 0) {
    running = false;
    return;
  }

  const entry = queue.shift()!;
  clearTimeout(entry.timer);
  run(entry);
}

async function run(entry: QueueEntry): Promise<void> {
  running = true;
  try {
    const result = await executeClaudeCommand(entry.options);
    entry.resolve(result);
  } catch (error) {
    logger.error({ error }, 'Execution queue: unexpected error');
    entry.resolve({
      success: false,
      output: '',
      error: 'キュー実行中に予期しないエラーが発生しました。',
    });
  } finally {
    processNext();
  }
}

export function enqueue(options: ClaudeExecuteOptions): Promise<ClaudeExecuteResult> {
  if (queue.length >= MAX_QUEUE_SIZE) {
    logger.warn({ queueSize: queue.length }, 'Execution queue full, rejecting request');
    return Promise.resolve({
      success: false,
      output: '',
      error: '現在リクエストが混み合っています。しばらくしてから再試行してください。',
    });
  }

  return new Promise<ClaudeExecuteResult>((resolve) => {
    const timer = setTimeout(() => {
      const index = queue.findIndex((e) => e.resolve === resolve);
      if (index !== -1) {
        queue.splice(index, 1);
        logger.warn('Execution queue: entry timed out while waiting');
        resolve({
          success: false,
          output: '',
          error: 'キュー待機がタイムアウトしました。しばらくしてから再試行してください。',
        });
      }
    }, QUEUE_TIMEOUT_MS);

    const entry: QueueEntry = { options, resolve, timer };

    if (!running) {
      run(entry);
    } else {
      queue.push(entry);
      logger.info({ position: queue.length }, 'Execution queue: request queued');
    }
  });
}

export function getQueueSize(): number {
  return queue.length;
}

export function isRunning(): boolean {
  return running;
}
