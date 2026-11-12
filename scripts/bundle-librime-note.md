# macOS 打包与 librime 动态库

Tauri 2 的 `bundle.macOS.framesworks` 只支持 `.framework`，所以 librime 用
`bundle.macOS.files` 放置：

```json
"macOS": {
  "files": {
    "Frameworks/librime.1.dylib": "../../../../.deps/librime-prebuilt/dist/lib/librime.1.17.0.dylib"
  }
}
```

- 键是相对 `.app/Contents` 的目标路径，值是源文件（相对 `tauri.conf.json`）。
- 目标文件名必须是 **`librime.1.dylib`**：二进制通过 `@rpath/librime.1.dylib` 查找，
  而实际文件是 `librime.1.17.0.dylib`（源码包里是符号链接，复制时必须改名为 soname）。
- rpath 由 `src-tauri/build.rs` 写死两条：`@executable_path/../Frameworks`（打包后）
  与开发期绝对路径。
- 升级 librime 时同步改这里的面板版本文件名，否则打包后仍加载旧库。
