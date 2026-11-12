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

## M4：模糊音为什么要"整段重建 algebra"

- 编译产物 `build/<schema>.schema.yaml` 里的 `speller/algebra` 是**展开后**的规则列表，
  这是唯一可靠的基线（原始 schema 里可能有 `__include`，直接读会读不全）。本机
  `rime_mint` 编译后 53 条。
- 应用模糊音 = 从编译产物取基线 → 剥离所有已知模糊音规则 → 按当前勾选重建 →
  整段写进 `<schema>.custom.yaml` 的 `speller/algebra`。
  好处：反复保存不会膨胀（已用契约测试证明幂等）；代价：**方案升级后自定义 algebra 会锁定在旧基线**。
- 因此 UI 必须写明"整段替换"的语义，并在 `source !== build` 时警告"尚未部署，基线可能不完整"。
- 简繁开关（本机叫 `transcription`）与双拼键位都强耦合方案内容，V1 只读展示，
  不做生成式编辑——画错键位比不画更危险。

## M5：诊断与词典盘点

- 体检 10 项：用户目录、installation.yaml、schema_list、方案文件完整性、custom YAML 语法、
  build 产物、**配置与产物新鲜度**、托管键漂移、部署锁残留、共享目录。
  每项都附"下一步动作"，并区分 fail（致命）与 warn（提醒）。
- 新鲜度比较用文件 mtime：源配置比 build 新 → 提醒"改动可能尚未生效"。本机实测直接命中
  （build 停留在 2024-07，配置文件更新），证明这个检查有真实价值。
- 词典 V1 只盘点：`*.dict.yaml`（user/shared）、`*.userdb`（LevelDB 目录大小递归统计）、
  `sync_dir`、build 产物数。**删词/词频/导入导出必须等 librime user_dict FFI**，不猜格式。
- 快照恢复前会再自动备份一次当前状态，避免"恢复"本身变成不可逆操作。
- 部署日志落盘 `.qieyun/last-deploy.log`，诊断页可直接读。

## M5 收尾：原始编辑与部署错误解析

- 高级页的原始写入走 `Workspace::write_raw`：只允许用户目录根层 `.yaml/.yml/.txt`，
  `.dict.yaml` 与任何带路径分隔符的名字一律拒绝；写前先做 YAML 解析校验（坏的不落盘），
  再自动快照后原子写入。**原始编辑不更新托管键清单**——这是故意的：
  下一次结构化写入会因此触发漂移检测，从而不会悄悄覆盖手改内容。
- 部署日志解析基于实测格式：
  `E20261112 09:57:21.608622 0x7ff8490d1bc0 deployment_tasks.cc:212] missing input schema: ghost`
  → 级别 / 源位置 / 消息 / 命中文件 / 下一步动作（hint）。未知错误仍然原样保留，不丢信息。
- 危险操作（重置托管键、清部署锁）都实现为幂等，并在 UI 里写明可逆性。

## FFI 探针（2026-11-12）：进程内引擎已跑通

结论：**C shim + 窄 ABI** 可行，且比 bindgen/手抄 `RimeApi` 更稳。

- 用 `crates/qieyun-ffi`：`src/shim.c` 直接 `#include <rime_api.h>`，对 Rust 只暴露
  `qz_deploy / qz_create / qz_session_new / qz_process_key / qz_context / qz_select` 等十来个函数。
  升级 librime 只需重编 shim，不用重抄几十个函数指针。
- 构建：`build.rs` 调 `clang` 编 C、`ar` 打静态库，再链接 `librime` dylib 并写入 rpath；
  找不到 librime 时编译 `src/shim_stub.c`，crate 仍可构建（CI/纯前端开发），`linked()` 返回 false。
- 实测（librime 1.17.0，api.data_size=788）：进程内 `deploy()` 返回 1；会话输入 `nihao`
  得到候选「你好」；选中后 `get_commit` 返回「你好」。**无需任何子进程**。
- 两个真 bug 由探针抓出：
  1. **librime 全局状态不是线程安全的**——两个测试并行 `setup/deploy` 直接 SIGSEGV。
     产品侧必须"单例引擎 + 串行化"（部署锁已有）；测试里用 `Mutex` 串行。
  2. C shim 的 `qz_select` 在 `free_commit` **之后**才读 `c.text`，被 free 置空 →
     上屏永远返回空。改为先取 `has_text` 再释放。
- 词典 fixture 踩坑：Rime `*.dict.yaml` 列顺序是 `文字 <tab> 编码 <tab> 权重`（不是编码在前）。

## FFI 接入 Tauri（2026-11-12）

- `apps/desktop/src-tauri/src/engine.rs`：全局 `OnceLock<Mutex<Inner>>` 持有引擎。
  所有 librime 调用串行；**deploy 前必须先销毁引擎**（`qz_deploy` 内部会 setup+finalize，
  与存活引擎互相破坏）。目录变化时引擎自动重建，避免拿旧方案瞎跑。
- `unsafe impl Send for Inner` 是必要的（Tauri 要求 `Mutex<T>: TrySend`），
  理由写在代码里：指针从不逃出锁，串行正是 librime 要求的使用方式。
- **rpath 必须由最终二进制的 build script 加**：`qieyun-ffi` 的
  `cargo:rustc-link-arg` 只作用于它自己的测试二进制，不跨 crate 传播。
  `src-tauri/build.rs` 同时加：
  - 开发期：`.deps/librime-prebuilt/dist/lib` 绝对路径；
  - 打包后：`@executable_path/../Frameworks`。
  漏掉这步的症状是启动即 `dyld: Library not loaded: @rpath/librime.1.dylib`。
- 新命令：`engine_status` / `preview_typing` / `preview_commit` /
  `deploy_in_process` / `shutdown_engine`。未链接 librime 时 `deploy_in_process`
  自动退回子进程部署，行为不退化。
- **契约（写进测试）**：`ascii_mode` 下 librime 对字母键返回"不消费"（process_key=false），
  由宿主直接打字。所以"预览"里 accepted_keys 可能小于按键数——这不是 bug。
