import CloudKit
import Foundation
import Security

let defaultContainerIdentifier = "iCloud.com.magenta9.kanban"
let defaultZoneName = "KanbanZone"

struct HelperRequest: Decodable {
    let id: String
    let command: String
    let payload: HelperPayload?
}

struct HelperPayload: Decodable {
    let containerIdentifier: String?
    let zoneName: String?
    let changes: [SyncChange]?
}

struct SyncChange: Decodable {
    let outboxId: String
    let entityType: String
    let entityId: String
    let operation: String
    let fields: [String: JSONValue]?
}

enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

struct HelperResponse<Result: Encodable>: Encodable {
    let id: String
    let ok: Bool
    let result: Result?
    let error: String?
}

struct AccountStatusResult: Encodable {
    let accountStatus: String
}

struct EnsureZoneResult: Encodable {
    let accountStatus: String
    let zoneReady: Bool
    let zoneName: String
}

struct SyncNowResult: Encodable {
    let accountStatus: String
    let zoneReady: Bool
    let zoneName: String
    let pushedChangeCount: Int
    let pulledChangeCount: Int
    let acknowledgedOutboxIds: [String]
}

enum HelperError: Error {
    case unknownCommand(String)
    case signedOut(String)
    case missingCloudKitEntitlement
}

func hasCloudKitEntitlement() -> Bool {
    guard let task = SecTaskCreateFromSelf(nil),
          let value = SecTaskCopyValueForEntitlement(task, "com.apple.developer.icloud-services" as CFString, nil),
          let services = value as? [String] else {
        return false
    }
    return services.contains("CloudKit")
}

func container(for payload: HelperPayload?) -> CKContainer {
    let identifier = payload?.containerIdentifier ?? ProcessInfo.processInfo.environment["KANBAN_CLOUDKIT_CONTAINER"] ?? defaultContainerIdentifier
    return CKContainer(identifier: identifier)
}

func zoneId(for payload: HelperPayload?) -> CKRecordZone.ID {
    CKRecordZone.ID(zoneName: payload?.zoneName ?? defaultZoneName, ownerName: CKCurrentUserDefaultName)
}

func accountStatus(for container: CKContainer) async throws -> CKAccountStatus {
    try await withCheckedThrowingContinuation { continuation in
        container.accountStatus { status, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            continuation.resume(returning: status)
        }
    }
}

func ensureZone(for container: CKContainer, zoneId: CKRecordZone.ID) async throws {
    let database = container.privateCloudDatabase
    do {
        _ = try await database.recordZone(for: zoneId)
    } catch let error as CKError where error.code == .zoneNotFound {
        _ = try await database.save(CKRecordZone(zoneID: zoneId))
    }
}

func apply(_ change: SyncChange, database: CKDatabase, zoneId: CKRecordZone.ID) async throws {
    let recordId = CKRecord.ID(recordName: recordName(for: change), zoneID: zoneId)
    switch change.operation {
    case "save":
        let record: CKRecord
        do {
            record = try await database.record(for: recordId)
        } catch let error as CKError where error.code == .unknownItem {
            record = CKRecord(recordType: "KanbanEntity", recordID: recordId)
        }
        record["entityType"] = change.entityType as CKRecordValue
        record["entityId"] = change.entityId as CKRecordValue
        record["payloadJson"] = try payloadJson(for: change.fields) as CKRecordValue
        record["updatedAtMillis"] = NSNumber(value: Int64(Date().timeIntervalSince1970 * 1000))
        _ = try await database.save(record)
    case "delete":
        do {
            _ = try await database.deleteRecord(withID: recordId)
        } catch let error as CKError where error.code == .unknownItem {
            return
        }
    default:
        throw HelperError.unknownCommand("sync operation \(change.operation)")
    }
}

func payloadJson(for fields: [String: JSONValue]?) throws -> String {
    let data = try JSONEncoder().encode(fields ?? [:])
    return String(data: data, encoding: .utf8) ?? "{}"
}

func recordName(for change: SyncChange) -> String {
    let raw = "\(change.entityType):\(change.entityId)"
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    return raw.unicodeScalars.map { allowed.contains($0) ? String($0) : "_" }.joined()
}

func statusName(_ status: CKAccountStatus) -> String {
    switch status {
    case .available:
        return "signedIn"
    case .noAccount:
        return "signedOut"
    case .restricted:
        return "unavailable"
    case .couldNotDetermine:
        return "unknown"
    case .temporarilyUnavailable:
        return "unavailable"
    @unknown default:
        return "unknown"
    }
}

func requireSignedIn(_ status: CKAccountStatus) throws {
    guard status == .available else {
        throw HelperError.signedOut(statusName(status))
    }
}

func handle(_ request: HelperRequest) async throws -> any Encodable {
    guard hasCloudKitEntitlement() else {
        if request.command == "accountStatus" {
            return AccountStatusResult(accountStatus: "unavailable")
        }
        throw HelperError.missingCloudKitEntitlement
    }

    let cloudContainer = container(for: request.payload)
    let status = try await accountStatus(for: cloudContainer)
    let statusValue = statusName(status)

    switch request.command {
    case "accountStatus":
        return AccountStatusResult(accountStatus: statusValue)
    case "ensureZone":
        try requireSignedIn(status)
        let id = zoneId(for: request.payload)
        try await ensureZone(for: cloudContainer, zoneId: id)
        return EnsureZoneResult(accountStatus: statusValue, zoneReady: true, zoneName: id.zoneName)
    case "syncNow":
        try requireSignedIn(status)
        let id = zoneId(for: request.payload)
        try await ensureZone(for: cloudContainer, zoneId: id)
        let changes = request.payload?.changes ?? []
        let database = cloudContainer.privateCloudDatabase
        var acknowledgedOutboxIds: [String] = []
        for change in changes {
            try await apply(change, database: database, zoneId: id)
            acknowledgedOutboxIds.append(change.outboxId)
        }
        return SyncNowResult(
            accountStatus: statusValue,
            zoneReady: true,
            zoneName: id.zoneName,
            pushedChangeCount: acknowledgedOutboxIds.count,
            pulledChangeCount: 0,
            acknowledgedOutboxIds: acknowledgedOutboxIds
        )
    default:
        throw HelperError.unknownCommand(request.command)
    }
}

func encodeResult(_ value: any Encodable) throws -> Data {
    let encoder = JSONEncoder()
    return try value.encodeErased(using: encoder)
}

extension Encodable {
    func encodeErased(using encoder: JSONEncoder) throws -> Data {
        try encoder.encode(AnyEncodable(self))
    }
}

struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeValue = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}

func writeResponse<Result: Encodable>(_ response: HelperResponse<Result>) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(response), let line = String(data: data, encoding: .utf8) else {
        return
    }
    print(line)
    fflush(stdout)
}

func errorMessage(_ error: Error) -> String {
    switch error {
    case HelperError.unknownCommand(let command):
        return "Unknown helper command: \(command)"
    case HelperError.signedOut(let status):
        return "CloudKit account is not available: \(status)"
    case HelperError.missingCloudKitEntitlement:
        return "CloudKit entitlement is missing from the helper process."
    default:
        return error.localizedDescription
    }
}

@main
struct KanbanCloudKitHelper {
    static func main() async {
        let decoder = JSONDecoder()

        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8) else {
                continue
            }

            do {
                let request = try decoder.decode(HelperRequest.self, from: data)
                do {
                    let result = try await handle(request)
                    let response = HelperResponse(id: request.id, ok: true, result: AnyEncodable(result), error: nil)
                    writeResponse(response)
                } catch {
                    let response = HelperResponse<AnyEncodable>(id: request.id, ok: false, result: nil, error: errorMessage(error))
                    writeResponse(response)
                }
            } catch {
                let response = HelperResponse<AnyEncodable>(id: "unknown", ok: false, result: nil, error: errorMessage(error))
                writeResponse(response)
            }
        }
    }
}