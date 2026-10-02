import { describe, expect, it } from "vitest";
import { localServiceError, storageErrorMessage } from "./user-errors";

describe("user-facing failures", () => {
  it("gives safe actions for storage quota and database access errors", () => {
    expect(storageErrorMessage(new DOMException("full", "QuotaExceededError"))).toContain("尚未保存");
    expect(storageErrorMessage(new DOMException("blocked", "SecurityError"))).toContain("本机数据");
    expect(storageErrorMessage(new Error("internal stack"))).not.toContain("internal stack");
  });

  it("explains a disconnected local service without exposing technical details", () => {
    expect(localServiceError(new TypeError("fetch failed"), "使用 AI 服务").message).toContain("启动求职工作台");
    expect(localServiceError(new TypeError("fetch failed"), "使用 AI 服务").message).not.toContain("fetch failed");
  });
});
