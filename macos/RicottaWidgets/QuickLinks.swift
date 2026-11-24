import SwiftUI
import WidgetKit

private let mint = Color(red: 0.52, green: 0.93, blue: 0.70)
private let cream = Color(red: 0.98, green: 0.98, blue: 0.93)
private let ink = Color(red: 0.04, green: 0.19, blue: 0.14)
private let muted = Color(red: 0.74, green: 0.85, blue: 0.79)

private struct KitchenBackdrop: View {
    var body: some View {
        LinearGradient(colors: [Color(red: 0.12, green: 0.34, blue: 0.25), ink, .black],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

private struct Wordmark: View {
    var body: some View {
        (Text("ricotta").foregroundStyle(cream) + Text(".").foregroundStyle(mint))
            .font(.system(size: 23, weight: .heavy)).tracking(-1)
            .widgetAccentable().accessibilityLabel("Ricotta")
    }
}

private struct LinkEntry: TimelineEntry { let date = Date() }
private struct LinksProvider: TimelineProvider {
    func placeholder(in context: Context) -> LinkEntry { LinkEntry() }
    func getSnapshot(in context: Context, completion: @escaping (LinkEntry) -> Void) { completion(LinkEntry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<LinkEntry>) -> Void) {
        completion(Timeline(entries: [LinkEntry()], policy: .never))
    }
}

private struct LinksView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Wordmark()
                Spacer(minLength: 0)
                Image(systemName: "fork.knife").font(.caption.weight(.semibold))
                    .foregroundStyle(mint).accessibilityHidden(true)
            }
            Spacer(minLength: 0)
            if family == .systemSmall {
                Image(systemName: "bag").font(.title2.weight(.medium)).foregroundStyle(mint).accessibilityHidden(true)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("Orders").font(.headline)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).accessibilityHidden(true)
                }
            } else {
                HStack(spacing: 7) {
                    shortcut("Orders", "bag", "order")
                    shortcut("Recipes", "book.closed", "recipes")
                    shortcut("Rico", "sparkles", "assistant")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "ricotta-mac://order"))
        .containerBackground(for: .widget) { KitchenBackdrop() }
        .foregroundStyle(cream)
    }

    private func shortcut(_ name: LocalizedStringKey, _ icon: String, _ route: String) -> some View {
        Link(destination: URL(string: "ricotta-mac://" + route)!) {
            VStack(alignment: .leading, spacing: 7) {
                Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundStyle(mint).accessibilityHidden(true)
                Text(name).font(.caption.weight(.semibold))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(9)
            .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
        }.buttonStyle(.plain)
    }
}

private struct ReportEntry: TimelineEntry {
    let date: Date
    let report: MonthlyReport?
}

private struct ReportProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReportEntry { ReportEntry(date: .now, report: nil) }
    func getSnapshot(in context: Context, completion: @escaping (ReportEntry) -> Void) {
        if context.isPreview {
            let sample = [1, 2, 1, 2, 3, 1, 1, 1, 2, 3, 1, 1, 2, 2, 1, 2, 3, 1, 1, 2, 1, 3, 2, 1] + Array(repeating: 0, count: 6)
            completion(ReportEntry(date: .now, report: MonthlyReport(
                month: MonthlyReport.monthKey(.now), orders: sample.reduce(0, +),
                days: 24, elapsed: 24, lines: 426, grade: "A+", daily: sample, streak: 32)))
        } else { completion(current()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ReportEntry>) -> Void) {
        let entry = current()
        let rollover = MonthlyReport.calendar.dateInterval(of: .month, for: entry.date)?.end
        let future = rollover.map { [ReportEntry(date: $0, report: nil)] } ?? []
        completion(Timeline(entries: [entry] + future, policy: .never))
    }
    private func current() -> ReportEntry {
        let report = MonthlyReport.read()
        return ReportEntry(date: .now, report: report?.isCurrent == true ? report : nil)
    }
}

private struct MonthlyReportView: View {
    let entry: ReportEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Wordmark()
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(mint)
                    .accessibilityHidden(true)
            }
            if let report = entry.report {
                reportBody(report).privacySensitive()
            } else {
                Spacer()
                Image(systemName: "chart.bar.xaxis").font(.largeTitle).foregroundStyle(mint).accessibilityHidden(true)
                Text("Monthly report card").font(.title2.bold())
                Text("Open Ricotta to refresh your kitchen report.").font(.subheadline).foregroundStyle(muted)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .foregroundStyle(cream)
        .containerBackground(for: .widget) { KitchenBackdrop() }
        .widgetURL(URL(string: "ricotta-mac://report"))
    }

    private func reportBody(_ report: MonthlyReport) -> some View {
        Group {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.date.formatted(Date.FormatStyle(date: .omitted, time: .omitted, timeZone: MonthlyReport.calendar.timeZone).month(.wide))).font(.title.bold()).lineLimit(1)
                    Text("Monthly report card").font(.subheadline).foregroundStyle(muted)
                }
                Spacer(minLength: 0)
                Text(report.grade).font(.system(size: 27, weight: .black, design: .rounded)).foregroundStyle(ink)
                    .frame(width: 58, height: 52).background(mint, in: RoundedRectangle(cornerRadius: 15))
                    .accessibilityLabel("Grade \(report.grade)")
            }
            HStack(spacing: 5) {
                metric(report.orders, "Orders")
                metric(report.days, "Days")
                metric(report.lines, "Items")
                metric(report.streak, "Streak", symbol: "flame.fill")
            }
            Spacer(minLength: 0)
            Text("Orders each day").font(.caption.weight(.semibold)).foregroundStyle(muted)
            bars(report)
            HStack {
                Text("1")
                Spacer()
                Text(report.daily.count, format: .number)
            }.font(.caption2).foregroundStyle(muted).accessibilityHidden(true)
        }
    }

    private func metric(_ n: Int, _ title: LocalizedStringKey, symbol: String? = nil) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 3) {
                if let symbol { Image(systemName: symbol).font(.caption2).foregroundStyle(mint).accessibilityHidden(true) }
                Text(n, format: .number).font(.system(.headline, design: .rounded).weight(.bold))
                    .lineLimit(1).minimumScaleFactor(0.7).monospacedDigit()
            }
            Text(title).font(.caption2.weight(.medium)).foregroundStyle(muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(.white.opacity(0.11), in: RoundedRectangle(cornerRadius: 9))
        .accessibilityElement(children: .combine)
    }

    private func bars(_ report: MonthlyReport) -> some View {
        let height: CGFloat = 45
        let maxCount = max(1, report.daily.max() ?? 1)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(report.daily.indices, id: \.self) { day in
                let n = report.daily[day]
                RoundedRectangle(cornerRadius: 2)
                    .fill(n > 0 ? mint.opacity(day == report.elapsed - 1 ? 1 : 0.68) : cream.opacity(0.14))
                    .frame(maxWidth: .infinity)
                    .frame(height: n > 0 ? 5 + (height - 5) * CGFloat(n) / CGFloat(maxCount) : 2)
            }
        }.frame(height: height, alignment: .bottom)
            .accessibilityLabel("\(report.days) of \(report.elapsed) days had orders")
    }
}

struct RicottaQuickLinks: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RicottaQuickLinks", provider: LinksProvider()) { _ in LinksView() }
            .configurationDisplayName("Ricotta shortcuts")
            .description("Open orders, recipes, or Rico from your desktop.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct RicottaMonthlyReport: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: MonthlyReport.kind, provider: ReportProvider()) { MonthlyReportView(entry: $0) }
            .configurationDisplayName("Monthly report card")
            .description("See how your kitchen is doing this month.")
            .supportedFamilies([.systemLarge])
    }
}

@main
struct RicottaWidgets: WidgetBundle {
    var body: some Widget {
        RicottaQuickLinks()
        RicottaMonthlyReport()
    }
}
