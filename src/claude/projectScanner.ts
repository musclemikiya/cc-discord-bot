import { readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import type { ProjectInfo } from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class ProjectScanner {
  private baseDir: string;
  private allowList: string[];
  private denyList: string[];

  constructor() {
    this.baseDir = resolve(config.projects.baseDir);
    this.allowList = config.projects.allowList;
    this.denyList = config.projects.denyList;
  }

  scan(): ProjectInfo[] {
    const projects: ProjectInfo[] = [];

    try {
      const entries = readdirSync(this.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const name = entry.name;

        // Skip denied directories
        if (this.denyList.includes(name)) {
          continue;
        }

        // If allowList is not empty, only include allowed projects
        if (this.allowList.length > 0 && !this.allowList.includes(name)) {
          continue;
        }

        const projectPath = join(this.baseDir, name);

        projects.push({
          name,
          path: projectPath,
        });
      }

      logger.debug({ count: projects.length }, 'Scanned projects');
      return projects;
    } catch (error) {
      logger.error({ error, baseDir: this.baseDir }, 'Failed to scan projects');
      return [];
    }
  }

  getProjects(): ProjectInfo[] {
    return this.scan();
  }

  getProjectPath(name: string): string | null {
    const projects = this.scan();
    const project = projects.find((p) => p.name === name);
    return project?.path ?? null;
  }

  isValidPath(targetPath: string): boolean {
    // Resolve and normalize the path
    const resolvedPath = resolve(targetPath);

    // Check if the path starts with the base directory
    if (!resolvedPath.startsWith(this.baseDir)) {
      logger.warn(
        { targetPath, resolvedPath, baseDir: this.baseDir },
        'Path traversal attempt detected'
      );
      return false;
    }

    // Verify the directory exists
    try {
      const stats = statSync(resolvedPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}

export const projectScanner = new ProjectScanner();
