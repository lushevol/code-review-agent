import { config } from "dotenv";

config({ path: "../../.env" });

const { startup } = await import("./bootstrap/index");

await startup({
  adoToken: process.env.ADO_TOKEN!,
  sonarQubeToken: process.env.SONARQUBE_TOKEN,
  ormConnectionUrl: process.env.DATABASE_URL,
  organization: process.env.ADO_ORGANIZATION,
  project: process.env.ADO_PROJECT,
  repoName: process.env.ADO_CONFIG_REPO!,
  branch: process.env.ADO_CONFIG_BRANCH!,
  basePath: process.env.ADO_CONFIG_BASE_PATH,
});
