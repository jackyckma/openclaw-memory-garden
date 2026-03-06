# OpenClaw Memory Garden

A cultivated memory system for [OpenClaw](https://open-claw.bot) AI agents —
where memories grow into knowledge through **typing**, **importance weighting**,
and **LLM-powered gardening**.

> **Status:** Experimental but functional. We're using this in production
> alongside OpenClaw's built-in memory and would love feedback on the approach.

---

## Why Another Memory Plugin?

Most AI agent memory systems follow a simple pattern: store everything, embed
it, retrieve by similarity. This works initially but creates problems at scale:

| Problem | Symptom |
|---------|---------|
| **No structure** | Can't distinguish decisions from facts from preferences |
| **No priority** | Important memories buried under verbose chatter |
| **Stale data** | Contradictory information (old vs new decisions) |
| **Context bloat** | Retrieval returns too much, not enough signal |
| **Extraction cost** | LLM processing on every message is expensive |

This plugin takes a different approach:

1. **Typed memories** — `preference`, `decision`, `fact`, `learning`, `external`
2. **Importance scoring** — surface what matters, not just what's similar
3. **Scoped visibility** — `global`, `agent:sophie`, `project:blog`
4. **Parent-child links** — drill down from decisions to supporting facts
5. **Hot/cold separation** — fast ingestion, LLM reasoning in batch

Read the full rationale in [docs/DESIGN.md](docs/DESIGN.md).

---

## Quick Start

### Installation

```bash
# Clone the plugin
git clone https://github.com/nickyma/openclaw-memory-garden.git

# Install in OpenClaw
openclaw plugins install -l /path/to/openclaw-memory-garden

# Restart gateway
openclaw gateway restart
```

### Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "experimental-memory": {
        "enabled": true,
        "config": {
          "embedding": {
            "apiKey": "${OPENAI_API_KEY}",
            "model": "text-embedding-3-small"
          }
        }
      }
    }
  }
}
```

### Enable for an Agent

Add to your agent's config in `openclaw.json`:

```json
{
  "id": "sophie",
  "tools": {
    "allow": ["experimental-memory"]
  }
}
```

For read-only access:

```json
{
  "id": "miro",
  "tools": {
    "allow": ["experimental-memory"],
    "deny": ["xmem_store", "xmem_update", "xmem_delete"]
  }
}
```

---

## How It Works

### Memory Schema

Every memory entry has:

| Field | Description | Example |
|-------|-------------|---------|
| `text` | The memory content | "User prefers Traditional Chinese" |
| `kind` | Type of information | `preference`, `decision`, `fact` |
| `scope` | Who can see it | `global`, `agent:sophie` |
| `importance` | Priority (0-1) | `0.9` for critical preferences |
| `metadata` | Flexible JSON | `{ parentId: "...", tags: [...] }` |

### Retrieval Scoring

We use additive scoring without time decay:

```
final_score = similarity + (0.3 × importance)
```

**Why no time decay?** Old decisions aren't less valid — they're superseded.
A preference from 6 months ago is often more valuable than yesterday's debug
log. We handle outdated information through explicit supersession in
[memory gardening](docs/GARDENING.md), not automatic decay.

### Hot Path vs Cold Path

| | Hot Path | Cold Path |
|---|----------|-----------|
| **When** | Every agent interaction | Scheduled batch jobs |
| **Cost** | Embedding only (~$0.0001) | LLM reasoning |
| **Operations** | Store, search, list | Extract, enrich, cleanup |
| **Latency** | Milliseconds | Minutes |

This separation keeps agents fast while allowing sophisticated maintenance.

### Drill-Down Pattern

Memories form hierarchies:

```
Decision: "We use PostgreSQL for production"
  └── Fact: "PostgreSQL runs on port 5432"
  └── Fact: "Connection pool size is 20"
  └── Fact: "Backups run at 3 AM UTC"
```

When an agent finds a decision, they can drill down for details:

```javascript
// 1. Search finds high-level result
xmem_search({ query: "database setup" })
// → "We use PostgreSQL for production" (id: abc123)

// 2. Agent drills down for details
xmem_related({ id: "abc123" })
// → [port info, connection pool, backup schedule]
```

---

## Agent Tools

| Tool | Purpose |
|------|---------|
| `xmem_store` | Store a new memory |
| `xmem_search` | Semantic search with filters |
| `xmem_list` | List recent entries |
| `xmem_get` | Get single entry by ID |
| `xmem_update` | Modify existing entry |
| `xmem_delete` | Delete entry |
| `xmem_related` | Find child entries |

### Example: Store a Decision

```javascript
xmem_store({
  text: "We deploy to production on Fridays only after 2 PM",
  kind: "decision",
  scope: "global",
  importance: 0.9,
  metadata: { context: "Discussed after the Monday incident" }
})
```

### Example: Search with Filters

```javascript
xmem_search({
  query: "deployment procedures",
  kind: "decision",
  scope: "global",
  limit: 5
})
```

---

## CLI Commands

```bash
# List recent memories
openclaw xmem list --limit 20 --kind decision

# Search
openclaw xmem search "database configuration"

# Store
openclaw xmem store "API rate limit is 1000/hour" --kind fact

# Get details
openclaw xmem get <uuid>

# Delete
openclaw xmem delete <uuid>
```

---

## Memory Gardening

The plugin is designed for **LLM-powered maintenance** by a dedicated agent:

1. **Chat log extraction** — Process captured conversations, extract facts
2. **Proactive enrichment** — Add tags, adjust importance
3. **Supersession detection** — Find contradictory decisions
4. **Duplicate cleanup** — Merge near-identical entries
5. **Staleness review** — Flag outdated information

See [docs/GARDENING.md](docs/GARDENING.md) for implementation details.

---

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embedding.apiKey` | string | required | OpenAI API key |
| `embedding.model` | string | `text-embedding-3-small` | Embedding model |
| `dbPath` | string | `~/.openclaw/memory/experimental` | LanceDB storage |
| `autoCapture.enabled` | boolean | `false` | Auto-capture conversations |
| `autoCapture.maxChars` | number | `10000` | Max chars per capture |
| `autoCapture.retentionDays` | number | `30` | Days to keep raw captures |

### Auto-Capture

When enabled, the plugin automatically captures agent conversations as
`chat_log` entries with low importance (0.1). These are raw material for
gardening — a dedicated agent extracts structured knowledge during batch
processing.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@lancedb/lancedb` | ^0.26.2 | Vector database |
| `@sinclair/typebox` | ^0.34.48 | Type validation |
| `openai` | ^6.25.0 | Embeddings API |

**Note:** LanceDB uses native bindings. The package will download
platform-specific binaries during installation. If you encounter issues,
see [LanceDB's troubleshooting guide](https://lancedb.github.io/lancedb/).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  OpenClaw Gateway                        │
├─────────────────────────────────────────────────────────┤
│  openclaw-memory-garden                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Agent Tools │  │ CLI Commands│  │ Auto-capture    │  │
│  │ xmem_*      │  │ openclaw    │  │ hook            │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                   │           │
│         └────────────────┼───────────────────┘           │
│                          ▼                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   Store Layer                      │  │
│  │  • Embedding (OpenAI text-embedding-3-small)       │  │
│  │  • Vector storage (LanceDB)                        │  │
│  │  • Duplicate suppression                           │  │
│  │  • Importance-weighted scoring                     │  │
│  └───────────────────────────────────────────────────┘  │
│                          ▼                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │              LanceDB (embedded columnar DB)        │  │
│  │              ~/.openclaw/memory/experimental/      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Comparison

### vs OpenClaw's Built-in Memory

| Feature | memory-lancedb | This plugin |
|---------|----------------|-------------|
| Scoring | Pure similarity | Similarity + importance |
| Types | None | kind, scope |
| Hierarchy | Flat | Parent-child |
| Gardening | No | Designed for it |

This plugin runs **in parallel** with the built-in memory. You can test both
and compare results without risk.

### vs External Services (Zep, Mem0)

| Feature | External | This plugin |
|---------|----------|-------------|
| Data location | Cloud | Local |
| Privacy | Data transmitted | Data stays local |
| Cost | Usage-based | Embedding API only |
| Control | API limits | Full source access |

---

## Project Status

We're actively developing and using this plugin. Current state:

- ✅ Core functionality (store, search, list, update, delete)
- ✅ Importance-weighted scoring
- ✅ Duplicate suppression
- ✅ Parent-child linking
- ✅ Auto-capture hook
- ✅ CLI commands
- 🔄 Gardening documentation and patterns
- 📋 Planned: Hybrid retrieval (vector + keyword)
- 📋 Planned: Memory compaction/summarization

---

## Contributing

We'd love your input:

- **Design feedback**: Is our approach sound? What are we missing?
- **Use case reports**: How are you using agent memory?
- **Bug reports**: What doesn't work?
- **Code contributions**: PRs welcome

Open an issue to start a discussion.

---

## Documentation

- [Design Philosophy](docs/DESIGN.md) — Why we built this, how it works
- [Gardening Guide](docs/GARDENING.md) — LLM-powered memory maintenance

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgments

Built for the [OpenClaw](https://open-claw.bot) ecosystem. Inspired by
discussions about [agent memory architectures](https://blog.aihao.tw/2026/02/17/openai-in-house-data-agent/)
and the design of systems like Zep and Mem0.
