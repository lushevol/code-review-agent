import { useEffect, useState, useMemo } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
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
  Pagination,
} from "@nextui-org/react";
import { fetchPRs, fetchFindings, fetchAudit } from "../api";

export default function PRsPage() {
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [repoFilter, setRepoFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const [page, setPage] = useState(1);
  const rowsPerPage = 15;

  const [selectedPr, setSelectedPr] = useState<any | null>(null);
  const [prFindings, setPrFindings] = useState<any[]>([]);
  const [prAudits, setPrAudits] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const statusVal = statusFilter.size === 1 ? Array.from(statusFilter)[0] : undefined;
    fetchPRs({ status: statusVal })
      .then((data) => setPrs(data.prs ?? data.pullRequests ?? data.results ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const repos = useMemo(
    () => [...new Set(prs.map((pr) => pr.repository).filter(Boolean))],
    [prs],
  );

  const filtered = useMemo(() => {
    let result = prs;
    if (repoFilter.size === 1) {
      result = result.filter((pr) => pr.repository === Array.from(repoFilter)[0]);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (pr) =>
          String(pr.prId).includes(q) ||
          (pr.repository || "").toLowerCase().includes(q) ||
          (pr.title || "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [prs, repoFilter, searchQuery]);

  const pages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage),
    [filtered, page, rowsPerPage],
  );

  useEffect(() => setPage(1), [repoFilter, statusFilter, searchQuery]);

  const handlePrClick = async (pr: any) => {
    setSelectedPr(pr);
    setLoadingDetail(true);
    try {
      const [findingsData, auditData] = await Promise.all([
        fetchFindings({ prId: pr.prId, repo: pr.repository }).then((d) => d.findings ?? []),
        fetchAudit({ prId: pr.prId, repo: pr.repository }).then((d) => d.records ?? []),
      ]);
      setPrFindings(findingsData);
      setPrAudits(auditData);
    } catch {
      setPrFindings([]);
      setPrAudits([]);
    } finally {
      setLoadingDetail(false);
    }
  };

  const severityColor = (sev: string): "danger" | "warning" | "primary" | "success" | "default" => {
    const map: Record<string, any> = { critical: "danger", high: "warning", medium: "primary", low: "success", informational: "default" };
    return map[sev] || "default";
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Loading pull requests..." />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border border-danger" fullWidth>
        <CardBody className="text-danger">{error}</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <Card shadow="sm" fullWidth>
        <CardBody className="p-3">
          <div className="flex flex-wrap gap-3 items-center">
            <Select
              label="Repository"
              size="sm"
              className="w-44"
              selectedKeys={repoFilter}
              onSelectionChange={(keys) => setRepoFilter(new Set(Array.from(keys).map(String)))}
            >
              {repos.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </Select>
            <Select
              label="Status"
              size="sm"
              className="w-32"
              selectedKeys={statusFilter}
              onSelectionChange={(keys) => setStatusFilter(new Set(Array.from(keys).map(String)))}
            >
              <SelectItem key="allowed" value="allowed">Allowed</SelectItem>
              <SelectItem key="blocked" value="blocked">Blocked</SelectItem>
              <SelectItem key="pending" value="pending">Pending</SelectItem>
            </Select>
            <Input
              label="Search"
              size="sm"
              placeholder="PR ID or repo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 min-w-[180px]"
            />
            <Chip variant="flat" size="sm">{filtered.length} PRs</Chip>
          </div>
        </CardBody>
      </Card>

      {/* ── Table ── */}
      {paginated.length === 0 ? (
        <Card fullWidth>
          <CardBody className="text-center text-gray-400 py-12">No pull requests found.</CardBody>
        </Card>
      ) : (
        <Table
          aria-label="Pull requests table"
          selectionMode="single"
          onRowAction={(key) => {
            const pr = paginated.find((p) => `${p.repository}:${p.prId}` === key);
            if (pr) handlePrClick(pr);
          }}
          bottomContent={
            pages > 1 ? (
              <div className="flex justify-center py-2">
                <Pagination total={pages} page={page} onChange={setPage} size="sm" showControls />
              </div>
            ) : undefined
          }
          classNames={{ wrapper: "shadow-sm" }}
        >
          <TableHeader>
            <TableColumn className="text-xs uppercase tracking-wider">PR ID</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Repository</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Status</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Findings</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Blocking</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Reviewed</TableColumn>
            <TableColumn className="text-xs uppercase tracking-wider">Actions</TableColumn>
          </TableHeader>
          <TableBody emptyContent="No pull requests found.">
            {paginated.map((pr) => {
              const findingCount = pr.findingCount ?? pr.findingsCount ?? pr.totalFindings ?? 0;
              const blockingCountVal = pr.blockingCount ?? pr.blockingFindings ?? 0;
              return (
                <TableRow key={`${pr.repository}:${pr.prId}`}>
                  <TableCell>
                    <code className="text-xs font-semibold">#{pr.prId}</code>
                  </TableCell>
                  <TableCell><span className="text-xs">{pr.repository || "-"}</span></TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      color={
                        pr.status === "allowed" ? "success" :
                        pr.status === "blocked" ? "danger" : "warning"
                      }
                      variant="flat"
                    >
                      {pr.status || "active"}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={findingCount > 0 ? "warning" : "success"}>
                      {findingCount}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={blockingCountVal > 0 ? "danger" : "success"}>
                      {blockingCountVal}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-xs">
                    {pr.createdAt ? new Date(pr.createdAt).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="light" onPress={() => handlePrClick(pr)}>
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* ── PR Detail Modal ── */}
      <Modal isOpen={!!selectedPr} onClose={() => { setSelectedPr(null); setPrFindings([]); setPrAudits([]); }} size="3xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold">PR #{selectedPr?.prId}</span>
              <Chip size="sm" color={selectedPr?.status === "allowed" ? "success" : selectedPr?.status === "blocked" ? "danger" : "warning"} variant="flat">
                {selectedPr?.status || "active"}
              </Chip>
            </div>
            <p className="text-sm font-normal text-gray-500">{selectedPr?.repository}</p>
          </ModalHeader>
          <ModalBody>
            {loadingDetail ? (
              <div className="flex justify-center py-8"><Spinner label="Loading details..." /></div>
            ) : (
              <div className="space-y-6">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
                    <CardBody className="py-2 px-3">
                      <p className="text-xs text-gray-500">Total Findings</p>
                      <p className="text-lg font-bold">{prFindings.length}</p>
                    </CardBody>
                  </Card>
                  <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
                    <CardBody className="py-2 px-3">
                      <p className="text-xs text-gray-500">Blocking</p>
                      <p className="text-lg font-bold text-danger">
                        {prFindings.filter((f) => f.blocking && f.resolution === "open").length}
                      </p>
                    </CardBody>
                  </Card>
                  <Card shadow="none" className="bg-gray-50 border border-gray-200" fullWidth>
                    <CardBody className="py-2 px-3">
                      <p className="text-xs text-gray-500">Reviews</p>
                      <p className="text-lg font-bold">{prAudits.length}</p>
                    </CardBody>
                  </Card>
                </div>

                {/* Review Timeline */}
                {prAudits.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Review Timeline</p>
                    <div className="space-y-2">
                      {prAudits.map((audit: any, i: number) => (
                        <div key={audit.id || i} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              audit.mergePolicyDecision === "blocked" ? "bg-danger" :
                              audit.mergePolicyDecision === "allowed" ? "bg-success" : "bg-warning"
                            }`} />
                            <span className="font-semibold">{audit.mergePolicyDecision}</span>
                            <span className="text-gray-500">
                              {audit.findingsCount} findings, {audit.blockingFindingsCount} blocking
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            <span>{audit.scanners?.map((s: any) => s.engine).join(", ")}</span>
                            <span>{audit.createdAt ? new Date(audit.createdAt).toLocaleString() : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Findings List */}
                {prFindings.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Findings ({prFindings.length})</p>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {prFindings.map((f: any) => (
                        <div key={f.id} className="flex items-start gap-3 p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                          <Chip size="sm" color={severityColor(f.severity)} variant="flat" className="mt-0.5">
                            {f.severity}
                          </Chip>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{f.title || f.message || f.filePath || "-"}</span>
                              <Chip size="sm" variant="flat" className="text-[10px] h-5">{f.category}</Chip>
                            </div>
                            {f.filePath && (
                              <p className="text-xs text-gray-400 mt-0.5">{f.filePath}:{f.lineStart || ""}</p>
                            )}
                          </div>
                          <Chip size="sm" color={f.resolution === "open" ? "danger" : "success"} variant="flat">
                            {f.resolution}
                          </Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setSelectedPr(null); setPrFindings([]); setPrAudits([]); }}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
