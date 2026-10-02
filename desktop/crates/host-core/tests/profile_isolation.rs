use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};

struct Host {
    child: Child,
    output: BufReader<std::process::ChildStdout>,
}

impl Host {
    fn start(home: &Path, data: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_pi-desktop-host-core"))
            .env("HOME", home)
            .env("USERPROFILE", home)
            .env("PI_DESKTOP_DATA_DIR", data)
            // An inherited legacy override must not defeat the BoxAI profile.
            .env("PI_DESKTOP_AGENTS_DIR", home.join(".agents"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut host = Self { child, output };
        host.call("app.handshake", json!({"protocolVersion":11}));
        host
    }

    fn call(&mut self, method: &str, params: Value) -> Value {
        let value = self.response(method, params);
        assert!(value.get("error").is_none(), "{method}: {value}");
        value["result"].clone()
    }

    fn response(&mut self, method: &str, params: Value) -> Value {
        writeln!(
            self.child.stdin.as_mut().unwrap(),
            "{}",
            json!({
                "jsonrpc": "2.0", "id": 1, "method": method, "params": params
            })
        )
        .unwrap();
        loop {
            let mut line = String::new();
            assert!(
                self.output.read_line(&mut line).unwrap() > 0,
                "host exited during {method}"
            );
            let value: Value = serde_json::from_str(&line).unwrap();
            if value["id"] != 1 {
                continue;
            }
            return value;
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn global_capabilities_install_and_enumerate_only_the_selected_profile() {
    let home = tempfile::tempdir().unwrap();
    let profile = home.path().join("profile-a");
    let other = home.path().join("profile-b");
    let foreign_skill = home.path().join(".agents/skills/shared/SKILL.md");
    let foreign_server = home.path().join(".agents/servers/shared.json");
    let foreign_agent = home.path().join(".agents/subagents/shared.md");
    let skill = "---\nname: shared\ndescription: Foreign skill\n---\nForeign content\n";
    let server = json!({"id":"shared","label":"Foreign server","transport":"http","url":"https://foreign.example/mcp"}).to_string();
    for (path, text) in [
        (&foreign_skill, skill),
        (&foreign_server, server.as_str()),
        (&foreign_agent, skill),
    ] {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    let mut host = Host::start(home.path(), &profile);
    for (method, key) in [
        ("skills.list", "skills"),
        ("mcp.list", "servers"),
        ("agents.list", "subagents"),
    ] {
        let result = host.call(method, json!({"level":"global"}));
        assert_eq!(result[key], json!([]));
        assert_eq!(result["directory"], json!(profile.join("agent").join(key)));
    }
    // Import is a read-only copy, even with an identical name in the source.
    let installed = host.call("skills.import", json!({"path": foreign_skill.parent().unwrap(), "skill":{"name":"shared","level":"global","mode":"copy"}}));
    assert_eq!(
        installed["skill"]["path"],
        profile
            .join("agent/skills/shared/SKILL.md")
            .to_string_lossy()
            .as_ref()
    );
    let installed_server = host.call("mcp.upsert", json!({"server":{"id":"shared","label":"BoxAI server","transport":"http","url":"https://you-box.com/mcp","level":"global"}}));
    assert_eq!(
        installed_server["server"]["path"],
        profile
            .join("agent/servers/shared.json")
            .to_string_lossy()
            .as_ref()
    );
    assert_eq!(
        host.call("skills.list", json!({"level":"global"}))["skills"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        host.call("mcp.list", json!({"level":"global"}))["servers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    drop(host);
    let mut other_host = Host::start(home.path(), &other);
    for (method, leaf) in [
        ("skills.list", "skills"),
        ("mcp.list", "servers"),
        ("agents.list", "subagents"),
    ] {
        let result = other_host.call(method, json!({"level":"global"}));
        assert_eq!(result["directory"], json!(other.join("agent").join(leaf)));
    }
    let project = home.path().join("project");
    fs::create_dir(&project).unwrap();
    for (method, leaf) in [("skills.list", "skills"), ("mcp.list", "servers")] {
        let result = other_host.call(method, json!({"level":"project","projectPath":project}));
        assert_eq!(
            result["directory"],
            json!(project.join(".agents").join(leaf))
        );
    }
    assert_eq!(
        other_host.call("skills.list", json!({"level":"global"}))["skills"],
        json!([])
    );
    assert_eq!(
        other_host.call("mcp.list", json!({"level":"global"}))["servers"],
        json!([])
    );
    assert_eq!(fs::read_to_string(foreign_skill).unwrap(), skill);
    assert_eq!(fs::read_to_string(foreign_server).unwrap(), server);
    assert_eq!(fs::read_to_string(foreign_agent).unwrap(), skill);
}

#[test]
fn skill_packages_and_files_can_be_removed_and_reinstalled() {
    let home = tempfile::tempdir().unwrap();
    let profile = home.path().join("profile");
    let source = home.path().join("official-package");
    fs::create_dir_all(source.join("references")).unwrap();
    let body = "---\nname: using-boxai-gateway\n---\nUse the BoxAI gateway.\n";
    fs::write(source.join("SKILL.md"), body).unwrap();
    fs::write(source.join("references/api.md"), "Reference data").unwrap();
    let standalone = home.path().join("standalone.md");
    fs::write(
        &standalone,
        "---\nname: standalone\n---\nSingle file skill\n",
    )
    .unwrap();
    let mut host = Host::start(home.path(), &profile);
    let root = profile.join("agent/skills");
    for (path, id, destination) in [
        (
            &source,
            "using-boxai-gateway",
            root.join("using-boxai-gateway"),
        ),
        (&standalone, "standalone", root.join("standalone.md")),
    ] {
        let input = json!({"path":path,"skill":{"level":"global","mode":"copy"}});
        let installed = host.call("skills.import", input.clone());
        assert_eq!(installed["skill"]["id"], id);
        fs::write(root.join("unrelated.txt"), "Keep me").unwrap();
        assert_eq!(
            host.call("skills.remove", json!({"id":id,"level":"global"}))["ok"],
            true
        );
        assert!(!destination.exists(), "entire owned unit must be removed");
        assert_eq!(
            fs::read_to_string(root.join("unrelated.txt")).unwrap(),
            "Keep me"
        );
        let reinstalled = host.call("skills.import", input);
        assert_eq!(reinstalled["skill"]["id"], id);
        assert!(destination.exists());
    }
    assert_eq!(
        fs::read_to_string(root.join("using-boxai-gateway/references/api.md")).unwrap(),
        "Reference data"
    );
    assert_eq!(fs::read_to_string(source.join("SKILL.md")).unwrap(), body);
    assert!(standalone.is_file());
}

#[cfg(unix)]
#[test]
fn skill_removal_rejects_external_links_and_never_deletes_their_targets() {
    use std::os::unix::fs::symlink;
    let home = tempfile::tempdir().unwrap();
    let foreign = home.path().join("foreign");
    fs::create_dir_all(&foreign).unwrap();
    let body = "---\nname: foreign\n---\nHost-owned content\n";
    fs::write(foreign.join("SKILL.md"), body).unwrap();
    for shape in ["package", "file", "root", "resource"] {
        let profile = home.path().join(shape);
        let root = profile.join("agent/skills");
        fs::create_dir_all(&root).unwrap();
        match shape {
            "package" => symlink(&foreign, root.join("foreign")).unwrap(),
            "file" => symlink(foreign.join("SKILL.md"), root.join("foreign.md")).unwrap(),
            "root" => {
                fs::remove_dir(&root).unwrap();
                symlink(&foreign, &root).unwrap();
            }
            _ => {
                fs::create_dir(root.join("foreign")).unwrap();
                fs::write(root.join("foreign/SKILL.md"), body).unwrap();
                symlink(&foreign, root.join("foreign/references")).unwrap();
            }
        }
        let mut host = Host::start(home.path(), &profile);
        let response = host.response("skills.remove", json!({"id":"foreign","level":"global"}));
        if shape == "resource" {
            assert_eq!(response["result"]["ok"], true);
            assert!(!root.join("foreign").exists());
        } else {
            assert!(
                response["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("symbolic link"),
                "{response}"
            );
        }
        assert_eq!(fs::read_to_string(foreign.join("SKILL.md")).unwrap(), body);
    }
}

#[cfg(unix)]
#[test]
fn skill_removal_reports_filesystem_failure_over_rpc() {
    use std::os::unix::fs::PermissionsExt;
    // Root bypasses directory permissions, so this fixture requires an
    // unprivileged test runner (as used by the desktop CI/native runners).
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("permission-denial fixture requires an unprivileged runner");
        return;
    }
    let home = tempfile::tempdir().unwrap();
    let profile = home.path().join("profile");
    let root = profile.join("agent/skills");
    fs::create_dir_all(&root).unwrap();
    let document = root.join("locked.md");
    let body = "---\nname: locked\n---\nKeep this skill on failure\n";
    fs::write(&document, body).unwrap();
    let mut host = Host::start(home.path(), &profile);
    fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
    let response = host.response("skills.remove", json!({"id":"locked","level":"global"}));
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
    let message = response["error"]["message"].as_str().unwrap();
    assert!(message.contains("could not remove"), "{message}");
    assert!(message.contains("Permission denied"), "{message}");
    assert_eq!(fs::read_to_string(document).unwrap(), body);
    assert_eq!(
        host.call("skills.list", json!({"level":"global"}))["skills"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
