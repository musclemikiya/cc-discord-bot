import { randomUUID } from 'crypto';
import type { SessionInfo, PendingPrompt } from '../types/index.js';
import { logger } from '../utils/logger.js';

class SessionManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private pendingPrompts: Map<string, PendingPrompt> = new Map();

  getOrCreateSession(threadId: string): string {
    const existing = this.sessions.get(threadId);

    if (existing) {
      existing.lastUsedAt = new Date();
      logger.debug(
        { threadId, sessionId: existing.sessionId },
        'Reusing existing session'
      );
      return existing.sessionId;
    }

    const sessionId = randomUUID();
    const sessionInfo: SessionInfo = {
      sessionId,
      threadId,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    this.sessions.set(threadId, sessionInfo);
    logger.info({ threadId, sessionId }, 'Created new session');

    return sessionId;
  }

  getSession(threadId: string): SessionInfo | undefined {
    return this.sessions.get(threadId);
  }

  deleteSession(threadId: string): boolean {
    const deleted = this.sessions.delete(threadId);
    if (deleted) {
      logger.info({ threadId }, 'Deleted session');
    }
    return deleted;
  }

  cleanupOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [threadId, session] of this.sessions.entries()) {
      if (now - session.lastUsedAt.getTime() > maxAgeMs) {
        this.sessions.delete(threadId);
        this.pendingPrompts.delete(threadId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up old sessions');
    }

    return cleaned;
  }

  // Working directory management
  setWorkingDir(threadId: string, workingDir: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.workingDir = workingDir;
      session.lastUsedAt = new Date();
      logger.info({ threadId, workingDir }, 'Set working directory for session');
    }
  }

  getWorkingDir(threadId: string): string | undefined {
    return this.sessions.get(threadId)?.workingDir;
  }

  hasWorkingDir(threadId: string): boolean {
    return this.sessions.get(threadId)?.workingDir !== undefined;
  }

  resetSession(threadId: string): string {
    // Delete existing session and create a new one
    this.sessions.delete(threadId);
    return this.getOrCreateSession(threadId);
  }

  // Claude CLI session ID management
  setClaudeSessionId(threadId: string, claudeSessionId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
      logger.info({ threadId, claudeSessionId }, 'Set Claude session ID');
    }
  }

  getClaudeSessionId(threadId: string): string | undefined {
    return this.sessions.get(threadId)?.claudeSessionId;
  }

  // Pending prompt management
  setPendingPrompt(threadId: string, pending: PendingPrompt): void {
    this.pendingPrompts.set(threadId, pending);
    logger.debug({ threadId, messageId: pending.messageId }, 'Stored pending prompt');
  }

  getPendingPrompt(threadId: string): PendingPrompt | undefined {
    return this.pendingPrompts.get(threadId);
  }

  consumePendingPrompt(threadId: string): PendingPrompt | undefined {
    const pending = this.pendingPrompts.get(threadId);
    if (pending) {
      this.pendingPrompts.delete(threadId);
      logger.debug({ threadId }, 'Consumed pending prompt');
    }
    return pending;
  }
}

export const sessionManager = new SessionManager();
