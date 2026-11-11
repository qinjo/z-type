# ADR-0002 外壳 fork Squirrel 与 Weasel，项目整体 GPL-3.0

- 状态：已接受（2026-11-11）

## 背景
IMK（macOS）与 TSF（Windows）的输入法外壳充满边界情况：焦点、组合、候选窗定位、会话生命周期。两个上游都已成熟且持续维护（Squirrel 6.5k star / Swift / macOS 13+；Weasel 8.3k star / C++ / Win8.1–11）。

## 决策
- `platform/macos` = rime/squirrel 的 fork；`platform/windows` = rime/weasel 的 fork。
- 整个项目以 **GPL-3.0** 发布（与两端上游一致）。

## 备选与代价
- 自写外壳：许可证可自由（可闭源），但 TSF 的 COM 注册、组合管理、候选窗渲染足以消耗数周，且是"能打字但偶尔丢焦点"这类最难排查的问题。
- 混合 fork：结果相同（仍 GPL-3.0），无收益。

## 后果
- 上游 GPL-3.0 → 本项目必须 GPL-3.0；自用与开源场景零成本。
- 需要一套子树同步与补丁记录流程（见 ADR-0009）。
