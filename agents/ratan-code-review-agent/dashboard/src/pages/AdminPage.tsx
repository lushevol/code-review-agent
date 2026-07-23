import { useEffect, useState, useMemo } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Spinner,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@nextui-org/react";
import {
  addPRToQueue,
  clearPendingQueue,
  fetchFindings,
  fetchOverrides,
  fetchQueue,
  fetchAudit,
  fetchStats,
} from "../api";

export default function AdminPage() {
  const [overrides, setOverrides] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [auditRecords, setAuditRecords] = useState<any[]>([]);
  const [queueStatus, setQueueStatus] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [prIdInput, setPrIdInput] = useState("");
  const [repoNameInput, setRepoNameInput] = useState("");
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueRefreshing, setQueueRefreshing] = useState(false);

  const refreshQueue = async () => {
    try {
      setQueueRefreshing(true);
      setQueueStatus(await fetchQueue());
    } catch {
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

  useEffect(() => {
    Promise.all([
      fetchOverrides().then((d) => d.overrides ?? []),
      fetchFindings().then((d) => d.findings ?? []),
      fetchQueue().catch(() => null),
      fetchAudit().then((d) => d.records ?? []).catch(() => []),
      fetchStats().catch(() => null),
    ])
      .then(([overrideLog, f, queue, audits, st]) => {
        setOverrides(overrideLog);
        setFindings(f);
        setQueueStatus(queue);
        setAuditRecords(audits);
        setStats(st);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // FP rate by engine
  const fpRateByEngine = useMemo(() => {
    const engines = [...new Set(findings.map((f) => f.engine || f.sourceEngine || "unknown"))];
    return engines.map((engine) => {
      const engineFindings = findings.filter((f) => (f.engine || f.sourceEngine || "unknown") === engine);
      const total = engineFindings.length;
      const fp = engineFindings.filter((f) => f.resolution === "false-positive").length;
      return { engine, total, fpCount: fp, fpRate: total > 0 ? ((fp / total) * 100).toFixed(1) : "0.0" };
    });
  }, [findings]);

  // Scanner metrics from audit records
  const scannerMetrics = useMemo(() => {
    const metrics: Record<string, { totalDuration: number; count: number; totalFindings: number }> = {};
    for (const r of auditRecords) {
      if (r.scanners) {
        for (const s of r.scanners) {
          if (!metrics[s.engine]) metrics[s.engine] = { totalDuration: 0, count: 0, totalFindings: 0 };
          metrics[s.engine].totalDuration += s.durationMs || 0;
          metrics[s.engine].count += 1;
          metrics[s.engine].totalFindings += r.findingsCount || 0;
        }
      }
    }
    return Object.entries(metrics).map(([name, data]) => ({
      name,
      avgDuration: data.count > 0 ? Math.round(data.totalDuration / data.count) : 0,
      totalRuns: data.count,
      totalFindings: data.totalFindings,
    }));
  }, [auditRecords]);

  // Data growth (last 7 days)
  const dataGrowth = useMemo(() => {
    const byDay: Record<string, { findings: number; reviews: number }> = {};
    for (const f of findings) {
      const day = f.createdAt ? f.createdAt.substring(0, 10) : "unknown";
      if (!byDay[day]) byDay[day] = { findings: 0, reviews: 0 };
      byDay[day].findings += 1;
    }
    for (const r of auditRecords) {
      const day = r.createdAt ? r.createdAt.substring(0, 10) : "unknown";
      if (!byDay[day]) byDay[day] = { findings: 0, reviews: 0 };
      byDay[day].reviews += 1;
    }
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  }, [findings, auditRecords]);

  const totalFindingsCount = findings.length;

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner size="lg" label="Loading admin panel..." /></div>;
  }
  if (error) {
    return <Card className="border border-danger" fullWidth><CardBody className="text-danger">{error}</CardBody></Card>;
  }

  return (
    <div className="space-y-6">
      {/* ── System Health ── */}
      <Card shadow="sm" fullWidth>
        <CardHeader><p className="text-sm font-semibold">System Health</p></CardHeader>
        <Divider />
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
              <CardBody className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">API Status</span>
                  <Chip size="sm" color="success" variant="flat">Online</Chip>
                </div>
                <p className="text-xs text-gray-400">Dashboard API</p>
              </CardBody>
            </Card>
            <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
              <CardBody className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Database</span>
                  <Chip size="sm" color="success" variant="flat">Connected</Chip>
                </div>
                <p className="text-xs text-gray-400">{totalFindingsCount} findings stored</p>
              </CardBody>
            </Card>
            <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
              <CardBody className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Review Queue</span>
                  <Chip size="sm" color={queueStatus?.pendingCount > 0 ? "warning" : "success"} variant="flat">
                    {queueStatus?.pendingCount > 0 ? `${queueStatus.pendingCount} pending` : "Idle"}
                  </Chip>
                </div>
                <p className="text-xs text-gray-400">
                  {queueStatus?.currentProcessing ? `Processing PR #${queueStatus.currentProcessing}` : "No active processing"}
                </p>
              </CardBody>
            </Card>
            <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
              <CardBody className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Data Freshness</span>
                  <Chip size="sm" variant="flat" color="primary">{new Date().toLocaleDateString()}</Chip>
                </div>
                <p className="text-xs text-gray-400">{auditRecords.length} audit records</p>
              </CardBody>
            </Card>
          </div>
        </CardBody>
      </Card>

      {/* ── PR Queue Management ── */}
      <Card shadow="sm" fullWidth>
        <CardHeader><p className="text-sm font-semibold">PR Review Queue</p></CardHeader>
        <Divider />
        <CardBody>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div className="flex-1 min-w-[160px]">
              <Input label="PR ID" type="number" size="sm" placeholder="e.g. 12345" value={prIdInput} onChange={(e) => setPrIdInput(e.target.value)} />
            </div>
            <div className="flex-[2] min-w-[200px]">
              <Input label="Repository Name (optional)" size="sm" placeholder="e.g. my-team-project" value={repoNameInput} onChange={(e) => setRepoNameInput(e.target.value)} />
            </div>
            <Button size="sm" color="primary" onPress={handleAddPR}>Add to Queue</Button>
          </div>

          {queueError && <Chip size="sm" color="danger" variant="flat" className="mb-2">{queueError}</Chip>}
          {queueMsg && <Chip size="sm" color="success" variant="flat" className="mb-2">{queueMsg}</Chip>}

          <div className="flex flex-wrap items-center gap-4 p-3 bg-gray-50 rounded-lg text-sm">
            <div><strong>Processing:</strong> {queueStatus?.currentProcessing ? `PR #${queueStatus.currentProcessing}` : "None"}</div>
            <div><strong>Pending:</strong> {queueStatus?.pendingCount ?? 0}</div>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="flat" isLoading={queueRefreshing} onPress={refreshQueue}>Refresh</Button>
              <Button size="sm" variant="flat" color="danger" isDisabled={(queueStatus?.pendingCount ?? 0) === 0} onPress={handleClearQueue}>Clear Pending</Button>
            </div>
          </div>

          {queueStatus?.pending?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold mb-2 text-gray-500 uppercase tracking-wider">Pending Items</p>
              <Table aria-label="Pending queue items" classNames={{ wrapper: "shadow-sm" }}>
                <TableHeader>
                  <TableColumn className="text-xs uppercase tracking-wider">PR ID</TableColumn>
                  <TableColumn className="text-xs uppercase tracking-wider">Repository</TableColumn>
                </TableHeader>
                <TableBody>
                  {queueStatus.pending.map((item: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell><code className="text-xs font-medium">#{item.prId}</code></TableCell>
                      <TableCell className="text-xs">{item.repoName || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Scanner Performance ── */}
      {scannerMetrics.length > 0 && (
        <Card shadow="sm" fullWidth>
          <CardHeader><p className="text-sm font-semibold">Scanner Performance</p></CardHeader>
          <Divider />
          <CardBody>
            <Table aria-label="Scanner metrics" classNames={{ wrapper: "shadow-sm" }}>
              <TableHeader>
                <TableColumn className="text-xs uppercase tracking-wider">Scanner</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Total Runs</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Avg Duration</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Total Findings</TableColumn>
              </TableHeader>
              <TableBody>
                {scannerMetrics.map((sm) => (
                  <TableRow key={sm.name}>
                    <TableCell><Chip size="sm" variant="flat">{sm.name}</Chip></TableCell>
                    <TableCell className="text-xs font-medium">{sm.totalRuns}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (sm.avgDuration / 30000) * 100)}%` }} />
                        </div>
                        <span className="text-xs">{sm.avgDuration}ms</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{sm.totalFindings}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* ── Data Growth ── */}
      {dataGrowth.length > 0 && (
        <Card shadow="sm" fullWidth>
          <CardHeader><p className="text-sm font-semibold">Data Growth (Last 7 Days)</p></CardHeader>
          <Divider />
          <CardBody>
            <div className="grid grid-cols-7 gap-2">
              {dataGrowth.map(([day, data]) => (
                <Card key={day} shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
                  <CardBody className="p-2 text-center">
                    <p className="text-[10px] text-gray-400 mb-1">{day.substring(5)}</p>
                    <div className="text-xs">
                      <div className="flex justify-between"><span className="text-gray-500">F:</span><span className="font-medium">{data.findings}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">R:</span><span className="font-medium">{data.reviews}</span></div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── FP Rate by Engine ── */}
      <Card shadow="sm" fullWidth>
        <CardHeader><p className="text-sm font-semibold">False Positive Rate by Engine</p></CardHeader>
        <Divider />
        <CardBody>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {fpRateByEngine.map((item) => {
              const rate = parseFloat(item.fpRate);
              const barColor = rate > 20 ? "bg-danger" : rate > 10 ? "bg-warning" : "bg-success";
              return (
                <Card key={item.engine} shadow="none" className="border border-gray-200" fullWidth>
                  <CardBody className="p-4">
                    <Chip size="sm" variant="flat" className="mb-2 self-start">{item.engine}</Chip>
                    <p className="text-2xl font-bold">{item.fpRate}%</p>
                    <p className="text-xs text-gray-500">{item.fpCount} of {item.total} findings</p>
                    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, rate)}%` }} />
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* ── High FP Alerts ── */}
      {fpRateByEngine.filter((e) => parseFloat(e.fpRate) > 15).length > 0 && (
        <Card shadow="sm" fullWidth>
          <CardHeader><p className="text-sm font-semibold text-warning">High FP Rate Alerts</p></CardHeader>
          <Divider />
          <CardBody>
            {fpRateByEngine.filter((e) => parseFloat(e.fpRate) > 15).map((item) => (
              <div key={item.engine} className="p-3 mb-2 last:mb-0 rounded-lg bg-warning-50 border border-warning-200 text-sm">
                <strong>{item.engine}</strong> has a <strong>{item.fpRate}%</strong> false positive rate
                ({item.fpCount} of {item.total} findings). Consider reviewing the rules for this engine.
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* ── Override Log ── */}
      <Card shadow="sm" fullWidth>
        <CardHeader>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Override Log</p>
            {overrides.length > 0 && <Chip size="sm" variant="flat">{overrides.length}</Chip>}
          </div>
        </CardHeader>
        <Divider />
        <CardBody>
          {overrides.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">No overrides recorded yet.</p>
          ) : (
            <Table aria-label="Override log" classNames={{ wrapper: "shadow-sm" }}>
              <TableHeader>
                <TableColumn className="text-xs uppercase tracking-wider">Date</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Finding ID</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Action</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Resolution</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">By</TableColumn>
                <TableColumn className="text-xs uppercase tracking-wider">Justification</TableColumn>
              </TableHeader>
              <TableBody>
                {overrides.slice(0, 50).map((entry: any, i: number) => (
                  <TableRow key={entry.id || i}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {entry.timestamp || entry.createdAt || entry.date
                        ? new Date(entry.timestamp || entry.createdAt || entry.date).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell><code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{entry.findingId?.substring(0, 8) || "-"}</code></TableCell>
                    <TableCell className="text-xs">override</TableCell>
                    <TableCell>
                      <Chip size="sm" variant="flat" color={entry.newResolution === "open" ? "danger" : entry.newResolution === "resolved" ? "success" : "default"}>
                        {entry.newResolution || "-"}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-xs">{entry.overriddenBy || entry.user || "-"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{entry.justification || entry.reason || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {overrides.length > 50 && (
            <p className="text-xs text-gray-400 text-center pt-3">Showing 50 of {overrides.length} entries</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
