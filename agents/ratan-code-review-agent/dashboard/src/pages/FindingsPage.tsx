import { Fragment, useEffect, useState, useMemo } from "react";
import { fetchFindings, overrideFinding } from "../api";

const SEVERITIES = ["critical", "high", "medium", "low", "informational"];
const ENGINES = ["open-code-review", "sonarqube-cve", "compliance"];
const STATUSES = [
  "open",
  "resolved",
  "superseded",
  "waived",
  "false-positive",
  "accepted-risk",
];

export default function FindingsPage() {
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [severity, setSeverity] = useState("");
  const [engine, setEngine] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [overrideModal, setOverrideModal] = useState<{
    id: string;
    finding: any;
  } | null>(null);
  const [overrideResolution, setOverrideResolution] = useState("false-positive");
  const [overrideJustification, setOverrideJustification] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchFindings({ engine: engine || undefined, status: status || undefined })
      .then((data) => setFindings(data.findings ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [engine, status]);

  const filtered = useMemo(() => {
    let result = findings;
    if (severity) {
      result = result.filter((f) => f.severity === severity);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          (f.filePath || f.file || "").toLowerCase().includes(q) ||
          (f.id || "").toLowerCase().includes(q) ||
          (f.title || f.message || "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [findings, severity, search]);

  const handleOverride = async () => {
    if (!overrideModal) return;
    setOverrideSubmitting(true);
    try {
      await overrideFinding(overrideModal.id, {
        resolution: overrideResolution,
        overriddenBy: "dashboard-user",
        justification: overrideJustification || undefined,
      });
      setOverrideModal(null);
      setOverrideJustification("");
      setOverrideResolution("false-positive");
      // Refresh
      const data = await fetchFindings({
        engine: engine || undefined,
        status: status || undefined,
      });
      setFindings(data.findings ?? []);
    } catch (e: any) {
      alert("Override failed: " + e.message);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const filterBarStyle: React.CSSProperties = {
    display: "flex",
    gap: "0.75rem",
    marginBottom: "1.5rem",
    flexWrap: "wrap",
    alignItems: "center",
  };

  const selectStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
    fontSize: "0.9rem",
  };

  const inputStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #ddd",
    fontSize: "0.9rem",
    flex: 1,
    minWidth: 200,
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
        textTransform: "capitalize",
      }}
    >
      {text}
    </span>
  );

  const severityColor = (s: string) => {
    const map: Record<string, string> = {
      critical: "#e94560",
      high: "#f5a623",
      medium: "#f7dc6f",
      low: "#2ecc71",
      informational: "#95a5a6",
    };
    return map[s] || "#95a5a6";
  };

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>Findings</h1>

      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#ffe0e0",
            color: "#c0392b",
            borderRadius: 6,
            marginBottom: "1rem",
          }}
        >
          Error: {error}
        </div>
      )}

      {/* Filter bar */}
      <div style={filterBarStyle}>
        <select
          style={selectStyle}
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="">All Severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          style={selectStyle}
          value={engine}
          onChange={(e) => setEngine(e.target.value)}
        >
          <option value="">All Engines</option>
          {ENGINES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <select
          style={selectStyle}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          style={inputStyle}
          placeholder="Search by ID, file, or title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span style={{ fontSize: "0.85rem", color: "#999" }}>
          {filtered.length} of {findings.length}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div>Loading findings...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#999", padding: "2rem 0" }}>No findings match the current filters.</div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={cellStyle}>ID</th>
                <th style={cellStyle}>File</th>
                <th style={cellStyle}>Severity</th>
                <th style={cellStyle}>Category</th>
                <th style={cellStyle}>Engine</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>Created</th>
                <th style={{ ...cellStyle, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const isExpanded = expandedId === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr
                      onClick={() =>
                        setExpandedId(isExpanded ? null : f.id)
                      }
                      style={{
                        cursor: "pointer",
                        background: isExpanded ? "#f0f7ff" : undefined,
                      }}
                    >
                      <td style={cellStyle}>
                        <code style={{ fontSize: "0.8rem" }}>
                          {f.id ? f.id.substring(0, 8) : "-"}
                        </code>
                      </td>
                      <td style={{ ...cellStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.filePath || f.file || "-"}
                      </td>
                      <td style={cellStyle}>
                        {badge(f.severity || "unknown", severityColor(f.severity))}
                      </td>
                      <td style={cellStyle}>{f.category || "-"}</td>
                      <td style={cellStyle}>{f.sourceEngine || f.engine || f.source || "-"}</td>
                      <td style={cellStyle}>
                        {badge(
                          f.resolution || f.status || "open",
                          (f.resolution === "open" || f.status === "open")
                            ? "#e94560"
                            : f.resolution === "resolved" || f.status === "resolved"
                              ? "#2ecc71"
                              : "#95a5a6",
                        )}
                      </td>
                      <td style={cellStyle}>
                        {f.createdAt
                          ? new Date(f.createdAt).toLocaleDateString()
                          : "-"}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOverrideModal({ id: f.id, finding: f });
                          }}
                          style={{
                            padding: "0.3rem 0.6rem",
                            borderRadius: 4,
                            border: "1px solid #ddd",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Override
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${f.id}-detail`}>
                        <td
                          colSpan={8}
                          style={{
                            padding: "1rem 1.5rem",
                            background: "#fafafa",
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          <div style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
                            {f.title && (
                              <p>
                                <strong>Title:</strong> {f.title}
                              </p>
                            )}
                            {f.message && (
                              <p>
                                <strong>Message:</strong> {f.message}
                              </p>
                            )}
                            <p>
                              <strong>Evidence:</strong>{" "}
                              {f.evidence || f.description || "N/A"}
                            </p>
                            {f.businessImpact && (
                              <p>
                                <strong>Business Impact:</strong>{" "}
                                {f.businessImpact}
                              </p>
                            )}
                            {f.remediation && (
                              <p>
                                <strong>Remediation:</strong> {f.remediation}
                              </p>
                            )}
                            {f.confidence !== undefined && (
                              <p>
                                <strong>Confidence:</strong>{" "}
                                {(f.confidence * 100).toFixed(0)}%
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Override Modal */}
      {overrideModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setOverrideModal(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "2rem",
              width: 420,
              maxWidth: "90vw",
              boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>
              Override Finding
            </h3>
            <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "1rem" }}>
              Finding: <code>{overrideModal.finding.id?.substring(0, 8)}</code> &mdash;{" "}
              {overrideModal.finding.filePath || overrideModal.finding.file}
            </p>

            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.3rem",
              }}
            >
              Resolution
            </label>
            <select
              style={{
                ...selectStyle,
                width: "100%",
                marginBottom: "1rem",
              }}
              value={overrideResolution}
              onChange={(e) => setOverrideResolution(e.target.value)}
            >
              <option value="false-positive">False Positive</option>
              <option value="wont-fix">Won't Fix</option>
              <option value="resolved">Resolved</option>
            </select>

            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.3rem",
              }}
            >
              Justification (optional)
            </label>
            <textarea
              style={{
                ...inputStyle,
                width: "100%",
                minHeight: 80,
                resize: "vertical",
                marginBottom: "1.5rem",
                fontFamily: "inherit",
              }}
              value={overrideJustification}
              onChange={(e) => setOverrideJustification(e.target.value)}
            />

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => setOverrideModal(null)}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 6,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleOverride}
                disabled={overrideSubmitting}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 6,
                  border: "none",
                  background: "#1a1a2e",
                  color: "#fff",
                  cursor: overrideSubmitting ? "not-allowed" : "pointer",
                  fontSize: "0.9rem",
                  opacity: overrideSubmitting ? 0.6 : 1,
                }}
              >
                {overrideSubmitting ? "Submitting..." : "Confirm Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
