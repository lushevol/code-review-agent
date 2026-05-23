import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const agentConfigSessions = pgTable("agent_config_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  config: jsonb("config"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const pullRequestReviews = pgTable("pull_request_reviews", {
  id: serial("id").primaryKey(),
  prId: integer("pr_id").notNull(),
  repoName: text("repo_name").notNull(),
  status: text("status").notNull().default("pending"),
  issues: jsonb("issues"),
  summary: text("summary"),
  reviewStartedAt: timestamp("review_started_at").defaultNow(),
  reviewCompletedAt: timestamp("review_completed_at"),
});
