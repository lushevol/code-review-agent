export const repoSpecificPromptMapping = {
  "51358-ratanone-db-repository": `
    1. sql is expected to contains $ or § before a variable, it's designed by rule engine, please skip the validation on this check. e.g. §Entity__Counterparty_SCI_FMID
    `,
};

export const repoSpecificPrompt = (repoName: string) => {
  const prompt = repoSpecificPromptMapping[repoName] || "";

  if (!prompt) return "";

  return `# Repository Specific Guidelines
  In this repository, please consider the following guidelines:
  ${prompt}
  `;
};

export const projectSpecificPrompt = () => {
  return `## Project Specific Guidelines
  In this project, please consider the following guidelines:
  - The project is mainly for Financial Market Infrastructure, please be aware of the domain specific terms.
  - skip reporting on Entity Code and Counterparty Code string content naming issues, e.g. "SCB HONGKON*HKG"`;
};

export const languageSpecificPrompt = (extension: string) => {
  switch (extension) {
    case "ts":
      return `## TypeScript Specific Guidelines
      When reviewing TypeScript code, please consider the following guidelines:
      - Ensure proper use of types and interfaces.
      - Check for potential null or undefined values.
      - Verify that async/await is used correctly for asynchronous operations.
      - Look for any potential performance issues related to type assertions or type casting.
      - Ensure that the code adheres to best practices for error handling in TypeScript.`;
    case "js":
    case "jsx":
      return `## JavaScript/JSX Specific Guidelines
      When reviewing JavaScript/JSX code, please consider the following guidelines:
      - Ensure proper use of ES6+ features.
      - Check for potential null or undefined values.
      - Verify that async/await or Promises are used correctly for asynchronous operations.
      - Look for any potential performance issues related to DOM manipulation or event handling.
      - Ensure that the code adheres to best practices for error handling in JavaScript.`;
    case "tsx":
      return `## TSX Specific Guidelines
      When reviewing TSX code, please consider the following guidelines:
      - Ensure proper use of React and TypeScript together.
      - Check for correct typing of props and state.
      - Verify that async/await is used correctly for asynchronous operations.
      - Look for any potential performance issues related to rendering or component lifecycle.
      - Ensure that the code adheres to best practices for error handling in TSX.`;
    case "java":
      return `## Java Specific Guidelines
      When reviewing Java code, please consider the following guidelines:
      - Ensure proper use of object-oriented principles.
      - Check for potential null pointer exceptions.
      - Verify that asynchronous operations are handled correctly using threads or concurrency utilities.
      - Look for any potential performance issues related to memory management.
      - Ensure that the code adheres to best practices for error handling in Java.
      - Check all date format patterns use "yy" for calendar year, not "YY" (week year).`;
    case "sql":
      return `## SQL Specific Guidelines
      When reviewing SQL code, please consider the following guidelines:
      - Ensure proper use of joins and subqueries.
      - Check for potential SQL injection vulnerabilities.
      - Verify that queries are optimized for performance.
      - Look for any potential issues with data integrity or normalization.
      - Ensure that the code adheres to best practices for error handling in SQL.`;
    default:
      return "";
  }
};
