export const APP_NAME = "求职工作台";
export const APP_VERSION = "0.1.1-test";
export const API_VERSION = "1";
export const LOCAL_HOST = "127.0.0.1";
export const LOCAL_PORT = 41823;

export interface HealthResponse {
  status: "ok";
  appName: string;
  appVersion: string;
  apiVersion: string;
  timestamp: string;
  runtime?: RuntimeCapabilities;
  instanceId?: string;
}

export interface RuntimeCapabilities {
  platform: "windows" | "macos" | "unsupported";
  secretProtection: string;
  pdfEngine: string;
  browserDataScope: "per-browser-profile";
}

export const AI_TASK_TYPES = ["analyze-job", "generate-version", "generate-interview-note", "recommend-materials", "rewrite-resume", "import-resume"] as const;
export const AI_PROVIDERS = ["openai", "compatible", "qwen", "deepseek", "glm"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_PROVIDER_GUIDES: Record<Exclude<AiProvider, "openai" | "compatible">, { label: string; baseUrl: string; exampleModel: string; apiKeyUrl: string; docsUrl: string; limitations: string }> = {
  qwen: { label: "通义千问（阿里云百炼）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", exampleModel: "qwen-plus", apiKeyUrl: "https://help.aliyun.com/zh/model-studio/get-api-key", docsUrl: "https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions", limitations: "接口地址可修改；建议优先使用控制台提供的业务空间专属地址。API Key 与地域/业务空间及模型权限需匹配。" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", exampleModel: "deepseek-flash", apiKeyUrl: "https://platform.deepseek.com/api_keys", docsUrl: "https://api-docs.deepseek.com/guides/json_mode/", limitations: "JSON 输出需模型遵循提示词，官方提示偶尔可能返回空内容；速率、额度及可用模型以账户和官方控制台为准。" },
  glm: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", exampleModel: "glm-5.3", apiKeyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys", docsUrl: "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction", limitations: "GLM-5.3 始终启用思考；可用能力、计费和额度取决于账号及模型。当前仅验证兼容接口可尝试连接，不代表简历任务已逐项验证。" }
};
export type AiTaskType = (typeof AI_TASK_TYPES)[number];
export type AiOutputLanguage = "keep" | "zh-CN" | "en";
export type AiExpressionGoal = "concise" | "results" | "expertise" | "match-jd";
export type AiContentLength = "short" | "standard" | "detailed";

export interface AiTaskRequest {
  requestId: string;
  taskType: AiTaskType;
  locale: "zh-CN";
  userInstructions: string;
  outputLanguage: AiOutputLanguage;
  expressionGoal: AiExpressionGoal;
  contentLength: AiContentLength;
  selectedPayload: unknown;
}

export interface AiRecommendation {
  referenceId: string;
  score: number;
  reason: string;
  suggestedOrder: number;
}

export interface AiRewrite {
  referenceId: string;
  summary: string;
  bullets: string[];
  changeReason: string;
  evidenceRefs: string[];
  riskFlags: string[];
}

export interface AiImportedMaterialCandidate {
  category: "work" | "project" | "education" | "campus" | "volunteer" | "certificate" | "custom";
  internalName: string;
  facts: Array<{ key: string; value: string }>;
  summary: string;
  bullets: string[];
  links: string[];
}

export interface AiCandidateResult {
  title: string;
  summary: string;
  bullets: string[];
  content: string;
  recommendations: AiRecommendation[];
  rewrites: AiRewrite[];
  importedMaterials?: AiImportedMaterialCandidate[];
}

export interface AiTaskResponse {
  requestId: string;
  status: "ready" | "needs_input" | "failed";
  result: AiCandidateResult;
  missingFacts: string[];
  warnings: string[];
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  diagnostics?: { durationMs: number; requestBytes: number; submittedItemCount?: number };
}

export interface AiServiceStatus {
  storageError?: string;
  configured: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maskedKey: string;
  clientToken: string;
  lastCheck?: { ok: boolean; at: string; message: string };
}

export interface AiServiceConfigInput {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
}

export interface PdfServiceStatus {
  available: boolean;
  edgeVersion?: string;
  fontAvailable: boolean;
  clientToken: string;
  message: string;
}

export interface PdfRenderRequest {
  requestId: string;
  templateId: "standard-single-column";
  templateVersion: 1 | 2;
  pageCount: number;
  html: string;
  css: string;
}

export type PdfErrorCode = "pdf_busy" | "pdf_cancelled" | "pdf_timeout" | "pdf_output_incomplete" | "pdf_edge_unavailable" | "pdf_engine_unavailable" | "pdf_render_failed";

export interface PdfErrorResponse {
  error: PdfErrorCode;
  message: string;
  retryable?: boolean;
}
