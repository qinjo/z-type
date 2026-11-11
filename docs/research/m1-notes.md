# M1 实施笔记（环境探测 / 部署 / 契约测试）

> 记录在真机上验证过的事实与坑，避免后来者重复踩。

## 本机环境（2026-11-11）

- macOS 15.4.1，用户目录 `~/Library/Rime`（183 MB，其中 `build/` 90 MB）
- `installation.yaml`：`distribution_name: 鼠鬚管`、`distribution_version: 0.18`、`rime_version: 1.11.2`
- **共享目录不存在**：本机是 plum（东风破）把方案直接装进用户目录的形态，
  所以 `default.yaml` 与全部 `*.schema.yaml` 都在用户目录里。
  → 结论：`schema_list` 的读取必须"共享目录优先、用户目录兜底"，否则真机上读不到方案。

## librime / rime_deployer

- `rime_deployer` 参数是**位置参数**：`--build [user_data_dir] [shared_data_dir] [staging_dir]`，
  见 `librime/tools/rime_deployer.cc`。误用 `--user-data-dir` 会直接 `invalid arguments.`
- `--compile <x.schema.yaml> [user] [shared] [staging]` 只编词典，不跑完整 workspace update。
- 构建依赖 cmake（`make deps` 用它编 glog/leveldb/marisa/opencc/yaml-cpp）。
  本机最初缺 cmake，脚本已加前置检查与安装提示。
- 官方 release 只提供 dylib + tools，不提供静态 `.a`；GUI 侧静态链接需自己 `BUILD_STATIC`。

## 契约测试怎么证明"patch 生效"

`squirrel.custom.yaml` 这类样式配置**不会**出现在 `build/` 产物里（它由外壳在运行时读取），
所以拿主题去断言部署结果行不通。可行的断言路径：

1. 用 `schema.custom.yaml` 写一个**方案级** patch（如 `menu/page_size: 9`）；
2. 部署；
3. 读 `build/<schema>.schema.yaml`（编译后的方案配置），断言其中 `page_size: 9`。

`crates/qieyun-kit/tests/deploy_contract.rs` 就是这个流程，用一份最小方案/词典 fixture，
不依赖任何用户配置，`QIEYUN_RIME_DEPLOYER=<path>` 时运行。

## 网络

本机 crates.io 与 npm 都不稳定（出现过 gio 下载超时、pnpm ECONNRESET）。
cargo 侧建议：`CARGO_NET_RETRY=10 CARGO_HTTP_TIMEOUT=180 CARGO_HTTP_MULTIPLEXING=false`。

## 预编译包（比源码构建快 100 倍）

官方 release 资源名带 commit 前缀，例如
`rime-33e7814-macOS-universal.tar.bz2`（4 MB），解包即得
`dist/bin/rime_deployer`、`dist/lib/librime.1.dylib`、`dist/include/rime_api.h`。

- `rime_deployer` 用 `@rpath/librime.1.dylib`，直接执行会 `dyld: Library not loaded`；
  运行时需要 `DYLD_LIBRARY_PATH=<dist>/lib`。
- `scripts/build-librime-macos.sh` 已改为默认下载预编译包，`--source` 才走 cmake 构建。
- 契约测试 `tests/deploy_contract.rs` 会自动把部署器同级的 `lib/` 加进 DYLD_LIBRARY_PATH。

已验证（2026-11-11）：`QIEYUN_RIME_DEPLOYER=$PWD/.deps/librime-prebuilt/dist/bin/rime_deployer`
下两份契约测试均通过——GUI 写法写出的 `menu/page_size: 9` 在
`build/qieyun_test.schema.yaml` 里生效。

## M1.5 / M2 进展（2026-11-11）

- 首启接管：`Workspace::takeover()` = 整包备份 + 建立空托管键清单，**不写任何配置**；
  `is_taken_over()` 以 `.qieyun/state.json` 是否存在为准。
- 主题应用：`Workspace::apply_theme(theme, platform)` 写到
  `squirrel.custom.yaml` / `weasel.custom.yaml`；颜色在 DTO 层统一用 `#RRGGBB(AA)`，
  编译时转 ABGR（`Rgba::to_abgr_literal()`）。
- 重要事实：**样式文件不会被 `rime_deployer` 编译进 `build/`**（它由外壳运行时读取），
  所以"应用主题"之后必须重载外壳；`apply_and_deploy` 先 deploy 再发
  `Squirrel --reload`（本机已确认 `/Library/Input Methods/Squirrel.app` 存在）。
- 部署锁：`.qieyun/deploy.lock`（PID + 时间戳，120 秒陈旧判定），避免 GUI 与手动部署撞车。
- Tauri 命令新增：`get_takeover_plan` / `accept_takeover` / `list_theme_presets` /
  `apply_theme` / `apply_and_deploy`。
- GUI 验证：进程与窗口存在（CGWindowList 报告 1180×781 位于 250,118），但本机
  屏幕捕获权限拿不到窗口像素（`screencapture -l` 报 could not create image from window），
  界面观感需人工确认。

## M3：方案/按键与部署的秒级陷阱

- `default.custom.yaml` 的 `schema_list` 决定**哪些方案会被编译**：契约测试
  `schema_list_controls_what_gets_compiled` 用两个最小方案验证了"未启用 → 不生成
  `build/<id>.schema.yaml`，启用后生成"。
- `key_binder/bindings` 是用户常自己写的地方。GUI 只按 `accept` 键接管自己那批
  （comma/period/bracketleft/bracketright/Page_Up/Page_Down/Control+Shift+space/Shift_L），
  其余行（emoji、简繁等）原样保留。
- 简繁开关在不同方案里叫法不同（本机 `transcription`，rime-ice 用别的名字），
  所以 v1 不做"简繁热键"，等到能按方案读取 `switches` 再做。
- **秒级 mtime 陷阱**：librime 的 `WorkspaceUpdate` 用秒级时间戳判断配置是否变化，
  同一秒内连续部署会被判定为无变化而跳过。产品侧在 `deploy()` 里做秒边界对齐
  （`.qieyun/last_deploy`），测试侧显式跨秒。
