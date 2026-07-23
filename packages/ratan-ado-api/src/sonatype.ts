import {
  SonatypeBuildMetricsSchema,
  type SonatypeBuildMetrics,
} from "./interfaces";

export async function getSonatypeBuildMetrics({
  projectId,
  pipelineId,
  buildId,
}: {
  projectId: string;
  pipelineId: number;
  buildId: number;
}): Promise<SonatypeBuildMetrics | null> {
  if (!projectId || !pipelineId || !buildId) {
    return null;
  }

  try {
    const extensionApi = await this.getAdoClient().getExtensionManagementApi();
    const payload = await extensionApi.getDocumentByName(
      "SonatypeIntegrations",
      "nexus-iq-azure-extension",
      "Default",
      "Current",
      `${projectId}-${pipelineId}`,
      String(buildId),
    );
    return SonatypeBuildMetricsSchema.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/404|not found/i.test(message)) {
      return null;
    }
    throw error;
  }
}