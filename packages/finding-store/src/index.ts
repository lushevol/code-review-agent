import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─── Public Type Interfaces ──────────────────────────────────────────────────

export interface NormalizedFinding {
  id: string;
  prId: number;
  repository: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  description: string;
  evidence: string;
  businessImpact: string;
  remediation: string;
  blocking: boolean;
  linkedTaskId: number | null;
  resolution: string;
  sourceEngine: string;
  sourceVersion: string;
  supersedesFindingId: string | null;
  contentHash: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AuditRecord {
  id: string;
  prId: number;
  repository: string;
  commitHash: string;
  baseCommitHash?: string;
  reviewStartTimestamp: string;
  reviewEndTimestamp: string;
  scanners: { engine: string; version: string; durationMs: number }[];
  modelVersion: string;
  findingsCount: number;
  blockingFindingsCount: number;
  mergePolicyDecision: "allowed" | "blocked" | "pending";
  supersedesReviewId: string | null;
  rawScannerOutputs?: Record<string, unknown>;
  createdAt: string;
}

export interface OverrideLogEntry {
  id: number;
  findingId: string;
  overriddenBy: string;
  oldResolution: string;
  newResolution: string;
  justification: string | null;
  secondApprover: string | null;
  expiryDate: string | null;
  createdAt: string;
}

// ─── Internal Row Types (snake_case from SQLite) ─────────────────────────────

interface FindingRow {
  id: string;
  pr_id: number;
  repository: string;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  description: string;
  evidence: string;
  business_impact: string;
  remediation: string;
  blocking: number; // SQLite stores as INTEGER (0/1)
  linked_task_id: number | null;
  resolution: string;
  source_engine: string;
  source_version: string;
  supersedes_finding_id: string | null;
  content_hash: string;
  created_at: string;
  resolved_at: string | null;
}

interface OverrideLogRow {
  id: number;
  finding_id: string;
  overridden_by: string;
  old_resolution: string;
  new_resolution: string;
  justification: string | null;
  second_approver: string | null;
  expiry_date: string | null;
  created_at: string;
}

interface AuditRecordRow {
  id: string;
  pr_id: number;
  repository: string;
  commit_hash: string;
  base_commit_hash: string | null;
  review_start_timestamp: string;
  review_end_timestamp: string;
  scanners: string; // JSON string
  model_version: string;
  findings_count: number;
  blocking_findings_count: number;
  merge_policy_decision: string;
  supersedes_review_id: string | null;
  raw_scanner_outputs: string | null; // JSON string
  created_at: string;
}

// ─── Statement ID Constants ──────────────────────────────────────────────────

const STMT = {
  INIT_FINDINGS: "ddl:findings",
  INIT_OVERRIDE_LOG: "ddl:override_log",
  INIT_AUDIT: "ddl:audit",
  UPSERT_FINDING: "stmt:upsertFinding",
  GET_FINDING_BY_ID: "stmt:getFindingById",
  GET_FINDINGS_BY_PR: "stmt:getFindingsByPr",
  GET_FINDINGS_BY_HASH: "stmt:getFindingsByHash",
  GET_FINDINGS_BY_ENGINE: "stmt:getFindingsByEngine",
  UPDATE_RESOLUTION: "stmt:updateResolution",
  RESOLVED_AT: "stmt:resolvedAt",
  INSERT_OVERRIDE: "stmt:insertOverride",
  INSERT_AUDIT: "stmt:insertAudit",
  GET_EXPIRED_OVERRIDES: "stmt:getExpiredOverrides",
} as const;

// ─── FindingStore Class ─────────────────────────────────────────────────────

export class FindingStore {
  private db: Database.Database | null = null;
  private stmts: Map<string, Database.Statement> = new Map();

  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? ".ratan/code-review-agent/findings.db";
  }

  /**
   * Initialize the database: ensure the directory exists, open/create the
   * SQLite file, enable WAL mode, and run DDL to create tables and indexes.
   */
  init(pathOverride?: string): void {
    const effectivePath = pathOverride ?? this.dbPath;
    const resolved = path.resolve(effectivePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.runDDL();
    this.prepareStatements();
  }

  // ─── Private: DDL ────────────────────────────────────────────────────────

  private runDDL(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        pr_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        file_path TEXT,
        line_start INTEGER,
        line_end INTEGER,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '',
        business_impact TEXT NOT NULL DEFAULT '',
        remediation TEXT NOT NULL DEFAULT '',
        blocking INTEGER NOT NULL DEFAULT 0,
        linked_task_id INTEGER,
        resolution TEXT NOT NULL DEFAULT 'open',
        source_engine TEXT NOT NULL,
        source_version TEXT NOT NULL DEFAULT '',
        supersedes_finding_id TEXT,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_findings_pr ON findings(pr_id, repository);
      CREATE INDEX IF NOT EXISTS idx_findings_hash ON findings(content_hash);
      CREATE INDEX IF NOT EXISTS idx_findings_engine ON findings(source_engine);
      CREATE INDEX IF NOT EXISTS idx_findings_resolution ON findings(resolution);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_dedup ON findings(pr_id, content_hash, source_engine);

      CREATE TABLE IF NOT EXISTS override_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        finding_id TEXT NOT NULL REFERENCES findings(id),
        overridden_by TEXT NOT NULL,
        old_resolution TEXT NOT NULL,
        new_resolution TEXT NOT NULL,
        justification TEXT,
        second_approver TEXT,
        expiry_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_override_finding ON override_log(finding_id);

      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        pr_id INTEGER NOT NULL,
        repository TEXT NOT NULL,
        commit_hash TEXT NOT NULL DEFAULT '',
        base_commit_hash TEXT,
        review_start_timestamp TEXT,
        review_end_timestamp TEXT,
        scanners TEXT NOT NULL DEFAULT '[]',
        model_version TEXT NOT NULL DEFAULT '',
        findings_count INTEGER NOT NULL DEFAULT 0,
        blocking_findings_count INTEGER NOT NULL DEFAULT 0,
        merge_policy_decision TEXT NOT NULL DEFAULT 'pending',
        supersedes_review_id TEXT,
        raw_scanner_outputs TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_pr ON audit_records(pr_id, repository);
    `);
  }

  // ─── Private: Statement Preparation ───────────────────────────────────────

  private prepareStatements(): void {
    const db = this.db!;

    this.stmts.set(
      STMT.GET_FINDINGS_BY_PR,
      db.prepare(
        "SELECT * FROM findings WHERE pr_id = ? AND repository = ? ORDER BY created_at DESC",
      ),
    );
    this.stmts.set(
      STMT.GET_FINDING_BY_ID,
      db.prepare("SELECT * FROM findings WHERE id = ?"),
    );
    this.stmts.set(
      STMT.GET_FINDINGS_BY_HASH,
      db.prepare(
        "SELECT * FROM findings WHERE pr_id = ? AND content_hash = ? ORDER BY created_at DESC",
      ),
    );
    this.stmts.set(
      STMT.GET_FINDINGS_BY_ENGINE,
      db.prepare(
        "SELECT * FROM findings WHERE source_engine = ? ORDER BY created_at DESC",
      ),
    );

    const upsertCols =
      "pr_id=excluded.pr_id, repository=excluded.repository, file_path=excluded.file_path, line_start=excluded.line_start, line_end=excluded.line_end, category=excluded.category, severity=excluded.severity, confidence=excluded.confidence, title=excluded.title, description=excluded.description, evidence=excluded.evidence, business_impact=excluded.business_impact, remediation=excluded.remediation, blocking=excluded.blocking, resolution=excluded.resolution, source_engine=excluded.source_engine, source_version=excluded.source_version, supersedes_finding_id=excluded.supersedes_finding_id, content_hash=excluded.content_hash";

    this.stmts.set(
      STMT.UPSERT_FINDING,
      db.prepare(`
        INSERT INTO findings (
          id, pr_id, repository, file_path, line_start, line_end,
          category, severity, confidence, title, description,
          evidence, business_impact, remediation, blocking, resolution,
          source_engine, source_version, supersedes_finding_id,
          content_hash, created_at
        ) VALUES (
          @id, @pr_id, @repository, @file_path, @line_start, @line_end,
          @category, @severity, @confidence, @title, @description,
          @evidence, @business_impact, @remediation, @blocking, @resolution,
          @source_engine, @source_version, @supersedes_finding_id,
          @content_hash, @created_at
        )
        ON CONFLICT(pr_id, content_hash, source_engine) DO UPDATE SET
          ${upsertCols}
        RETURNING *
      `),
    );

    this.stmts.set(
      STMT.UPDATE_RESOLUTION,
      db.prepare(
        "UPDATE findings SET resolution = ?, resolved_at = ? WHERE id = ?",
      ),
    );

    this.stmts.set(
      STMT.RESOLVED_AT,
      db.prepare("SELECT resolved_at FROM findings WHERE id = ?"),
    );

    this.stmts.set(
      STMT.INSERT_OVERRIDE,
      db.prepare(`
        INSERT INTO override_log
          (finding_id, overridden_by, old_resolution, new_resolution,
           justification, second_approver, expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
    );

    this.stmts.set(
      STMT.INSERT_AUDIT,
      db.prepare(`
        INSERT INTO audit_records
          (id, pr_id, repository, commit_hash, base_commit_hash,
           review_start_timestamp, review_end_timestamp, scanners,
           model_version, findings_count, blocking_findings_count,
           merge_policy_decision, supersedes_review_id, raw_scanner_outputs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
    );

    this.stmts.set(
      STMT.GET_EXPIRED_OVERRIDES,
      db.prepare(`
        SELECT DISTINCT ol.finding_id, f.resolution
        FROM override_log ol
        JOIN findings f ON f.id = ol.finding_id
        WHERE ol.expiry_date IS NOT NULL
          AND ol.expiry_date < datetime('now')
          AND ol.new_resolution NOT IN ('open')
        ORDER BY ol.created_at DESC
      `),
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.db) {
      throw new Error("FindingStore not initialized. Call init() first.");
    }
  }

  private getStmt(id: string): Database.Statement {
    const stmt = this.stmts.get(id);
    if (!stmt) throw new Error(`Statement not found: ${id}`);
    return stmt;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Upsert a finding. If a finding with the same (pr_id, content_hash,
   * source_engine) already exists, it is updated. Otherwise inserted.
   */
  upsertFinding(finding: NormalizedFinding): NormalizedFinding {
    this.assertInitialized();
    const row = findingToRow(finding);
    try {
      const result = this.getStmt(STMT.UPSERT_FINDING).get(row) as
        | FindingRow
        | undefined;
      return result ? rowToFinding(result) : finding;
    } catch (err) {
      throw new Error(
        `Failed to upsert finding ${finding.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Batch upsert findings in a single transaction.
   */
  batchUpsert(findings: NormalizedFinding[]): NormalizedFinding[] {
    this.assertInitialized();
    const upsert = this.db!.transaction(
      (items: NormalizedFinding[]) => {
        return items.map((f) => this.upsertFinding(f));
      },
    );
    return upsert(findings);
  }

  /**
   * Get all findings for a given PR and repository.
   */
  getFindingsByPr(prId: number, repository: string): NormalizedFinding[] {
    this.assertInitialized();
    try {
      const rows = this.getStmt(
        STMT.GET_FINDINGS_BY_PR,
      ).all(prId, repository) as FindingRow[];
      return rows.map(rowToFinding);
    } catch (err) {
      throw new Error(
        `Failed to get findings for PR ${prId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get a single finding by its ID.
   */
  getFindingById(id: string): NormalizedFinding | null {
    this.assertInitialized();
    try {
      const row = this.getStmt(STMT.GET_FINDING_BY_ID).get(id) as
        | FindingRow
        | undefined;
      return row ? rowToFinding(row) : null;
    } catch (err) {
      throw new Error(
        `Failed to get finding ${id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Update finding resolution. If override options are provided, also log
   * the override action in the override_log table.
   */
  updateResolution(
    id: string,
    resolution: string,
    options?: {
      overriddenBy?: string;
      justification?: string;
      secondApprover?: string;
      expiryDate?: string;
    },
  ): void {
    this.assertInitialized();
    try {
      // Get current resolution before updating
      const current = this.getStmt(STMT.GET_FINDING_BY_ID).get(id) as
        | FindingRow
        | undefined;
      if (!current) {
        throw new Error(`Finding not found: ${id}`);
      }

      const resolvedAt =
        resolution === "resolved" ? new Date().toISOString() : null;
      this.getStmt(STMT.UPDATE_RESOLUTION).run(resolution, resolvedAt, id);

      // If override options provided, log the override
      if (options?.overriddenBy) {
        this.getStmt(STMT.INSERT_OVERRIDE).run(
          id,
          options.overriddenBy,
          current.resolution,
          resolution,
          options.justification ?? null,
          options.secondApprover ?? null,
          options.expiryDate ?? null,
        );
      }
    } catch (err) {
      throw new Error(
        `Failed to update resolution for finding ${id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Find findings by content hash within a specific PR.
   * Used by the FindingReconciler for re-review matching.
   */
  getFindingsByContentHash(prId: number, hash: string): NormalizedFinding[] {
    this.assertInitialized();
    try {
      const rows = this.getStmt(STMT.GET_FINDINGS_BY_HASH).all(
        prId,
        hash,
      ) as FindingRow[];
      return rows.map(rowToFinding);
    } catch (err) {
      throw new Error(
        `Failed to get findings by hash for PR ${prId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get all findings for a given scanner engine.
   */
  getFindingsByEngine(engine: string): NormalizedFinding[] {
    this.assertInitialized();
    try {
      const rows = this.getStmt(STMT.GET_FINDINGS_BY_ENGINE).all(
        engine,
      ) as FindingRow[];
      return rows.map(rowToFinding);
    } catch (err) {
      throw new Error(
        `Failed to get findings for engine ${engine}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Save an immutable audit record for a review session.
   */
  saveAuditRecord(record: AuditRecord): void {
    this.assertInitialized();
    try {
      this.getStmt(STMT.INSERT_AUDIT).run(
        record.id,
        record.prId,
        record.repository,
        record.commitHash,
        record.baseCommitHash ?? null,
        record.reviewStartTimestamp,
        record.reviewEndTimestamp,
        JSON.stringify(record.scanners),
        record.modelVersion,
        record.findingsCount,
        record.blockingFindingsCount,
        record.mergePolicyDecision,
        record.supersedesReviewId,
        record.rawScannerOutputs
          ? JSON.stringify(record.rawScannerOutputs)
          : null,
      );
    } catch (err) {
      throw new Error(
        `Failed to save audit record ${record.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Query audit records with optional filters.
   */
  queryAuditRecords(filters: {
    prId?: number;
    repository?: string;
    from?: string;
    to?: string;
  }): AuditRecord[] {
    this.assertInitialized();
    try {
      let query = "SELECT * FROM audit_records WHERE 1=1";
      const params: unknown[] = [];

      if (filters.prId !== undefined) {
        query += " AND pr_id = ?";
        params.push(filters.prId);
      }
      if (filters.repository) {
        query += " AND repository = ?";
        params.push(filters.repository);
      }
      if (filters.from) {
        query += " AND created_at >= ?";
        params.push(filters.from);
      }
      if (filters.to) {
        query += " AND created_at <= ?";
        params.push(filters.to);
      }

      query += " ORDER BY created_at DESC";

      const rows = this.db!.prepare(query).all(...params) as AuditRecordRow[];
      return rows.map(rowToAuditRecord);
    } catch (err) {
      throw new Error(
        `Failed to query audit records: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get expired overrides that should be reverted to 'open'.
   */
  getExpiredOverrides(): { findingId: string; resolution: string }[] {
    this.assertInitialized();
    try {
      const rows = this.getStmt(STMT.GET_EXPIRED_OVERRIDES).all() as {
        finding_id: string;
        resolution: string;
      }[];
      return rows.map((r) => ({
        findingId: r.finding_id,
        resolution: r.resolution,
      }));
    } catch (err) {
      throw new Error(
        `Failed to get expired overrides: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.stmts.clear();
      this.db.close();
      this.db = null;
    }
  }
}

// ─── Row Mapping Functions ──────────────────────────────────────────────────

function findingToRow(f: NormalizedFinding): FindingRow {
  return {
    id: f.id,
    pr_id: f.prId,
    repository: f.repository,
    file_path: f.filePath,
    line_start: f.lineStart,
    line_end: f.lineEnd,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
    business_impact: f.businessImpact,
    remediation: f.remediation,
    blocking: f.blocking ? 1 : 0,
    linked_task_id: f.linkedTaskId,
    resolution: f.resolution,
    source_engine: f.sourceEngine,
    source_version: f.sourceVersion,
    supersedes_finding_id: f.supersedesFindingId,
    content_hash: f.contentHash,
    created_at: f.createdAt,
    resolved_at: f.resolvedAt,
  };
}

function rowToFinding(r: FindingRow): NormalizedFinding {
  return {
    id: r.id,
    prId: r.pr_id,
    repository: r.repository,
    filePath: r.file_path,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    category: r.category,
    severity: r.severity,
    confidence: r.confidence,
    title: r.title,
    description: r.description,
    evidence: r.evidence,
    businessImpact: r.business_impact,
    remediation: r.remediation,
    blocking: r.blocking === 1,
    linkedTaskId: r.linked_task_id,
    resolution: r.resolution,
    sourceEngine: r.source_engine,
    sourceVersion: r.source_version,
    supersedesFindingId: r.supersedes_finding_id,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

function rowToAuditRecord(r: AuditRecordRow): AuditRecord {
  return {
    id: r.id,
    prId: r.pr_id,
    repository: r.repository,
    commitHash: r.commit_hash,
    baseCommitHash: r.base_commit_hash ?? undefined,
    reviewStartTimestamp: r.review_start_timestamp,
    reviewEndTimestamp: r.review_end_timestamp,
    scanners: JSON.parse(r.scanners),
    modelVersion: r.model_version,
    findingsCount: r.findings_count,
    blockingFindingsCount: r.blocking_findings_count,
    mergePolicyDecision: r.merge_policy_decision as AuditRecord["mergePolicyDecision"],
    supersedesReviewId: r.supersedes_review_id,
    rawScannerOutputs: r.raw_scanner_outputs
      ? JSON.parse(r.raw_scanner_outputs)
      : undefined,
    createdAt: r.created_at,
  };
}
