import { useState } from "react";
import type { TrashBatch } from "@career-workbench/domain";
import { repository } from "@career-workbench/database";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";

const rootLabels: Record<TrashBatch["rootType"], string> = {
  material: "素材",
  version: "素材版本",
  interviewNote: "面试备注",
  resumeProject: "简历项目",
  experience: "经历内容"
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TrashPage() {
  const trash = useLiveQueryValue(() => repository.listTrash(), []);
  const [busyId, setBusyId] = useState("");
  const rows = trash.value ?? [];

  const restore = async (batch: TrashBatch) => {
    setBusyId(batch.id);
    try {
      await repository.restoreTrashBatch(batch.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusyId("");
    }
  };

  const removePermanently = async (batch: TrashBatch) => {
    if (!window.confirm(`永久删除“${batch.displayName}”？此操作无法撤销。`)) return;
    setBusyId(batch.id);
    try {
      await repository.permanentlyDeleteTrashBatch(batch.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "永久删除失败");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="page" aria-labelledby="trash-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">可恢复删除 · {rows.length} 项</p>
          <h1 id="trash-title">回收站</h1>
          <p className="page-description">删除内容不会自动清理。你可以随时恢复，或在确认后永久删除。</p>
        </div>
      </header>
      {trash.loading ? <div className="content-panel loading-panel">正在读取回收站…</div> : null}
      {trash.error ? <div className="content-panel error-panel">{trash.error.message}</div> : null}
      {!trash.loading && !trash.error && rows.length === 0 ? (
        <div className="content-panel empty-state compact-empty">
          <div className="empty-symbol" aria-hidden="true">回</div>
          <h2>回收站是空的</h2>
          <p>删除的素材、非原始版本、面试备注和简历项目会出现在这里。</p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="content-panel trash-list">
          {rows.map((batch) => (
            <article className="trash-row" key={batch.id}>
              <div className="trash-icon" aria-hidden="true">{rootLabels[batch.rootType].slice(0, 1)}</div>
              <div className="trash-copy">
                <strong>{batch.displayName}</strong>
                <span>{rootLabels[batch.rootType]} · 包含 {batch.entries.length} 条记录 · {formatDate(batch.deletedAt)} 删除</span>
              </div>
              <div className="row-actions">
                <button type="button" disabled={busyId === batch.id} onClick={() => void restore(batch)}>恢复</button>
                <button className="danger-text" type="button" disabled={busyId === batch.id} onClick={() => void removePermanently(batch)}>永久删除</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
