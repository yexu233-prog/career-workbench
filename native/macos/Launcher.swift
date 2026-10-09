import AppKit
import Foundation
import Darwin

// A local launcher, not a browser wrapper. No shell strings, credentials or document logging.
final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class Launcher: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    let browser = NSPopUpButton(frame: NSRect(x: 24, y: 136, width: 290, height: 28))
    let status = NSTextField(labelWithString: "请选择浏览器；Safari 与 Chrome 的业务数据独立。")
    let startButton = NSButton(title: "启动并打开", target: nil, action: nil)
    let stopButton = NSButton(title: "停止本机服务", target: nil, action: nil)
    let files = FileManager.default
    var service: Process?
    var lockDescriptor: Int32 = -1
    var token = ""
    var instanceId = ""
    var tokenFile: URL?
    var launching = false
    var stopping = false
    var quitAfterStop = false
    let base = URL(string: "http://127.0.0.1:41823")!
    var resources: URL { Bundle.main.resourceURL! }
    var userRoot: URL { files.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/求职工作台", isDirectory: true) }
    var preferences: URL { userRoot.appendingPathComponent("launcher-browser.json") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 230), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "求职工作台"; window.delegate = self; window.center()
        browser.addItems(withTitles: ["Safari", "Google Chrome"])
        if let data = try? Data(contentsOf: preferences), let saved = try? JSONSerialization.jsonObject(with: data) as? [String: String], saved["browser"] == "chrome" { browser.selectItem(at: 1) }
        status.frame = NSRect(x: 24, y: 35, width: 430, height: 82); status.maximumNumberOfLines = 4
        startButton.frame = NSRect(x: 24, y: 98, width: 145, height: 30); startButton.target = self; startButton.action = #selector(start)
        stopButton.frame = NSRect(x: 184, y: 98, width: 145, height: 30); stopButton.target = self; stopButton.action = #selector(stop); stopButton.isEnabled = false
        for view in [browser, status, startButton, stopButton] { window.contentView?.addSubview(view) }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func alert(_ message: String) { let alert = NSAlert(); alert.messageText = "求职工作台"; alert.informativeText = message; alert.runModal() }
    func browserURL() -> URL? {
        let identifier = browser.indexOfSelectedItem == 1 ? "com.google.Chrome" : "com.apple.Safari"
        return NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier)
    }
    func openBrowser() {
        guard let application = browserURL() else { alert("所选浏览器未安装，请安装或手动选择另一浏览器。不会自动切换资料。"); return }
        let configuration = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([base], withApplicationAt: application, configuration: configuration) { _, error in
            if error != nil { DispatchQueue.main.async { self.alert("浏览器打开失败。请检查所选浏览器，或手动访问 http://127.0.0.1:41823。")} }
        }
    }
    func request(_ path: String, method: String = "GET", control: String? = nil, completion: @escaping (Data?, HTTPURLResponse?) -> Void) {
        var request = URLRequest(url: base.appendingPathComponent(path)); request.httpMethod = method; request.timeoutInterval = 2
        if let value = control { request.setValue(value, forHTTPHeaderField: "x-control-token") }
        // This ephemeral session ignores external proxies for the fixed loopback origin.
        let configuration = URLSessionConfiguration.ephemeral; configuration.connectionProxyDictionary = [:]
        let session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
        session.dataTask(with: request) { data, response, _ in
            session.finishTasksAndInvalidate()
            DispatchQueue.main.async { completion(data, response as? HTTPURLResponse) }
        }.resume()
    }
    @objc func start() {
        guard !launching && !stopping else { return }
        if service?.isRunning == true { openBrowser(); return }
        guard browserURL() != nil else { alert("所选浏览器未安装，请重新选择。Safari 与 Chrome 的数据不自动共享。"); return }
        do {
            try files.createDirectory(at: userRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            lockDescriptor = Darwin.open(userRoot.appendingPathComponent("launcher.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lockDescriptor >= 0, flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else { releaseLock(); alert("另一个启动器正在运行。请使用原窗口，或先停止旧版；不会强制结束其他程序。"); return }
            let data = try JSONSerialization.data(withJSONObject: ["browser": browser.indexOfSelectedItem == 1 ? "chrome" : "safari"])
            try data.write(to: preferences, options: [.atomic]); try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: preferences.path)
        } catch { releaseLock(); alert("无法保存本机启动设置，请检查用户目录权限。"); return }
        launching = true; startButton.isEnabled = false; status.stringValue = "检查本机端口并启动服务……"
        request("api/health") { data, response in
            // Any responding process is treated as foreign, even if it resembles this application.
            if response != nil || data != nil { self.launching = false; self.startButton.isEnabled = true; self.releaseLock(); self.alert("41823 端口已有服务。请先停止旧版或占用端口的程序；不会切换端口或强行结束进程。"); return }
            self.launchService()
        }
    }
    func launchService() {
        do {
            let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("version.json"))) as? [String: Any]
            guard let expected = metadata?["architecture"] as? String, ["arm64", "x64"].contains(expected) else { throw NSError(domain: "package", code: 1) }
            var info = utsname(); uname(&info)
            let actual = withUnsafePointer(to: &info.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) } }
            guard actual == (expected == "x64" ? "x86_64" : "arm64") else { alert("测试包架构不匹配，请使用与设备芯片对应的包。"); throw NSError(domain: "architecture", code: 1) }
            token = UUID().uuidString + UUID().uuidString
            instanceId = UUID().uuidString
            tokenFile = userRoot.appendingPathComponent("control-\(UUID().uuidString).token")
            guard let tokenFile = tokenFile else { throw NSError(domain: "token", code: 1) }
            guard files.createFile(atPath: tokenFile.path, contents: Data(token.utf8), attributes: [.posixPermissions: 0o600]) else { throw NSError(domain: "token", code: 2) }
            let process = Process(); process.executableURL = resources.appendingPathComponent("runtime/node/node")
            guard let engine = metadata?["chromiumExecutable"] as? String, engine.hasPrefix("runtime/chromium/"), !engine.split(separator: "/").contains("..") else { throw NSError(domain: "engine", code: 1) }
            process.arguments = [resources.appendingPathComponent("app/server.mjs").path, "--production", "--web-root", resources.appendingPathComponent("web").path, "--font-file", resources.appendingPathComponent("assets/fonts/NotoSansCJKsc-Regular.otf").path, "--keychain-helper", resources.appendingPathComponent("native/keychain-helper").path, "--chromium-executable", resources.appendingPathComponent(engine).path, "--control-token-file", tokenFile.path, "--instance-id", instanceId]
            process.currentDirectoryURL = resources
            var runtimeEnvironment = ProcessInfo.processInfo.environment
            runtimeEnvironment["NODE_ENV"] = "production"
            runtimeEnvironment.removeValue(forKey: "NODE_OPTIONS"); runtimeEnvironment.removeValue(forKey: "NODE_PATH")
            process.environment = runtimeEnvironment
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            process.terminationHandler = { _ in DispatchQueue.main.async { self.serviceEnded() } }
            service = process; try process.run(); pollReady(remaining: 80)
        } catch { service = nil; serviceEnded(); alert("启动失败，请检查测试包完整性、芯片类型及系统授权；未修改浏览器数据。"); }
    }
    func pollReady(remaining: Int) {
        guard let service = service, service.isRunning else { return }
        if remaining == 0 { status.stringValue = "服务未在规定时间内就绪；正在停止本次启动的进程。"; service.terminate(); return }
        request("api/health") { data, response in
            if response?.statusCode == 200, let data = data, let health = try? JSONSerialization.jsonObject(with: data) as? [String: Any], health["status"] as? String == "ok", health["instanceId"] as? String == self.instanceId {
                self.launching = false; self.startButton.isEnabled = true; self.stopButton.isEnabled = true
                self.status.stringValue = "服务运行中。关闭网页不会停止服务；请使用下方停止按钮或退出启动器。"; self.openBrowser()
            } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.pollReady(remaining: remaining - 1) } }
        }
    }
    @objc func stop() {
        guard service?.isRunning == true, !stopping else { return }
        stopping = true; stopButton.isEnabled = false; startButton.isEnabled = false
        status.stringValue = "正在停止服务；请勿关闭或移动程序……"
        request("api/system/stop", method: "POST", control: token) { _, response in
            if response?.statusCode != 200 && self.service?.isRunning == true {
                let awaitingQuit = self.quitAfterStop
                self.stopping = false; self.quitAfterStop = false; self.stopButton.isEnabled = true
                if awaitingQuit { NSApp.reply(toApplicationShouldTerminate: false) }
                self.alert("受保护停止请求失败。请重试；不会通过陈旧PID或结束未知进程来停止服务。")
            }
        }
    }
    func serviceEnded() {
        service = nil; launching = false; stopping = false; token = ""
        if let file = tokenFile { try? files.removeItem(at: file) }; tokenFile = nil
        releaseLock(); startButton.isEnabled = true; stopButton.isEnabled = false; status.stringValue = "服务已停止。浏览器中的素材与简历未删除。"
        if quitAfterStop { NSApp.reply(toApplicationShouldTerminate: true) }
    }
    func releaseLock() { if lockDescriptor >= 0 { flock(lockDescriptor, LOCK_UN); Darwin.close(lockDescriptor); lockDescriptor = -1 } }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard service?.isRunning == true else { return .terminateNow }
        let prompt = NSAlert(); prompt.messageText = "退出并停止本机服务？"; prompt.informativeText = "未完成的AI或PDF任务将取消。请先确认网页内容已保存。"; prompt.addButton(withTitle: "停止并退出"); prompt.addButton(withTitle: "取消")
        guard prompt.runModal() == .alertFirstButtonReturn else { return .terminateCancel }
        quitAfterStop = true; stop(); return .terminateLater
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
}
let application = NSApplication.shared
let delegate = Launcher()
application.delegate = delegate
application.run()
