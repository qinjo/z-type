# platform/windows —— fork 的 Weasel（尚未接入）

## 接入

```bash
git subtree add --prefix=platform/windows https://github.com/rime/weasel.git \
  <pin 到某个 tag/commit> --squash
```

## 我们计划的最小改动面

1. 品牌、产品名、图标、安装目录约定。
2. NSIS 安装器：同装 WeaselTSF DLL + WeaselServer + 本项目的 GUI App。
3. 部署入口：沿用 `WeaselDeployer.exe /deploy`（见 ADR-0008）。
4. 如需：在 `WeaselIPC` 增加 `DEPLOY` 命令（仅当官方入口不够快时；会引入版本耦合）。

## 注意

- Weasel 链接的是静态 `rime.lib`，构建依赖 Visual Studio 与 boost；CI 需要 Windows runner。
- `WeaselServer.exe` 没有 `/deploy` 参数，别指望用它触发部署。
