/** Keep technical failures out of ordinary UI while preserving a useful next step. */
export function storageErrorMessage(error: unknown, fallback = "本机数据暂时无法读取或保存。请保留当前页面，重新打开求职工作台后重试。"): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return "本机浏览器存储空间不足，当前修改尚未保存。请先保留此页面，清理磁盘空间后重试；不要清除求职工作台的浏览器数据。";
  if (["SecurityError", "InvalidStateError", "OpenFailedError", "DatabaseClosedError"].includes(name))
    return "无法访问求职工作台的本机数据。请确认使用原来的系统账户、浏览器及用户资料，关闭其他窗口后重试；不要清除浏览器数据。";
  return error instanceof Error && /[\u3400-\u9fff]/u.test(error.message)
    ? error.message : fallback;
}

export function localServiceError(error: unknown, action: string): Error {
  if (error instanceof DOMException && error.name === "AbortError") return new Error(`${action}已取消，请重试。`);
  if (error instanceof TypeError) return new Error(`本机服务未连接，无法${action}。请使用本机测试包的“启动求职工作台”入口重新启动后重试。`);
  return error instanceof Error ? error : new Error(`${action}失败，请检查本机服务后重试。`);
}
