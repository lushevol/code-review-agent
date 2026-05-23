import { Mastra } from "@mastra/core";
import { config } from "dotenv";
import { startup } from "./bootstrap/index";
import { testAgent } from "./mastra/agents/test-agent";

config({ path: "../../.env" });

(async () => {
  const res = await startup({
    adoToken: process.env.ADO_TOKEN,
    sonarQubeToken: process.env.SONARQUBE_TOKEN,
    ormConnectionUrl: process.env.DATABASE_URL,
    repoName: "51358-mfe-ratan-graphql-ui-poc",
    branch: "feature/ultra-monorepo-9219714",
    basePath: "packages/agent-config-manager/src/config-sample",
  });
})();

// (async () => {
//   const mastra = new Mastra({
//     agents: {
//       testAgent,
//     },
//   });

//   const testAgentRef = mastra.getAgent("testAgent");

//   const res = await testAgentRef.generateLegacy("hi");

//   console.log("Test Agent Response:", JSON.stringify(res, null, 2));
// })();
