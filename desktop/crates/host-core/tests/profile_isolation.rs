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
            assert!(value.get("error").is_none(), "{method}: {value}");
            return value["result"].clone();
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
        assert_eq!(host.call(method, json!({"level":"global"}))[key], json!([]));
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
