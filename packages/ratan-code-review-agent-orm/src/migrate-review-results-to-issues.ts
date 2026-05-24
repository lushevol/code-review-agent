// TypeScript migration function for moving review results to codeReviewIssuesTable

import { threadId } from "node:worker_threads";
import { and, eq, ne } from "drizzle-orm";
import drizzleDb from "./client"; // adjust import as needed
import { codeReviewIssuesTable, pullRequestReviewMemory } from "./db/schema";

// export async function migratecodeReviewIssuessToIssues() {
//   console.log("Starting migration: codeReviewIssues -> codeReviewIssuesTable");

//   // Fetch all PR reviews with non-empty codeReviewIssues
//   const prReviews = await drizzleDb
//     .select({
//       codeReviewIssues: pullRequestReviewMemory.codeReviewIssues,
//       prId: pullRequestReviewMemory.prId,
//       commentThreadId: pullRequestReviewMemory.commentThreadId,
//       createdAt: pullRequestReviewMemory.createdAt,
//       updatedAt: pullRequestReviewMemory.updatedAt,
//     })
//     .from(pullRequestReviewMemory)
//     .where(
//       and(
//         ne(pullRequestReviewMemory.codeReviewIssues, ""),
//         ne(pullRequestReviewMemory.codeReviewIssues, "[]"),
//       ),
//     );

//   let migratedCount = 0;
//   for (const pr of prReviews) {
//     let reviewItems: any[] = [];
//     try {
//       reviewItems = JSON.parse(pr.codeReviewIssues);
//       if (!Array.isArray(reviewItems)) {
//         console.warn(
//           `prId=${pr.prId}: codeReviewIssues is not an array, skipping.`,
//         );
//         continue;
//       }
//     } catch (err) {
//       console.error(
//         `prId=${pr.prId}: Failed to parse codeReviewIssues JSON:`,
//         err,
//       );
//       continue;
//     }

//     let index = 0;
//     for (const item of reviewItems) {
//       await drizzleDb.insert(codeReviewIssuesTable).values({
//         prReviewId: pr.prId,
//         commentThreadId: pr.commentThreadId,
//         checklistNo: index,
//         filePath: item.file ?? "",
//         line: item.line ?? 0,
//         severity: item.severity ?? "",
//         priority: item.priority ?? "",
//         message: item.message ?? "",
//         suggestion: item.suggestion ?? "",
//         suggestionCode: item.suggestion_code ?? "",
//         issueCategory: item.issueCategory ?? "",
//         issueSubCategory: item.issueSubCategory ?? "",
//         status: "open",
//         comment: "",
//         createdAt: pr.createdAt,
//         updatedAt: pr.updatedAt,
//       });
//       index++;
//       migratedCount++;
//     }

//     // Optionally clear codeReviewIssues after migration
//     // await drizzleDb
//     //   .update(pullRequestReviewMemory)
//     //   .set({ codeReviewIssues: '' })
//     //   .where(eq(pullRequestReviewMemory.id, pr.id));
//   }

//   console.log(
//     `Migration complete. Migrated ${migratedCount} code review issues.`,
//   );
// }
