import { useCallback, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  type MaterialCategory,
  type OutputLanguage
} from "@career-workbench/domain";
import { repository } from "@career-workbench/database";
import { Modal } from "../components/Modal";
import { FormField } from "../components/FormField";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(value));
}

function NewMaterialModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<MaterialCategory>("work");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const bundle = await repository.createMaterial({ internalName: name, category });
      navigate(`/materials/${bundle.item.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建素材失败");
      setSubmitting(false);
    }
  };

  return (
    <Modal title="新建简历素材" onClose={onClose}>
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <FormField label="素材库内部名称" hint="用于你自己识别，不要求直接出现在简历中。" wide>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：支付系统重构项目" />
        </FormField>
        <FormField label="素材类别" wide>
          <select value={category} onChange={(event) => setCategory(event.target.value as MaterialCategory)}>
            {MATERIAL_CATEGORIES.map((value) => <option key={value} value={value}>{MATERIAL_CATEGORY_LABELS[value]}</option>)}
          </select>
        </FormField>
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="submit" disabled={!name.trim() || submitting}>
            {submitting ? "正在创建…" : "创建并填写"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function MaterialsPage() {
  const location = useLocation();
  const importedCount = (location.state as { importedCount?: number } | null)?.importedCount;
  const importedVersionCount = (location.state as { importedVersionCount?: number } | null)?.importedVersionCount;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MaterialCategory | "all">("all");
  const [language, setLanguage] = useState<OutputLanguage | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
  const summaries = useLiveQueryValue(
    () => repository.listMaterialSummaries({ query, category, language }),
    [query, category, language]
  );
  const rows = summaries.value ?? [];

  const copyMaterial = useCallback(async (id: string) => {
    try {
      await repository.copyMaterial(id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "复制素材失败");
    }
  }, []);

  const deleteMaterial = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`将“${name}”及其版本和面试备注移入回收站？`)) return;
    try {
      await repository.moveMaterialToTrash(id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除素材失败");
    }
  }, []);

  return (
    <section className="page" aria-labelledby="materials-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">素材库 · {rows.length} 条结果</p>
          <h1 id="materials-title">简历素材</h1>
          <p className="page-description">把真实经历先沉淀下来，再为不同岗位创建表达版本。</p>
        </div>
        <div className="inline-actions"><Link className="secondary-button link-button" to="/materials/import">导入已有简历</Link><button className="primary-button" type="button" onClick={() => setShowCreate(true)}>新建素材</button></div>
      </header>

      {importedCount || importedVersionCount ? <p className="success-message" role="status">已新建 {importedCount ?? 0} 条素材，并为已有素材新增 {importedVersionCount ?? 0} 个版本。原始简历文件未保存。</p> : null}

      <div className="toolbar" aria-label="素材筛选">
        <label className="search-field">
          <span className="sr-only">搜索素材</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称、组织、技能或标签" />
        </label>
        <select className="filter-select" aria-label="素材类别" value={category} onChange={(event) => setCategory(event.target.value as MaterialCategory | "all")}>
          <option value="all">全部类别</option>
          {MATERIAL_CATEGORIES.map((value) => <option key={value} value={value}>{MATERIAL_CATEGORY_LABELS[value]}</option>)}
        </select>
        <select className="filter-select" aria-label="输出语言" value={language} onChange={(event) => setLanguage(event.target.value as OutputLanguage | "all")}>
          <option value="all">全部语言</option>
          <option value="zh-CN">中文</option>
          <option value="en">英文</option>
        </select>
      </div>

      {summaries.loading ? <div className="content-panel loading-panel">正在读取本机素材…</div> : null}
      {summaries.error ? <div className="content-panel error-panel">{summaries.error.message}</div> : null}

      {!summaries.loading && !summaries.error && rows.length === 0 ? (
        <div className="content-panel empty-state">
          <div className="empty-symbol" aria-hidden="true">文</div>
          <h2>{query || category !== "all" || language !== "all" ? "没有符合条件的素材" : "从第一段真实经历开始"}</h2>
          <p>{query || category !== "all" || language !== "all" ? "尝试清除搜索词或调整筛选条件。" : "创建工作、项目、教育等素材，并在同一条素材下维护多个岗位化版本。"}</p>
          <button className="primary-button" type="button" onClick={() => setShowCreate(true)}>新建第一条素材</button>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="content-panel table-panel">
          <table className="material-table">
            <thead>
              <tr><th>素材</th><th>类别</th><th>版本</th><th>标签</th><th>最近更新</th><th><span className="sr-only">操作</span></th></tr>
            </thead>
            <tbody>
              {rows.map((summary) => (
                <tr key={summary.item.id}>
                  <td>
                    <div className="material-title-row">
                      <Link className="material-title-link" to={`/materials/${summary.item.id}`}>{summary.item.internalName}</Link>
                      <button className="material-shortcuts-toggle" type="button" aria-expanded={expandedMaterialId === summary.item.id} aria-label={`${expandedMaterialId === summary.item.id ? "收起" : "展开"}${summary.item.internalName}的经历和版本`} onClick={() => setExpandedMaterialId((current) => current === summary.item.id ? null : summary.item.id)}>{expandedMaterialId === summary.item.id ? "收起⌃" : "展开⌄"}</button>
                    </div>
                    <span className="table-subtitle">{summary.organization}</span>
                    {summary.needsReview ? <span className="review-flag">共享事实或经历已更新 · {summary.reviewPendingVersionCount} 个版本待核对</span> : null}
                    {expandedMaterialId === summary.item.id ? <div className="material-shortcuts-menu">
                      {summary.experienceLinks.length ? <div><strong>经历内容</strong>{summary.experienceLinks.map((experience) => <Link key={experience.id} to={`/materials/${summary.item.id}?section=experience&id=${encodeURIComponent(experience.id)}`}>{experience.name}</Link>)}</div> : null}
                      <div><strong>素材版本</strong>{summary.versionLinks.map((version) => <Link key={version.id} to={`/materials/${summary.item.id}?section=version&id=${encodeURIComponent(version.id)}`}>{version.name}</Link>)}</div>
                    </div> : null}
                  </td>
                  <td><span className={`category-badge ${summary.item.category}`}>{MATERIAL_CATEGORY_LABELS[summary.item.category]}</span></td>
                  <td>{summary.versionCount}</td>
                  <td><div className="tag-cell">{summary.item.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}{summary.item.tags.length === 0 ? <em>—</em> : null}</div></td>
                  <td>{formatTime(summary.item.updatedAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => void copyMaterial(summary.item.id)}>复制</button>
                      <button className="danger-text" type="button" onClick={() => void deleteMaterial(summary.item.id, summary.item.internalName)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {showCreate ? <NewMaterialModal onClose={() => setShowCreate(false)} /> : null}
    </section>
  );
}
