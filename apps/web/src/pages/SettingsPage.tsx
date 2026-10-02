import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AI_PROVIDER_GUIDES, type AiProvider, type AiServiceStatus, type HealthResponse, type PdfServiceStatus } from "@career-workbench/shared";
import { isBackupReminderDue, repository, type BackupStatus } from "@career-workbench/database";
import { FormField } from "../components/FormField";
import { deleteAiConfig, getAiStatus, saveAiConfig, testAiConnection } from "../services/ai-client";
import { getPdfStatus } from "../services/pdf-client";
import { saveBackupBlob } from "../services/backup-save";
import { localServiceError, storageErrorMessage } from "../services/user-errors";
import type { BackupValidationResult } from "@career-workbench/database";

function BackupPanel() {
  const [busy, setBusy] = useState<"export" | "inspect" | "restore" | "">("");
  const [inspection, setInspection] = useState<BackupValidationResult>();
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [backupSaved, setBackupSaved] = useState(false); const [downloadConfirmed, setDownloadConfirmed] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>();
  const [pendingDownloadConfirmation, setPendingDownloadConfirmation] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void repository.getBackupStatus().then(setBackupStatus).catch(() => setError("无法读取上次备份时间，请检查本机存储后重试。")); }, []);
  const exportBackup = async () => {
    setBusy("export"); setError(""); setMessage(""); setPendingDownloadConfirmation(false);
    try {
      const envelope = await repository.createFullBackup();
      const filename = `求职工作台-完整备份-${new Date().toISOString().slice(0, 10)}.json`;
      const result = await saveBackupBlob(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }), filename);
      if (result === "picker") {
        setBackupSaved(true); setDownloadConfirmed(true);
        try {
          setBackupStatus(await repository.recordBackupSaved("picker"));
          setMessage("当前数据备份已保存，可继续选择恢复文件。");
        } catch {
          setMessage("备份文件已保存，但本机未能记录备份时间；请保留该文件并检查浏览器存储空间。");
        }
      } else {
        setBackupSaved(false); setDownloadConfirmed(false); setPendingDownloadConfirmation(true);
        setMessage("备份已触发下载；请先检查文件是否保存，再点击下方确认。");
      }
    } catch (reason) { if ((reason as DOMException)?.name !== "AbortError") setError(storageErrorMessage(reason)); } finally { setBusy(""); }
  };
  const confirmDownloadedBackup = async () => {
    setBusy("export"); setError("");
    try {
      setBackupStatus(await repository.recordBackupSaved("confirmed-download"));
      setBackupSaved(true); setDownloadConfirmed(true); setPendingDownloadConfirmation(false);
      setMessage("已按你的确认记录备份时间。请妥善保管下载的 JSON 文件。");
    } catch (reason) { setError(storageErrorMessage(reason)); }
    finally { setBusy(""); }
  };
  const inspect = async (file: File) => {
    setBusy("inspect"); setError(""); setMessage(""); setInspection(undefined); setDownloadConfirmed(false);
    try { const result = await repository.inspectBackupFile(file); setInspection(result); if (!result.compatible) setError(result.errors.join("；")); else setMessage("备份检查通过。恢复前请确认已保存当前数据备份。"); } catch (reason) { setError(storageErrorMessage(reason)); } finally { setBusy(""); }
  };
  const restore = async () => {
    if (!inspection?.compatible || !inspection.validatedBackup) return;
    if (!backupSaved && !downloadConfirmed) { setError("请先导出当前数据备份，并确认文件已经保存。"); return; }
    if (!window.confirm("恢复会用备份整体替换当前本机数据，且会清空当前临时 AI 候选和撤销记录。确定继续吗？")) return;
    setBusy("restore"); setError(""); setMessage("");
    try { await repository.restoreFullBackup(inspection.validatedBackup); setMessage("恢复成功，正在刷新应用…"); window.setTimeout(() => window.location.reload(), 150); } catch (reason) { setError(storageErrorMessage(reason)); } finally { setBusy(""); }
  };
  const summary = inspection?.summary;
  return <section className="content-panel editor-section">
    <div className="section-heading-row"><div><p className="eyebrow">本机数据</p><h2>数据备份与恢复</h2><p>完整备份个人资料、照片、简历素材、版本、面试备注、简历项目和回收站；API Key、临时 AI 候选和 PDF 不会进入备份。</p></div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void exportBackup()}>{busy === "export" ? "正在生成…" : "导出完整备份"}</button></div>
    {backupStatus !== undefined ? <p className={isBackupReminderDue(backupStatus) ? "inline-notice" : "field-hint"}>{backupStatus ? `最近确认保存备份：${new Date(backupStatus.lastSavedAt).toLocaleString()}。` : "尚未记录成功保存的备份。"}{isBackupReminderDue(backupStatus) ? "建议现在导出一份完整备份；此提醒不影响继续使用。" : ""}</p> : null}
    {pendingDownloadConfirmation ? <div className="editor-footer-actions"><span className="field-hint">请先到下载文件夹确认 JSON 文件存在且可找到。</span><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void confirmDownloadedBackup()}>我已确认备份文件保存</button></div> : null}
    <div className="editor-footer-actions"><input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); event.target.value = ""; }} /><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>{busy === "inspect" ? "正在检查…" : "选择备份文件"}</button>{summary ? <span className="field-hint">{summary.recordCounts.materialItems} 条素材 · {summary.recordCounts.resumeProjects} 个简历项目 · {Math.ceil(summary.sizeBytes / 1024)} KB</span> : null}</div>
    {inspection?.compatible ? <label className="check-row"><input type="checkbox" checked={downloadConfirmed} onChange={(event) => setDownloadConfirmed(event.target.checked)} />我确认当前数据备份已经保存到安全位置</label> : null}
    {inspection?.compatible ? <div className="editor-footer-actions"><button className="primary-button" type="button" disabled={Boolean(busy) || !downloadConfirmed} onClick={() => void restore()}>{busy === "restore" ? "正在恢复…" : "恢复此备份并刷新"}</button></div> : null}
    {message ? <p className="success-message">{message}</p> : null}{error ? <p className="inline-error">{error}</p> : null}
  </section>;
}

function AiServiceEditor() {
  const [status, setStatus] = useState<AiServiceStatus>();
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-5.6-luna");
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [apiKey, setApiKey] = useState("");
  const [copiedModel, setCopiedModel] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "delete" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedProviderGuide = provider === "qwen" || provider === "deepseek" || provider === "glm" ? AI_PROVIDER_GUIDES[provider] : undefined;
  const providerChanged = Boolean(status?.configured && status.provider !== provider);
  const savedSettingsMatch = Boolean(status?.configured && status.provider === provider && status.baseUrl === baseUrl && status.model === model && !apiKey.trim());
  const needsNewKey = !status?.configured || providerChanged;
  const canSave = Boolean(baseUrl.trim() && model.trim() && (!needsNewKey || apiKey.trim()));

  const copyExampleModel = async (providerId: keyof typeof AI_PROVIDER_GUIDES) => {
    try { await navigator.clipboard.writeText(AI_PROVIDER_GUIDES[providerId].exampleModel); setCopiedModel(providerId); window.setTimeout(() => setCopiedModel(""), 1600); }
    catch { setError("无法自动复制，请手动选中并复制模型 ID。"); }
  };

  const changeProvider = (value: AiProvider) => {
    setProvider(value); setModel(""); setApiKey(""); setError(""); setMessage(""); setCopiedModel("");
    setBaseUrl(value === "openai" ? "https://api.openai.com/v1" : value === "compatible" ? "" : AI_PROVIDER_GUIDES[value].baseUrl);
  };

  const refresh = async () => {
    const next = await getAiStatus();
    setStatus(next); setProvider(next.provider); setBaseUrl(next.baseUrl); setModel(next.model); setTimeoutSeconds(next.timeoutMs / 1000);
  };
  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "读取 AI 设置失败")); }, []);

  const save = async () => {
    setBusy("save"); setError(""); setMessage("");
    try {
      await saveAiConfig({ provider, baseUrl, model, timeoutMs: timeoutSeconds * 1000, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setApiKey(""); await refresh(); setMessage("AI 配置已使用当前 Windows 账户加密保存。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(""); }
  };
  const test = async () => {
    setBusy("test"); setError(""); setMessage("");
    try { const result = await testAiConnection(); setMessage(result.message); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "连接失败"); }
    finally { setBusy(""); }
  };
  const remove = async () => {
    if (!window.confirm("删除本机保存的 AI 配置和 API Key？手动功能不受影响。")) return;
    setBusy("delete"); setError("");
    try { await deleteAiConfig(); setApiKey(""); await refresh(); setMessage("AI 配置已从本机删除。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
    finally { setBusy(""); }
  };

  return <section className="content-panel editor-section">
    <div className="section-heading-row"><div><p className="eyebrow">用户主动调用</p><h2>AI 服务</h2><p>未配置或断网时，所有手动功能仍然可用。</p></div><span className={`source-chip ${status?.configured && !providerChanged ? "current" : "updated"}`}>{providerChanged ? "尚未配置新服务商" : status?.configured ? `已配置 ${status.maskedKey}` : "尚未配置"}</span></div>
    <div className="privacy-notice">API Key 仅交给本机服务，并使用 Windows DPAPI 加密；不会进入浏览器数据库、日志或备份。发送给第三方 AI 的内容仍受该服务商的数据政策约束。</div>
    <details className="provider-guides">
      <summary><strong>可用模型／厂商说明</strong><span>4 类接口（含自定义）</span></summary>
      <div className="provider-guide-content">
        <p className="field-hint">“可用”表示可尝试连接，不代表任意模型已通过全部简历功能验证。模型示例仅供参考，不会自动填入。</p>
        <div className="provider-guide-list">{(Object.entries(AI_PROVIDER_GUIDES) as Array<[keyof typeof AI_PROVIDER_GUIDES, (typeof AI_PROVIDER_GUIDES)[keyof typeof AI_PROVIDER_GUIDES]]>).map(([providerId, guide]) => <article className="provider-guide-row" key={providerId}>
          <div className="provider-guide-row-heading"><h3>{guide.label}</h3><div className="provider-model-example"><span>模型示例</span><code>{guide.exampleModel}</code><button className="text-button" type="button" onClick={() => void copyExampleModel(providerId)}>{copiedModel === providerId ? "已复制" : "复制"}</button></div></div>
          <p>接口：<code>{guide.baseUrl}</code></p>
          <p>{guide.limitations}</p>
          <div className="provider-guide-links"><a href={guide.docsUrl} target="_blank" rel="noreferrer">官方文档</a><a href={guide.apiKeyUrl} target="_blank" rel="noreferrer">获取 API Key</a></div>
        </article>)}
          <article className="provider-guide-row">
            <div className="provider-guide-row-heading"><h3>自定义 OpenAI 兼容接口</h3><span className="field-hint">地址和模型 ID 均需手动填写</span></div>
            <p>填写服务商提供的兼容接口基础地址、模型 ID 和该服务商的 API Key；应用会在地址后调用 <code>/chat/completions</code>。</p>
            <p>不同服务商的兼容程度、模型权限及 JSON 输出能力可能不同，请先保存配置并测试连接；密钥获取方式以该服务商文档为准。</p>
          </article>
        </div>
      </div>
    </details>
    <div className="form-grid">
      <FormField label="服务类型"><select value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}><option value="openai">OpenAI</option><option value="compatible">自定义 OpenAI 兼容接口</option><option value="qwen">{AI_PROVIDER_GUIDES.qwen.label}</option><option value="deepseek">{AI_PROVIDER_GUIDES.deepseek.label}</option><option value="glm">{AI_PROVIDER_GUIDES.glm.label}</option></select></FormField>
      <FormField label="接口地址"><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></FormField>
      <FormField label="模型 ID" hint={selectedProviderGuide ? `请手动输入模型 ID；示例：${selectedProviderGuide.exampleModel}（可在说明中复制）。实际可用模型及权限以服务商控制台为准。` : "请手动输入服务商提供的模型 ID。"}><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="手动输入模型 ID" /></FormField>
      <FormField label="请求超时（秒）"><input type="number" min="10" max="120" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /></FormField>
      <FormField label={status?.configured && !providerChanged ? "替换 API Key（留空保留当前服务商密钥）" : "API Key（切换服务商后必须重新输入）"} wide><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured && !providerChanged ? "已安全保存；此处不会回显明文" : "输入所选服务商提供的 API Key"} /></FormField>
    </div>
    {providerChanged ? <p className="inline-notice">已选择新的服务商。保存前需提供该服务商自己的 API Key；当前已保存的密钥不会用于新服务商。</p> : null}
    {message ? <p className="success-message">{message}</p> : null}{error ? <p className="inline-error">{error}</p> : null}
    {savedSettingsMatch && status?.lastCheck ? <p className="field-hint">最近检查：{new Date(status.lastCheck.at).toLocaleString()} · {status.lastCheck.message}</p> : null}
    <div className="editor-footer-actions"><button className="text-button danger-text" type="button" disabled={!status?.configured || Boolean(busy)} onClick={() => void remove()}>删除配置</button><button className="secondary-button" type="button" disabled={!savedSettingsMatch || Boolean(busy)} onClick={() => void test()}>测试已保存配置（会产生少量 API 用量）</button><button className="primary-button" type="button" disabled={!canSave || Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "正在保存…" : "安全保存"}</button></div>
  </section>;
}

interface DiagnosticResult {
  checkedAt: string;
  appVersion: string;
  localService: "ok" | "failed";
  indexedDb: "ok" | "failed";
  pdf: Pick<PdfServiceStatus, "available" | "fontAvailable" | "message">;
  storage: { usage?: number; quota?: number; persisted?: boolean };
}

function DiagnosticsPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticResult>();
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true); setError("");
    try {
      const [healthResponse, pdf, estimate, persisted] = await Promise.all([
        fetch("/api/health").then(async (response) => { if (!response.ok) throw new Error("本机服务不可用"); return response.json() as Promise<HealthResponse>; }),
        getPdfStatus(), navigator.storage?.estimate?.() ?? Promise.resolve({}), navigator.storage?.persisted?.() ?? Promise.resolve(false)
      ]);
      await repository.getProfile();
      setResult({ checkedAt: new Date().toISOString(), appVersion: healthResponse.appVersion, localService: "ok", indexedDb: "ok", pdf: { available: pdf.available, fontAvailable: pdf.fontAvailable, message: pdf.message }, storage: { ...(estimate.usage !== undefined ? { usage: estimate.usage } : {}), ...(estimate.quota !== undefined ? { quota: estimate.quota } : {}), persisted } });
    } catch (reason) { setError(reason instanceof TypeError ? localServiceError(reason, "检查本机服务").message : storageErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  const exportResult = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ product: "求职工作台", ...result }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `求职工作台-诊断-${result.checkedAt.slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const formatBytes = (value?: number) => value === undefined ? "未知" : `${(value / 1024 / 1024).toFixed(1)} MB`;
  return <section className="content-panel editor-section">
    <div className="section-heading-row"><div><p className="eyebrow">仅本机技术信息</p><h2>故障诊断</h2><p>检查本机服务、数据库、存储空间、Edge PDF 和中文字体；不会读取简历正文。</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void run()}>{busy ? "正在检查…" : "运行检查"}</button></div>
    {result ? <div className="diagnostic-grid"><span>本机服务</span><strong>正常 · {result.appVersion}</strong><span>浏览器数据库</span><strong>读写正常</strong><span>Edge PDF</span><strong>{result.pdf.available ? "可用" : "不可用"}</strong><span>中文字体</span><strong>{result.pdf.fontAvailable ? "已就绪" : "缺失，将使用系统字体"}</strong><span>已使用空间</span><strong>{formatBytes(result.storage.usage)}</strong><span>可用配额</span><strong>{formatBytes(result.storage.quota)}</strong><span>持久化存储</span><strong>{result.storage.persisted ? "已授予" : "未授予或未知"}</strong></div> : <p className="muted-empty">尚未运行检查。</p>}
    {error ? <p className="inline-error">{error}</p> : null}
    {result ? <div className="editor-footer-actions"><span className="field-hint">检查时间：{new Date(result.checkedAt).toLocaleString()}</span><button className="secondary-button" type="button" onClick={exportResult}>导出诊断文件</button></div> : null}
  </section>;
}

export function SettingsPage() {
  return <section className="page" aria-labelledby="settings-title">
    <header className="page-header"><div><p className="eyebrow">本机配置</p><h1 id="settings-title">设置</h1><p className="page-description">配置 AI 服务并检查本机运行环境。个人资料和照片已移至左侧“个人资料”。</p></div></header>
    <div className="settings-stack">
      <section className="content-panel editor-section">
        <div className="section-heading-row">
          <div><p className="eyebrow">首次使用帮助</p><h2>使用教程</h2><p>重新查看产品使用路径，并选择从个人资料或已有简历开始。</p></div>
          <Link className="secondary-button link-button" to="/tutorial">重新查看教程</Link>
        </div>
      </section>
      <DiagnosticsPanel />
      <BackupPanel />
      <AiServiceEditor />
    </div>
  </section>;
}
