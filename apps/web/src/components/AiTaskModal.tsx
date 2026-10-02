import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { AiCandidateResult, AiContentLength, AiExpressionGoal, AiOutputLanguage, AiTaskResponse, AiTaskType } from "@career-workbench/shared";
import { repository } from "@career-workbench/database";
import { getAiStatus, runAiTask } from "../services/ai-client";
import { FormField } from "./FormField";
import { Modal } from "./Modal";
import { BoldTextarea } from "./BoldTextarea";
import { fingerprintAiScope } from "../services/material-recommendation";

export function AiTaskModal({ title, taskType, targetId, selectedPayload, dataScope, onApply, onClose }: {
  title: string;
  taskType: AiTaskType;
  targetId: string;
  selectedPayload: unknown;
  dataScope: string[];
  onApply: (response: AiTaskResponse) => void | Promise<void>;
  onClose: () => void;
}) {
  const [outputLanguage, setOutputLanguage] = useState<AiOutputLanguage>("keep");
  const [expressionGoal, setExpressionGoal] = useState<AiExpressionGoal>("match-jd");
  const [contentLength, setContentLength] = useState<AiContentLength>("standard");
  const [instructions, setInstructions] = useState("");
  const [candidate, setCandidate] = useState<AiTaskResponse>();
  const [candidateId, setCandidateId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [serviceLabel, setServiceLabel] = useState("正在读取 AI 配置…");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const payloadPreview = useMemo(() => JSON.stringify(selectedPayload, null, 2), [selectedPayload]);
  const inputFingerprint = useMemo(() => fingerprintAiScope(selectedPayload), [selectedPayload]);
  const inputFingerprintRef = useRef(inputFingerprint);
  inputFingerprintRef.current = inputFingerprint;

  useEffect(() => {
    setCandidate(undefined); setCandidateId(""); setSelectedIds(new Set()); setRestored(false);
    let active = true;
    void Promise.all([getAiStatus(), repository.getAiCandidate(taskType, targetId, inputFingerprint)]).then(([status, stored]) => {
      if (!active) return;
      setConfigured(status.configured); setServiceLabel(status.configured ? `${status.provider === "openai" ? "OpenAI" : "兼容服务"} · ${status.model}` : "尚未配置 AI 服务");
      if (stored) { setCandidate(stored.response); setCandidateId(stored.id); setRestored(true); }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "读取 AI 状态失败"); });
    return () => { active = false; };
  }, [targetId, taskType, inputFingerprint]);

  const generate = async () => {
    if (candidate && !window.confirm("重新生成会替换当前尚未采纳的候选结果，是否继续？")) return;
    setBusy(true); setError("");
    try {
      const controller = new AbortController(); abortRef.current = controller;
      const requestedFingerprint = inputFingerprint;
      const response = await runAiTask({ requestId: crypto.randomUUID(), taskType, locale: "zh-CN", userInstructions: instructions, outputLanguage, expressionGoal, contentLength, selectedPayload }, controller.signal);
      if (inputFingerprintRef.current !== requestedFingerprint) throw new Error("本次选择的素材在生成期间已变化，请重新确认范围后生成。");
      const stored = await repository.saveAiCandidate(taskType, targetId, response, inputFingerprint);
      setCandidate(response); setCandidateId(stored.id); setSelectedIds(new Set()); setRestored(false);
    } catch (reason) { setError(reason instanceof DOMException && reason.name === "AbortError" ? "已取消本次 AI 请求，正式内容未修改" : reason instanceof Error ? reason.message : "AI 生成失败；正式内容未修改"); }
    finally { setBusy(false); abortRef.current = undefined; }
  };

  const updateResult = (changes: Partial<AiCandidateResult>) => candidate && setCandidate({ ...candidate, result: { ...candidate.result, ...changes } });
  const apply = async () => {
    if (!candidate) return;
    let response = candidate;
    if (taskType === "recommend-materials") response = { ...candidate, result: { ...candidate.result, recommendations: candidate.result.recommendations.filter((item) => selectedIds.has(item.referenceId)) } };
    if (taskType === "rewrite-resume") response = { ...candidate, result: { ...candidate.result, rewrites: candidate.result.rewrites.filter((item) => selectedIds.has(item.referenceId)) } };
    setBusy(true); setError("");
    try { await onApply(response); if (candidateId) await repository.deleteAiCandidate(candidateId); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "采纳候选失败"); }
    finally { setBusy(false); }
  };

  const requiresSelection = taskType === "recommend-materials" || taskType === "rewrite-resume";
  const applyDisabled = busy || !candidate || candidate.status !== "ready" || (requiresSelection && selectedIds.size === 0);
  const close = () => { abortRef.current?.abort(); onClose(); };
  return <Modal title={title} onClose={close}>
    <div className="ai-service-line"><span className={`source-chip ${configured ? "current" : "updated"}`}>{serviceLabel}</span><span>仅点击“生成候选”后才会发送数据</span></div>
    <div className="privacy-notice"><strong>本次数据范围：</strong>{dataScope.join("、")}。不会自动读取其他素材或项目；面试备注仅在范围中明确列出时发送。</div>
    <details className="ai-payload-preview"><summary>查看本次将提交的具体内容</summary><pre>{payloadPreview}</pre></details>
    <div className="form-grid ai-control-grid">
      <FormField label="输出语言"><select value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value as AiOutputLanguage)}><option value="keep">保持原文</option><option value="zh-CN">中文</option><option value="en">英文</option></select></FormField>
      <FormField label="表达目标"><select value={expressionGoal} onChange={(event) => setExpressionGoal(event.target.value as AiExpressionGoal)}><option value="match-jd">匹配 JD</option><option value="concise">精炼表达</option><option value="results">突出成果</option><option value="expertise">突出专业能力</option></select></FormField>
      <FormField label="内容长度"><select value={contentLength} onChange={(event) => setContentLength(event.target.value as AiContentLength)}><option value="short">简短</option><option value="standard">标准</option><option value="detailed">详细</option></select></FormField>
      <FormField label="自定义要求" wide><textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="可补充事实答案或表达偏好；不要填写不真实的信息。" /></FormField>
    </div>
    {!configured ? <p className="warning-banner">请先在<Link to="/settings">设置页</Link>安全保存服务配置。手动编辑功能不受影响。</p> : null}
    {error ? <p className="inline-error">{error}</p> : null}
    <div className="ai-generate-row"><div className="inline-actions"><button className="secondary-button ai-button" type="button" disabled={!configured || busy} onClick={() => void generate()}>{busy ? "正在处理…" : candidate ? "重新生成候选" : "生成候选"}</button>{busy ? <button className="text-button" type="button" onClick={() => abortRef.current?.abort()}>取消请求</button> : null}</div><span>调用可能产生 API 用量；OpenAI 请求使用 store: false。</span></div>
    {candidate ? <section className="ai-candidate-card">
      <header><div><p className="eyebrow">{restored ? "已恢复 · 尚未采纳" : "尚未采纳"}</p><h3>AI 候选结果</h3></div><span>{candidate.model}</span></header>
      {candidate.missingFacts.length ? <div className="warning-banner"><strong>建议补充事实：</strong><ul>{candidate.missingFacts.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {candidate.warnings.length ? <div className="warning-banner"><strong>请核实：</strong><ul>{candidate.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {taskType === "generate-version" ? <><FormField label="候选概述"><BoldTextarea rows={4} value={candidate.result.summary} onValueChange={(value) => updateResult({ summary: value })} /></FormField><FormField label="候选要点（每行一条）"><BoldTextarea rows={9} value={candidate.result.bullets.join("\n")} onValueChange={(value) => updateResult({ bullets: value.split("\n") })} /></FormField></> : null}
      {taskType === "generate-interview-note" ? <FormField label="候选备注卡"><textarea rows={16} value={candidate.result.content} onChange={(event) => updateResult({ content: event.target.value })} /></FormField> : null}
      {taskType === "analyze-job" ? <div className="ai-analysis"><h4>{candidate.result.title || "岗位分析"}</h4><p>{candidate.result.summary}</p><ul>{candidate.result.bullets.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {taskType === "recommend-materials" ? <div className="ai-choice-list">{candidate.result.recommendations.map((item) => <label key={item.referenceId}><input type="checkbox" checked={selectedIds.has(item.referenceId)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(item.referenceId)) next.delete(item.referenceId); else next.add(item.referenceId); return next; })} /><span><strong>{item.score} 分 · 建议顺序 {item.suggestedOrder}</strong>{item.reason}</span></label>)}</div> : null}
      {taskType === "rewrite-resume" ? <div className="ai-choice-list">{candidate.result.rewrites.map((item) => <div className="ai-rewrite-choice" key={item.referenceId}><label><input type="checkbox" checked={selectedIds.has(item.referenceId)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(item.referenceId)) next.delete(item.referenceId); else next.add(item.referenceId); return next; })} /><span><strong>{item.changeReason || "条目改写"}</strong>{item.riskFlags.length ? <em>待核实：{item.riskFlags.join("；")}</em> : null}</span></label><BoldTextarea rows={3} aria-label="候选概述" value={item.summary} onValueChange={(value) => updateResult({ rewrites: candidate.result.rewrites.map((rewrite) => rewrite.referenceId === item.referenceId ? { ...rewrite, summary: value } : rewrite) })} /><BoldTextarea rows={5} aria-label="候选要点" value={item.bullets.join("\n")} onValueChange={(value) => updateResult({ rewrites: candidate.result.rewrites.map((rewrite) => rewrite.referenceId === item.referenceId ? { ...rewrite, bullets: value.split("\n") } : rewrite) })} /></div>)}</div> : null}
      {candidate.usage ? <p className="field-hint">用量：输入 {candidate.usage.inputTokens ?? "—"} · 输出 {candidate.usage.outputTokens ?? "—"} tokens</p> : null}
      {candidate.diagnostics ? <p className="field-hint">本次耗时 {(candidate.diagnostics.durationMs / 1000).toFixed(1)} 秒 · 请求 {(candidate.diagnostics.requestBytes / 1024).toFixed(1)} KB{candidate.diagnostics.submittedItemCount !== undefined ? ` · 评估 ${candidate.diagnostics.submittedItemCount} 项` : ""}</p> : null}
    </section> : null}
    <footer className="modal-actions"><button className="secondary-button" type="button" onClick={close}>关闭</button>{candidate ? <button className="primary-button" type="button" disabled={applyDisabled} onClick={() => void apply()}>{taskType === "analyze-job" ? "确认已阅读" : requiresSelection ? `采纳选中 ${selectedIds.size} 项` : "采纳候选"}</button> : null}</footer>
  </Modal>;
}
