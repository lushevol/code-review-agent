import type { ChangedFile } from "../workspace/types";

export const ReviewFocus = [
  "general",
  "tests",
  "error-handling",
  "type-design",
  "comments",
] as const;
export type ReviewFocus = (typeof ReviewFocus)[number];

export interface ReviewFocusSelection {
  focus: ReviewFocus;
  reasons: string[];
}

const ERROR_HANDLING_PATTERN = /\b(catch|retry|fallback|onError|errorBoundary)\b/i;
const CALLBACK_ERROR_PATTERN =
  /\b(?:callback|cb)\s*\(\s*(?:err|error)\b|\(\s*(?:err|error)\s*\)\s*=>/i;
const DEFAULT_FALLBACK_PATTERN = /(?:\?\?|\|\||\bdefault(?:Value)?\s*:)/i;
const EXPORTED_TYPE_PATTERN =
  /^\s*export\s+(?:declare\s+)?(?:interface|type|class|enum)\b/;
const COMMENT_PATTERN = /(?:^\s*(?:\/\/|\/\*|\*|<!--))|(?:\s\/\/)|(?:\s\/\*)|<!--/;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|(?:^|\/)[^/]+\.(?:spec|test|test-utils)\.[^/]+$|(?:^|\/)[^/]+\.test(?:\/|$)/i;
const PRODUCTION_CODE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;
const DOCUMENTATION_PATTERN = /(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING)\.md$|\.mdx?$/i;

export function selectReviewFocuses(
  changes: ChangedFile[],
): ReviewFocusSelection[] {
  const selections: ReviewFocusSelection[] = [
    {
      focus: "general",
      reasons: ["General review applies to every pull request."],
    },
  ];
  const changedLines = changes.flatMap((change) => change.addedLines.map((line) => line.text));
  const changedProductionCode = changes.some(
    (change) =>
      change.addedLines.length > 0 &&
      PRODUCTION_CODE_PATTERN.test(change.path) &&
      !TEST_FILE_PATTERN.test(change.path),
  );
  const changedTests = changes.some(
    (change) => change.addedLines.length > 0 && TEST_FILE_PATTERN.test(change.path),
  );

  if (changedProductionCode && !changedTests) {
    selections.push({
      focus: "tests",
      reasons: ["Production code changed without matching test-file changes."],
    });
  }
  if (
    changedLines.some(
      (line) =>
        ERROR_HANDLING_PATTERN.test(line) ||
        DEFAULT_FALLBACK_PATTERN.test(line) ||
        CALLBACK_ERROR_PATTERN.test(line),
    )
  ) {
    selections.push({
      focus: "error-handling",
      reasons: ["Changed lines contain error handling, retry, fallback, or default behavior."],
    });
  }
  if (
    changes.some(
      (change) =>
        (change.addedLines.length > 0 &&
          /(?:^|\/)(?:domain|model|models|types)(?:\/|$)/i.test(change.path)) ||
        change.addedLines.some((line) => EXPORTED_TYPE_PATTERN.test(line.text)),
    )
  ) {
    selections.push({
      focus: "type-design",
      reasons: ["Changed code introduces exported or domain-model types."],
    });
  }
  if (
    changes.some(
      (change) =>
        (change.addedLines.length > 0 &&
          DOCUMENTATION_PATTERN.test(change.path)) ||
        change.addedLines.some((line) => COMMENT_PATTERN.test(line.text)),
    )
  ) {
    selections.push({
      focus: "comments",
      reasons: ["Changed documentation or code comments need accuracy review."],
    });
  }

  return selections;
}
