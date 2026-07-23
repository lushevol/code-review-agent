import fs from "node:fs";

const [prPath, threadsPath, statusesPath, expectedDecision, expectFencedSuggestion] =
  process.argv.slice(2);
const pr = JSON.parse(fs.readFileSync(prPath, "utf8"));
const threads = JSON.parse(fs.readFileSync(threadsPath, "utf8")).value ?? [];
const statuses = JSON.parse(fs.readFileSync(statusesPath, "utf8")).value ?? [];

const summaryEntries = threads.flatMap((thread) =>
  (thread.comments ?? [])
    .filter(
      (comment) =>
        !thread.isDeleted &&
        !comment.isDeleted &&
        comment.content?.includes("<!-- pr-guardian:review-summary -->"),
    )
    .map((comment) => ({ content: comment.content, threadId: thread.id })),
);

if (summaryEntries.length !== 1) {
  throw new Error(`Expected one canonical review summary, found ${summaryEntries.length}`);
}

const [{ content: summary, threadId: summaryThreadId }] = summaryEntries;
const newestVisibleThreadId = Math.max(
  ...threads.filter((thread) => !thread.isDeleted).map((thread) => Number(thread.id)),
);
if (Number(summaryThreadId) !== newestVisibleThreadId) {
  throw new Error(
    `Expected conclusion to be newest thread ${newestVisibleThreadId}, found ${summaryThreadId}`,
  );
}
if (!summary.includes("**SonarQube:**")) {
  throw new Error("Canonical review summary does not contain a SonarQube result");
}

const commitPrefix = pr.lastMergeSourceCommit?.commitId?.slice(0, 10);
if (commitPrefix && !summary.includes(`\`${commitPrefix}\``)) {
  throw new Error(`Canonical review summary does not reference commit ${commitPrefix}`);
}

const mergeStatuses = statuses
  .filter((status) => status.context?.name === "PR Guardian / Merge Gate")
  .sort((left, right) => Number(left.id) - Number(right.id));
const latestStatus = mergeStatuses.at(-1);
const expectedState = expectedDecision === "allowed" ? "succeeded" : "failed";
const expectedHeading =
  expectedDecision === "allowed" ? "### ✅ No blocking issues" : "### ❌ Changes requested";

if (latestStatus?.state !== expectedState) {
  throw new Error(
    `Expected latest merge status ${expectedState}, found ${latestStatus?.state ?? "none"}`,
  );
}
if (!summary.includes(expectedHeading)) {
  throw new Error(`Canonical review summary does not contain: ${expectedHeading}`);
}

const activeCurrentFindings = threads.filter(
  (thread) =>
    thread.status === "active" &&
    !thread.isDeleted &&
    (thread.comments ?? []).some(
      (comment) => !comment.isDeleted && comment.content?.includes("Useful? Reply with 👍."),
    ),
);
if (expectedDecision === "allowed" && activeCurrentFindings.length !== 0) {
  throw new Error(`Expected no active current-format findings, found ${activeCurrentFindings.length}`);
}
if (expectedDecision === "blocked" && activeCurrentFindings.length === 0) {
  throw new Error("Expected at least one active current-format finding");
}
if (expectFencedSuggestion === "true") {
  const hasFencedSuggestion = activeCurrentFindings.some((thread) =>
    (thread.comments ?? []).some(
      (comment) =>
        !comment.isDeleted &&
        /\*\*Suggested fix:\*\*\s+```\n[\s\S]+?\n```/.test(comment.content ?? ""),
    ),
  );
  if (!hasFencedSuggestion) {
    throw new Error("Expected an active finding with a plain fenced code block");
  }
}

console.log(
  `OK  ADO decision ${expectedDecision}: ${latestStatus.description}; conclusion is newest thread ${summaryThreadId}; one canonical summary; SonarQube and commit included${expectFencedSuggestion === "true" ? "; plain fenced fix included" : ""}`,
);
