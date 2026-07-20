import * as https from "node:https";

const getHeaders = (pat: string) => {
  const encodedPat = Buffer.from(`:${pat}`).toString("base64");
  return {
    Authorization: `Basic ${encodedPat}`,
    "Content-Type": "application/json",
  };
};

export async function hierarchyQueryRequest(postBody) {
  const pat = this.getAdoToken() as string;
  const organization = this.getOrganization() as string;
  const project = this.getProjectName() as string;
  const headers = getHeaders(pat);

  const url = `https://dev.azure.com/${organization}/_apis/Contribution/HierarchyQuery/project/${project}?api-version=5.0-preview.1`;

  // Match original ignoreSslError: true behavior
  const agent = new https.Agent({ rejectUnauthorized: false });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(postBody),
    agent, // Node.js extension to RequestInit
  } as RequestInit & { agent: https.Agent });

  if (!response.ok) {
    throw new Error(
      `HierarchyQuery request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<any>;
}
