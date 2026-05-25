import { describe, expect, it } from "vitest";
import { AzureDevOps } from "ratan-ado-api";
import { Readable } from "node:stream";

describe("AzureDevOps proxy configuration", () => {
  it("uses the packaged default proxy when no runtime proxy is supplied", () => {
    expect(new AzureDevOps().getProxyUrl()).toBe("http://10.239.9.190:443");
  });

  it("lets callers override the packaged proxy", () => {
    expect(
      new AzureDevOps({ proxy: "http://proxy.example:8080" }).getProxyUrl(),
    ).toBe("http://proxy.example:8080");
  });

  it("lets callers disable proxy usage for direct connections", () => {
    expect(new AzureDevOps({ proxy: "none" }).getProxyUrl()).toBe("");
    expect(new AzureDevOps({ proxy: "" }).getProxyUrl()).toBe("");
  });

  it("omits the SDK proxy option when proxy usage is disabled", () => {
    const directOptions = (
      new AzureDevOps({ proxy: "none" }) as unknown as {
        createRequestOptions: () => { proxy?: { proxyUrl: string } };
      }
    ).createRequestOptions();
    const emptyOptions = (
      new AzureDevOps({ proxy: "" }) as unknown as {
        createRequestOptions: () => { proxy?: { proxyUrl: string } };
      }
    ).createRequestOptions();
    const proxyOptions = (
      new AzureDevOps({ proxy: "http://proxy.example:8080" }) as unknown as {
        createRequestOptions: () => { proxy?: { proxyUrl: string } };
      }
    ).createRequestOptions();

    expect(directOptions).not.toHaveProperty("proxy");
    expect(emptyOptions).not.toHaveProperty("proxy");
    expect(proxyOptions.proxy?.proxyUrl).toBe("http://proxy.example:8080");
  });
});

describe("AzureDevOps file content", () => {
  it("resolves the item path and reads blob content through the SDK", async () => {
    const itemBatchCalls: unknown[][] = [];
    const blobContentCalls: unknown[][] = [];
    const client = new AzureDevOps({
      organization: "org",
      project: "project",
      proxy: "none",
    });
    Object.assign(client, {
      adoWebApi: {
        getGitApi: async () => ({
          getItemsBatch: async (...args: unknown[]) => {
            itemBatchCalls.push(args);
            return [[{ objectId: "blob-id" }]];
          },
          getBlobContent: async (...args: unknown[]) => {
            blobContentCalls.push(args);
            return Readable.from(["remote config"]);
          },
        }),
      },
    });

    await expect(
      client.getFileContent("repo", "code-review-agent/config.json", "main"),
    ).resolves.toBe("remote config");

    expect(
      (
        itemBatchCalls[0]?.[0] as {
          itemDescriptors: Array<{ path: string }>;
        }
      ).itemDescriptors[0]?.path,
    ).toBe("/code-review-agent/config.json");
    expect(blobContentCalls[0]?.[1]).toBe("blob-id");
  });
});
