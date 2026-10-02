import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CATEGORY_FIELDS, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, type MaterialCategory } from "@career-workbench/domain";
import { repository, ResumeImportValidationError, type ResumeImportCandidateDraft, type ResumeImportSessionInput } from "@career-workbench/database";
import type { AiImportedMaterialCandidate } from "@career-workbench/shared";
import { FormField } from "../components/FormField";
import { BoldTextarea } from "../components/BoldTextarea";
import { ResumeImportDestinationEditor } from "../components/ResumeImportDestinationEditor";
import { parseJdFile, type JdParseResult } from "../file-parsers/jd-parser";
import { getAiStatus, runAiTask } from "../services/ai-client";
import { storageErrorMessage } from "../services/user-errors";

type ImportCandidate = ResumeImportCandidateDraft;

function factsFromAi(candidate: AiImportedMaterialCandidate): Record<string, string | boolean> {
  const allowed = new Set(CATEGORY_FIELDS[candidate.category].map((field) => field.key));
  return Object.fromEntries(candidate.facts.filter((fact) => allowed.has(fact.key) && fact.value.trim()).map((fact) => [fact.key, fact.value.trim()]));
}

function aiCandidateToDraft(candidate: AiImportedMaterialCandidate): ImportCandidate {
  return {
    id: crypto.randomUUID(), selected: true, category: candidate.category,
    internalName: candidate.internalName.trim() || "待命名素材", facts: factsFromAi(candidate),
    summary: candidate.summary, bullets: candidate.bullets, links: candidate.links, creationMethod: "ai"
  };
}

function CandidateEditor({ candidate, error, onChange, onDelete }: { candidate: ImportCandidate; error: string; onChange: (next: ImportCandidate) => void; onDelete: () => void }) {
  const fields = CATEGORY_FIELDS[candidate.category];
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const destination = candidate.destination ?? { mode: "new-material" };
  const isNewVersion = destination.mode === "new-version";
  useEffect(() => {
    if (!error || !detailsRef.current) return;
    detailsRef.current.open = true;
    detailsRef.current.focus();
  }, [error]);
  const setCategory = (category: MaterialCategory) => {
    const allowed = new Set(CATEGORY_FIELDS[category].map((field) => field.key));
    onChange({ ...candidate, category, facts: Object.fromEntries(Object.entries(candidate.facts).filter(([key]) => allowed.has(key))),
      destination: isNewVersion ? { mode: "new-version", materialItemId: "", versionName: destination.versionName } : destination });
  };
  return <details ref={detailsRef} tabIndex={-1} className={`import-candidate content-panel${candidate.selected ? " selected" : ""}`} open>
    <summary><div className="import-candidate-summary"><label onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={candidate.selected} onChange={(event) => onChange({ ...candidate, selected: event.target.checked })} /><span><strong>{candidate.internalName || "未命名素材"}</strong><small>{MATERIAL_CATEGORY_LABELS[candidate.category]} · {candidate.creationMethod === "ai" ? "AI 候选" : "手动候选"}</small></span></label><button className="candidate-delete-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDelete(); }}>删除候选</button></div></summary>
    <div className="import-candidate-body">
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <FormField label="保存方式" wide><select value={destination.mode} onChange={(event) => onChange({ ...candidate, destination: event.target.value === "new-version" ? { mode: "new-version", materialItemId: "", versionName: "" } : { mode: "new-material" } })}>
        <option value="new-material">新建素材</option><option value="new-version">添加为已有素材的新版本</option>
      </select></FormField>
      {isNewVersion ? <ResumeImportDestinationEditor candidate={candidate} destination={destination} onChange={(next) => onChange({ ...candidate, destination: next })} /> : null}
      {isNewVersion ? <p className="field-hint">下方名称、类别、事实和链接是导入候选的核对信息，不会替换已有素材。概述和要点将写入新版本。</p> : null}
      <div className="form-grid">
        <FormField label={isNewVersion ? "导入候选名称（内部参考）" : "素材库内部名称"}><input value={candidate.internalName} onChange={(event) => onChange({ ...candidate, internalName: event.target.value })} /></FormField>
        <FormField label="类别"><select value={candidate.category} onChange={(event) => setCategory(event.target.value as MaterialCategory)}>{MATERIAL_CATEGORIES.map((category) => <option key={category} value={category}>{MATERIAL_CATEGORY_LABELS[category]}</option>)}</select></FormField>
        {fields.map((field) => field.type === "boolean" ? <label className="checkbox-field" key={field.key}><input type="checkbox" checked={Boolean(candidate.facts[field.key])} onChange={(event) => onChange({ ...candidate, facts: { ...candidate.facts, [field.key]: event.target.checked } })} /><span>{field.label}</span></label> : <FormField key={field.key} label={field.label}><input value={typeof candidate.facts[field.key] === "string" ? String(candidate.facts[field.key]) : ""} placeholder={field.placeholder} onChange={(event) => onChange({ ...candidate, facts: { ...candidate.facts, [field.key]: event.target.value } })} /></FormField>)}
      </div>
      <FormField label={isNewVersion ? "新版本概述" : "原始版本概述"} wide><BoldTextarea aria-label={isNewVersion ? "新版本概述" : "原始版本概述"} rows={3} value={candidate.summary} onValueChange={(value) => onChange({ ...candidate, summary: value })} /></FormField>
      <FormField label={`${isNewVersion ? "新版本" : "原始版本"}要点（每行一条）`} wide><BoldTextarea aria-label={`${isNewVersion ? "新版本" : "原始版本"}要点（每行一条）`} rows={6} value={candidate.bullets.join("\n")} onValueChange={(value) => onChange({ ...candidate, bullets: value.split("\n") })} /></FormField>
      <FormField label={isNewVersion ? "导入的相关链接（每行一条，仅供核对）" : "相关链接（每行一条）"} wide><textarea rows={2} value={candidate.links.join("\n")} onChange={(event) => onChange({ ...candidate, links: event.target.value.split("\n") })} /></FormField>
    </div>
  </details>;
}

export function ResumeImportPage() {
  const navigate = useNavigate();
  const [parsed, setParsed] = useState<JdParseResult>();
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [failedCandidateId, setFailedCandidateId] = useState("");
  const [busy, setBusy] = useState<"parse" | "ai" | "save" | "">("");
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"idle" | "saving" | "saved" | "restored" | "failed">("idle");
  const [sessionError, setSessionError] = useState("");
  const [restoredAt, setRestoredAt] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cancelParse = useRef<(() => void) | undefined>(undefined);
  const sessionEnabled = useRef(true);
  const sessionSnapshot = useRef<ResumeImportSessionInput | undefined>(undefined);
  const sessionWrite = useRef<Promise<unknown>>(Promise.resolve());
  const committing = useRef(false);

  // Serialize all autosaves so final commit/discard can wait for pending writes.
  const persistSession = (snapshot: ResumeImportSessionInput) => {
    const copy = structuredClone(snapshot);
    const write = sessionWrite.current.catch(() => undefined).then(() => repository.saveResumeImportSession(copy));
    sessionWrite.current = write;
    return write;
  };

  sessionSnapshot.current = parsed ? {
    sourceName: parsed.sourceName,
    sourceType: parsed.sourceType,
    parsedAt: parsed.parsedAt,
    text,
    warnings,
    candidates
  } : undefined;

  useEffect(() => {
    let active = true;
    void repository.getResumeImportSession().then((session) => {
      if (!active || !session) return;
      setParsed({ sourceName: session.sourceName, sourceType: session.sourceType, parsedAt: session.parsedAt, text: session.text, warnings: session.warnings });
      setText(session.text);
      setWarnings(session.warnings);
      setCandidates(session.candidates);
      setRestoredAt(session.updatedAt);
      setSessionStatus("restored");
    }).catch((reason) => {
      if (!active) return;
      setSessionStatus("failed");
      setSessionError(storageErrorMessage(reason));
    }).finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sessionReady || !parsed || !text.trim() || !sessionEnabled.current) return;
    setSessionStatus("saving");
    const timer = window.setTimeout(() => {
      const snapshot = sessionSnapshot.current;
      if (!snapshot || !sessionEnabled.current) return;
      void persistSession(snapshot).then(() => {
        if (!sessionEnabled.current) return;
        setSessionStatus("saved");
        setSessionError("");
      }).catch((reason) => {
        if (!sessionEnabled.current) return;
        setSessionStatus("failed");
        setSessionError(storageErrorMessage(reason));
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [sessionReady, parsed, text, warnings, candidates]);

  useEffect(() => {
    const persistLatest = () => {
      const snapshot = sessionSnapshot.current;
      if (snapshot && sessionEnabled.current) void persistSession(snapshot).catch(() => undefined);
    };
    const persistWhenHidden = () => { if (document.visibilityState === "hidden") persistLatest(); };
    document.addEventListener("visibilitychange", persistWhenHidden);
    window.addEventListener("blur", persistLatest);
    return () => {
      // Internal navigation may unmount before the 600 ms debounce fires.
      // Successful commit/discard disables writes so cleanup cannot restore a cleared session.
      persistLatest();
      document.removeEventListener("visibilitychange", persistWhenHidden);
      window.removeEventListener("blur", persistLatest);
    };
  }, []);

  const selectFile = async (file?: File) => {
    if (!file) return;
    if (parsed && !window.confirm("选择新文件会覆盖当前临时导入会话，是否继续？")) return;
    cancelParse.current?.(); setBusy("parse"); setError("");
    const task = parseJdFile(file); cancelParse.current = task.cancel;
    try {
      const result = await task.promise;
      sessionEnabled.current = true;
      setParsed(result); setText(result.text); setWarnings(result.warnings); setCandidates([]); setRestoredAt("");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^JD 文件/, "简历文件") : "简历文件解析失败"); }
    finally { setBusy(""); cancelParse.current = undefined; }
  };

  const addManualCandidate = () => {
    const textarea = textRef.current;
    const selectedText = textarea ? text.slice(textarea.selectionStart, textarea.selectionEnd).trim() : "";
    if (!selectedText) { setError("请先在提取文字中选中一段经历，再创建手动候选。"); return; }
    const lines = selectedText.split("\n").map((line) => line.trim()).filter(Boolean);
    const internalName = (lines[0] ?? "待命名素材").slice(0, 100);
    setCandidates((current) => [...current, { id: crypto.randomUUID(), selected: true, internalName, category: "work", facts: {}, summary: lines.length === 1 ? selectedText : "", bullets: lines.length > 1 ? lines.slice(1) : [], links: [], creationMethod: "manual" }]);
    setError("");
  };

  const runAiImport = async () => {
    if (!text.trim()) return;
    if (candidates.length && !window.confirm("重新拆分成功后会替换全部当前候选，包括已修改的内容、目标素材和版本名称。是否继续？")) return;
    if (!window.confirm("AI 自动拆分会把当前提取的完整简历文字发送给已配置的 AI 服务。确认继续？")) return;
    setBusy("ai"); setError("");
    try {
      const status = await getAiStatus();
      if (!status.configured) throw new Error("请先在设置中配置 AI 服务；也可以继续使用手动整理。");
      const response = await runAiTask({ requestId: crypto.randomUUID(), taskType: "import-resume", locale: "zh-CN", userInstructions: "按独立经历拆分，保留原文事实；不要把个人联系方式创建为素材。", outputLanguage: "keep", expressionGoal: "concise", contentLength: "standard", selectedPayload: { sourceName: parsed?.sourceName ?? "已有简历", resumeText: text } });
      const imported = response.result.importedMaterials ?? [];
      if (!imported.length) throw new Error("AI 未识别到可导入素材，请改用手动整理或调整原文。");
      setCandidates(imported.map(aiCandidateToDraft));
      setWarnings((current) => [...current, ...response.missingFacts.map((item) => `建议补充：${item}`), ...response.warnings]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI 自动拆分失败；正式素材未修改"); }
    finally { setBusy(""); }
  };

  const save = async () => {
    if (committing.current) return;
    const selected = candidates.filter((candidate) => candidate.selected);
    if (!selected.length) { setError("请至少选择一条候选素材。"); return; }
    committing.current = true;
    setBusy("save"); setError(""); setFailedCandidateId("");
    sessionEnabled.current = false;
    try {
      // Persist the latest draft even if the debounce has not fired, then drain writes.
      if (sessionSnapshot.current) await persistSession(sessionSnapshot.current);
      else await sessionWrite.current;
      const result = await repository.commitResumeImport(selected);
      navigate("/materials", { state: { importedCount: result.newMaterialCount, importedVersionCount: result.newVersionCount } });
    } catch (reason) {
      sessionEnabled.current = true;
      if (reason instanceof ResumeImportValidationError) setFailedCandidateId(reason.candidateId);
      setError(reason instanceof Error ? reason.message : "导入失败；未写入任何素材");
    }
    finally { committing.current = false; setBusy(""); }
  };

  const updateCandidate = (next: ImportCandidate) => {
    setCandidates((current) => current.map((candidate) => candidate.id === next.id ? next : candidate));
    if (next.id === failedCandidateId) { setFailedCandidateId(""); setError(""); }
  };
  const deleteCandidate = (candidate: ImportCandidate) => {
    if (!window.confirm(`确定从本次导入会话中删除“${candidate.internalName || "未命名素材"}”吗？`)) return;
    setCandidates((current) => current.filter((item) => item.id !== candidate.id));
  };
  const discardSession = async () => {
    if (!window.confirm("确定放弃当前导入进度吗？提取文字和全部候选将被清除，且无法恢复。")) return;
    sessionEnabled.current = false;
    setBusy("save");
    try {
      await sessionWrite.current.catch(() => undefined);
      await repository.deleteResumeImportSession();
      sessionSnapshot.current = undefined;
      setParsed(undefined); setText(""); setCandidates([]); setWarnings([]); setError(""); setSessionError(""); setRestoredAt(""); setSessionStatus("idle");
    } catch (reason) {
      setSessionStatus("failed");
      setSessionError(reason instanceof Error ? reason.message : "放弃临时会话失败");
    } finally {
      sessionEnabled.current = true;
      setBusy("");
    }
  };
  const selectedCount = candidates.filter((candidate) => candidate.selected).length;
  const versionCount = candidates.filter((candidate) => candidate.selected && candidate.destination?.mode === "new-version").length;

  return <section className="page import-page" aria-labelledby="resume-import-title">
    <header className="page-header"><div><Link className="back-link" to="/materials">← 返回简历素材</Link><p className="eyebrow">临时导入会话</p><h1 id="resume-import-title">导入已有简历</h1><p className="page-description">原始文件不会保存；提取文字和候选会作为本机临时会话自动保存，方便退出后继续整理。</p></div>{parsed ? <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void discardSession()}>放弃本次导入</button> : null}</header>

    <nav className="import-process content-panel" aria-label="导入已有简历流程">
      <ol>
        <li className={!parsed ? "current" : "complete"}><span>1</span><div><strong>上传简历</strong><small>选择 DOCX、TXT 或 PDF</small></div></li>
        <li className={parsed && !candidates.length ? "current" : candidates.length ? "complete" : ""}><span>2</span><div><strong>手动整理 / AI 拆分</strong><small>选择适合的整理方式</small></div></li>
        <li className={candidates.length ? "current" : ""}><span>3</span><div><strong>检查候选</strong><small>核对、修改或删除内容</small></div></li>
        <li><span>4</span><div><strong>确认写入素材库</strong><small>仅保存最终选中的候选</small></div></li>
      </ol>
    </nav>

    {sessionStatus !== "idle" ? <div className={`import-session-status${sessionStatus === "failed" ? " failed" : ""}`} role="status">
      <span>{sessionStatus === "saving" ? "正在自动保存临时会话…" : sessionStatus === "failed" ? `临时会话保存失败：${sessionError}` : sessionStatus === "restored" ? `已恢复上次进度（${new Date(restoredAt).toLocaleString()}）` : "临时会话已自动保存到本机"}</span>
      <small>每次修改后重新计算 7 天有效期；原始文件不会保存。</small>
    </div> : null}

    <fieldset className="import-interaction" disabled={Boolean(busy) || !sessionReady}>
    <section className="content-panel editor-section">
      <div className="section-heading-row"><div><h2>1. 选择简历文件</h2><p>支持 DOCX、TXT 和带文字层的 PDF；扫描件暂不支持 OCR。</p></div><label className="secondary-button file-button">{busy === "parse" ? "正在提取…" : parsed ? "重新选择" : "选择文件"}<input disabled={Boolean(busy)} type="file" accept=".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" onChange={(event) => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
      {parsed ? <p className="success-message">已从“{parsed.sourceName}”提取 {text.length.toLocaleString()} 个字符；原文件未保存。</p> : <p className="muted-empty">尚未选择文件。</p>}
      {warnings.length ? <div className="warning-banner"><strong>请核对：</strong><ul>{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div> : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </section>

    {parsed ? <section className="content-panel editor-section">
      <div className="section-heading-row"><div><h2>2. 选择整理方式</h2><p>手动方式不会发送数据；AI 方式会发送下方完整文字，并且只生成候选。</p></div><div className="inline-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={addManualCandidate}>将选中文字创建为候选</button><button className="secondary-button ai-button" type="button" disabled={Boolean(busy)} onClick={() => void runAiImport()}>{busy === "ai" ? "AI 正在拆分…" : "AI 自动拆分（发送完整文字）"}</button></div></div>
      <textarea ref={textRef} className="import-source-text" rows={18} value={text} onChange={(event) => setText(event.target.value)} aria-label="从简历提取的文字" />
      <p className="field-hint">手动整理：在上方选中一段工作、项目或教育经历，然后点击“将选中文字创建为候选”。你可以先修正提取顺序。</p>
    </section> : null}

    {candidates.length ? <section className="import-review-section">
      <div className="section-heading-row"><div><h2>3. 检查候选素材</h2><p>共 {candidates.length} 条，已选择 {selectedCount} 条；这里的修改尚未进入素材库。</p></div><div className="inline-actions"><button className="text-button" type="button" onClick={() => setCandidates((current) => current.map((candidate) => ({ ...candidate, selected: true })))}>全选</button><button className="text-button" type="button" onClick={() => setCandidates((current) => current.map((candidate) => ({ ...candidate, selected: false })))}>清空</button></div></div>
      <div className="import-candidate-list">{candidates.map((candidate) => <CandidateEditor key={candidate.id} candidate={candidate} error={candidate.id === failedCandidateId ? error : ""} onChange={updateCandidate} onDelete={() => deleteCandidate(candidate)} />)}</div>
      <div className="import-confirm-bar"><span>将新建 {selectedCount - versionCount} 条素材，并为已有素材新增 {versionCount} 个版本。<br />仅写入选中项；成功后临时会话自动清除。</span><button className="primary-button" type="button" disabled={!selectedCount || Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "正在写入…" : `确认保存 ${selectedCount} 条候选`}</button></div>
    </section> : null}
    </fieldset>
  </section>;
}
