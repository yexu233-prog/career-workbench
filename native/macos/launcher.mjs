import { verifyPackage } from "./package-runtime.mjs";
import { chooseBrowser, openBrowser, startOwnedService, stopExistingService } from "./controller.mjs";

let service; let interrupted = false;
const cancellation = new AbortController();
const stop = () => { interrupted = true; cancellation.abort(); void service?.stop().catch(() => { process.exitCode = 1; }); };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, stop);
try {
  const action = process.argv[2];
  if (!["start", "stop"].includes(action)) throw new Error("启动参数无效");
  if (action === "stop") await stopExistingService();
  else {
    console.log("正在检查测试包，请稍候……");
    const metadata = await verifyPackage();
    if (!interrupted) {
      const browser = await chooseBrowser(cancellation.signal);
      if (browser && !interrupted) {
        service = await startOwnedService(metadata, cancellation.signal);
        if (interrupted) await service.stop();
        else {
          await openBrowser(browser);
          console.log("求职工作台已启动：http://127.0.0.1:41823\n请保留此终端。按Control+C或双击停止入口结束；关闭网页不会停止服务。");
          const exit = await service.exited;
          if (exit !== 0 && !interrupted) throw new Error("本机服务意外退出，请重新启动；浏览器已保存的数据仍保留");
        }
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "启动或停止失败，请检查测试包与系统授权"); process.exitCode = 1;
} finally { await service?.stop(); }
