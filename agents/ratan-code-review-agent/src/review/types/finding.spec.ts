import { describe, expect, it } from "vitest";
import {
  NormalizedFindingSchema,
  FindingCategory,
  FindingSeverity,
  EngineType,
  computeContentHash,
  generateFindingId,
} from "./finding";

// ─── Factory helpers ──────────────────────────────────────────────────────

function validFindingOverrides(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    prId: 42,
    repository: "test-repo",
    filePath: "src/main.ts",
    lineStart: 10,
    lineEnd: 15,
    category: "bug",
    severity: "high",
    confidence: 0.85,
    title: "A test finding",
    description: "This is a description of the finding.",
    evidence: "const x = unsafe(userInput);",
    businessImpact: "Could lead to data leakage",
    remediation: "Sanitize user input",
    blocking: false,
    linkedTaskId: null,
    resolution: "open",
    sourceEngine: "ai-review",
    sourceVersion: "1.0.0",
    supersedesFindingId: null,
    contentHash:
      "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
    createdAt: "2024-01-01T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

// ─── NormalizedFindingSchema ──────────────────────────────────────────────

describe("NormalizedFindingSchema", () => {
  it("parses a valid finding object", () => {
    const input = validFindingOverrides();
    const result = NormalizedFindingSchema.parse(input);

    expect(result.id).toBe(input.id);
    expect(result.prId).toBe(42);
    expect(result.repository).toBe("test-repo");
    expect(result.filePath).toBe("src/main.ts");
    expect(result.category).toBe("bug");
    expect(result.severity).toBe("high");
  });

  it("rejects a missing prId field", () => {
    const input = validFindingOverrides({ prId: undefined });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects a missing repository field", () => {
    const input = validFindingOverrides({ repository: undefined });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects an invalid category value", () => {
    const input = validFindingOverrides({ category: "invalid-category" });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects an invalid severity value", () => {
    const input = validFindingOverrides({ severity: "super-critical" });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects an invalid sourceEngine value", () => {
    const input = validFindingOverrides({ sourceEngine: "unknown-engine" });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects a non-numeric prId", () => {
    const input = validFindingOverrides({ prId: "not-a-number" });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects a non-uuid id", () => {
    const input = validFindingOverrides({ id: "not-a-uuid" });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects confidence outside 0-1 range", () => {
    const input = validFindingOverrides({ confidence: 1.5 });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("rejects an empty title", () => {
    const input = validFindingOverrides({ title: "" });
    expect(() => NormalizedFindingSchema.parse(input)).toThrow();
  });

  it("accepts null for resolvedAt", () => {
    const input = validFindingOverrides({ resolvedAt: null });
    const result = NormalizedFindingSchema.parse(input);

    expect(result.resolvedAt).toBeNull();
  });

  it("allows a valid resolvedAt timestamp", () => {
    const input = validFindingOverrides({
      resolvedAt: "2024-06-01T12:00:00.000Z",
    });
    const result = NormalizedFindingSchema.parse(input);

    expect(result.resolvedAt).toBe("2024-06-01T12:00:00.000Z");
  });
});

// ─── computeContentHash ───────────────────────────────────────────────────

describe("computeContentHash", () => {
  it("returns the same hash for the same file path and surrounding lines", () => {
    const hash1 = computeContentHash("src/main.ts", [
      "const x = 1;",
      "const y = 2;",
    ]);
    const hash2 = computeContentHash("src/main.ts", [
      "const x = 1;",
      "const y = 2;",
    ]);

    expect(hash1).toBe(hash2);
  });

  it("returns a different hash for different file paths", () => {
    const hash1 = computeContentHash("src/main.ts", [
      "const x = 1;",
    ]);
    const hash2 = computeContentHash("src/utils.ts", [
      "const x = 1;",
    ]);

    expect(hash1).not.toBe(hash2);
  });

  it("returns a different hash for different surrounding lines", () => {
    const hash1 = computeContentHash("src/main.ts", ["line one"]);
    const hash2 = computeContentHash("src/main.ts", ["line two"]);

    expect(hash1).not.toBe(hash2);
  });

  it("produces a hex string of length 64 (SHA-256)", () => {
    const hash = computeContentHash("src/main.ts", ["some code"]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes trailing whitespace in surrounding lines", () => {
    const hash1 = computeContentHash("src/main.ts", ["line with space   "]);
    const hash2 = computeContentHash("src/main.ts", ["line with space"]);

    expect(hash1).toBe(hash2);
  });

  it("handles empty surrounding lines array", () => {
    const hash = computeContentHash("src/main.ts", []);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ─── generateFindingId ────────────────────────────────────────────────────

describe("generateFindingId", () => {
  it("returns a UUID v4 string", () => {
    const id = generateFindingId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns unique values on subsequent calls", () => {
    const id1 = generateFindingId();
    const id2 = generateFindingId();
    expect(id1).not.toBe(id2);
  });
});

// ─── FindingCategory ──────────────────────────────────────────────────────

describe("FindingCategory", () => {
  it("accepts valid category values", () => {
    expect(() => FindingCategory.parse("bug")).not.toThrow();
    expect(() => FindingCategory.parse("security")).not.toThrow();
    expect(() => FindingCategory.parse("compliance")).not.toThrow();
    expect(() => FindingCategory.parse("cve")).not.toThrow();
    expect(() => FindingCategory.parse("dependency")).not.toThrow();
    expect(() => FindingCategory.parse("quality")).not.toThrow();
  });

  it("rejects an invalid category", () => {
    expect(() => FindingCategory.parse("invalid")).toThrow();
  });

  it("rejects a number", () => {
    expect(() => FindingCategory.parse(123 as unknown as string)).toThrow();
  });
});

// ─── FindingSeverity ──────────────────────────────────────────────────────

describe("FindingSeverity", () => {
  it("accepts valid severity values", () => {
    expect(() => FindingSeverity.parse("critical")).not.toThrow();
    expect(() => FindingSeverity.parse("high")).not.toThrow();
    expect(() => FindingSeverity.parse("medium")).not.toThrow();
    expect(() => FindingSeverity.parse("low")).not.toThrow();
    expect(() => FindingSeverity.parse("informational")).not.toThrow();
  });

  it("rejects an invalid severity", () => {
    expect(() => FindingSeverity.parse("unknown")).toThrow();
  });
});

// ─── EngineType ──────────────────────────────────────────────────────────

describe("EngineType", () => {
  it("accepts valid engine types", () => {
    expect(() => EngineType.parse("ai-review")).not.toThrow();
    expect(() => EngineType.parse("sonarqube-cve")).not.toThrow();
    expect(() => EngineType.parse("compliance")).not.toThrow();
  });

  it("rejects an invalid engine type", () => {
    expect(() => EngineType.parse("unknown-engine")).toThrow();
  });
});
