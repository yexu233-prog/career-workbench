import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CATEGORY_FIELDS,
  INTERVIEW_NOTE_OUTLINE,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  type InterviewNote,
  type MaterialCategory,
  type MaterialExperience,
  type MaterialItem,
  type MaterialVersion,
  type SaveStatus
} from "@career-workbench/domain";
import { MaterialFactsChangedError, RevisionConflictError, repository } from "@career-workbench/database";
import { FormField } from "../components/FormField";
import { Modal } from "../components/Modal";
import { SaveIndicator } from "../components/SaveIndicator";
import { AiTaskModal } from "../components/AiTaskModal";
import { BoldTextarea } from "../components/BoldTextarea";
import { useAutosavedDraft } from "../hooks/useAutosavedDraft";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";

const splitList = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
const joinList = (value: string[]) => value.join("，");

type FieldPurpose = "resume" | "internal" | "ai";

function PurposeLabel({ children, purpose, detail }: { children: string; purpose: FieldPurpose; detail?: string }) {
  const label = purpose === "resume" ? "显示在简历中" : purpose === "ai" ? "用于 AI 参考" : "仅内部使用";
  return <span className="field-label-with-purpose"><span>{children}</span><span className={`field-purpose ${purpose}`}>{label}{detail ? ` · ${detail}` : ""}</span></span>;
}

const CATEGORY_EXAMPLES: Record<MaterialCategory, { heading: string; organization: string; meta: string }> = {
  work: { heading: "产品经理", organization: "示例科技有限公司", meta: "2024.03 – 至今 · 上海" },
  project: { heading: "求职工作台项目", organization: "", meta: "项目负责人 · 2026.01 – 2026.06" },
  education: { heading: "计算机科学与技术", organization: "示例大学", meta: "本科 · 2021.09 – 2025.06" },
  campus: { heading: "学生会产品部", organization: "示例大学", meta: "负责人 · 2023.09 – 2024.06" },
  volunteer: { heading: "社区数字助老活动", organization: "示例志愿者协会", meta: "志愿者 · 2024.05" },
  certificate: { heading: "示例专业能力证书", organization: "示例认证机构", meta: "2025.03" },
  custom: { heading: "公开演讲经历", organization: "示例行业大会", meta: "分享嘉宾 · 2025.08" }
};

function SharedFactsEditor({ item, onStatus }: { item: MaterialItem; onStatus: (status: SaveStatus) => void }) {
  const autosave = useAutosavedDraft(item, (draft, revision) => repository.updateMaterial(draft, revision), onStatus);
  const { draft, updateDraft, status, errorMessage } = autosave;
  const fields = CATEGORY_FIELDS[draft.category];

  return (
    <div className="editor-section">
      <div className="section-heading-row">
        <div><p className="eyebrow">所有版本共用</p><h2>共享事实</h2></div>
        <SaveIndicator status={status} errorMessage={errorMessage} />
      </div>
      {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
      <div className="form-grid">
        <FormField label={<PurposeLabel purpose="internal">素材库内部名称</PurposeLabel>} wide>
          <input value={draft.internalName} onChange={(event) => updateDraft((current) => ({ ...current, internalName: event.target.value }))} />
        </FormField>
        <FormField label={<PurposeLabel purpose="internal">素材类别</PurposeLabel>}>
          <select value={draft.category} onChange={(event) => updateDraft((current) => ({ ...current, category: event.target.value as MaterialItem["category"] }))}>
            {MATERIAL_CATEGORIES.map((value) => <option key={value} value={value}>{MATERIAL_CATEGORY_LABELS[value]}</option>)}
          </select>
        </FormField>
        <FormField label={<PurposeLabel purpose="internal">标签</PurposeLabel>} hint="使用逗号分隔">
          <input value={joinList(draft.tags)} onChange={(event) => updateDraft((current) => ({ ...current, tags: splitList(event.target.value) }))} placeholder="如：支付、B端、跨部门" />
        </FormField>
        <FormField label={<PurposeLabel purpose="ai">技能与工具</PurposeLabel>} hint="使用逗号分隔">
          <input value={joinList(draft.skills)} onChange={(event) => updateDraft((current) => ({ ...current, skills: splitList(event.target.value) }))} placeholder="如：SQL、Figma" />
        </FormField>
        <FormField label={<PurposeLabel purpose="resume" detail="条目链接">相关链接</PurposeLabel>} hint="使用逗号或换行分隔">
          <input value={joinList(draft.links)} onChange={(event) => updateDraft((current) => ({ ...current, links: splitList(event.target.value) }))} placeholder="作品、项目或证明链接" />
        </FormField>
      </div>

      <div className="subsection-title"><h3>{MATERIAL_CATEGORY_LABELS[draft.category]}信息</h3><span>均为可选字段</span></div>
      <details className="resume-example">
        <summary>查看这些字段在简历中的呈现示例</summary>
        <div className="resume-example-entry"><div><strong>{CATEGORY_EXAMPLES[draft.category].heading}</strong>{CATEGORY_EXAMPLES[draft.category].organization ? <span>{CATEGORY_EXAMPLES[draft.category].organization}</span> : null}</div><span>{CATEGORY_EXAMPLES[draft.category].meta}</span><p>· 版本中的概述和简历要点会显示在这里；示例信息均为虚构。</p></div>
      </details>
      <div className="form-grid">
        {fields.map((field) => field.type === "boolean" ? (
          <label className="checkbox-field" key={field.key}>
            <input type="checkbox" checked={Boolean(draft.facts[field.key])} onChange={(event) => updateDraft((current) => ({
              ...current,
              facts: { ...current.facts, [field.key]: event.target.checked }
            }))} />
            <span><PurposeLabel purpose={field.resumePlacement ? "resume" : "internal"} {...(field.resumePlacement ? { detail: field.resumePlacement } : {})}>{field.label}</PurposeLabel></span>
          </label>
        ) : (
          <FormField key={field.key} label={<PurposeLabel purpose={field.resumePlacement ? "resume" : "internal"} {...(field.resumePlacement ? { detail: field.resumePlacement } : {})}>{field.label}</PurposeLabel>}>
            <input
              value={typeof draft.facts[field.key] === "string" ? String(draft.facts[field.key]) : ""}
              placeholder={field.placeholder}
              onChange={(event) => updateDraft((current) => ({
                ...current,
                facts: { ...current.facts, [field.key]: event.target.value }
              }))}
            />
          </FormField>
        ))}
      </div>

      <FormField label={<PurposeLabel purpose="ai">原始事实笔记</PurposeLabel>} hint="记录真实背景、行动、结果和证据，不直接进入简历。" wide>
        <textarea rows={10} value={draft.factNotes} onChange={(event) => updateDraft((current) => ({ ...current, factNotes: event.target.value }))} placeholder="例如：当时遇到了什么问题？你具体做了什么？结果如何？" />
      </FormField>
    </div>
  );
}

function ExperienceEditor({ materialItemId, experience, onStatus, onDelete }: {
  materialItemId: string;
  experience: MaterialExperience;
  onStatus: (status: SaveStatus) => void;
  onDelete: () => void;
}) {
  const autosave = useAutosavedDraft(experience, (draft, revision) => repository.updateExperience(materialItemId, draft, revision), onStatus);
  const { draft, updateDraft, status, errorMessage } = autosave;
  return <div className="editor-section experience-editor">
    <div className="section-heading-row"><div><p className="eyebrow">仅作为原始经历参考 · 不直接进入简历</p><h2>经历内容</h2></div><SaveIndicator status={status} errorMessage={errorMessage} /></div>
    {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
    <FormField label="经历名称" wide><input value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} /></FormField>
    <FormField label="经历原始描述" hint="自由记录即可；AI 生成时只会发送你勾选的经历。" wide>
      <textarea className="experience-content-editor" rows={20} value={draft.content} onChange={(event) => updateDraft((current) => ({ ...current, content: event.target.value }))} placeholder={"START 法则参考（可直接覆盖）：\nS｜情境：当时的背景和问题是什么？\nT｜任务：你负责什么、目标是什么？\nA｜行动：你具体采取了哪些行动？\nR｜结果：产生了什么结果或证据？没有核实的数字不要填写。\nT｜复盘：你学到了什么，哪些经验可以复用？"} />
    </FormField>
    <div className="editor-footer-actions"><button className="text-button danger-text" type="button" onClick={onDelete}>移入回收站</button></div>
  </div>;
}

function InterviewNoteEditor({ version, note, onStatus }: {
  version: MaterialVersion;
  note: InterviewNote | undefined;
  onStatus: (status: SaveStatus) => void;
}) {
  const timestamp = version.updatedAt;
  const source: InterviewNote = note ?? {
    id: `new-${version.id}`,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
    materialVersionId: version.id,
    content: "",
    basedOnVersionRevision: version.revision
  };
  const autosave = useAutosavedDraft(source, async (draft, revision) => repository.upsertInterviewNote(
    version.id,
    draft.content,
    revision === 0 ? undefined : revision,
    { ...(draft.aiGeneratedAt ? { aiGeneratedAt: draft.aiGeneratedAt } : {}), ...(draft.aiModel ? { aiModel: draft.aiModel } : {}) }
  ), onStatus);
  const { draft, updateDraft, status, errorMessage } = autosave;
  const isStale = note ? note.basedOnVersionRevision < version.revision : false;
  const [showAi, setShowAi] = useState(false);
  const [includeCurrentNote, setIncludeCurrentNote] = useState(false);

  const deleteNote = async () => {
    if (!note || !window.confirm("将这张面试备注卡移入回收站？")) return;
    try {
      await repository.moveInterviewNoteToTrash(note.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除面试备注失败");
    }
  };

  return (
    <div className="note-editor">
      <div className="section-heading-row compact">
        <div>
          <h3>面试备注卡</h3>
          <p><span className="field-purpose internal">仅内部使用</span> 自由展开这段经历，不会进入简历正文；只有主动勾选时才供 AI 参考。</p>
        </div>
        <SaveIndicator status={status} errorMessage={errorMessage} />
      </div>
      {isStale ? <p className="warning-banner">版本内容已更新，这张备注卡可能需要复查。</p> : null}
      {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
      <div className="inline-actions">
        <button className="secondary-button ai-button" type="button" onClick={() => setShowAi(true)}>AI 辅助</button>
        <button className="secondary-button" type="button" onClick={() => updateDraft((current) => ({
          ...current,
          content: current.content.trim() ? `${current.content.trim()}\n\n${INTERVIEW_NOTE_OUTLINE}` : INTERVIEW_NOTE_OUTLINE
        }))}>插入推荐提纲</button>
        {note ? <button className="text-button danger-text" type="button" onClick={() => void deleteNote()}>删除备注卡</button> : null}
      </div>
      <textarea className="long-editor" rows={22} value={draft.content} onChange={(event) => updateDraft((current) => ({ ...current, content: event.target.value }))} placeholder="记录经历背景、关键行动、结果证据、复盘和可能追问……" />
      <label className="checkbox-field"><input type="checkbox" checked={includeCurrentNote} onChange={(event) => setIncludeCurrentNote(event.target.checked)} /><span>下次 AI 调用同时参考当前备注（默认不发送）</span></label>
      {showAi ? <AiTaskModal title="AI 生成或修改面试备注" taskType="generate-interview-note" targetId={version.id} selectedPayload={{ version: { id: version.id, summary: version.summary, bullets: version.bullets, targetRole: version.targetRole, jdText: version.jdText }, ...(includeCurrentNote ? { currentNote: draft.content } : {}) }} dataScope={["当前素材版本", ...(version.jdText ? ["版本附属 JD"] : []), ...(includeCurrentNote ? ["当前面试备注"] : [])]} onApply={async (response) => { await repository.saveUndoSnapshot(version.id, "interviewNote", draft); updateDraft((current) => ({ ...current, content: response.result.content, aiGeneratedAt: new Date().toISOString(), aiModel: response.model })); }} onClose={() => setShowAi(false)} /> : null}
    </div>
  );
}

function VersionEditor({ version, note, item, onStatus, onDuplicate, onDelete, onAiCreated }: {
  version: MaterialVersion;
  note: InterviewNote | undefined;
  item: MaterialItem;
  onStatus: (status: SaveStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAiCreated: (version: MaterialVersion) => void;
}) {
  const [tab, setTab] = useState<"content" | "note">("content");
  const autosave = useAutosavedDraft(version, (draft, revision) => repository.updateVersion(draft, revision), onStatus);
  const { draft, updateDraft, savedRevision, acceptSavedRevision, status, errorMessage } = autosave;
  const [showAi, setShowAi] = useState(false);
  const [showExperiencePicker, setShowExperiencePicker] = useState(false);
  const [selectedExperienceIds, setSelectedExperienceIds] = useState<string[]>([]);
  const [manualReferenceIds, setManualReferenceIds] = useState<string[]>([]);
  const [includeInterviewNote, setIncludeInterviewNote] = useState(false);
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false);
  const markingReviewedRef = useRef(false);
  const [reviewError, setReviewError] = useState("");
  const reviewPending = version.sourceFactRevision < item.factRevision;
  const canMarkReviewed = reviewPending && (status === "idle" || status === "saved") && !isMarkingReviewed;
  const usesExperienceContent = ["work", "project", "campus"].includes(item.category);
  const activeExperiences = (item.experiences ?? []).filter((experience) => !experience.deletedAt);

  const markReviewed = async () => {
    if (!canMarkReviewed || markingReviewedRef.current) return;
    markingReviewedRef.current = true;
    setIsMarkingReviewed(true);
    setReviewError("");
    try {
      const saved = await repository.markVersionFactsReviewed(version.id, savedRevision, item.factRevision);
      acceptSavedRevision(saved.revision);
      onStatus("saved");
    } catch (error) {
      setReviewError(error instanceof MaterialFactsChangedError
        ? error.message
        : error instanceof RevisionConflictError
          ? "版本已在其他窗口中修改，请重新打开并检查后再确认。"
          : error instanceof Error ? error.message : "记录核对状态失败，请稍后重试。");
    } finally {
      markingReviewedRef.current = false;
      setIsMarkingReviewed(false);
    }
  };

  const toggleExperience = (id: string) => setSelectedExperienceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const moveSelectedExperience = (index: number, offset: -1 | 1) => setSelectedExperienceIds((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    const [value] = next.splice(index, 1);
    if (value) next.splice(target, 0, value);
    return next;
  });

  const openAiGeneration = () => {
    if (usesExperienceContent) {
      if (!activeExperiences.some((experience) => experience.content.trim())) {
        window.alert("请先添加并填写至少一段经历内容，再生成岗位化版本。");
        return;
      }
      setSelectedExperienceIds([]);
      setShowExperiencePicker(true);
    } else setShowAi(true);
  };

  const selectedExperiences = selectedExperienceIds.flatMap((id) => {
    const experience = activeExperiences.find((candidate) => candidate.id === id);
    return experience?.content.trim() ? [{ id: experience.id, revision: experience.revision, name: experience.name, content: experience.content }] : [];
  });

  const updateBullet = (index: number, value: string) => updateDraft((current) => ({
    ...current,
    bullets: current.bullets.map((bullet, bulletIndex) => bulletIndex === index ? value : bullet)
  }));
  const moveBullet = (index: number, offset: -1 | 1) => updateDraft((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.bullets.length) return current;
    const bullets = [...current.bullets];
    const [moved] = bullets.splice(index, 1);
    if (moved === undefined) return current;
    bullets.splice(target, 0, moved);
    return { ...current, bullets };
  });

  return (
    <div className="editor-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{draft.isOriginal ? "基础表达" : "岗位化表达"}</p>
          <h2>{draft.name}</h2>
        </div>
        <div className="inline-actions"><button className="secondary-button ai-button" type="button" onClick={openAiGeneration}>AI 生成新版本</button><SaveIndicator status={status} errorMessage={errorMessage} /></div>
      </div>
      {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
      {reviewError ? <p className="inline-error" role="alert">{reviewError}</p> : null}

      <fieldset className="version-edit-fieldset" disabled={isMarkingReviewed}>
      {usesExperienceContent && activeExperiences.length ? <details className="experience-reference-panel">
        <summary>经历内容参考（仅供你查看，不自动写入简历）</summary>
        <div className="experience-reference-list">{activeExperiences.map((experience) => <label key={experience.id}>
          <input type="checkbox" checked={manualReferenceIds.includes(experience.id)} onChange={() => setManualReferenceIds((current) => current.includes(experience.id) ? current.filter((id) => id !== experience.id) : [...current, experience.id])} />
          <span><strong>{experience.name}</strong>{manualReferenceIds.includes(experience.id) ? <span className="experience-reference-content">{experience.content || "尚未填写内容"}</span> : null}</span>
        </label>)}</div>
      </details> : null}

      <div className="tab-row" role="tablist">
        <button className={tab === "content" ? "active" : ""} type="button" onClick={() => setTab("content")}>简历内容</button>
        <button className={tab === "note" ? "active" : ""} type="button" onClick={() => setTab("note")}>面试备注</button>
      </div>

      {tab === "note" ? (
        <InterviewNoteEditor key={note?.id ?? `new-${version.id}`} version={version} note={note} onStatus={onStatus} />
      ) : (
        <>
          {reviewPending ? <div className="warning-banner review-needed-panel" role="status">
            <div>
              <strong>共享事实或经历内容已更新</strong>
              <p>请检查当前版本内容与最新资料是否一致。核对后确认，系统只会记录状态，不会修改简历正文。</p>
            </div>
            <button className="secondary-button" type="button" disabled={!canMarkReviewed} onClick={() => void markReviewed()}>{isMarkingReviewed ? "正在记录…" : "已核对此版本"}</button>
          </div> : null}
          <div className="form-grid">
            <FormField label={<PurposeLabel purpose="internal">版本名称</PurposeLabel>}>
              <input disabled={draft.isOriginal} value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} />
            </FormField>
            <FormField label={<PurposeLabel purpose="internal">输出语言</PurposeLabel>}>
              <select value={draft.language} onChange={(event) => updateDraft((current) => ({ ...current, language: event.target.value as MaterialVersion["language"] }))}>
                <option value="zh-CN">中文</option><option value="en">英文</option>
              </select>
            </FormField>
            <FormField label={<PurposeLabel purpose="ai">目标岗位</PurposeLabel>}>
              <input value={draft.targetRole} onChange={(event) => updateDraft((current) => ({ ...current, targetRole: event.target.value }))} placeholder="可选" />
            </FormField>
            <FormField label={<PurposeLabel purpose="ai">表达重点</PurposeLabel>}>
              <input value={draft.emphasis} onChange={(event) => updateDraft((current) => ({ ...current, emphasis: event.target.value }))} placeholder="如：突出业务分析" />
            </FormField>
            <FormField label={<PurposeLabel purpose="internal">版本标签</PurposeLabel>} hint="使用逗号分隔">
              <input value={joinList(draft.tags)} onChange={(event) => updateDraft((current) => ({ ...current, tags: splitList(event.target.value) }))} />
            </FormField>
            <FormField label={<PurposeLabel purpose="internal">内部备注</PurposeLabel>} wide hint="仅供内部核对，不会出现在最终简历上。">
              <textarea rows={6} value={draft.notes} onChange={(event) => updateDraft((current) => ({ ...current, notes: event.target.value }))} />
            </FormField>
          </div>
          <FormField label={<PurposeLabel purpose="resume" detail="条目正文">概述</PurposeLabel>} wide>
            <BoldTextarea rows={4} value={draft.summary} onValueChange={(value) => updateDraft((current) => ({ ...current, summary: value }))} placeholder="可选的一段概述" />
          </FormField>

          <div className="subsection-title"><h3>简历要点 <span className="field-purpose resume">显示在简历中 · 项目符号正文</span></h3><span>可以为空并作为草稿保存</span></div>
          <div className="bullet-editor-list">
            {draft.bullets.map((bullet, index) => (
              <div className="bullet-editor" key={index}>
                <span className="bullet-number">{index + 1}</span>
                <BoldTextarea rows={3} value={bullet} onValueChange={(value) => updateBullet(index, value)} />
                <div className="bullet-actions">
                  <button type="button" disabled={index === 0} onClick={() => moveBullet(index, -1)} aria-label="上移">↑</button>
                  <button type="button" disabled={index === draft.bullets.length - 1} onClick={() => moveBullet(index, 1)} aria-label="下移">↓</button>
                  <button className="danger-text" type="button" onClick={() => updateDraft((current) => ({ ...current, bullets: current.bullets.filter((_, bulletIndex) => bulletIndex !== index) }))}>删除</button>
                </div>
              </div>
            ))}
            <button className="add-row-button" type="button" onClick={() => updateDraft((current) => ({ ...current, bullets: [...current.bullets, ""] }))}>＋ 添加一条简历要点</button>
          </div>

          <FormField label={<PurposeLabel purpose="ai">版本附属 JD 文本</PurposeLabel>} hint="可选；AI 生成新版本时会在发送范围中明确列出，不进入简历。" wide>
            <textarea rows={5} value={draft.jdText} onChange={(event) => updateDraft((current) => ({ ...current, jdText: event.target.value }))} />
          </FormField>
          {!usesExperienceContent && note?.content.trim() ? <label className="checkbox-field"><input type="checkbox" checked={includeInterviewNote} onChange={(event) => setIncludeInterviewNote(event.target.checked)} /><span>AI 生成新版本时同时参考面试备注（默认不发送）</span></label> : null}
          <div className="editor-footer-actions">
            <button className="secondary-button" type="button" onClick={onDuplicate}>复制为新版本</button>
            {!draft.isOriginal ? <button className="text-button danger-text" type="button" onClick={onDelete}>移入回收站</button> : null}
          </div>
        </>
      )}
      </fieldset>
      {showExperiencePicker ? <Modal title="选择用于生成的经历" onClose={() => setShowExperiencePicker(false)}>
        <p className="field-hint">只会发送已勾选的经历。调整顺序后，AI 会按这个顺序组织候选要点。</p>
        <div className="ai-experience-picker">{activeExperiences.map((experience) => {
          const index = selectedExperienceIds.indexOf(experience.id);
          return <div className="ai-experience-option" key={experience.id}>
            <label><input type="checkbox" disabled={!experience.content.trim()} checked={index >= 0} onChange={() => toggleExperience(experience.id)} /><span><strong>{experience.name}</strong><span>{experience.content.trim() ? experience.content : "尚未填写，不能用于生成"}</span></span></label>
            {index >= 0 ? <div className="ai-experience-order"><span>{index + 1}</span><button type="button" disabled={index === 0} onClick={() => moveSelectedExperience(index, -1)} aria-label={`将${experience.name}上移`}>↑</button><button type="button" disabled={index === selectedExperienceIds.length - 1} onClick={() => moveSelectedExperience(index, 1)} aria-label={`将${experience.name}下移`}>↓</button></div> : null}
          </div>;
        })}</div>
        <footer className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowExperiencePicker(false)}>取消</button><button className="primary-button" type="button" disabled={!selectedExperiences.length} onClick={() => { setShowExperiencePicker(false); setShowAi(true); }}>继续生成候选</button></footer>
      </Modal> : null}
      {showAi ? <AiTaskModal title="AI 生成素材新版本" taskType="generate-version" targetId={version.id} selectedPayload={usesExperienceContent ? { experienceBased: true, material: { category: item.category, facts: item.facts, factNotes: item.factNotes, skills: item.skills }, experiences: selectedExperiences.map(({ id, name, content }) => ({ id, name, content })), targetRole: draft.targetRole, jdText: draft.jdText, emphasis: draft.emphasis } : { material: { id: item.id, category: item.category, facts: item.facts, factNotes: item.factNotes, skills: item.skills }, referenceVersion: { id: draft.id, name: draft.name, summary: draft.summary, bullets: draft.bullets, targetRole: draft.targetRole, emphasis: draft.emphasis }, ...(draft.jdText ? { jdText: draft.jdText } : {}), ...(includeInterviewNote && note?.content ? { interviewNote: note.content } : {}) }} dataScope={usesExperienceContent ? ["共享事实与事实笔记", ...selectedExperiences.map((experience) => `经历“${experience.name}”`), ...(draft.targetRole ? ["目标岗位"] : []), ...(draft.jdText ? ["版本附属 JD"] : [])] : ["共享事实与事实笔记", `参考版本“${draft.name}”`, ...(draft.jdText ? ["版本附属 JD"] : []), ...(includeInterviewNote && note?.content ? ["面试备注"] : [])]} onApply={async (response) => {
        const name = window.prompt("确认新版本名称", `${draft.name}（AI 版）`)?.trim();
        if (!name) throw new Error("已取消创建新版本");
        if (usesExperienceContent) {
          const saved = await repository.createAiVersionFromExperiences(item.id, { name, language: draft.language, targetRole: draft.targetRole, jdText: draft.jdText, emphasis: draft.emphasis, summary: response.result.summary, bullets: response.result.bullets, aiModel: response.model, experienceRevisions: selectedExperiences.map(({ id, revision }) => ({ id, revision })) });
          onAiCreated(saved);
          return;
        }
        const created = await repository.createVersion(item.id, { name, language: draft.language, referenceVersionId: draft.id });
        const saved = await repository.updateVersion({ ...created, summary: response.result.summary, bullets: response.result.bullets, creationMethod: "ai", targetRole: draft.targetRole, jdText: draft.jdText, emphasis: draft.emphasis, aiGeneratedAt: new Date().toISOString(), aiModel: response.model }, created.revision);
        onAiCreated(saved);
      }} onClose={() => setShowAi(false)} /> : null}
    </div>
  );
}

function NewVersionModal({ versions, initialReferenceId, onCreated, onClose }: {
  versions: MaterialVersion[];
  initialReferenceId?: string | undefined;
  onCreated: (version: MaterialVersion) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialReferenceId ? "复制版本" : "");
  const [referenceId, setReferenceId] = useState(initialReferenceId ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const materialItemId = versions[0]?.materialItemId;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!materialItemId) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await repository.createVersion(materialItemId, {
        name,
        ...(referenceId ? { referenceVersionId: referenceId, inheritReviewState: true } : {})
      });
      onCreated(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建版本失败");
      setSubmitting(false);
    }
  };

  return (
    <Modal title="新建素材版本" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <FormField label="版本名称" wide><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品经理版" /></FormField>
        <FormField label="参考内容" hint="新版本仍与其他版本平级。" wide>
          <select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>
            <option value="">从空白内容开始</option>
            {versions.map((version) => <option key={version.id} value={version.id}>参考：{version.name}</option>)}
          </select>
        </FormField>
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="submit" disabled={!name.trim() || submitting}>{submitting ? "正在创建…" : "创建版本"}</button>
        </footer>
      </form>
    </Modal>
  );
}

function NewExperienceModal({ materialItemId, initialName, onCreated, onClose }: {
  materialItemId: string;
  initialName: string;
  onCreated: (experience: MaterialExperience) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true); setError("");
    try { onCreated(await repository.createExperience(materialItemId, name)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "新建经历失败"); setSubmitting(false); }
  };
  return <Modal title="新建经历内容" onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => void submit(event)}>
      <FormField label="经历名称" hint="用于素材详情和快捷列表中识别。" wide><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：会员增长项目" /></FormField>
      {error ? <p className="form-error">{error}</p> : null}
      <footer className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!name.trim() || submitting}>{submitting ? "正在创建…" : "创建并填写"}</button></footer>
    </form>
  </Modal>;
}

export function MaterialDetailPage() {
  const { materialId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bundleState = useLiveQueryValue(() => repository.getMaterialBundle(materialId), [materialId]);
  const bundle = bundleState.value;
  const getUrlSelection = () => {
    const section = searchParams.get("section");
    const id = searchParams.get("id");
    return section === "experience" && id ? `experience:${id}` : section === "version" && id ? id : "facts";
  };
  const [selection, setSelection] = useState<string>(getUrlSelection);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [showNewExperience, setShowNewExperience] = useState(false);
  const [referenceForNewVersion, setReferenceForNewVersion] = useState<string | undefined>(undefined);

  const chooseSelection = useCallback((next: string) => {
    setSelection(next);
    if (next === "facts") setSearchParams({});
    else if (next.startsWith("experience:")) setSearchParams({ section: "experience", id: next.slice("experience:".length) });
    else setSearchParams({ section: "version", id: next });
  }, [setSearchParams]);

  useEffect(() => { setSelection(getUrlSelection()); }, [searchParams]);

  useEffect(() => {
    if (!bundle) return;
    const validExperience = selection.startsWith("experience:") && (bundle.item.experiences ?? []).some((experience) => experience.id === selection.slice("experience:".length) && !experience.deletedAt);
    const validVersion = bundle.versions.some((version) => version.id === selection);
    if (selection !== "facts" && !validExperience && !validVersion) chooseSelection("facts");
  }, [bundle, selection, chooseSelection]);

  const selectedVersion = useMemo(() => bundle?.versions.find((version) => version.id === selection), [bundle, selection]);
  const selectedExperience = useMemo(() => selection.startsWith("experience:") ? bundle?.item.experiences?.find((experience) => experience.id === selection.slice("experience:".length) && !experience.deletedAt) : undefined, [bundle, selection]);
  const selectedNote = selectedVersion ? bundle?.notes.find((note) => note.materialVersionId === selectedVersion.id) : undefined;
  const supportsExperiences = bundle ? ["work", "project", "campus"].includes(bundle.item.category) : false;

  const createExperience = async () => {
    if (!bundle) return;
    setShowNewExperience(true);
  };

  const deleteExperience = async (experience: MaterialExperience) => {
    if (!bundle || !window.confirm(`将经历“${experience.name}”移入回收站？`)) return;
    try { await repository.moveExperienceToTrash(bundle.item.id, experience.id); chooseSelection("facts"); }
    catch (error) { window.alert(error instanceof Error ? error.message : "删除经历失败"); }
  };

  const deleteMaterial = useCallback(async () => {
    if (!bundle || !window.confirm(`将“${bundle.item.internalName}”及其全部版本移入回收站？`)) return;
    await repository.moveMaterialToTrash(bundle.item.id);
    navigate("/materials");
  }, [bundle, navigate]);

  const deleteVersion = useCallback(async (version: MaterialVersion) => {
    if (!window.confirm(`将版本“${version.name}”及其面试备注移入回收站？`)) return;
    try {
      await repository.moveVersionToTrash(version.id);
      setSelection("facts");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除版本失败");
    }
  }, []);

  if (bundleState.loading) return <section className="page"><div className="content-panel loading-panel">正在读取素材…</div></section>;
  if (bundleState.error) return <section className="page"><div className="content-panel error-panel">{bundleState.error.message}</div></section>;
  if (!bundle) return <section className="page"><div className="content-panel empty-state"><h2>素材不存在或已在回收站</h2><Link className="secondary-button link-button" to="/materials">返回素材库</Link></div></section>;

  return (
    <section className="detail-page">
      <header className="detail-header">
        <div className="detail-title-row">
          <Link className="back-link" to="/materials">← 返回素材库</Link>
          <div><h1>{bundle.item.internalName}</h1><span>{MATERIAL_CATEGORY_LABELS[bundle.item.category]}素材</span></div>
        </div>
        <div className="detail-header-actions">
          <SaveIndicator status={saveStatus} />
          <button className="text-button danger-text" type="button" onClick={() => void deleteMaterial()}>删除素材</button>
        </div>
      </header>

      <div className="detail-layout">
        <aside className="version-sidebar">
          <button className={`version-nav-item ${selection === "facts" ? "active" : ""}`} type="button" onClick={() => chooseSelection("facts")}>
            <strong>共享事实</strong><span>所有版本共用</span>
          </button>
          <div className="version-group-label">{supportsExperiences ? "经历内容" : (bundle.item.experiences ?? []).some((experience) => !experience.deletedAt) ? "历史经历内容" : "经历内容"}</div>
          {(bundle.item.experiences ?? []).filter((experience) => !experience.deletedAt).map((experience) => (
            <button className={`version-nav-item experience-nav-item ${selection === `experience:${experience.id}` ? "active" : ""}`} key={experience.id} type="button" onClick={() => chooseSelection(`experience:${experience.id}`)}>
              <strong>{experience.name}</strong><span>{supportsExperiences ? "原始经历描述" : "历史内容 · 只读"}</span>
            </button>
          ))}
          {supportsExperiences ? <button className="new-version-button new-experience-button" type="button" onClick={() => void createExperience()}>＋ 新建经历</button> : null}
          <div className="version-group-label">素材版本</div>
          {bundle.versions.map((version) => (
            <button className={`version-nav-item ${selection === version.id ? "active" : ""}`} key={version.id} type="button" onClick={() => chooseSelection(version.id)}>
              <strong>{version.name}{version.sourceFactRevision < bundle.item.factRevision ? <em className="version-review-badge">待核对</em> : null}</strong>
              <span>{version.language === "zh-CN" ? "中文" : "英文"}{version.isOriginal ? " · 原始版本" : ""}</span>
            </button>
          ))}
          <button className="new-version-button" type="button" onClick={() => { setReferenceForNewVersion(undefined); setShowNewVersion(true); }}>＋ 新建版本</button>
        </aside>

        <main className="detail-editor">
          {selection === "facts" ? (
            <SharedFactsEditor key={bundle.item.id} item={bundle.item} onStatus={setSaveStatus} />
          ) : selectedExperience && supportsExperiences ? (
            <ExperienceEditor key={selectedExperience.id} materialItemId={bundle.item.id} experience={selectedExperience} onStatus={setSaveStatus} onDelete={() => void deleteExperience(selectedExperience)} />
          ) : selectedExperience ? (
            <div className="editor-section historical-experience"><div className="section-heading-row"><div><p className="eyebrow">类别已变更 · 保留原文</p><h2>{selectedExperience.name}</h2></div></div><pre>{selectedExperience.content || "这段经历尚未填写内容。"}</pre><p>将素材类别改回工作、项目或校园，即可继续编辑。</p></div>
          ) : selectedVersion ? (
            <VersionEditor
              key={selectedVersion.id}
              version={selectedVersion}
              note={selectedNote}
              item={bundle.item}
              onStatus={setSaveStatus}
              onDuplicate={() => { setReferenceForNewVersion(selectedVersion.id); setShowNewVersion(true); }}
              onDelete={() => void deleteVersion(selectedVersion)}
              onAiCreated={(version) => chooseSelection(version.id)}
            />
          ) : null}
        </main>
      </div>
      {showNewVersion ? (
        <NewVersionModal
          versions={bundle.versions}
          initialReferenceId={referenceForNewVersion}
          onClose={() => setShowNewVersion(false)}
          onCreated={(version) => { setShowNewVersion(false); chooseSelection(version.id); }}
        />
      ) : null}
      {showNewExperience && bundle ? <NewExperienceModal materialItemId={bundle.item.id} initialName={`经历 ${(bundle.item.experiences ?? []).filter((experience) => !experience.deletedAt).length + 1}`} onClose={() => setShowNewExperience(false)} onCreated={(experience) => { setShowNewExperience(false); chooseSelection(`experience:${experience.id}`); }} /> : null}
    </section>
  );
}
