import OpenAI from "openai";

// ==========================================
// 1. Type Definitions (The Golden Dataset)
// ==========================================

export interface CodeReviewIssue {
  /** Unique ID for the expected issue (e.g., "SEC-001") */
  id: string;
  file_name: string;
  start_line: number;
  end_line: number;
  /** The ground truth description of the issue */
  issue_description: string;
  /** Optional: Summary of the expected fix */
  expected_suggestion?: string;
}

export interface TestCase {
  id: string;
  /** The raw code snippet to be reviewed */
  code_snippet: string;
  /** The list of issues that SHOULD be found */
  expected_issues: CodeReviewIssue[];
}

export interface LLMIdentifiedIssue {
  file_name: string;
  start_line: number;
  end_line: number;
  description: string;
  suggestion: string;
}

export interface LLMResponse {
  /** The parsed list of issues returned by your LLM */
  identified_issues: LLMIdentifiedIssue[];
}

export interface EvaluationResult {
  test_case_id: string;
  metrics: {
    /** 0.0 to 1.0: Percentage of expected issues that were found */
    accuracy_score: number;
    /** 0.0 to 1.0: Percentage of expected issues missed */
    false_negative_rate: number;
    /** 0.0 to 1.0: Percentage of found issues that were invalid (Hallucinations) */
    false_positive_rate: number;
    /** 1.0 to 5.0: Average quality score of the valid suggestions */
    suggestion_quality: number;
  };
  details: {
    missed_issue_ids: string[];
    false_positives: string[];
    judge_reasoning: string[];
  };
}

// ==========================================
// 2. Helper Utilities (Fuzzy Matching)
// ==========================================

/**
 * Calculates if two line ranges overlap significantly.
 * Handles "fuzzy" matching where the LLM might be off by a line or two.
 */
function isLocationMatch(
  expected: { file: string; start: number; end: number },
  actual: { file: string; start: number; end: number },
): boolean {
  // 1. File name check (Ends-with check handles relative vs absolute paths)
  const normalizedExpected = expected.file.toLowerCase();
  const normalizedActual = actual.file.toLowerCase();

  if (
    !normalizedActual.endsWith(normalizedExpected) &&
    !normalizedExpected.endsWith(normalizedActual)
  ) {
    return false;
  }

  // 2. Line overlap check
  const overlapStart = Math.max(expected.start, actual.start);
  const overlapEnd = Math.min(expected.end, actual.end);

  // If overlapEnd >= overlapStart, the ranges intersect
  return overlapEnd >= overlapStart;
}

// ==========================================
// 3. AI Judge (Qualitative Scoring)
// ==========================================

interface JudgeResult {
  isFalsePositive: boolean;
  suggestionQuality: number;
  reasoning: string;
}

class LLMJudge {
  private openai: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.openai = new OpenAI({ apiKey });
    this.model = model;
  }

  async evaluateIssue(
    code: string,
    expectedIssues: CodeReviewIssue[],
    actualIssue: LLMIdentifiedIssue,
    isMatchedExpectation: boolean,
  ): Promise<JudgeResult> {
    const prompt = `
    You are an expert Senior Software Engineer acting as a QA Judge for an AI Code Reviewer.
    
    CONTEXT:
    We have a code snippet and a list of "Ground Truth" (Expected) issues.
    The AI Code Reviewer has identified an issue.
    
    CODE SNIPPET:
    \`\`\`
    ${code}
    \`\`\`
    
    GROUND TRUTH ISSUES: 
    ${JSON.stringify(expectedIssues, null, 2)}
    
    ISSUE FOUND BY AI:
    ${JSON.stringify(actualIssue, null, 2)}
    
    METADATA:
    Did this issue fuzzy-match a location in the Ground Truth? ${isMatchedExpectation ? "YES" : "NO"}
    
    YOUR TASK:
    1. **False Positive Check**: 
       - If the AI found an issue NOT in the Ground Truth, is it a valid issue (just undocumented) or a hallucination?
       - If incorrect/irrelevant -> "is_false_positive": true.
       - If valid (even if new) -> "is_false_positive": false.
       
    2. **Suggestion Quality**: 
       - Rate the helpfulness of the AI's 'suggestion' field (1-5).
       - 1=Nonsense, 3=Generic, 5=Perfect fix.
    
    OUTPUT JSON ONLY:
    {
      "is_false_positive": boolean,
      "suggestion_quality": number,
      "reasoning": "Brief explanation"
    }
    `;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const content = completion.choices[0].message.content;
      if (!content) throw new Error("Empty response from Judge LLM");

      const result = JSON.parse(content);
      return {
        isFalsePositive: result.is_false_positive,
        suggestionQuality:
          typeof result.suggestion_quality === "number"
            ? result.suggestion_quality
            : 0,
        reasoning: result.reasoning || "No reasoning provided",
      };
    } catch (error) {
      console.error("Error in LLM Judge:", error);
      return {
        isFalsePositive: false,
        suggestionQuality: 3,
        reasoning: "Judge Error",
      };
    }
  }
}

// ==========================================
// 4. Main Evaluator Class (Public API)
// ==========================================

export class CodeReviewEvaluator {
  private judge: LLMJudge;

  constructor(openaiApiKey: string, judgeModel: string = "gpt-4o") {
    this.judge = new LLMJudge(openaiApiKey, judgeModel);
  }

  async evaluate(
    testCase: TestCase,
    llmResponse: LLMResponse,
  ): Promise<EvaluationResult> {
    const expected = testCase.expected_issues;
    const actual = llmResponse.identified_issues;

    let foundCount = 0;
    const suggestionScores: number[] = [];
    let falsePositiveCount = 0;
    const missedIssues: string[] = [];
    const judgeReasonings: string[] = [];

    // Track matches
    const actualIssueMatchesExpectation = new Array(actual.length).fill(false);

    // --- Step 1: Calculate Recall (Accuracy) ---
    for (const exp of expected) {
      const matchIndex = actual.findIndex((act) =>
        isLocationMatch(
          { file: exp.file_name, start: exp.start_line, end: exp.end_line },
          { file: act.file_name, start: act.start_line, end: act.end_line },
        ),
      );

      if (matchIndex !== -1) {
        foundCount++;
        actualIssueMatchesExpectation[matchIndex] = true;
      } else {
        missedIssues.push(exp.id);
      }
    }

    // --- Step 2: Judge Precision & Quality ---
    for (let i = 0; i < actual.length; i++) {
      const issue = actual[i];
      const isMatched = actualIssueMatchesExpectation[i];

      const judgment = await this.judge.evaluateIssue(
        testCase.code_snippet,
        expected,
        issue,
        isMatched,
      );

      judgeReasonings.push(
        `[${issue.description.substring(0, 30)}...] ${judgment.reasoning}`,
      );
      suggestionScores.push(judgment.suggestionQuality);

      // Only count as False Positive if it didn't match expectations AND the judge says it's invalid
      if (!isMatched && judgment.isFalsePositive) {
        falsePositiveCount++;
      }
    }

    // --- Step 3: Final Metrics ---
    const totalExpected = expected.length;
    const totalActual = actual.length;
    const avgSuggestion =
      suggestionScores.length > 0
        ? suggestionScores.reduce((a, b) => a + b, 0) / suggestionScores.length
        : 0;

    return {
      test_case_id: testCase.id,
      metrics: {
        accuracy_score: totalExpected > 0 ? foundCount / totalExpected : 1,
        false_negative_rate:
          totalExpected > 0 ? missedIssues.length / totalExpected : 0,
        false_positive_rate:
          totalActual > 0 ? falsePositiveCount / totalActual : 0,
        suggestion_quality: avgSuggestion,
      },
      details: {
        missed_issue_ids: missedIssues,
        false_positives: actual
          .filter((_, i) => !actualIssueMatchesExpectation[i] && actual[i]) // Simplified logic
          .map((a) => a.description),
        judge_reasoning: judgeReasonings,
      },
    };
  }
}
