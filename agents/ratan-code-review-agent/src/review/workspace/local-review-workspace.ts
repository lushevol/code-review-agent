import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AdoPullRequestMetadata } from "ratan-ado-api";
import type {
  AddedLine,
  ChangedFile,
  ChangedFileStatus,
  ReviewWorkspace,
  ReviewWorkspaceProvider,
} from "./types";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 32 * 1024 * 1024;

export interface LocalReviewWorkspaceOptions {
  workspaceRoot?: string;
  adoToken?: string;
  maxGitOutputBytes?: number;
  useSsh?: boolean;
}

export class LocalReviewWorkspaceProvider implements ReviewWorkspaceProvider {
  private readonly workspaceRoot: string;
  private readonly adoToken: string;
  private readonly maxGitOutputBytes: number;
  private readonly useSsh: boolean;

  constructor(options: LocalReviewWorkspaceOptions = {}) {
    this.workspaceRoot = path.resolve(
      options.workspaceRoot ?? ".ratan/workspaces",
    );
    this.adoToken = options.adoToken ?? "";
    this.maxGitOutputBytes = options.maxGitOutputBytes ?? MAX_GIT_OUTPUT;
    this.useSsh = options.useSsh ?? false;
  }

  async withWorkspace<T>(
    metadata: AdoPullRequestMetadata,
    callback: (workspace: ReviewWorkspace) => Promise<T>,
  ): Promise<T> {
    const safeRepoId = metadata.repoId.replace(/[^A-Za-z0-9._-]/g, "_");
    const cachePath = path.join(this.workspaceRoot, "repos", `${safeRepoId}.git`);
    const runDirectory = path.join(
      this.workspaceRoot,
      "runs",
      `${metadata.pullRequestId}-${metadata.latestSourceCommitId.slice(0, 8)}-${randomUUID()}`,
    );
    const repoPath = path.join(runDirectory, "checkout");

    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(runDirectory), { recursive: true, mode: 0o700 });
    await this.pruneStaleWorktrees(cachePath);

    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true, mode: 0o700 });
      await this.git(["init", "--bare", cachePath]);
    }

    const targetRef = `refs/ratan/pr/${metadata.pullRequestId}/target`;
    const sourceRef = `refs/ratan/pr/${metadata.pullRequestId}/source`;
    const targetFetchUrl = this.useSsh && metadata.sshUrl ? metadata.sshUrl : metadata.cloneUrl;
    const sourceFetchUrl = this.useSsh && metadata.sourceSshUrl ? metadata.sourceSshUrl : metadata.sourceCloneUrl;
    await this.git([
      "--git-dir",
      cachePath,
      "fetch",
      "--force",
      targetFetchUrl,
      `+${metadata.targetRefName}:${targetRef}`,
    ]);
    await this.git([
      "--git-dir",
      cachePath,
      "fetch",
      "--force",
      sourceFetchUrl,
      `+${metadata.sourceRefName}:${sourceRef}`,
    ]);

    await this.git([
      "--git-dir",
      cachePath,
      "cat-file",
      "-e",
      `${metadata.latestTargetCommitId}^{commit}`,
    ]);
    await this.git([
      "--git-dir",
      cachePath,
      "cat-file",
      "-e",
      `${metadata.latestSourceCommitId}^{commit}`,
    ]);

    const mergeBaseCommit = (
      await this.git([
        "--git-dir",
        cachePath,
        "merge-base",
        metadata.latestTargetCommitId,
        metadata.latestSourceCommitId,
      ])
    ).trim();
    if (!mergeBaseCommit) {
      throw new Error(`No merge base found for pull request ${metadata.pullRequestId}`);
    }

    fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    await this.git([
      "--git-dir",
      cachePath,
      "worktree",
      "add",
      "--detach",
      repoPath,
      metadata.latestSourceCommitId,
    ]);

    try {
      const changes = await this.readChanges(
        repoPath,
        mergeBaseCommit,
        metadata.latestSourceCommitId,
      );
      return await callback({
        repoPath,
        mergeBaseCommit,
        headCommit: metadata.latestSourceCommitId,
        changes,
        runDirectory,
      });
    } finally {
      try {
        await this.git([
          "--git-dir",
          cachePath,
          "worktree",
          "remove",
          "--force",
          repoPath,
        ]);
      } catch {
        // The run directory removal below is the final cleanup fallback.
      }
      fs.rmSync(runDirectory, { recursive: true, force: true });
      await this.pruneStaleWorktrees(cachePath);
    }
  }

  private async pruneStaleWorktrees(cachePath: string) {
    if (!fs.existsSync(cachePath)) return;
    try {
      await this.git(["--git-dir", cachePath, "worktree", "prune"]);
    } catch {
      // A corrupt cache will fail loudly on the subsequent fetch.
    }
  }

  private async readChanges(
    repoPath: string,
    base: string,
    head: string,
  ): Promise<ChangedFile[]> {
    const output = await this.git(
      [
        "-C",
        repoPath,
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        base,
        head,
      ],
      true,
    );
    const fields = output.split("\0");
    const changes: ChangedFile[] = [];

    for (let index = 0; index < fields.length && fields[index]; ) {
      const statusToken = fields[index++];
      const statusCode = statusToken[0];
      const previousPath = statusCode === "R" ? fields[index++] : undefined;
      const filePath = fields[index++];
      const status = this.mapStatus(statusCode);
      const addedLines =
        status === "deleted"
          ? []
          : await this.readAddedLines(repoPath, base, head, filePath);
      changes.push({
        path: filePath,
        ...(previousPath ? { previousPath } : {}),
        status,
        addedLines,
      });
    }
    return changes;
  }

  private mapStatus(status: string): ChangedFileStatus {
    if (status === "A") return "added";
    if (status === "D") return "deleted";
    if (status === "R") return "renamed";
    return "modified";
  }

  private async readAddedLines(
    repoPath: string,
    base: string,
    head: string,
    filePath: string,
  ): Promise<AddedLine[]> {
    const patch = await this.git([
      "-C",
      repoPath,
      "diff",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      base,
      head,
      "--",
      filePath,
    ]);
    const result: AddedLine[] = [];
    let newLine = 0;
    let inHunk = false;

    for (const line of patch.split("\n")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        newLine = Number(hunk[1]);
        inHunk = true;
        continue;
      }
      if (!inHunk || line.startsWith("+++")) continue;
      if (line.startsWith("+")) {
        result.push({ line: newLine, text: line.slice(1) });
        newLine++;
      } else if (!line.startsWith("-")) {
        newLine++;
      }
    }
    return result;
  }

  private async git(args: string[], preserveNul = false): Promise<string> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_LFS_SKIP_SMUDGE: "1",
    };
    if (this.adoToken && !this.useSsh) {
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.extraHeader";
      env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`:${this.adoToken}`).toString("base64")}`;
    }
    const { stdout } = await execFileAsync("git", args, {
      env,
      encoding: "utf8",
      maxBuffer: this.maxGitOutputBytes,
      windowsHide: true,
    });
    return preserveNul ? stdout : stdout.trim();
  }
}
