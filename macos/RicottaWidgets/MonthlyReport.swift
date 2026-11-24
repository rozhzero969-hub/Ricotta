import Foundation
import Darwin

// This file is shared with the app target. Only the aggregate report is shared with the read-only widget.
struct MonthlyReport: Codable, Equatable {
    static let kind = "RicottaMonthlyReport"

    let month: String
    let orders: Int
    let days: Int
    let elapsed: Int
    let lines: Int
    let grade: String
    let daily: [Int]
    let streak: Int

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Baghdad") ?? .gmt
        return calendar
    }

    static func monthKey(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }

    var isCurrent: Bool {
        guard let interval = Self.calendar.dateInterval(of: .month, for: .now),
              let monthDays = Self.calendar.range(of: .day, in: .month, for: interval.start),
              month == Self.monthKey(.now), daily.count == monthDays.count,
              (1...monthDays.count).contains(elapsed), elapsed <= Self.calendar.component(.day, from: .now),
              (0...1_000_000).contains(orders), (0...1_000_000).contains(lines),
              (0...1_000_000).contains(streak), daily.allSatisfy({ (0...1_000_000).contains($0) }),
              daily.dropFirst(elapsed).allSatisfy({ $0 == 0 }),
              daily.reduce(0, +) == orders, daily.filter({ $0 > 0 }).count == days else { return false }
        let ratio = Double(days) / Double(elapsed)
        let expected = orders == 0 ? "·" : ratio >= 0.95 ? "A+" : ratio >= 0.85 ? "A" : ratio >= 0.7 ? "B" : ratio >= 0.5 ? "C" : "D"
        return grade == expected
    }

    private static var file: URL? {
        // The home directory returned by Foundation points into each target's sandbox.
        guard let home = getpwuid(getuid())?.pointee.pw_dir else { return nil }
        return URL(fileURLWithPath: String(cString: home), isDirectory: true)
            .appending(path: "Library/Application Support/Ricotta Widget Data/MonthlyReport.json")
    }

    static func read() -> MonthlyReport? {
        guard let file, let data = try? Data(contentsOf: file), data.count < 4096 else { return nil }
        return try? JSONDecoder().decode(MonthlyReport.self, from: data)
    }

    static func store(_ report: MonthlyReport?) throws -> Bool {
        guard let file else { return false }
        if let report {
            guard report.isCurrent, report != read() else { return false }
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(report).write(to: file, options: .atomic)
        } else {
            guard FileManager.default.fileExists(atPath: file.path) else { return false }
            try FileManager.default.removeItem(at: file)
        }
        return true
    }
}
