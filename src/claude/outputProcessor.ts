import type { ProcessedOutput } from '../types/index.js';

const SAFE_MESSAGE_LIMIT = 1900; // Leave some margin for reply formatting (Discord limit: 2000)

export function processOutput(output: string): ProcessedOutput {
  const trimmedOutput = output.trim();

  if (trimmedOutput.length <= SAFE_MESSAGE_LIMIT) {
    return {
      type: 'message',
      content: trimmedOutput || '(出力なし)',
    };
  }

  // Output is too long, return as file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `claude-response-${timestamp}.txt`;

  return {
    type: 'file',
    content: trimmedOutput,
    fileName,
  };
}

export function formatCodeBlock(code: string, language?: string): string {
  const lang = language ?? '';
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}
