# ADR-0003 配置 GUI 用 Tauri 2 + React + TypeScript，Rust 承载领域逻辑

- 状态：已接受（2026-11-11）

## 背景
核心能力是"表单密集 + 实时预览 + 文件读写 + 内嵌 librime"。需要跨 macOS/Windows 单代码库、体积可控、能调用 C++ 库。

## 决策
- 壳：Tauri 2（Rust 后端，系统 WebView）。
- 前端：React 19 + TypeScript + Vite + Tailwind + 手写基础组件；状态用 Zustand。
- 领域逻辑全部在 `crates/qieyun-kit`（纯 Rust、可单测），`src-tauri` 只做命令层与平台集成。

## 备选与代价
- Electron：体积大、内存高、打包签名链路更重。
- 原生双栈（Swift + C#/C++）：两套 UI 代码，迭代速度减半。
- 参考：Rime_vision（Rust+Tauri，MIT，28 star，2026 新建）证明形态可行，但架构不足以作为底座。

## 后果
- WebView 差异（WKWebView / WebView2）需在两端回归。
- 纯 Rust 核心让 golden test 与契约测试成为可能。
