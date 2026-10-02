/// <reference lib="webworker" />
import { parseJdFileDirect } from "./jd-parser";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    self.postMessage({ result: await parseJdFileDirect(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "文件解析失败" });
  }
};
