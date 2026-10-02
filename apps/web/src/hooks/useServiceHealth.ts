import { useEffect, useState } from "react";
import type { HealthResponse } from "@career-workbench/shared";

type ServiceState = "checking" | "online" | "offline";

export function useServiceHealth(): ServiceState {
  const [state, setState] = useState<ServiceState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`健康检查失败：${response.status}`);
        }
        return (await response.json()) as HealthResponse;
      })
      .then((health) => setState(health.status === "ok" ? "online" : "offline"))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState("offline");
      });

    return () => controller.abort();
  }, []);

  return state;
}

