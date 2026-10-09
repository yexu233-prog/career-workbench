import type { HealthResponse, RuntimeCapabilities } from "@career-workbench/shared";

export async function readRuntimeCapabilities(): Promise<RuntimeCapabilities | undefined> {
  const response = await fetch("/api/health", { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("本机运行环境暂不可读取");
  const health = await response.json() as HealthResponse;
  return health.runtime;
}

/** A failed capability lookup must never stop local database/manual functionality. */
export async function initializeRuntimeDisplay(): Promise<void> {
  try {
    const runtime = await readRuntimeCapabilities();
    if (runtime && ["windows", "macos", "unsupported"].includes(runtime.platform)) document.documentElement.dataset.platform = runtime.platform;
  } catch { /* The settings diagnostics can explain a disconnected service later. */ }
}
