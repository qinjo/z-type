import {
  THEME_COLOR_SLOTS,
  type PreviewCandidate,
  type PreviewTypingResult,
  type ThemePreset,
} from "@/lib/ipc";
import { alphaOf, cssColor, normalizeHex } from "@/lib/theme";

interface CandidatePreviewProps {
  theme: ThemePreset;
  /**
   * 真实引擎候选（`preview_typing()` 的返回值）。缺省或候选为空时退回静态示例候选，
   * 保证 stub 构建 / 尚未部署时预览不会空白。
   */
  preview?: PreviewTypingResult | null;
  /** 静态示例候选（回退用），默认与旧版一致。 */
  fallbackCandidates?: string[];
}

const STATIC_CANDIDATES = ["你好", "拟好", "你", "尼", "泥"];

/**
 * 候选窗实时预览：用当前编辑值直接渲染一个假的 Squirrel/Weasel 候选窗，
 * 让字号、圆角、边框、横竖排、配色改一个值立刻可见。
 *
 * 传入 `preview` 时候选文字来自真实引擎，但**样式始终取当前编辑中的主题值**——
 * 「改颜色立刻看到效果」的产品价值不变，同时也看得到真实候选内容。
 */
export function CandidatePreview({
  theme,
  preview = null,
  fallbackCandidates = STATIC_CANDIDATES,
}: CandidatePreviewProps) {
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

  // 真实候选优先；为空（未部署 / 方案未编译 / stub）时回退静态示例，避免预览开天窗。
  const liveCandidates = preview?.candidates ?? [];
  const candidates: PreviewCandidate[] =
    liveCandidates.length > 0
      ? liveCandidates
      : fallbackCandidates.map((text) => ({ text, comment: "" }));
  const preedit = preview?.preedit ?? "";
  const schema = preview?.schema ?? null;

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
          {/* 输入码：真实引擎的 preedit 整段作为高亮输入串；没有引擎时保持静态的 ni|hao 演示 */}
          <div
            className="flex items-baseline gap-1"
            style={{ marginBottom: Math.max(2, layout.spacing), color: textColor }}
          >
            {preedit ? (
              <span
                style={{
                  backgroundColor: hilitedBack,
                  color: hilitedText,
                  borderRadius: Math.max(2, Math.round(layout.corner_radius / 2)),
                  padding: "0 2px",
                }}
              >
                {preedit}
              </span>
            ) : (
              <>
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
              </>
            )}
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
            {candidates.map((candidate, index) => {
              const hilited = index === 0;
              return (
                <span
                  key={`${index}-${candidate.text}`}
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
                  <span>{candidate.text}</span>
                  {candidate.comment && (
                    <span
                      style={{
                        color: hilited ? hilitedCandidateText : commentColor,
                        fontSize: font.label_point,
                        lineHeight: 1.2,
                      }}
                    >
                      {candidate.comment}
                    </span>
                  )}
                </span>
              );
            })}
          </div>

          {/* 状态栏：有真实方案时显示引擎当前方案，否则保持静态示例 */}
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
            <span className="truncate">{schema ? `方案 · ${schema}` : "雾凇拼音 · 小鹤双拼"}</span>
            <span className="shrink-0">
              {candidates.length > 1 ? `1/${candidates.length}` : "1/1"} ›
            </span>
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
