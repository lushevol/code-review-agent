CREATE TABLE "ratan_code_review_agent"."reviewed_issues" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ratan_code_review_agent"."reviewed_issues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pr_review_id" integer NOT NULL,
	"comment_thread_id" integer NOT NULL,
	"checklist_no" integer DEFAULT 0 NOT NULL,
	"file_path" text NOT NULL,
	"line" integer NOT NULL,
	"message" text NOT NULL,
	"suggestion" text DEFAULT '' NOT NULL,
	"suggestion_code" text DEFAULT '' NOT NULL,
	"confidence_score" double precision DEFAULT 0 NOT NULL,
	"severity" varchar(50) DEFAULT '' NOT NULL,
	"priority" varchar(50) DEFAULT '' NOT NULL,
	"issue_category" varchar(100) DEFAULT '' NOT NULL,
	"issue_sub_category" varchar(100) DEFAULT '' NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratan_code_review_agent"."pull_request_review" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ratan_code_review_agent"."pull_request_review_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repo" varchar(100) NOT NULL,
	"pr_id" integer NOT NULL,
	"source_branch" varchar(100) DEFAULT '' NOT NULL,
	"target_branch" varchar(100) DEFAULT '' NOT NULL,
	"latest_source_commit" varchar(100) DEFAULT '' NOT NULL,
	"latest_target_commit" varchar(100) DEFAULT '' NOT NULL,
	"status" varchar(50) DEFAULT '' NOT NULL,
	"title" varchar(255) DEFAULT '' NOT NULL,
	"raised_by" varchar(100) DEFAULT '' NOT NULL,
	"code_review_passed" boolean DEFAULT false NOT NULL,
	"sonar_result" text DEFAULT '' NOT NULL,
	"comment_thread_id" integer DEFAULT 0 NOT NULL,
	"pr_created_at" varchar(100) DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratan_code_review_agent"."reviewed_issues_tracking" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ratan_code_review_agent"."reviewed_issues_tracking_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pr_review_id" integer NOT NULL,
	"issue_id" integer NOT NULL,
	"work_item_id" integer,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"false_positive" boolean,
	"false_positive_reason" text DEFAULT '' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratan_code_review_agent"."summary" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ratan_code_review_agent"."summary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"originResource" text NOT NULL,
	"originResourceVersion" varchar(50) NOT NULL,
	"summary" text NOT NULL,
	"updatedAt" varchar(100) NOT NULL,
	"createdAt" varchar(100) NOT NULL,
	"metadata" text NOT NULL,
	"agentName" varchar(50) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ratan_code_review_agent"."reviewed_issues" ADD CONSTRAINT "reviewed_issues_pr_review_id_pull_request_review_id_fk" FOREIGN KEY ("pr_review_id") REFERENCES "ratan_code_review_agent"."pull_request_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratan_code_review_agent"."reviewed_issues_tracking" ADD CONSTRAINT "reviewed_issues_tracking_pr_review_id_pull_request_review_id_fk" FOREIGN KEY ("pr_review_id") REFERENCES "ratan_code_review_agent"."pull_request_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratan_code_review_agent"."reviewed_issues_tracking" ADD CONSTRAINT "reviewed_issues_tracking_issue_id_reviewed_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "ratan_code_review_agent"."reviewed_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issuePrReviewId_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("pr_review_id");--> statement-breakpoint
CREATE INDEX "issueSeverity_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "issuePriority_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "issueCategory_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("issue_category");--> statement-breakpoint
CREATE INDEX "issueSubCategory_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("issue_sub_category");--> statement-breakpoint
CREATE INDEX "issueStatus_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "issueUpdatedAt_idx" ON "ratan_code_review_agent"."reviewed_issues" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "repo_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("repo");--> statement-breakpoint
CREATE INDEX "prId_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "status_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("status");--> statement-breakpoint
CREATE INDEX "title_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("title");--> statement-breakpoint
CREATE INDEX "raisedBy_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("raised_by");--> statement-breakpoint
CREATE INDEX "codeReviewPassed_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("code_review_passed");--> statement-breakpoint
CREATE INDEX "prCreatedAt_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("pr_created_at");--> statement-breakpoint
CREATE INDEX "updatedAt_idx" ON "ratan_code_review_agent"."pull_request_review" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "issueTrackingPrReviewId_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("pr_review_id");--> statement-breakpoint
CREATE INDEX "issueTrackingIssueId_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issueTrackingWorkItemId_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "issueTrackingStatus_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("status");--> statement-breakpoint
CREATE INDEX "issueTrackingFalsePositive_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("false_positive");--> statement-breakpoint
CREATE INDEX "issueTrackingCreatedAt_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "issueTrackingUpdatedAt_idx" ON "ratan_code_review_agent"."reviewed_issues_tracking" USING btree ("updated_at");