import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { repository } from "@career-workbench/database";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function ResumeProjectsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const projects = useLiveQueryValue(() => repository.listResumeProjectSummaries(query, archived), [query, archived]);
  const rows = projects.value ?? [];

  const copyProject = useCallback(async (id: string) => {
    try {
      const copied = await repository.copyResumeProject(id);
      navigate(`/resumes/${copied.id}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "复制简历项目失败");
    }
  }, [navigate]);

  const toggleArchived = useCallback(async (id: string, next: boolean) => {
    try {
      await repository.setResumeProjectArchived(id, next);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "更新归档状态失败");
    }
  }, []);

  const deleteProject = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`将简历项目“${name}”移入回收站？项目快照会保留，直到你永久删除。`)) return;
    try {
      await repository.moveResumeProjectToTrash(id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除简历项目失败");
    }
  }, []);

  return (
    <section className="page" aria-labelledby="resume-projects-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">长期保存的工作区 · {rows.length} 条结果</p>
          <h1 id="resume-projects-title">简历项目</h1>
          <p className="page-description">组合素材版本并保留独立快照，为不同目标岗位维护可以反复编辑的简历。</p>
        </div>
        <Link className="primary-button link-button" to="/resumes/new">新建简历</Link>
      </header>

      <div className="toolbar" aria-label="简历项目筛选">
        <label className="search-field">
          <span className="sr-only">搜索简历项目</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称或目标岗位" />
        </label>
        <div className="segmented-control">
          <button className={!archived ? "active" : ""} type="button" onClick={() => setArchived(false)}>进行中</button>
          <button className={archived ? "active" : ""} type="button" onClick={() => setArchived(true)}>已归档</button>
        </div>
      </div>

      {projects.loading ? <div className="content-panel loading-panel">正在读取简历项目…</div> : null}
      {projects.error ? <div className="content-panel error-panel">{projects.error.message}</div> : null}
      {!projects.loading && !projects.error && rows.length === 0 ? (
        <div className="content-panel empty-state">
          <div className="empty-symbol" aria-hidden="true">简</div>
          <h2>{archived ? "没有已归档项目" : query ? "没有符合条件的项目" : "创建第一份岗位简历"}</h2>
          <p>{archived ? "归档项目会与进行中的项目分开显示。" : "先建立项目，再从素材库选择任意版本组合成独立简历。"}</p>
          {!archived ? <Link className="primary-button link-button" to="/resumes/new">新建简历</Link> : null}
        </div>
      ) : null}

      {rows.length ? (
        <div className="content-panel table-panel">
          <table className="material-table resume-project-table">
            <thead><tr><th>简历项目</th><th>语言</th><th>素材</th><th>页数</th><th>来源状态</th><th>最近更新</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {rows.map((summary) => (
                <tr key={summary.project.id}>
                  <td><Link className="material-title-link" to={`/resumes/${summary.project.id}`}>{summary.project.name}</Link><span className="table-subtitle">{summary.project.targetRole || "未填写目标岗位"}</span></td>
                  <td>{summary.project.language === "zh-CN" ? "中文" : "英文"}</td>
                  <td>{summary.entryCount}</td>
                  <td>{summary.actualPageCount} 页</td>
                  <td>
                    {summary.deletedSourceCount ? <span className="source-chip deleted">{summary.deletedSourceCount} 项来源已删除</span>
                      : summary.updatedSourceCount ? <span className="source-chip updated">{summary.updatedSourceCount} 项有更新</span>
                        : <span className="source-chip current">已同步</span>}
                  </td>
                  <td>{formatTime(summary.project.updatedAt)}</td>
                  <td><div className="row-actions">
                    <button type="button" onClick={() => void copyProject(summary.project.id)}>复制</button>
                    <button type="button" onClick={() => void toggleArchived(summary.project.id, !archived)}>{archived ? "取消归档" : "归档"}</button>
                    <button className="danger-text" type="button" onClick={() => void deleteProject(summary.project.id, summary.project.name)}>删除</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
