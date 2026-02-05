export interface ClaudeExecuteOptions {
  prompt: string;
  resumeSessionId?: string;  // Claude CLI session ID to resume
  workingDir?: string;
  timeoutMs?: number;
}

export interface ClaudeExecuteResult {
  success: boolean;
  output: string;
  error?: string;
  claudeSessionId?: string;  // Session ID returned by Claude CLI
}

export interface SessionInfo {
  sessionId: string;          // Internal session ID (UUID for thread management)
  threadId: string;
  createdAt: Date;
  lastUsedAt: Date;
  workingDir?: string;
  claudeSessionId?: string;   // Claude CLI session ID (for --resume)
}

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface PendingPrompt {
  prompt: string;
  messageId: string;
  channelId: string;
  userId: string;
  createdAt: Date;
}

export interface ProcessedOutput {
  type: 'message' | 'file';
  content: string;
  fileName?: string;
}
