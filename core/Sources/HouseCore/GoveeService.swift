import Foundation
#if canImport(Darwin)
import Darwin
#endif

/// Govee lamps on the local network, through Govee's LAN API (switched on per lamp in the
/// Govee app under "LAN Control"). No account: a scan sent to the multicast group finds the
/// lamps, commands go to each lamp's port 4003, and every lamp answers on port 4002 of the
/// sender. A lamp is known by its device id; the address it last answered from is remembered,
/// so it can be read and switched before the next scan.
@MainActor
public final class GoveeService: DeviceService {
    public let id = "govee"
    public let title = "Govee"
    public var onChange: (() -> Void)?

    struct Lamp: Codable {
        var ip: String
        var sku: String
    }

    private let vault: SecretStore
    /// Device id → where it answered last.
    private var lamps: [String: Lamp]
    private let socket = GoveeSocket()
    /// The last status each address reported, and when.
    private var statuses: [String: (at: Date, data: [String: Any])] = [:]

    public init(vault: SecretStore) {
        self.vault = vault
        lamps = vault.read().flatMap { try? JSONDecoder().decode([String: Lamp].self, from: $0) } ?? [:]
        socket.onMessage = { [weak self] ip, message in
            Task { @MainActor in self?.receive(ip: ip, message: message) }
        }
    }

    /// The LAN API needs no account, so the service is always there to scan.
    public var isConnected: Bool { true }

    public var info: [String: Any] { ["connected": true, "lamps": lamps.count] }

    public var shareable: [String: Any]? {
        guard !lamps.isEmpty, let data = try? JSONEncoder().encode(lamps) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    public func adopt(_ shared: [String: Any]?) {
        guard let shared, let data = try? JSONSerialization.data(withJSONObject: shared),
              let incoming = try? JSONDecoder().decode([String: Lamp].self, from: data) else { return }
        lamps.merge(incoming) { _, new in new }
        save()
    }

    public func disconnect() {
        lamps = [:]
        save()
    }

    // MARK: - Devices

    public func devices() async throws -> [ServiceDevice] {
        try socket.open()
        let scan: [String: Any] = ["msg": ["cmd": "scan", "data": ["account_topic": "reserve"]]]
        socket.send(scan, to: "239.255.255.250", port: 4001)
        for lamp in lamps.values { socket.send(scan, to: lamp.ip, port: 4001) }
        try await Task.sleep(nanoseconds: 1_500_000_000)
        return lamps.sorted { $0.key < $1.key }.map { id, lamp in
            var device = ServiceDevice(id: id, name: "Govee \(lamp.sku) · \(lamp.ip)", kind: .light)
            device.capabilities = ["brightness", "temp", "color"]
            device.detail = "\(lamp.sku) · LAN"
            return device
        }
    }

    public func read(_ ids: Set<String>) async throws -> [String: DeviceReading] {
        let wanted = ids.compactMap { id in lamps[id].map { (id, $0.ip) } }
        guard !wanted.isEmpty else { return [:] }
        try socket.open()
        let asked = Date()
        for (_, ip) in wanted { socket.send(["msg": ["cmd": "devStatus", "data": [String: Any]()]], to: ip, port: 4003) }
        for _ in 0..<15 {
            if wanted.allSatisfy({ (statuses[$0.1]?.at ?? .distantPast) >= asked }) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        var out: [String: DeviceReading] = [:]
        for (id, ip) in wanted {
            if let status = statuses[ip], status.at >= asked {
                out[id] = DeviceReading(light: Self.lightState(status.data))
            } else {
                out[id] = DeviceReading(online: false)
            }
        }
        return out
    }

    public func send(kind: DeviceKind, id: String, patch: [String: Any], state: [String: Any]) async throws {
        guard kind == .light else { throw ServiceFailure("Govee only controls lights") }
        guard let lamp = lamps[id] else { throw ServiceFailure("This Govee lamp has not answered a scan yet") }
        try socket.open()
        for command in Self.commands(patch: DeviceKind.withPower(patch, state: state)) {
            socket.send(["msg": command], to: lamp.ip, port: 4003)
            // A lamp drops a command that arrives on the heels of the one before (measured: 80 ms is too close).
            try await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    // MARK: - Mapping

    static func lightState(_ data: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        if let on = data.double("onOff") { out["on"] = on == 1 }
        if let b = data.double("brightness") { out["brightness"] = max(0.05, min(1, b / 100)) }
        if let k = data.double("colorTemInKelvin"), k > 0 {
            out["temp"] = max(2200, min(6500, k))
            out["color"] = NSNull()
        } else if let c = data["color"] as? [String: Any], let r = c.double("r"), let g = c.double("g"), let b = c.double("b") {
            out["color"] = ColorMath.hex(r: r / 255, g: g / 255, b: b / 255)
        }
        return out
    }

    /// One LAN command per changed field: power first, brightness last (a lamp ignores a
    /// brightness sent before the colour that follows it).
    static func commands(patch: [String: Any]) -> [[String: Any]] {
        var out: [[String: Any]] = []
        if let on = patch["on"] as? Bool { out.append(["cmd": "turn", "data": ["value": on ? 1 : 0]]) }
        if let k = patch["temp"] as? Double {
            out.append(["cmd": "colorwc", "data": ["color": ["r": 0, "g": 0, "b": 0], "colorTemInKelvin": Int(k.rounded())]])
        }
        if let hex = patch["color"] as? String, let (r, g, b) = ColorMath.rgb(hex) {
            func byte(_ v: Double) -> Int { Int((v * 255).rounded()) }
            out.append(["cmd": "colorwc", "data": ["color": ["r": byte(r), "g": byte(g), "b": byte(b)], "colorTemInKelvin": 0]])
        }
        if let b = patch["brightness"] as? Double {
            out.append(["cmd": "brightness", "data": ["value": max(1, min(100, Int((b * 100).rounded())))]])
        }
        return out
    }

    // MARK: - Answers

    private func receive(ip: String, message: [String: Any]) {
        guard let msg = message["msg"] as? [String: Any], let data = msg["data"] as? [String: Any] else { return }
        switch msg["cmd"] as? String {
        case "scan":
            guard let device = data["device"] as? String else { return }
            let lamp = Lamp(ip: data["ip"] as? String ?? ip, sku: data["sku"] as? String ?? "Govee")
            if lamps[device]?.ip != lamp.ip || lamps[device]?.sku != lamp.sku {
                lamps[device] = lamp
                save()
            }
        case "devStatus":
            statuses[ip] = (Date(), data)
        default:
            break
        }
    }

    private func save() {
        vault.write(lamps.isEmpty ? nil : try? JSONEncoder().encode(lamps))
    }
}

/// The one UDP socket the LAN API needs: bound to port 4002, where every lamp answers,
/// and used to send as well. Answers are read on a thread of their own.
final class GoveeSocket: @unchecked Sendable {
    var onMessage: (@Sendable (String, [String: Any]) -> Void)?
    private var fd: Int32 = -1
    private let lock = NSLock()

    func open() throws {
        lock.lock()
        defer { lock.unlock() }
        guard fd < 0 else { return }
        let s = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard s >= 0 else { throw ServiceFailure("Could not open a network socket for Govee") }
        var yes: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(s, SOL_SOCKET, SO_REUSEPORT, &yes, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(4002).bigEndian
        address.sin_addr.s_addr = INADDR_ANY
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else {
            close(s)
            throw ServiceFailure("Port 4002, where Govee lamps answer, is taken by another app")
        }
        fd = s
        let thread = Thread { [weak self] in self?.listen(s) }
        thread.name = "Govee LAN"
        thread.start()
    }

    func send(_ message: [String: Any], to host: String, port: UInt16) {
        guard fd >= 0, let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &address.sin_addr) == 1 else { return }
        _ = data.withUnsafeBytes { bytes in
            withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    sendto(fd, bytes.baseAddress, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
    }

    private func listen(_ s: Int32) {
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            var from = sockaddr_in()
            var length = socklen_t(MemoryLayout<sockaddr_in>.size)
            let count = withUnsafeMutablePointer(to: &from) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(s, &buffer, buffer.count, 0, $0, &length) }
            }
            if count < 0 { if errno == EINTR { continue } else { return } }
            var text = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            inet_ntop(AF_INET, &from.sin_addr, &text, socklen_t(INET_ADDRSTRLEN))
            let ip = String(cString: text)
            guard let json = try? JSONSerialization.jsonObject(with: Data(buffer[0..<count])) as? [String: Any] else { continue }
            onMessage?(ip, json)
        }
    }
}
