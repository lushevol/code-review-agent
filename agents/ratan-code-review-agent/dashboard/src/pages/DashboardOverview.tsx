import { useEffect, useState, useMemo } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Spinner,
} from "@nextui-org/react";
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
  LineChart,
  Line,
  AreaChart,
  Area,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { fetchFindings, fetchStats, fetchAudit } from "../api";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#e94560",
  high: "#f5a623",
  medium: "#f7dc6f",
  low: "#2ecc71",
  informational: "#95a5a6",
};

const PIE_COLORS = ["#e94560", "#f5a623", "#f7dc6f", "#2ecc71", "#95a5a6", "#3498db", "#9b59b6"];

function StatCard({ title, value, icon, color, subtitle }: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: "danger" | "warning" | "success" | "primary" | "default";
  subtitle?: string;
}) {
  return (
    <Card shadow="sm" fullWidth>
      <CardBody className="flex flex-row items-center gap-4 p-5">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color === "danger" ? "bg-danger/10 text-danger" : color === "warning" ? "bg-warning/10 text-warning" : color === "success" ? "bg-success/10 text-success" : color === "primary" ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-500"}`}>
          {icon}
        </div>
        <div className="flex flex-col">
          <span className="text-2xl font-bold">{value}</span>
          <span className="text-xs text-gray-500">{title}</span>
          {subtitle && <span className="text-[10px] text-gray-400">{subtitle}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

export default function DashboardOverview() {
  const [findings, setFindings] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [auditRecords, setAuditRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchFindings().then((d) => d.findings ?? []).catch(() => []),
      fetchStats().catch(() => null),
      fetchAudit().then((d) => d.records ?? []).catch(() => []),
    ])
      .then(([f, s, audits]) => {
        setFindings(f);
        setStats(s);
        setAuditRecords(audits);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const severityCounts = useMemo(
    () =>
      ["critical", "high", "medium", "low", "informational"].map((s) => ({
        name: s,
        count: findings.filter((f) => f.severity === s).length,
        fill: SEVERITY_COLORS[s] || "#95a5a6",
      })),
    [findings],
  );

  const categoryCounts = useMemo(
    () =>
      [
        "bug",
        "security",
        "compliance",
        "cve",
        "dependency",
        "quality",
        "other",
      ]
        .map((c) => ({ name: c, count: findings.filter((f) => f.category === c).length }))
        .filter((c) => c.count > 0),
    [findings],
  );

  const engineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) {
      const eng = f.sourceEngine || f.engine || "unknown";
      counts[eng] = (counts[eng] || 0) + 1;
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [findings]);

  // Review trend over time
  const reviewTrend = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const r of auditRecords) {
      const day = r.createdAt ? r.createdAt.substring(0, 10) : "unknown";
      byDay[day] = (byDay[day] || 0) + 1;
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, count]) => ({ date: date.substring(5), count }));
  }, [auditRecords]);

  // Scanner metrics from audit records
  const scannerMetrics = useMemo(() => {
    const metrics: Record<string, { totalDuration: number; count: number; totalFindings: number }> = {};
    for (const r of auditRecords) {
      if (r.scanners) {
        for (const s of r.scanners) {
          if (!metrics[s.engine]) {
            metrics[s.engine] = { totalDuration: 0, count: 0, totalFindings: 0 };
          }
          metrics[s.engine].totalDuration += s.durationMs || 0;
          metrics[s.engine].count += 1;
          metrics[s.engine].totalFindings += r.findingsCount || 0;
        }
      }
    }
    return Object.entries(metrics).map(([name, data]) => ({
      name,
      avgDuration: data.count > 0 ? Math.round(data.totalDuration / data.count) : 0,
      count: data.count,
      totalFindings: data.totalFindings,
    }));
  }, [auditRecords]);

  // Decision distribution
  const decisionCounts = useMemo(() => {
    const counts: Record<string, number> = { allowed: 0, blocked: 0, pending: 0 };
    for (const r of auditRecords) {
      const d = r.mergePolicyDecision || "pending";
      counts[d] = (counts[d] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [auditRecords]);

  // Stats cards data
  const totalFindings = findings.length;
  const openCount = findings.filter(
    (f) => f.resolution === "open" || f.status === "open",
  ).length;
  const resolvedCount = stats?.resolvedFindings ?? findings.filter(
    (f) => f.resolution && f.resolution !== "open",
  ).length;
  const blockingCount = stats?.blockingFindings ?? findings.filter(
    (f) => f.blocking && f.resolution === "open",
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" label="Loading dashboard..." />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border border-danger">
        <CardBody className="text-danger">Error: {error}</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Findings"
          value={totalFindings}
          color="primary"
          subtitle="All time"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          }
        />
        <StatCard
          title="Open Findings"
          value={openCount}
          color="danger"
          subtitle="Needs attention"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          }
        />
        <StatCard
          title="Resolved"
          value={resolvedCount}
          color="success"
          subtitle="Closed or waived"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Blocking"
          value={blockingCount}
          color="warning"
          subtitle="Merge blocked"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          }
        />
      </div>

      {/* Second Row: More stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card fullWidth shadow="sm" className="border-l-4 border-l-primary">
            <CardBody className="py-3 px-4">
              <span className="text-xs text-gray-500">Total Reviews</span>
              <span className="text-xl font-bold">{stats.totalReviews || 0}</span>
            </CardBody>
          </Card>
          <Card fullWidth shadow="sm" className="border-l-4 border-l-success">
            <CardBody className="py-3 px-4">
              <span className="text-xs text-gray-500">Unique PRs</span>
              <span className="text-xl font-bold">{stats.totalPRs || 0}</span>
            </CardBody>
          </Card>
          <Card fullWidth shadow="sm" className="border-l-4 border-l-warning">
            <CardBody className="py-3 px-4">
              <span className="text-xs text-gray-500">Avg Findings/PR</span>
              <span className="text-xl font-bold">
                {stats.totalPRs
                  ? (stats.totalFindings / stats.totalPRs).toFixed(1)
                  : "0"}
              </span>
            </CardBody>
          </Card>
          <Card fullWidth shadow="sm" className="border-l-4 border-l-danger">
            <CardBody className="py-3 px-4">
              <span className="text-xs text-gray-500">Blocking Rate</span>
              <span className="text-xl font-bold">
                {stats.totalFindings
                  ? ((stats.blockingFindings / stats.totalFindings) * 100).toFixed(1) + "%"
                  : "0%"}
              </span>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Charts Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Findings by Severity */}
        <Card fullWidth shadow="sm" className="overflow-visible">
          <CardHeader className="pb-0">
            <h3 className="text-sm font-semibold">Findings by Severity</h3>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={severityCounts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {severityCounts.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Findings by Category */}
        <Card fullWidth shadow="sm">
          <CardHeader className="pb-0">
            <h3 className="text-sm font-semibold">Findings by Category</h3>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={categoryCounts}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {categoryCounts.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Review Decision Distribution */}
        <Card fullWidth shadow="sm">
          <CardHeader className="pb-0">
            <h3 className="text-sm font-semibold">Review Decision Distribution</h3>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={decisionCounts}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  <Cell fill="#2ecc71" />
                  <Cell fill="#e94560" />
                  <Cell fill="#f5a623" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Engine Distribution */}
        <Card fullWidth shadow="sm">
          <CardHeader className="pb-0">
            <h3 className="text-sm font-semibold">Findings by Engine</h3>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={engineCounts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" fill="#3498db" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Review Trend Over Time */}
        {reviewTrend.length > 1 && (
          <Card fullWidth shadow="sm" className="lg:col-span-2">
            <CardHeader className="pb-0">
              <h3 className="text-sm font-semibold">Review Trend (Last 14 Days)</h3>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={reviewTrend}>
                  <defs>
                    <linearGradient id="reviewGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3498db" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3498db" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="#3498db" fill="url(#reviewGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        )}

        {/* Scanner Metrics */}
        {scannerMetrics.length > 0 && (
          <Card fullWidth shadow="sm" className="lg:col-span-2">
            <CardHeader className="pb-0">
              <h3 className="text-sm font-semibold">Scanner Performance</h3>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {scannerMetrics.map((sm) => (
                  <Card key={sm.name} shadow="none" className="bg-gray-50 border border-gray-200">
                    <CardBody className="p-4">
                      <Chip size="sm" variant="flat" className="mb-2 self-start">
                        {sm.name}
                      </Chip>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Runs:</span>
                          <span className="font-medium">{sm.count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Avg Duration:</span>
                          <span className="font-medium">{sm.avgDuration}ms</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Total Findings:</span>
                          <span className="font-medium">{sm.totalFindings}</span>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      {/* ── Recent Activity ── */}
      {stats?.recentActivity?.length > 0 && (
        <Card shadow="sm">
          <CardHeader>
            <h3 className="text-sm font-semibold">Recent Activity</h3>
          </CardHeader>
          <Divider />
          <CardBody className="p-0">
            <div className="divide-y divide-gray-100">
              {stats.recentActivity.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        item.action === "Review blocked"
                          ? "bg-danger"
                          : "bg-success"
                      }`}
                    />
                    <div>
                      <span className="text-sm font-medium">{item.action}</span>
                      <span className="text-xs text-gray-500 ml-2">{item.detail}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
