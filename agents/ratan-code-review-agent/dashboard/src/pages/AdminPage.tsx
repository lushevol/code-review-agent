import { useEffect, useState } from "react";
import {
  addPRToQueue,
  clearPendingQueue,
  fetchFindings,
  fetchOverrides,
  fetchQueue,
} from "../api";

export default function AdminPage() {
  const [overrides, setOverrides] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [queueStatus, setQueueStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Manual PR Queue Form ─────────────────────────────────────

  const [prIdInput, setPrIdInput] = useState("");
  const [repoNameInput, setRepoNameInput] = useState("");
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueRefreshing, setQueueRefreshing] = useState(false);

  const refreshQueue = async () => {
    try {
      setQueueRefreshing(true);
      const data = await fetchQueue();
      setQueueStatus(data);
    } catch (e: any) {
      setQueueStatus(null);
    } finally {
      setQueueRefreshing(false);
    }
  };

  const handleAddPR = async () => {
    const prId = parseInt(prIdInput, 10);
    if (isNaN(prId) || prId <= 0) {
      setQueueError("Please enter a valid PR ID (positive number)");
      return;
    }

    setQueueMsg(null);
    setQueueError(null);

    try {
      const result = await addPRToQueue(prId, repoNameInput || undefined);
      setQueueMsg(`PR #${prId} added to queue. ${result.pendingCount} PR(s) pending.`);
      setPrIdInput("");
      setRepoNameInput("");
      await refreshQueue();
    } catch (e: any) {
      setQueueError(e.message);
    }
  };

  const handleClearQueue = async () => {
    try {
      const result = await clearPendingQueue();
      setQueueMsg(`${result.cleared} pending PR(s) removed.`);
      await refreshQueue();
    } catch (e: any) {
      setQueueError(e.message);
    }
  };

  // ── Data Loading ─────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetchOverrides().then((d) => d.overrides ?? []),
      fetchFindings().then((d) => d.findings ?? []),
      fetchQueue().catch(() => null),
    ])
      .then(([overrideLog, f, queue]) => {
        setOverrides(overrideLog);
        setFindings(f);
        setQueueStatus(queue);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Derived Stats ────────────────────────────────────────────

  const engines = [...new Set(findings.map((f) => f.engine || f.sourceEngine || "unknown"))];
  const fpRateByEngine = engines.map((engine) => {
    const engineFindings = findings.filter(
      (f) => (f.engine || f.sourceEngine || "unknown") === engine,
    );
    const total = engineFindings.length;
    const fp = engineFindings.filter(
      (f) => f.resolution === "false-positive",
    ).length;
    return {
      engine,
      total,
      fpCount: fp,
      fpRate: total > 0 ? ((fp / total) * 100).toFixed(1) : "0.0",
    };
  });

  // ── Styles ───────────────────────────────────────────────────

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

  const inputStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    border: "1px solid #ddd",
    borderRadius: 6,
    fontSize: "0.9rem",
    flex: 1,
  };

  const buttonStyle: React.CSSProperties = {
    padding: "0.5rem 1.25rem",
    background: "#1a1a2e",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: 600,
  };

  if (loading) return <div>Loading admin panel...</div>;
  if (error) return <div style={{ color: "#e94560" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>Admin</h1>

      {/* ── PR Queue Management ──────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h3 style={{ marginBottom: "1rem", fontSize: "1.05rem" }}>
          PR Review Queue
        </h3>

        {/* Manual PR addition */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            alignItems: "center",
            marginBottom: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: "0.8rem", color: "#666", display: "block", marginBottom: "0.25rem" }}>
              PR ID
            </label>
            <input
              type="number"
              placeholder="e.g. 12345"
              value={prIdInput}
              onChange={(e) => setPrIdInput(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 2, minWidth: 250 }}>
            <label style={{ fontSize: "0.8rem", color: "#666", display: "block", marginBottom: "0.25rem" }}>
              Repository Name (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. my-team-project"
              value={repoNameInput}
              onChange={(e) => setRepoNameInput(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button onClick={handleAddPR} style={{ ...buttonStyle, marginTop: 16 }}>
            Add to Queue
          </button>
        </div>

        {queueError && (
          <div style={{ color: "#e94560", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            {queueError}
          </div>
        )}
        {queueMsg && (
          <div style={{ color: "#2ecc71", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            {queueMsg}
          </div>
        )}

        {/* Queue status */}
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            padding: "0.75rem",
            background: "#fafafa",
            borderRadius: 6,
            fontSize: "0.9rem",
          }}
        >
          <div>
            <strong>Currently Processing:</strong>{" "}
            {queueStatus?.currentProcessing
              ? `PR #${queueStatus.currentProcessing}`
              : "None"}
          </div>
          <div>
            <strong>Pending:</strong> {queueStatus?.pendingCount ?? 0}
          </div>
          <button
            onClick={refreshQueue}
            style={{ marginLeft: "auto", ...buttonStyle, fontSize: "0.8rem", padding: "0.3rem 0.75rem" }}
          >
            {queueRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={handleClearQueue}
            disabled={(queueStatus?.pendingCount ?? 0) === 0}
            style={{ ...buttonStyle, fontSize: "0.8rem", padding: "0.3rem 0.75rem" }}
          >
            Clear Pending
          </button>
        </div>

        {/* Pending queue items */}
        {queueStatus?.pending && queueStatus.pending.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <h4 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Pending Items</h4>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={cellStyle}>PR ID</th>
                  <th style={cellStyle}>Repository</th>
                </tr>
              </thead>
              <tbody>
                {queueStatus.pending.map((item: any, i: number) => (
                  <tr key={i}>
                    <td style={cellStyle}>
                      <code>#{item.prId}</code>
                    </td>
                    <td style={cellStyle}>{item.repoName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── FP Rate by Engine ────────────────────────────────────────────── */}
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
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>
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

      {/* ── High FP Rate Alerts ──────────────────────────────────────────── */}
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
                <strong>{item.fpRate}%</strong> false positive rate ({item.fpCount}
                of {item.total} findings). Consider reviewing the rules for this
                engine.
              </div>
            ))}
        </div>
      )}

      {/* ── Override Log ─────────────────────────────────────────────────── */}
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
                      override
                    </td>
                    <td style={cellStyle}>
                      {entry.newResolution || "-"}
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
