import { describe, expect, it, vi } from "vitest";
import { callAi, findUnsupportedFactTokens, providerErrorMessage } from "./adapter.js";
import type { AiNetworkRequestInit } from "./network.js";

describe("AI fact checks", () => {
  it("flags numbers introduced without source evidence", () => {
    expect(findUnsupportedFactTokens("项目提升 15%", "项目提升 15%，覆盖 300 人")).toEqual(["300"]);
  });

  it("does not flag numbers already present in the selected payload", () => {
    expect(findUnsupportedFactTokens("2025年完成 3 项任务", "2025年完成 3 项任务")).toEqual([]);
  });

  it("distinguishes exhausted API credit from transient rate limits", () => {
    expect(providerErrorMessage(429, "credit_balance_exhausted", "insufficient_quota")).toContain("没有可用额度");
    expect(providerErrorMessage(429, "rate_limit_exceeded", "requests")).toContain("速率限制");
  });

  it("explains a network failure without writing a candidate", async () => {
    await expect(callAi({ provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "test-model", timeoutMs: 10_000, apiKey: "fake-key" }, { requestId: "offline", taskType: "analyze-job", locale: "zh-CN", userInstructions: "", outputLanguage: "zh-CN", expressionGoal: "concise", contentLength: "short", selectedPayload: { jdText: "虚构岗位" } }, undefined, async () => { throw new TypeError("fetch failed"); })).rejects.toThrow("检查网络");
  });

  it.each([
    { provider: "qwen" as const, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus" },
    { provider: "deepseek" as const, baseUrl: "https://api.deepseek.com", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-flash" },
    { provider: "glm" as const, baseUrl: "https://open.bigmodel.cn/api/paas/v4", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-5.3" }
  ])("uses the JSON object chat format for $provider without strict schema", async (providerConfig) => {
    let endpoint = "";
    let body: Record<string, unknown> | undefined;
    const candidate = { status: "ready", result: { title: "候选", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async (url: string, init: AiNetworkRequestInit) => {
      endpoint = url; body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await callAi({ ...providerConfig, timeoutMs: 10_000, apiKey: "vendor-key" }, { requestId: "vendor", taskType: "analyze-job", locale: "zh-CN", userInstructions: "", outputLanguage: "zh-CN", expressionGoal: "concise", contentLength: "short", selectedPayload: { jdText: "虚构岗位要求" } }, undefined, fetchMock);
    expect(endpoint).toBe(providerConfig.endpoint);
    expect(body?.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body?.messages)).toContain("JSON");
    expect(body?.response_format).not.toHaveProperty("json_schema");
    expect(result).toMatchObject({ status: "ready", provider: providerConfig.provider, model: providerConfig.model, result: { title: "候选" } });
  });

  it("uses only ordered selected experiences for experience based version generation", async () => {
    let body: Record<string, unknown> | undefined;
    const candidate = { status: "ready", result: { title: "", summary: "候选概述", bullets: ["第一段", "第二段"], content: "", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async (_url: string, init: AiNetworkRequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const payload = { experienceBased: true, material: { facts: { role: "产品经理" }, factNotes: "事实笔记" }, experiences: [{ id: "exp-2", name: "第二段经历", content: "第二段正文" }, { id: "exp-1", name: "第一段经历", content: "第一段正文" }], targetRole: "产品经理", jdText: "虚构 JD" };
    await callAi({ provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "experience-version", taskType: "generate-version", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "match-jd", contentLength: "standard", selectedPayload: payload }, undefined, fetchMock);
    const messages = body?.messages as Array<{ role: string; content: string }>;
    const userContent = messages?.[1]?.content ?? "";
    expect(messages?.[0]?.content).toContain("不得参考或复述任何旧版本表达");
    expect(messages?.[0]?.content).toContain("按用户排列顺序");
    expect(userContent.indexOf("第二段经历")).toBeLessThan(userContent.indexOf("第一段经历"));
    expect(userContent).not.toContain("referenceVersion");
  });

  it.each([
    ["analyze-job", { title: "候选", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }],
    ["generate-version", { title: "候选", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }],
    ["generate-interview-note", { title: "候选", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }],
    ["recommend-materials", { recommendations: [] }],
    ["rewrite-resume", { title: "候选", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }],
    ["import-resume", { materials: [] }]
  ] as const)("keeps the %s result as a locally validated candidate", async (taskType, taskResult) => {
    const candidate = { status: "ready", result: taskResult, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await callAi({ provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: `candidate-${taskType}`, taskType, locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "concise", contentLength: "short", selectedPayload: { jdText: "虚构岗位要求", resumeText: "虚构经历", materials: [] } }, undefined, fetchMock);
    expect(result.status).toBe("ready");
    expect(result.provider).toBe("deepseek");
  });

  it("rejects an empty JSON-compatible provider response with a clear non-write message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(callAi({ provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "empty", taskType: "analyze-job", locale: "zh-CN", userInstructions: "", outputLanguage: "zh-CN", expressionGoal: "concise", contentLength: "short", selectedPayload: { jdText: "虚构岗位" } }, undefined, fetchMock)).rejects.toThrow("返回了空内容");
  });

  it("uses provider-neutral quota errors and gives guidance for unsupported JSON mode", () => {
    expect(providerErrorMessage(429, "credit_balance_exhausted", "insufficient_quota")).toContain("对应服务商");
    expect(providerErrorMessage(400)).toContain("模型支持");
  });

  it("uses Responses structured output with store disabled for OpenAI", async () => {
    let calledUrl = "";
    let calledInit: AiNetworkRequestInit | undefined;
    const fetchMock = vi.fn(async (input: string, init: AiNetworkRequestInit) => { calledUrl = input; calledInit = init; return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify({ status: "ready", result: { title: "分析", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [] }) }] }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }); });
    const response = await callAi({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "test-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "request", taskType: "analyze-job", locale: "zh-CN", userInstructions: "", outputLanguage: "zh-CN", expressionGoal: "match-jd", contentLength: "standard", selectedPayload: { jdText: "岗位要求" } }, undefined, fetchMock);
    const body = JSON.parse(String(calledInit?.body)) as { store: boolean; text: { format: { type: string; strict: boolean } } };
    expect(calledUrl).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({ store: false, text: { format: { type: "json_schema", strict: true } } });
    expect(response.result.title).toBe("分析");
  });

  it("uses the dedicated strict schema for resume import candidates", async () => {
    let calledInit: AiNetworkRequestInit | undefined;
    const aiResult = { status: "ready", result: { materials: [{ category: "work", internalName: "示例岗位", facts: [{ key: "company", value: "示例公司" }], summary: "负责产品工作", bullets: ["推动需求交付"], links: [] }] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async (_input: string, init: AiNetworkRequestInit) => { calledInit = init; return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify(aiResult) }] }] }), { status: 200, headers: { "content-type": "application/json" } }); });
    const response = await callAi({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "test-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "import", taskType: "import-resume", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "concise", contentLength: "standard", selectedPayload: { resumeText: "示例公司 示例岗位 负责产品工作 推动需求交付" } }, undefined, fetchMock);
    const body = JSON.parse(String(calledInit?.body)) as { text: { format: { schema: { properties: { result: { properties: Record<string, unknown> } } } } } };
    expect(body.text.format.schema.properties.result.properties).toEqual({ materials: expect.any(Object) });
    expect(response.result.importedMaterials?.[0]?.internalName).toBe("示例岗位");
  });

  it("uses a compact recommendation-only schema and output limit", async () => {
    let calledInit: AiNetworkRequestInit | undefined;
    const aiResult = { status: "ready", result: { recommendations: [{ referenceId: "version-1", score: 91, reason: "岗位与项目经验匹配", suggestedOrder: 1 }] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async (_input: string, init: AiNetworkRequestInit) => { calledInit = init; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiResult) } }], usage: { prompt_tokens: 120, completion_tokens: 40 } }), { status: 200, headers: { "content-type": "application/json" } }); });
    const response = await callAi({ provider: "compatible", baseUrl: "https://example.test/v1", model: "compatible-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "recommend", taskType: "recommend-materials", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "match-jd", contentLength: "standard", selectedPayload: { targetRole: "产品经理", jdText: "负责需求分析", materials: [{ id: "version-1", summary: "负责需求分析" }] } }, undefined, fetchMock);
    const body = JSON.parse(String(calledInit?.body)) as { max_tokens: number; response_format: { json_schema: { schema: { properties: { result: { properties: Record<string, unknown> } } } } } };
    expect(body.max_tokens).toBe(1_800);
    expect(body.response_format.json_schema.schema.properties.result.properties).toEqual({ recommendations: expect.any(Object) });
    expect(response.result).toMatchObject({ title: "", recommendations: [{ referenceId: "version-1", score: 91 }] });
    expect(response.diagnostics).toMatchObject({ submittedItemCount: 1 });
  });

  it("rejects recommendation orders that do not start at one and remain consecutive", async () => {
    const aiResult = { status: "ready", result: { recommendations: [{ referenceId: "version-1", score: 91, reason: "匹配", suggestedOrder: 2 }] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiResult) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(callAi({ provider: "compatible", baseUrl: "https://example.test/v1", model: "compatible-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "recommend-order", taskType: "recommend-materials", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "match-jd", contentLength: "standard", selectedPayload: { materials: [{ id: "version-1", summary: "需求分析" }] } }, undefined, fetchMock)).rejects.toThrow("从 1 连续排列");
  });

  it("rejects multiple recommended versions of one material unless the user allowed them", async () => {
    const aiResult = { status: "ready", result: { recommendations: [{ referenceId: "version-1", score: 91, reason: "匹配", suggestedOrder: 1 }, { referenceId: "version-2", score: 88, reason: "匹配", suggestedOrder: 2 }] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiResult) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const selectedPayload = { allowMultipleVersionsPerMaterial: false, materials: [{ id: "version-1", materialItemId: "material-1", summary: "需求分析" }, { id: "version-2", materialItemId: "material-1", summary: "项目管理" }] };
    await expect(callAi({ provider: "compatible", baseUrl: "https://example.test/v1", model: "compatible-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "recommend-duplicate", taskType: "recommend-materials", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "match-jd", contentLength: "standard", selectedPayload }, undefined, fetchMock)).rejects.toThrow("同一素材的多个版本");
  });

  it("falls back to JSON object mode for a compatible provider and normalizes object facts", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fallbackResult = { status: "ready", result: { materials: [{ category: "project", internalName: "示例项目", facts: { projectName: "示例项目", unknownField: "忽略" }, summary: "整理项目需求", bullets: ["推动项目交付"], links: [] }] }, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async (_input: string, init: AiNetworkRequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (requestBodies.length === 1) return new Response(JSON.stringify({ error: { message: "response_format json_schema is not supported" } }), { status: 400, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(fallbackResult)}\n\`\`\`` } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const response = await callAi({ provider: "compatible", baseUrl: "https://example.test/v1", model: "compatible-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "fallback", taskType: "import-resume", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "concise", contentLength: "standard", selectedPayload: { resumeText: "示例项目 整理项目需求 推动项目交付" } }, undefined, fetchMock);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.response_format).toMatchObject({ type: "json_schema" });
    expect(requestBodies[1]?.response_format).toEqual({ type: "json_object" });
    expect(response.result.importedMaterials?.[0]?.facts).toEqual([{ key: "projectName", value: "示例项目" }]);
    expect(response.warnings.join(" ")).toContain("兼容 JSON 模式");
    expect(response.warnings.join(" ")).toContain("unknownField");
  });

  it("returns an actionable error when import materials are missing", async () => {
    const malformed = { status: "ready", result: {}, missingFacts: [], warnings: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify(malformed) }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(callAi({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "test-model", timeoutMs: 10_000, apiKey: "test-key" }, { requestId: "bad-import", taskType: "import-resume", locale: "zh-CN", userInstructions: "", outputLanguage: "keep", expressionGoal: "concise", contentLength: "standard", selectedPayload: { resumeText: "示例内容" } }, undefined, fetchMock)).rejects.toThrow("缺少 materials 数组");
  });
});
