// CRUD functions for codeReviewIssuesTable

import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import dbLocal from "./client";
import {
  type CodeReviewIssue,
  codeReviewIssuesTable,
  type NewCodeReviewIssue,
} from "./db/schema";

export async function batchCreateCodeReviewIssues(
  issues: Omit<
    NewCodeReviewIssue,
    "id" | "createdAt" | "updatedAt" | "status"
  >[],
  db = dbLocal,
): Promise<CodeReviewIssue[]> {
  if (issues.length === 0) return [];
  const now = new Date().toISOString();
  return await db
    .insert(codeReviewIssuesTable)
    .values(
      issues.map((i) => ({
        ...i,
        status: "open",
      })),
    )
    .returning();
}

export async function getCodeReviewIssueById(
  id: number,
  db = dbLocal,
): Promise<CodeReviewIssue | null> {
  const result = await db
    .select()
    .from(codeReviewIssuesTable)
    .where(eq(codeReviewIssuesTable.id, id));
  return result[0] ?? null;
}

export async function batchUpdateCodeReviewIssue(
  issues: (Partial<CodeReviewIssue> & Pick<CodeReviewIssue, "id">)[],
  db = dbLocal,
): Promise<CodeReviewIssue[]> {
  const updated: CodeReviewIssue[] = [];
  for (const issue of issues) {
    const { id, createdAt, updatedAt, ...rest } = issue;
    const [result] = await db
      .update(codeReviewIssuesTable)
      .set(rest)
      .where(eq(codeReviewIssuesTable.id, id))
      .returning();
    if (result) updated.push(result);
  }
  return updated;
}

export async function deleteCodeReviewIssue(
  id: number,
  db = dbLocal,
): Promise<void> {
  await db
    .delete(codeReviewIssuesTable)
    .where(eq(codeReviewIssuesTable.id, id));
}

export async function listCodeReviewIssues(
  filter?: Partial<
    CodeReviewIssue & {
      prReviewIdList?: number[];
      pageNo: number;
      pageSize: number;
    }
  >,
  db = dbLocal,
): Promise<{
  data: CodeReviewIssue[];
  total: number;
  pageNo: number;
  pageSize: number;
}> {
  const pageNo = Math.max(0, Number(filter?.pageNo ?? 0));
  const pageSize = Math.min(200, Math.max(1, Number(filter?.pageSize ?? 50)));
  const { pageNo: _pageNo, pageSize: _pageSize, ...restFilters } = filter ?? {};
  const conditions =
    restFilters && Object.keys(restFilters).length > 0
      ? Object.entries(restFilters).map(([key, value]) => {
          if (
            [
              codeReviewIssuesTable.updatedAt.name,
              codeReviewIssuesTable.createdAt.name,
            ].includes(key as any)
          ) {
            return gte((codeReviewIssuesTable as any)[key], value);
          }
          if (key === "prReviewIdList" && Array.isArray(value)) {
            return inArray(
              codeReviewIssuesTable["prReviewId"],
              value as number[],
            );
          }
          return eq((codeReviewIssuesTable as any)[key], value);
        })
      : [];
  const query =
    conditions.length > 0
      ? db
          .select()
          .from(codeReviewIssuesTable)
          .where(and(...conditions))
          .orderBy(desc(codeReviewIssuesTable.updatedAt))
          .limit(pageSize)
          .offset(pageNo * pageSize)
      : db
          .select()
          .from(codeReviewIssuesTable)
          .orderBy(desc(codeReviewIssuesTable.updatedAt))
          .limit(pageSize)
          .offset(pageNo * pageSize);
  const data = await query;

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(codeReviewIssuesTable)
    .where(conditions.length ? and(...conditions) : undefined);

  return {
    data,
    total: Number(count),
    pageNo,
    pageSize,
  };
}

// get all unclassified issues
export async function getAllUnclassifiedIssues(
  { pageNo, pageSize }: { pageNo: number; pageSize: number },
  db = dbLocal,
): Promise<CodeReviewIssue[]> {
  const rows = await db
    .select()
    .from(codeReviewIssuesTable)
    .where(
      or(
        eq(codeReviewIssuesTable.issueCategory, ""),
        eq(codeReviewIssuesTable.issueSubCategory, ""),
      ),
    )
    .offset(pageNo * pageSize)
    .limit(pageSize);
  return rows;
}
