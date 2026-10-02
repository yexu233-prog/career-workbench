import type { SaveStatus } from "@career-workbench/domain";

const labels: Record<SaveStatus, string> = {
  idle: "等待编辑",
  saving: "保存中…",
  saved: "已自动保存",
  failed: "保存失败",
  conflict: "存在编辑冲突"
};

export function SaveIndicator({ status, errorMessage }: { status: SaveStatus; errorMessage?: string }) {
  return (
    <span className={`save-indicator ${status}`} title={errorMessage} role="status">
      <span aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

