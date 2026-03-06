import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Embedder } from "./embedder.js";
import type { DuplicateCheckResult, MemoryDB, MemoryKind, SearchFilters } from "./store.js";

const VALID_KINDS = ["preference", "decision", "fact", "learning", "external", "chat_log", "topic_thread"] as const;

export function registerTools(
  api: OpenClawPluginApi,
  db: MemoryDB,
  embedder: Embedder,
): void {
  api.registerTool(
    {
      name: "xmem_store",
      label: "Store Memory",
      description:
        "Save a piece of information to long-term experimental memory. " +
        "Use for preferences, decisions, facts, learnings, or external knowledge.",
      parameters: Type.Object({
        text: Type.String({ description: "The information to remember" }),
        scope: Type.String({
          description:
            'Scope: "global", "agent:<id>", or "project:<id>"',
        }),
        kind: Type.Unsafe<MemoryKind>({
          type: "string",
          enum: [...VALID_KINDS],
          description: `Category: ${VALID_KINDS.join(", ")}`,
        }),
        importance: Type.Optional(
          Type.Number({
            description: "Importance 0-1 (default 0.7)",
            minimum: 0,
            maximum: 1,
          }),
        ),
        metadata: Type.Optional(
          Type.Object({
            sourceType: Type.Optional(Type.String({ description: "Source type: session, doc, external, manual" })),
            sourceId: Type.Optional(Type.String({ description: "Source identifier (URL, session ID, file path)" })),
            parentId: Type.Optional(Type.String({ description: "UUID of parent memory (for drill-down links)" })),
            validFrom: Type.Optional(Type.String({ description: "ISO date when fact becomes valid" })),
            validTo: Type.Optional(Type.String({ description: "ISO date when fact expires" })),
            tags: Type.Optional(Type.Array(Type.String(), { description: "Topic tags" })),
          }, { additionalProperties: true }),
        ),
      }),
      async execute(_toolCallId, params) {
        const {
          text,
          scope,
          kind,
          importance = 0.7,
          metadata,
        } = params as {
          text: string;
          scope: string;
          kind: MemoryKind;
          importance?: number;
          metadata?: Record<string, unknown>;
        };

        const vector = await embedder.embed(text);
        const metadataStr = metadata ? JSON.stringify(metadata) : "{}";
        const result = await db.store({
          text,
          vector,
          scope,
          kind,
          importance,
          metadata: metadataStr,
        });

        if ("isDuplicate" in result && (result as DuplicateCheckResult).isDuplicate) {
          const dup = result as DuplicateCheckResult;
          const existing = dup.existingEntry!;
          const pct = ((dup.similarity ?? 0) * 100).toFixed(0);
          return {
            content: [
              {
                type: "text" as const,
                text: `Duplicate detected (${pct}% similar). Existing memory ${existing.id}: "${existing.text.slice(0, 100)}${existing.text.length > 100 ? "…" : ""}"`,
              },
            ],
            details: { action: "duplicate_rejected", existingId: existing.id, similarity: dup.similarity },
          };
        }

        const entry = result as import("./store.js").MemoryEntry;
        return {
          content: [
            {
              type: "text" as const,
              text: `Stored memory ${entry.id}: "${text.slice(0, 100)}${text.length > 100 ? "…" : ""}"`,
            },
          ],
          details: { action: "created", id: entry.id, scope, kind, importance },
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "xmem_search",
      label: "Search Memory",
      description:
        "Semantic search through long-term experimental memories. " +
        "Use when you need context about user preferences, past decisions, or previously discussed topics.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default 5)" }),
        ),
        scope: Type.Optional(
          Type.String({ description: "Filter by scope" }),
        ),
        kind: Type.Optional(
          Type.Unsafe<MemoryKind>({
            type: "string",
            enum: [...VALID_KINDS],
            description: "Filter by kind",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const {
          query,
          limit = 5,
          scope,
          kind,
        } = params as {
          query: string;
          limit?: number;
          scope?: string;
          kind?: MemoryKind;
        };

        const vector = await embedder.embed(query);
        const filters: SearchFilters = {};
        if (scope) filters.scope = scope;
        if (kind) filters.kind = kind;
        const results = await db.search(vector, limit, 0.1, filters);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No relevant memories found." }],
            details: { count: 0 },
          };
        }

        const text = results
          .map(
            (r, i) =>
              `${i + 1}. [${r.entry.id}] (${r.entry.kind}) ${r.entry.text.slice(0, 80)}${r.entry.text.length > 80 ? "…" : ""} (${(r.score * 100).toFixed(0)}% match)`,
          )
          .join("\n");

        const sanitized = results.map((r) => ({
          id: r.entry.id,
          text: r.entry.text,
          kind: r.entry.kind,
          scope: r.entry.scope,
          importance: r.entry.importance,
          score: r.score,
        }));

        return {
          content: [
            { type: "text" as const, text: `Found ${results.length} memories:\n\n${text}` },
          ],
          details: { count: results.length, memories: sanitized },
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "xmem_list",
      label: "List Memories",
      description:
        "List recent entries in experimental memory, optionally filtered by scope or kind.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({ description: "Max entries to list (default 20)" }),
        ),
        scope: Type.Optional(
          Type.String({ description: "Filter by scope" }),
        ),
        kind: Type.Optional(
          Type.Unsafe<MemoryKind>({
            type: "string",
            enum: [...VALID_KINDS],
            description: "Filter by kind",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const {
          limit = 20,
          scope,
          kind,
        } = params as {
          limit?: number;
          scope?: string;
          kind?: MemoryKind;
        };

        const entries = await db.list(limit, { scope, kind });

        if (entries.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No memories found." }],
            details: { count: 0 },
          };
        }

        const text = entries
          .map(
            (e, i) =>
              `${i + 1}. [${e.id}] (${e.scope}/${e.kind}) ${e.text.slice(0, 80)}${e.text.length > 80 ? "…" : ""}`,
          )
          .join("\n");

        const sanitized = entries.map((e) => ({
          id: e.id,
          text: e.text,
          kind: e.kind,
          scope: e.scope,
          importance: e.importance,
          createdAt: e.createdAt,
        }));

        return {
          content: [
            { type: "text" as const, text: `${entries.length} memories:\n\n${text}` },
          ],
          details: { count: entries.length, memories: sanitized },
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "xmem_delete",
      label: "Delete Memory",
      description: "Delete a specific memory by its UUID.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory UUID to delete" }),
      }),
      async execute(_toolCallId, params) {
        const { id } = params as { id: string };
        await db.delete(id);
        return {
          content: [
            { type: "text" as const, text: `Memory ${id} deleted.` },
          ],
          details: { action: "deleted", id },
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "xmem_get",
      label: "Get Memory",
      description:
        "Retrieve a single memory by its UUID, including full metadata. " +
        "Use when you need complete details about a specific memory.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory UUID to retrieve" }),
      }),
      async execute(_toolCallId, params) {
        const { id } = params as { id: string };
        const entry = await db.getById(id);

        if (!entry) {
          return {
            content: [{ type: "text" as const, text: `Memory ${id} not found.` }],
            details: { found: false },
          };
        }

        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(entry.metadata);
        } catch {
          // Invalid JSON, leave as empty object
        }

        const text = [
          `**ID:** ${entry.id}`,
          `**Text:** ${entry.text}`,
          `**Scope:** ${entry.scope}`,
          `**Kind:** ${entry.kind}`,
          `**Importance:** ${entry.importance}`,
          `**Created:** ${new Date(entry.createdAt).toISOString()}`,
          `**Updated:** ${new Date(entry.updatedAt).toISOString()}`,
          `**Metadata:** ${JSON.stringify(metadata, null, 2)}`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
          details: {
            found: true,
            id: entry.id,
            text: entry.text,
            scope: entry.scope,
            kind: entry.kind,
            importance: entry.importance,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            metadata,
          },
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "xmem_update",
      label: "Update Memory",
      description:
        "Update an existing memory by ID. Can change text (will re-embed), " +
        "kind, importance, or metadata. Preserves id and createdAt; updates updatedAt.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory UUID to update" }),
        text: Type.Optional(Type.String({ description: "New text (triggers re-embedding)" })),
        kind: Type.Optional(
          Type.Unsafe<MemoryKind>({
            type: "string",
            enum: [...VALID_KINDS],
            description: "New category",
          }),
        ),
        importance: Type.Optional(
          Type.Number({
            description: "New importance 0-1",
            minimum: 0,
            maximum: 1,
          }),
        ),
        metadata: Type.Optional(
          Type.Object({
            sourceType: Type.Optional(Type.String()),
            sourceId: Type.Optional(Type.String()),
            parentId: Type.Optional(Type.String()),
            validFrom: Type.Optional(Type.String()),
            validTo: Type.Optional(Type.String()),
            tags: Type.Optional(Type.Array(Type.String())),
            usedIn: Type.Optional(Type.Array(Type.Object({
              blogId: Type.String(),
              date: Type.String(),
            }))),
          }, { additionalProperties: true }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { id, text, kind, importance, metadata } = params as {
          id: string;
          text?: string;
          kind?: MemoryKind;
          importance?: number;
          metadata?: Record<string, unknown>;
        };

        const existing = await db.getById(id);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Memory ${id} not found.` }],
            details: { found: false },
          };
        }

        const updates: Parameters<typeof db.update>[1] = {};

        if (text !== undefined) {
          updates.text = text;
          updates.vector = await embedder.embed(text);
        }
        if (kind !== undefined) updates.kind = kind;
        if (importance !== undefined) updates.importance = importance;
        if (metadata !== undefined) {
          let existingMeta: Record<string, unknown> = {};
          try {
            existingMeta = JSON.parse(existing.metadata);
          } catch {
            // Invalid existing metadata, start fresh
          }
          const merged = { ...existingMeta, ...metadata };
          updates.metadata = JSON.stringify(merged);
        }

        const updated = await db.update(id, updates);

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Failed to update memory ${id}.` }],
            details: { action: "failed" },
          };
        }

        const changedFields = Object.keys(updates).filter(k => k !== "vector");
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated memory ${id}. Changed: ${changedFields.join(", ") || "none"}.`,
            },
          ],
          details: { action: "updated", id, changedFields },
        };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "xmem_related",
      label: "Find Related Memories",
      description:
        "Find memories related to a given memory ID. Returns children (memories " +
        "with parentId pointing to this ID). Use for drill-down from decisions to supporting facts.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory UUID to find relations for" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
      }),
      async execute(_toolCallId, params) {
        const { id, limit = 20 } = params as { id: string; limit?: number };

        const parent = await db.getById(id);
        if (!parent) {
          return {
            content: [{ type: "text" as const, text: `Memory ${id} not found.` }],
            details: { found: false },
          };
        }

        const children = await db.findByParentId(id, limit);

        if (children.length === 0) {
          return {
            content: [
              { type: "text" as const, text: `No related memories found for ${id}.` },
            ],
            details: { parentId: id, count: 0 },
          };
        }

        const text = children
          .map(
            (e, i) =>
              `${i + 1}. [${e.kind}] ${e.text.slice(0, 100)}${e.text.length > 100 ? "…" : ""} (id: ${e.id.slice(0, 8)})`,
          )
          .join("\n");

        const sanitized = children.map((e) => ({
          id: e.id,
          text: e.text,
          kind: e.kind,
          scope: e.scope,
          importance: e.importance,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${children.length} related memories (children of ${id.slice(0, 8)}):\n\n${text}`,
            },
          ],
          details: { parentId: id, count: children.length, children: sanitized },
        };
      },
    },
    { optional: true },
  );
}
