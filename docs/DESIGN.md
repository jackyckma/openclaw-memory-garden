# Design Philosophy & Architecture

This document explains the thinking behind openclaw-memory-granular — why it
exists, what problems it solves, and how it approaches them differently.

---

## The Problem with AI Agent Memory

Most AI agent memory systems share a common architecture:

1. **Store everything** — every conversation, every fact
2. **Embed everything** — turn text into vectors
3. **Retrieve by similarity** — find the closest matches

This works for simple cases but breaks down as the memory grows:

### Problem 1: Information Overload

When you store 10,000 memories, a similarity search returns the top 10... but
are those 10 actually the most *useful*? Often they're just the most textually
similar, not the most important.

**Example:** You stored "I prefer dark mode" a year ago. You also stored 500
conversations about UI design since then. When you ask about preferences, the
old preference is buried under newer, more verbose entries.

### Problem 2: No Structure

A flat list of memories has no organization. You can't easily:
- Find all decisions (vs all facts vs all preferences)
- Scope memories to a project or agent
- Distinguish between "definitely true" and "might be outdated"
- Navigate from a decision to its supporting evidence

### Problem 3: Stale Information

Facts change. Decisions get reversed. But vector similarity doesn't know this.
The old "we use MySQL" decision scores just as high as the new "we switched to
Postgres" decision — now you have contradictory information polluting your
context.

### Problem 4: Extraction Cost

Some systems run LLM extraction on every message: "What facts should we
remember from this?" That's expensive, slow, and often overkill — most
messages don't contain memorable information.

---

## Our Approach

We designed this plugin around four principles:

### 1. Typed, Scoped Memories

Every memory has:
- **Kind**: What type of information is this? (`preference`, `decision`,
  `fact`, `learning`, `external`)
- **Scope**: Who should see this? (`global`, `agent:sophie`, `project:blog`)
- **Importance**: How critical is this? (0.0 to 1.0)

This lets you:
- Search for "decisions about databases" (filtered by kind)
- Keep agent-specific knowledge separate (filtered by scope)
- Surface important information first (weighted by importance)

### 2. Importance-Weighted Scoring

Our scoring formula:

```
final_score = w_relevance × similarity + w_importance × importance
```

Where `w_relevance = 1.0` and `w_importance = 0.3`.

**Why no time decay?** Traditional memory systems penalize old information —
the assumption is that recent = relevant. But for AI agents, a preference from
6 months ago is often more valuable than a debug log from yesterday.

Instead of automatic decay, we use **explicit supersession**: when a decision
changes, you (or a gardening agent) mark the old one as superseded. Old but
valid information stays high-ranked.

### 3. Hot Path vs Cold Path

We separate "fast, cheap operations" from "slow, expensive operations":

**Hot path (no LLM cost):**
- Storing a memory → just embedding + database write
- Searching → just embedding + vector query + scoring
- Listing, getting, deleting → pure database operations

**Cold path (LLM-powered, batch):**
- Extracting facts from conversations → LLM reasoning
- Detecting superseded decisions → LLM comparison
- Enriching entries with tags → LLM classification
- Cleaning up duplicates → LLM similarity judgment

The hot path runs during every agent interaction. The cold path runs during
scheduled "gardening" — a dedicated agent processes the memory store during
quiet hours.

### 4. Hierarchical Drill-Down

Memories can form parent-child relationships:

```
Decision: "We use LanceDB for experimental memory"
  └── Fact: "LanceDB is a columnar vector database"
  └── Fact: "DB path is ~/.openclaw/memory/experimental"
  └── Fact: "Uses OpenAI embeddings for vector search"
```

When an agent searches and finds the decision, they can **drill down** to get
supporting facts. This keeps search results concise while preserving access to
full context.

---

## Memory Gardening

The key innovation in this system is treating memory maintenance as a
**separate concern** handled by a dedicated agent.

### What Gardening Does

1. **Chat log extraction**: Raw conversations are captured with low importance.
   A gardening agent periodically reads them, extracts meaningful facts and
   decisions, and stores them as proper entries.

2. **Proactive enrichment**: New entries (especially from external sources) get
   enriched with topic tags, adjusted importance, and linked to related
   memories.

3. **Supersession detection**: When two decisions contradict each other (e.g.,
   "we use MySQL" vs "we switched to Postgres"), the gardener identifies the
   older one and marks it as superseded.

4. **Duplicate cleanup**: Near-identical memories are merged, keeping the
   higher-importance version.

5. **Staleness review**: Old entries are periodically reviewed — still valid?
   Confirm. Outdated? Demote or delete.

### Why a Separate Agent?

This design is inspired by how humans manage knowledge:

- **In the moment**: You jot down quick notes without overthinking organization
- **Later**: You review, organize, cross-reference, and clean up

The "jotting down" is cheap and fast (hot path). The "review and organize" is
thoughtful and can use more powerful tools (cold path with LLM).

By separating these, we:
- Keep agent interactions fast (no LLM overhead on every message)
- Allow sophisticated maintenance without blocking normal operation
- Make gardening logic replaceable — you can swap in a different strategy

---

## Comparison with Alternatives

### vs OpenClaw's Built-in memory-lancedb

| Aspect | memory-lancedb | This plugin |
|--------|----------------|-------------|
| Scoring | Pure similarity | Similarity + importance |
| Types | None | kind, scope |
| Hierarchy | Flat | Parent-child links |
| Gardening | None | Designed for it |
| Time decay | None | Explicit supersession |

We designed this to run **in parallel** with memory-lancedb so you can test
both and compare results.

### vs External Memory Services (Zep, Mem0, etc.)

| Aspect | External services | This plugin |
|--------|-------------------|-------------|
| Hosting | Cloud/self-hosted | Local (embedded) |
| Cost | Usage-based | Just embedding API |
| Privacy | Data leaves machine | Data stays local |
| Control | API constraints | Full code access |
| Complexity | Simple integration | More setup |

We chose embedded storage (LanceDB) because:
- No additional infrastructure to manage
- Data never leaves the machine
- Easy to inspect, backup, migrate

### vs RAG Systems (LangChain, LlamaIndex)

Those are frameworks for building retrieval pipelines. This plugin is a
**specific implementation** of agent memory with opinions about structure,
scoring, and maintenance.

---

## Schema Design

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `text` | string | The memory content (kept short, atomic) |
| `vector` | float[1536] | Embedding vector |
| `scope` | string | Visibility: `global`, `agent:<id>`, `project:<id>` |
| `kind` | string | Type: `preference`, `decision`, `fact`, `learning`, `external`, `chat_log`, `topic_thread` |
| `importance` | float | 0.0-1.0, affects retrieval ranking |
| `createdAt` | timestamp | When first stored |
| `updatedAt` | timestamp | When last modified |
| `metadata` | JSON | Flexible extensions (parentId, tags, etc.) |

### Why `metadata` as JSON?

We considered adding explicit columns for `parentId`, `tags`, `validFrom`,
`validTo`, etc. But:

1. **Schema churn**: Every new field requires migration
2. **Unknown future needs**: We can't predict all metadata types
3. **Query patterns**: Most filtering is on `scope` and `kind`, not metadata

The tradeoff: metadata fields can't be filtered in LanceDB queries — we filter
them in JavaScript after retrieval. This is acceptable at small-to-medium
scale (thousands of memories). If you reach millions, consider promoting
frequently-filtered fields to columns.

### Granularity (Implicit)

We don't have an explicit `granularity` column. Instead, granularity is
inferred from `kind`:

- **Coarse**: `decision`, `preference` — high-level, inject into prompts
- **Medium**: `fact`, `learning` — retrieved when needed
- **Fine**: `external`, `chat_log` — reachable but not auto-injected

If you need explicit granularity control, you can add it to `metadata`.

---

## Tool Design

We follow a principle of **tool minimalism**: fewer tools with clear,
non-overlapping purposes.

| Tool | Purpose | When to use |
|------|---------|-------------|
| `xmem_store` | Add a memory | You have info worth remembering |
| `xmem_search` | Find relevant memories | You need context for a task |
| `xmem_list` | Browse recent entries | Audit, debugging, overview |
| `xmem_get` | Get full entry by ID | You know the exact entry |
| `xmem_update` | Modify existing entry | Correction, importance change |
| `xmem_delete` | Remove entry | Cleanup, supersession |
| `xmem_related` | Find children | Drill-down for details |

### Why Separate Tools?

Some systems combine store/update into one "upsert" tool. We kept them
separate because:

1. **Clarity**: Store = create new, Update = modify existing
2. **Error prevention**: Accidentally creating a new entry (vs updating) is a
   common mistake
3. **Audit**: Easier to track what actually happened

### Optional Registration

All tools are registered with `{ optional: true }`. This means agents must
explicitly opt-in via `tools.allow: ["experimental-memory"]` in their config.
This prevents tool proliferation — only agents that need memory tools get them.

---

## Future Directions

### Explicit Granularity Column

If the implicit mapping (kind → granularity) proves limiting, we can add
`granularity` as a first-class column without breaking existing data.

### Hybrid Retrieval

Currently we use pure vector search. Future versions could add:
- BM25 keyword search (for exact phrase matching)
- Fusion scoring (combine vector + keyword)
- Reranking (cross-encoder for top results)

### Multi-Agent Knowledge Sharing

Currently, scopes provide basic isolation. Future work could add:
- Knowledge export/import between agents
- Shared knowledge graphs with provenance tracking
- Conflict resolution when agents disagree

### Memory Compaction

For very large memory stores, we could add automatic summarization:
- Group related facts into summaries
- Archive raw entries, keep summaries active
- Maintain links for drill-down

---

## Contributing

This is an active project. We welcome:

- **Design discussions**: Is our approach sound? What are we missing?
- **Use case reports**: How are you using agent memory? What doesn't work?
- **Code contributions**: Bug fixes, new features, documentation

Open an issue or PR to get involved.
