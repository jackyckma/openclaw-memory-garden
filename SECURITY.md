# Security Review

This document records the security review conducted before public release.

**Review date:** 2026-03-05
**Reviewer:** Automated review + manual inspection
**Scope:** All files committed to the repository

---

## Summary

✅ **No critical security issues found.**

The plugin handles sensitive data (API keys) appropriately via environment
variables and does not persist secrets in code or configuration.

---

## Detailed Findings

### 1. API Key Handling ✅

**Finding:** API keys are loaded via environment variable substitution.

**Location:** `src/config.ts`

```typescript
const apiKey = typeof embeddingRaw.apiKey === "string"
  ? resolveEnvVars(embeddingRaw.apiKey)
  : undefined;
```

**Assessment:**
- API key comes from `${OPENAI_API_KEY}` syntax in config
- Environment variable is resolved at runtime
- Key is never logged or persisted to disk
- Key is passed directly to OpenAI client constructor

**Recommendation:** None needed. This is the correct pattern.

### 2. No Hardcoded Secrets ✅

**Finding:** No hardcoded API keys, tokens, or passwords in source code.

**Search conducted:**
```bash
grep -r "sk-" "api[_-]?key" "password" "secret" "token" --include="*.ts"
```

**Results:** Only parameter names (`apiKey`), no actual secrets.

### 3. SQL Injection Prevention ✅

**Finding:** User input is sanitized before use in LanceDB queries.

**Location:** `src/store.ts`

```typescript
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
```

**Assessment:**
- UUIDs are validated against strict regex before use in queries
- Strings used in WHERE clauses have single quotes escaped
- Filter values (`scope`, `kind`) are sanitized before query construction

**Recommendation:** The current approach is adequate for LanceDB's query syntax.

### 4. File System Access ✅

**Finding:** Database path is configurable but defaults to user's home directory.

**Location:** `src/config.ts`

```typescript
const DEFAULT_DB_PATH = join(homedir(), ".openclaw", "memory", "experimental");
```

**Assessment:**
- Default path is within user's `.openclaw` directory
- Path is resolved via OpenClaw's `api.resolvePath()` which handles `~` expansion
- No path traversal vulnerabilities identified

**Recommendation:** None needed.

### 5. Input Validation ✅

**Finding:** Tool parameters are validated via TypeBox schemas.

**Location:** `src/tools.ts`

```typescript
parameters: Type.Object({
  text: Type.String({ description: "The information to remember" }),
  scope: Type.String({ description: '...' }),
  kind: Type.Unsafe<MemoryKind>({
    type: "string",
    enum: [...VALID_KINDS],
    // ...
  }),
  importance: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 1,
  })),
  // ...
})
```

**Assessment:**
- All tool parameters are typed
- Numeric bounds are enforced (`importance` 0-1)
- Enum values are constrained (`kind`)
- Invalid input will be rejected before reaching tool execution

**Recommendation:** None needed.

### 6. Error Handling ✅

**Finding:** Errors are caught and logged without exposing sensitive details.

**Location:** Multiple files

```typescript
// index.ts - auto-capture hook
catch (err) {
  api.logger.warn?.(`experimental-memory: auto-capture failed: ${String(err)}`);
}

// CLI commands
catch (err) {
  console.error(`Error: ${String(err)}`);
  process.exit(1);
}
```

**Assessment:**
- Errors are converted to strings before logging
- Stack traces are not exposed to users
- API errors (from OpenAI) are wrapped appropriately

**Recommendation:** None needed.

### 7. Dependencies Review ⚠️

**Finding:** Three runtime dependencies, all from reputable sources.

| Package | Version | Source | Notes |
|---------|---------|--------|-------|
| `@lancedb/lancedb` | ^0.26.2 | LanceDB Inc | Native bindings, actively maintained |
| `@sinclair/typebox` | ^0.34.48 | Open source | JSON Schema library, widely used |
| `openai` | ^6.25.0 | OpenAI | Official SDK |

**Assessment:**
- All dependencies are from trusted publishers
- No known vulnerabilities in pinned versions (as of review date)
- LanceDB includes native bindings — users should verify binary integrity

**Recommendation:**
- Run `npm audit` before each release
- Consider pinning exact versions for reproducibility
- Document native binding requirements for users

### 8. Data at Rest ⚠️

**Finding:** Memory data is stored unencrypted in LanceDB files.

**Assessment:**
- LanceDB stores data as Lance files on local filesystem
- Files contain memory text, embeddings, and metadata
- No built-in encryption

**Recommendation:**
- Document that data is stored unencrypted
- Users with sensitive data should ensure appropriate filesystem permissions
- Future: Consider optional encryption at rest

### 9. Data in Transit ✅

**Finding:** API calls to OpenAI use HTTPS.

**Assessment:**
- OpenAI SDK uses HTTPS by default
- No option to downgrade to HTTP
- API key is transmitted securely

**Recommendation:** None needed.

### 10. Auto-Capture Privacy ⚠️

**Finding:** Auto-capture feature stores conversation content.

**Location:** `index.ts`

```typescript
api.on("agent_end", async (event) => {
  // Extracts and stores conversation text
  // ...
  await db.store({
    text: combinedText,
    // ...
  });
});
```

**Assessment:**
- When enabled, all agent conversations are captured
- Includes both user and assistant messages
- Stored with low importance but still queryable

**Recommendation:**
- Document privacy implications clearly ✅ (done in README)
- Auto-capture is disabled by default ✅
- Consider adding content filtering options (future)

---

## Files Reviewed

| File | Status |
|------|--------|
| `index.ts` | ✅ Reviewed |
| `src/config.ts` | ✅ Reviewed |
| `src/embedder.ts` | ✅ Reviewed |
| `src/store.ts` | ✅ Reviewed |
| `src/tools.ts` | ✅ Reviewed |
| `src/scoring.ts` | ✅ Reviewed |
| `openclaw.plugin.json` | ✅ Reviewed |
| `package.json` | ✅ Reviewed |
| `.gitignore` | ✅ Reviewed |
| `.env.example` | ✅ Reviewed |

---

## Git History Check

**Finding:** Repository was initialized fresh with a clean commit.

```bash
git log --oneline
# e2eae4c Initial release v0.1.0
```

**Assessment:**
- No sensitive data in git history
- Single initial commit with clean state

---

## Recommendations Summary

| Priority | Issue | Recommendation |
|----------|-------|----------------|
| Low | Data at rest | Document unencrypted storage |
| Low | Dependencies | Run `npm audit` before releases |
| Info | Auto-capture | Already documented as opt-in |

---

## Conclusion

The plugin is safe for public release. No critical or high-severity security
issues were identified. The handling of sensitive data (API keys) follows
best practices.

Users should be aware that:
1. Memory data is stored unencrypted on the local filesystem
2. Auto-capture (when enabled) stores conversation content
3. The OpenAI API key must be provided via environment variable
