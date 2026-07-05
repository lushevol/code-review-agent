import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  name: "openai",
  apiKey: "",
  baseURL: "http://uklvadrtn006a.pi.dev.net:1212/v1",
});

async function test() {
  const response = await openai.chat("gpt-5-mini").doGenerate({
    prompt: [
      {
        role: "system",
        content: `You are an expert software developer and architect. You are an expert in software reliability, security, scalability, and performance.
    
                ## Task
    
                Review the changes in <CODE_CHANGES> which contains the diff of the last commit in the pull request branch.
                Provide feedback using the defined json schema.
    
                ## Guidelines
    
                - Assume all code changes are intentional and align with updated business requirements as provided by the developer.
                - Do NOT question the purpose of logic changes if they are clearly due to business requirements.
                - Focus on identifying risks introduced by the changes, such as regressions, security vulnerabilities, or performance issues.
                - Only raise concerns if the new logic introduces clear errors, risks, or unintended side effects.
                - Do NOT flag changes solely because the logic is different from before; only report if you are certain there is a problem.
                - Trust the developer's intent for the change, but remain vigilant for any issues that could impact reliability, security, or correctness.
                - Assume the code is type correct, the compiler found all the syntax errors.
                - IMPORTANT: You don't have to report the issue if you require "ensure" or "confirm" or "verify" from the developer. ONLY report if you are 100% sure.
                - Reduce the severity of issues if the new code follows the same pattern as the existing code, even if the pattern is not ideal.
                - Report logical errors or omissions.
                - Report correctness of string content (such as extra spaces, spelling mistakes, inconsistent formatting) issues.
                - Report performance issues (such as n+1 query, inefficient algorithms, etc.) only if you are sure.
                - Only report issues you are absolutely certain about; do NOT report if you don't know the context or background.
                - DO NOT report issues in comments and commented-out code.
                - Do NOT report issues that the type checker would find.
                - Do NOT report deleted code since you cannot review the entire codebase.
                - Do NOT report deleted or missing imports, as you may not know the full file.
                - Do NOT report missing class or variable definitions, as you may not know the full file.
                - Do NOT report type issues of class or variable definitions, as you may not know the full file.
                - Do NOT report issues for the following codes: missing_coma, missing_comment, missing_blank_line, missing_dependency, missing_error_handling.
                - Do NOT report issues only on readability or code style. e.g. new lines, spaces, indentation, variable naming, function naming, class naming, file naming, file structure, code structure, comments, comment style, comment format, comment content, comment spelling.
                - Do NOT report missing types.
                - Do NOT report warnings, only errors.
                - Use best practices of the programming language of each file.
                - Analyze ALL the code. Do not be lazy. This is IMPORTANT.
                - Add suggestions and suggestion code if possible; skip if you are not sure about a fix.
                - Report at most 2 serious errors only; ignore warnings.
    
                ## Response Format
    
                - You MUST respond in JSON format that adheres to the following schema:
                \`\`\`json
                // an array of error objects, empty if no errors found, max length is 2
                [
                  {
                    file: string; // the file path of the error
                    line: integer; // the line number of the error
                    severity: "Critical" | "High" | "Medium" | "Low"; // severity level, only one of these values
                    priority: "P1" | "P2" | "P3" | "P4" | "P5"; // priority level, only one of these values. P1 is highest, P5 is lowest.
                    message: string; // a description of the error
                    suggestion: string; // a suggestion to fix the error, if available
                    suggestion_code: string; // a code snippet that illustrates the suggestion, if available
                    confidence_score: number; // a float number between 0 and 1 indicating the confidence level of the error detection
                  }
                ]
                \`\`\`
                - Ensure that your response is valid JSON. Do NOT include any explanations or additional text outside of the JSON structure.
                - If you find no issues, respond with empty array.
    
                ## Code Changes
    
                <CODE_CHANGES>
                diff --git a/src/utils/auth.ts b/src/utils/auth.ts
                index 1234567..89abcde 100644
                --- a/src/utils/auth.ts
                +++ b/src/utils/auth.ts
                @@ -10,7 +10,13 @@
                0   export async function authenticateUser(username: string, password: string): Promise<boolean> {
                1  -  const user = await db.findUserByUsername(username);
                2  -  if (!user) return false;
                3  -  return user.password === password;
                1  +  const user = await db.findUserByUsername(username);
                2  +  if (!user) return false;
                3  +  // Passwords are compared directly, no hashing
                4  +  if (user.isActive) {
                5  +    return user.password === password;
                6  +  } else {
                7  +    return true; // Allows inactive users to authenticate
                8  +  }
                9   }
                </CODE_CHANGES>
            `,
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 40000,
    responseFormat: {
      type: "json",
      schema: {
        type: "object",
        properties: {
          errors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file: { type: "string" },
                line: { type: "integer" },
                severity: {
                  type: "string",
                  enum: ["Critical", "High", "Medium", "Low"],
                },
                priority: {
                  type: "string",
                  enum: ["P1", "P2", "P3", "P4", "P5"],
                },
                message: { type: "string" },
                suggestion: { type: "string" },
                suggestion_code: { type: "string" },
                confidence_score: { type: "number", minimum: 0, maximum: 1 },
              },
              required: [
                "file",
                "line",
                "severity",
                "priority",
                "message",
                "suggestion",
                "suggestion_code",
                "confidence_score",
              ],
            },
          },
        },
      },
    },
  });

  console.log("Response:", JSON.stringify(response, null, 2));
}

test();
