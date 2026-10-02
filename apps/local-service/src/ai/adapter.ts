import type { AiCandidateResult, AiImportedMaterialCandidate, AiTaskRequest, AiTaskResponse } from "@career-workbench/shared";
import type { StoredAiConfig } from "./config-store.js";
import { requestWithSystemProxy } from "./network.js";

const resultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ready", "needs_input"] },
    result: { type: "object", additionalProperties: false, properties: {
      title: { type: "string" }, summary: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, content: { type: "string" },
      recommendations: { type: "array", items: { type: "object", additionalProperties: false, properties: { referenceId: { type: "string" }, score: { type: "number", minimum: 0, maximum: 100 }, reason: { type: "string" }, suggestedOrder: { type: "integer", minimum: 1 } }, required: ["referenceId", "score", "reason", "suggestedOrder"] } },
      rewrites: { type: "array", items: { type: "object", additionalProperties: false, properties: { referenceId: { type: "string" }, summary: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, changeReason: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } }, riskFlags: { type: "array", items: { type: "string" } } }, required: ["referenceId", "summary", "bullets", "changeReason", "evidenceRefs", "riskFlags"] } }
    }, required: ["title", "summary", "bullets", "content", "recommendations", "rewrites"] },
    missingFacts: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } }
  }, required: ["status", "result", "missingFacts", "warnings"]
} as const;

const recommendationResultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ready", "needs_input"] },
    result: {
      type: "object", additionalProperties: false,
      properties: {
        recommendations: {
          type: "array", maxItems: 12,
          items: { type: "object", additionalProperties: false, properties: { referenceId: { type: "string" }, score: { type: "number", minimum: 0, maximum: 100 }, reason: { type: "string" }, suggestedOrder: { type: "integer", minimum: 1 } }, required: ["referenceId", "score", "reason", "suggestedOrder"] }
        }
      },
      required: ["recommendations"]
    },
    missingFacts: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["status", "result", "missingFacts", "warnings"]
} as const;

const importFactKeys = ["company", "department", "position", "employmentType", "location", "startDate", "endDate", "projectName", "role", "period", "url", "teamSize", "school", "degree", "major", "grade", "honors", "courses", "organization", "activity", "serviceTime", "certificateName", "issuer", "issuedAt", "expiresAt", "certificateNumber", "verificationUrl", "customTypeName", "itemName"] as const;

const importResultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ready", "needs_input"] },
    result: {
      type: "object", additionalProperties: false,
      properties: {
        materials: {
          type: "array", maxItems: 100,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              category: { type: "string", enum: ["work", "project", "education", "campus", "volunteer", "certificate", "custom"] },
              internalName: { type: "string" },
              facts: { type: "array", items: { type: "object", additionalProperties: false, properties: { key: { type: "string", enum: importFactKeys }, value: { type: "string" } }, required: ["key", "value"] } },
              summary: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, links: { type: "array", items: { type: "string" } }
            },
            required: ["category", "internalName", "facts", "summary", "bullets", "links"]
          }
        }
      },
      required: ["materials"]
    },
    missingFacts: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["status", "result", "missingFacts", "warnings"]
} as const;

function systemPrompt(taskType: string, selectedPayload?: unknown): string {
  if (taskType === "import-resume") return `你是谨慎的简历素材整理助手。只能整理用户提供的事实，不得虚构组织、岗位、学校、时间、数字、技能、证书或成果。把已有简历拆分为相互独立且不重复的素材，类别只能是 work、project、education、campus、volunteer、certificate、custom。只输出一个 JSON 对象：status 为 ready 或 needs_input；result 只包含 materials 数组；每条素材包含 category、internalName、facts 键值数组、summary、bullets、links；根对象还包含 missingFacts 和 warnings 数组。没有内容的字段使用空字符串或空数组。`;
  if (taskType === "recommend-materials") return `你是谨慎的简历素材匹配助手。根据目标岗位和 JD，从用户明确提交的候选版本中推荐最匹配的最多 12 个版本。不得改写素材，不得虚构事实。若 allowMultipleVersionsPerMaterial 为 false，同一 materialItemId 最多推荐一个版本。只输出一个 JSON 对象：status 为 ready 或 needs_input；result 只包含 recommendations 数组；每条推荐只包含输入中已有的 referenceId、0 到 100 的 score、简短 reason 和从 1 开始连续且不重复的 suggestedOrder；根对象还包含 missingFacts 和 warnings 数组。`;
  const experienceBased = taskType === "generate-version" && selectedPayload && typeof selectedPayload === "object" && (selectedPayload as Record<string, unknown>).experienceBased === true;
  if (experienceBased) return `你是谨慎的求职材料编辑助手。请仅依据用户提供的共享事实、已勾选的经历内容和岗位要求生成一个岗位化素材版本。经历按用户排列顺序提供，应优先按该顺序组织简历要点；不得参考或复述任何旧版本表达、面试备注或未选中的经历。不得虚构组织、岗位、学校、时间、数字、技能、证书或成果。信息不足时写入 missingFacts；不确定内容写入 warnings 或 riskFlags。不要主动添加加粗；改写时若保留了原文中以 ** 包围的短语，应保留对应的 ** 标记，不得使用其他 Markdown 或 HTML。只输出符合任务 JSON 结构的候选结果。`;
  return `你是谨慎的求职材料编辑助手。当前任务：${taskType}。只能整理用户提供的事实，不得虚构组织、岗位、学校、时间、数字、技能、证书或成果。信息不足时写入 missingFacts；不确定内容写入 warnings 或 riskFlags。不要主动添加加粗；改写时若保留了原文中以 ** 包围的短语，应保留对应的 ** 标记，不得使用其他 Markdown 或 HTML。所有未使用字段返回空字符串或空数组。referenceId 和 evidenceRefs 只能使用输入中已有的 id。`;
}

function extractText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  if (firstChoice && typeof firstChoice === "object") {
    const message = (firstChoice as { message?: unknown }).message;
    if (message && typeof message === "object" && typeof (message as { content?: unknown }).content === "string") return (message as { content: string }).content;
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) if (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)) {
    for (const content of (item as { content: unknown[] }).content) if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") return (content as { text: string }).text;
  }
  throw new Error("AI 服务未返回可读取的候选内容");
}

function validateResult(value: unknown): { status: "ready" | "needs_input"; result: AiCandidateResult; missingFacts: string[]; warnings: string[] } {
  if (!value || typeof value !== "object") throw new Error("AI 返回格式无效");
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "needs_input") throw new Error("AI 返回状态无效");
  if (!candidate.result || typeof candidate.result !== "object" || !Array.isArray(candidate.missingFacts) || !Array.isArray(candidate.warnings)) throw new Error("AI 返回字段不完整");
  return candidate as unknown as { status: "ready" | "needs_input"; result: AiCandidateResult; missingFacts: string[]; warnings: string[] };
}

const materialCategories = new Set(["work", "project", "education", "campus", "volunteer", "certificate", "custom"]);
const allowedImportFactKeys = new Set<string>(importFactKeys);

function parseJsonText(value: string): unknown {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(normalized); }
  catch { throw new Error("AI 已响应，但返回内容不是有效 JSON；正式素材未修改"); }
}

function stringList(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`AI 导入结果中的“${field}”格式无效；正式素材未修改`);
  if (value.length > maxItems) throw new Error(`AI 导入结果中的“${field}”数量异常；正式素材未修改`);
  return value.map((item) => {
    if (typeof item !== "string" || item.length > maxLength) throw new Error(`AI 导入结果中的“${field}”包含无效内容；正式素材未修改`);
    return item.trim();
  }).filter(Boolean);
}

function optionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`AI 导入结果中的“${field}”格式无效；正式素材未修改`);
  return value.trim();
}

function normalizeImportFacts(value: unknown, warnings: string[]): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  const append = (key: unknown, factValue: unknown) => {
    if (typeof key !== "string" || !allowedImportFactKeys.has(key)) { if (typeof key === "string") warnings.push(`已忽略 AI 返回的未知事实字段：${key}`); return; }
    if (typeof factValue !== "string" || factValue.length > 2_000) throw new Error("AI 导入结果包含无效的事实内容；正式素材未修改");
    if (factValue.trim()) pairs.push({ key, value: factValue.trim() });
  };
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error("AI 导入结果包含过多事实字段；正式素材未修改");
    for (const item of value) {
      if (!item || typeof item !== "object") throw new Error("AI 导入结果中的事实格式无效；正式素材未修改");
      append((item as Record<string, unknown>).key, (item as Record<string, unknown>).value);
    }
  } else if (value && typeof value === "object") {
    for (const [key, factValue] of Object.entries(value)) append(key, factValue);
  } else if (value !== undefined) throw new Error("AI 导入结果中的事实格式无效；正式素材未修改");
  return pairs;
}

function validateImportResult(value: unknown): ReturnType<typeof validateResult> {
  if (!value || typeof value !== "object") throw new Error("AI 导入结果格式无效；正式素材未修改");
  const root = value as Record<string, unknown>;
  if (root.status !== "ready" && root.status !== "needs_input") throw new Error("AI 导入结果状态无效；正式素材未修改");
  const result = root.result;
  if (!result || typeof result !== "object") throw new Error("AI 导入结果缺少候选素材；正式素材未修改");
  const rawMaterials = (result as Record<string, unknown>).materials ?? (result as Record<string, unknown>).importedMaterials;
  if (!Array.isArray(rawMaterials)) throw new Error("AI 导入结果缺少 materials 数组；请重试或改用手动整理");
  if (rawMaterials.length > 100) throw new Error("AI 返回的候选素材超过 100 条；请缩小导入范围");
  const warnings = stringList(root.warnings, "warnings", 100, 2_000);
  const importedMaterials: AiImportedMaterialCandidate[] = rawMaterials.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`AI 返回的第 ${index + 1} 条候选格式无效；正式素材未修改`);
    const item = raw as Record<string, unknown>;
    if (typeof item.category !== "string" || !materialCategories.has(item.category)) throw new Error(`AI 返回的第 ${index + 1} 条候选类别无效；正式素材未修改`);
    if (typeof item.internalName !== "string" || item.internalName.length > 200) throw new Error(`AI 返回的第 ${index + 1} 条候选名称无效；正式素材未修改`);
    return {
      category: item.category as AiImportedMaterialCandidate["category"],
      internalName: item.internalName.trim() || `待命名素材 ${index + 1}`,
      facts: normalizeImportFacts(item.facts, warnings),
      summary: optionalText(item.summary, "summary", 10_000),
      bullets: stringList(item.bullets, "bullets", 100, 2_000),
      links: stringList(item.links, "links", 50, 2_000)
    };
  });
  const candidateResult: AiCandidateResult = { title: "", summary: "", bullets: [], content: "", recommendations: [], rewrites: [], importedMaterials };
  return { status: root.status, result: candidateResult, missingFacts: stringList(root.missingFacts, "missingFacts", 100, 2_000), warnings };
}

function validateRecommendationResult(value: unknown): ReturnType<typeof validateResult> {
  if (!value || typeof value !== "object") throw new Error("AI 推荐结果格式无效；正式简历未修改");
  const root = value as Record<string, unknown>;
  if (root.status !== "ready" && root.status !== "needs_input") throw new Error("AI 推荐结果状态无效；正式简历未修改");
  const rawResult = root.result;
  if (!rawResult || typeof rawResult !== "object") throw new Error("AI 推荐结果缺少候选列表；正式简历未修改");
  const rawRecommendations = (rawResult as Record<string, unknown>).recommendations;
  if (!Array.isArray(rawRecommendations) || rawRecommendations.length > 12) throw new Error("AI 推荐结果数量或格式无效；请重新生成");
  const references = new Set<string>();
  const orders = new Set<number>();
  const recommendations = rawRecommendations.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`AI 返回的第 ${index + 1} 条推荐格式无效`);
    const item = raw as Record<string, unknown>;
    if (typeof item.referenceId !== "string" || !item.referenceId.trim() || references.has(item.referenceId)) throw new Error("AI 推荐包含无效或重复的素材引用");
    if (typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) throw new Error("AI 推荐包含无效匹配分数");
    if (typeof item.reason !== "string" || item.reason.length > 2_000) throw new Error("AI 推荐理由格式无效");
    if (typeof item.suggestedOrder !== "number" || !Number.isInteger(item.suggestedOrder) || item.suggestedOrder < 1 || orders.has(item.suggestedOrder)) throw new Error("AI 推荐顺序无效或重复");
    references.add(item.referenceId); orders.add(item.suggestedOrder);
    return { referenceId: item.referenceId, score: item.score, reason: item.reason.trim(), suggestedOrder: item.suggestedOrder };
  });
  const sortedOrders = [...orders].sort((left, right) => left - right);
  if (sortedOrders.some((order, index) => order !== index + 1)) throw new Error("AI 推荐顺序必须从 1 连续排列；请重新生成");
  const readMessages = (field: "missingFacts" | "warnings") => {
    const messages = root[field];
    if (!Array.isArray(messages) || messages.length > 100 || messages.some((item) => typeof item !== "string" || item.length > 2_000)) throw new Error(`AI 推荐结果中的 ${field} 格式无效`);
    return (messages as string[]).map((item) => item.trim()).filter(Boolean);
  };
  return { status: root.status, result: { title: "", summary: "", bullets: [], content: "", recommendations, rewrites: [] }, missingFacts: readMessages("missingFacts"), warnings: readMessages("warnings") };
}

function validateForTask(value: unknown, taskType: AiTaskRequest["taskType"]): ReturnType<typeof validateResult> {
  if (taskType === "import-resume") return validateImportResult(value);
  if (taskType === "recommend-materials") return validateRecommendationResult(value);
  return validateResult(value);
}

function collectSource(value: unknown, texts: string[], ids: Set<string>, key = ""): void {
  if (typeof value === "string") { texts.push(value); if (key === "id") ids.add(value); return; }
  if (Array.isArray(value)) { value.forEach((item) => collectSource(item, texts, ids)); return; }
  if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) collectSource(child, texts, ids, childKey);
}

export function findUnsupportedFactTokens(source: string, output: string): string[] {
  const tokenPattern = /\d{1,4}(?:[.,]\d+)?%?(?:年|月|日|万元|万|人|次|项|个|小时|天)?/g;
  const sourceTokens = new Set(source.match(tokenPattern) ?? []);
  return [...new Set(output.match(tokenPattern) ?? [])].filter((token) => !sourceTokens.has(token));
}

function applyLocalFactChecks(parsed: ReturnType<typeof validateResult>, selectedPayload: unknown): void {
  const sourceTexts: string[] = [];
  const sourceIds = new Set<string>();
  collectSource(selectedPayload, sourceTexts, sourceIds);
  for (const item of [...parsed.result.recommendations, ...parsed.result.rewrites]) {
    if (!sourceIds.has(item.referenceId)) throw new Error("AI 候选引用了本次范围之外的素材，请重新生成");
  }
  for (const rewrite of parsed.result.rewrites) {
    const invalidEvidence = rewrite.evidenceRefs.filter((id) => !sourceIds.has(id));
    if (invalidEvidence.length) rewrite.riskFlags.push("证据引用不在本次提交范围内");
  }
  const importedText = (parsed.result.importedMaterials ?? []).flatMap((item) => [item.internalName, ...item.facts.flatMap((fact) => [fact.key, fact.value]), item.summary, ...item.bullets, ...item.links]);
  const outputText = [parsed.result.title, parsed.result.summary, parsed.result.content, ...parsed.result.bullets, ...parsed.result.rewrites.flatMap((item) => [item.summary, ...item.bullets]), ...importedText].join("\n");
  const novelTokens = findUnsupportedFactTokens(sourceTexts.join("\n"), outputText);
  if (novelTokens.length) parsed.warnings.push(`候选中出现来源未找到的数字或日期：${novelTokens.join("、")}；采纳前必须核实。`);
}

function applyRecommendationGroupingChecks(parsed: ReturnType<typeof validateResult>, selectedPayload: unknown): void {
  if (!selectedPayload || typeof selectedPayload !== "object") return;
  const scope = selectedPayload as Record<string, unknown>;
  if (scope.allowMultipleVersionsPerMaterial !== false || !Array.isArray(scope.materials)) return;
  const materialByVersion = new Map<string, string>();
  for (const raw of scope.materials) {
    if (!raw || typeof raw !== "object") continue;
    const material = raw as Record<string, unknown>;
    if (typeof material.id === "string" && typeof material.materialItemId === "string") materialByVersion.set(material.id, material.materialItemId);
  }
  const seenMaterials = new Set<string>();
  for (const recommendation of parsed.result.recommendations) {
    const materialItemId = materialByVersion.get(recommendation.referenceId);
    if (!materialItemId) continue;
    if (seenMaterials.has(materialItemId)) throw new Error("AI 推荐了同一素材的多个版本；请重新生成或主动允许重复版本");
    seenMaterials.add(materialItemId);
  }
}

export function providerErrorMessage(status: number, code = "", type = ""): string {
  if (status === 401) return "API Key 无效或无权限";
  if (status === 403) return "API Key 没有调用该项目或模型的权限";
  if (status === 404) return "接口地址或模型不存在";
  if (status === 429 && (type === "insufficient_quota" || code === "credit_balance_exhausted" || code === "insufficient_quota")) return "API 账户可能没有可用额度；请在对应服务商平台检查计费、余额或套餐额度";
  if (status === 429) return "AI 请求达到速率限制，请稍后重试";
  if (status === 400 || status === 422) return "请求参数或 JSON 输出模式不受该模型支持；请核对模型 ID 和服务商文档";
  if (status >= 500) return `AI 服务暂不可用（${status}），请稍后重试并检查服务商状态`;
  return `AI 服务请求失败（${status}）`;
}

export async function callAi(config: StoredAiConfig, request: AiTaskRequest, externalSignal?: AbortSignal, requester = requestWithSystemProxy): Promise<AiTaskResponse> {
  const startedAt = Date.now();
  const taskSystemPrompt = systemPrompt(request.taskType, request.selectedPayload);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const endpoint = `${config.baseUrl.replace(/\/$/, "")}/${config.provider === "openai" ? "responses" : "chat/completions"}`;
    const userText = JSON.stringify({ controls: { outputLanguage: request.outputLanguage, expressionGoal: request.expressionGoal, contentLength: request.contentLength, userInstructions: request.userInstructions }, selectedPayload: request.selectedPayload });
    const schema = request.taskType === "import-resume" ? importResultSchema : request.taskType === "recommend-materials" ? recommendationResultSchema : resultSchema;
    const recommendationLimit = request.taskType === "recommend-materials" ? 1_800 : undefined;
    const usesJsonObject = config.provider === "qwen" || config.provider === "deepseek" || config.provider === "glm";
    const chatSystemPrompt = usesJsonObject ? `${taskSystemPrompt} 请仅返回一个有效 JSON 对象，不要返回 Markdown 代码块或 JSON 以外文字。` : taskSystemPrompt;
    const strictRequestBody = config.provider === "openai"
      ? { model: config.model, store: false, input: [{ role: "system", content: [{ type: "input_text", text: taskSystemPrompt }] }, { role: "user", content: [{ type: "input_text", text: userText }] }], text: { format: { type: "json_schema", name: "career_candidate", strict: true, schema } }, ...(recommendationLimit ? { max_output_tokens: recommendationLimit } : {}) }
      : usesJsonObject
        ? { model: config.model, messages: [{ role: "system", content: chatSystemPrompt }, { role: "user", content: userText }], response_format: { type: "json_object" }, ...(recommendationLimit ? { max_tokens: recommendationLimit } : {}) }
        : { model: config.model, messages: [{ role: "system", content: taskSystemPrompt }, { role: "user", content: userText }], response_format: { type: "json_schema", json_schema: { name: "career_candidate", strict: true, schema } }, ...(recommendationLimit ? { max_tokens: recommendationLimit } : {}) };
    const requestBytes = new TextEncoder().encode(JSON.stringify(strictRequestBody)).byteLength;
    const send = async (body: unknown): Promise<Response | undefined> => {
      let result: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        result = await requester(endpoint, { method: "POST", headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify(body) });
        if (result.status !== 429 && result.status < 500) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
      return result;
    };
    let response = await send(strictRequestBody);
    let usedCompatibleFallback = false;
    const supportsCompatibleFallback = request.taskType === "import-resume" || request.taskType === "recommend-materials";
    if (config.provider === "compatible" && supportsCompatibleFallback && response && [400, 422].includes(response.status)) {
      await response.arrayBuffer().catch(() => undefined);
      usedCompatibleFallback = true;
      response = await send({ model: config.model, messages: [{ role: "system", content: taskSystemPrompt }, { role: "user", content: userText }], response_format: { type: "json_object" }, ...(recommendationLimit ? { max_tokens: recommendationLimit } : {}) });
    }
    if (!response) throw new Error("AI 服务无响应");
    if (!response.ok) {
      let code = "";
      let type = "";
      try {
        const payload = await response.json() as { error?: { code?: unknown; type?: unknown } };
        code = typeof payload.error?.code === "string" ? payload.error.code : "";
        type = typeof payload.error?.type === "string" ? payload.error.type : "";
      } catch { /* Some compatible providers return an empty or non-JSON error body. */ }
      if (supportsCompatibleFallback && usedCompatibleFallback && [400, 422].includes(response.status)) throw new Error(request.taskType === "import-resume" ? "AI 服务不支持当前导入格式；已尝试兼容 JSON 模式仍失败" : "AI 服务不支持当前推荐格式；已尝试兼容 JSON 模式仍失败");
      throw new Error(providerErrorMessage(response.status, code, type));
    }
    const raw = await response.json() as Record<string, unknown>;
    const responseText = extractText(raw);
    if (!responseText.trim()) throw new Error("AI 服务返回了空内容；正式素材未修改，请稍后重试或更换模型");
    const parsed = validateForTask(parseJsonText(responseText), request.taskType);
    if (usedCompatibleFallback) parsed.warnings.push("当前服务商不支持严格 JSON Schema，本次已使用兼容 JSON 模式；请仔细核对候选内容。");
    applyLocalFactChecks(parsed, request.selectedPayload);
    if (request.taskType === "recommend-materials") applyRecommendationGroupingChecks(parsed, request.selectedPayload);
    const usage = raw.usage && typeof raw.usage === "object" ? raw.usage as Record<string, unknown> : undefined;
    const selectedPayload = request.selectedPayload && typeof request.selectedPayload === "object" ? request.selectedPayload as Record<string, unknown> : undefined;
    const submittedItems = Array.isArray(selectedPayload?.materials) ? selectedPayload.materials.length : Array.isArray(selectedPayload?.entries) ? selectedPayload.entries.length : undefined;
    return { requestId: request.requestId, ...parsed, provider: config.provider, model: config.model, ...(usage ? { usage: { ...(typeof (usage.input_tokens ?? usage.prompt_tokens) === "number" ? { inputTokens: (usage.input_tokens ?? usage.prompt_tokens) as number } : {}), ...(typeof (usage.output_tokens ?? usage.completion_tokens) === "number" ? { outputTokens: (usage.output_tokens ?? usage.completion_tokens) as number } : {}), ...(typeof usage.total_tokens === "number" ? { totalTokens: usage.total_tokens } : {}) } } : {}), diagnostics: { durationMs: Date.now() - startedAt, requestBytes, ...(submittedItems !== undefined ? { submittedItemCount: submittedItems } : {}) } };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("AI 请求超时，正式内容未修改");
    if (error instanceof TypeError) throw new Error("无法连接 AI 服务商。请检查网络、代理设置和接口地址；正式内容未修改");
    throw error;
  } finally { clearTimeout(timeout); externalSignal?.removeEventListener("abort", cancel); }
}
