import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { OutputLanguage, ResumeTargetLength } from "@career-workbench/domain";
import { repository } from "@career-workbench/database";
import { FormField } from "../components/FormField";

export function NewResumeProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [language, setLanguage] = useState<OutputLanguage>("zh-CN");
  const [targetLength, setTargetLength] = useState<ResumeTargetLength>("one");
  const [jdText, setJdText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const project = await repository.createResumeProject({ name, targetRole, language, targetLength, jdText });
      navigate(`/resumes/${project.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建简历项目失败");
      setSubmitting(false);
    }
  };

  return (
    <section className="page narrow-page" aria-labelledby="new-resume-title">
      <Link className="back-link" to="/resumes">← 返回简历项目</Link>
      <header className="page-header">
        <div><p className="eyebrow">创建长期保存的项目</p><h1 id="new-resume-title">新建简历</h1><p className="page-description">先填写最基本的目标信息。创建后再选择素材、编辑内容并预览排版。</p></div>
      </header>
      <form className="content-panel editor-section creation-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <FormField label="项目名称" hint="仅用于你自己识别。" wide><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品经理求职简历" /></FormField>
          <FormField label="目标岗位"><input value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="例如：B 端产品经理" /></FormField>
          <FormField label="输出语言"><select value={language} onChange={(event) => setLanguage(event.target.value as OutputLanguage)}><option value="zh-CN">中文</option><option value="en">英文</option></select></FormField>
          <FormField label="目标篇幅"><select value={targetLength} onChange={(event) => setTargetLength(event.target.value as ResumeTargetLength)}><option value="one">一页</option><option value="two">两页</option><option value="unlimited">不限页数</option></select></FormField>
          <FormField label="岗位 JD（可选）" hint="这里可以直接粘贴；创建项目后还可上传 TXT、DOCX 或带文字层的 PDF。" wide><textarea rows={9} value={jdText} onChange={(event) => setJdText(event.target.value)} /></FormField>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="modal-actions"><Link className="secondary-button link-button" to="/resumes">取消</Link><button className="primary-button" type="submit" disabled={!name.trim() || submitting}>{submitting ? "正在创建…" : "创建并编辑"}</button></footer>
      </form>
    </section>
  );
}
