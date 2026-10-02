import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { MemoryAiConfigStore } from "./ai/config-store.js";
import { PdfRenderError, type PdfRenderer } from "./pdf/edge-renderer.js";

const openApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("local service", () => {
  it("returns application health", async () => {
    const app = buildApp();
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      appName: "求职工作台",
      appVersion: "0.1.0-test",
      apiVersion: "1"
    });
  });

  it("rejects an invalid shutdown token", async () => {
    const app = buildApp({ controlToken: "expected" });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/system/stop",
      headers: { "x-control-token": "wrong" }
    });
    expect(response.statusCode).toBe(403);
  });

  it("keeps API keys out of status responses and requires the browser token", async () => {
    const store = new MemoryAiConfigStore();
    const app = buildApp({ aiConfigStore: store });
    openApps.push(app);
    const status = await app.inject({ method: "GET", url: "/api/ai/status" });
    const token = status.json().clientToken as string;

    const rejected = await app.inject({ method: "POST", url: "/api/ai/config", payload: { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", timeoutMs: 120000, apiKey: "test-key-value" } });
    expect(rejected.statusCode).toBe(403);

    const saved = await app.inject({ method: "POST", url: "/api/ai/config", headers: { "x-ai-client-token": token }, payload: { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", timeoutMs: 120000, apiKey: "test-key-value" } });
    expect(saved.statusCode).toBe(200);
    const configured = await app.inject({ method: "GET", url: "/api/ai/status" });
    expect(configured.body).not.toContain("test-key-value");
    expect(configured.json()).toMatchObject({ configured: true, maskedKey: "••••alue" });
  });

  it("returns AI output as a candidate without touching business data", async () => {
    const store = new MemoryAiConfigStore({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "test-model", timeoutMs: 120000, apiKey: "test-key" });
    const app = buildApp({ aiConfigStore: store, aiCaller: async (config, request) => ({ requestId: request.requestId, status: "ready", result: { title: "候选", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [], provider: config.provider, model: config.model }) });
    openApps.push(app);
    const token = (await app.inject({ method: "GET", url: "/api/ai/status" })).json().clientToken as string;
    const response = await app.inject({ method: "POST", url: "/api/ai/analyze-job", headers: { "x-ai-client-token": token }, payload: { requestId: "request-1", taskType: "analyze-job", locale: "zh-CN", userInstructions: "", outputLanguage: "zh-CN", expressionGoal: "match-jd", contentLength: "standard", selectedPayload: { jdText: "产品经理" } } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requestId: "request-1", status: "ready", result: { title: "候选" } });
  });

  it("keeps PDF HTML temporary and returns renderer bytes", async () => {
    let renderUrl = "";
    const renderer: PdfRenderer = {
      status: () => ({ available: true, edgeVersion: "Mock Edge", message: "PDF 可用" }),
      render: async (url) => { renderUrl = url; return Buffer.from("%PDF-1.7 mock"); }
    };
    const app = buildApp({ pdfRenderer: renderer });
    openApps.push(app);
    const status = await app.inject({ method: "GET", url: "/api/pdf/status" });
    const token = status.json().clientToken as string;
    const rejected = await app.inject({ method: "POST", url: "/api/pdf/render", payload: {} });
    expect(rejected.statusCode).toBe(403);
    const response = await app.inject({
      method: "POST", url: "/api/pdf/render", headers: { "x-pdf-client-token": token },
      payload: { requestId: "pdf-1", templateId: "standard-single-column", templateVersion: 2, pageCount: 1, html: "<div class=\"resume-pages\">测试简历</div>", css: ".resume-pages{}" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.rawPayload.toString()).toContain("%PDF-1.7");
    expect(renderUrl).toContain("/api/pdf/document/");
  });
});
  it("blocks concurrent PDF jobs and supports cancellation", async () => {
    let started!: () => void;
    const renderStarted = new Promise<void>((resolve) => { started = resolve; });
    const renderer: PdfRenderer = {
      status: () => ({ available: true, message: "PDF 可用" }),
      render: async (_url, options) => {
        started();
        return new Promise<Buffer>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new PdfRenderError("pdf_cancelled", "已取消 PDF 生成")), { once: true }));
      }
    };
    const app = buildApp({ pdfRenderer: renderer }); openApps.push(app);
    const token = (await app.inject({ method: "GET", url: "/api/pdf/status" })).json().clientToken as string;
    const payload = { requestId: "pdf-busy-1", templateId: "standard-single-column", templateVersion: 1, pageCount: 1, html: "<div class=\"resume-pages\">测试简历</div>", css: ".resume-pages{}" };
    const first = app.inject({ method: "POST", url: "/api/pdf/render", headers: { "x-pdf-client-token": token }, payload });
    await renderStarted;
    const second = await app.inject({ method: "POST", url: "/api/pdf/render", headers: { "x-pdf-client-token": token }, payload: { ...payload, requestId: "pdf-busy-2" } });
    expect(second.statusCode).toBe(409);
    const cancelled = await app.inject({ method: "DELETE", url: "/api/pdf/render/pdf-busy-1", headers: { "x-pdf-client-token": token } });
    expect(cancelled.statusCode).toBe(202);
    expect((await first).statusCode).toBe(499);
  });

  it("requires a new API key when switching providers and preserves the previous configuration on rejection", async () => {
    const store = new MemoryAiConfigStore({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", timeoutMs: 120_000, apiKey: "openai-key" });
    const app = buildApp({ aiConfigStore: store }); openApps.push(app);
    const token = (await app.inject({ method: "GET", url: "/api/ai/status" })).json().clientToken as string;
    const headers = { "x-ai-client-token": token };
    const missingKey = await app.inject({ method: "POST", url: "/api/ai/config", headers, payload: { provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", timeoutMs: 120_000 } });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().message).toContain("重新输入");
    expect((await store.load())?.provider).toBe("openai");
    expect((await store.load())?.apiKey).toBe("openai-key");

    const switched = await app.inject({ method: "POST", url: "/api/ai/config", headers, payload: { provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", timeoutMs: 120_000, apiKey: "qwen-key" } });
    expect(switched.statusCode).toBe(200);
    expect(await store.load()).toMatchObject({ provider: "qwen", apiKey: "qwen-key", model: "qwen-plus" });
  });
