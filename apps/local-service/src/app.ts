import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import type { AiServiceConfigInput, AiServiceStatus, AiTaskRequest, HealthResponse, PdfRenderRequest, PdfServiceStatus } from "@career-workbench/shared";
import { AI_PROVIDERS, AI_TASK_TYPES, API_VERSION, APP_NAME, APP_VERSION, LOCAL_HOST, LOCAL_PORT, type AiProvider } from "@career-workbench/shared";
import { callAi } from "./ai/adapter.js";
import { MemoryAiConfigStore, WindowsDpapiAiConfigStore, type AiConfigStore, type StoredAiConfig } from "./ai/config-store.js";
import { EdgePdfRenderer, PdfRenderError, type PdfRenderer } from "./pdf/edge-renderer.js";

export interface BuildAppOptions {
  controlToken?: string;
  allowDevelopmentOrigin?: boolean;
  onShutdown?: () => void;
  aiConfigStore?: AiConfigStore;
  aiCaller?: typeof callAi;
  pdfRenderer?: PdfRenderer;
  pdfFontPath?: string;
}

function validatePdfRequest(body: unknown): PdfRenderRequest {
  if (!body || typeof body !== "object") throw new Error("PDF 请求格式无效");
  const input = body as Partial<PdfRenderRequest>;
  if (typeof input.requestId !== "string" || input.requestId.length > 100) throw new Error("PDF 请求编号无效");
  if (input.templateId !== "standard-single-column" || (input.templateVersion !== 1 && input.templateVersion !== 2)) throw new Error("当前测试版只支持标准单栏模板");
  if (!Number.isInteger(input.pageCount) || (input.pageCount ?? 0) < 1 || (input.pageCount ?? 0) > 100) throw new Error("PDF 页数无效");
  if (typeof input.html !== "string" || !input.html.includes("resume-pages") || input.html.length > 8_000_000) throw new Error("PDF 正文格式无效或过长");
  if (typeof input.css !== "string" || input.css.length > 200_000) throw new Error("PDF 样式格式无效");
  if (/<script[\s>]/i.test(input.html) || /<\/style/i.test(input.css)) throw new Error("PDF 内容包含不允许的页面指令");
  return input as PdfRenderRequest;
}

function buildPdfHtml(request: PdfRenderRequest): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'self'"><title>简历 PDF</title><style>${request.css}</style></head><body>${request.html}</body></html>`;
}

function validateConfig(body: unknown, current?: StoredAiConfig): StoredAiConfig {
  if (!body || typeof body !== "object") throw new Error("AI 配置格式无效");
  const input = body as Partial<AiServiceConfigInput>;
  if (!AI_PROVIDERS.includes(input.provider as AiProvider)) throw new Error("请选择有效的服务类型");
  const provider = input.provider as AiProvider;
  if (typeof input.baseUrl !== "string" || typeof input.model !== "string" || typeof input.timeoutMs !== "number") throw new Error("AI 配置字段不完整");
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  let parsedUrl: URL;
  try { parsedUrl = new URL(baseUrl); } catch { throw new Error("接口地址格式无效"); }
  if (parsedUrl.username || parsedUrl.password || (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsedUrl.hostname)))) throw new Error("接口地址必须使用 HTTPS；本机兼容服务可使用 localhost HTTP");
  const suppliedApiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : undefined;
  if (current && current.provider !== provider && !suppliedApiKey) throw new Error("切换服务商后请重新输入该服务商的 API Key");
  const apiKey = suppliedApiKey ?? (current && current.provider === provider ? current.apiKey : undefined);
  if (!apiKey) throw new Error("请输入 API Key");
  const model = input.model.trim();
  if (!model || model.length > 100) throw new Error("模型名称无效");
  if (input.timeoutMs < 10_000 || input.timeoutMs > 120_000) throw new Error("超时时间需在 10 到 120 秒之间");
  return { provider, baseUrl, model, timeoutMs: input.timeoutMs, apiKey };
}

function validateTask(body: unknown): AiTaskRequest {
  if (!body || typeof body !== "object") throw new Error("AI 请求格式无效");
  const request = body as Partial<AiTaskRequest>;
  if (typeof request.requestId !== "string" || !AI_TASK_TYPES.includes(request.taskType as never) || request.locale !== "zh-CN") throw new Error("AI 请求字段不完整");
  if (typeof request.userInstructions !== "string" || request.userInstructions.length > 5_000) throw new Error("自定义要求过长");
  const payloadLength = JSON.stringify(request.selectedPayload).length;
  if (payloadLength > 600_000) throw new Error("本次提交内容过长，请缩小数据范围");
  return request as AiTaskRequest;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const aiConfigStore = options.aiConfigStore ?? (process.env.NODE_ENV === "test" ? new MemoryAiConfigStore() : new WindowsDpapiAiConfigStore());
  const aiCaller = options.aiCaller ?? callAi;
  const pdfRenderer = options.pdfRenderer ?? new EdgePdfRenderer();
  const aiClientToken = randomUUID();
  const pdfClientToken = randomUUID();
  const pdfDocuments = new Map<string, string>();
  const pdfJobs = new Map<string, { controller: AbortController; documentId: string }>();
  let aiBusy = false;
  let lastCheck: AiServiceStatus["lastCheck"];
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: 1_048_576,
    trustProxy: false
  });

  app.addHook("onRequest", async (request, reply) => {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    const allowedHosts = new Set([`${LOCAL_HOST}:${LOCAL_PORT}`, `localhost:${LOCAL_PORT}`]);
    if (!allowedHosts.has(request.headers.host ?? "")) {
      await reply.code(403).send({ error: "host_not_allowed" });
      return reply;
    }

    const origin = request.headers.origin;
    const allowedOrigins = new Set([
      `http://${LOCAL_HOST}:${LOCAL_PORT}`,
      `http://localhost:${LOCAL_PORT}`
    ]);
    if (options.allowDevelopmentOrigin) {
      allowedOrigins.add("http://127.0.0.1:5173");
    }
    if (origin && !allowedOrigins.has(origin)) {
      await reply.code(403).send({ error: "origin_not_allowed" });
      return reply;
    }
  });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    appName: APP_NAME,
    appVersion: APP_VERSION,
    apiVersion: API_VERSION,
    timestamp: new Date().toISOString()
  }));

  app.get("/api/pdf/status", async (): Promise<PdfServiceStatus> => {
    const rendererStatus = pdfRenderer.status();
    let fontAvailable = false;
    if (options.pdfFontPath) fontAvailable = await access(options.pdfFontPath).then(() => true).catch(() => false);
    return {
      available: rendererStatus.available,
      ...(rendererStatus.edgeVersion ? { edgeVersion: rendererStatus.edgeVersion } : {}),
      fontAvailable,
      clientToken: pdfClientToken,
      message: rendererStatus.available
        ? `${rendererStatus.message}${fontAvailable ? "，中文字体已就绪" : "，中文字体缺失，将使用系统字体"}`
        : rendererStatus.message
    };
  });

  app.get("/api/pdf/font", async (_request, reply) => {
    if (!options.pdfFontPath) return reply.code(404).send({ error: "font_not_found" });
    try {
      return reply.type("font/otf").header("cache-control", "public, max-age=31536000, immutable").send(await readFile(options.pdfFontPath));
    } catch {
      return reply.code(404).send({ error: "font_not_found" });
    }
  });

  app.get("/api/pdf/document/:id", async (request, reply) => {
    const id = (request.params as { id?: string }).id ?? "";
    const html = pdfDocuments.get(id);
    if (!html) return reply.code(404).type("text/plain").send("PDF render job not found");
    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(html);
  });

  app.delete("/api/pdf/render/:requestId", async (request, reply) => {
    if (request.headers["x-pdf-client-token"] !== pdfClientToken) return reply.code(403).send({ error: "invalid_client_token", message: "PDF 请求凭证已失效，请刷新页面后重试" });
    const requestId = (request.params as { requestId?: string }).requestId ?? "";
    const job = pdfJobs.get(requestId);
    if (!job) return reply.code(404).send({ error: "pdf_not_found", message: "PDF 任务不存在或已结束" });
    job.controller.abort();
    return reply.code(202).send({ status: "cancelling" });
  });

  app.post("/api/pdf/render", { bodyLimit: 12_000_000 }, async (request, reply) => {
    if (request.headers["x-pdf-client-token"] !== pdfClientToken) return reply.code(403).send({ error: "invalid_client_token", message: "PDF 请求凭证已失效，请刷新页面后重试" });
    let renderRequest: PdfRenderRequest;
    try { renderRequest = validatePdfRequest(request.body); }
    catch (error) { return reply.code(400).send({ error: "invalid_pdf_request", message: error instanceof Error ? error.message : "PDF 请求无效" }); }
    if (pdfJobs.size > 0) return reply.code(409).send({ error: "pdf_busy", message: "已有 PDF 正在生成，请稍候" });
    const controller = new AbortController();
    if (pdfJobs.has(renderRequest.requestId)) return reply.code(409).send({ error: "pdf_busy", message: "该 PDF 请求已经在生成中" });
    const jobId = randomUUID();
    pdfDocuments.set(jobId, buildPdfHtml(renderRequest));
    pdfJobs.set(renderRequest.requestId, { controller, documentId: jobId });
    request.raw.once("aborted", () => controller.abort());
    try {
      const pdf = await pdfRenderer.render(`http://${LOCAL_HOST}:${LOCAL_PORT}/api/pdf/document/${jobId}`, { signal: controller.signal });
      return reply.type("application/pdf").header("cache-control", "no-store").header("x-pdf-page-count", String(renderRequest.pageCount)).send(pdf);
    } catch (error) {
      const code = error instanceof PdfRenderError ? error.code : "pdf_render_failed";
      const status = code === "pdf_cancelled" ? 499 : code === "pdf_timeout" ? 504 : 500;
      return reply.code(status).send({ error: code, message: error instanceof Error ? error.message : "PDF 生成失败；正式数据未修改", ...(error instanceof PdfRenderError && error.retryable ? { retryable: true } : {}) });
    } finally {
      pdfDocuments.delete(jobId); pdfJobs.delete(renderRequest.requestId);
    }
  });

  const requireAiToken = (headers: Record<string, unknown>) => headers["x-ai-client-token"] === aiClientToken;

  app.get("/api/ai/status", async (): Promise<AiServiceStatus> => {
    const config = await aiConfigStore.load();
    return {
      configured: Boolean(config), provider: config?.provider ?? "openai", baseUrl: config?.baseUrl ?? "https://api.openai.com/v1",
      model: config?.model ?? "gpt-5.6-luna", timeoutMs: config?.timeoutMs ?? 120_000,
      maskedKey: config ? `••••${config.apiKey.slice(-4)}` : "", clientToken: aiClientToken, ...(lastCheck ? { lastCheck } : {})
    };
  });

  app.post("/api/ai/config", async (request, reply) => {
    if (!requireAiToken(request.headers)) return reply.code(403).send({ error: "invalid_client_token" });
    try { await aiConfigStore.save(validateConfig(request.body, await aiConfigStore.load())); lastCheck = undefined; return reply.send({ status: "saved" }); }
    catch (error) { return reply.code(400).send({ error: "invalid_config", message: error instanceof Error ? error.message : "保存 AI 配置失败" }); }
  });

  app.delete("/api/ai/config", async (request, reply) => {
    if (!requireAiToken(request.headers)) return reply.code(403).send({ error: "invalid_client_token" });
    await aiConfigStore.delete(); lastCheck = undefined; return reply.send({ status: "deleted" });
  });

  const executeTask = async (body: unknown, signal?: AbortSignal) => {
    if (aiBusy) throw new Error("已有 AI 任务正在执行，请稍候");
    const config = await aiConfigStore.load();
    if (!config) throw new Error("请先在设置中配置 AI 服务");
    const task = validateTask(body);
    aiBusy = true;
    try { return await aiCaller(config, task, signal); } finally { aiBusy = false; }
  };

  app.post("/api/ai/test", async (request, reply) => {
    if (!requireAiToken(request.headers)) return reply.code(403).send({ error: "invalid_client_token" });
    try {
      const result = await executeTask({ requestId: randomUUID(), taskType: "analyze-job", locale: "zh-CN", userInstructions: "仅验证连接，简短返回。", outputLanguage: "zh-CN", expressionGoal: "concise", contentLength: "short", selectedPayload: { jdText: "测试连接，不包含个人资料。" } });
      lastCheck = { ok: true, at: new Date().toISOString(), message: `连接正常 · ${result.model}` }; return reply.send(lastCheck);
    } catch (error) { lastCheck = { ok: false, at: new Date().toISOString(), message: error instanceof Error ? error.message : "连接失败" }; return reply.code(400).send(lastCheck); }
  });

  for (const taskType of AI_TASK_TYPES) app.post(`/api/ai/${taskType}`, async (request, reply) => {
    if (!requireAiToken(request.headers)) return reply.code(403).send({ error: "invalid_client_token" });
    try {
      const body = validateTask(request.body);
      if (body.taskType !== taskType) return reply.code(400).send({ error: "task_type_mismatch", message: "AI 任务类型不匹配" });
      const controller = new AbortController();
      request.raw.once("aborted", () => controller.abort());
      return reply.send(await executeTask(body, controller.signal));
    } catch (error) { return reply.code(400).send({ error: "ai_request_failed", message: error instanceof Error ? error.message : "AI 请求失败" }); }
  });

  app.post("/api/system/stop", async (request, reply) => {
    const suppliedToken = request.headers["x-control-token"];
    if (!options.controlToken || suppliedToken !== options.controlToken) {
      return reply.code(403).send({ error: "invalid_control_token" });
    }

    await reply.send({ status: "stopping" });
    setTimeout(() => options.onShutdown?.(), 50);
  });

  return app;
}
