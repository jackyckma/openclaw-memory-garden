# Dependencies

This document explains the plugin's dependencies, why they're needed, and
important considerations for each.

---

## Runtime Dependencies

### @lancedb/lancedb (^0.26.2)

**Purpose:** Embedded vector database for storing and searching memories.

**Why this package:**
- Embedded (no separate server to run)
- Native performance via Rust bindings
- Built on Apache Arrow for efficient columnar storage
- Supports vector search out of the box

**Important notes:**
- **Native bindings:** This package includes platform-specific binaries. During
  `npm install`, it downloads binaries for your OS/architecture.
- **Supported platforms:** Linux (x64, arm64), macOS (x64, arm64), Windows (x64)
- **Troubleshooting:** If binaries fail to download, check
  [LanceDB documentation](https://lancedb.github.io/lancedb/)

**Data format:**
- Stores data as `.lance` files in the configured `dbPath`
- Files are portable across machines with the same architecture
- No external database server required

---

### @sinclair/typebox (^0.34.48)

**Purpose:** JSON Schema type validation for tool parameters.

**Why this package:**
- Used by OpenClaw for tool parameter validation
- Provides TypeScript-first schema definitions
- Generates JSON Schema compatible output

**Important notes:**
- Zero runtime dependencies
- Pure TypeScript, no native code
- Must match the version used by OpenClaw core for type compatibility

---

### openai (^6.25.0)

**Purpose:** Generate embeddings via OpenAI's API.

**Why this package:**
- Official OpenAI SDK
- Handles authentication, retries, and errors
- Supports all OpenAI embedding models

**Important notes:**
- Requires an OpenAI API key with embeddings access
- Default model: `text-embedding-3-small` (1536 dimensions)
- API calls incur costs (~$0.02 per 1M tokens)

**Supported models:**
| Model | Dimensions | Cost | Notes |
|-------|------------|------|-------|
| `text-embedding-3-small` | 1536 | $0.02/1M tokens | Default, good balance |
| `text-embedding-3-large` | 3072 | $0.13/1M tokens | Higher quality |
| `text-embedding-ada-002` | 1536 | $0.10/1M tokens | Legacy |

**Changing models:**
If you change the embedding model, you must re-embed all existing memories
(or create a new database). Different models produce incompatible vectors.

---

## Peer Dependencies

### openclaw/plugin-sdk (provided by OpenClaw)

**Purpose:** Type definitions for the plugin API.

**Why this package:**
- Provides `OpenClawPluginApi` interface
- Enables proper TypeScript typing
- Not installed separately — imported from OpenClaw runtime

**Important notes:**
- Only used for types (compile-time)
- No runtime dependency
- Plugin must be run within OpenClaw gateway

---

## Development Dependencies

None required. The plugin uses TypeScript but OpenClaw runs `.ts` files
directly via its built-in loader (tsx/jiti).

If you want to add development tooling:

```bash
# Optional: TypeScript for type checking
npm install -D typescript

# Optional: ESLint for linting
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

---

## Dependency Management

### Pinning Strategy

We use caret ranges (`^`) for flexibility:
- `^0.26.2` allows 0.26.x updates (patch and minor)
- This matches OpenClaw's dependency strategy

For stricter reproducibility, you can pin exact versions:

```json
{
  "dependencies": {
    "@lancedb/lancedb": "0.26.2",
    "@sinclair/typebox": "0.34.48",
    "openai": "6.25.0"
  }
}
```

### Updating Dependencies

Before updating:
1. Check OpenClaw's current versions (match LanceDB and TypeBox)
2. Test thoroughly — LanceDB updates may affect data format
3. Run `npm audit` to check for vulnerabilities

```bash
# Check for updates
npm outdated

# Update to latest within range
npm update

# Check for vulnerabilities
npm audit
```

### Version Compatibility

| This Plugin | OpenClaw | LanceDB | Notes |
|-------------|----------|---------|-------|
| 0.1.0 | 2026.2.x | 0.26.x | Initial release |

---

## Installation Troubleshooting

### LanceDB Binary Issues

**Symptom:** `Error: Could not find LanceDB binary`

**Solutions:**
1. Ensure you're on a supported platform (Linux/macOS/Windows x64 or arm64)
2. Try reinstalling: `rm -rf node_modules && npm install`
3. Check network — binaries are downloaded from GitHub releases
4. On corporate networks, check if the download URL is blocked

### TypeBox Version Mismatch

**Symptom:** Type errors when registering tools

**Solutions:**
1. Check OpenClaw's TypeBox version: `npm ls @sinclair/typebox`
2. Match your version to OpenClaw's
3. Clear node_modules and reinstall

### OpenAI Connection Issues

**Symptom:** `Error: Connection refused` or timeout

**Solutions:**
1. Verify API key is set: `echo $OPENAI_API_KEY`
2. Check OpenAI status: https://status.openai.com
3. For corporate networks, check if api.openai.com is accessible
4. Consider using a proxy (configure via `HTTPS_PROXY` env var)

---

## Security Considerations

### Supply Chain

All dependencies are from trusted sources:
- `@lancedb/lancedb` — LanceDB Inc (VC-backed company)
- `@sinclair/typebox` — Well-established open source project
- `openai` — OpenAI's official SDK

### Binary Verification

LanceDB downloads native binaries. To verify integrity:
1. Check that binaries come from `github.com/lancedb/lancedb` releases
2. Binaries are signed and checksummed
3. For high-security environments, consider building from source

### Lockfile

The `package-lock.json` file ensures reproducible installs:
- Pins exact versions of all transitive dependencies
- Includes integrity hashes for verification
- Should be committed to version control

---

## Future Considerations

### Alternative Embedding Providers

The plugin currently requires OpenAI. Future versions may support:
- Local embeddings (via Ollama)
- Other cloud providers (Cohere, Google, etc.)
- Custom embedding endpoints

### Alternative Vector Stores

LanceDB is embedded and simple. For scale, alternatives include:
- Qdrant (self-hosted or cloud)
- Pinecone (cloud)
- Milvus (self-hosted)

These would require significant changes to the store layer.
