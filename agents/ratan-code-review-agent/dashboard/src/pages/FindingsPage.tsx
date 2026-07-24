import { Fragment, useEffect, useState, useMemo } from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Tooltip,
  Pagination,
} from "@nextui-org/react";
import { fetchFindings, overrideFinding } from "../api";

const SEVERITIES = ["critical", "high", "medium", "low", "informational"];
const ENGINES = ["open-code-review", "sonarqube-cve", "compliance"];
const STATUSES = ["open", "resolved", "superseded", "waived", "false-positive", "accepted-risk"];

const SEVERITY_COLOR: Record<string, "danger" | "warning" | "primary" | "success" | "default"> = {
  critical: "danger",
  high: "warning",
  medium: "primary",
  low: "success",
  informational: "default",
};

export default function FindingsPage() {
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [severity, setSeverity] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const rowsPerPage = 20;

  // Detail modal
  const [detailFinding, setDetailFinding] = useState<any | null>(null);

  // Override modal
  const [overrideModal, setOverrideModal] = useState<{ id: string; finding: any } | null>(null);
  const [overrideResolution, setOverrideResolution] = useState("false-positive");
  const [overrideJustification, setOverrideJustification] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const engineVal = engine.size === 1 ? Array.from(engine)[0] : undefined;
    const statusVal = status.size === 1 ? Array.from(status)[0] : undefined;
    fetchFindings({ engine: engineVal, status: statusVal })
      .then((data) => setFindings(data.findings ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [engine, status]);

  const filtered = useMemo(() => {
    let result = findings;
    if (severity.size === 1) {
      result = result.filter((f) => f.severity === Array.from(severity)[0]);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          (f.filePath || f.file || "").toLowerCase().includes(q) ||
          (f.id || "").toLowerCase().includes(q) ||
          (f.title || f.message || "").toLowerCase().includes(q) ||
          (f.repository || "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [findings, severity, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage),
    [filtered, page, rowsPerPage],
  );

  useEffect(() => setPage(1), [severity, engine, status, search]);

  const openCount = findings.filter(
    (f) => f.resolution === "open" || f.status === "open",
  ).length;
  const blockingCount = findings.filter(
    (f) => f.blocking && (f.resolution === "open" || f.status === "open"),
  ).length;
  const resolvedCount = findings.filter(
    (f) => f.resolution && f.resolution !== "open",
  ).length;

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
      const engineVal = engine.size === 1 ? Array.from(engine)[0] : undefined;
      const statusVal = status.size === 1 ? Array.from(status)[0] : undefined;
      const data = await fetchFindings({ engine: engineVal, status: statusVal });
      setFindings(data.findings ?? []);
    } catch (e: any) {
      alert("Override failed: " + e.message);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ["ID", "File", "Severity", "Category", "Engine", "Status", "Title", "Repository", "Created"];
    const rows = filtered.map((f) => [
      f.id,
      f.filePath || f.file || "",
      f.severity || "",
      f.category || "",
      f.sourceEngine || f.engine || "",
      f.resolution || f.status || "open",
      (f.title || f.message || "").replace(/"/g, '""'),
      f.repository || "",
      f.createdAt ? new Date(f.createdAt).toISOString() : "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `findings-${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* ── Summary Stats Row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card shadow="sm" className="border-l-4 border-l-primary" fullWidth>
          <CardBody className="py-2 px-3">
            <p className="text-xs text-gray-500">Total</p>
            <p className="text-xl font-bold">{findings.length}</p>
          </CardBody>
        </Card>
        <Card shadow="sm" className="border-l-4 border-l-danger" fullWidth>
          <CardBody className="py-2 px-3">
            <p className="text-xs text-gray-500">Open</p>
            <p className="text-xl font-bold">{openCount}</p>
          </CardBody>
        </Card>
        <Card shadow="sm" className="border-l-4 border-l-success" fullWidth>
          <CardBody className="py-2 px-3">
            <p className="text-xs text-gray-500">Resolved</p>
            <p className="text-xl font-bold">{resolvedCount}</p>
          </CardBody>
        </Card>
        <Card shadow="sm" className="border-l-4 border-l-warning" fullWidth>
          <CardBody className="py-2 px-3">
            <p className="text-xs text-gray-500">Blocking</p>
            <p className="text-xl font-bold">{blockingCount}</p>
          </CardBody>
        </Card>
      </div>

      {/* ── Filters ── */}
      <Card shadow="sm" fullWidth>
        <CardBody className="p-3">
          <div className="flex flex-wrap gap-3 items-center">
            <Select
              label="Severity"
              size="sm"
              className="w-full sm:w-36"
              selectedKeys={severity}
              onSelectionChange={(keys) => setSeverity(new Set(Array.from(keys).map(String)))}
            >
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </Select>

            <Select
              label="Engine"
              size="sm"
              className="w-full sm:w-44"
              selectedKeys={engine}
              onSelectionChange={(keys) => setEngine(new Set(Array.from(keys).map(String)))}
            >
              {ENGINES.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </Select>

            <Select
              label="Status"
              size="sm"
              className="w-full sm:w-36"
              selectedKeys={status}
              onSelectionChange={(keys) => setStatus(new Set(Array.from(keys).map(String)))}
            >
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </Select>

            <Input
              label="Search"
              size="sm"
              placeholder="ID, file, title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px]"
            />

            <Button size="sm" variant="bordered" onPress={handleExportCsv}>
              Export CSV
            </Button>

            <Chip variant="flat" size="sm" className="text-xs">
              {filtered.length} / {findings.length}
            </Chip>
          </div>
        </CardBody>
      </Card>

      {/* ── Error ── */}
      {error && (
        <Card className="border border-danger" fullWidth>
          <CardBody className="text-danger text-sm">{error}</CardBody>
        </Card>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Loading findings..." />
        </div>
      ) : paginated.length === 0 ? (
        <Card fullWidth>
          <CardBody className="text-center text-gray-400 py-12">
            No findings match the current filters.
          </CardBody>
        </Card>
      ) : (
        <Table
          aria-label="Findings table"
          selectionMode="single"
          onRowAction={(key) => {
            const finding = paginated.find((f) => f.id === key);
            if (finding) setDetailFinding(finding);
          }}
          bottomContent={
            pages > 1 ? (
              <div className="flex justify-center py-2">
                <Pagination total={pages} page={page} onChange={setPage} size="sm" showControls />
              </div>
            ) : undefined
          }
          classNames={{
            wrapper: "shadow-sm",
          }}
        >
          <TableHeader>
            <TableColumn className="text-xs uppercase tracking-wider">ID</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">File</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Severity</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Category</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Engine</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Status</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Created</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider text-center">Actions</TableColumn>
          </TableHeader>
          <TableBody emptyContent="No findings found.">
            {paginated.map((f) => (
              <TableRow key={f.id} className="cursor-pointer">
                <TableCell>
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{f.id?.substring(0, 8)}</code>
                </TableCell>
                <TableCell>
                  <Tooltip content={f.filePath || f.file}>
                    <span className="text-xs block max-w-[160px] truncate">
                      {f.filePath || f.file || "-"}
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Chip size="sm" color={SEVERITY_COLOR[f.severity] || "default"} variant="flat">
                    {f.severity || "unknown"}
                  </Chip>
                </TableCell>
                <TableCell><span className="text-xs">{f.category || "-"}</span></TableCell>
                <TableCell><span className="text-xs">{f.sourceEngine || f.engine || "-"}</span></TableCell>
                <TableCell>
                  <Chip
                    size="sm"
                    color={
                      f.resolution === "open" || f.status === "open"
                        ? "danger"
                        : f.resolution === "resolved" || f.status === "resolved"
                          ? "success"
                          : "default"
                    }
                    variant="flat"
                  >
                    {f.resolution || f.status || "open"}
                  </Chip>
                </TableCell>
                <TableCell className="text-xs">
                  {f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "-"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => setOverrideModal({ id: f.id, finding: f })}
                    >
                      Override
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── Detail Modal ── */}
      <Modal isOpen={!!detailFinding} onClose={() => setDetailFinding(null)} size="lg">
        <ModalContent>
          <ModalHeader>Finding Details</ModalHeader>
          <ModalBody>
            {detailFinding && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Chip size="sm" color={SEVERITY_COLOR[detailFinding.severity] || "default"} variant="flat">
                    {detailFinding.severity}
                  </Chip>
                  <Chip size="sm" variant="flat">{detailFinding.category}</Chip>
                  <Chip size="sm" variant="flat">{detailFinding.sourceEngine || detailFinding.engine}</Chip>
                  <Chip
                    size="sm"
                    color={detailFinding.resolution === "open" ? "danger" : "success"}
                    variant="flat"
                  >
                    {detailFinding.resolution}
                  </Chip>
                </div>
                <Divider />
                {detailFinding.title && (
                  <div>
                    <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Title</p>
                    <p>{detailFinding.title}</p>
                  </div>
                )}
                {detailFinding.message && (
                  <div>
                    <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Message</p>
                    <p>{detailFinding.message}</p>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Evidence</p>
                  <p className="text-gray-700">{detailFinding.evidence || detailFinding.description || "N/A"}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(detailFinding.filePath || detailFinding.file) && (
                    <div>
                      <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">File</p>
                      <p className="text-xs">{detailFinding.filePath || detailFinding.file}</p>
                    </div>
                  )}
                  {detailFinding.repository && (
                    <div>
                      <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Repository</p>
                      <p className="text-xs">{detailFinding.repository}</p>
                    </div>
                  )}
                  {detailFinding.lineStart !== undefined && (
                    <div>
                      <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Line</p>
                      <p className="text-xs">{detailFinding.lineStart}{detailFinding.lineEnd && detailFinding.lineEnd !== detailFinding.lineStart ? `-${detailFinding.lineEnd}` : ""}</p>
                    </div>
                  )}
                  {detailFinding.confidence !== undefined && (
                    <div>
                      <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Confidence</p>
                      <p className="text-xs">{(detailFinding.confidence * 100).toFixed(0)}%</p>
                    </div>
                  )}
                </div>
                {detailFinding.businessImpact && (
                  <div>
                    <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Business Impact</p>
                    <p>{detailFinding.businessImpact}</p>
                  </div>
                )}
                {detailFinding.remediation && (
                  <div>
                    <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Remediation</p>
                    <p>{detailFinding.remediation}</p>
                  </div>
                )}
                {detailFinding.blocking !== undefined && (
                  <div>
                    <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Blocking</p>
                    <p>{detailFinding.blocking ? "Yes" : "No"}</p>
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setDetailFinding(null)}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── Override Modal ── */}
      <Modal isOpen={!!overrideModal} onClose={() => setOverrideModal(null)} size="md">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>Override Finding</span>
            <span className="text-sm font-normal text-gray-500">
              {overrideModal?.finding?.id?.substring(0, 8)} — {overrideModal?.finding?.filePath || overrideModal?.finding?.file}
            </span>
          </ModalHeader>
          <ModalBody>
            <Select
              label="Resolution"
              selectedKeys={[overrideResolution]}
              onSelectionChange={(keys) => setOverrideResolution(Array.from(keys)[0] as string || "false-positive")}
            >
              <SelectItem key="false-positive">False Positive</SelectItem>
              <SelectItem key="wont-fix">{"Won't Fix"}</SelectItem>
              <SelectItem key="resolved">Resolved</SelectItem>
              <SelectItem key="waived">Waived</SelectItem>
              <SelectItem key="accepted-risk">Accepted Risk</SelectItem>
            </Select>
            <Input
              label="Justification (optional)"
              value={overrideJustification}
              onChange={(e) => setOverrideJustification(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setOverrideModal(null)}>
              Cancel
            </Button>
            <Button color="primary" isLoading={overrideSubmitting} onPress={handleOverride}>
              Confirm Override
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
