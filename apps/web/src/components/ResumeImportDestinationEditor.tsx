import { useState } from "react";
import { MATERIAL_CATEGORY_LABELS } from "@career-workbench/domain";
import { compareResumeImport, repository, resumeImportDifferenceKey, resumeImportSharedKey, type ResumeImportCandidateDraft, type ResumeImportDestination } from "@career-workbench/database";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";
import { FormField } from "./FormField";

type VersionDestination = Extract<ResumeImportDestination, { mode: "new-version" }>;

export function ResumeImportDestinationEditor({ candidate, destination, onChange }: {
  candidate: ResumeImportCandidateDraft;
  destination: VersionDestination;
  onChange: (destination: VersionDestination) => void;
}) {
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const summaries = useLiveQueryValue(() => repository.listMaterialSummaries({ category: candidate.category, query }), [candidate.category, query, retry]);
  const target = useLiveQueryValue(() => destination.materialItemId ? repository.getMaterialBundle(destination.materialItemId) : undefined, [destination.materialItemId, retry]);
  const bundle = target.value?.item.id === destination.materialItemId ? target.value : undefined;
  const rows = summaries.loading ? [] : (summaries.value ?? []).filter(({ item }) => item.category === candidate.category);
  const comparison = bundle ? compareResumeImport(candidate, bundle.item) : [];
  const differences = comparison.filter((row) => row.different);
  const sharedKey = bundle ? resumeImportSharedKey(bundle.item) : "";
  const differenceKey = bundle ? resumeImportDifferenceKey(candidate, bundle.item) : "";
  const stale = bundle && (destination.expectedFactRevision !== bundle.item.factRevision || destination.expectedSharedKey !== sharedKey);
  const wrongCategory = bundle && bundle.item.category !== candidate.category;
  const duplicate = bundle?.versions.some((version) => version.name === destination.versionName.trim());
  const choose = (id: string) => {
    const item = rows.find((row) => row.item.id === id)?.item;
    onChange({ mode: "new-version", materialItemId: id, versionName: destination.versionName,
      ...(item ? { expectedFactRevision: item.factRevision, expectedSharedKey: resumeImportSharedKey(item) } : {}) });
  };

  return <section className="import-destination-panel" aria-label="新增版本设置">
    <p className="field-hint">仅关联同类别的已有素材，不自动匹配。新版本只保存概述和要点；已有共享事实、链接、其他版本及简历项目均不变。</p>
    <div className="form-grid">
      <FormField label="搜索已有素材"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="素材名称、公司或机构" /></FormField>
      <FormField label={`目标素材（${MATERIAL_CATEGORY_LABELS[candidate.category]}类）`}>
        <select value={destination.materialItemId} onChange={(event) => choose(event.target.value)}>
          <option value="">{summaries.loading ? "正在读取…" : "请选择已有素材"}</option>
          {destination.materialItemId && !rows.some(({ item }) => item.id === destination.materialItemId)
            ? <option value={destination.materialItemId}>{bundle?.item.internalName ?? "当前选择（待读取或已不可用）"}</option> : null}
          {rows.map(({ item, organization }) => <option key={item.id} value={item.id}>{item.internalName}{organization ? ` · ${organization}` : ""}</option>)}
        </select>
      </FormField>
      <FormField label="新版本名称（必填）" hint="同一素材下不能与未删除版本重名。" wide>
        <input value={destination.versionName} onChange={(event) => onChange({ ...destination, versionName: event.target.value })} placeholder="例如：数据分析岗位版" aria-required="true" aria-invalid={duplicate || undefined} />
      </FormField>
    </div>
    {duplicate ? <p className="inline-error">该素材已有同名版本，请修改新版本名称。</p> : null}
    {!summaries.loading && !summaries.error && !rows.length ? <p className="field-hint">没有找到符合条件的素材，可调整搜索词、修正候选类别，或改为“新建素材”。</p> : null}
    {summaries.error || target.error ? <div className="inline-error" role="alert">读取已有素材失败。<button className="text-button" type="button" onClick={() => setRetry((value) => value + 1)}>重新读取</button></div> : null}
    {destination.materialItemId && target.loading ? <p role="status">正在读取目标素材…</p> : null}
    {destination.materialItemId && !target.loading && !target.error && !bundle ? <p className="inline-error">目标素材不存在或已移入回收站，请重新选择。</p> : null}
    {bundle && !target.loading ? <>
      <p className="import-target-name">已选：<strong>{bundle.item.internalName}</strong> · {MATERIAL_CATEGORY_LABELS[bundle.item.category]}</p>
      <p className="field-hint">已有版本：{bundle.versions.map((version) => version.name).join("、") || "无"}</p>
      {wrongCategory ? <p className="inline-error">目标素材类别已改变，请修正候选类别或重新选择。</p> : null}
      {stale && !wrongCategory ? <div className="warning-banner">目标共享信息已变化或尚未核对。请检查下方最新信息，再点击
        <button className="text-button" type="button" onClick={() => onChange({ mode: "new-version", materialItemId: bundle.item.id, versionName: destination.versionName, expectedFactRevision: bundle.item.factRevision, expectedSharedKey: sharedKey })}>重新核对共享信息</button>。
      </div> : null}
      {comparison.length ? <table className="import-fact-comparison">
        <caption>共享信息核对 · 标注“差异”的内容不会覆盖已有素材</caption>
        <thead><tr><th scope="col">字段</th><th scope="col">已有素材（实际沿用）</th><th scope="col">导入候选（供核对）</th></tr></thead>
        <tbody>{comparison.map((row) => <tr key={row.key} className={row.different ? "has-difference" : ""}><th scope="row">{row.label}{row.different ? <small>差异</small> : null}</th><td>{row.existing}</td><td>{row.imported}</td></tr>)}</tbody>
      </table> : <p className="field-hint">双方均未填写共享事实和链接。</p>}
      {differences.length ? <label className="import-difference-confirm">
        <input type="checkbox" disabled={Boolean(stale || wrongCategory)} checked={!stale && !wrongCategory && destination.confirmedDifferenceKey === differenceKey}
          onChange={(event) => onChange({ ...destination, confirmedDifferenceKey: event.target.checked ? differenceKey : "" })} />
        <span>我确认这是同一段经历，并沿用已有素材的共享信息。以上差异保存在新版本的内部备注中，不会出现在最终简历上。</span>
      </label> : <p className="field-hint">未发现共享信息差异；请确认选择的是同一段经历。</p>}
    </> : null}
  </section>;
}
