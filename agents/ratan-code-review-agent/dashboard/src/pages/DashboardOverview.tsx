import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { fetchFindings, fetchStats } from "../api";

const COLORS = ["#e94560", "#f5a623", "#f7dc6f", "#2ecc71", "#95a5a6"];

export default function DashboardOverview() {
  const [findings, setFindings] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchFindings().then((d) => d.findings ?? []).catch(() => []),
      fetchStats().catch(() => null),
    ])
      .then(([f, s]) => {
        setFindings(f);
        setStats(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading dashboard...</div>;
  if (error) return <div style={{ color: "#e94560" }}>Error: {error}</div>;

  const severityCounts = ["critical", "high", "medium", "low", "informational"].map(
    (s) => ({
      name: s,
      count: findings.filter((f) => f.severity === s).length,
    }),
  );

  const categoryCounts = [
    "bug",
    "security",
    "compliance",
    "cve",
    "dependency",
    "quality",
  ]
    .map((c) => ({ name: c, count: findings.filter((f) => f.category === c).length }))
    .filter((c) => c.count > 0);

  const openCount = findings.filter(
    (f) => f.resolution === "open" || f.status === "open",
  ).length;
  const resolvedCount = stats?.resolvedFindings ?? findings.filter(
    (f) => f.resolution && f.resolution !== "open",
  ).length;
  const blockingCount = stats?.blockingFindings ?? findings.filter(
    (f) => f.blocking && f.resolution === "open",
  ).length;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>
        Dashboard Overview
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <SummaryCard
          title="Total Findings"
          value={findings.length}
          color="#1a1a2e"
        />
        <SummaryCard title="Open" value={openCount} color="#e94560" />
        <SummaryCard title="Resolved" value={resolvedCount} color="#2ecc71" />
        <SummaryCard title="Blocking Findings" value={blockingCount} color="#f5a623" />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            background: "#fff",
            padding: "1rem",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ marginBottom: "1rem" }}>Findings by Severity</h3>
          {findings.length > 0 ? (
            <BarChart width={400} height={250} data={severityCounts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#e94560" />
            </BarChart>
          ) : (
            <p style={{ color: "#999" }}>No findings yet.</p>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            padding: "1rem",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ marginBottom: "1rem" }}>Findings by Category</h3>
          {categoryCounts.length > 0 ? (
            <PieChart width={400} height={250}>
              <Pie
                data={categoryCounts}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label
              >
                {categoryCounts.map((_, i) => (
                  <Cell
                    key={i}
                    fill={COLORS[i % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          ) : (
            <p style={{ color: "#999" }}>No findings yet.</p>
          )}
        </div>
      </div>

      {stats && stats.recentActivity && stats.recentActivity.length > 0 && (
        <div
          style={{
            marginTop: "1.5rem",
            background: "#fff",
            padding: "1rem",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ marginBottom: "1rem" }}>Recent Activity</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {stats.recentActivity.map((item: any, i: number) => (
              <li
                key={i}
                style={{
                  padding: "0.5rem 0",
                  borderBottom:
                    i < stats.recentActivity.length - 1
                      ? "1px solid #eee"
                      : "none",
                  fontSize: "0.9rem",
                }}
              >
                <strong>{item.action}</strong> &mdash; {item.detail}
                <span style={{ color: "#999", marginLeft: "0.5rem" }}>
                  {item.timestamp}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        padding: "1.5rem",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div
        style={{
          fontSize: "0.85rem",
          color: "#666",
          marginBottom: "0.5rem",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "2rem", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
