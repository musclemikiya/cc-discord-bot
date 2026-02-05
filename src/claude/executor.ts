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

  const args = buildCliArgs(prompt, resumeSessionId);

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

      // Parse JSON output to extract session_id and result
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

function buildCliArgs(prompt: string, resumeSessionId?: string): string[] {
  const args = [
    '--print',
    '--output-format',
    'json',
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
