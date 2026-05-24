import dayjs from "dayjs";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import dbLocal from "./client"; // assumes you have a db instance exported from db/index.ts or similar
import {
  type NewPullRequestReviewMemory,
  pullRequestReviewMemory,
} from "./db/schema";

// Create a new pull request review
async function createPullRequestReview(
  data: Omit<NewPullRequestReviewMemory, "id" | "createdAt" | "updatedAt">,
  db = dbLocal,
) {
  return db.insert(pullRequestReviewMemory).values(data).returning();
}

// Get latest pull request review by prId
export async function getLatestPullRequestReviewByPRId(
  prId: number,
  db = dbLocal,
) {
  return db
    .select()
    .from(pullRequestReviewMemory)
    .where(eq(pullRequestReviewMemory.prId, prId))
    .orderBy(desc(pullRequestReviewMemory.createdAt))
    .limit(1);
}

// Get pull request review by prId
async function getPullRequestReview(
  prId: number,
  sourceCommit: string,
  targetCommit: string,
  db = dbLocal,
) {
  return db
    .select()
    .from(pullRequestReviewMemory)
    .where(
      and(
        eq(pullRequestReviewMemory.prId, prId),
        eq(pullRequestReviewMemory.latestSourceCommit, sourceCommit),
        eq(pullRequestReviewMemory.latestTargetCommit, targetCommit),
      ),
    );
}

export async function getPullRequestReviewByIds(ids: number[], db = dbLocal) {
  const rows = await db
    .select({
      id: pullRequestReviewMemory.id,
      repo: pullRequestReviewMemory.repo,
      prId: pullRequestReviewMemory.prId,
    })
    .from(pullRequestReviewMemory)
    .where(inArray(pullRequestReviewMemory.id, ids));
  return rows ?? [];
}

export async function searchPullRequestReview(
  params: {
    status?: string;
    repo?: string;
    prIdList?: number[];
    prId?: number;
    codeReviewPassed?: boolean;
    latestSourceCommit?: string;
    latestTargetCommit?: string;
    updatedAt?: string;
    pageNo: number;
    pageSize: number;
  },
  db = dbLocal,
) {
  params.pageNo = Math.max(0, Number(params.pageNo ?? 0));
  params.pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 20)));

  const conditions = [];
  if (params.status) {
    conditions.push(eq(pullRequestReviewMemory.status, params.status));
  }
  if (params.repo) {
    conditions.push(eq(pullRequestReviewMemory.repo, params.repo));
  }
  if (params.prId) {
    conditions.push(eq(pullRequestReviewMemory.prId, Number(params.prId)));
  }
  if (params.prIdList && params.prIdList.length > 0) {
    conditions.push(inArray(pullRequestReviewMemory.prId, params.prIdList));
  }
  if (params.codeReviewPassed !== undefined) {
    conditions.push(
      eq(pullRequestReviewMemory.codeReviewPassed, params.codeReviewPassed),
    );
  }
  if (params.latestSourceCommit) {
    conditions.push(
      eq(pullRequestReviewMemory.latestSourceCommit, params.latestSourceCommit),
    );
  }
  if (params.latestTargetCommit) {
    conditions.push(
      eq(pullRequestReviewMemory.latestTargetCommit, params.latestTargetCommit),
    );
  }

  if (params.updatedAt) {
    conditions.push(
      gte(pullRequestReviewMemory.updatedAt, dayjs(params.updatedAt).toDate()),
    );
  }

  // Get paginated data
  const data = await db
    .select({
      id: pullRequestReviewMemory.id,
      prId: pullRequestReviewMemory.prId,
      repo: pullRequestReviewMemory.repo,
      title: pullRequestReviewMemory.title,
      codeReviewPassed: pullRequestReviewMemory.codeReviewPassed,
      status: pullRequestReviewMemory.status,
      sourceBranch: pullRequestReviewMemory.sourceBranch,
      targetBranch: pullRequestReviewMemory.targetBranch,
      latestSourceCommit: pullRequestReviewMemory.latestSourceCommit,
      latestTargetCommit: pullRequestReviewMemory.latestTargetCommit,
      raisedBy: pullRequestReviewMemory.raisedBy,
      sonarResult: pullRequestReviewMemory.sonarResult,
      commentThreadId: pullRequestReviewMemory.commentThreadId,
      prCreatedAt: pullRequestReviewMemory.prCreatedAt,
      createdAt: pullRequestReviewMemory.createdAt,
      updatedAt: pullRequestReviewMemory.updatedAt,
    })
    .from(pullRequestReviewMemory)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(pullRequestReviewMemory.updatedAt))
    .limit(params.pageSize)
    .offset(params.pageNo * params.pageSize);

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pullRequestReviewMemory)
    .where(conditions.length ? and(...conditions) : undefined);

  return {
    data,
    total: Number(count),
    pageNo: params.pageNo,
    pageSize: params.pageSize,
  };
}

// Update a pull request review by id
async function updatePullRequestReview(
  prId: number,
  data: Partial<
    Omit<NewPullRequestReviewMemory, "id" | "prId" | "createdAt" | "updatedAt">
  >,
  db = dbLocal,
) {
  return db
    .update(pullRequestReviewMemory)
    .set(data)
    .where(eq(pullRequestReviewMemory.prId, prId))
    .returning();
}

export async function upsertPullRequestReview(
  data: Omit<NewPullRequestReviewMemory, "id" | "createdAt" | "updatedAt">,
  db = dbLocal,
) {
  const existing = await getPullRequestReview(
    data.prId,
    data.latestSourceCommit ?? "",
    data.latestTargetCommit ?? "",
    db,
  );
  const existingReview = existing.at(0);
  if (existingReview) {
    return updatePullRequestReview(existingReview.prId, data, db);
  } else {
    return createPullRequestReview(data, db);
  }
}
