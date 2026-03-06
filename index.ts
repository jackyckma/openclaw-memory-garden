import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseConfig } from "./src/config.js";
import { Embedder } from "./src/embedder.js";
import { MemoryDB } from "./src/store.js";
import { registerTools } from "./src/tools.js";

const VALID_KINDS = ["preference", "decision", "fact", "learning", "external", "chat_log", "topic_thread"] as const;

const configSchema = {
  parse(value: unknown) {
    return parseConfig(value);
  },
};

const experimentalMemoryPlugin = {
  id: "experimental-memory",
  name: "Experimental Memory",
  configSchema,

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig);
    const resolvedDbPath = api.resolvePath(cfg.dbPath);
    const db = new MemoryDB(resolvedDbPath);
    const embedder = new Embedder(cfg.embedding.apiKey, cfg.embedding.model);

    api.logger.info(
      `experimental-memory: registered (db: ${resolvedDbPath}, model: ${cfg.embedding.model})`,
    );

    api.registerCli(
      ({ program }) => {
        const xmem = program.command("xmem").description("Experimental memory commands");

        xmem
          .command("stats")
          .description("Show memory count")
          .action(async () => {
            try {
              const count = await db.count();
              console.log(`Total memories: ${count}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("list")
          .description("List recent memories")
          .option("--limit <n>", "Max entries", "20")
          .option("--scope <scope>", "Filter by scope")
          .option("--kind <kind>", "Filter by kind")
          .option("--full-id", "Show full UUIDs")
          .option("--json", "Output as JSON")
          .action(async (opts) => {
            try {
              const entries = await db.list(parseInt(opts.limit), {
                scope: opts.scope,
                kind: opts.kind,
              });
              if (entries.length === 0) {
                console.log("No memories found.");
                return;
              }
              if (opts.json) {
                console.log(JSON.stringify(entries.map(e => ({
                  id: e.id,
                  scope: e.scope,
                  kind: e.kind,
                  importance: e.importance,
                  text: e.text.slice(0, 200),
                  createdAt: new Date(e.createdAt).toISOString(),
                })), null, 2));
                return;
              }
              for (const e of entries) {
                const idDisplay = opts.fullId ? e.id : e.id.slice(0, 8);
                console.log(
                  `[${idDisplay}] (${e.scope}/${e.kind}) ${e.text.slice(0, 80)}${e.text.length > 80 ? "…" : ""}`,
                );
              }
              console.log(`\n${entries.length} entries shown.`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("store")
          .description("Store a memory (embeds text automatically)")
          .argument("<text>", "Memory text")
          .requiredOption("--scope <scope>", "Scope (global, agent:<id>, project:<id>)")
          .requiredOption("--kind <kind>", `Kind (${VALID_KINDS.join(", ")})`)
          .option("--importance <n>", "Importance 0-1", "0.7")
          .action(async (text, opts) => {
            try {
              if (!VALID_KINDS.includes(opts.kind)) {
                console.error(`Invalid kind: ${opts.kind}. Must be one of: ${VALID_KINDS.join(", ")}`);
                process.exit(1);
              }
              const vector = await embedder.embed(text);
              const result = await db.store({
                text,
                vector,
                scope: opts.scope,
                kind: opts.kind,
                importance: parseFloat(opts.importance),
              });

              if ("isDuplicate" in result && result.isDuplicate) {
                const existing = result.existingEntry!;
                const pct = ((result.similarity ?? 0) * 100).toFixed(0);
                console.log(`Duplicate detected (${pct}% similar to existing memory).`);
                console.log(`  existing: ${existing.id}`);
                console.log(`  text: ${existing.text.slice(0, 80)}`);
                console.log(`Not stored.`);
                return;
              }

              const entry = result as import("./src/store.js").MemoryEntry;
              console.log(`Stored: ${entry.id}`);
              console.log(`  text: ${entry.text.slice(0, 80)}`);
              console.log(`  scope: ${entry.scope}`);
              console.log(`  kind: ${entry.kind}`);
              console.log(`  importance: ${entry.importance}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("search")
          .description("Semantic search over memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .option("--scope <scope>", "Filter by scope")
          .option("--kind <kind>", "Filter by kind")
          .action(async (query, opts) => {
            try {
              const vector = await embedder.embed(query);
              const filters: Record<string, string> = {};
              if (opts.scope) filters.scope = opts.scope;
              if (opts.kind) filters.kind = opts.kind;
              const results = await db.search(
                vector,
                parseInt(opts.limit),
                0.3,
                Object.keys(filters).length > 0 ? filters : undefined,
              );
              if (results.length === 0) {
                console.log("No relevant memories found.");
                return;
              }
              for (const r of results) {
                const pct = (r.score * 100).toFixed(0);
                console.log(
                  `[${r.entry.id.slice(0, 8)}] ${pct}% (${r.entry.scope}/${r.entry.kind}) ${r.entry.text.slice(0, 80)}${r.entry.text.length > 80 ? "…" : ""}`,
                );
              }
              console.log(`\n${results.length} results.`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("delete")
          .description("Delete a memory by ID")
          .argument("<id>", "Memory UUID")
          .action(async (id) => {
            try {
              await db.delete(id);
              console.log(`Deleted: ${id}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("get")
          .description("Get a memory by ID (with full metadata)")
          .argument("<id>", "Memory UUID")
          .action(async (id) => {
            try {
              const entry = await db.getById(id);
              if (!entry) {
                console.log(`Memory ${id} not found.`);
                return;
              }
              let metadata: Record<string, unknown> = {};
              try {
                metadata = JSON.parse(entry.metadata);
              } catch {
                // Invalid JSON
              }
              console.log(`ID:         ${entry.id}`);
              console.log(`Text:       ${entry.text}`);
              console.log(`Scope:      ${entry.scope}`);
              console.log(`Kind:       ${entry.kind}`);
              console.log(`Importance: ${entry.importance}`);
              console.log(`Created:    ${new Date(entry.createdAt).toISOString()}`);
              console.log(`Updated:    ${new Date(entry.updatedAt).toISOString()}`);
              console.log(`Metadata:   ${JSON.stringify(metadata, null, 2)}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("update")
          .description("Update an existing memory")
          .argument("<id>", "Memory UUID")
          .option("--text <text>", "New text (triggers re-embedding)")
          .option("--kind <kind>", `New kind (${VALID_KINDS.join(", ")})`)
          .option("--importance <n>", "New importance 0-1")
          .option("--parent <id>", "Set parentId in metadata")
          .option("--tags <tags>", "Set tags (comma-separated)")
          .action(async (id, opts) => {
            try {
              const existing = await db.getById(id);
              if (!existing) {
                console.log(`Memory ${id} not found.`);
                return;
              }

              const updates: Parameters<typeof db.update>[1] = {};

              if (opts.text) {
                updates.text = opts.text;
                updates.vector = await embedder.embed(opts.text);
              }
              if (opts.kind) {
                if (!VALID_KINDS.includes(opts.kind)) {
                  console.error(`Invalid kind: ${opts.kind}. Must be one of: ${VALID_KINDS.join(", ")}`);
                  process.exit(1);
                }
                updates.kind = opts.kind;
              }
              if (opts.importance) {
                updates.importance = parseFloat(opts.importance);
              }
              if (opts.parent || opts.tags) {
                let existingMeta: Record<string, unknown> = {};
                try {
                  existingMeta = JSON.parse(existing.metadata);
                } catch {
                  // Invalid metadata
                }
                if (opts.parent) existingMeta.parentId = opts.parent;
                if (opts.tags) existingMeta.tags = opts.tags.split(",").map((t: string) => t.trim());
                updates.metadata = JSON.stringify(existingMeta);
              }

              const updated = await db.update(id, updates);
              if (!updated) {
                console.log(`Failed to update memory ${id}.`);
                return;
              }

              const changedFields = Object.keys(updates).filter(k => k !== "vector");
              console.log(`Updated: ${id}`);
              console.log(`Changed: ${changedFields.join(", ") || "none"}`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });

        xmem
          .command("related")
          .description("Find memories related to a given ID (children)")
          .argument("<id>", "Memory UUID")
          .option("--limit <n>", "Max results", "20")
          .action(async (id, opts) => {
            try {
              const parent = await db.getById(id);
              if (!parent) {
                console.log(`Memory ${id} not found.`);
                return;
              }

              const children = await db.findByParentId(id, parseInt(opts.limit));

              if (children.length === 0) {
                console.log(`No related memories found for ${id}.`);
                return;
              }

              console.log(`Related memories (children of ${id.slice(0, 8)}):\n`);
              for (const e of children) {
                console.log(
                  `[${e.id.slice(0, 8)}] (${e.scope}/${e.kind}) ${e.text.slice(0, 80)}${e.text.length > 80 ? "…" : ""}`,
                );
              }
              console.log(`\n${children.length} results.`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
              process.exit(1);
            }
          });
      },
      { commands: ["xmem"] },
    );

    registerTools(api, db, embedder);

    // Auto-capture hook: store conversations as chat_log entries
    if (cfg.autoCapture.enabled) {
      api.logger.info(
        `experimental-memory: auto-capture enabled (maxChars: ${cfg.autoCapture.maxChars}, retention: ${cfg.autoCapture.retentionDays}d)`,
      );

      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) {
          return;
        }

        try {
          // Extract conversation text from messages
          const textParts: string[] = [];

          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            const role = msgObj.role as string;
            const content = msgObj.content;

            // Include both user and assistant messages
            if (role !== "user" && role !== "assistant") continue;

            if (typeof content === "string") {
              textParts.push(`[${role}]: ${content}`);
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (
                  block &&
                  typeof block === "object" &&
                  "type" in block &&
                  (block as Record<string, unknown>).type === "text" &&
                  "text" in block
                ) {
                  textParts.push(`[${role}]: ${(block as Record<string, unknown>).text}`);
                }
              }
            }
          }

          if (textParts.length === 0) return;

          // Combine and truncate if necessary
          let combinedText = textParts.join("\n\n");
          if (combinedText.length > cfg.autoCapture.maxChars) {
            combinedText = combinedText.slice(0, cfg.autoCapture.maxChars) + "\n\n[truncated]";
          }

          // Skip very short conversations
          if (combinedText.length < 50) return;

          // Skip if it looks like just a heartbeat
          if (combinedText.includes("HEARTBEAT_OK") && combinedText.length < 500) return;

          // Get session/agent info from event if available
          const sessionId = (event as Record<string, unknown>).sessionId as string | undefined;
          const agentId = (event as Record<string, unknown>).agentId as string | undefined;

          const metadata = {
            sessionId: sessionId ?? "unknown",
            agentId: agentId ?? "unknown",
            capturedAt: new Date().toISOString(),
            messageCount: textParts.length,
            processed: false,
          };

          // Embed and store
          const vector = await embedder.embed(combinedText.slice(0, 8000)); // Embedding limit
          const result = await db.store({
            text: combinedText,
            vector,
            scope: agentId ? `agent:${agentId}` : "global",
            kind: "chat_log",
            importance: 0.1, // Low importance to exclude from normal search
            metadata: JSON.stringify(metadata),
          });

          // Check if it was stored (not a duplicate)
          if ("isDuplicate" in result && result.isDuplicate) {
            api.logger.info?.("experimental-memory: skipped duplicate chat_log");
          } else {
            const entry = result as { id: string };
            api.logger.info?.(`experimental-memory: captured chat_log ${entry.id.slice(0, 8)}`);
          }
        } catch (err) {
          api.logger.warn?.(`experimental-memory: auto-capture failed: ${String(err)}`);
        }
      });
    }

    api.registerService({
      id: "experimental-memory",
      start: () => {
        api.logger.info(
          `experimental-memory: service started (db: ${resolvedDbPath})`,
        );
      },
      stop: () => {
        api.logger.info("experimental-memory: service stopped");
      },
    });
  },
};

export default experimentalMemoryPlugin;
