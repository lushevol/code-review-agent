import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

const ratanCodeReviewAgent = pgSchema("ratan_code_review_agent");

export const summaryMemoryTable = ratanCodeReviewAgent.table(
  "summary",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    key: varchar({ length: 255 }).notNull(), // id of resource
    type: varchar({ length: 50 }).notNull(), // resource type workitem/page
    originResource: text().notNull(), // origin content of resource
    originResourceVersion: varchar({ length: 50 }).notNull(), // origin resource version
    summary: text().notNull(), // summary of resource
    updatedAt: varchar({ length: 100 }).notNull(), // last updated timestamp
    createdAt: varchar({ length: 100 }).notNull(), // created timestamp
    metadata: text().notNull(), // metadata of resource
    agentName: varchar({ length: 50 }).notNull(), // name of agent
  },
);
export type SummaryMemory = typeof summaryMemoryTable.$inferSelect;
export type NewSummaryMemory = typeof summaryMemoryTable.$inferInsert;

export const pullRequestReviewMemory = ratanCodeReviewAgent.table(
  "pull_request_review",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    repo: varchar("repo", { length: 100 }).notNull(), // repository name
    prId: integer("pr_id").notNull(), // pull request id
    sourceBranch: varchar("source_branch", { length: 100 })
      .notNull()
      .default(""), // source branch of pull request
    targetBranch: varchar("target_branch", { length: 100 })
      .notNull()
      .default(""), // target branch of pull request
    latestSourceCommit: varchar("latest_source_commit", { length: 100 })
      .notNull()
      .default(""), // latest source commit id
    latestTargetCommit: varchar("latest_target_commit", { length: 100 })
      .notNull()
      .default(""), // latest target commit id
    status: varchar("status", { length: 50 }).notNull().default(""), // pending, processing, done, failed
    title: varchar("title", { length: 255 }).notNull().default(""), // title of pull request
    raisedBy: varchar("raised_by", { length: 100 }).notNull().default(""), // user who raised the pull request,
    codeReviewPassed: boolean("code_review_passed").notNull().default(false), // whether code review passed
    sonarResult: text("sonar_result").notNull().default(""), // sonar result
    commentThreadId: integer("comment_thread_id").notNull().default(0), // comment thread id where the review comment is posted
    prCreatedAt: varchar("pr_created_at", { length: 100 })
      .notNull()
      .default(""), // pull request created timestamp
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("repo_idx").on(table.repo),
    index("prId_idx").on(table.prId),
    index("status_idx").on(table.status),
    index("title_idx").on(table.title),
    index("raisedBy_idx").on(table.raisedBy),
    index("codeReviewPassed_idx").on(table.codeReviewPassed),
    index("prCreatedAt_idx").on(table.prCreatedAt),
    index("updatedAt_idx").on(table.updatedAt),
  ],
);
export type PullRequestReviewMemory =
  typeof pullRequestReviewMemory.$inferSelect;
export type NewPullRequestReviewMemory =
  typeof pullRequestReviewMemory.$inferInsert;

export const codeReviewIssuesTable = ratanCodeReviewAgent.table(
  "reviewed_issues",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    prReviewId: integer("pr_review_id")
      .notNull()
      .references(() => pullRequestReviewMemory.prId), // pull request review id,
    commentThreadId: integer("comment_thread_id").notNull(),
    checklistNo: integer("checklist_no").notNull().default(0),
    filePath: text("file_path").notNull(), // file path where the issue is found
    line: integer("line").notNull(), // line number where the issue is found
    message: text("message").notNull(), // issue message
    suggestion: text("suggestion").notNull().default(""), // suggestion to fix the issue
    suggestionCode: text("suggestion_code").notNull().default(""), // code suggestion to fix the issue
    confidenceScore: doublePrecision("confidence_score").notNull().default(0), // confidence score of the issue detection
    severity: varchar("severity", { length: 50 }).notNull().default(""), // severity of the issue
    priority: varchar("priority", { length: 50 }).notNull().default(""), // priority of the issue
    issueCategory: varchar("issue_category", { length: 100 })
      .notNull()
      .default(""), // issue category
    issueSubCategory: varchar("issue_sub_category", { length: 100 })
      .notNull()
      .default(""), // issue sub-category
    status: varchar("status", { length: 50 }).notNull().default("open"), // open, closed
    comment: text("comment").notNull().default(""), // comment on the issue
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("issuePrReviewId_idx").on(table.prReviewId),
    index("issueSeverity_idx").on(table.severity),
    index("issuePriority_idx").on(table.priority),
    index("issueCategory_idx").on(table.issueCategory),
    index("issueSubCategory_idx").on(table.issueSubCategory),
    index("issueStatus_idx").on(table.status),
    index("issueUpdatedAt_idx").on(table.updatedAt),
  ],
);
export type CodeReviewIssue = typeof codeReviewIssuesTable.$inferSelect;
export type NewCodeReviewIssue = typeof codeReviewIssuesTable.$inferInsert;

export const reviewedIssueTrackingTable = ratanCodeReviewAgent.table(
  "reviewed_issues_tracking",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    prReviewId: integer("pr_review_id")
      .notNull()
      .references(() => pullRequestReviewMemory.prId), // pull request review id
    issueId: integer("issue_id")
      .notNull()
      .references(() => codeReviewIssuesTable.id), // code review issue id
    workItemId: integer("work_item_id"), // work item id in ADO
    status: varchar("status", { length: 50 }).notNull().default("open"), // open, closed
    falsePositive: boolean("false_positive"), // whether the issue is a false positive
    falsePositiveReason: text("false_positive_reason").notNull().default(""), // reason for marking as false positive
    comment: text("comment").notNull().default(""), // comment on the issue
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("issueTrackingPrReviewId_idx").on(table.prReviewId),
    index("issueTrackingIssueId_idx").on(table.issueId),
    index("issueTrackingWorkItemId_idx").on(table.workItemId),
    index("issueTrackingStatus_idx").on(table.status),
    index("issueTrackingFalsePositive_idx").on(table.falsePositive),
    index("issueTrackingCreatedAt_idx").on(table.createdAt),
    index("issueTrackingUpdatedAt_idx").on(table.updatedAt),
  ],
);
export type ReviewedIssueTracking =
  typeof reviewedIssueTrackingTable.$inferSelect;
export type NewReviewedIssueTracking =
  typeof reviewedIssueTrackingTable.$inferInsert;
