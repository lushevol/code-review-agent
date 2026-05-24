import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import { codeChangeSummaryAgent } from "./agents/code-change-summary-agent";
import { codeReviewAgent } from "./agents/code-review-agent";
import { codeReviewEvaluationJudgeAgent } from "./agents/code-review-evaluation-agent";
import { codeReviewIssueClassificationAgent } from "./agents/code-review-issue-classification-agent";
import { codeReviewRescoreAgent } from "./agents/code-review-rescore-agent";
import { prReviewWorkflow } from "./workflows/pr-review-workflow";

export const mastra = new Mastra({
  workflows: { prReviewWorkflow },
  agents: {
    codeReviewAgent,
    codeReviewRescoreAgent,
    codeReviewIssueClassificationAgent,
    codeChangeSummaryAgent,
    codeReviewEvaluationJudgeAgent,
  },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  observability: {
    default: {
      enabled: false, // enable or disable all telemetry by default
    },
  },
  telemetry: { enabled: false }, // disable telemetry
  bundler: {
    externals: [
      "sonarqube-webapis",
      "sonarqube-webapis/dist/src/enums",
      "sonarqube-webapis/dist/src/resources",
      "readable-stream",
      "request",
      "protobufjs",
    ],
  },
});
