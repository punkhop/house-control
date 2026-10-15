import XCTest
@testable import HouseCore

@MainActor
final class BrowserBridgeTests: XCTestCase {
    private var root: URL!
    private var bridge: BrowserBridge!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("<html><head><title>H</title></head><body></body></html>".utf8).write(to: root.appendingPathComponent("index.html"))
        bridge = BrowserBridge(root: root)
        bridge.boot = { ["plan": "custom", "config": ["name": "4821 Riverton </script>"]] }
    }

    private func request(_ method: String, _ path: String, host: String = "localhost:4821", bridgeHeader: Bool = false, body: Any? = nil) -> HTTPRequest {
        var headers = ["host": host]
        if bridgeHeader { headers[BrowserBridge.header] = "1" }
        let data = body.flatMap { try? JSONSerialization.data(withJSONObject: $0) } ?? Data()
        return HTTPRequest(method: method, path: path, headers: headers, body: data)
    }

    func testIndexCarriesTheRealPlanForTheBrowser() async throws {
        let response = await bridge.handle(request("GET", "/"))
        XCTAssertEqual(response.status, 200)
        let html = String(decoding: response.body, as: UTF8.self)
        XCTAssertTrue(html.contains("window.__HOUSE_BOOT__ = "))
        XCTAssertTrue(html.contains("\"platform\":\"web\""))
        XCTAssertTrue(html.contains("4821 Riverton <\\/script>"), "a plan can't end the script tag early")
    }

    func testOtherHostNamesAreRefused() async {
        // A DNS-rebinding page reaches 127.0.0.1 under its own name.
        let response = await bridge.handle(request("GET", "/", host: "evil.example:4821"))
        XCTAssertEqual(response.status, 421)
    }

    func testBridgeCallsNeedTheHeader() async {
        var sent: [[String: Any]] = []
        bridge.onMessage = { message, reply in sent.append(message); reply(["ok": true]) }
        let refused = await bridge.handle(request("POST", "/bridge", body: ["type": "command", "id": "lamp"]))
        XCTAssertEqual(refused.status, 403)
        XCTAssertTrue(sent.isEmpty)

        let answered = await bridge.handle(request("POST", "/bridge", bridgeHeader: true, body: ["type": "command", "id": "lamp", "callId": 1]))
        XCTAssertEqual(answered.status, 200)
        XCTAssertEqual(sent.first?["id"] as? String, "lamp")
        let json = try? JSONSerialization.jsonObject(with: answered.body) as? [String: Any]
        XCTAssertEqual((json?["result"] as? [String: Any])?["ok"] as? Bool, true)
    }

    func testPollReturnsTheDevicesUpdate() async {
        bridge.poll = { ["lights": ["lamp": ["on": true]]] }
        let response = await bridge.handle(request("GET", "/poll", bridgeHeader: true))
        let json = try? JSONSerialization.jsonObject(with: response.body) as? [String: Any]
        XCTAssertNotNil((json?["update"] as? [String: Any])?["lights"])
    }

    func testFilesOutsideTheRootAreNotServed() async {
        let response = await bridge.handle(request("GET", "/../../etc/passwd"))
        XCTAssertEqual(response.status, 404)
    }
}
