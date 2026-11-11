//! 路径解析与文件安全边界：GUI 的读操作必须落在用户 Rime 目录内。
//! 写操作的边界在 `qieyun-kit::Workspace`（只允许 `*.custom.yaml`）。

use std::path::{Path, PathBuf};

/// 运行期上下文。
#[derive(Debug, Clone)]
pub struct Ctx {
    pub user_dir: PathBuf,
}

impl Ctx {
    /// 用户目录优先级：`QIEYUN_RIME_USER_DIR` 环境变量 > 平台默认探测。
    /// 环境变量同时是测试与多 profile 的入口。
    pub fn resolve() -> Self {
        let user_dir = std::env::var_os("QIEYUN_RIME_USER_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(qieyun_kit::env::default_user_dir);
        Ctx { user_dir }
    }

    /// 校验任意路径位于用户目录内（用于读文件）。
    pub fn within_user_dir(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical_user = self
            .user_dir
            .canonicalize()
            .map_err(|e| format!("用户目录不可用：{}（{e}）", self.user_dir.display()))?;
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.user_dir.join(path)
        };
        // 目标可能还不存在：对父目录做 canonicalize，再拼回文件名。
        let (parent, name) = match (absolute.parent(), absolute.file_name()) {
            (Some(p), Some(n)) => (p.to_path_buf(), n.to_owned()),
            _ => return Err(format!("非法路径：{}", absolute.display())),
        };
        let canonical_parent = parent
            .canonicalize()
            .map_err(|e| format!("路径不存在：{}（{e}）", parent.display()))?;
        let checked = canonical_parent.join(name);
        if !checked.starts_with(&canonical_user) {
            return Err(format!("拒绝访问用户目录之外的路径：{}", checked.display()));
        }
        Ok(checked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(tag: &str) -> Ctx {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-paths-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Ctx { user_dir: dir }
    }

    #[test]
    fn rejects_paths_outside_user_dir() {
        let c = ctx("within");
        assert!(c.within_user_dir(Path::new("/etc/hosts")).is_err());
        assert!(c.within_user_dir(Path::new("../x")).is_err());
        std::fs::write(c.user_dir.join("a.custom.yaml"), "x").unwrap();
        assert!(c.within_user_dir(Path::new("a.custom.yaml")).is_ok());
    }
}
