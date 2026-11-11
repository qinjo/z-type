# ADR-0004 GUI 只写 `*.custom.yaml` 的 patch 层

- 状态：已接受（2026-11-11）

## 决策
GUI 的写入面严格限定为 `default.custom.yaml`、`squirrel.custom.yaml`、`weasel.custom.yaml`、`<schema>.custom.yaml`。绝不修改 `.schema.yaml`、`.dict.yaml`、`build/`、`*.userdb`。

## 理由
- 这是 Rime 的设计意图：`custom` 文件天然是覆盖层。
- 用户升级共享方案（如 rime-ice）时不会产生冲突。
- 用户手改 YAML 永远仍然有效，GUI 只是"另一个写 patch 的工具"。

## 备选与代价
- 全量接管所有 YAML：可做更强的校验，但会在方案升级时炸成一片，且彻底破坏手改共存。
- 双模式：复杂度翻倍，v1 不做。

## 后果
- 必须实现托管键清单 + 漂移检测（ADR-0005），否则会覆盖用户手写内容。
