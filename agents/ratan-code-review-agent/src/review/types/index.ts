import {
  type AdoPullRequestMetadata,
  AdoPullRequestMetadataSchema,
} from "ratan-ado-api";
import z from "zod";
import type { RequestContext } from "../runtime";

export const CommonRequestContextSchema = z.object({
  configSessionId: z.string().describe("Agent Config Session Id"),
});

export type CommonRequestContext = RequestContext<
  z.infer<typeof CommonRequestContextSchema>
>;

export const PullRequestSchema = AdoPullRequestMetadataSchema.extend({
  workItemIds: z.array(z.number()).optional(),
});
export type PullRequest = AdoPullRequestMetadata & { workItemIds?: number[] };
