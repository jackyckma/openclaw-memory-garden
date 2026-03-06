import { homedir } from "node:os";
import { join } from "node:path";

export type ExperimentalMemoryConfig = {
  dbPath: string;
  embedding: {
    apiKey: string;
    model: string;
  };
  autoCapture: {
    enabled: boolean;
    maxChars: number;
    retentionDays: number;
  };
};

const DEFAULT_DB_PATH = join(homedir(), ".openclaw", "memory", "experimental");
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_AUTO_CAPTURE_MAX_CHARS = 10000;
const DEFAULT_RETENTION_DAYS = 30;

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

export function parseConfig(raw: unknown): ExperimentalMemoryConfig {
  const cfg = (raw && typeof raw === "object" && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};

  const dbPath = typeof cfg.dbPath === "string" ? cfg.dbPath : DEFAULT_DB_PATH;

  const embeddingRaw = (cfg.embedding && typeof cfg.embedding === "object")
    ? cfg.embedding as Record<string, unknown>
    : {};

  const apiKey = typeof embeddingRaw.apiKey === "string"
    ? resolveEnvVars(embeddingRaw.apiKey)
    : undefined;

  const model = typeof embeddingRaw.model === "string"
    ? embeddingRaw.model
    : DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error(
      "experimental-memory: embedding.apiKey is required. " +
      'Set it in plugin config, e.g. "apiKey": "${OPENAI_API_KEY}"',
    );
  }

  const autoCaptureRaw = (cfg.autoCapture && typeof cfg.autoCapture === "object")
    ? cfg.autoCapture as Record<string, unknown>
    : {};

  const autoCapture = {
    enabled: autoCaptureRaw.enabled === true,
    maxChars: typeof autoCaptureRaw.maxChars === "number"
      ? autoCaptureRaw.maxChars
      : DEFAULT_AUTO_CAPTURE_MAX_CHARS,
    retentionDays: typeof autoCaptureRaw.retentionDays === "number"
      ? autoCaptureRaw.retentionDays
      : DEFAULT_RETENTION_DAYS,
  };

  return { dbPath, embedding: { apiKey, model }, autoCapture };
}
