// TypeScript

import dayjs from "dayjs";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import dbLocal from "./client";
import {
  type NewReviewedIssueTracking,
  type ReviewedIssueTracking,
  reviewedIssueTrackingTable,
} from "./db/schema";

// Create
export async function batchCreateReviewedIssueTracking(
  data: Omit<NewReviewedIssueTracking, "updatedAt" | "createdAt">[],
  db = dbLocal,
): Promise<ReviewedIssueTracking[]> {
  const rows = await db
    .insert(reviewedIssueTrackingTable)
    .values(data)
    .returning();
  return rows;
}

// Read
export async function getReviewedIssueTrackingById(
  id: number,
  db = dbLocal,
): Promise<ReviewedIssueTracking | null> {
  const [row] = await db
    .select()
    .from(reviewedIssueTrackingTable)
    .where(eq(reviewedIssueTrackingTable.id, id));
  return row ?? null;
}

// Search
export async function searchReviewedIssueTracking(
  filter: Partial<ReviewedIssueTracking> & {
    issueIdList: number[];
    pageNo: number;
    pageSize: number;
  },
  db = dbLocal,
) {
  filter.pageNo = Math.max(0, Number(filter?.pageNo ?? 0));
  filter.pageSize = Math.min(200, Math.max(1, Number(filter?.pageSize ?? 50)));
  const { pageNo, pageSize, ...restFilters } = filter;
  const conditions =
    restFilters && Object.keys(restFilters).length > 0
      ? Object.entries(restFilters).map(([key, value]) => {
          if (key === reviewedIssueTrackingTable.updatedAt.name) {
            return gte(
              reviewedIssueTrackingTable.updatedAt,
              dayjs(value as string).toDate(),
            );
          } else if (key === reviewedIssueTrackingTable.createdAt.name) {
            return gte(
              reviewedIssueTrackingTable.createdAt,
              dayjs(value as string).toDate(),
            );
          } else if (
            key === "issueIdList" &&
            Array.isArray(value) &&
            value.length > 0
          ) {
            return inArray(
              reviewedIssueTrackingTable.issueId,
              value as number[],
            );
          }
          return eq((reviewedIssueTrackingTable as any)[key], value);
        })
      : [];
  try {
    const result = await db
      .select()
      .from(reviewedIssueTrackingTable)
      .where(and(...conditions))
      .limit(filter.pageSize)
      .offset(filter.pageNo * filter.pageSize);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(reviewedIssueTrackingTable)
      .where(conditions.length ? and(...conditions) : undefined);
    return {
      data: result,
      total: Number(count),
      pageNo: Number(filter?.pageNo ?? 0),
      pageSize: Number(filter?.pageSize ?? result.length),
    };
  } catch (error) {
    console.error("Failed to search reviewed issue tracking:", error);
    return {
      data: [],
      total: 0,
      pageNo: 0,
      pageSize: 0,
    };
  }
}

export async function searchReviewedIssueTrackingByIds(
  issueIds: number[],
  db = dbLocal,
): Promise<ReviewedIssueTracking[]> {
  if (issueIds.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(reviewedIssueTrackingTable)
    .where(inArray(reviewedIssueTrackingTable.issueId, issueIds));
  return rows;
}

// Update
export async function updateReviewedIssueTracking(
  id: number,
  data: Partial<NewReviewedIssueTracking>,
  db = dbLocal,
): Promise<ReviewedIssueTracking | null> {
  const [row] = await db
    .update(reviewedIssueTrackingTable)
    .set(data)
    .where(eq(reviewedIssueTrackingTable.id, id))
    .returning();
  return row ?? null;
}

// Delete
export async function deleteReviewedIssueTracking(
  id: number,
  db = dbLocal,
): Promise<boolean> {
  const result = await db
    .delete(reviewedIssueTrackingTable)
    .where(eq(reviewedIssueTrackingTable.id, id));
  return result.rowCount ? result.rowCount > 0 : false;
}
