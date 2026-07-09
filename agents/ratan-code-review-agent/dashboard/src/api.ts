const API_BASE = "/api";

export async function fetchFindings(params?: {
  prId?: number;
  repo?: string;
  engine?: string;
  status?: string;
}): Promise<any> {
  const searchParams = new URLSearchParams();
  if (params?.prId) searchParams.set("prId", String(params.prId));
  if (params?.repo) searchParams.set("repo", params.repo);
  if (params?.engine) searchParams.set("engine", params.engine);
  if (params?.status) searchParams.set("status", params.status);
  const res = await fetch(`${API_BASE}/findings?${searchParams}`);
  if (!res.ok) throw new Error(`Failed to fetch findings: ${res.statusText}`);
  return res.json();
}

export async function fetchAudit(params?: {
  prId?: number;
  from?: string;
  to?: string;
}): Promise<any> {
  const searchParams = new URLSearchParams();
  if (params?.prId) searchParams.set("prId", String(params.prId));
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  const res = await fetch(`${API_BASE}/audit?${searchParams}`);
  if (!res.ok) throw new Error(`Failed to fetch audit: ${res.statusText}`);
  return res.json();
}

export async function fetchStats(): Promise<any> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  return res.json();
}

export async function fetchPRs(params?: {
  repo?: string;
  status?: string;
}): Promise<any> {
  const searchParams = new URLSearchParams();
  if (params?.repo) searchParams.set("repo", params.repo);
  if (params?.status) searchParams.set("status", params.status);
  const res = await fetch(`${API_BASE}/prs?${searchParams}`);
  if (!res.ok) throw new Error(`Failed to fetch PRs: ${res.statusText}`);
  return res.json();
}

export async function overrideFinding(
  id: string,
  payload: {
    resolution: string;
    overriddenBy: string;
    justification?: string;
    expiryDate?: string;
  },
): Promise<any> {
  const res = await fetch(`${API_BASE}/findings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to override finding: ${res.statusText}`);
  return res.json();
}

// ── Queue API ─────────────────────────────────────────────────────────────────

/**
 * Get current PR queue status.
 */
export async function fetchQueue(): Promise<any> {
  const res = await fetch(`${API_BASE}/queue`);
  if (!res.ok) throw new Error(`Failed to fetch queue: ${res.statusText}`);
  return res.json();
}

/**
 * Manually add a PR to the review queue.
 */
export async function addPRToQueue(prId: number, repoName?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prId, repoName: repoName ?? `PR #${prId}` }),
  });
  if (!res.ok) throw new Error(`Failed to add PR to queue: ${res.statusText}`);
  return res.json();
}
