import AppKit
import ApplicationServices

private let linearBundleID = "com.linear"
private let promptLabels: Set<String> = ["Console prompt", "コンソール プロンプト", "コンソールプロンプト"]
private let consoleLabels: Set<String> = ["Console", "コンソール"]

private enum RestoreError: String, Error {
    case permissionRequired, linearNotRunning, notForeground, cancelled, noDevTools, ambiguousDevTools
    case noPrompt, ambiguousPrompt, promptNotEditable, existingInput, focusChanged, accessibilityUnavailable
    case clipboardUnavailable, pasteFailed, receiptTimeout, missingAssets, restoreFailed, missingResource
    case verificationRequired, invalidResource, operationFailed
}

private enum RestoreStage: String, CaseIterable {
    case waitingPage, waitingDevTools, waitingPrompt, waitingSubmission, waitingReceipt

    func canWait(after error: any Error) -> Bool {
        guard let error = error as? RestoreError else { return false }
        switch error {
        case .accessibilityUnavailable: return true
        case .noDevTools: return self == .waitingDevTools
        case .noPrompt: return self == .waitingPrompt
        default: return false
        }
    }
}

private func readyLinearPage(url value: String?, loaded: Bool?) -> Bool {
    guard loaded == true, let value, let url = URL(string: value) else { return false }
    return url.scheme == "https" && url.host == "linear.app" && (url.port == nil || url.port == 443)
}

private func jsonString(_ value: String) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    guard let result = String(data: data, encoding: .utf8) else { throw RestoreError.invalidResource }
    return result
}

private func matchesPrompt(role: String, label: String) -> Bool {
    [kAXTextAreaRole, kAXTextFieldRole].contains(role) && promptLabels.contains(label)
}

private func recognizedDevToolsURL(_ value: String) -> Bool {
    guard let url = URL(string: value) else { return false }
    return url.scheme == "devtools" && url.host == "devtools"
}

private func devToolsIdentity(_ value: String) -> String? {
    guard recognizedDevToolsURL(value), let observed = URLComponents(string: value) else { return nil }
    var identity = URLComponents()
    identity.scheme = observed.scheme
    identity.host = observed.host
    identity.percentEncodedPath = observed.percentEncodedPath
    return identity.string
}

private func payload(source: String?, nonce: String) throws -> String {
    let prefix = try jsonString("LUVPAME_RESTORE:\(nonce):")
    guard let source else { return "console.log(\(prefix)+\"nonce-ok\")" }
    // Newline boundaries keep bundle comments from swallowing the receipt handler without requiring unsafe-eval.
    return "(()=>{try{\n\(source)\n;Promise.resolve(LuvpameOfflineRestore.restoreSavedOfflineGuide()).then(s=>console.log(\(prefix)+s)).catch(()=>console.log(\(prefix)+\"failed\"))}catch{console.log(\(prefix)+\"failed\")}})()"
}

private func canRetryAutomatically(_ error: any Error, inputStarted: Bool) -> Bool {
    guard !inputStarted else { return false }
    if error is CancellationError { return true }
    guard let error = error as? RestoreError else { return false }
    return [.notForeground, .noDevTools, .accessibilityUnavailable].contains(error)
}

private func matchesPromptValue(_ actual: String?, expected: String) -> Bool {
    guard let actual else { return false }
    if actual == expected { return true }
    // CodeMirror exposes a final line break even when its Console editor is empty.
    return actual.hasSuffix("\n") && String(actual.dropLast()) == expected
}

private func receipt(_ text: String, nonce: String) -> String? {
    let prefix = "LUVPAME_RESTORE:\(nonce):"
    guard text.hasPrefix(prefix) else { return nil }
    let status = String(text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    return ["nonce-ok", "started", "already-running", "missing-assets", "failed"].contains(status) ? status : nil
}

@MainActor
private enum AX {
    static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
        return result
    }

    static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        value(element, attribute) as? String
    }

    static func element(_ value: CFTypeRef?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    static func children(_ element: AXUIElement) throws -> [AXUIElement] {
        var result: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &result)
        if error == .attributeUnsupported || error == .noValue { return [] }
        guard error == .success, let values = result as? [CFTypeRef] else { throw RestoreError.accessibilityUnavailable }
        let children = values.compactMap(Self.element)
        guard children.count == values.count else { throw RestoreError.accessibilityUnavailable }
        return children
    }

    static func shouldDescend(role: String?, stoppingAtWebAreas: Bool) -> Bool {
        !stoppingAtWebAreas || role != "AXWebArea"
    }

    static func walk(_ root: AXUIElement, stoppingAtWebAreas: Bool = false) throws -> [AXUIElement] {
        let deadline = Date().addingTimeInterval(2)
        var pending: [(AXUIElement, Int)] = [(root, 0)]
        var result: [AXUIElement] = []
        while let (element, depth) = pending.popLast() {
            guard result.count < 4_000, Date() < deadline, depth < 35 else { throw RestoreError.accessibilityUnavailable }
            result.append(element)
            if !shouldDescend(role: stoppingAtWebAreas ? string(element, kAXRoleAttribute) : nil, stoppingAtWebAreas: stoppingAtWebAreas) { continue }
            pending.append(contentsOf: try children(element).map { ($0, depth + 1) })
        }
        return result
    }

    static func url(_ element: AXUIElement) -> String? {
        if let url = value(element, kAXURLAttribute) as? URL { return url.absoluteString }
        return string(element, kAXURLAttribute)
    }

    static func settable(_ element: AXUIElement, _ attribute: String) -> Bool {
        var result = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, attribute as CFString, &result) == .success && result.boolValue
    }

    static func editable(_ element: AXUIElement) -> Bool {
        let enabled = value(element, kAXEnabledAttribute) as? Bool
        return enabled != false && ((value(element, "AXEditable") as? Bool) == true || settable(element, kAXValueAttribute))
    }

    static func isPrompt(_ element: AXUIElement) -> Bool {
        let role = string(element, kAXRoleAttribute) ?? ""
        guard [kAXTextAreaRole, kAXTextFieldRole].contains(role) else { return false }
        return [kAXTitleAttribute, kAXDescriptionAttribute, "AXLabel"].contains {
            matchesPrompt(role: role, label: string(element, $0) ?? "")
        }
    }
}

@MainActor
private struct ClipboardSnapshot {
    let items: [[NSPasteboard.PasteboardType: Data]]
    let changeCount: Int

    init(_ board: NSPasteboard) throws {
        var result: [[NSPasteboard.PasteboardType: Data]] = []
        let count = board.changeCount
        guard let pasteboardItems = board.pasteboardItems else { throw RestoreError.clipboardUnavailable }
        for item in pasteboardItems {
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                guard let data = item.data(forType: type) else { throw RestoreError.clipboardUnavailable }
                values[type] = data
            }
            result.append(values)
        }
        guard count == board.changeCount else { throw RestoreError.clipboardUnavailable }
        items = result
        changeCount = count
    }

    static func shouldRestore(current: Int, owned: Int) -> Bool { current == owned }

    @discardableResult
    func restore(_ board: NSPasteboard, ownedCount: Int) -> Bool {
        guard Self.shouldRestore(current: board.changeCount, owned: ownedCount) else { return true }
        let restored = items.map { values in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        board.clearContents()
        return restored.isEmpty || board.writeObjects(restored)
    }
}

@MainActor
private struct LinearSession {
    let process: NSRunningApplication
    let root: AXUIElement
    let identity: String
    let gateIdentity: String

    init() throws {
        guard AXIsProcessTrusted() else { throw RestoreError.permissionRequired }
        guard let process = NSRunningApplication.runningApplications(withBundleIdentifier: linearBundleID).first,
              let url = process.bundleURL, let bundle = Bundle(url: url), let launchDate = process.launchDate else { throw RestoreError.linearNotRunning }
        self.process = process
        root = AXUIElementCreateApplication(process.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 0.3)
        identity = "\(process.processIdentifier):\(launchDate.timeIntervalSince1970)"
        gateIdentity = "\(url.path):\(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? ""):\(bundle.object(forInfoDictionaryKey: "CFBundleVersion") ?? "")"
    }

    func guardFrontmost() throws {
        try Task.checkCancellation()
        try guardForegroundIdentity()
    }

    private func guardForegroundIdentity() throws {
        guard !process.isTerminated, process.bundleIdentifier == linearBundleID,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == process.processIdentifier else {
            throw RestoreError.notForeground
        }
    }

    func webAreas() throws -> [AXUIElement] {
        try AX.walk(root, stoppingAtWebAreas: true).filter { AX.string($0, kAXRoleAttribute) == "AXWebArea" && recognizedDevToolsURL(AX.url($0) ?? "") }
    }

    func devTools() throws -> AXUIElement {
        let areas = try webAreas()
        guard areas.count == 1 else { throw areas.isEmpty ? RestoreError.noDevTools : RestoreError.ambiguousDevTools }
        return areas[0]
    }

    func prompt(in area: AXUIElement) throws -> AXUIElement {
        let candidates = try AX.walk(area).filter(AX.isPrompt)
        guard candidates.count == 1 else { throw candidates.isEmpty ? RestoreError.noPrompt : RestoreError.ambiguousPrompt }
        guard AX.editable(candidates[0]) else { throw RestoreError.promptNotEditable }
        return candidates[0]
    }

    func guardPrompt(_ prompt: AXUIElement, in area: AXUIElement, expected: String) throws {
        try guardFrontmost()
        var pid: pid_t = 0
        guard AXUIElementGetPid(prompt, &pid) == .success, pid == process.processIdentifier,
              CFEqual(try devTools(), area), CFEqual(try self.prompt(in: area), prompt),
              let focused = AX.element(AX.value(root, kAXFocusedUIElementAttribute)), CFEqual(focused, prompt) else {
            throw RestoreError.focusChanged
        }
        guard matchesPromptValue(AX.string(prompt, kAXValueAttribute), expected: expected) else { throw RestoreError.existingInput }
    }

    func press(_ key: CGKeyCode, flags: CGEventFlags = []) throws {
        try Task.checkCancellation()
        try postKey(key, flags: flags)
    }

    func closeDevTools(openedArea: AXUIElement, openedWindow: AXUIElement?) {
        guard (try? guardForegroundIdentity()) != nil,
              let current = try? devTools(), CFEqual(current, openedArea),
              let focused = AX.element(AX.value(root, kAXFocusedUIElementAttribute)),
              (try? AX.walk(current).contains(where: { CFEqual($0, focused) })) == true else { return }
        if let openedWindow {
            guard let currentWindow = AX.element(AX.value(current, kAXWindowAttribute)),
                  CFEqual(currentWindow, openedWindow) else { return }
        }
        try? postKey(34, flags: [.maskCommand, .maskAlternate])
    }

    private func postKey(_ key: CGKeyCode, flags: CGEventFlags) throws {
        try guardForegroundIdentity()
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false) else {
            throw RestoreError.accessibilityUnavailable
        }
        down.flags = flags
        up.flags = flags
        // PID targeting limits delivery, but the OS cannot atomically lock the focused control.
        down.postToPid(process.processIdentifier)
        up.postToPid(process.processIdentifier)
    }
}

@MainActor
private func probe() throws {
    let session = try LinearSession()
    let areas = try session.webAreas()
    let output: [String: Any] = [
        "trusted": true,
        "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier == session.process.processIdentifier,
        "devToolsWebAreas": try areas.map { area -> [String: Any] in
            ["url": AX.url(area) ?? "", "prompts": try AX.walk(area).filter(AX.isPrompt).map { element -> [String: Any] in
                ["role": AX.string(element, kAXRoleAttribute) ?? "",
                 "label": [kAXTitleAttribute, kAXDescriptionAttribute, "AXLabel"].compactMap { AX.string(element, $0) }.first(where: promptLabels.contains) ?? "",
                 "editable": AX.editable(element), "focusSettable": AX.settable(element, kAXFocusedAttribute)]
            }]
        }
    ]
    let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}

@MainActor
private final class Coordinator: NSObject, NSApplicationDelegate {
    enum State {
        case waitingPermission, waitingActivation, inspecting, injecting, finished, failed
        var waitsOnDeactivation: Bool {
            switch self {
            case .waitingActivation, .inspecting, .injecting: true
            case .waitingPermission, .finished, .failed: false
            }
        }
        var label: String {
            switch self {
            case .waitingPermission: "権限が必要"
            case .waitingActivation: "Linearを待機"
            case .inspecting: "確認中"
            case .injecting: "復元中"
            case .finished: "実行確認済み"
            case .failed: "停止"
            }
        }
    }
    var state = State.waitingActivation {
        didSet {
            statusItem?.button?.title = "復元: \(state.label)"
            statusMenuItem?.title = "状態: \(state.label)"
        }
    }
    private var statusItem: NSStatusItem?
    private var statusMenuItem: NSMenuItem?
    private var task: Task<Void, Never>?
    private var stage: RestoreStage? {
        didSet { defaults.set(stage?.rawValue, forKey: "lastStage") }
    }
    private var completed: Set<String> = []
    private var attemptCounts: [String: Int] = [:]
    private var stopped: Set<String> = []
    private let watch: Bool
    private let command: String?
    private let defaults = UserDefaults.standard

    init(watch: Bool, command: String?) { self.watch = watch; self.command = command }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let command {
            task = Task { await run(nonceOnly: command == "--nonce-test", exitWhenDone: true) }
            return
        }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        let menu = NSMenu()
        let status = NSMenuItem(title: "状態: 待機", action: nil, keyEquivalent: "")
        statusMenuItem = status
        menu.addItem(status)
        let retry = NSMenuItem(title: "復元を試す", action: #selector(retryRestore), keyEquivalent: "")
        retry.target = self
        menu.addItem(retry)
        let nonce = NSMenuItem(title: "接続確認", action: #selector(testNonce), keyEquivalent: "")
        nonce.target = self
        menu.addItem(nonce)
        let quit = NSMenuItem(title: "終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        item.menu = menu
        if !AXIsProcessTrusted() {
            state = .waitingPermission
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        } else { state = .waitingActivation }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification, NSWorkspace.didActivateApplicationNotification] {
            center.addObserver(self, selector: #selector(workspaceChanged), name: name, object: nil)
        }
        if watch { scheduleIfEligible() }
    }

    @objc private func workspaceChanged(_ notification: Notification) {
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier != linearBundleID {
            task?.cancel()
            if state.waitsOnDeactivation { state = .waitingActivation }
        }
        if let process = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
           notification.name == NSWorkspace.didTerminateApplicationNotification, process.bundleIdentifier == linearBundleID {
            task?.cancel()
        }
        if watch { scheduleIfEligible() }
    }

    private func scheduleIfEligible() {
        guard task == nil, AXIsProcessTrusted(), let session = try? LinearSession(),
              NSWorkspace.shared.frontmostApplication?.processIdentifier == session.process.processIdentifier,
              !completed.contains(session.identity), !stopped.contains(session.identity),
              attemptCounts[session.identity, default: 0] < 3 else { return }
        attemptCounts[session.identity, default: 0] += 1
        task = Task { await run(nonceOnly: false, exitWhenDone: false) }
    }

    @objc private func retryRestore() {
        guard task == nil else { return }
        task = Task { await run(nonceOnly: false, exitWhenDone: false) }
    }

    @objc private func testNonce() {
        guard task == nil else { return }
        task = Task { await run(nonceOnly: true, exitWhenDone: false) }
    }

    private func pause() async throws { try await Task.sleep(for: .milliseconds(250)) }

    private func run(nonceOnly: Bool, exitWhenDone: Bool) async {
        defaults.removeObject(forKey: "lastError")
        stage = nil
        var sessionIdentity: String?
        var inputStarted = false
        var retryAutomatically = false
        defer {
            task = nil
            if watch && retryAutomatically { scheduleIfEligible() }
        }
        do {
            let session = try LinearSession()
            sessionIdentity = session.identity
            try session.guardFrontmost()
            if !nonceOnly && defaults.string(forKey: "verifiedLinear") != session.gateIdentity { throw RestoreError.verificationRequired }
            state = .inspecting
            let status = try await inject(session, nonceOnly: nonceOnly, inputStarted: &inputStarted)
            if !nonceOnly { completed.insert(session.identity) }
            defaults.removeObject(forKey: "lastError")
            state = .finished
            print(status)
            if exitWhenDone { exit(0) }
        } catch {
            retryAutomatically = !nonceOnly && canRetryAutomatically(error, inputStarted: inputStarted)
            if let sessionIdentity, !nonceOnly, !retryAutomatically { stopped.insert(sessionIdentity) }
            state = (error as? RestoreError) == .permissionRequired ? .waitingPermission : .failed
            let code = ((error as? RestoreError) ?? (error is CancellationError ? .cancelled : .operationFailed)).rawValue
            defaults.set(code, forKey: "lastError")
            statusMenuItem?.title = "停止: \(code)"
            print(code)
            if exitWhenDone { exit(1) }
        }
    }

    private func inject(_ session: LinearSession, nonceOnly: Bool, inputStarted: inout Bool) async throws -> String {
        let deadline = Date().addingTimeInterval(30)
        var opened = false
        var openedArea: AXUIElement?
        var openedWindow: AXUIElement?
        defer {
            if let openedArea { session.closeDevTools(openedArea: openedArea, openedWindow: openedWindow) }
        }
        stage = .waitingPage
        var areas: [AXUIElement]?
        while Date() < deadline {
            try session.guardFrontmost()
            do {
                let webAreas = try AX.walk(session.root, stoppingAtWebAreas: true).filter { AX.string($0, kAXRoleAttribute) == "AXWebArea" }
                if webAreas.contains(where: { readyLinearPage(url: AX.url($0), loaded: AX.value($0, "AXLoaded") as? Bool) }) {
                    areas = webAreas.filter { recognizedDevToolsURL(AX.url($0) ?? "") }
                    break
                }
            } catch let error where RestoreStage.waitingPage.canWait(after: error) {}
            try await pause()
        }
        guard let areas else { throw RestoreError.accessibilityUnavailable }
        guard areas.count <= 1 else { throw RestoreError.ambiguousDevTools }
        if areas.isEmpty {
            try session.press(34, flags: [.maskCommand, .maskAlternate])
            opened = true
        }
        stage = .waitingDevTools
        var area: AXUIElement?
        while Date() < deadline {
            try session.guardFrontmost()
            do { area = try session.devTools(); break }
            catch let error where RestoreStage.waitingDevTools.canWait(after: error) { try await pause() }
        }
        guard let area else { throw RestoreError.noDevTools }
        if opened {
            openedArea = area
            openedWindow = AX.element(AX.value(area, kAXWindowAttribute))
        }
        guard let observedIdentity = devToolsIdentity(AX.url(area) ?? "") else { throw RestoreError.noDevTools }
        if !nonceOnly && defaults.string(forKey: "verifiedDevToolsURL").flatMap(devToolsIdentity) != observedIdentity { throw RestoreError.verificationRequired }
        stage = .waitingPrompt
        var prompt: AXUIElement?
        var selectedConsole = false
        while Date() < deadline {
            try session.guardFrontmost()
            do {
                guard CFEqual(try session.devTools(), area) else { throw RestoreError.focusChanged }
                do { prompt = try session.prompt(in: area); break }
                catch RestoreError.noPrompt {
                    if !selectedConsole {
                        let tabs = try AX.walk(area).filter { element in
                            [kAXRadioButtonRole, kAXButtonRole, "AXTab"].contains(AX.string(element, kAXRoleAttribute) ?? "") &&
                            [kAXTitleAttribute, kAXDescriptionAttribute].contains { consoleLabels.contains(AX.string(element, $0) ?? "") }
                        }
                        guard tabs.count <= 1 else { throw RestoreError.ambiguousPrompt }
                        if let tab = tabs.first {
                            try session.guardFrontmost()
                            guard CFEqual(try session.devTools(), area) else { throw RestoreError.focusChanged }
                            selectedConsole = true
                            guard AXUIElementPerformAction(tab, kAXPressAction as CFString) == .success else { throw RestoreError.focusChanged }
                        }
                    }
                }
            } catch let error where RestoreStage.waitingPrompt.canWait(after: error) {}
            try await pause()
        }
        guard let prompt else { throw RestoreError.noPrompt }
        try session.guardFrontmost()
        guard CFEqual(try session.devTools(), area), CFEqual(try session.prompt(in: area), prompt) else { throw RestoreError.focusChanged }
        guard matchesPromptValue(AX.string(prompt, kAXValueAttribute), expected: "") else { throw RestoreError.existingInput }
        if !AX.settable(prompt, kAXFocusedAttribute) { throw RestoreError.focusChanged }
        guard AXUIElementSetAttributeValue(prompt, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { throw RestoreError.focusChanged }
        try session.guardPrompt(prompt, in: area, expected: "")
        let source: String?
        if nonceOnly { source = nil }
        else {
            guard let url = Bundle.main.url(forResource: "restore", withExtension: "js") else { throw RestoreError.missingResource }
            source = try String(contentsOf: url, encoding: .utf8)
        }
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let script = try payload(source: source, nonce: nonce)
        var previousOutput: [AXUIElement]?
        while Date() < deadline {
            try session.guardFrontmost()
            do {
                try session.guardPrompt(prompt, in: area, expected: "")
                previousOutput = try AX.walk(area).filter { AX.string($0, kAXRoleAttribute) == kAXStaticTextRole }
                break
            } catch let error where RestoreStage.waitingPrompt.canWait(after: error) { try await pause() }
        }
        guard let previousOutput else { throw RestoreError.accessibilityUnavailable }
        let board = NSPasteboard.general
        let snapshot = try ClipboardSnapshot(board)
        try session.guardPrompt(prompt, in: area, expected: "")
        guard board.changeCount == snapshot.changeCount else { throw RestoreError.clipboardUnavailable }
        board.clearContents()
        var ownedCount = board.changeCount
        var clipboardRestored = false
        defer {
            if !clipboardRestored { _ = snapshot.restore(board, ownedCount: ownedCount) }
        }
        guard board.setString(script, forType: .string) else { throw RestoreError.clipboardUnavailable }
        ownedCount = board.changeCount
        state = .injecting
        try session.guardPrompt(prompt, in: area, expected: "")
        guard board.changeCount == ownedCount else { throw RestoreError.clipboardUnavailable }
        inputStarted = true
        stage = .waitingSubmission
        let submissionDeadline = Date().addingTimeInterval(5)
        try session.press(9, flags: .maskCommand)
        var pasted = false
        for _ in 0..<8 {
            try await pause()
            try session.guardFrontmost()
            if matchesPromptValue(AX.string(prompt, kAXValueAttribute), expected: script) { pasted = true; break }
        }
        guard pasted else { throw RestoreError.pasteFailed }
        guard snapshot.restore(board, ownedCount: ownedCount) else { throw RestoreError.clipboardUnavailable }
        clipboardRestored = true
        var readyToSubmit = false
        while Date() < submissionDeadline {
            try session.guardFrontmost()
            do {
                try session.guardPrompt(prompt, in: area, expected: script)
                readyToSubmit = true
                break
            } catch let error where RestoreStage.waitingSubmission.canWait(after: error) { try await pause() }
        }
        guard readyToSubmit else { throw RestoreError.accessibilityUnavailable }
        try session.press(36)
        stage = .waitingReceipt
        // The page can wait 30 seconds for its toolbar before reporting completion.
        let receiptDeadline = Date().addingTimeInterval(35)
        while Date() < receiptDeadline {
            try await pause()
            try session.guardFrontmost()
            do {
                guard CFEqual(try session.devTools(), area) else { throw RestoreError.focusChanged }
                for node in try AX.walk(area) where AX.string(node, kAXRoleAttribute) == kAXStaticTextRole && !previousOutput.contains(where: { CFEqual($0, node) }) {
                    let text = AX.string(node, kAXValueAttribute) ?? AX.string(node, kAXTitleAttribute) ?? ""
                    guard let status = receipt(text, nonce: nonce) else { continue }
                    if status == "missing-assets" { throw RestoreError.missingAssets }
                    if status == "failed" { throw RestoreError.restoreFailed }
                    if nonceOnly && status == "nonce-ok" {
                        defaults.set(session.gateIdentity, forKey: "verifiedLinear")
                        defaults.set(observedIdentity, forKey: "verifiedDevToolsURL")
                        return status
                    }
                    if !nonceOnly && ["started", "already-running"].contains(status) { return status }
                }
            } catch let error where RestoreStage.waitingReceipt.canWait(after: error) {}
        }
        throw RestoreError.receiptTimeout
    }
}

@MainActor
private func status() throws {
    let defaults = UserDefaults.standard
    let url = NSRunningApplication.runningApplications(withBundleIdentifier: linearBundleID).first?.bundleURL
    let current = url.flatMap { url -> String? in
        guard let bundle = Bundle(url: url) else { return nil }
        return "\(url.path):\(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? ""):\(bundle.object(forInfoDictionaryKey: "CFBundleVersion") ?? "")"
    }
    let verified = defaults.string(forKey: "verifiedLinear")
    let result: [String: Any] = [
        "trusted": AXIsProcessTrusted(),
        "verified": current != nil && verified == current && recognizedDevToolsURL(defaults.string(forKey: "verifiedDevToolsURL") ?? ""),
        "currentVersion": current as Any? ?? NSNull(),
        "verifiedVersion": verified as Any? ?? NSNull(),
        "lastStage": defaults.string(forKey: "lastStage").flatMap(RestoreStage.init(rawValue:))?.rawValue as Any? ?? NSNull(),
        "lastError": defaults.string(forKey: "lastError").flatMap(RestoreError.init(rawValue:))?.rawValue as Any? ?? NSNull()
    ]
    print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
}

@MainActor
private func selfCheck() throws {
    precondition(readyLinearPage(url: "https://linear.app/workspace", loaded: true))
    precondition(readyLinearPage(url: "https://linear.app:443/workspace", loaded: true))
    precondition(!readyLinearPage(url: "https://linear.app/workspace", loaded: false))
    precondition(!readyLinearPage(url: "https://linear.app/workspace", loaded: nil))
    precondition(!readyLinearPage(url: nil, loaded: true))
    precondition(!readyLinearPage(url: "https://linear.app.untrusted/workspace", loaded: true))
    precondition(!readyLinearPage(url: "http://linear.app/workspace", loaded: true))
    precondition(!readyLinearPage(url: "https://linear.app:444/workspace", loaded: true))
    for stage in RestoreStage.allCases {
        precondition(stage.canWait(after: RestoreError.accessibilityUnavailable))
        for error in [RestoreError.existingInput, .ambiguousPrompt, .ambiguousDevTools, .focusChanged, .permissionRequired, .verificationRequired, .restoreFailed] {
            precondition(!stage.canWait(after: error))
        }
        precondition(!stage.canWait(after: CancellationError()))
        precondition(stage.canWait(after: RestoreError.noDevTools) == (stage == .waitingDevTools))
        precondition(stage.canWait(after: RestoreError.noPrompt) == (stage == .waitingPrompt))
    }
    precondition(!AX.shouldDescend(role: "AXWebArea", stoppingAtWebAreas: true))
    precondition(AX.shouldDescend(role: "AXWebArea", stoppingAtWebAreas: false))
    precondition(AX.shouldDescend(role: kAXApplicationRole, stoppingAtWebAreas: true))
    precondition(!Coordinator.State.failed.waitsOnDeactivation)
    precondition(!Coordinator.State.finished.waitsOnDeactivation)
    precondition(!Coordinator.State.waitingPermission.waitsOnDeactivation)
    precondition(Coordinator.State.inspecting.waitsOnDeactivation)
    precondition(Coordinator.State.injecting.waitsOnDeactivation)
    precondition(RestoreError(rawValue: "accessibilityUnavailable") != nil)
    precondition(RestoreError(rawValue: "arbitrary page content") == nil)
    precondition(matchesPromptValue("", expected: ""))
    precondition(matchesPromptValue("\n", expected: ""))
    precondition(matchesPromptValue("console.log(1)\n", expected: "console.log(1)"))
    precondition(!matchesPromptValue("unfinished()\n", expected: ""))
    precondition(!matchesPromptValue(" \n", expected: ""))
    precondition(!matchesPromptValue("\n\n", expected: ""))
    precondition(!matchesPromptValue(nil, expected: ""))
    precondition(matchesPrompt(role: kAXTextAreaRole, label: "Console prompt"))
    precondition(matchesPrompt(role: kAXTextFieldRole, label: "コンソール プロンプト"))
    precondition(!matchesPrompt(role: kAXTextAreaRole, label: "Sources"))
    precondition(!matchesPrompt(role: kAXTextAreaRole, label: "Issue description"))
    precondition(!matchesPrompt(role: kAXButtonRole, label: "Console prompt"))
    precondition(recognizedDevToolsURL("devtools://devtools/bundled/inspector.html"))
    precondition(!recognizedDevToolsURL("https://linear.app/devtools"))
    precondition(!recognizedDevToolsURL("devtools://untrusted/inspector.html"))
    let inspectorIdentity = "devtools://devtools/bundled/inspector.html"
    precondition(devToolsIdentity(inspectorIdentity + "?ws=first&panel=console#first") == inspectorIdentity)
    precondition(devToolsIdentity(inspectorIdentity + "?ws=second&target=new#second") == inspectorIdentity)
    precondition(devToolsIdentity("devtools://devtools/bundled/other.html") != inspectorIdentity)
    precondition(devToolsIdentity("https://devtools/bundled/inspector.html") == nil)
    precondition(devToolsIdentity("devtools://untrusted/bundled/inspector.html") == nil)
    precondition(receipt("LUVPAME_RESTORE:abc:started", nonce: "abc") == "started")
    precondition(receipt("LUVPAME_RESTORE:abc:nonce-ok\n", nonce: "abc") == "nonce-ok")
    precondition(receipt("LUVPAME_RESTORE:other:started", nonce: "abc") == nil)
    precondition(receipt("console.log('LUVPAME_RESTORE:abc:started')", nonce: "abc") == nil)
    precondition(receipt("LUVPAME_RESTORE:abc:unexpected", nonce: "abc") == nil)
    let privateBoard = NSPasteboard.withUniqueName()
    defer { privateBoard.releaseGlobally() }
    if privateBoard.pasteboardItems == nil {
        do { _ = try ClipboardSnapshot(privateBoard); preconditionFailure("Unreadable clipboard must be rejected") }
        catch RestoreError.clipboardUnavailable {}
    } else {
        let emptySnapshot = try ClipboardSnapshot(privateBoard)
        precondition(emptySnapshot.items.isEmpty)
    }
    precondition(ClipboardSnapshot.shouldRestore(current: 4, owned: 4))
    precondition(!ClipboardSnapshot.shouldRestore(current: 5, owned: 4))
    let source = "// comment\nconst x = '\\';\n\u{2028}\"quoted\""
    let encoded = try jsonString(source)
    let decoded = try JSONSerialization.jsonObject(with: Data(encoded.utf8), options: [.fragmentsAllowed]) as? String
    precondition(decoded == source)
    let bundle = "var LuvpameOfflineRestore = { restoreSavedOfflineGuide: () => Promise.resolve('started') };\n// trailing comment"
    let script = try payload(source: bundle, nonce: "abc")
    precondition(script.hasPrefix("(()=>{try{\n" + bundle + "\n;Promise.resolve("))
    precondition(!script.contains("eval("))
    precondition(script.hasSuffix("}})()"))
    precondition(canRetryAutomatically(CancellationError(), inputStarted: false))
    precondition(canRetryAutomatically(RestoreError.noDevTools, inputStarted: false))
    precondition(canRetryAutomatically(RestoreError.accessibilityUnavailable, inputStarted: false))
    precondition(!canRetryAutomatically(RestoreError.accessibilityUnavailable, inputStarted: true))
    precondition(!canRetryAutomatically(RestoreError.focusChanged, inputStarted: false))
    precondition(!canRetryAutomatically(CancellationError(), inputStarted: true))
    precondition(!canRetryAutomatically(RestoreError.noDevTools, inputStarted: true))
    precondition(!canRetryAutomatically(RestoreError.existingInput, inputStarted: false))
    precondition(!canRetryAutomatically(RestoreError.ambiguousPrompt, inputStarted: false))
    precondition(script.contains("restoreSavedOfflineGuide"))
    let nonceScript = try payload(source: nil, nonce: "abc")
    precondition(nonceScript == "console.log(\"LUVPAME_RESTORE:abc:\"+\"nonce-ok\")")
    print("self-check passed")
}

let arguments = Set(CommandLine.arguments.dropFirst())
if arguments.contains("--check-permission") {
    print(AXIsProcessTrusted() ? "trusted" : "not-trusted")
} else if arguments.contains("--self-check") {
    do { try selfCheck() } catch { print("self-check failed"); exit(1) }
} else if arguments.contains("--status") {
    do { try status() } catch { print("statusFailed"); exit(1) }
} else if arguments.contains("--probe") {
    do { try probe() } catch { print((error as? RestoreError)?.rawValue ?? "probeFailed"); exit(1) }
} else {
    let command = arguments.contains("--nonce-test") ? "--nonce-test" : (arguments.contains("--restore-once") ? "--restore-once" : nil)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let coordinator = Coordinator(watch: arguments.contains("--watch"), command: command)
    app.delegate = coordinator
    app.run()
}
