import {
  isFileInBlacklist,
  isFileInWhitelist,
  isGeneratedFile,
  shouldReviewFile,
} from "./file-filter";

describe("file-filter", () => {
  describe("isGeneratedFile", () => {
    it("returns true for generated file paths", () => {
      expect(isGeneratedFile("/src/generated/foo.ts")).toBe(true);
      expect(isGeneratedFile("/src/__generated__/bar.js")).toBe(true);
      expect(
        isGeneratedFile(
          "/src/main/java/com/scb/ratan/fmrep/model/v1/SomeModel.java",
        ),
      ).toBe(true);
    });
    it("returns false for non-generated file paths", () => {
      expect(isGeneratedFile("/src/app/index.ts")).toBe(false);
    });
  });

  describe("isFileInWhitelist", () => {
    it("returns true for whitelisted file extensions", () => {
      expect(isFileInWhitelist("foo.ts")).toBe(true);
      expect(isFileInWhitelist("bar.jsx")).toBe(true);
      expect(isFileInWhitelist("baz.java")).toBe(true);
      expect(isFileInWhitelist("query.sql")).toBe(true);
    });
    it("returns false for non-whitelisted file extensions", () => {
      expect(isFileInWhitelist("foo.md")).toBe(false);
      expect(isFileInWhitelist("bar.py")).toBe(false);
      expect(isFileInWhitelist("config.conf")).toBe(false);
    });
  });

  describe("isFileInBlacklist", () => {
    it("returns true for blacklisted test files", () => {
      expect(isFileInBlacklist("foo.test.js")).toBe(true);
      expect(isFileInBlacklist("bar.spec.ts")).toBe(true);
      expect(isFileInBlacklist("/src/test/java/SomeTest.java")).toBe(true);
      expect(isFileInBlacklist("/src/__tests__/test.ts")).toBe(true);
    });
    it("returns false for non-blacklisted files", () => {
      expect(isFileInBlacklist("foo.ts")).toBe(false);
      expect(isFileInBlacklist("bar.java")).toBe(false);
    });
  });

  describe("shouldReviewFile", () => {
    it("returns pass=true for valid reviewable files", () => {
      expect(shouldReviewFile("/src/app/index.ts")).toEqual({
        pass: true,
        notPassReason: "",
      });
      expect(shouldReviewFile("foo.sql")).toEqual({
        pass: true,
        notPassReason: "",
      });
    });
    it("returns pass=false and reason for generated files", () => {
      expect(shouldReviewFile("/src/generated/foo.ts")).toEqual({
        pass: false,
        notPassReason: "generated",
      });
    });
    it("returns pass=false and reason for blacklisted files", () => {
      expect(shouldReviewFile("foo.test.ts")).toEqual({
        pass: false,
        notPassReason: "blacklist",
      });
    });
    it("returns pass=false and reason for files not in whitelist", () => {
      expect(shouldReviewFile("foo.md")).toEqual({
        pass: false,
        notPassReason: "not-in-whitelist",
      });
    });
  });
});
