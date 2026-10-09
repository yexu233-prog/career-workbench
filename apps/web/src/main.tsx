import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { bootstrapDatabase, database } from "@career-workbench/database";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";
import "./resume-document.css";
import { storageErrorMessage } from "./services/user-errors";
import { initializeRuntimeDisplay } from "./services/runtime-client";

const mount = document.getElementById("root");
if (!mount) throw new Error("缺少应用根节点");
const root = createRoot(mount);

async function start(): Promise<void> {
  try {
    await bootstrapDatabase();
    root.render(<StrictMode><AppErrorBoundary><BrowserRouter><App /></BrowserRouter></AppErrorBoundary></StrictMode>);
  } catch (error) {
    // A failed IndexedDB open is cached by Dexie. Reset it so the retry button
    // can actually reopen the database after a transient access failure.
    database.close({ disableAutoOpen: false });
    root.render(<main className="fatal-error" role="alert">
      <p className="eyebrow">本机数据暂时无法打开</p>
      <h1>求职工作台尚未启动</h1>
      <p>{storageErrorMessage(error)}</p>
      <button type="button" onClick={() => void start()}>重新尝试</button>
    </main>);
  }
}

void initializeRuntimeDisplay();
void start();
