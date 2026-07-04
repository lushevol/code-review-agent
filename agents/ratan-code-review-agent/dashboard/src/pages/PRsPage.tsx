import { useEffect, useState } from "react";
import { fetchPRs, fetchFindings } from "../api";

export default function PRsPage() {
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrId, setSelectedPrId] = useState<number | null>(null);
  const [prFindings, setPrFindings] = useState<any[]>([]);
  const [loadingFindings, setLoadingFindings] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPRs()
      .then((data) => setPrs(data.prs ?? data.pullRequests ?? data.results ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectPr = async (prId: number) => {
    if (selectedPrId === prId) {
      setSelectedPrId(null);
      setPrFindings([]);
      return;
    }
    setSelectedPrId(prId);
    setLoadingFindings(true);
    try {
      const data = await fetchFindings({ prId });
      setPrFindings(data.findings ?? []);
    } catch {
      setPrFindings([]);
    } finally {
      setLoadingFindings(false);
    }
  };

  const cellStyle: React.CSSProperties = {
    padding: "0.65rem 0.75rem",
    fontSize: "0.85rem",
    borderBottom: "1px solid #eee",
  };

  const badge = (text: string, bg: string) => (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: 4,
        fontSize: "0.75rem",
        fontWeight: 600,
        background: bg,
        color: "#fff",
      }}
    >
      {text}
    </span>
  );

  if (loading) return <div>Loading pull requests...</div>;
  if (error)
    return <div style={{ color: "#e94560" }}>Error: {error}</div>;

  if (prs.length === 0) {
    return (
      <div>
        <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>
          Pull Requests
        </h1>
        <div style={{ color: "#999", padding: "2rem 0" }}>
          No pull requests found.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>
        Pull Requests
      </h1>

      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={cellStyle}>PR ID</th>
              <th style={cellStyle}>Repository</th>
              <th style={cellStyle}>Title</th>
              <th style={cellStyle}>Findings</th>
              <th style={cellStyle}>Blocking</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {prs.map((pr) => {
              const isSelected = selectedPrId === pr.prId;
              const findingCount = pr.findingCount ?? pr.findingsCount ?? pr.totalFindings ?? 0;
              const blockingCount = pr.blockingCount ?? pr.blockingFindings ?? 0;
              return (
                <>
                  <tr
                    key={pr.prId ?? pr.id}
                    onClick={() => handleSelectPr(pr.prId ?? pr.id)}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "#f0f7ff" : undefined,
                    }}
                  >
                    <td style={cellStyle}>
                      <code style={{ fontSize: "0.8rem" }}>
                        #{pr.prId ?? pr.id}
                      </code>
                    </td>
                    <td style={cellStyle}>{pr.repo ?? pr.repository ?? "-"}</td>
                    <td
                      style={{
                        ...cellStyle,
                        maxWidth: 300,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pr.title || `PR #${pr.prId ?? pr.id}`}
                    </td>
                    <td style={cellStyle}>
                      {badge(String(findingCount), findingCount > 0 ? "#f5a623" : "#2ecc71")}
                    </td>
                    <td style={cellStyle}>
                      {badge(
                        String(blockingCount),
                        blockingCount > 0 ? "#e94560" : "#2ecc71",
                      )}
                    </td>
                    <td style={cellStyle}>
                      {badge(
                        pr.status || "active",
                        pr.status === "completed" || pr.status === "merged"
                          ? "#2ecc71"
                          : pr.status === "closed"
                            ? "#95a5a6"
                            : "#f5a623",
                      )}
                    </td>
                    <td style={cellStyle}>
                      {pr.createdAt
                        ? new Date(pr.createdAt).toLocaleDateString()
                        : pr.createdDate
                          ? new Date(pr.createdDate).toLocaleDateString()
                          : "-"}
                    </td>
                  </tr>
                  {isSelected && (
                    <tr key={`${pr.prId ?? pr.id}-findings`}>
                      <td
                        colSpan={7}
                        style={{
                          padding: "1rem 1.5rem",
                          background: "#fafafa",
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        <h4 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
                          Findings for PR #{pr.prId ?? pr.id}
                        </h4>
                        {loadingFindings ? (
                          <div style={{ fontSize: "0.85rem", color: "#999" }}>
                            Loading findings...
                          </div>
                        ) : prFindings.length === 0 ? (
                          <div style={{ fontSize: "0.85rem", color: "#999" }}>
                            No findings for this PR.
                          </div>
                        ) : (
                          <div>
                            {prFindings.slice(0, 20).map((f) => (
                              <div
                                key={f.id}
                                style={{
                                  padding: "0.4rem 0",
                                  borderBottom: "1px solid #eee",
                                  fontSize: "0.85rem",
                                  display: "flex",
                                  gap: "0.75rem",
                                  alignItems: "center",
                                }}
                              >
                                <SeverityDot severity={f.severity} />
                                <code style={{ fontSize: "0.75rem", color: "#666" }}>
                                  {f.id ? f.id.substring(0, 8) : "-"}
                                </code>
                                <span style={{ flex: 1 }}>
                                  {f.title || f.message || f.filePath || f.file || "-"}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "#999",
                                    textTransform: "capitalize",
                                  }}
                                >
                                  {f.category || ""}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "#999",
                                  }}
                                >
                                  {f.engine || f.source || ""}
                                </span>
                              </div>
                            ))}
                            {prFindings.length > 20 && (
                              <div
                                style={{
                                  padding: "0.5rem 0",
                                  fontSize: "0.85rem",
                                  color: "#999",
                                }}
                              >
                                ...and {prFindings.length - 20} more findings
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "#e94560",
    high: "#f5a623",
    medium: "#f7dc6f",
    low: "#2ecc71",
    informational: "#95a5a6",
  };
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors[severity] || "#95a5a6",
        flexShrink: 0,
      }}
    />
  );
}
