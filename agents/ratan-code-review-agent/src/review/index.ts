import { codeChangeSummaryAgent } from "./agents/code-change-summary-agent";
import { codeReviewAgent } from "./agents/code-review-agent";
import { codeReviewEvaluationJudgeAgent } from "./agents/code-review-evaluation-agent";
import { codeReviewIssueClassificationAgent } from "./agents/code-review-issue-classification-agent";
import { codeReviewRescoreAgent } from "./agents/code-review-rescore-agent";
import type { AgentRegistry } from "./runtime";

const agentMap = {
  codeChangeSummaryAgent,
  codeReviewAgent,
  codeReviewEvaluationJudgeAgent,
  codeReviewIssueClassificationAgent,
  codeReviewRescoreAgent,
};

export const reviewAgents: AgentRegistry = {
  getAgent(id: string) {
    const agent = agentMap[id as keyof typeof agentMap];
    if (!agent) {
      throw new Error(`Unknown review agent: ${id}`);
    }
    return agent;
  },
};

export * from "./types";
