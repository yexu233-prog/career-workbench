import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  MATERIAL_CATEGORY_LABELS,
  DEFAULT_RESUME_STYLE,
  LEGACY_RESUME_STYLE,
  buildResumeDocxFilename,
  buildResumePdfFilename,
  buildResumeDocumentModel,
  sanitizeWindowsFilename,
  syncResumeEntrySnapshot,
  type MaterialBundle,
  type MaterialCategory,
  type ResumeEntryContent,
  type ResumeEntrySnapshot,
  type ResumeModule,
  type ResumeProject,
  type ResumeProjectBundle,
  type ResumeSyncField,
  type ResumeTargetLength
} from "@career-workbench/domain";
import type { PdfServiceStatus } from "@career-workbench/shared";
import { repository } from "@career-workbench/database";
import { FormField } from "../components/FormField";
import { Modal } from "../components/Modal";
import { ResumePreview } from "../components/ResumePreview";
import { SaveIndicator } from "../components/SaveIndicator";
import { AiTaskModal } from "../components/AiTaskModal";
import { BoldText } from "../components/BoldText";
import { BoldTextarea } from "../components/BoldTextarea";
import { useAutosavedDraft, type AutosavedDraft } from "../hooks/useAutosavedDraft";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";
import { parseJdFile, type JdParseResult } from "../file-parsers/jd-parser";
import { getPdfStatus, requestResumePdf, saveDocxBlob, savePdfBlob } from "../services/pdf-client";
import { buildRecommendationPlan } from "../services/material-recommendation";
import { storageErrorMessage } from "../services/user-errors";

const MODULE_TITLES: Record<MaterialCategory, string> = {
  work: "工作经历", project: "项目经历", education: "教育经历", campus: "校园经历",
  volunteer: "志愿经历", certificate: "证书与资质", custom: "其他经历"
};

const newId = () => crypto.randomUUID();

function MaterialPicker({ project, onAdd, onAddMany, onClose }: {
  project: ResumeProject;
  onAdd: (entry: ResumeEntrySnapshot) => void;
  onAddMany: (entries: ResumeEntrySnapshot[]) => Promise<void>;
  onClose: () => void;
}) {
  const materials = useLiveQueryValue(() => repository.listAvailableMaterialBundles(), []);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [evaluateAll, setEvaluateAll] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [showAi, setShowAi] = useState(false);
  const selectedMaterialIds = useMemo(() => new Set(project.modules.flatMap((module) => module.entries).map((entry) => entry.sourceMaterialItemId)), [project.modules]);
  const recommendationPlan = useMemo(() => buildRecommendationPlan(project, materials.value ?? [], selectedMaterialIds, allowDuplicates, evaluateAll), [project, materials.value, selectedMaterialIds, allowDuplicates, evaluateAll]);

  const add = async (versionId: string) => {
    setBusyId(versionId);
    try {
      onAdd(await repository.createResumeEntrySnapshot(versionId));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "添加素材失败");
    } finally {
      setBusyId("");
    }
  };

  return (
    <Modal title="从素材库添加" onClose={onClose}>
      <div className="ai-generate-row"><button className="secondary-button ai-button" type="button" disabled={!project.jdText.trim() || !recommendationPlan.materials.length} onClick={() => setShowAi(true)}>让 AI 给出素材建议</button><span>{project.jdText.trim() ? `AI 将评估 ${recommendationPlan.submittedCount}/${recommendationPlan.totalEligible} 个候选版本，只给建议，采纳后才加入` : "请先填写项目 JD"}</span></div>
      <label className="checkbox-field picker-option"><input type="checkbox" checked={allowDuplicates} onChange={(event) => setAllowDuplicates(event.target.checked)} /><span>允许同一条素材选择多个版本</span></label>
      {recommendationPlan.totalEligible > 30 ? <label className="checkbox-field picker-option"><input type="checkbox" checked={evaluateAll} onChange={(event) => setEvaluateAll(event.target.checked)} /><span>评估全部 {recommendationPlan.totalEligible} 个版本（可能更慢并增加 API 用量）</span></label> : null}
      {recommendationPlan.locallyFiltered ? <p className="field-hint">默认已在本机按目标岗位和 JD 初筛前 30 个版本；所有素材仍可在下方手动选择。</p> : null}
      {materials.loading ? <p className="muted-empty">正在读取素材库…</p> : null}
      {materials.error ? <p className="inline-error">{materials.error.message}</p> : null}
      <div className="material-picker-list">
        {(materials.value ?? []).map((bundle: MaterialBundle) => {
          const duplicateBlocked = selectedMaterialIds.has(bundle.item.id) && !allowDuplicates;
          return <section className="material-picker-group" key={bundle.item.id}>
            <header><div><strong>{bundle.item.internalName}</strong><span>{MATERIAL_CATEGORY_LABELS[bundle.item.category]}</span></div>{duplicateBlocked ? <span className="source-chip current">已选择</span> : null}</header>
            {bundle.versions.map((version) => <div className="material-picker-version" key={version.id}><span>{version.name} · {version.language === "zh-CN" ? "中文" : "英文"}</span><button className="secondary-button" type="button" disabled={duplicateBlocked || busyId === version.id} onClick={() => void add(version.id)}>添加</button></div>)}
          </section>;
        })}
        {!materials.loading && (materials.value ?? []).length === 0 ? <p className="muted-empty">素材库还是空的，请先创建简历素材。</p> : null}
      </div>
      {showAi ? <AiTaskModal title="AI 推荐素材与顺序" taskType="recommend-materials" targetId={project.id} selectedPayload={{ targetRole: project.targetRole, jdText: project.jdText, allowMultipleVersionsPerMaterial: allowDuplicates, materials: recommendationPlan.materials }} dataScope={["当前项目目标岗位与 JD", `${recommendationPlan.submittedCount}/${recommendationPlan.totalEligible} 个候选版本的事实和简历内容`, "不包含面试备注"]} onApply={async (response) => {
        const ordered = [...response.result.recommendations].sort((left, right) => left.suggestedOrder - right.suggestedOrder);
        const snapshots = await Promise.all(ordered.map((item) => repository.createResumeEntrySnapshot(item.referenceId)));
        if (snapshots.length) await onAddMany(snapshots);
      }} onClose={() => setShowAi(false)} /> : null}
    </Modal>
  );
}

function ProjectInfoEditor({ autosave }: { autosave: AutosavedDraft<ResumeProject> }) {
  const { draft, updateDraft } = autosave;
  const [parseResult, setParseResult] = useState<JdParseResult>();
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState(false);
  const cancelParsing = useRef<(() => void) | undefined>(undefined);
  const [showAiAnalysis, setShowAiAnalysis] = useState(false);

  const selectJdFile = async (file?: File) => {
    if (!file) return;
    cancelParsing.current?.();
    setParseError("");
    setParseResult(undefined);
    setParsing(true);
    const task = parseJdFile(file);
    cancelParsing.current = task.cancel;
    try { setParseResult(await task.promise); }
    catch (error) { setParseError(error instanceof Error ? error.message : "文件解析失败"); }
    finally { setParsing(false); cancelParsing.current = undefined; }
  };

  const applyParsedJd = () => {
    if (!parseResult) return;
    if (draft.jdText.trim() && !window.confirm("用文件提取内容替换当前 JD？现有内容不会被静默覆盖。")) return;
    updateDraft((current) => ({ ...current, jdText: parseResult.text, jdOriginalText: parseResult.text, jdSourceName: parseResult.sourceName, jdSourceType: parseResult.sourceType, jdParsedAt: parseResult.parsedAt, jdWarnings: parseResult.warnings }));
    setParseResult(undefined);
  };

  return <div className="editor-section content-panel">
    <div className="section-heading-row"><div><p className="eyebrow">项目基础设置</p><h2>项目信息与 JD</h2></div><div className="inline-actions"><button className="secondary-button ai-button" type="button" disabled={!draft.jdText.trim()} onClick={() => setShowAiAnalysis(true)}>AI 分析岗位</button><SaveIndicator status={autosave.status} errorMessage={autosave.errorMessage} /></div></div>
    <div className="form-grid">
      <FormField label="项目名称" wide><input value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} /></FormField>
      <FormField label="目标岗位"><input value={draft.targetRole} onChange={(event) => updateDraft((current) => ({ ...current, targetRole: event.target.value }))} /></FormField>
      <FormField label="输出语言"><select value={draft.language} onChange={(event) => updateDraft((current) => ({ ...current, language: event.target.value as ResumeProject["language"] }))}><option value="zh-CN">中文</option><option value="en">英文</option></select></FormField>
      <FormField label="目标篇幅"><select value={draft.targetLength} onChange={(event) => updateDraft((current) => ({ ...current, targetLength: event.target.value as ResumeTargetLength }))}><option value="one">一页</option><option value="two">两页</option><option value="unlimited">不限页数</option></select></FormField>
      <FormField label="岗位 JD" hint="可以粘贴文字，或从 TXT、DOCX、带文字层的 PDF 提取；文件最大 10MB。" wide>
        <div className="jd-input-actions">
          <label className="secondary-button file-button">{parsing ? "正在解析…" : "选择 JD 文件"}<input disabled={parsing} type="file" accept=".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" onChange={(event) => { void selectJdFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {parsing ? <button className="text-button" type="button" onClick={() => { cancelParsing.current?.(); setParsing(false); }}>取消解析</button> : null}
          {draft.jdSourceName ? <span className="jd-source-label">当前来源：{draft.jdSourceName} · {draft.jdText.length.toLocaleString()} 字符</span> : null}
        </div>
        {parseError ? <p className="inline-error">{parseError}。当前 JD 未被修改。</p> : null}
        <textarea rows={12} value={draft.jdText} onChange={(event) => updateDraft((current) => ({ ...current, jdText: event.target.value, jdSourceName: "手动粘贴或编辑", jdSourceType: "pasted", jdWarnings: [] }))} />
      </FormField>
    </div>
    {(draft.jdWarnings ?? []).map((warning) => <p className="warning-banner" key={warning}>{warning}</p>)}
    {autosave.errorMessage ? <p className="inline-error">{autosave.errorMessage}</p> : null}
    {parseResult ? <Modal title="核对文件提取结果" onClose={() => setParseResult(undefined)}>
      <p className="modal-description">原文件不会保存。请先检查文字顺序，也可以在下面修改；点击确认后才写入当前项目。</p>
      {parseResult.warnings.map((warning) => <p className="warning-banner" key={warning}>{warning}</p>)}
      <textarea className="jd-preview-editor" rows={18} value={parseResult.text} onChange={(event) => setParseResult({ ...parseResult, text: event.target.value })} />
      <p className="field-hint">{parseResult.sourceName} · {parseResult.text.length.toLocaleString()} 字符</p>
      <footer className="modal-actions"><button className="secondary-button" type="button" onClick={() => setParseResult(undefined)}>取消</button><button className="primary-button" type="button" onClick={applyParsedJd}>确认使用此 JD</button></footer>
    </Modal> : null}
    {showAiAnalysis ? <AiTaskModal title="AI 分析岗位要求" taskType="analyze-job" targetId={draft.id} selectedPayload={{ targetRole: draft.targetRole, jdText: draft.jdText }} dataScope={["当前目标岗位", "当前项目 JD"]} onApply={() => undefined} onClose={() => setShowAiAnalysis(false)} /> : null}
  </div>;
}

function ProfileSnapshotEditor({ autosave, profileSource }: { autosave: AutosavedDraft<ResumeProject>; profileSource: ResumeProjectBundle["profileSource"] }) {
  const { draft, updateDraft } = autosave;
  const updateProfile = (changes: Partial<ResumeProject["profile"]>) => updateDraft((current) => ({ ...current, profile: { ...current.profile, ...changes } }));
  const toggle = (field: string) => updateProfile({ hiddenFields: draft.profile.hiddenFields.includes(field) ? draft.profile.hiddenFields.filter((value) => value !== field) : [...draft.profile.hiddenFields, field] });
  const syncDefaultProfile = () => {
    if (!window.confirm("用“个人资料”模块中的最新信息更新当前项目快照？当前项目内对个人资料的修改会被替换，字段显示/隐藏设置会保留。")) return;
    updateDraft((current) => {
      const next: ResumeProject = { ...current, profile: structuredClone(profileSource.latest), sourceProfileRevision: profileSource.profileRevision };
      if (profileSource.photoRevision !== undefined) next.sourcePhotoRevision = profileSource.photoRevision;
      else delete next.sourcePhotoRevision;
      return next;
    });
  };
  return <div className="editor-section content-panel">
    <div className="section-heading-row"><div><p className="eyebrow">项目独立快照</p><h2>个人资料</h2><p>这里的修改不会影响左侧“个人资料”模块。</p></div><SaveIndicator status={autosave.status} errorMessage={autosave.errorMessage} /></div>
    {profileSource.status === "updated" ? <div className="warning-banner source-banner"><span>默认个人资料已有更新，当前项目不会自动变化。</span><button className="secondary-button" type="button" onClick={syncDefaultProfile}>确认同步最新资料</button></div> : null}
    <div className="form-grid">
      <FormField label="中文姓名"><input value={draft.profile.chineseName} onChange={(event) => updateProfile({ chineseName: event.target.value })} /></FormField>
      <FormField label="英文姓名"><input value={draft.profile.englishName} onChange={(event) => updateProfile({ englishName: event.target.value })} /></FormField>
      <FormField label="手机号码"><input value={draft.profile.phone} onChange={(event) => updateProfile({ phone: event.target.value })} /></FormField>
      <FormField label="电子邮箱"><input value={draft.profile.email} onChange={(event) => updateProfile({ email: event.target.value })} /></FormField>
      <FormField label="所在城市"><input value={draft.profile.city} onChange={(event) => updateProfile({ city: event.target.value })} /></FormField>
      <FormField label="目标方向"><input value={draft.profile.targetDirection} onChange={(event) => updateProfile({ targetDirection: event.target.value })} /></FormField>
      <FormField label="个人简介" wide><textarea rows={6} value={draft.profile.summary} onChange={(event) => updateProfile({ summary: event.target.value })} /></FormField>
      <FormField label="专业技能" hint="使用逗号分隔" wide><input value={draft.profile.skills.join("，")} onChange={(event) => updateProfile({ skills: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} /></FormField>
    </div>
    <div className="visibility-grid">
      {["chineseName", "englishName", "phone", "email", "city", "summary", "skills", "links", "customFields", "photo"].map((field) => <label className="checkbox-field" key={field}><input type="checkbox" checked={!draft.profile.hiddenFields.includes(field)} onChange={() => toggle(field)} /><span>显示 {{ chineseName: "中文名", englishName: "英文名", phone: "电话", email: "邮箱", city: "城市", summary: "个人简介", skills: "技能", links: "个人链接", customFields: "自定义信息", photo: "照片" }[field]}</span></label>)}
    </div>
    <div className="subsection-title"><h3>个人链接</h3><button className="text-button" type="button" onClick={() => updateProfile({ links: [...draft.profile.links, { id: newId(), label: "", url: "" }] })}>＋ 添加</button></div>
    <div className="repeatable-list">{draft.profile.links.map((link, index) => <div className="repeatable-row" key={link.id}><input aria-label={`第 ${index + 1} 个链接名称`} value={link.label} placeholder="名称" onChange={(event) => updateProfile({ links: draft.profile.links.map((item) => item.id === link.id ? { ...item, label: event.target.value } : item) })} /><input aria-label={`第 ${index + 1} 个链接地址`} value={link.url} placeholder="https://" onChange={(event) => updateProfile({ links: draft.profile.links.map((item) => item.id === link.id ? { ...item, url: event.target.value } : item) })} /><button className="icon-button danger-text" type="button" onClick={() => updateProfile({ links: draft.profile.links.filter((item) => item.id !== link.id) })}>删除</button></div>)}</div>
    <div className="subsection-title"><h3>自定义信息</h3><button className="text-button" type="button" onClick={() => updateProfile({ customFields: [...draft.profile.customFields, { id: newId(), label: "", value: "" }] })}>＋ 添加</button></div>
    <div className="repeatable-list">{draft.profile.customFields.map((field, index) => <div className="repeatable-row" key={field.id}><input aria-label={`第 ${index + 1} 个字段名称`} value={field.label} placeholder="字段名称" onChange={(event) => updateProfile({ customFields: draft.profile.customFields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) })} /><input aria-label={`第 ${index + 1} 个字段内容`} value={field.value} placeholder="字段内容" onChange={(event) => updateProfile({ customFields: draft.profile.customFields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item) })} /><button className="icon-button danger-text" type="button" onClick={() => updateProfile({ customFields: draft.profile.customFields.filter((item) => item.id !== field.id) })}>删除</button></div>)}</div>
  </div>;
}

function ModuleEditor({ module, autosave }: { module: ResumeModule; autosave: AutosavedDraft<ResumeProject> }) {
  const updateModule = (changes: Partial<ResumeModule>) => autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((item) => item.id === module.id ? { ...item, ...changes } : item) }));
  return <div className="editor-section content-panel">
    <div className="section-heading-row"><div><p className="eyebrow">{module.kind === "freeText" ? "自由文本模块" : "素材模块"}</p><h2>{module.title}</h2></div><SaveIndicator status={autosave.status} errorMessage={autosave.errorMessage} /></div>
    <div className="form-grid">
      <FormField label="模块名称" wide><input value={module.title} onChange={(event) => updateModule({ title: event.target.value })} /></FormField>
      <label className="checkbox-field"><input type="checkbox" checked={!module.hidden} onChange={(event) => updateModule({ hidden: !event.target.checked })} /><span>在简历中显示</span></label>
      <label className="checkbox-field"><input type="checkbox" checked={module.pageBreakBefore} onChange={(event) => updateModule({ pageBreakBefore: event.target.checked })} /><span>从新页面开始</span></label>
    </div>
    {module.kind === "freeText" ? <FormField label="模块正文" wide><textarea rows={18} value={module.text} onChange={(event) => updateModule({ text: event.target.value })} placeholder="例如：核心优势、自我评价、专业技能等" /></FormField> : <p className="muted-empty">此模块包含 {module.entries.length} 条素材。请从左侧选择具体条目进行编辑。</p>}
  </div>;
}

function EntryEditor({ entry, moduleId, sourceState, autosave, onReview }: {
  entry: ResumeEntrySnapshot;
  moduleId: string;
  sourceState: ResumeProjectBundle["sourceStates"][number] | undefined;
  autosave: AutosavedDraft<ResumeProject>;
  onReview: () => void;
}) {
  const updateEntry = (changes: Partial<ResumeEntryContent>) => autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((module) => ({ ...module, entries: module.entries.map((item) => item.id === entry.id ? { ...item, current: { ...item.current, ...changes } } : item) })) }));
  const moveModule = (targetId: string) => autosave.updateDraft((project) => {
    const moved = project.modules.flatMap((module) => module.entries).find((item) => item.id === entry.id);
    if (!moved || targetId === moduleId) return project;
    return { ...project, modules: project.modules.map((module) => module.id === moduleId ? { ...module, entries: module.entries.filter((item) => item.id !== entry.id) } : module.id === targetId ? { ...module, entries: [...module.entries, moved] } : module) };
  });
  const modified = JSON.stringify(entry.current) !== JSON.stringify(entry.lastSynced);
  const saveAsVersion = async () => {
    const name = window.prompt("新素材版本名称", `${entry.sourceVersionName}（简历版）`)?.trim();
    if (!name) return;
    try { await repository.saveResumeEntryAsMaterialVersion(entry, name); window.alert("已另存为素材新版本。"); }
    catch (error) { window.alert(error instanceof Error ? error.message : "另存失败"); }
  };
  return <div className="editor-section content-panel">
    <div className="section-heading-row"><div><p className="eyebrow">项目内快照 · {entry.sourceMaterialName} / {entry.sourceVersionName}</p><h2>{entry.current.heading}</h2></div><SaveIndicator status={autosave.status} errorMessage={autosave.errorMessage} /></div>
    {sourceState?.status === "updated" ? <div className="warning-banner source-banner">素材版本已有更新，当前简历不会自动变化。<button type="button" onClick={onReview}>查看差异并同步</button></div> : null}
    {sourceState?.status === "deleted" ? <div className="warning-banner source-banner deleted">来源已进入回收站或被删除；当前快照仍可正常编辑和预览。</div> : null}
    {modified ? <p className="snapshot-note">已在当前简历中二次修改，不会回写素材库。</p> : null}
    <div className="form-grid">
      <FormField label="条目标题"><input value={entry.current.heading} onChange={(event) => updateEntry({ heading: event.target.value })} /></FormField>
      <FormField label="组织或公司"><input value={entry.current.organization} onChange={(event) => updateEntry({ organization: event.target.value })} /></FormField>
      <FormField label="角色或职位"><input value={entry.current.role} onChange={(event) => updateEntry({ role: event.target.value })} /></FormField>
      <FormField label="时间"><input value={entry.current.period} onChange={(event) => updateEntry({ period: event.target.value })} /></FormField>
      <FormField label="地点"><input value={entry.current.location} onChange={(event) => updateEntry({ location: event.target.value })} /></FormField>
      <FormField label="所属模块"><select value={moduleId} onChange={(event) => moveModule(event.target.value)}>{autosave.draft.modules.filter((module) => module.kind === "material").map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}</select></FormField>
      <FormField label="概述" wide><BoldTextarea rows={5} value={entry.current.summary} onValueChange={(value) => updateEntry({ summary: value })} /></FormField>
      <FormField label="相关链接" hint="使用逗号分隔" wide><input value={entry.current.links.join("，")} onChange={(event) => updateEntry({ links: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} /></FormField>
    </div>
    <div className="subsection-title"><h3>简历要点</h3><span>项目内独立编辑</span></div>
    <div className="bullet-editor-list">
      {entry.current.bullets.map((bullet, index) => <div className="bullet-editor" key={index}><span className="bullet-number">{index + 1}</span><BoldTextarea rows={3} value={bullet} onValueChange={(value) => updateEntry({ bullets: entry.current.bullets.map((item, itemIndex) => itemIndex === index ? value : item) })} /><div className="bullet-actions"><button type="button" disabled={index === 0} onClick={() => { const bullets = [...entry.current.bullets]; [bullets[index - 1], bullets[index]] = [bullets[index]!, bullets[index - 1]!]; updateEntry({ bullets }); }}>↑</button><button type="button" disabled={index === entry.current.bullets.length - 1} onClick={() => { const bullets = [...entry.current.bullets]; [bullets[index + 1], bullets[index]] = [bullets[index]!, bullets[index + 1]!]; updateEntry({ bullets }); }}>↓</button><button className="danger-text" type="button" onClick={() => updateEntry({ bullets: entry.current.bullets.filter((_, itemIndex) => itemIndex !== index) })}>删除</button></div></div>)}
      <button className="add-row-button" type="button" onClick={() => updateEntry({ bullets: [...entry.current.bullets, ""] })}>＋ 添加一条要点</button>
    </div>
    <div className="editor-footer-actions"><button className="secondary-button" type="button" onClick={() => void saveAsVersion()}>另存为素材新版本</button></div>
  </div>;
}

function SourceSyncModal({ entry, latest, latestRevision, onApply, onClose }: {
  entry: ResumeEntrySnapshot;
  latest: ResumeEntryContent;
  latestRevision: number;
  onApply: (content: ResumeEntryContent, revision: number, fields: Set<ResumeSyncField>) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Set<ResumeSyncField>>(new Set(["metadata", "summary", "bullets", "links"]));
  const toggle = (field: ResumeSyncField) => setFields((current) => { const next = new Set(current); if (next.has(field)) next.delete(field); else next.add(field); return next; });
  const rows = [
    { id: "metadata" as const, label: "标题、组织、角色、时间和地点", current: [entry.current.heading, entry.current.organization, entry.current.role, entry.current.period, entry.current.location].filter(Boolean).join(" · "), latest: [latest.heading, latest.organization, latest.role, latest.period, latest.location].filter(Boolean).join(" · ") },
    { id: "summary" as const, label: "概述", current: entry.current.summary, latest: latest.summary },
    { id: "bullets" as const, label: "简历要点", current: entry.current.bullets.join("\n• "), latest: latest.bullets.join("\n• ") },
    { id: "links" as const, label: "相关链接", current: entry.current.links.join("\n"), latest: latest.links.join("\n") }
  ];
  return <Modal title="对比并同步素材来源" onClose={onClose}>
    <p className="modal-description">选择需要同步的部分。未选内容继续保留当前简历版本，不会被覆盖。</p>
    <div className="sync-comparison-list">{rows.map((row) => <section key={row.id}><label className="checkbox-field"><input type="checkbox" checked={fields.has(row.id)} onChange={() => toggle(row.id)} /><strong>{row.label}</strong></label><div className="sync-columns"><div><span>当前简历</span><p>{row.current ? <BoldText value={row.current} /> : "（空）"}</p></div><div><span>最新素材</span><p>{row.latest ? <BoldText value={row.latest} /> : "（空）"}</p></div></div></section>)}</div>
    <footer className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={!fields.size} onClick={() => onApply(latest, latestRevision, fields)}>同步所选内容</button></footer>
  </Modal>;
}

function StyleSettingsDrawer({ autosave, onClose }: { autosave: AutosavedDraft<ResumeProject>; onClose: () => void }) {
  const applyStyle = (style: ResumeProject["style"]) => autosave.updateDraft((project) => ({ ...project, style: { ...style } }));
  const isReferenceTemplate = autosave.draft.style.templateVersion >= 2;
  return <Modal title="排版设置" variant="drawer" onClose={onClose}>
    <div className="style-drawer-copy"><p className="eyebrow">标准 A4 单栏 · 版式第 {autosave.draft.style.templateVersion} 版</p><p>调整后右侧预览会立即更新；当前仍为同一套单栏模板。第 2 版依据参考简历优化了蓝色层级、教育经历和紧凑排版。</p></div>
    <div className="style-drawer-fields">
      <FormField label="主题色"><input type="color" value={autosave.draft.style.accentColor} onChange={(event) => autosave.updateDraft((project) => ({ ...project, style: { ...project.style, accentColor: event.target.value } }))} /></FormField>
      <FormField label={`正文字号 · ${autosave.draft.style.fontSizePt}pt`}><input type="range" min="9" max="13" step="0.5" value={autosave.draft.style.fontSizePt} onChange={(event) => autosave.updateDraft((project) => ({ ...project, style: { ...project.style, fontSizePt: Number(event.target.value) } }))} /></FormField>
      <FormField label={`行距 · ${autosave.draft.style.lineHeight.toFixed(2)}`}><input type="range" min={isReferenceTemplate ? "1" : "1.2"} max="1.8" step="0.05" value={autosave.draft.style.lineHeight} onChange={(event) => autosave.updateDraft((project) => ({ ...project, style: { ...project.style, lineHeight: Number(event.target.value) } }))} /></FormField>
      {isReferenceTemplate ? <>
        <FormField label={`左右页边距 · ${autosave.draft.style.marginHorizontalMm ?? autosave.draft.style.marginMm}mm`}><input type="range" min="12" max="28" step="1" value={autosave.draft.style.marginHorizontalMm ?? autosave.draft.style.marginMm} onChange={(event) => autosave.updateDraft((project) => ({ ...project, style: { ...project.style, marginHorizontalMm: Number(event.target.value) } }))} /></FormField>
        <FormField label={`上下页边距 · ${autosave.draft.style.marginVerticalMm ?? autosave.draft.style.marginMm}mm`}><input type="range" min="10" max="28" step="0.5" value={autosave.draft.style.marginVerticalMm ?? autosave.draft.style.marginMm} onChange={(event) => autosave.updateDraft((project) => ({ ...project, style: { ...project.style, marginVerticalMm: Number(event.target.value) } }))} /></FormField>
      </> : <FormField label={`页边距 · ${autosave.draft.style.marginMm}mm`}><input type="range" min="12" max="28" step="1" value={autosave.draft.style.marginMm} onChange={(event) => autosave.updateDraft((project) => ({ ...project, style: { ...project.style, marginMm: Number(event.target.value) } }))} /></FormField>}
    </div>
    {!isReferenceTemplate ? <p className="style-drawer-copy"><button className="secondary-button" type="button" onClick={() => applyStyle(DEFAULT_RESUME_STYLE)}>应用参考简历版式</button></p> : <p className="style-drawer-copy"><button className="secondary-button" type="button" onClick={() => applyStyle(LEGACY_RESUME_STYLE)}>切回旧版排版</button></p>}
    <button className="secondary-button" type="button" onClick={() => applyStyle(isReferenceTemplate ? DEFAULT_RESUME_STYLE : LEGACY_RESUME_STYLE)}>恢复本版默认样式</button>
    <p className="preview-footnote">正式 PDF 使用相同模板和本机 Edge 生成。缩放只影响页面内查看效果。</p>
  </Modal>;
}

export function ResumeProjectDetailPage() {
  const { resumeId = "" } = useParams();
  const navigate = useNavigate();
  const bundleState = useLiveQueryValue(() => repository.getResumeProjectBundle(resumeId), [resumeId]);
  const bundle = bundleState.value;
  if (bundleState.loading) return <section className="page"><div className="content-panel loading-panel">正在读取简历项目…</div></section>;
  if (bundleState.error) return <section className="page"><div className="content-panel error-panel">{bundleState.error.message}</div></section>;
  if (!bundle) return <section className="page"><div className="content-panel empty-state"><h2>简历项目不存在或已在回收站</h2><Link className="secondary-button link-button" to="/resumes">返回简历项目</Link></div></section>;
  return <ResumeProjectWorkspace key={bundle.project.id} bundle={bundle} onDeleted={() => navigate("/resumes")} />;
}

function ResumeProjectWorkspace({ bundle, onDeleted }: { bundle: ResumeProjectBundle; onDeleted: () => void }) {
  const autosave = useAutosavedDraft(bundle.project, (draft, revision) => repository.updateResumeProject(draft, revision));
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  const [selection, setSelection] = useState("project");
  const [showPicker, setShowPicker] = useState(false);
  const [syncEntryId, setSyncEntryId] = useState("");
  const [showRewritePicker, setShowRewritePicker] = useState(false);
  const [showRewriteAi, setShowRewriteAi] = useState(false);
  const [rewriteIds, setRewriteIds] = useState<Set<string>>(new Set());
  const [includeRewriteNotes, setIncludeRewriteNotes] = useState(false);
  const [rewriteNotes, setRewriteNotes] = useState<Record<string, string>>({});
  const [showPdfExport, setShowPdfExport] = useState(false);
  const [exportFormat, setExportFormat] = useState<"pdf" | "docx">("pdf");
  const [pdfFilename, setPdfFilename] = useState("");
  const [docxFilename, setDocxFilename] = useState("");
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [pdfStatus, setPdfStatus] = useState<PdfServiceStatus>();
  const [pdfBlob, setPdfBlob] = useState<Blob>();
  const [docxBlob, setDocxBlob] = useState<Blob>();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfResult, setPdfResult] = useState("");
  const pdfAbortController = useRef<AbortController | undefined>(undefined);
  const documentModel = useMemo(() => buildResumeDocumentModel(autosave.draft), [autosave.draft]);
  const selectedModule = autosave.draft.modules.find((module) => module.id === selection);
  const selectedEntryContext = autosave.draft.modules.flatMap((module) => module.entries.map((entry) => ({ module, entry }))).find(({ entry }) => entry.id === selection);
  const sourceState = selectedEntryContext ? bundle.sourceStates.find((state) => state.entryId === selectedEntryContext.entry.id) : undefined;
  const syncContext = autosave.draft.modules.flatMap((module) => module.entries).find((entry) => entry.id === syncEntryId);
  const syncState = syncContext ? bundle.sourceStates.find((state) => state.entryId === syncContext.id) : undefined;
  const targetPages = autosave.draft.targetLength === "one" ? 1 : autosave.draft.targetLength === "two" ? 2 : undefined;
  const overTarget = targetPages !== undefined && documentModel.pages.length > targetPages;
  const overTargetModules = targetPages === undefined ? [] : [...new Set(documentModel.pages.slice(targetPages).flatMap((page) => page.sections.map((section) => section.title)))];

  const openPdfExport = async () => {
    setExportFormat("pdf");
    setPdfFilename(buildResumePdfFilename(autosave.draft));
    setDocxFilename(buildResumeDocxFilename(autosave.draft));
    setPdfBlob(undefined);
    setDocxBlob(undefined);
    setPdfError("");
    setPdfResult("");
    setPdfStatus(undefined);
    const warnings = [...documentModel.missingInformation];
    if (overTarget) warnings.push(`实际 ${documentModel.pages.length} 页，超过当前目标篇幅`);
    if (documentModel.overflowModuleIds.length) warnings.push("存在单个过长条目，请核对跨页位置");
    if (documentModel.pages.length > 10) warnings.push("简历超过 10 页，请确认内容和排版设置");
    const emptyModules = autosave.draft.modules.filter((module) => !module.hidden && (module.kind === "freeText" ? !module.text.trim() : !module.entries.length));
    if (emptyModules.length) warnings.push(`存在空白模块：${emptyModules.map((module) => module.title || "未命名模块").join("、")}`);
    if (autosave.draft.modules.some((module) => module.entries.some((entry) => entry.aiGeneratedAt))) warnings.push("包含 AI 生成或改写内容，请确认事实准确性");
    const candidate = await repository.getAiCandidate("rewrite-resume", autosave.draft.id).catch(() => undefined);
    if (candidate) warnings.push("当前项目还有未采纳的 AI 改写候选");
    setPdfWarnings(warnings);
    setShowPdfExport(true);
    try { setPdfStatus(await getPdfStatus()); }
    catch (error) { setPdfError(error instanceof Error ? error.message : "无法读取 PDF 服务状态"); }
  };

  const generatePdf = async () => {
    pdfAbortController.current?.abort();
    const controller = new AbortController(); pdfAbortController.current = controller;
    setPdfBusy(true); setPdfError(""); setPdfResult(""); setPdfBlob(undefined);
    try {
      await autosave.flush();
      const blob = await requestResumePdf(documentModel, controller.signal);
      if (blob.size < 500) throw new Error("生成的 PDF 文件无效，请重试");
      setPdfBlob(blob);
      setPdfResult(`PDF 已生成，共 ${documentModel.pages.length} 页、${(blob.size / 1024).toFixed(0)} KB。请继续选择保存位置。`);
    } catch (error) { setPdfError(error instanceof DOMException && error.name === "AbortError" ? "已取消 PDF 生成；简历内容未修改" : storageErrorMessage(error, "PDF 生成失败；简历内容未被修改，请检查 Edge 后重试。")); }
    finally { if (pdfAbortController.current === controller) pdfAbortController.current = undefined; setPdfBusy(false); }
  };

  const saveGeneratedPdf = async () => {
    if (!pdfBlob) return;
    setPdfBusy(true); setPdfError("");
    try {
      const baseName = pdfFilename.replace(/\.pdf$/i, "");
      const safeFilename = `${sanitizeWindowsFilename(baseName)}.pdf`;
      setPdfFilename(safeFilename);
      const result = await savePdfBlob(pdfBlob, safeFilename);
      if (result === "cancelled") { setPdfResult("已取消保存；生成结果仍保留在此窗口中。"); return; }
      autosave.updateDraft((project) => ({ ...project, lastExportedAt: new Date().toISOString() }));
      setPdfResult(result === "saved" ? "PDF 已成功保存，应用不会保留历史 PDF 文件。" : "PDF 已交给浏览器下载，应用不会保留历史 PDF 文件。");
    } catch (error) { setPdfError(storageErrorMessage(error, "PDF 保存失败；请检查保存位置后重试。")); }
    finally { setPdfBusy(false); }
  };

  const generateDocx = async () => {
    setPdfBusy(true); setPdfError(""); setPdfResult(""); setDocxBlob(undefined);
    try {
      await autosave.flush();
      const { createResumeDocx } = await import("../services/docx-export");
      const blob = await createResumeDocx(autosave.draft);
      if (blob.size < 500) throw new Error("生成的 Word 文件无效，请重试");
      setDocxBlob(blob);
      setPdfResult(`Word 文件已生成，${(blob.size / 1024).toFixed(0)} KB。内容可在 Word 中继续编辑。`);
    } catch (error) { setPdfError(storageErrorMessage(error, "Word 文件生成失败；简历内容未被修改，请重试。")); }
    finally { setPdfBusy(false); }
  };

  const saveGeneratedDocx = async () => {
    if (!docxBlob) return;
    setPdfBusy(true); setPdfError("");
    try {
      const safeFilename = `${sanitizeWindowsFilename(docxFilename.replace(/\.docx$/i, ""))}.docx`;
      setDocxFilename(safeFilename);
      const result = await saveDocxBlob(docxBlob, safeFilename);
      if (result === "cancelled") { setPdfResult("已取消保存；生成结果仍保留在此窗口中。") ; return; }
      autosave.updateDraft((project) => ({ ...project, lastExportedAt: new Date().toISOString() }));
      setPdfResult(result === "saved" ? "Word 文件已成功保存。应用不会保留导出文件，后续在 Word 中的修改也不会自动回写。" : "Word 文件已交给浏览器下载。应用不会保留导出文件，后续修改也不会自动回写。");
    } catch (error) { setPdfError(storageErrorMessage(error, "Word 文件保存失败；请检查保存位置后重试。")); }
    finally { setPdfBusy(false); }
  };

  const addEntry = (entry: ResumeEntrySnapshot) => {
    autosave.updateDraft((project) => {
      const existing = project.modules.find((module) => module.kind === "material" && module.category === entry.sourceCategory);
      if (existing) return { ...project, modules: project.modules.map((module) => module.id === existing.id ? { ...module, entries: [...module.entries, entry] } : module) };
      return { ...project, modules: [...project.modules, { id: newId(), title: MODULE_TITLES[entry.sourceCategory], kind: "material", category: entry.sourceCategory, hidden: false, entries: [entry], text: "", pageBreakBefore: false }] };
    });
    setSelection(entry.id);
    setShowPicker(false);
  };

  const addEntries = async (entries: ResumeEntrySnapshot[]) => {
    await repository.saveUndoSnapshot(autosave.draft.id, "resumeProject", autosave.draft);
    autosave.updateDraft((project) => {
      const modules = structuredClone(project.modules);
      for (const entry of entries) {
        let module = modules.find((item) => item.kind === "material" && item.category === entry.sourceCategory);
        if (!module) { module = { id: newId(), title: MODULE_TITLES[entry.sourceCategory], kind: "material", category: entry.sourceCategory, hidden: false, entries: [], text: "", pageBreakBefore: false }; modules.push(module); }
        if (!module.entries.some((item) => item.sourceMaterialItemId === entry.sourceMaterialItemId)) module.entries.push(entry);
      }
      return { ...project, modules };
    });
    setShowPicker(false);
  };

  const addFreeModule = () => {
    const title = window.prompt("自由文本模块名称", "核心优势")?.trim();
    if (!title) return;
    const id = newId();
    autosave.updateDraft((project) => ({ ...project, modules: [...project.modules, { id, title, kind: "freeText", hidden: false, entries: [], text: "", pageBreakBefore: false }] }));
    setSelection(id);
  };

  const moveModule = (index: number, offset: -1 | 1) => autosave.updateDraft((project) => {
    const target = index + offset;
    if (target < 0 || target >= project.modules.length) return project;
    const modules = [...project.modules]; const [moved] = modules.splice(index, 1); if (!moved) return project; modules.splice(target, 0, moved); return { ...project, modules };
  });

  const deleteSelection = () => {
    if (selectedEntryContext) {
      if (!window.confirm(`从当前简历移除“${selectedEntryContext.entry.current.heading}”？素材库内容不会被删除。`)) return;
      autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((module) => ({ ...module, entries: module.entries.filter((entry) => entry.id !== selectedEntryContext.entry.id) })) }));
    } else if (selectedModule) {
      if (!window.confirm(`删除模块“${selectedModule.title}”及其中 ${selectedModule.entries.length} 条项目快照？素材库内容不会被删除。`)) return;
      autosave.updateDraft((project) => ({ ...project, modules: project.modules.filter((module) => module.id !== selectedModule.id) }));
    }
    setSelection("project");
  };

  const applySync = (latest: ResumeEntryContent, revision: number, fields: Set<ResumeSyncField>) => {
    if (!syncContext) return;
    autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((module) => ({ ...module, entries: module.entries.map((entry) => {
      if (entry.id !== syncContext.id) return entry;
      return syncResumeEntrySnapshot(entry, latest, revision, fields);
    }) })) }));
    setSyncEntryId("");
  };

  const deleteProject = async () => {
    if (!window.confirm(`将“${autosave.draft.name}”移入回收站？`)) return;
    await autosave.flush();
    await repository.moveResumeProjectToTrash(autosave.draft.id);
    onDeleted();
  };

  return <section className="resume-workspace">
    <header className="resume-editor-header">
      <div><Link className="back-link" to="/resumes">← 返回简历项目</Link><h1>{autosave.draft.name}</h1><span>{autosave.draft.targetRole || "未填写目标岗位"}</span></div>
      <div className="detail-header-actions"><button className="secondary-button" type="button" onClick={() => setOutlineCollapsed((current) => !current)}>{outlineCollapsed ? "显示大纲" : "隐藏大纲"}</button><button className="secondary-button ai-button" type="button" disabled={!autosave.draft.modules.some((module) => module.entries.length)} onClick={() => { const allIds = autosave.draft.modules.flatMap((module) => module.entries.map((entry) => entry.id)); setRewriteIds(new Set(selectedEntryContext ? [selectedEntryContext.entry.id] : allIds)); setIncludeRewriteNotes(false); setRewriteNotes({}); setShowRewritePicker(true); }}>AI 优化条目</button><button className="secondary-button" type="button" onClick={() => setShowStyleSettings(true)}>排版设置</button><SaveIndicator status={autosave.status} errorMessage={autosave.errorMessage} /><button className="secondary-button" type="button" onClick={() => window.print()}>浏览器打印</button><button className="primary-button" type="button" onClick={() => void openPdfExport()}>导出简历</button><button className="text-button danger-text" type="button" onClick={() => void deleteProject()}>删除</button></div>
    </header>

    <div className={`resume-combined-layout${outlineCollapsed ? " outline-collapsed" : ""}`}>
      <aside className="resume-outline">
        <div className="outline-heading"><strong>简历大纲</strong><span>{autosave.draft.modules.reduce((total, module) => total + module.entries.length, 0)} 条素材</span></div>
        <button className={`outline-special ${selection === "project" ? "active" : ""}`} type="button" onClick={() => setSelection("project")}>项目信息与 JD</button>
        <button className={`outline-special ${selection === "profile" ? "active" : ""}`} type="button" onClick={() => setSelection("profile")}>个人资料快照</button>
        {autosave.draft.modules.map((module, moduleIndex) => <div className="outline-module" key={module.id}>
          <div className="outline-module-row"><button className={selection === module.id ? "active" : ""} type="button" onClick={() => setSelection(module.id)}>{module.hidden ? "（隐藏）" : ""}{module.title}</button><div><button type="button" disabled={moduleIndex === 0} onClick={() => moveModule(moduleIndex, -1)} aria-label="上移模块">↑</button><button type="button" disabled={moduleIndex === autosave.draft.modules.length - 1} onClick={() => moveModule(moduleIndex, 1)} aria-label="下移模块">↓</button></div></div>
          {module.entries.map((entry, entryIndex) => <div className="outline-entry-row" key={entry.id}><button className={selection === entry.id ? "active" : ""} type="button" onClick={() => setSelection(entry.id)}><span>{entry.current.heading || "未命名条目"}</span><small>{entry.sourceVersionName}</small></button><div><button type="button" disabled={entryIndex === 0} onClick={() => autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((item) => { if (item.id !== module.id) return item; const entries = [...item.entries]; [entries[entryIndex - 1], entries[entryIndex]] = [entries[entryIndex]!, entries[entryIndex - 1]!]; return { ...item, entries }; }) }))}>↑</button><button type="button" disabled={entryIndex === module.entries.length - 1} onClick={() => autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((item) => { if (item.id !== module.id) return item; const entries = [...item.entries]; [entries[entryIndex + 1], entries[entryIndex]] = [entries[entryIndex]!, entries[entryIndex + 1]!]; return { ...item, entries }; }) }))}>↓</button></div></div>)}
        </div>)}
        <div className="outline-actions"><button className="primary-button" type="button" onClick={() => setShowPicker(true)}>添加素材</button><button className="secondary-button" type="button" onClick={addFreeModule}>添加文本模块</button></div>
      </aside>
      <main className="resume-content-editor">
        {selection === "project" ? <ProjectInfoEditor autosave={autosave} /> : selection === "profile" ? <ProfileSnapshotEditor autosave={autosave} profileSource={bundle.profileSource} /> : selectedEntryContext ? <EntryEditor entry={selectedEntryContext.entry} moduleId={selectedEntryContext.module.id} sourceState={sourceState} autosave={autosave} onReview={() => setSyncEntryId(selectedEntryContext.entry.id)} /> : selectedModule ? <ModuleEditor module={selectedModule} autosave={autosave} /> : null}
        {(selectedEntryContext || selectedModule) ? <div className="selection-danger"><button className="text-button danger-text" type="button" onClick={deleteSelection}>{selectedEntryContext ? "从简历移除条目" : "删除当前模块"}</button></div> : null}
      </main>
      <aside className="resume-live-preview" aria-label="实时排版预览">
        <div className="preview-status-row"><div><strong>实际 {documentModel.pages.length} 页</strong><span>目标：{autosave.draft.targetLength === "one" ? "一页" : autosave.draft.targetLength === "two" ? "两页" : "不限页数"}</span></div>{overTarget ? <span className="source-chip updated">超过目标篇幅，请手动精简</span> : <span className="source-chip current">篇幅符合目标</span>}</div>
        {overTarget ? <div className="warning-banner">超过目标篇幅的后续页面包含：{overTargetModules.join("、") || "较长的正文内容"}。系统不会自动删除或截断内容。</div> : null}
        {documentModel.overflowModuleIds.length ? <div className="warning-banner">存在单个过长条目，可能跨越页面边界；请检查对应模块的分页效果。</div> : null}
        {documentModel.missingInformation.length ? <div className="warning-banner">缺失提示：{documentModel.missingInformation.join("；")}。这些提示不会阻止预览或打印。</div> : null}
        <div className="live-preview-pages"><ResumePreview model={documentModel} showPhotoPlaceholder {...(selectedEntryContext ? { activeEntryId: selectedEntryContext.entry.id } : {})} /></div>
      </aside>
    </div>
    {showStyleSettings ? <StyleSettingsDrawer autosave={autosave} onClose={() => setShowStyleSettings(false)} /> : null}
    {showPicker ? <MaterialPicker project={autosave.draft} onAdd={addEntry} onAddMany={addEntries} onClose={() => setShowPicker(false)} /> : null}
    {syncContext && syncState?.latestContent && syncState.latestRevision !== undefined ? <SourceSyncModal entry={syncContext} latest={syncState.latestContent} latestRevision={syncState.latestRevision} onApply={applySync} onClose={() => setSyncEntryId("")} /> : null}
    {showRewritePicker ? <Modal title="选择要优化的简历条目" onClose={() => setShowRewritePicker(false)}><p className="modal-description">可选择单条、多条或全部条目。此时不会调用 AI。</p><div className="inline-actions"><button className="text-button" type="button" onClick={() => setRewriteIds(new Set(autosave.draft.modules.flatMap((module) => module.entries.map((entry) => entry.id))))}>全选</button><button className="text-button" type="button" onClick={() => setRewriteIds(new Set())}>清空</button></div><div className="ai-choice-list">{autosave.draft.modules.flatMap((module) => module.entries).map((entry) => <label key={entry.id}><input type="checkbox" checked={rewriteIds.has(entry.id)} onChange={() => setRewriteIds((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} /><span><strong>{entry.current.heading}</strong>{entry.sourceMaterialName} · {entry.sourceVersionName}</span></label>)}</div><label className="checkbox-field"><input type="checkbox" checked={includeRewriteNotes} onChange={(event) => setIncludeRewriteNotes(event.target.checked)} /><span>同时参考所选素材的面试备注（默认不发送）</span></label><footer className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowRewritePicker(false)}>取消</button><button className="primary-button" type="button" disabled={!rewriteIds.size} onClick={() => { void (async () => { const selected = autosave.draft.modules.flatMap((module) => module.entries).filter((entry) => rewriteIds.has(entry.id)); setRewriteNotes(includeRewriteNotes ? await repository.getInterviewNoteContents(selected.map((entry) => entry.sourceVersionId)) : {}); setShowRewritePicker(false); setShowRewriteAi(true); })().catch((error) => window.alert(error instanceof Error ? error.message : "读取面试备注失败")); }}>下一步：确认发送范围</button></footer></Modal> : null}
    {showRewriteAi ? <AiTaskModal title="AI 优化简历项目条目" taskType="rewrite-resume" targetId={autosave.draft.id} selectedPayload={{ targetRole: autosave.draft.targetRole, jdText: autosave.draft.jdText, entries: autosave.draft.modules.flatMap((module) => module.entries).filter((entry) => rewriteIds.has(entry.id)).map((entry) => ({ id: entry.id, sourceMaterialName: entry.sourceMaterialName, content: entry.current, ...(rewriteNotes[entry.sourceVersionId] ? { interviewNote: rewriteNotes[entry.sourceVersionId] } : {}) })) }} dataScope={[`选中的 ${rewriteIds.size} 条简历内容`, ...(autosave.draft.jdText ? ["当前项目 JD"] : []), ...(Object.keys(rewriteNotes).length ? [`主动选择的 ${Object.keys(rewriteNotes).length} 张面试备注`] : ["不包含面试备注"]), "不包含未选素材"]} onApply={async (response) => { await repository.saveUndoSnapshot(autosave.draft.id, "resumeProject", autosave.draft); const rewrites = new Map(response.result.rewrites.map((item) => [item.referenceId, item])); autosave.updateDraft((project) => ({ ...project, modules: project.modules.map((module) => ({ ...module, entries: module.entries.map((entry) => { const rewrite = rewrites.get(entry.id); return rewrite ? { ...entry, current: { ...entry.current, summary: rewrite.summary, bullets: rewrite.bullets }, aiGeneratedAt: new Date().toISOString(), aiModel: response.model } : entry; }) })) })); }} onClose={() => setShowRewriteAi(false)} /> : null}
    {showPdfExport ? <Modal title="导出简历" onClose={() => { if (!pdfBusy) setShowPdfExport(false); }}>
      <div className="inline-actions"><button className={exportFormat === "pdf" ? "primary-button" : "secondary-button"} type="button" onClick={() => { setExportFormat("pdf"); setPdfError(""); setPdfResult(""); }}>PDF</button><button className={exportFormat === "docx" ? "primary-button" : "secondary-button"} type="button" onClick={() => { setExportFormat("docx"); setPdfError(""); setPdfResult(""); }}>Word（.docx）</button></div>
      {exportFormat === "pdf" ? <><p className="modal-description">PDF 保持固定版式，正文可复制和搜索。生成过程只使用内存与系统临时目录，应用不会保存历史文件。</p>
      <div className={`pdf-service-status ${pdfStatus?.available ? "available" : "unavailable"}`}><strong>{pdfStatus ? pdfStatus.message : pdfError ? "PDF 服务不可用" : "正在检查本机 PDF 服务…"}</strong>{pdfStatus?.edgeVersion ? <span>{pdfStatus.edgeVersion}</span> : null}</div>
      <div className="pdf-export-summary"><span>预计页数</span><strong>{documentModel.pages.length} 页</strong><span>模板</span><strong>标准 A4 单栏</strong></div></> : <><p className="modal-description">Word 文档由可编辑文字、标题、列表、链接和照片组成。Word 会自行分页，页数可能与 PDF 不同；只有大纲中设置的“从新页面开始”会强制分页。</p><div className="privacy-notice">导出文件不保存在应用中；你在 Word 里的后续修改不会自动回写项目。</div></>}
      {pdfWarnings.length ? <div className="warning-banner"><strong>导出前请核对：</strong><ul>{pdfWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><span>这些提示不会阻止你继续导出。</span></div> : <div className="privacy-notice">未发现缺失信息或篇幅风险。</div>}
      {exportFormat === "pdf" ? <FormField label="PDF 文件名" hint="日期取简历项目首次创建日期；保存窗口中仍可修改。" wide><input value={pdfFilename} onChange={(event) => setPdfFilename(event.target.value)} /></FormField> : <FormField label="Word 文件名" hint="与 PDF 使用相同命名规则；保存窗口中仍可修改。" wide><input value={docxFilename} onChange={(event) => setDocxFilename(event.target.value)} /></FormField>}
      {pdfError ? <p className="inline-error">{pdfError}</p> : null}
      {pdfResult ? <p className="success-message">{pdfResult}</p> : null}
      <footer className="modal-actions"><button className="secondary-button" type="button" disabled={pdfBusy} onClick={() => setShowPdfExport(false)}>关闭</button>{pdfBusy && exportFormat === "pdf" ? <button className="text-button" type="button" onClick={() => pdfAbortController.current?.abort()}>取消生成</button> : null}{exportFormat === "pdf" ? <><button className="secondary-button" type="button" disabled={pdfBusy || !pdfStatus?.available} onClick={() => void generatePdf()}>{pdfBusy ? "正在处理…" : pdfBlob ? "重新生成 PDF" : "生成 PDF"}</button><button className="primary-button" type="button" disabled={pdfBusy || !pdfBlob} onClick={() => void saveGeneratedPdf()}>选择位置并保存</button></> : <><button className="secondary-button" type="button" disabled={pdfBusy} onClick={() => void generateDocx()}>{pdfBusy ? "正在处理…" : docxBlob ? "重新生成 Word" : "生成 Word"}</button><button className="primary-button" type="button" disabled={pdfBusy || !docxBlob} onClick={() => void saveGeneratedDocx()}>选择位置并保存</button></>}</footer>
    </Modal> : null}
  </section>;
}
