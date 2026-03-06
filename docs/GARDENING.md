# Memory Gardening Guide

Memory gardening is the process of maintaining and improving your memory store
over time. This is where the "cold path" LLM work happens — extraction,
enrichment, cleanup, and organization.

---

## Philosophy

The core insight: **not all memory work should happen in real-time.**

During agent interactions, we want fast, cheap operations:
- Store a memory → embedding + write (milliseconds)
- Search memories → embedding + query (milliseconds)

But some tasks need careful reasoning:
- "Is this new decision contradicting an old one?"
- "What facts can we extract from this conversation?"
- "Should this entry be linked to that topic thread?"

These are perfect for **batch processing** — a dedicated agent reviews the
memory store during quiet hours, using LLM reasoning where it adds value.

---

## Gardening Tasks

### 1. Chat Log Extraction (Daily)

Raw conversations are auto-captured with `kind: "chat_log"` and low importance
(0.1). A gardening agent processes these:

**Process:**
1. List unprocessed chat_logs (`metadata.processed: false`)
2. For each log, use LLM to extract:
   - Decisions made ("we will use X")
   - Facts learned ("the server is at Y")
   - Preferences expressed ("I prefer Z")
   - Lessons discovered ("we found that W")
3. Store extracted items with appropriate kind, importance, and parent links
4. Mark the chat_log as processed

**Example extraction prompt:**
```
Read this conversation and extract any information worth remembering long-term.

For each item, identify:
- Type: decision, fact, preference, or learning
- Importance: 0.5 (routine) to 0.9 (critical)
- The atomic, self-contained text to store

Skip: greetings, small talk, temporary debugging context, information that
only matters for this conversation.

Conversation:
{chat_log_text}
```

### 2. Proactive Enrichment (Daily)

New entries often have minimal metadata. A gardening agent can enrich them:

**For external articles:**
- Add topic tags (`["vibe-coding", "ai-agents", "developer-tools"]`)
- Assess importance based on relevance to ongoing projects
- Note author, publication date, perspective

**For other entries:**
- Check if scope and importance are appropriate
- Add cross-references to related memories
- Suggest parent-child links

### 3. Duplicate Cleanup (Weekly)

Near-identical memories waste space and create noise.

**Process:**
1. For each recent entry, search for similar entries (>85% similarity)
2. If found: keep the one with higher importance, delete the other
3. Log what was merged

**Heuristic:** Two memories are duplicates if:
- Similarity > 0.85
- Same kind
- One is clearly more complete than the other

### 4. Supersession Detection (Weekly)

Decisions and preferences change over time. Old entries should be demoted.

**Process:**
1. Focus on `decision` and `preference` kinds
2. Search for entries addressing the same topic
3. If a newer entry contradicts an older one:
   - Lower the old entry's importance to 0.1, OR
   - Delete it entirely, OR
   - Add `supersededBy` to its metadata
4. If uncertain, flag for human review (don't delete)

**Example contradiction:**
- Old: "We use MySQL for the database" (2025-01)
- New: "We switched to PostgreSQL" (2026-02)

The new entry supersedes the old one. The old entry gets demoted or deleted.

### 5. Staleness Review (Monthly)

Entries not touched in 60+ days should be reviewed.

**Process:**
1. List entries sorted by `updatedAt`, oldest first
2. For each stale entry, assess:
   - Still valid? → Touch it (update with current timestamp)
   - Outdated? → Lower importance or delete
   - Uncertain? → Flag for human review

**What makes something stale:**
- Time-sensitive facts (API endpoints, version numbers)
- Decisions about evolving systems
- References to completed projects

**What's NOT stale:**
- Stable preferences ("I prefer dark mode")
- Permanent facts ("LanceDB is a columnar database")
- Historical decisions (useful as context)

### 6. Topic Thread Linking

Conversations about the same project span multiple days/weeks. Topic threads
provide continuity.

**Process:**
1. When extracting from a chat_log, identify the main topic
2. Search for existing `topic_thread` entries
3. If a relevant thread exists (>70% semantic similarity), link to it
4. If not, create a new topic_thread

**Topic thread structure:**
```json
{
  "text": "Experimental memory system development",
  "kind": "topic_thread",
  "scope": "global",
  "importance": 0.8,
  "metadata": {
    "status": "active",
    "startDate": "2026-03-01",
    "relatedChatLogs": ["uuid1", "uuid2", "uuid3"]
  }
}
```

Extracted facts/decisions link back via `parentId`.

---

## Implementation Approaches

### Approach A: HEARTBEAT.md Integration

Add gardening tasks to a knowledge management agent's heartbeat schedule.

**Pros:**
- Uses existing OpenClaw infrastructure
- No additional setup
- Agent can use judgment and adapt

**Cons:**
- Relies on heartbeat actually running
- Limited to agent's available tools

**Example HEARTBEAT.md section:**
```markdown
## Daily Tasks

### Chat Log Extraction
1. Use `xmem_list --kind chat_log` to find unprocessed logs
2. For each log, extract facts/decisions/preferences
3. Store with appropriate kind and link to topic_thread
4. Mark as processed via `xmem_update`
```

### Approach B: Scheduled Scripts

Run gardening as cron jobs that invoke the agent.

**Pros:**
- Guaranteed execution
- Can run at specific times
- Decoupled from agent heartbeat

**Cons:**
- More infrastructure to manage
- Agent invocation overhead

**Example cron:**
```bash
# Daily at 3 AM
0 3 * * * openclaw agent --agent sophie --message "Run chat log extraction"

# Weekly on Sunday at 2 AM
0 2 * * 0 openclaw agent --agent sophie --message "Run duplicate cleanup and supersession detection"
```

### Approach C: On-Demand

Trigger gardening manually when needed.

**Pros:**
- Full control over timing
- Good for testing
- No automation overhead

**Cons:**
- Relies on human remembering
- Memory can get messy if neglected

**Example:**
```
User: Sophie, process recent chat logs
Sophie: [runs extraction, reports results]
```

---

## Gardening State

Track what's been done to avoid redundant work.

**File: `gardening-state.json`**
```json
{
  "lastRun": {
    "chatLogExtraction": "2026-03-05T03:15:00Z",
    "duplicateCleanup": "2026-03-03T02:00:00Z",
    "supersessionDetection": "2026-03-03T02:30:00Z",
    "stalenessReview": "2026-03-01T04:00:00Z"
  },
  "stats": {
    "chatLogsProcessed": 47,
    "knowledgeExtracted": 123,
    "duplicatesRemoved": 8,
    "entriesSuperseded": 3
  }
}
```

**Chat log tracking:**
Each `chat_log` entry has `metadata.processed: true/false`. The extraction
task only processes unprocessed logs, creating natural checkpointing.

---

## Example Gardening Session

Here's what a gardening agent might do during a daily run:

```
1. Check gardening-state.json
   → Last extraction: 23 hours ago, time to run

2. xmem_list --kind chat_log
   → Found 3 unprocessed logs from today

3. For each log:
   a. xmem_get <log_id>
   b. Read conversation, extract knowledge
   c. Search for existing topic_thread
   d. Store extracted entries with parentId link
   e. xmem_update <log_id> metadata.processed=true

4. xmem_list --limit 20 (recent entries)
   → Check for obvious duplicates or issues

5. Update gardening-state.json with results

6. Log summary to daily notes:
   "Processed 3 chat_logs, extracted 7 entries (2 decisions, 4 facts, 1 preference)"
```

---

## Best Practices

### Do

- **Run extraction daily** — chat logs pile up quickly
- **Be conservative with deletion** — demote importance instead when unsure
- **Log all actions** — gardening should be auditable
- **Use topic threads** — they provide valuable continuity
- **Review periodically** — automated gardening isn't perfect

### Don't

- **Over-extract** — not every sentence is worth remembering
- **Delete without checking** — supersession can be subtle
- **Ignore errors** — failed extractions should be retried
- **Run too frequently** — daily is enough for most cases
- **Trust blindly** — spot-check gardening results

---

## Metrics to Track

Good gardening improves memory quality over time. Track:

| Metric | What it tells you |
|--------|-------------------|
| Chat logs processed / pending | Are you keeping up? |
| Entries per chat log | Extraction granularity |
| Duplicates found | Is dedup working? |
| Supersessions detected | Is contradiction handling working? |
| Average importance | Is scoring calibrated? |
| Search result quality | Is retrieval improving? |

---

## Troubleshooting

### "Extraction is finding too much/too little"

Adjust your extraction prompt. Too much → add "only extract information worth
remembering long-term." Too little → remove restrictive filters.

### "Duplicates keep appearing"

Check your similarity threshold. 0.85 might be too low (merging distinct
entries) or too high (missing duplicates). Test with specific examples.

### "Topic threads aren't linking correctly"

Review your thread matching logic. 70% similarity might need adjustment. Or
the threads might need better summary text.

### "Old entries aren't being superseded"

Supersession detection requires understanding context. Consider adding
specific rules: "When a decision explicitly says 'we switched from X to Y',
mark entries about X as superseded."

---

## Future Improvements

- **Confidence scoring**: Track how confident the gardener is about each action
- **Human-in-the-loop**: Flag uncertain decisions for review
- **Cross-agent gardening**: Let multiple agents contribute to maintenance
- **Automatic summarization**: Compress old entries while preserving meaning
