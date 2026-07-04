import { describe, it, expect } from "vitest";
import { checkEligibility } from "./eligibility";

describe("checkEligibility", () => {
  const pilotRepos = ["my-org/my-app", "my-org/shared-lib"];

  describe("pilot repo check", () => {
    it("returns eligible when repo is in the pilot list", () => {
      const result = checkEligibility(
        { isDraft: false },
        [{ changes: "console.log('hello');" }],
        pilotRepos,
        "my-org/my-app",
      );
      expect(result.eligible).toBe(true);
    });

    it("returns not eligible when repo is not in the pilot list", () => {
      const result = checkEligibility(
        { isDraft: false },
        [{ changes: "console.log('hello');" }],
        pilotRepos,
        "my-org/other-app",
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("not in the pilot list");
    });

    it("matches when repo name contains a pilot repo substring", () => {
      const result = checkEligibility(
        { isDraft: false },
        [{ changes: "code" }],
        ["my-org"],
        "my-org/my-app",
      );
      expect(result.eligible).toBe(true);
    });

    it("matches when a pilot repo entry is contained in repo name", () => {
      const result = checkEligibility(
        { isDraft: false },
        [{ changes: "code" }],
        ["shared-lib"],
        "my-org/shared-lib",
      );
      expect(result.eligible).toBe(true);
    });
  });

  describe("draft PR detection", () => {
    it("returns not eligible when PR is a draft", () => {
      const result = checkEligibility(
        { isDraft: true },
        [{ changes: "code" }],
        pilotRepos,
        "my-org/my-app",
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("draft");
    });

    it("returns not eligible when PR status is 2 (draft)", () => {
      const result = checkEligibility(
        { status: 2 },
        [{ changes: "code" }],
        pilotRepos,
        "my-org/my-app",
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("draft");
    });
  });

  describe("empty PR check", () => {
    it("returns not eligible when code diffs array is empty", () => {
      const result = checkEligibility(
        { isDraft: false },
        [],
        pilotRepos,
        "my-org/my-app",
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("no code changes");
    });

    it("returns not eligible when code diffs array is null or undefined", () => {
      const result = checkEligibility(
        { isDraft: false },
        null as unknown as { changes: string }[],
        pilotRepos,
        "my-org/my-app",
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("no code changes");
    });
  });

  describe("valid PR passes all checks", () => {
    it("returns eligible when all conditions are met", () => {
      const result = checkEligibility(
        { isDraft: false, status: 4 },
        [{ changes: "some code change" }],
        pilotRepos,
        "my-org/my-app",
      );
      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("returns eligible with multiple code diffs", () => {
      const result = checkEligibility(
        { isDraft: false },
        [{ changes: "file1 change" }, { changes: "file2 change" }],
        pilotRepos,
        "my-org/shared-lib",
      );
      expect(result.eligible).toBe(true);
    });
  });
});
