import { randomUUID } from "node:crypto";
import { applyScoring, deduplicateResults } from "./scoring.js";

let lancedbImportPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;
const loadLanceDB = async (): Promise<typeof import("@lancedb/lancedb")> => {
  if (!lancedbImportPromise) {
    lancedbImportPromise = import("@lancedb/lancedb");
  }
  try {
    return await lancedbImportPromise;
  } catch (err) {
    throw new Error(
      `experimental-memory: failed to load LanceDB. ${String(err)}`,
      { cause: err },
    );
  }
};

const TABLE_NAME = "memories_v1";
const VECTOR_DIM = 1536; // text-embedding-3-small

export type MemoryKind =
  | "preference"
  | "decision"
  | "fact"
  | "learning"
  | "external"
  | "chat_log"
  | "topic_thread";

export type MemoryEntry = {
  id: string;
  text: string;
  vector: number[];
  scope: string;
  kind: MemoryKind;
  importance: number;
  createdAt: number;
  updatedAt: number;
  metadata: string;
};

export type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
};

export type SearchFilters = {
  scope?: string;
  kind?: string;
};

export type DuplicateCheckResult = {
  isDuplicate: boolean;
  existingEntry?: MemoryEntry;
  similarity?: number;
};

export class MemoryDB {
  private db: import("@lancedb/lancedb").Connection | null = null;
  private table: import("@lancedb/lancedb").Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly dbPath: string) {}

  private async ensureInitialized(): Promise<void> {
    if (this.table) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const lancedb = await loadLanceDB();
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();

    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      this.table = await this.db.createTable(TABLE_NAME, [
        {
          id: "__schema__",
          text: "",
          vector: Array.from({ length: VECTOR_DIM }).fill(0),
          scope: "",
          kind: "fact",
          importance: 0,
          createdAt: 0,
          updatedAt: 0,
          metadata: "{}",
        },
      ]);
      await this.table.delete('id = "__schema__"');
    }
  }

  static readonly DUPLICATE_THRESHOLD = 0.95;
  static readonly SEARCH_DEDUP_THRESHOLD = 0.85;

  async checkDuplicate(vector: number[]): Promise<DuplicateCheckResult> {
    await this.ensureInitialized();

    const rows = await this.table!.vectorSearch(vector).limit(1).toArray();
    if (rows.length === 0) return { isDuplicate: false };

    const distance = (rows[0]._distance as number) ?? Infinity;
    const similarity = 1 / (1 + distance);

    if (similarity >= MemoryDB.DUPLICATE_THRESHOLD) {
      return {
        isDuplicate: true,
        existingEntry: this.rowToEntry(rows[0]),
        similarity,
      };
    }
    return { isDuplicate: false };
  }

  async store(
    entry: Pick<MemoryEntry, "text" | "scope" | "kind"> &
      Partial<Pick<MemoryEntry, "importance" | "vector" | "metadata">>,
  ): Promise<MemoryEntry | DuplicateCheckResult> {
    await this.ensureInitialized();

    const vector = entry.vector ?? Array.from({ length: VECTOR_DIM }).fill(0) as number[];

    const hasRealVector = entry.vector != null;
    if (hasRealVector) {
      const dupCheck = await this.checkDuplicate(vector);
      if (dupCheck.isDuplicate) return dupCheck;
    }

    const now = Date.now();
    const fullEntry: MemoryEntry = {
      id: randomUUID(),
      text: entry.text,
      vector,
      scope: entry.scope,
      kind: entry.kind,
      importance: entry.importance ?? 0.7,
      createdAt: now,
      updatedAt: now,
      metadata: entry.metadata ?? "{}",
    };

    await this.table!.add([fullEntry]);
    return fullEntry;
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();
    const results = await this.table!
      .query()
      .where(`id = '${this.sanitizeId(id)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;
    return this.rowToEntry(results[0]);
  }

  async list(limit = 20, filters?: { scope?: string; kind?: string }): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    let query = this.table!.query();

    const conditions: string[] = [];
    if (filters?.scope) {
      conditions.push(`scope = '${this.sanitizeString(filters.scope)}'`);
    }
    if (filters?.kind) {
      conditions.push(`kind = '${this.sanitizeString(filters.kind)}'`);
    }
    if (conditions.length > 0) {
      query = query.where(conditions.join(" AND "));
    }

    const results = await query.limit(limit).toArray();
    return results.map((r) => this.rowToEntry(r));
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const sanitized = this.sanitizeId(id);
    await this.table!.delete(`id = '${sanitized}'`);
    return true;
  }

  async update(
    id: string,
    updates: Partial<Pick<MemoryEntry, "text" | "kind" | "importance" | "metadata" | "vector">>,
  ): Promise<MemoryEntry | null> {
    await this.ensureInitialized();

    const existing = await this.getById(id);
    if (!existing) return null;

    const now = Date.now();
    const vector = updates.vector ?? existing.vector;
    const updatedEntry: MemoryEntry = {
      ...existing,
      text: updates.text ?? existing.text,
      kind: updates.kind ?? existing.kind,
      importance: updates.importance ?? existing.importance,
      metadata: updates.metadata ?? existing.metadata,
      vector: Array.isArray(vector) ? vector : Array.from(vector as ArrayLike<number>),
      updatedAt: now,
    };

    await this.table!.delete(`id = '${this.sanitizeId(id)}'`);
    await this.table!.add([updatedEntry]);

    return updatedEntry;
  }

  async findByParentId(parentId: string, limit = 20): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    const allEntries = await this.table!.query().limit(1000).toArray();
    const matches: MemoryEntry[] = [];

    for (const row of allEntries) {
      const entry = this.rowToEntry(row);
      try {
        const meta = JSON.parse(entry.metadata);
        if (meta.parentId === parentId) {
          matches.push(entry);
          if (matches.length >= limit) break;
        }
      } catch {
        // Invalid JSON metadata, skip
      }
    }

    return matches;
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.table!.countRows();
  }

  async search(
    vector: number[],
    limit = 5,
    minScore = 0.1,
    filters?: SearchFilters,
  ): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();

    let query = this.table!.vectorSearch(vector);

    const conditions: string[] = [];
    if (filters?.scope) {
      conditions.push(`scope = '${this.sanitizeString(filters.scope)}'`);
    }
    if (filters?.kind) {
      conditions.push(`kind = '${this.sanitizeString(filters.kind)}'`);
    }
    if (conditions.length > 0) {
      query = query.where(conditions.join(" AND "));
    }

    const results = await query.limit(limit).toArray();

    const mapped = results.map((row) => {
      const distance = (row._distance as number) ?? 0;
      const score = 1 / (1 + distance);
      return {
        entry: this.rowToEntry(row),
        score,
      };
    });

    const filtered = mapped.filter((r) => r.score >= minScore);
    const scored = applyScoring(filtered);
    return deduplicateResults(scored, MemoryDB.SEARCH_DEDUP_THRESHOLD);
  }

  private sanitizeId(id: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error(`Invalid memory ID format: ${id}`);
    }
    return id;
  }

  private sanitizeString(s: string): string {
    return s.replace(/'/g, "''");
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    const rawVector = row.vector;
    const vector = Array.isArray(rawVector)
      ? rawVector as number[]
      : Array.from(rawVector as ArrayLike<number>);
    return {
      id: row.id as string,
      text: row.text as string,
      vector,
      scope: row.scope as string,
      kind: row.kind as MemoryKind,
      importance: row.importance as number,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      metadata: row.metadata as string,
    };
  }
}
