import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME, APP_VERSION } from "@career-workbench/shared";

interface OnboardingPageProps {
  onStart: () => Promise<void>;
  onComplete: () => Promise<void>;
}

const journeySteps = [
  { title: "理解产品", description: "认识个人资料、素材库和简历项目之间的关系。" },
  { title: "首次输入", description: "手动录入经历，或导入一份已有简历。" },
  { title: "可用素材", description: "检查内容，并为不同岗位维护表达版本。" },
  { title: "目标岗位简历", description: "填写目标岗位或 JD，选择并排列素材。" },
  { title: "完成并导出", description: "一边编辑一边预览，导出标准单栏 PDF。" },
  { title: "面试或再投递", description: "补充面试备注，或复制项目继续调整。" },
  { title: "持续复用", description: "积累真实经历，让素材库跟着你一起成长。" }
] as const;

function OnboardingBrand() {
  return <div className="onboarding-brand" aria-label={`${APP_NAME} ${APP_VERSION}`}>
    <span aria-hidden="true">职</span>
    <div><strong>{APP_NAME}</strong><small>本机测试版</small></div>
  </div>;
}

export function WelcomePage({ onStart, onComplete }: OnboardingPageProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"start" | "skip" | "">("");
  const [error, setError] = useState("");

  const run = async (action: "start" | "skip") => {
    setBusy(action);
    setError("");
    try {
      if (action === "start") {
        await onStart();
        navigate("/tutorial");
      } else {
        await onComplete();
        navigate("/profile");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存使用教程状态，请重试");
    } finally {
      setBusy("");
    }
  };

  return <section className="onboarding-screen welcome-screen" aria-labelledby="welcome-quote">
    <header className="onboarding-topbar"><OnboardingBrand /><span>{APP_VERSION}</span></header>
    <main className="welcome-content">
      <blockquote id="welcome-quote">尽情物化自己吧，这是神的法则</blockquote>
      <div className="welcome-actions">
        <button className="primary-button onboarding-primary" type="button" disabled={Boolean(busy)} onClick={() => void run("start")}>
          {busy === "start" ? "正在进入…" : "进入使用教程 →"}
        </button>
        <button className="text-button onboarding-skip" type="button" disabled={Boolean(busy)} onClick={() => void run("skip")}>
          {busy === "skip" ? "正在进入…" : "跳过教程"}
        </button>
      </div>
      {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
    </main>
  </section>;
}

export function TutorialPage({ onStart: _onStart, onComplete }: OnboardingPageProps) {
  const navigate = useNavigate();
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");

  const finish = async (nextPath: string) => {
    setDestination(nextPath);
    setError("");
    try {
      await onComplete();
      navigate(nextPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存使用教程状态，请重试");
      setDestination("");
    }
  };

  return <section className="onboarding-screen tutorial-screen" aria-labelledby="tutorial-title">
    <header className="onboarding-topbar tutorial-topbar">
      <OnboardingBrand />
      <div className="tutorial-top-actions">
        <button className="text-button" type="button" disabled={Boolean(destination)} onClick={() => void finish("/profile")}>跳过教程</button>
        <button className="tutorial-close" type="button" aria-label="关闭教程并进入求职工作台" disabled={Boolean(destination)} onClick={() => void finish("/profile")}>关闭 ×</button>
      </div>
    </header>

    <main className="tutorial-content">
      <div className="tutorial-intro">
        <p className="eyebrow">第一次使用</p>
        <h1 id="tutorial-title">从你的经历出发，完成一份真正适合目标岗位的简历</h1>
        <p>你不需要一次完成所有内容。先留下第一份资料，之后可以持续补充和复用。</p>
      </div>

      <section className="tutorial-start" aria-labelledby="start-title">
        <div className="tutorial-start-heading">
          <div><p className="eyebrow">现在开始</p><h2 id="start-title">选择最合适的一步</h2><p>根据你手头已有的内容开始，不必先完成全部准备。</p></div>
          <button className="text-button" type="button" disabled={Boolean(destination)} onClick={() => void finish("/profile")}>
            {destination === "/profile" ? "正在进入…" : "稍后再说，进入求职工作台"}
          </button>
        </div>
        <div className="tutorial-choice-grid">
          <article>
            <span className="choice-marker" aria-hidden="true">01</span>
            <div><h3>还没有现成简历</h3><p>先完善姓名和联系方式，再创建第一条真实经历素材。</p></div>
            <button className="primary-button" type="button" disabled={Boolean(destination)} onClick={() => void finish("/profile")}>
              {destination === "/profile" ? "正在进入…" : "从个人资料开始"}
            </button>
          </article>
          <article>
            <span className="choice-marker" aria-hidden="true">02</span>
            <div><h3>已经有一份简历</h3><p>上传 DOCX、文本型 PDF 或 TXT，检查后整理为可复用素材。</p></div>
            <button className="primary-button" type="button" disabled={Boolean(destination)} onClick={() => void finish("/materials/import")}>
              {destination === "/materials/import" ? "正在进入…" : "导入已有简历"}
            </button>
          </article>
        </div>
        {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
      </section>

      <section className="tutorial-journey" aria-labelledby="journey-title">
        <div className="tutorial-journey-heading"><h2 id="journey-title">之后的完整使用路径</h2><p>现在只需完成第一步，后续内容可以随时继续。</p></div>
        <ol>
          {journeySteps.map((step, index) => <li key={step.title} aria-label={`${index + 1}. ${step.title}：${step.description}`}>
            <span className="journey-number" aria-hidden="true">{index + 1}</span>
            <strong>{step.title}</strong>
            <p>{step.description}</p>
          </li>)}
        </ol>
      </section>
    </main>
  </section>;
}
