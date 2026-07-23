import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
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
  confidence?: number;
  title: string;
  description: string;
  evidence: string;
  businessImpact: string;
  remediation: string;
  blocking: boolean;
  linkedTaskId: number | null;
  resolution: FindingResolution;
  sourceEngine: FindingEngine;
  sourceVersion: string;
  supersedesFindingId: string | null;
  contentHash: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByCommitHash: string | null;
}

export type FindingEngine =
  | "ai-review"
  | "open-code-review"
  | "sonarqube-cve"
  | "compliance";

export type FindingResolution =
  | "open"
  | "resolved"
  | "superseded"
  | "waived"
  | "false-positive"
  | "accepted-risk";

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

export interface FindingCommentThread {
  repository: string;
  prId: number;
  findingId: string;
  threadId: number;
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
  resolved_by_commit_hash: string | null;
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

interface FindingCommentThreadRow {
  repository: string;
  pr_id: number;
  finding_id: string;
  thread_id: number;
  created_at: string;
}

// ─── Statement ID Constants ──────────────────────────────────────────────────

const STMT = {
  UPSERT_FINDING: "stmt:upsertFinding",
  GET_FINDING_BY_ID: "stmt:getFindingById",
  GET_FINDINGS_BY_PR: "stmt:getFindingsByPr",
  GET_FINDINGS_BY_HASH: "stmt:getFindingsByHash",
  GET_FINDINGS_BY_ENGINE: "stmt:getFindingsByEngine",
  UPDATE_RESOLUTION: "stmt:updateResolution",
  INSERT_OVERRIDE: "stmt:insertOverride",
  INSERT_AUDIT: "stmt:insertAudit",
  GET_EXPIRED_OVERRIDES: "stmt:getExpiredOverrides",
  INSERT_FINDING_COMMENT_THREAD: "stmt:insertFindingCommentThread",
  GET_FINDING_COMMENT_THREADS_BY_PR: "stmt:getFindingCommentThreadsByPr",
} as const;

// ─── sql.js Compatibility Helpers ───────────────────────────────────────────

/**
 * Execute a prepared statement and return all result rows as objects.
 * The statement is freed after use (required in sql.js to avoid memory leaks).
 */
function rows<T>(stmt: any, params?: any): T[] {
  if (params) stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) results.push(stmt.getAsObject() as T);
  stmt.reset();
  stmt.free();
  return results;
}

/**
 * Execute a prepared statement and return the first result row, or undefined.
 * The statement is freed after use.
 */
function row<T>(stmt: any, params?: any): T | undefined {
  if (params) stmt.bind(params);
  const result = stmt.step() ? (stmt.getAsObject() as T) : undefined;
  stmt.reset();
  stmt.free();
  return result;
}

/**
 * Execute a prepared statement that produces no result rows (INSERT/UPDATE/DELETE).
 * The statement is freed after use.
 */
function exec(stmt: any, params?: any): void {
  if (params) stmt.bind(params);
  stmt.step();
  stmt.reset();
  stmt.free();
}

/**
 * sql.js requires named-parameter keys to include the `@` prefix (e.g., `@pr_id`).
 * This helper adds the prefix to every key in a bind-params object.
 */
function prefixBindParams(params: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(params)) {
    result[`@${key}`] = (params as Record<string, unknown>)[key];
  }
  return result;
}

// ─── FindingStore Class ─────────────────────────────────────────────────────

export class FindingStore {
  private sql: SqlJsStatic | null = null;
  private db: SqlJsDatabase | null = null;
  /** Stores SQL strings keyed by STMT constant — fresh prepared each execution. */
  private sqls: Map<string, string> = new Map();

  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? ".ratan/data/findings.db";
  }

  /**
   * Initialize the database: ensure the directory exists, open/create the
   * SQLite file using sql.js, and run DDL to create tables and indexes.
   */
  async init(pathOverride?: string): Promise<void> {
    const effectivePath = pathOverride ?? this.dbPath;
    const resolved = path.resolve(effectivePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.sql = await initSqlJs();
    const buffer = fs.existsSync(resolved)
      ? fs.readFileSync(resolved)
      : null;
    this.db = new this.sql.Database(buffer);
    this.db.run("PRAGMA journal_mode=MEMORY");
    this.db.run("PRAGMA foreign_keys=ON");
    this.runDDL();
    this.storeSQLs();
  }

  // ─── Private: DDL ────────────────────────────────────────────────────────

  private runDDL(): void {
    this.db!.run(`
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
        resolved_at TEXT,
        resolved_by_commit_hash TEXT
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

      CREATE TABLE IF NOT EXISTS finding_comment_threads (
        repository TEXT NOT NULL,
        pr_id INTEGER NOT NULL,
        finding_id TEXT NOT NULL REFERENCES findings(id),
        thread_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (repository, pr_id, thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_finding_comment_threads_finding
        ON finding_comment_threads(finding_id);
    `);
  }

  // ─── Private: Store SQL Strings ─────────────────────────────────────────

  private storeSQLs(): void {
    const upsertSQL = `
      INSERT INTO findings (
        id, pr_id, repository, file_path, line_start, line_end,
        category, severity, confidence, title, description,
        evidence, business_impact, remediation, blocking, linked_task_id, resolution,
        source_engine, source_version, supersedes_finding_id,
        content_hash, created_at
      ) VALUES (
        @id, @pr_id, @repository, @file_path, @line_start, @line_end,
        @category, @severity, @confidence, @title, @description,
        @evidence, @business_impact, @remediation, @blocking, @linked_task_id, @resolution,
        @source_engine, @source_version, @supersedes_finding_id,
        @content_hash, @created_at
      )
      ON CONFLICT(pr_id, content_hash, source_engine) DO UPDATE SET
        pr_id=excluded.pr_id, repository=excluded.repository,
        file_path=excluded.file_path, line_start=excluded.line_start,
        line_end=excluded.line_end, category=excluded.category,
        severity=excluded.severity, confidence=excluded.confidence,
        title=excluded.title, description=excluded.description,
        evidence=excluded.evidence, business_impact=excluded.business_impact,
        remediation=excluded.remediation, blocking=excluded.blocking,
        linked_task_id=excluded.linked_task_id, resolution=excluded.resolution,
        source_engine=excluded.source_engine, source_version=excluded.source_version,
        supersedes_finding_id=excluded.supersedes_finding_id,
        content_hash=excluded.content_hash
      RETURNING *`;

    this.sqls.set(STMT.UPSERT_FINDING, upsertSQL);
    this.sqls.set(
      STMT.GET_FINDING_BY_ID,
      "SELECT * FROM findings WHERE id = ?",
    );
    this.sqls.set(
      STMT.GET_FINDINGS_BY_PR,
      "SELECT * FROM findings WHERE pr_id = ? AND repository = ? ORDER BY created_at DESC",
    );
    this.sqls.set(
      STMT.GET_FINDINGS_BY_HASH,
      "SELECT * FROM findings WHERE pr_id = ? AND content_hash = ? ORDER BY created_at DESC",
    );
    this.sqls.set(
      STMT.GET_FINDINGS_BY_ENGINE,
      "SELECT * FROM findings WHERE source_engine = ? ORDER BY created_at DESC",
    );
    this.sqls.set(
      STMT.UPDATE_RESOLUTION,
      "UPDATE findings SET resolution = ?, resolved_at = ?, resolved_by_commit_hash = ? WHERE id = ?",
    );
    this.sqls.set(
      STMT.INSERT_OVERRIDE,
      `INSERT INTO override_log
        (finding_id, overridden_by, old_resolution, new_resolution,
         justification, second_approver, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.sqls.set(
      STMT.INSERT_AUDIT,
      `INSERT INTO audit_records
        (id, pr_id, repository, commit_hash, base_commit_hash,
         review_start_timestamp, review_end_timestamp, scanners,
         model_version, findings_count, blocking_findings_count,
         merge_policy_decision, supersedes_review_id, raw_scanner_outputs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.sqls.set(
      STMT.INSERT_FINDING_COMMENT_THREAD,
      `INSERT OR IGNORE INTO finding_comment_threads
        (repository, pr_id, finding_id, thread_id, created_at)
       VALUES (@repository, @pr_id, @finding_id, @thread_id, @created_at)`,
    );
    this.sqls.set(
      STMT.GET_FINDING_COMMENT_THREADS_BY_PR,
      "SELECT repository, pr_id, finding_id, thread_id, created_at FROM finding_comment_threads WHERE pr_id = ? AND repository = ?",
    );
    this.sqls.set(
      STMT.GET_EXPIRED_OVERRIDES,
      `SELECT DISTINCT ol.finding_id, f.resolution
       FROM override_log ol
       JOIN findings f ON f.id = ol.finding_id
       WHERE ol.expiry_date IS NOT NULL
         AND ol.expiry_date < datetime('now')
         AND ol.new_resolution NOT IN ('open')
       ORDER BY ol.created_at DESC`,
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.db) {
      throw new Error("FindingStore not initialized. Call init() first.");
    }
  }

  /** Prepare a fresh statement from the stored SQL. Freed after use by helpers. */
  private prep(id: string): any {
    const sql = this.sqls.get(id);
    if (!sql) throw new Error(`Statement not found: ${id}`);
    return this.db!.prepare(sql);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Upsert a finding. If a finding with the same (pr_id, content_hash,
   * source_engine) already exists, it is updated. Otherwise inserted.
   */
  upsertFinding(finding: NormalizedFinding): NormalizedFinding {
    this.assertInitialized();
    const rowData = findingToRow(finding);
    try {
      const result = row<FindingRow>(this.prep(STMT.UPSERT_FINDING), prefixBindParams(rowData));
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
    try {
      this.db!.run("BEGIN");
      const results = findings.map((f) => this.upsertFinding(f));
      this.db!.run("COMMIT");
      return results;
    } catch (err) {
      this.db!.run("ROLLBACK");
      throw new Error(
        `Failed to batch upsert findings: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get all findings for a given PR and repository.
   */
  getFindingsByPr(prId: number, repository: string): NormalizedFinding[] {
    this.assertInitialized();
    try {
      const resultRows = rows<FindingRow>(
        this.prep(STMT.GET_FINDINGS_BY_PR),
        [prId, repository],
      );
      return resultRows.map(rowToFinding);
    } catch (err) {
      throw new Error(
        `Failed to get findings for PR ${prId}: ${(err as Error).message}`,
      );
    }
  }

  queryFindings(filters: {
    prId?: number;
    repository?: string;
    engine?: FindingEngine;
    resolution?: FindingResolution;
  }): NormalizedFinding[] {
    this.assertInitialized();
    let query = "SELECT * FROM findings WHERE 1=1";
    const params: unknown[] = [];
    if (filters.prId !== undefined) {
      query += " AND pr_id = ?";
      params.push(filters.prId);
    }
    if (filters.repository) {
      query += " AND repository = ?";
      params.push(filters.repository);
    }
    if (filters.engine) {
      query += " AND source_engine = ?";
      params.push(filters.engine);
    }
    if (filters.resolution) {
      query += " AND resolution = ?";
      params.push(filters.resolution);
    }
    query += " ORDER BY created_at DESC";
    const resultRows = rows<FindingRow>(this.db!.prepare(query), params);
    return resultRows.map(rowToFinding);
  }

  /**
   * Get a single finding by its ID.
   */
  getFindingById(id: string): NormalizedFinding | null {
    this.assertInitialized();
    try {
      const result = row<FindingRow>(this.prep(STMT.GET_FINDING_BY_ID), [id]);
      return result ? rowToFinding(result) : null;
    } catch (err) {
      throw new Error(
        `Failed to get finding ${id}: ${(err as Error).message}`,
      );
    }
  }

  linkCommentThread(
    thread: Omit<FindingCommentThread, "createdAt">,
  ): void {
    this.assertInitialized();
    const finding = this.getFindingById(thread.findingId);
    if (
      !finding ||
      finding.prId !== thread.prId ||
      finding.repository !== thread.repository
    ) {
      throw new Error("Comment thread must belong to the finding's PR and repository");
    }
    exec(
      this.prep(STMT.INSERT_FINDING_COMMENT_THREAD),
      prefixBindParams({
        repository: thread.repository,
        pr_id: thread.prId,
        finding_id: thread.findingId,
        thread_id: thread.threadId,
        created_at: new Date().toISOString(),
      }),
    );
  }

  getCommentThreadsByPr(
    prId: number,
    repository: string,
  ): FindingCommentThread[] {
    this.assertInitialized();
    const resultRows = rows<FindingCommentThreadRow>(
      this.prep(STMT.GET_FINDING_COMMENT_THREADS_BY_PR),
      [prId, repository],
    );
    return resultRows.map((row) => ({
      repository: row.repository,
      prId: row.pr_id,
      findingId: row.finding_id,
      threadId: row.thread_id,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update finding resolution. If override options are provided, also log
   * the override action in the override_log table.
   */
  updateResolution(
    id: string,
    resolution: FindingResolution,
    options?: {
      overriddenBy?: string;
      justification?: string;
      secondApprover?: string;
      expiryDate?: string;
      resolvedByCommitHash?: string;
    },
  ): void {
    this.assertInitialized();
    try {
      // Get current resolution before updating
      const current = row<FindingRow>(
        this.prep(STMT.GET_FINDING_BY_ID),
        [id],
      );
      if (!current) {
        throw new Error(`Finding not found: ${id}`);
      }

      const resolvedAt =
        resolution === "resolved" ? new Date().toISOString() : null;
      const resolvedByCommitHash =
        resolution === "resolved" ? (options?.resolvedByCommitHash ?? null) : null;
      exec(this.prep(STMT.UPDATE_RESOLUTION), [resolution, resolvedAt, resolvedByCommitHash, id]);

      // If override options provided, log the override
      if (options?.overriddenBy) {
        exec(this.prep(STMT.INSERT_OVERRIDE), [
          id,
          options.overriddenBy,
          current.resolution,
          resolution,
          options.justification ?? null,
          options.secondApprover ?? null,
          options.expiryDate ?? null,
        ]);
      }
    } catch (err) {
      throw new Error(
        `Failed to update resolution for finding ${id}: ${(err as Error).message}`,
      );
    }
  }

  queryOverrideLog(findingId?: string): OverrideLogEntry[] {
    this.assertInitialized();
    const query = [
      "SELECT * FROM override_log",
      findingId ? "WHERE finding_id = ?" : "",
      "ORDER BY created_at DESC, id DESC",
    ].filter(Boolean).join(" ");
    const rowsList = rows<OverrideLogRow>(
      this.db!.prepare(query),
      findingId ? [findingId] : undefined,
    );
    return rowsList.map((rowItem) => ({
      id: rowItem.id,
      findingId: rowItem.finding_id,
      overriddenBy: rowItem.overridden_by,
      oldResolution: rowItem.old_resolution,
      newResolution: rowItem.new_resolution,
      justification: rowItem.justification,
      secondApprover: rowItem.second_approver,
      expiryDate: rowItem.expiry_date,
      createdAt: rowItem.created_at,
    }));
  }

  /**
   * Find findings by content hash within a specific PR.
   * Used by the FindingReconciler for re-review matching.
   */
  getFindingsByContentHash(prId: number, hash: string): NormalizedFinding[] {
    this.assertInitialized();
    try {
      const resultRows = rows<FindingRow>(
        this.prep(STMT.GET_FINDINGS_BY_HASH),
        [prId, hash],
      );
      return resultRows.map(rowToFinding);
    } catch (err) {
      throw new Error(
        `Failed to get findings by hash for PR ${prId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get all findings for a given scanner engine.
   */
  getFindingsByEngine(engine: FindingEngine): NormalizedFinding[] {
    this.assertInitialized();
    try {
      const resultRows = rows<FindingRow>(
        this.prep(STMT.GET_FINDINGS_BY_ENGINE),
        [engine],
      );
      return resultRows.map(rowToFinding);
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
      exec(this.prep(STMT.INSERT_AUDIT), [
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
      ]);
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

      const resultRows = rows<AuditRecordRow>(
        this.db!.prepare(query),
        params,
      );
      return resultRows.map(rowToAuditRecord);
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
      const resultRows = rows<{
        finding_id: string;
        resolution: string;
      }>(this.prep(STMT.GET_EXPIRED_OVERRIDES));
      return resultRows.map((r) => ({
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
   * Persist the current in-memory database to disk.
   */
  saveToDisk(): void {
    if (!this.db || !this.sql) return;
    const effectivePath = path.resolve(this.dbPath);
    const data = this.db.export();
    fs.writeFileSync(effectivePath, Buffer.from(data));
  }

  /**
   * Save to disk and close the database connection.
   */
  close(): void {
    if (this.db) {
      this.saveToDisk();
      this.sqls.clear();
      this.db.close();
      this.db = null;
      this.sql = null;
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
    confidence: f.confidence ?? 0,
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
    resolved_by_commit_hash: f.resolvedByCommitHash ?? null,
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
    resolution: r.resolution as FindingResolution,
    sourceEngine: r.source_engine as FindingEngine,
    sourceVersion: r.source_version,
    supersedesFindingId: r.supersedes_finding_id,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedByCommitHash: r.resolved_by_commit_hash,
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
