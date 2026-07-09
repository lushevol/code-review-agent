import { minimatch } from "minimatch";

const GENERATED_FILE_PATHS = [
  "/src/generated/**/*",
  "/src/__generated__/**/*",
  // ratanone-foundation @ from caroline
  "/src/main/java/com/scb/ratan/fmrep/model/v1/**/*",
];

const REVIEW_FILE_PATH_WHITELIST = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.java",
  "**/*.sql",
];

const REVIEW_FILE_PATH_BLACKLIST = [
  "**/*.test.js",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.js",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "/src/test/java/**/*",
  "/src/test/resources/**/*",
  "/src/__tests__/**/*",
];

export const isGeneratedFile = (filePath: string) => {
  return GENERATED_FILE_PATHS.some((pattern) => minimatch(filePath, pattern));
};

export const isFileInWhitelist = (filePath: string) => {
  return REVIEW_FILE_PATH_WHITELIST.some((pattern) =>
    minimatch(filePath, pattern),
  );
};

export const isFileInBlacklist = (filePath: string) => {
  return REVIEW_FILE_PATH_BLACKLIST.some((pattern) =>
    minimatch(filePath, pattern),
  );
};

export const shouldReviewFile = (
  filePath: string,
): { pass: boolean; notPassReason: string } => {
  const isGenerated = isGeneratedFile(filePath);
  const isInWhitelist = isFileInWhitelist(filePath);
  const isInBlacklist = isFileInBlacklist(filePath);
  const pass = !isGenerated && isInWhitelist && !isInBlacklist;
  return {
    pass,
    notPassReason: pass
      ? ""
      : isGenerated
        ? "generated"
        : isInBlacklist
          ? "blacklist"
          : "not-in-whitelist",
  };
};
