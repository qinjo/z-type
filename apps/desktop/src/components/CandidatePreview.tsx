import { THEME_COLOR_SLOTS, type ThemePreset } from "@/lib/ipc";
import { alphaOf, cssColor, normalizeHex } from "@/lib/theme";

interface CandidatePreviewProps {
  theme: ThemePreset;
}

const CANDIDATES = ["你好", "拟好", "你", "尼", "泥"];

/**
 * 候选窗实时预览：用当前编辑值直接渲染一个假的 Squirrel/Weasel 候选窗，
 * 让字号、圆角、边框、横竖排、配色改一个值立刻可见。
 */
export function CandidatePreview({ theme }: CandidatePreviewProps) {
  const { font, layout } = theme;
  const colors = theme.colors;

  const back = cssColor(colors.back ?? "", "#1e1e1e");
  const borderColor = cssColor(colors.border ?? "", "transparent");
  const textColor = cssColor(colors.text ?? "", "#e6e6e6");
  const candidateColor = cssColor(colors.candidate_text ?? "", textColor);
  const commentColor = cssColor(colors.comment_text ?? "", "#8a8a8a");
  const hilitedBack = cssColor(colors.hilited_back ?? "", "transparent");
  const hilitedText = cssColor(colors.hilited_text ?? "", textColor);
  const hilitedCandidateBack = cssColor(colors.hilited_candidate_back ?? "", "transparent");
  const hilitedCandidateText = cssColor(colors.hilited_candidate_text ?? "", "#ffffff");
  const hilitedCandidateBorder = cssColor(colors.hilited_candidate_border ?? "", "transparent");

  const vertical = layout.orientation === "vertical";
  const hasBorder = layout.border_width > 0 && alphaOf(borderColor) > 0;
  const highlightBorder =
    alphaOf(hilitedCandidateBorder) > 0
      ? `1px solid ${hilitedCandidateBorder}`
      : "1px solid transparent";

  const missing = THEME_COLOR_SLOTS.filter((slot) => !normalizeHex(colors[slot] ?? ""));

  return (
    <div className="space-y-2">
      <div className="flex min-h-[172px] items-start justify-center rounded-md border border-line-soft bg-[#0b0e13] p-5">
        <div
          className="inline-block max-w-full"
          style={{
            backgroundColor: back,
            border: hasBorder ? `${layout.border_width}px solid ${borderColor}` : undefined,
            borderRadius: layout.corner_radius,
            padding: layout.margin,
            boxShadow:
              layout.shadow > 0
                ? `0 ${Math.max(1, Math.round(layout.shadow / 2))}px ${layout.shadow}px rgba(0, 0, 0, 0.5)`
                : "none",
            color: textColor,
            fontFamily: `${font.face || "PingFang SC"}, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`,
            fontSize: font.point,
            lineHeight: 1.35,
            opacity: back === "transparent" ? 1 : undefined,
          }}
        >
          {/* 输入码：后半段为高亮输入区 */}
          <div
            className="flex items-baseline gap-1"
            style={{ marginBottom: Math.max(2, layout.spacing), color: textColor }}
          >
            <span>ni</span>
            <span
              style={{
                backgroundColor: hilitedBack,
                color: hilitedText,
                borderRadius: Math.max(2, Math.round(layout.corner_radius / 2)),
                padding: "0 2px",
              }}
            >
              hao
            </span>
          </div>

          {/* 候选列表 */}
          <div
            className="flex"
            style={{
              gap: vertical ? Math.max(2, layout.spacing + font.line_spacing) : layout.spacing,
              flexDirection: vertical ? "column" : "row",
              flexWrap: vertical ? "nowrap" : "wrap",
              alignItems: vertical ? "flex-start" : "baseline",
            }}
          >
            {CANDIDATES.map((candidate, index) => {
              const hilited = index === 0;
              return (
                <span
                  key={candidate}
                  className="flex items-baseline gap-1 whitespace-nowrap"
                  style={
                    hilited
                      ? {
                          backgroundColor: hilitedCandidateBack,
                          color: hilitedCandidateText,
                          border: highlightBorder,
                          borderRadius: Math.max(2, Math.round(layout.corner_radius / 2)),
                          padding: "1px 5px",
                        }
                      : { color: candidateColor, padding: "1px 0" }
                  }
                >
                  <span
                    style={{
                      color: hilited ? hilitedCandidateText : commentColor,
                      fontSize: font.label_point,
                      lineHeight: 1.2,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span>{candidate}</span>
                </span>
              );
            })}
          </div>

          {/* 状态栏 */}
          <div
            className="flex items-center justify-between gap-4"
            style={{
              marginTop: Math.max(2, layout.spacing),
              paddingTop: Math.max(2, layout.margin / 2),
              borderTop: hasBorder ? `1px solid ${borderColor}` : undefined,
              color: commentColor,
              fontSize: font.label_point,
              lineHeight: 1.2,
            }}
          >
            <span className="truncate">雾凇拼音 · 小鹤双拼</span>
            <span className="shrink-0">1/3 ›</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-faint">
        <span>
          {vertical ? "竖排" : "横排"} · {font.point}pt / 标签 {font.label_point}pt · 行距{" "}
          {font.line_spacing}
        </span>
        <span className="text-line">·</span>
        <span>
          圆角 {layout.corner_radius} · 边框 {layout.border_width} · 内边距 {layout.margin} ·
          间距 {layout.spacing} · 阴影 {layout.shadow}
        </span>
        {missing.length > 0 && (
          <span className="text-danger">
            {missing.length} 个颜色槽待修正：{missing.join("、")}
          </span>
        )}
      </div>
    </div>
  );
}
