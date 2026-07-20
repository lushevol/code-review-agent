import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentConfigSessions } from "../../../bootstrap/session";
import { RequestContext } from "../../runtime";
import { sonarqubeMeasures } from "./sonarqube-measures";

afterEach(() => getAgentConfigSessions().clearSessions());

describe("sonarqubeMeasures", () => {
  it("returns null when SonarQube is not configured", async () => {
    expect(await executeSonarqubeMeasures(null)).toEqual({ measures: null });
  });

  it("fetches measures with the PR and repository identity", async () => {
    const measures = { securityRating: "1.0", bugs: "0" };
    const getMeasures = vi.fn().mockResolvedValue(measures);
    expect(await executeSonarqubeMeasures({ getMeasures })).toEqual({ measures });
    expect(getMeasures).toHaveBeenCalledWith(7, "repo");
  });

  it("retries transient failures using configured policy", async () => {
    const getMeasures = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ bugs: "0" });
    const result = await executeSonarqubeMeasures({ getMeasures }, { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitterMs: 0 });
    expect(result).toEqual({ measures: { bugs: "0" } });
    expect(getMeasures).toHaveBeenCalledTimes(2);
  });

  it("degrades to null after retry exhaustion", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getMeasures = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await executeSonarqubeMeasures({ getMeasures })).toEqual({ measures: null });
    expect(getMeasures).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

async function executeSonarqubeMeasures(
  sonarClient: { getMeasures: ReturnType<typeof vi.fn> } | null,
  retry = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitterMs: 0 },
) {
  const provider = {
    id: `sonar-${crypto.randomUUID()}`,
    getSonarQubeClient: () => sonarClient,
    getRootConfig: async () => ({ retry }),
  };
  getAgentConfigSessions().registerProvider(provider as never);
  const requestContext = new RequestContext<{ configSessionId: string }>();
  requestContext.set("configSessionId", provider.id);
  return sonarqubeMeasures.execute({
    inputData: {
      prDetails: { pullRequestId: 7, repoName: "repo" },
      findings: [],
      correlationSummary: "summary",
    } as never,
    requestContext,
  });
}
