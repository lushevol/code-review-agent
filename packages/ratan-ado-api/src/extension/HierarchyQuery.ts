import * as httpm from "typed-rest-client/HttpClient.js";
import config from "../config.json" with { type: "json" };

const getHeaders = (pat: string) => {
  const encodedPat = Buffer.from(`:${pat}`).toString("base64");
  const headers = {
    Authorization: `Basic ${encodedPat}`,
    "Content-Type": "application/json",
  };

  return headers;
};

export async function hierarchyQueryRequest(postBody) {
  const pat = this.getAdoToken() as string;
  const proxyUrl = this.getProxyUrl() as string;
  const organization = this.getOrganization() as string;
  const project = this.getProjectName() as string;
  const headers = getHeaders(pat);

  const url = `https://dev.azure.com/${organization}/_apis/Contribution/HierarchyQuery/project/${project}?api-version=5.0-preview.1`;

  const httpc = new httpm.HttpClient("ratan-ado-api", undefined, {
    proxy: { proxyUrl },
    ignoreSslError: true,
  });
  const resultResponse = await httpc.post(
    url,
    JSON.stringify(postBody),
    headers,
  );
  const resp = await resultResponse.readBody();
  const result = JSON.parse(resp.toString());

  return result;
}
