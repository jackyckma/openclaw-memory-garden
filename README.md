# OpenClaw Granular Memory

A granular memory system plugin for [OpenClaw](https://open-claw.bot) with
scopes, kinds, importance scoring, and LLM-powered gardening.

## Features

- **Scoped memories**: `global`, `agent:<id>`, `project:<id>`
- **Typed entries**: `preference`, `decision`, `fact`, `learning`, `external`, `chat_log`, `topic_thread`
- **Importance scoring**: 0-1 float for retrieval ranking
- **Duplicate suppression**: At store-time and search-time
- **Parent-child linking**: Drill-down from decisions to supporting facts
- **Auto-capture**: Automatically capture agent conversations for later processing
- **LLM gardening**: Batch processing for extraction, enrichment, and cleanup

## Installation

```bash
# Clone or download this plugin
git clone https://github.com/YOUR_USERNAME/openclaw-memory-granular.git

# Install in OpenClaw
openclaw plugins install -l /path/to/openclaw-memory-granular
```

## Configuration

Add to your `openclaw.json` plugins section:

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
          },
          "dbPath": "~/.openclaw/memory/experimental",
          "autoCapture": {
            "enabled": false,
            "maxChars": 10000,
            "retentionDays": 30
          }
        }
      }
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embedding.apiKey` | string | required | OpenAI API key (supports `${ENV_VAR}` syntax) |
| `embedding.model` | string | `text-embedding-3-small` | Embedding model |
| `dbPath` | string | `~/.openclaw/memory/experimental` | LanceDB storage path |
| `autoCapture.enabled` | boolean | `false` | Auto-capture agent conversations |
| `autoCapture.maxChars` | number | `10000` | Max characters per captured conversation |
| `autoCapture.retentionDays` | number | `30` | Days to retain raw captures |

## Agent Tools

Once enabled, agents can opt-in to these tools via `tools.allow: ["experimental-memory"]`:

| Tool | Description |
|------|-------------|
| `xmem_store` | Store a memory entry |
| `xmem_search` | Semantic search with filters |
| `xmem_list` | List recent entries |
| `xmem_get` | Get single entry by ID |
| `xmem_update` | Update existing entry |
| `xmem_delete` | Delete entry by ID |
| `xmem_related` | Find child entries (drill-down) |

### Example: Store a memory

```javascript
xmem_store({
  text: "User prefers Traditional Chinese responses",
  kind: "preference",
  scope: "global",
  importance: 0.9,
  metadata: { source: "conversation" }
})
```

### Example: Search with filters

```javascript
xmem_search({
  query: "server configuration",
  scope: "global",
  kind: "decision",
  limit: 5
})
```

## CLI Commands

```bash
# List recent memories
openclaw xmem list --limit 20

# Search memories
openclaw xmem search "database configuration"

# Store a memory
openclaw xmem store "We use PostgreSQL" --kind decision --scope global

# Get entry details
openclaw xmem get <uuid>

# Delete an entry
openclaw xmem delete <uuid>
```

## Scoring Algorithm

Retrieval uses additive scoring without time decay:

```
final_score = w_relevance × similarity + w_importance × importance
```

Where:
- `w_relevance = 1.0` (dominant factor)
- `w_importance = 0.3` (mild importance nudge)
- No time decay — old facts remain valid until explicitly superseded

## Memory Gardening

For LLM-powered batch maintenance (duplicate cleanup, supersession detection,
extraction from chat logs), see the [gardening guide](docs/GARDENING.md).

The recommended approach is to designate a "knowledge management" agent with
scheduled heartbeat tasks for:

1. **Chat log extraction**: Process `chat_log` entries, extract structured knowledge
2. **Proactive enrichment**: Add tags and context to new entries
3. **Duplicate cleanup**: Merge near-duplicate entries
4. **Supersession detection**: Identify and handle outdated decisions
5. **Staleness review**: Flag old entries for validation

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  OpenClaw Gateway                        │
├─────────────────────────────────────────────────────────┤
│  experimental-memory plugin                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Agent Tools │  │ CLI Commands│  │ auto-capture    │  │
│  │ xmem_*      │  │ openclaw    │  │ hook            │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                   │           │
│         └────────────────┼───────────────────┘           │
│                          ▼                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   Store Layer                      │  │
│  │  • Embedding (OpenAI)                              │  │
│  │  • Vector storage (LanceDB)                        │  │
│  │  • Deduplication                                   │  │
│  │  • Scoring                                         │  │
│  └───────────────────────────────────────────────────┘  │
│                          ▼                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │              LanceDB (local columnar DB)           │  │
│  │              ~/.openclaw/memory/experimental/      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Requirements

- OpenClaw 2026.2.x or later
- Node.js 20+
- OpenAI API key (for embeddings)

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
