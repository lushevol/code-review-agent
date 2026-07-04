export interface EligibilityGate {
  isRepoInPilot(repoName: string, pilotRepos: string[]): boolean;
  isPRDraft(prDetails: { status?: number; isDraft?: boolean }): boolean;
  isBelowMinSize(codeDiffsArray: { changes: string }[]): boolean;
}

export function checkEligibility(
  prDetails: { status?: number; isDraft?: boolean },
  codeDiffsArray: { changes: string }[],
  pilotRepos: string[],
  repoName: string,
): { eligible: boolean; reason?: string } {
  // Check pilot repo
  if (!pilotRepos.some(p => repoName.includes(p) || p.includes(repoName))) {
    return { eligible: false, reason: `Repository ${repoName} is not in the pilot list` };
  }

  // Check draft status
  if (prDetails.isDraft || prDetails.status === 2) { // 2 = not ready / draft
    return { eligible: false, reason: "PR is in draft state" };
  }

  // Check minimum size (skip if no changes)
  if (!codeDiffsArray || codeDiffsArray.length === 0) {
    return { eligible: false, reason: "PR has no code changes" };
  }

  return { eligible: true };
}
