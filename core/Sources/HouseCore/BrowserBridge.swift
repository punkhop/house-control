import Foundation

/// House Control as a full page in a browser on this Mac (http://localhost:4821): serves the
/// web UI and stands in for the WebKit bridge, so the page shows the real home and its
/// devices exactly as the menu bar panel does.
///
/// Only this Mac can reach it (the server listens on the loopback address), and only a page
/// it served itself can drive it: the Host header must name the page's own address (no DNS
/// rebinding), and bridge calls need a custom header that a page on any other origin can
/// only send after a CORS preflight, which is never answered.
@MainActor
public final class BrowserBridge {
    public static let port: UInt16 = 4821
    public static let header = "x-house-bridge"

    private let root: URL
    /// What `window.__HOUSE_BOOT__` holds in the app's own web views.
    public var boot: () -> [String: Any] = { [:] }
    /// A message the page would post to the app (`command`, `state`, …); calls back with the
    /// reply for the ones that expect one.
    public var onMessage: ([String: Any], @escaping (Any) -> Void) -> Void = { _, reply in reply([:]) }
    /// The devices' latest state, read on demand (nil when nothing is linked or reachable).
    public var poll: () async -> [String: Any]? = { nil }

    public init(root: URL) { self.root = root }

    public func handle(_ request: HTTPRequest) async -> HTTPResponse {
        let host = request.headers["host"] ?? ""
        guard ["localhost:\(Self.port)", "127.0.0.1:\(Self.port)"].contains(host) else {
            return .text("Open http://localhost:\(Self.port)\n", status: 421)
        }
        switch (request.method, request.path) {
        case ("POST", "/bridge"):
            guard request.headers[Self.header] == "1" else { return .text("Forbidden\n", status: 403) }
            guard let message = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] else {
                return .text("Bad request\n", status: 400)
            }
            let result: Any = await withCheckedContinuation { done in
                var answered = false
                onMessage(message) { value in
                    guard !answered else { return }
                    answered = true
                    done.resume(returning: value)
                }
            }
            return .json(["result": result])
        case ("GET", "/poll"):
            guard request.headers[Self.header] == "1" else { return .text("Forbidden\n", status: 403) }
            let update: Any = await poll() ?? NSNull()
            return .json(["update": update])
        case ("GET", _):
            return file(request.path)
        default:
            return .notFound
        }
    }

    private static let mime: [String: String] = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
        "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
        "woff2": "font/woff2", "map": "application/json",
    ]

    private func file(_ path: String) -> HTTPResponse {
        let relative = path == "/" || path.isEmpty ? "index.html" : String(path.drop(while: { $0 == "/" }))
        let url = root.appendingPathComponent(relative).standardizedFileURL
        guard url.path.hasPrefix(root.standardizedFileURL.path + "/"), var data = try? Data(contentsOf: url) else {
            return .notFound
        }
        let ext = url.pathExtension.lowercased()
        if relative == "index.html", let html = String(data: data, encoding: .utf8) {
            var boot = boot()
            boot["platform"] = "web"
            // `</` would end the script tag early; JSON allows it escaped.
            let literal = WebJSON.literal(boot).replacingOccurrences(of: "</", with: "<\\/")
            let script = "<script>window.__HOUSE_BOOT__ = \(literal);</script>\n  </head>"
            data = Data(html.replacingOccurrences(of: "</head>", with: script).utf8)
        }
        let type = Self.mime[ext] ?? "application/octet-stream"
        return HTTPResponse(status: 200, headers: [
            "Content-Type": type.hasPrefix("text/") || type.hasSuffix("json") ? "\(type); charset=utf-8" : type,
            "Cache-Control": "no-cache",
        ], body: data)
    }
}
