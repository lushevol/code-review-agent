import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_TEMPLATE = {
  mode: "local",
  ado: {
    organization: "your-ado-org",
    project: "your-project",
    token: "env:ADO_TOKEN",
  },
  config: {
    scanRepoNames: ["*"],
    scanPRCreatedDaysAgo: 3,
    defaultAgentConfig: {
      model: "gpt-5-mini",
    },
    agents: {
      review: { prompts: ["prompts/review/principles.md"] },
      "issue-classification": { prompts: ["prompts/review/issue-classification.md"] },
      "review-rescore": { prompts: ["prompts/review/principles.md"] },
      summary: { prompts: ["prompts/summary/instructions.md"] },
    },
  },
};

const DEFAULT_PROMPTS: Record<string, string> = {
  "prompts/review/principles.md": `# Code Review Principles

Focus on:
1. Security vulnerabilities
2. Performance issues
3. Logic errors
4. Code style consistency
5. Test coverage gaps
`,
  "prompts/review/issue-classification.md": `# Issue Classification

Classify each issue as: Critical, High, Medium, or Low severity.
`,
  "prompts/summary/instructions.md": `# Summary Instructions

Provide a concise summary of the pull request changes.
`,
};

export async function init(configDir: string) {
  const configPath = path.resolve(configDir, "config.json");

  // Check if already exists
  try {
    await import("node:fs/promises").then(fs => fs.access(configPath));
    console.error(`  Config already exists at ${configPath}`);
    console.error("  Delete it first if you want to reinitialize.");
    process.exit(1);
  } catch {
    // File doesn't exist — proceed
  }

  await mkdir(path.dirname(configPath), { recursive: true });

  await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n");
  console.log(`  Created ${configPath}`);

  for (const [promptPath, content] of Object.entries(DEFAULT_PROMPTS)) {
    const fullPath = path.resolve(configDir, promptPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
    console.log(`  Created ${path.join(configDir, promptPath)}`);
  }

  console.log("\n  Edit the config and set your ADO organization/project,");
  console.log("  then run: ratan-code-review scan\n");
}
