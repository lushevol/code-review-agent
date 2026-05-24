export const codeCommentHelper = ({
  issue,
  severity,
  priority,
  suggestion,
  suggestionCode,
  survey,
}: {
  issue: string;
  severity: string;
  priority: string;
  suggestion: string;
  suggestionCode?: string;
  survey: boolean;
}) => {
  let res = "";
  if (severity) {
    res += `**Severity:** ${severity}\n\n`;
  }
  if (priority) {
    res += `**Priority:** ${priority}\n\n`;
  }
  if (issue) {
    res += `**Issue:** ${issue}\n\n`;
  }
  if (suggestion) {
    res += `**Suggestion:** ${suggestion}\n\n`;
  }
  if (suggestionCode) {
    res += "```\n" + suggestionCode + "\n```\n\n";
  }
  if (survey) {
    res +=
      "---\n" +
      "*Is it a valid issue ? Please reply and resolve.*\n" +
      "- Yes\n" +
      "- No, by design\n" +
      "- No, lack of context\n";
  }
  return res;
};
