import { minimatch } from "minimatch";
import { getLogger } from "../utils/logger";
import type { ConfigProvider } from "agent-config-manager";
import { getPRQueue } from "./pr-queue";

// ─── Constants ───────────────────────────────────────────────────────────────

const REPO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LLM_HEALTH_CHECK_TIMEOUT_MS = 5_000;

// ─── Repo Cache ──────────────────────────────────────────────────────────────

interface CachedRepos {
  repos: { name?: string }[];
  fetchedAt: number;
}

let repoCache: CachedRepos | null = null;

// ─── Auto Scan Service ───────────────────────────────────────────────────────

export class AutoScanService {
  private logger = getLogger("auto-scan");
  private repoPatterns: string[] = [];
  private prCreatedDaysAgo = 7;

  constructor() {}

  setRepoPatterns(patterns: string[]) {
    this.repoPatterns = patterns;
  }

  setPrCreatedDaysAgo(days: number) {
    this.prCreatedDaysAgo = days;
  }

  /**
   * Check if the LLM endpoint is reachable before scanning.
   */
  async isLLMEndpointHealthy(url: string, token: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      LLM_HEALTH_CHECK_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": token,
        },
      });

      if (response.status < 500 && response.status !== 401 && response.status !== 403) {
        return true;
      }
      this.logger.warn(
        `LLM endpoint returned: ${response.status} ${response.statusText}`,
      );
      return false;
    } catch (err) {
      this.logger.warn(
        `LLM endpoint not reachable (${url}): ${(err as Error).message}`,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch repos with daily caching.
   */
  private async getCachedRepos(
    adoClient: { getRepos(): Promise<{ name?: string }[]> },
  ): Promise<{ name?: string }[]> {
    const now = Date.now();
    if (repoCache && now - repoCache.fetchedAt < REPO_CACHE_TTL_MS) {
      this.logger.debug(
        `Using cached repo list (${repoCache.repos.length} repos, fetched ${Math.round((now - repoCache.fetchedAt) / 60000)}m ago)`,
      );
      return repoCache.repos;
    }

    this.logger.info("Fetching repo list from ADO...");
    const repos = await adoClient.getRepos();
    repoCache = { repos, fetchedAt: now };
    this.logger.info(
      `Cached ${repos.length} repos (24h TTL)`,
    );
    return repos;
  }

  /**
   * Run a scan of all repos matching the configured patterns.
   * Finds open PRs and enqueues them for processing.
   */
  async scan(provider: ConfigProvider): Promise<number> {
    const queue = getPRQueue();
    const adoClient = provider.getAdoClient();

    const rootConfig = await provider.getRootConfig();
    const patterns =
      this.repoPatterns.length > 0
        ? this.repoPatterns
        : (rootConfig.scanRepoNames ?? []);
    const daysAgo = this.prCreatedDaysAgo;
    const createdSince = new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000,
    ).toISOString();

    // 1. Fetch repos (cached daily)
    const myRepos = await this.getCachedRepos(adoClient);

    // 2. Filter by pattern
    const targetRepos = patterns.length
      ? myRepos.filter(
          (repo) =>
            repo.name &&
            patterns.some((pattern: string) => minimatch(repo.name, pattern)),
        )
      : myRepos;

    this.logger.info(
      `Found ${targetRepos.length} matching repos (of ${myRepos.length} total)`,
    );

    let enqueued = 0;

    // 3. Scan each repo for open PRs
    for (const repo of targetRepos) {
      if (!repo.name) continue;

      try {
        const prs =
          (await adoClient.getPullRequestListByRepoName(
            repo.name,
            1, // top
            createdSince,
          )) ?? [];

        for (const pr of prs) {
          if (!pr.pullRequestId) continue;

          // Validate PR (not draft, not abandoned, etc.)
          const isValid = adoClient.isValidPullRequest(pr);
          if (!isValid) continue;

          // Check if already commented
          const prDetails = await adoClient.getPullRequestById(
            pr.pullRequestId,
            false,
            true, // lightweight = true (no diffs)
          );
          const hasAlreadyCommented = adoClient.hasAlreadyCommented(
            prDetails.commentThreads ?? [],
          );
          if (hasAlreadyCommented) continue;

          // Enqueue with build pipeline check (done at dequeue time)
          queue.enqueue({
            prId: pr.pullRequestId,
            repoName: repo.name,
            repoId: pr.repository?.id,
          });
          enqueued++;
        }
      } catch (err) {
        this.logger.error(
          `Error scanning repo ${repo.name}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.info(
      `Auto-scan complete: ${enqueued} PR(s) enqueued`,
    );
    return enqueued;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: AutoScanService | null = null;

export function getAutoScanService(): AutoScanService {
  if (!_instance) {
    _instance = new AutoScanService();
  }
  return _instance;
}
