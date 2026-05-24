import { and, eq } from "drizzle-orm";
import dbLocal from "./client";
import { summaryMemoryTable } from "./db/schema";

function isPostgresError(error: unknown): error is { code?: string; cause?: unknown } {
  return typeof error === "object" && error !== null;
}

export async function summaryMemorySearch(
  key: string,
  type: string,
  db = dbLocal,
) {
  try {
    const memory = await db
      .select()
      .from(summaryMemoryTable)
      .where(
        and(eq(summaryMemoryTable.key, key), eq(summaryMemoryTable.type, type)),
      );
    console.log(
      `Searching summary memory in the database with ${key} ${type}: ${memory}`,
    );

    return memory;
  } catch (error) {
    console.error("Error searching summary memory:", error);
    if (isPostgresError(error) && error.code === "23505") {
      console.error(error.cause);
    }
    throw error; // Re-throw the error for further handling if needed
  }
}

export async function summaryMemoryUpsert(
  {
    key,
    type,
    originResource,
    originResourceVersion,
    summary,
    metadata,
    agentName,
  }: {
    key: string;
    type: string;
    originResource?: string;
    originResourceVersion?: string;
    summary?: string;
    metadata?: string;
    agentName: string;
  },
  db = dbLocal,
) {
  const searchResults = await summaryMemorySearch(key, type, db);
  if (searchResults.length > 0) {
    console.log("Summary memory already exists, updating...");
    const existingMemory = searchResults.at(0);
    if (!existingMemory) {
      throw new Error("Summary memory search returned no rows");
    }
    const res = await db
      .update(summaryMemoryTable)
      .set({
        ...(originResource !== undefined ? { originResource } : {}),
        ...(originResourceVersion !== undefined ? { originResourceVersion } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        agentName,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(summaryMemoryTable.id, existingMemory.id));
    console.log("Summary memory updated!");
    return res;
  }
  console.log("Creating new summary memory...");
  const memory: typeof summaryMemoryTable.$inferInsert = {
    key,
    type,
    originResource: originResource ?? "",
    originResourceVersion: originResourceVersion ?? "",
    summary: summary ?? "",
    metadata: metadata ?? "",
    agentName,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  const res = await db.insert(summaryMemoryTable).values(memory);
  console.log("New summary memory created!");
  return res;
}
