import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { APP_NAME, APP_VERSION } from "@career-workbench/shared";
import { repository, type OnboardingState } from "@career-workbench/database";
import { useServiceHealth } from "./hooks/useServiceHealth";
import { MaterialDetailPage } from "./pages/MaterialDetailPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrashPage } from "./pages/TrashPage";
import { NewResumeProjectPage } from "./pages/NewResumeProjectPage";
import { ResumeProjectDetailPage } from "./pages/ResumeProjectDetailPage";
import { ResumeProjectsPage } from "./pages/ResumeProjectsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ResumeImportPage } from "./pages/ResumeImportPage";
import { TutorialPage, WelcomePage } from "./pages/OnboardingPages";
import { getOnboardingRedirect } from "./onboarding";

const navigation = [
  { to: "/profile", label: "个人资料", marker: "人" },
  { to: "/materials", label: "简历素材", marker: "素" },
  { to: "/resumes", label: "简历项目", marker: "简" }
] as const;

const utilityNavigation = [
  { to: "/trash", label: "回收站", marker: "回" },
  { to: "/settings", label: "设置", marker: "设" }
] as const;

function NavigationItem({ to, label, marker }: (typeof navigation)[number] | (typeof utilityNavigation)[number]) {
  return (
    <NavLink className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} to={to}>
      <span className="nav-marker" aria-hidden="true">{marker}</span>
      <span>{label}</span>
    </NavLink>
  );
}

function WorkbenchShell() {
  const health = useServiceHealth();
  const healthLabel = health === "online" ? "本机服务正常" : health === "offline" ? "本机服务未连接" : "正在检查本机服务";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">职</div>
          <div>
            <strong>{APP_NAME}</strong>
            <span>本机测试版</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主要导航">
          {navigation.map((item) => <NavigationItem key={item.to} {...item} />)}
        </nav>

        <nav className="utility-nav" aria-label="辅助导航">
          {utilityNavigation.map((item) => <NavigationItem key={item.to} {...item} />)}
          <div className={`service-status ${health}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{healthLabel}</span>
          </div>
          <span className="version-label">{APP_VERSION}</span>
        </nav>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/materials/import" element={<ResumeImportPage />} />
          <Route path="/materials/:materialId" element={<MaterialDetailPage />} />
          <Route path="/resumes" element={<ResumeProjectsPage />} />
          <Route path="/resumes/new" element={<NewResumeProjectPage />} />
          <Route path="/resumes/:resumeId" element={<ResumeProjectDetailPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/profile" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const location = useLocation();
  const [onboarding, setOnboarding] = useState<OnboardingState>();
  const [onboardingError, setOnboardingError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [bypassOnboarding, setBypassOnboarding] = useState(false);

  useEffect(() => {
    let active = true;
    setOnboarding(undefined);
    setOnboardingError("");
    repository.getOnboardingState()
      .then((state) => { if (active) setOnboarding(state); })
      .catch((reason: unknown) => {
        if (active) setOnboardingError(reason instanceof Error ? reason.message : "无法读取本机使用教程状态");
      });
    return () => { active = false; };
  }, [loadAttempt]);

  const startOnboarding = async () => {
    const state = await repository.startOnboarding();
    setOnboarding(state);
  };

  const completeOnboarding = async () => {
    const state = await repository.completeOnboarding();
    setOnboarding(state);
  };

  if (!onboarding && !onboardingError) {
    return <section className="onboarding-screen onboarding-load" aria-live="polite">正在读取本机设置…</section>;
  }

  if (!onboarding && onboardingError && !bypassOnboarding) {
    return <section className="onboarding-screen onboarding-load" aria-labelledby="onboarding-error-title">
      <div className="onboarding-load-panel">
        <p className="eyebrow">本机设置读取失败</p>
        <h1 id="onboarding-error-title">使用教程暂时无法打开</h1>
        <p role="alert">{onboardingError}</p>
        <div className="inline-actions">
          <button className="secondary-button" type="button" onClick={() => setBypassOnboarding(true)}>暂时进入工作台</button>
          <button className="primary-button" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取</button>
        </div>
      </div>
    </section>;
  }

  const state = onboarding ?? { schemaVersion: 1, status: "new", startedAt: null, completedAt: null };
  const redirect = getOnboardingRedirect(location.pathname, state.status, bypassOnboarding);
  if (redirect) return <Navigate to={redirect} replace />;

  if (location.pathname === "/welcome") {
    return <WelcomePage onStart={startOnboarding} onComplete={completeOnboarding} />;
  }
  if (location.pathname === "/tutorial") {
    return <TutorialPage onStart={startOnboarding} onComplete={completeOnboarding} />;
  }
  return <WorkbenchShell />;
}
