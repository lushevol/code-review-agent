import { sql } from "drizzle-orm";
import dbLocal from "./client";
import {
  codeReviewIssuesTable,
  pullRequestReviewMemory,
  reviewedIssueTrackingTable,
} from "./db/schema";

// Helper to build date filter
function dateFilter(table: any, from: string, to: string) {
  return sql`${table.createdAt} >= ${from} AND ${table.createdAt} <= ${to}`;
}

export async function getCodeReviewAgentStatistics(
  from: string,
  to: string,
  db = dbLocal,
) {
  const [prReviewCount] = await getPullRequestReviewCount(from, to, db);
  const prReviewCountByDate = await getPullRequestReviewCountByDate(
    from,
    to,
    db,
  );
  const prReviewPassedRate = await getPullRequestReviewPassedRate(from, to, db);

  const issuesTotalCount = await getCodeReviewIssuesTotalCount(from, to, db);
  const issuesSeverityRate = await getCodeReviewIssuesSeverityRate(
    from,
    to,
    db,
  );
  const issuesPriorityRate = await getCodeReviewIssuesPriorityRate(
    from,
    to,
    db,
  );
  const issuesCategories = await getCodeReviewIssuesCategories(from, to, db);

  const reviewedIssueCount = await getReviewedIssueTrackingCount(from, to, db);
  const reviewedIssueFalsePositiveRate =
    await getReviewedIssueFalsePositiveRate(from, to, db);

  return {
    pullRequestReview: {
      totalReviews: Number(prReviewCount?.count) ?? 0,
      reviewsByDate: prReviewCountByDate,
      reviewPassedRate: prReviewPassedRate,
    },
    codeReviewIssues: {
      total: Number(issuesTotalCount.at(0)?.count) ?? 0,
      severityRate: issuesSeverityRate,
      priorityRate: issuesPriorityRate,
      categories: issuesCategories.toSorted((a, b) => b.count - a.count),
    },
    reviewedIssueTracking: {
      totalReviewedIssues: Number(reviewedIssueCount[0]?.count) ?? 0,
      falsePositiveRate: reviewedIssueFalsePositiveRate,
    },
  };
}

// 1. Pull Request Review Memory Metrics
export async function getPullRequestReviewCount(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(pullRequestReviewMemory)
    .where(dateFilter(pullRequestReviewMemory, from, to));
}

export async function getPullRequestReviewCountByDate(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({
      date: sql`date(${pullRequestReviewMemory.createdAt})`,
      count: sql<number>`count(*)`,
    })
    .from(pullRequestReviewMemory)
    .where(dateFilter(pullRequestReviewMemory, from, to))
    .groupBy(sql`date(${pullRequestReviewMemory.createdAt})`)
    .orderBy(sql`date(${pullRequestReviewMemory.createdAt})`);
}

export async function getPullRequestReviewPassedRate(
  from: string,
  to: string,
  db = dbLocal,
) {
  const total = await getPullRequestReviewCount(from, to, db);
  const passed = await db
    .select({ count: sql<number>`count(*)` })
    .from(pullRequestReviewMemory)
    .where(
      sql`${pullRequestReviewMemory.codeReviewPassed} = true AND ${dateFilter(pullRequestReviewMemory, from, to)}`,
    );
  return {
    total: Number(total[0]?.count) ?? 0,
    passed: Number(passed[0]?.count) ?? 0,
    rate: Number(total[0]?.count)
      ? Number((Number(passed[0]?.count) / Number(total[0]?.count)).toFixed(4))
      : 0,
  };
}

// 2. Code Review Issues Metrics
export async function getCodeReviewIssuesTotalCount(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(codeReviewIssuesTable)
    .where(dateFilter(codeReviewIssuesTable, from, to));
}

export async function getCodeReviewIssuesSeverityRate(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({
      severity: codeReviewIssuesTable.severity,
      count: sql<number>`count(*)`,
    })
    .from(codeReviewIssuesTable)
    .where(dateFilter(codeReviewIssuesTable, from, to))
    .groupBy(codeReviewIssuesTable.severity);
}

export async function getCodeReviewIssuesPriorityRate(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({
      priority: codeReviewIssuesTable.priority,
      count: sql<number>`count(*)`,
    })
    .from(codeReviewIssuesTable)
    .where(dateFilter(codeReviewIssuesTable, from, to))
    .groupBy(codeReviewIssuesTable.priority);
}

export async function getCodeReviewIssuesCategories(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({
      category: codeReviewIssuesTable.issueCategory,
      subCategory: codeReviewIssuesTable.issueSubCategory,
      count: sql<number>`count(*)`,
    })
    .from(codeReviewIssuesTable)
    .where(dateFilter(codeReviewIssuesTable, from, to))
    .groupBy(
      codeReviewIssuesTable.issueCategory,
      codeReviewIssuesTable.issueSubCategory,
    );
}

// 3. Reviewed Issue Tracking Metrics
export async function getReviewedIssueTrackingCount(
  from: string,
  to: string,
  db = dbLocal,
) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(reviewedIssueTrackingTable)
    .where(dateFilter(reviewedIssueTrackingTable, from, to));
}

export async function getReviewedIssueFalsePositiveRate(
  from: string,
  to: string,
  db = dbLocal,
) {
  const total = await getReviewedIssueTrackingCount(from, to, db);
  const falsePositives = await db
    .select({ count: sql<number>`count(*)` })
    .from(reviewedIssueTrackingTable)
    .where(
      sql`${reviewedIssueTrackingTable.falsePositive} = true AND ${dateFilter(reviewedIssueTrackingTable, from, to)}`,
    );
  return {
    total: Number(total[0]?.count) ?? 0,
    falsePositives: Number(falsePositives[0]?.count) ?? 0,
    rate: Number(total[0]?.count)
      ? Number(
          (Number(falsePositives[0]?.count) / Number(total[0]?.count)).toFixed(
            4,
          ),
        )
      : 0,
  };
}
