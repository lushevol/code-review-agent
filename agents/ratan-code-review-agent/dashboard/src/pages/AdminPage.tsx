import { useEffect, useState } from "react";
import { fetchAudit, fetchFindings } from "../api";

export default function AdminPage() {
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchAudit().then((d) => d.entries ?? d.auditLog ?? d.results ?? []),
      fetchFindings().then((d) => d.findings ?? []),
    ])
      .then(([audit, f]) => {
        setAuditLog(audit);
        setFindings(f);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading admin panel...</div>;
  if (error)
    return <div style={{ color: "#e94560" }}>Error: {error}</div>;

  // FP rate per engine
  const engines = [...new Set(findings.map((f) => f.engine || f.source || "unknown"))];
  const fpRateByEngine = engines.map((engine) => {
    const engineFindings = findings.filter(
      (f) => (f.engine || f.source || "unknown") === engine,
    );
    const total = engineFindings.length;
    const fp = engineFindings.filter(
      (f) =>
        f.resolution === "false-positive" || f.status === "false-positive",
    ).length;
    return {
      engine,
      total,
      fpCount: fp,
      fpRate: total > 0 ? ((fp / total) * 100).toFixed(1) : "0.0",
    };
  });

  // Overrides from audit log
  const overrides = auditLog.filter(
    (entry) =>
      entry.action?.toLowerCase().includes("override") ||
      entry.action?.toLowerCase().includes("override_finding") ||
      entry.type === "override",
  );

  const cellStyle: React.CSSProperties = {
    padding: "0.65rem 0.75rem",
    fontSize: "0.85rem",
    borderBottom: "1px solid #eee",
  };

  const sectionStyle: React.CSSProperties = {
    background: "#fff",
    padding: "1rem",
    borderRadius: 8,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    marginBottom: "1.5rem",
  };

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>Admin</h1>

      {/* FP Rate by Engine */}
      <div style={sectionStyle}>
        <h3 style={{ marginBottom: "1rem", fontSize: "1.05rem" }}>
          False Positive Rate by Engine
        </h3>
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          }}
        >
          {fpRateByEngine.map((item) => {
            const rate = parseFloat(item.fpRate);
            const color =
              rate > 20 ? "#e94560" : rate > 10 ? "#f5a623" : "#2ecc71";
            return (
              <div
                key={item.engine}
                style={{
                  padding: "1rem",
                  borderRadius: 8,
                  border: "1px solid #eee",
                }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                    textTransform: "capitalize",
                  }}
                >
                  {item.engine}
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color,
                  }}
                >
                  {item.fpRate}%
                </div>
                <div style={{ fontSize: "0.75rem", color: "#999" }}>
                  {item.fpCount} of {item.total} findings
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* High-FP Rule Alerts */}
      {fpRateByEngine.filter((e) => parseFloat(e.fpRate) > 15).length > 0 && (
        <div style={sectionStyle}>
          <h3
            style={{
              marginBottom: "1rem",
              fontSize: "1.05rem",
              color: "#e94560",
            }}
          >
            High FP Rate Alerts
          </h3>
          {fpRateByEngine
            .filter((e) => parseFloat(e.fpRate) > 15)
            .map((item) => (
              <div
                key={item.engine}
                style={{
                  padding: "0.75rem",
                  borderRadius: 6,
                  background: "#fff5f5",
                  border: "1px solid #ffd7d7",
                  marginBottom: "0.5rem",
                  fontSize: "0.9rem",
                }}
              >
                <strong>{item.engine}</strong> has a{" "}
                <strong>{item.fpRate}%</strong> false positive rate ({item.fpCount}{" "}
                of {item.total} findings). Consider reviewing the rules for this
                engine.
              </div>
            ))}
        </div>
      )}

      {/* Override Log */}
      <div style={sectionStyle}>
        <h3 style={{ marginBottom: "1rem", fontSize: "1.05rem" }}>
          Override Log
        </h3>
        {overrides.length === 0 ? (
          <div style={{ color: "#999", fontSize: "0.9rem" }}>
            No overrides recorded yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={cellStyle}>Date</th>
                  <th style={cellStyle}>Finding ID</th>
                  <th style={cellStyle}>Action</th>
                  <th style={cellStyle}>Resolution</th>
                  <th style={cellStyle}>Overridden By</th>
                  <th style={cellStyle}>Justification</th>
                </tr>
              </thead>
              <tbody>
                {overrides.slice(0, 50).map((entry: any, i: number) => (
                  <tr key={entry.id || i}>
                    <td style={cellStyle}>
                      {entry.timestamp || entry.createdAt || entry.date
                        ? new Date(
                            entry.timestamp || entry.createdAt || entry.date,
                          ).toLocaleString()
                        : "-"}
                    </td>
                    <td style={cellStyle}>
                      <code style={{ fontSize: "0.75rem" }}>
                        {entry.findingId
                          ? entry.findingId.substring(0, 8)
                          : entry.finding?.substring(0, 8) || "-"}
                      </code>
                    </td>
                    <td style={cellStyle}>
                      {entry.action || entry.type || "override"}
                    </td>
                    <td style={cellStyle}>
                      {entry.resolution || entry.newValue || entry.status || "-"}
                    </td>
                    <td style={cellStyle}>
                      {entry.overriddenBy || entry.user || entry.actor || "-"}
                    </td>
                    <td
                      style={{
                        ...cellStyle,
                        maxWidth: 250,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.justification || entry.reason || entry.comment || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overrides.length > 50 && (
              <div
                style={{
                  padding: "0.75rem",
                  fontSize: "0.85rem",
                  color: "#999",
                  textAlign: "center",
                }}
              >
                Showing 50 of {overrides.length} entries
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
