import { spawn } from 'child_process';
import type { ClaudeExecuteOptions, ClaudeExecuteResult } from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export async function executeClaudeCommand(
  options: ClaudeExecuteOptions
): Promise<ClaudeExecuteResult> {
  const { prompt, resumeSessionId, workingDir, timeoutMs } = options;

  const effectiveWorkingDir = workingDir ?? config.claude.workingDir;
  const effectiveTimeout = timeoutMs ?? config.claude.timeoutMs;

  const planMode = options.planMode ?? false;
  const args = buildCliArgs(prompt, resumeSessionId, planMode);

  logger.info(
    { args, workingDir: effectiveWorkingDir, timeout: effectiveTimeout, resumeSessionId },
    'Executing Claude CLI - START'
  );

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('claude', args, {
      cwd: effectiveWorkingDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    logger.info({ pid: proc.pid }, 'Claude CLI process spawned');

    const timeoutHandle = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      logger.warn({ resumeSessionId }, 'Claude CLI execution timed out');
    }, effectiveTimeout);

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      logger.debug({ chunkLength: chunk.length }, 'Received stdout chunk');
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      logger.debug({ chunkLength: chunk.length, content: chunk.slice(0, 200) }, 'Received stderr chunk');
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);

      logger.info(
        { code, signal, pid: proc.pid, stdoutLength: stdout.length, stderrLength: stderr.length },
        'Claude CLI process closed'
      );

      if (killed) {
        resolve({
          success: false,
          output: '',
          error: 'タイムアウトしました。処理に時間がかかりすぎています。',
        });
        return;
      }

      if (code !== 0) {
        logger.error(
          { code, stderr, resumeSessionId },
          'Claude CLI exited with error'
        );
        resolve({
          success: false,
          output: '',
          error: stderr || `プロセスがコード ${code} で終了しました`,
        });
        return;
      }

      if (planMode) {
        const parsed = parseStreamJsonOutput(stdout);

        logger.info(
          { outputLength: stdout.length, claudeSessionId: parsed.sessionId, fullOutputLength: parsed.fullOutput.length },
          'Claude CLI completed successfully (planMode)'
        );

        resolve({
          success: true,
          output: parsed.result,
          claudeSessionId: parsed.sessionId,
          fullOutput: parsed.fullOutput,
        });
      } else {
        const parsed = parseJsonOutput(stdout);

        logger.info(
          { outputLength: stdout.length, claudeSessionId: parsed.sessionId },
          'Claude CLI completed successfully'
        );

        resolve({
          success: true,
          output: parsed.result,
          claudeSessionId: parsed.sessionId,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutHandle);
      logger.error({ error, resumeSessionId }, 'Failed to spawn Claude CLI');
      resolve({
        success: false,
        output: '',
        error: `Claude CLI の起動に失敗しました: ${error.message}`,
      });
    });
  });
}

function buildCliArgs(prompt: string, resumeSessionId?: string, planMode?: boolean): string[] {
  const args = [
    '--print',
    '--output-format',
    planMode ? 'stream-json' : 'json',
    ...(planMode ? ['--verbose'] : []),
    '--dangerously-skip-permissions',
  ];

  // Resume existing session if session ID is provided
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  args.push(prompt);

  return args;
}

interface ParsedOutput {
  result: string;
  sessionId?: string;
}

interface ParsedStreamOutput {
  result: string;
  sessionId?: string;
  fullOutput: string;
}

function parseStreamJsonOutput(stdout: string): ParsedStreamOutput {
  const texts: string[] = [];
  let result = '';
  let sessionId: string | undefined;

  const lines = stdout.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            texts.push(block.text);
          }
        }
      }

      if (event.type === 'result') {
        sessionId = event.session_id;
        result = event.result ?? '';
      }
    } catch {
      // Skip lines that aren't valid JSON
    }
  }

  return {
    result,
    sessionId,
    fullOutput: texts.join('\n\n---\n\n'),
  };
}

function parseJsonOutput(stdout: string): ParsedOutput {
  try {
    const json = JSON.parse(stdout);
    return {
      result: json.result ?? '',
      sessionId: json.session_id,
    };
  } catch {
    // If JSON parsing fails, return raw output
    logger.warn('Failed to parse JSON output, returning raw output');
    return {
      result: stdout,
      sessionId: undefined,
    };
  }
}
