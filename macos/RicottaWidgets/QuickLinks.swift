import SwiftUI
import WidgetKit

struct LinkEntry: TimelineEntry { let date = Date() }
struct Provider: TimelineProvider {
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
            Label("Ricotta", systemImage: "fork.knife").font(.headline).widgetAccentable()
            if family == .systemSmall {
                Spacer(minLength: 0)
                Text("Open your orders").font(.subheadline).foregroundStyle(.secondary)
                Image(systemName: "arrow.up.right").accessibilityHidden(true)
            } else {
                HStack(spacing: 9) {
                    shortcut("Orders", "bag", "order")
                    shortcut("Recipes", "book", "recipes")
                    shortcut("Rico", "sparkles", "assistant")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "ricotta-mac://order"))
        .containerBackground(for: .widget) { Color(.sRGB, red: 0.08, green: 0.26, blue: 0.20) }
        .foregroundStyle(.white)
    }
    private func shortcut(_ name: LocalizedStringKey, _ icon: String, _ route: String) -> some View {
        Link(destination: URL(string: "ricotta-mac://" + route)!) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                Text(name).font(.caption.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(.white.opacity(0.13), in: RoundedRectangle(cornerRadius: 9))
        }.buttonStyle(.plain)
    }
}

@main
struct RicottaQuickLinks: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RicottaQuickLinks", provider: Provider()) { _ in LinksView() }
            .configurationDisplayName("Ricotta shortcuts")
            .description("Open orders, recipes, or Rico from your desktop.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
