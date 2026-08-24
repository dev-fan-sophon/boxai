use crate::AgentId;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct AgentInstall {
    pub agent: AgentId,
    pub root: PathBuf,
    pub detected: bool,
}
#[derive(Debug, Default, Clone)]
pub struct Discovery {
    pub overrides: BTreeMap<AgentId, PathBuf>,
}

/// Complete fixed roots for portable acceptance and embedded fixture layouts.
/// Unlike [`Discovery`], this type has no environment or home-directory fallback.
#[derive(Debug, Clone)]
pub struct FixedAgentRoots {
    roots: BTreeMap<AgentId, PathBuf>,
}

impl FixedAgentRoots {
    pub fn new(roots: [PathBuf; 6]) -> Self {
        Self {
            roots: AgentId::ALL.into_iter().zip(roots).collect(),
        }
    }

    pub fn discover(&self) -> Vec<AgentInstall> {
        AgentId::ALL
            .into_iter()
            .map(|agent| {
                let root = self
                    .roots
                    .get(&agent)
                    .expect("fixed roots contain every supported Agent")
                    .clone();
                let detected = is_plain_directory(&root);
                AgentInstall {
                    detected,
                    agent,
                    root,
                }
            })
            .collect()
    }

    pub fn root(&self, agent: AgentId) -> &Path {
        self.roots
            .get(&agent)
            .expect("fixed roots contain every supported Agent")
    }
}

impl Discovery {
    pub fn discover(&self, home: &Path) -> Vec<AgentInstall> {
        self.discover_with(home, |key| std::env::var_os(key).map(PathBuf::from))
    }

    /// Environment lookup is injectable so discovery can be tested without
    /// mutating process-global environment variables.
    pub fn discover_with(
        &self,
        home: &Path,
        env: impl Fn(&str) -> Option<PathBuf>,
    ) -> Vec<AgentInstall> {
        AgentId::ALL
            .into_iter()
            .map(|agent| {
                let root = self
                    .overrides
                    .get(&agent)
                    .cloned()
                    .or_else(|| env_path(agent, &env))
                    .unwrap_or_else(|| standard(agent, home));
                AgentInstall {
                    agent,
                    detected: is_plain_directory(&root),
                    root,
                }
            })
            .collect()
    }
}

fn is_plain_directory(root: &Path) -> bool {
    fs::symlink_metadata(root).is_ok_and(|metadata| metadata.is_dir() && !is_reparse(&metadata))
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
    }
    #[cfg(not(windows))]
    false
}

fn env_path(agent: AgentId, env: &impl Fn(&str) -> Option<PathBuf>) -> Option<PathBuf> {
    let keys: &[&str] = match agent {
        AgentId::Codex => &["CODEX_HOME"],
        AgentId::Grokbuild => &["GROK_HOME"],
        AgentId::Opencode => &["XDG_CONFIG_HOME"],
        // The client reads the WorkBuddy name first and keeps the CodeBuddy one
        // for its earlier brand.
        AgentId::Workbuddy => &["WORKBUDDY_CONFIG_DIR", "CODEBUDDY_CONFIG_DIR"],
        _ => &[],
    };
    keys.iter()
        .find_map(|key| env(key).filter(|value| !value.as_os_str().is_empty()))
        .map(|p| {
            if agent == AgentId::Opencode {
                p.join("opencode")
            } else {
                p
            }
        })
}
fn standard(agent: AgentId, home: &Path) -> PathBuf {
    match agent {
        AgentId::Claude => home.join(".claude"),
        AgentId::Codex => home.join(".codex"),
        AgentId::Gemini => home.join(".gemini"),
        AgentId::Grokbuild => home.join(".grok"),
        AgentId::Opencode => home.join(".config/opencode"),
        // The desktop app keeps its own root; the CLI it grew out of keeps
        // `.codebuddy`, which the app still reads. Prefer the current root and
        // fall back so a CLI-only install is still detected.
        AgentId::Workbuddy => {
            let workbuddy = home.join(".workbuddy");
            let codebuddy = home.join(".codebuddy");
            if !workbuddy.exists() && codebuddy.exists() {
                codebuddy
            } else {
                workbuddy
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_roots_have_no_environment_or_home_fallback() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let roots = AgentId::ALL.map(|agent| temporary.path().join(agent.as_str()));
        let discovery = FixedAgentRoots::new(roots.clone());
        let installs = discovery.discover();
        assert_eq!(installs.len(), AgentId::ALL.len());
        for (install, expected) in installs.iter().zip(roots) {
            assert_eq!(install.root, expected);
        }
    }

    #[cfg(unix)]
    #[test]
    fn normal_discovery_does_not_follow_a_linked_agent_root() {
        use std::os::unix::fs::symlink;

        let temporary = tempfile::tempdir().expect("temporary root");
        let target = temporary.path().join("actual-codex");
        fs::create_dir(&target).expect("actual root");
        let linked = temporary.path().join("linked-codex");
        symlink(&target, &linked).expect("linked root");
        let discovery = Discovery {
            overrides: BTreeMap::from([(AgentId::Codex, linked.clone())]),
        };

        let codex = discovery
            .discover_with(temporary.path(), |_| None)
            .into_iter()
            .find(|install| install.agent == AgentId::Codex)
            .expect("Codex discovery");
        assert_eq!(codex.root, linked);
        assert!(!codex.detected);
    }

    #[cfg(windows)]
    #[test]
    fn normal_discovery_does_not_follow_a_junction_agent_root() {
        use std::process::Command;

        let temporary = tempfile::tempdir().expect("temporary root");
        let target = temporary.path().join("actual-codex");
        fs::create_dir(&target).expect("actual root");
        let linked = temporary.path().join("linked-codex");
        let output = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&linked)
            .arg(&target)
            .output()
            .expect("create junction");
        assert!(output.status.success(), "mklink /J failed: {output:?}");
        let discovery = Discovery {
            overrides: BTreeMap::from([(AgentId::Codex, linked.clone())]),
        };

        let codex = discovery
            .discover_with(temporary.path(), |_| None)
            .into_iter()
            .find(|install| install.agent == AgentId::Codex)
            .expect("Codex discovery");
        assert_eq!(codex.root, linked);
        assert!(!codex.detected);
    }
}
