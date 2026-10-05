import Capacitor
import QuickLook
import UIKit

/// Registers OneShare's app-local plugins with the Capacitor bridge.
class OneShareBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OneShareFilesPlugin())
    }
}

/// Keeps downloaded attachments in OneShare's Application Support folder
/// (Downloads/<key>/<file name>) and previews them in Quick Look, like
/// Telegram does. Quick Look's share button covers "Open in…" for anything
/// it can't render itself.
@objc(OneShareFilesPlugin)
public class OneShareFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OneShareFilesPlugin"
    public let jsName = "OneShareFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private static let maxDownloadBytes: Int64 = 500 * 1024 * 1024
    private static let progressInterval: TimeInterval = 0.15

    private struct PendingDownload {
        let call: CAPPluginCall
        let key: String
        let fileName: String
        var lastProgressAt = Date.distantPast
        var isTooLarge = false
    }

    private lazy var session = URLSession(
        configuration: .default,
        delegate: self,
        delegateQueue: nil
    )
    private let lock = NSLock()
    private var pendingDownloads: [Int: PendingDownload] = [:]
    private var previewURL: URL?

    @objc func status(_ call: CAPPluginCall) {
        let keys = (call.getArray("keys") ?? []).compactMap { $0 as? String }
        call.resolve(["downloaded": keys.filter { findFile($0) != nil }])
    }

    @objc func download(_ call: CAPPluginCall) {
        guard
            let key = call.getString("key"), Self.isValidKey(key),
            let fileName = call.getString("fileName"),
            let urlString = call.getString("url"),
            let url = URL(string: urlString),
            url.scheme?.lowercased() == "https",
            url.host?.isEmpty == false
        else {
            call.reject("Invalid file details.")
            return
        }

        if let existing = findFile(key) {
            call.resolve(["fileName": existing.lastPathComponent])
            return
        }

        let task = session.downloadTask(with: url)
        lock.lock()
        pendingDownloads[task.taskIdentifier] = PendingDownload(
            call: call,
            key: key,
            fileName: fileName
        )
        lock.unlock()
        task.resume()
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let file = findFile(key) else {
            call.reject("The file isn't downloaded.", "NOT_DOWNLOADED")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("OneShare couldn't show that file.")
                return
            }
            self.previewURL = file
            let preview = QLPreviewController()
            preview.dataSource = self
            presenter.present(preview, animated: true)
            call.resolve()
        }
    }

    private func downloadsRoot() throws -> URL {
        try FileManager.default
            .url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            .appendingPathComponent("Downloads", isDirectory: true)
    }

    private func findFile(_ key: String) -> URL? {
        guard Self.isValidKey(key), let root = try? downloadsRoot() else {
            return nil
        }
        let directory = root.appendingPathComponent(key, isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        )) ?? []
        return files.first { !$0.hasDirectoryPath }
    }

    /// A key holds exactly one file; replace whatever an earlier download left.
    private func store(_ location: URL, key: String, fileName: String) throws -> URL {
        let fileManager = FileManager.default
        let directory = try downloadsRoot().appendingPathComponent(key, isDirectory: true)
        if fileManager.fileExists(atPath: directory.path) {
            try fileManager.removeItem(at: directory)
        }
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(Self.safeFileName(fileName))
        try fileManager.moveItem(at: location, to: destination)
        return destination
    }

    private func takePending(_ task: URLSessionTask) -> PendingDownload? {
        lock.lock()
        defer { lock.unlock() }
        return pendingDownloads.removeValue(forKey: task.taskIdentifier)
    }

    private static func isValidKey(_ key: String) -> Bool {
        key.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
    }

    private static func safeFileName(_ value: String) -> String {
        let separators = CharacterSet(charactersIn: "/\\").union(.controlCharacters)
        let fileName = value
            .components(separatedBy: separators)
            .joined(separator: "-")
            .trimmingCharacters(in: .whitespaces)
        if fileName.isEmpty || fileName == "." || fileName == ".." {
            return "download"
        }
        return String(fileName.prefix(240))
    }
}

extension OneShareFilesPlugin: URLSessionDownloadDelegate {
    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        lock.lock()
        guard var pending = pendingDownloads[downloadTask.taskIdentifier] else {
            lock.unlock()
            return
        }
        if totalBytesWritten > Self.maxDownloadBytes {
            pending.isTooLarge = true
            pendingDownloads[downloadTask.taskIdentifier] = pending
            lock.unlock()
            downloadTask.cancel()
            return
        }
        let now = Date()
        let shouldNotify = now.timeIntervalSince(pending.lastProgressAt) >= Self.progressInterval
        if shouldNotify {
            pending.lastProgressAt = now
            pendingDownloads[downloadTask.taskIdentifier] = pending
        }
        lock.unlock()

        if shouldNotify {
            notifyListeners("downloadProgress", data: [
                "key": pending.key,
                "received": Double(totalBytesWritten),
                "total": Double(totalBytesExpectedToWrite),
            ])
        }
    }

    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let pending = takePending(downloadTask) else { return }

        if let response = downloadTask.response as? HTTPURLResponse,
           !(200..<300).contains(response.statusCode) {
            pending.call.reject("Download failed (\(response.statusCode)).")
            return
        }

        do {
            // The temporary file is deleted when this method returns, so move it now.
            let destination = try store(location, key: pending.key, fileName: pending.fileName)
            pending.call.resolve(["fileName": destination.lastPathComponent])
        } catch {
            pending.call.reject("OneShare couldn't save the file.")
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let error, let pending = takePending(task) else { return }
        pending.call.reject(
            pending.isTooLarge ? "The file is larger than 500 MB." : error.localizedDescription
        )
    }
}

extension OneShareFilesPlugin: QLPreviewControllerDataSource {
    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewURL == nil ? 0 : 1
    }

    public func previewController(
        _ controller: QLPreviewController,
        previewItemAt index: Int
    ) -> QLPreviewItem {
        (previewURL ?? URL(fileURLWithPath: "/")) as NSURL
    }
}
