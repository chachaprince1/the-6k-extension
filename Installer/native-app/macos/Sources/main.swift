import AppKit
import Foundation
import Network

private let yomitanExtensionID = "likgccmbimhjbgkjambclfkhldnlhbnn"
private let chromeBundleID = "com.google.Chrome"

final class CallbackServer {
    private var listener: NWListener?
    var loaded = false
    var onLoad: (() -> Void)?
    func start() -> String? {
        do {
            let server = try NWListener(using: .tcp, on: 19634)
            server.newConnectionHandler = { [weak self] connection in
                connection.start(queue: .main)
                connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                    defer { connection.cancel() }
                    let request = String(data: data ?? Data(), encoding: .utf8) ?? ""
                    guard request.contains("/extension-loaded"),
                          let target = request.split(separator: " ").dropFirst().first,
                          let components = URLComponents(string: "http://127.0.0.1\(target)"),
                          components.queryItems?.contains(where: { $0.name == "extension" && $0.value == "the-6k" }) == true else { return }
                    self?.loaded = true; self?.onLoad?()
                    let response = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in })
                }
            }
            server.start(queue: .main); listener = server; return nil
        } catch { return "Automatic confirmation is unavailable because port 19634 is already in use. You can still finish setup manually." }
    }
}

final class Installer {
    static let shared = Installer(); let files = FileManager.default; let callback = CallbackServer()
    let root: URL; let extensionRoot: URL; let hostRoot: URL; let nativeManifest: URL
    private init() {
        let library = files.urls(for: .libraryDirectory, in: .userDomainMask).first!
        root = library.appendingPathComponent("Application Support/Anime Study Tools")
        extensionRoot = root.appendingPathComponent("Extensions")
        hostRoot = root.appendingPathComponent("Yomitan API/1.0.0")
        nativeManifest = library.appendingPathComponent("Application Support/Google/Chrome/NativeMessagingHosts/yomitan_api.json")
    }
    func install() throws {
        guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "Installer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Installer payload is missing."]) }
        let source = resources.appendingPathComponent("payload/extensions/the-6k-extension")
        try verify(source); try files.createDirectory(at: extensionRoot, withIntermediateDirectories: true)
        let destination = extensionRoot.appendingPathComponent("the-6k-extension")
        let stage = extensionRoot.appendingPathComponent(".the-6k-extension.new-\(UUID().uuidString)")
        try files.copyItem(at: source, to: stage); try verify(stage)
        if files.fileExists(atPath: destination.path) { try files.moveItem(at: destination, to: extensionRoot.appendingPathComponent(".the-6k-extension.backup-\(UUID().uuidString)")) }
        try files.moveItem(at: stage, to: destination); try installHost()
    }
    private func verify(_ dir: URL) throws { let data = try Data(contentsOf: dir.appendingPathComponent("manifest.json")); let json = try JSONSerialization.jsonObject(with: data) as? [String:Any]; guard json?["manifest_version"] as? Int == 3, json?["name"] as? String == "The 6K Extension" else { throw NSError(domain: "Installer", code: 2, userInfo: [NSLocalizedDescriptionKey: "The bundled The 6K Extension is invalid."]) } }
    private func installHost() throws {
        let python = URL(fileURLWithPath: "/usr/bin/python3")
        guard files.isExecutableFile(atPath: python.path) else {
            throw NSError(domain: "Installer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Python 3 is required for the bundled Yomitan helper but is not available on this Mac."])
        }
        try files.createDirectory(at: hostRoot, withIntermediateDirectories: true)
        let target = hostRoot.appendingPathComponent("yomitan-api-host")
        if files.fileExists(atPath: target.path) { try files.removeItem(at: target) }
        let launcher = "#!/bin/bash\nexec \(python.path) -u \"\(hostRoot.appendingPathComponent("yomitan_api.py").path)\"\n"
        try launcher.write(to: target, atomically: true, encoding: .utf8)
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: target.path)
        for resource in ["yomitan_api.py", "LICENSE.yomitan-api.txt"] {
            guard let source = Bundle.main.url(forResource: resource, withExtension: nil) else {
                throw NSError(domain: "Installer", code: 5, userInfo: [NSLocalizedDescriptionKey: "The bundled Yomitan helper is incomplete."])
            }
            let destination = hostRoot.appendingPathComponent(resource)
            if files.fileExists(atPath: destination.path) { try files.removeItem(at: destination) }
            try files.copyItem(at: source, to: destination)
        }
        try files.createDirectory(at: nativeManifest.deletingLastPathComponent(), withIntermediateDirectories: true)
        let manifest: [String:Any] = ["name":"yomitan_api", "description":"Yomitan API native messaging host", "path":target.path, "type":"stdio", "allowed_origins":["chrome-extension://\(yomitanExtensionID)/"]]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]).write(to: nativeManifest, options: .atomic)
    }
    func openChrome() throws {
        guard let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: chromeBundleID),
              let extensionsURL = URL(string: "chrome://extensions/") else {
            throw NSError(
                domain: "Installer",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Google Chrome was not found. Install Chrome, then click Open Chrome again."]
            )
        }
        NSWorkspace.shared.open(
            [extensionsURL],
            withApplicationAt: chrome,
            configuration: NSWorkspace.OpenConfiguration()
        )
    }
    func copyPath() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(extensionRoot.appendingPathComponent("the-6k-extension").path, forType: .string) }
    func checkYomitanAPI(completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:19633/serverVersion"),
              let body = try? JSONSerialization.data(withJSONObject: [:]) else {
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { data, response, _ in
            completion((response as? HTTPURLResponse)?.statusCode == 200 && data != nil)
        }.resume()
    }
}

final class Controller: NSWindowController {
    private let stack = NSStackView(); private var screen = "intro"
    convenience init() {
        self.init(window: NSWindow(contentRect: NSRect(x:0,y:0,width:640,height:330), styleMask:[.titled,.closable,.miniaturizable], backing:.buffered, defer:false))
        window?.title = "The 6K Extension Installer"
        configure()
    }
    private func configure() {
        window?.level = .floating
        window?.hidesOnDeactivate = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top:28,left:32,bottom:28,right:32)
        window?.contentView = stack
        Installer.shared.callback.onLoad = { [weak self] in
            Installer.shared.checkYomitanAPI { ready in
                DispatchQueue.main.async {
                    self?.screen = ready ? "web-setup" : "web-setup-yomitan"
                    self?.render()
                    self?.window?.orderFrontRegardless()
                }
            }
        }
        _ = Installer.shared.callback.start()
        render()
    }
    func render(_ error: String? = nil) {
        stack.arrangedSubviews.forEach { stack.removeArrangedSubview($0); $0.removeFromSuperview() }

        let content: (String, String)
        switch screen {
        case "intro":
            content = (
                "Welcome to The 6K Extension",
                "This little installer will help guide you through the installation of The 6K Extension. Just follow each step. Some of it will be automated and some of it will require manual clicks from you."
            )
        case "step":
            content = (
                "One Chrome step left",
                """
                I copied the The 6K Extension folder address and opened Chrome's Extensions page for you.

                1. In the top-right corner of Chrome, turn on the Developer mode switch. It is beside the words “Developer mode.”
                2. Look in the top-left area of the page. Click the Load unpacked button.
                3. A Finder window will open. Press Command-Shift-G, press Command-V, then press Return.
                4. The The 6K Extension folder will appear. Click Select.

                Chrome should then show a card named “The 6K Extension.” This is the one and only folder you need to select.
                """
            )
        case "web-setup":
            content = (
                "Continue setup in Chrome",
                """
                Chrome confirmed that The 6K Extension loaded. Keep this guide open while you finish the setup page that Chrome opened.

                1. You need a free jpdb account. Create one first if you do not already have one, then sign in. On the jpdb row, click Connect signed-in account. On the jpdb settings page, click Use this API key.
                2. Keep Anki open. Your AnkiConnect status should show Connected.
                3. Return to The 6K Extension setup page and click Check again after each step.

                Do not close this guide until jpdb and Yomitan both show Connected.
                """
            )
        case "web-setup-yomitan":
            content = (
                "One Yomitan setting needs attention",
                """
                The installer checked Yomitan's local API and could not reach it yet. This can happen if your imported settings did not enable the API.

                On The 6K Extension setup page, click Open API switch in the Yomitan row. In Yomitan settings, turn on Advanced, then turn on Enable Yomitan API. Return to The 6K Extension and click Check again.

                Then finish the remaining web setup:
                1. Create or sign in to your free jpdb account, then click Connect signed-in account and Use this API key.
                2. Keep Anki open and confirm AnkiConnect says Connected.

                Do not close this guide until jpdb and Yomitan both show Connected.
                """
            )
        case "manual-confirmation":
            content = (
                "Please confirm Chrome loaded it",
                "I could not automatically confirm Chrome's response. Look at chrome://extensions. If you can see a card named “The 6K Extension,” click the button below. If you do not see that card, use Copy folder path again and follow the four steps."
            )
        case "complete":
            content = (
                "Setup guide complete",
                "The 6K Extension is loaded, and you confirmed the remaining jpdb and Yomitan setup steps in Chrome. You can close this guide."
            )
        default:
            content = ("Setup needs attention", error ?? "Try again.")
        }

        let title = NSTextField(labelWithString: content.0)
        title.font = .systemFont(ofSize: 26, weight: .bold)
        let body = NSTextField(wrappingLabelWithString: content.1)
        body.maximumNumberOfLines = 0
        body.font = .systemFont(ofSize: 16)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(body)

        if screen == "intro" { button("Start setup", #selector(start)) }
        if screen == "step" {
            button("Copy folder path again", #selector(copyPath))
            button("Open Chrome again", #selector(open))
            button("I selected the folder and can see The 6K Extension", #selector(requestManualConfirmation))
        }
        if screen == "manual-confirmation" {
            button("Yes, I can see The 6K Extension in Chrome", #selector(showWebSetup))
            button("Copy folder path again", #selector(copyPath))
            button("Open Chrome again", #selector(open))
        }
        if screen == "web-setup" || screen == "web-setup-yomitan" {
            button("I finished the web setup and can see all connections", #selector(done))
            button("Open Chrome Extensions again", #selector(open))
        }
        if screen == "complete" { button("Close", #selector(closeWindow)) }
        if screen == "error" { button("Try again", #selector(start)) }
    }
    private func button(_ title:String,_ action:Selector) { let b=NSButton(title:title,target:self,action:action); b.bezelStyle = .rounded; b.controlSize = .large; stack.addArrangedSubview(b) }
    @objc private func start() {
        do {
            try Installer.shared.install()
            Installer.shared.copyPath()
            try Installer.shared.openChrome()
            screen = "step"
            render()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                self?.window?.orderFrontRegardless()
            }
        } catch {
            screen = "error"
            render(error.localizedDescription)
        }
    }
    @objc private func copyPath() { Installer.shared.copyPath() }
    @objc private func open() {
        do {
            try Installer.shared.openChrome()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                self?.window?.orderFrontRegardless()
            }
        } catch {
            screen = "error"
            render(error.localizedDescription)
        }
    }
    @objc private func requestManualConfirmation() { screen = "manual-confirmation"; render() }
    @objc private func showWebSetup() {
        Installer.shared.checkYomitanAPI { [weak self] ready in
            DispatchQueue.main.async {
                self?.screen = ready ? "web-setup" : "web-setup-yomitan"
                self?.render()
            }
        }
    }
    @objc private func done() {
        screen = "complete"
        render()
    }
    @objc private func closeWindow() { close() }
}
final class AppDelegate: NSObject, NSApplicationDelegate { var controller:Controller!; func applicationDidFinishLaunching(_ n:Notification) { controller=Controller(); controller.showWindow(self); NSApp.activate(ignoringOtherApps:true) }; func applicationShouldTerminateAfterLastWindowClosed(_ s:NSApplication)->Bool { true } }
let app=NSApplication.shared; let delegate=AppDelegate(); app.delegate=delegate; app.run()
