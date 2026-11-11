# Rime/librime 技术事实笔记（核实日期 2026-11-11）

## 1. librime 定位与嵌入
- 跨平台 C++17 输入法引擎核心库，模块化可扩展；官方前端为 ibus-rime / Squirrel / Weasel，社区有 ARIF、Hamster。4.7k star。https://github.com/rime/librime
- 稳定 C API：`src/rime_api.h`（`extern "C"`），入口 `rime_get_api()` 返回带 `data_size` 的版本化 `RimeApi` 结构体，用 `RIME_API_AVAILABLE` 宏做能力探测；模块用 `RIME_REGISTER_MODULE` 注册。https://github.com/rime/librime/blob/master/src/rime_api.h
- 许可证为 **BSD-3-Clause**（非 GPLv3），只要求保留版权与免责声明，无 copyleft 传染。https://github.com/rime/librime/blob/master/LICENSE
- GPLv3 是外壳自己的选择：Weasel、Squirrel、ibus-rime、Trime 均为 GPL-3.0。https://github.com/rime/weasel/blob/master/LICENSE.txt
- 构建依赖 boost / leveldb / marisa / opencc / yaml-cpp。https://github.com/rime/librime#build-dependencies

## 2. 各平台前端
- **Weasel**（Win）：C++，GPL-3.0，8.3k star，支持 Win 8.1–11，2026-10-31 有推送；当前 master 只有 `WeaselTSF`（COM in-proc 文本服务，实现 ITfTextInputProcessorEx、ITfKeyEventSink、ITfTextEditSink 等），配套 `WeaselServer.exe` + `WeaselIPC` 常驻进程；安装器 `RequestExecutionLevel admin` 并写 HKLM。https://github.com/rime/weasel
- **Squirrel**（macOS）：Swift，GPL-3.0，6.5k star，要求 macOS 13+；`sources/Main.swift` 中 `IMKServer` + `NSApplication`，桥接头引入 `rime_api_stdbool.h`；安装到 `/Library/Input Methods`，pkg 用 Developer ID 签名并 `notarytool` 公证；entitlements 关闭 app-sandbox、开 disable-library-validation。https://github.com/rime/squirrel
- **fcitx5-rime**：C++，pkg-config `rime>=1.9.0` 动态链接。https://github.com/fcitx/fcitx5-rime/blob/master/CMakeLists.txt
- **ibus-rime**：C，GPL-3.0，904 star。https://github.com/rime/ibus-rime
- **Trime**（Android）：Kotlin + JNI，GPL-3.0，4.8k star。https://github.com/osfans/trime
- **Hamster / 仓输入法**（iOS）：Swift，MIT，1.6k star，App Store id6446617683。https://github.com/imfuxiao/Hamster

## 3. 可视化配置项目
- **plum（东风破）**：bash CLI 配置管理器，LGPL-3.0，2.0k star，只做方案安装/更新，无 GUI。https://github.com/rime/plum
- **WeaselDeployer**：Windows GUI（Win32 对话框：字体/配色/方案选单/词典管理），经 librime `levers` 模块 `load_settings`/`save_settings` 读写 `default.custom.yaml`、`weasel.custom.yaml`。https://github.com/rime/weasel/blob/master/WeaselDeployer/Configurator.cpp
- **Squirrel**：无完整设置界面，仅菜单「部署/同步/用户设定」，仍需手改 YAML。
- **RimeVision / WeaselVision**：Rust + Tauri，MIT，28 star，2026-06 建库，覆盖方案/主题/标点/词典/同步；未签名（需 `xattr` 去隔离）。https://github.com/franvz9/Rime_vision
- **雾凇拼音 rime-ice**：纯配置仓库（YAML + Lua），GPL-3.0，20.1k star，靠 `*.custom.yaml` 分发，不含 GUI。https://github.com/iDvel/rime-ice
- 成熟、长期维护的跨平台 schema.yaml 全量编辑器：未找到可靠来源。

## 4. 配置体系
- UTF-8 YAML；共享目录 vs 用户目录（`%APPDATA%\Rime`、`~/Library/Rime`、`~/.local/share/fcitx5/rime`）。https://github.com/rime/home/wiki/UserData
- 编译指令：`__include`、`__patch`、`__append`、`__merge`；路径 `key/sub`、`/+`、`/=`、`@last`；根节点自动插入 `__patch: <config>.custom:/patch?`。https://github.com/rime/home/wiki/Configuration
- 部署：`deployer_initialize()` + `deploy()`；产物在 `build/`：`<schema>.schema.yaml`、`.prism.bin`、`.table.bin`、`.reverse.bin`、`.correction.bin`。https://github.com/rime/home/wiki/RimeWithSchemata
- 用户词典为 `*.userdb`（LevelDB），同步经 `sync_user_data()` / `get_sync_dir()`，`installation.yaml` 的 `sync_dir`。https://github.com/rime/librime/blob/master/src/rime/lever/user_dict_manager.cc
- 插件：`plugins/` 目录按 `boost::dll` 动态加载，`RimeModule` 注册；librime-lua 可扩展 processor/segmentor/translator/filter。https://github.com/rime/librime/blob/master/plugins/plugins_module.cc ; https://github.com/hchunhui/librime-lua

## 5. 平台硬约束
- **TSF**：文本服务须是 COM in-proc server 并向 TSF 注册（`ITfInputProcessorProfiles::Register`、`AddLanguageProfile`、CategoryMgr），官方定位为 C/C++ COM 编程；建议二进制签名。https://learn.microsoft.com/en-us/windows/win32/tsf/text-service-registration
- **IMK**：`IMKServer` 在 main 中创建，每个输入会话一个 `IMKInputController`；bundle 需 `InputMethodConnectionName`、`InputMethodServerControllerClass`、`ComponentInputModeDict`、`TISInputSourceID` 等键。https://developer.apple.com/documentation/inputmethodkit
- **公证**：10.15 起 Developer ID 分发必须公证。https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- **权限**：Squirrel 装 `/Library/Input Methods`（pkg，需管理员）；Weasel 安装器需管理员。

## 6. Rust/Tauri 做 macOS IME
- IMK 是 Objective-C 框架，但有官方风格绑定 `objc2-input-method-kit`，可从 Rust 调用。https://docs.rs/objc2-input-method-kit/
- 结构约束：IME 必须是独立 app bundle，在 main 里起 `IMKServer` 并跑主 run loop（Squirrel 即此模型），Tauri 窗口进程不能充当该进程。
- Tauri 适合做配套配置 GUI（RimeVision 即此形态），现有 Tauri 实现的 macOS IME 外壳：未找到可靠来源。
- Windows 侧 Rust 可行：windows-rs `#[implement]` 可写 COM 接口，编译为 in-proc DLL 注册为 text service。https://docs.rs/windows-implement/latest/windows_implement/attr.implement.html
