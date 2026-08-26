#![allow(clippy::unwrap_used)]

use gateway_connector_core::{
    AgentId, AgentInstall, ApplyInput, CodexApprovalPolicy, CodexReasoningEffort,
    CodexReasoningSummary, CodexSandboxMode, CodexVerbosity, CodexWebSearch, ConnectionManifest,
    Connector, EffectiveAgentSelection, Gateway, Platform, Provisioning, Secret, WireProtocol,
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::{Builder, TempDir};

fn tempdir() -> io::Result<TempDir> {
    #[cfg(target_os = "macos")]
    {
        // macOS reports its default temporary root through the `/var`
        // compatibility symlink. Projection roots are deliberately required
        // to be canonical, so build test trees under its resolved spelling.
        let root = fs::canonicalize(std::env::temp_dir())?;
        Builder::new().prefix("gateway-connector-").tempdir_in(root)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Builder::new().prefix("gateway-connector-").tempdir()
    }
}

fn has_exact_sibling_backup(path: &Path, expected: &[u8]) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let prefix = format!("{name}.boxai-backup-");
    fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|candidate| {
            candidate
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix))
        })
        .any(|backup| fs::read(backup).unwrap() == expected)
}

fn contracts() -> (ConnectionManifest, Provisioning) {
    let manifest=ConnectionManifest::parse(br#"{"success":true,"data":{"schema_version":2,"platform":{"id":"platform-a","name":"Platform A"},"authentication":{"type":"browser_pkce","authorize_url":"https://id.example/auth","token_url":"https://id.example/token"},"gateway":{"base_url":"https://gw.example","protocols":["openai_chat","openai_responses","anthropic","gemini"]},"provisioning_url":"https://gw.example/provision","connection_bearer_origins":["https://gw.example"],"supported_agents":["claude","codex","gemini","grokbuild","opencode","workbuddy"]}}"#).unwrap();
    let provisioning=Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true},{"id":"beta","chat_capable":true}],"default_model":"alpha","mcp_servers":[{"id":"docs","name":"Docs","url":"https://gw.example/mcp/docs","authorization":"connection_bearer","description":"docs"}],"skills":[{"id":"deploy","name":"Deploy","version":"1.0.0","archive":{"url":"https://gw.example/skills/deploy.zip","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":1,"format":"zip","authorization":"none"}}]}}"#).unwrap();
    (manifest, provisioning)
}

fn selections(
    values: &[(AgentId, &str, WireProtocol)],
) -> BTreeMap<AgentId, EffectiveAgentSelection> {
    values
        .iter()
        .map(|(agent, model, protocol)| (*agent, EffectiveAgentSelection::new(*model, *protocol)))
        .collect()
}

#[test]
fn authentication_is_optional_and_direct_manifests_use_the_exact_gateway_origin() {
    let manifest = ConnectionManifest::direct(
        Platform {
            id: "direct".into(),
            name: "Direct".into(),
        },
        Gateway {
            base_url: "https://gateway.example/nested".parse().unwrap(),
            protocols: vec![WireProtocol::OpenaiResponses],
        },
        "https://gateway.example/provision".parse().unwrap(),
    )
    .unwrap();
    assert!(manifest.authentication.is_none());
    assert_eq!(
        manifest.connection_bearer_origins[0].as_str(),
        "https://gateway.example/"
    );

    let missing_gateway_origin = br#"{"success":true,"data":{"schema_version":2,"platform":{"id":"direct","name":"Direct"},"gateway":{"base_url":"https://gateway.example","protocols":[]},"provisioning_url":"https://gateway.example/provision","connection_bearer_origins":["https://other.example"],"supported_agents":["codex"]}}"#;
    assert!(ConnectionManifest::parse(missing_gateway_origin).is_err());
    // Whether one Agent can speak to this Gateway is resolved per Agent when a
    // projection is planned, so only malformed capability lists fail here.
    for protocols in [
        serde_json::json!(["auto"]),
        serde_json::json!(["openai_responses", "openai_responses"]),
        serde_json::json!([]),
    ] {
        let manifest = serde_json::json!({"success":true,"data":{
            "schema_version":2,
            "platform":{"id":"direct","name":"Direct"},
            "gateway":{"base_url":"https://gateway.example","protocols":protocols},
            "provisioning_url":"https://gateway.example/provision",
            "connection_bearer_origins":["https://gateway.example"],
            "supported_agents":["codex"]
        }});
        assert!(
            ConnectionManifest::parse(&serde_json::to_vec(&manifest).unwrap()).is_err(),
            "invalid protocol capabilities must fail: {protocols}"
        );
    }
}
#[test]
fn a_platform_no_longer_declares_which_agents_may_be_configured() {
    // Which clients Kit can configure is local capability, so a platform that
    // still sends the retired allowlist is ignored rather than obeyed, and an
    // id this build has never heard of no longer voids the whole connection.
    let stale = br#"{"success":true,"data":{"schema_version":2,"platform":{"id":"platform-a","name":"Platform A"},"gateway":{"base_url":"https://gw.example","protocols":["openai_chat"]},"provisioning_url":"https://gw.example/provision","connection_bearer_origins":["https://gw.example"],"supported_agents":["claude","some-client-from-the-future"]}}"#;
    let absent = br#"{"success":true,"data":{"schema_version":2,"platform":{"id":"platform-a","name":"Platform A"},"gateway":{"base_url":"https://gw.example","protocols":["openai_chat"]},"provisioning_url":"https://gw.example/provision","connection_bearer_origins":["https://gw.example"]}}"#;
    for manifest in [
        ConnectionManifest::parse(stale).expect("a stale allowlist is ignored"),
        ConnectionManifest::parse(absent).expect("an absent allowlist is the contract"),
    ] {
        assert_eq!(manifest.platform.id, "platform-a");
        assert_eq!(manifest.gateway.protocols, [WireProtocol::OpenaiChat]);
    }
}

#[test]
fn parses_full_additive_provisioning_contract() {
    let value = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"account":{"id":7,"username":"user","display_name":"User","email":"user@example.test","group":"pro"},"usage":{"wallet_quota_remaining":75,"lifetime_quota_used":25,"lifetime_request_count":9},"billing":{"portal_url":"https://billing.example/portal","wallet_fallback_allowed":true,"subscriptions":[]},"model_plaza":{"portal_url":"https://models.example/","models":[{"id":"embed","chat_capable":false,"description":"Embeddings","icon":"spark","tags":["embedding"],"endpoints":["embeddings"],"vendor":{"id":42,"name":"Vendor","icon":"example"}},{"id":"chat","chat_capable":true,"tags":[],"endpoints":["openai"]}]},"models":[{"id":"chat","chat_capable":true,"tags":[],"endpoints":["openai"]}],"default_model":"chat","mcp_servers":[],"skills":[]}}"#).unwrap();
    let plaza = value.model_plaza.as_ref().unwrap();
    assert!(!plaza.models[0].chat_capable);
    assert_eq!(plaza.models[0].endpoints, ["embeddings"]);
    assert_eq!(plaza.models[0].vendor.as_ref().unwrap().name, "Vendor");
    assert_eq!(plaza.models[0].vendor.as_ref().unwrap().id, 42);
    assert_eq!(value.models.len(), 1);
}

#[test]
fn non_chat_models_are_catalogued_but_never_defaulted_or_projected() {
    let non_chat_only = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"model_plaza":{"portal_url":"https://models.example/","models":[{"id":"embed","chat_capable":false}]},"models":[],"default_model":"","mcp_servers":[],"skills":[]}}"#).unwrap();
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"model_plaza":{"portal_url":"https://models.example/","models":[{"id":"embed","chat_capable":false}]},"models":[{"id":"embed","chat_capable":false}],"default_model":"embed","mcp_servers":[],"skills":[]}}"#).is_err());
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"model_plaza":{"portal_url":"https://models.example/","models":[]},"models":[{"id":"chat","chat_capable":true}],"default_model":"chat","mcp_servers":[],"skills":[]}}"#).is_err());

    let (manifest, _) = contracts();
    let t = tempdir().unwrap();
    let root = t.path().join("codex");
    fs::create_dir_all(&root).unwrap();
    let error = Connector::new(t.path().join("state"))
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &non_chat_only,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "embed", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root,
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err()
        .to_string();
    assert!(error.contains("no chat-capable model"), "{error}");
}
fn setup(root: &Path) -> (Connector, gateway_connector_core::Plan) {
    let (m, p) = contracts();
    let skill = root.join("source-skill");
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "verified").unwrap();
    let agents = AgentId::ALL;
    let installs = agents
        .into_iter()
        .map(|agent| {
            let dir = root.join(agent.as_str());
            fs::create_dir_all(&dir).unwrap();
            AgentInstall {
                agent,
                root: dir,
                detected: true,
            }
        })
        .collect();
    fs::write(
        root.join("claude/settings.json"),
        r#"{"theme":"dark","env":{"KEEP":"yes"}}"#,
    )
    .unwrap();
    fs::write(
        root.join("claude/.claude.json"),
        r#"{"other":1,"mcpServers":{"mine":{"command":"x"}}}"#,
    )
    .unwrap();
    fs::write(
        root.join("codex/config.toml"),
        "# keep-comment\nsandbox = \"workspace-write\"\n\n[features]\nimagegenext = true\n",
    )
    .unwrap();
    fs::write(root.join("gemini/.env"), "# keep\nOTHER=yes\n").unwrap();
    fs::write(
        root.join("gemini/settings.json"),
        r#"{"theme":"x","mcpServers":{"mine":{"command":"x"}}}"#,
    )
    .unwrap();
    fs::write(
        root.join("grokbuild/config.toml"),
        "# grok-comment\nkeep = true\n",
    )
    .unwrap();
    fs::write(
        root.join("opencode/opencode.json"),
        "{// comment\n\"theme\":\"dark\",\"provider\":{\"mine\":{}},\"mcp\":{\"mine\":{}}}",
    )
    .unwrap();
    fs::write(
        root.join("workbuddy/settings.json"),
        r#"{"theme":"dark","env":{"KEEP":"yes","CODEBUDDY_BASE_URL":"https://gw.example/v1"}}"#,
    )
    .unwrap();
    // The client writes this file as a bare array; an object holding `models`
    // is the other shape it accepts, and is covered separately.
    fs::write(
        root.join("workbuddy/models.json"),
        r#"[{"id":"mine","name":"Mine","url":"https://other.example/v1/chat/completions","apiKey":"keep"}]"#,
    )
    .unwrap();
    fs::write(
        root.join("workbuddy/.mcp.json"),
        r#"{"other":1,"mcpServers":{"mine":{"command":"x"}}}"#,
    )
    .unwrap();
    for a in [
        "claude",
        "codex",
        "gemini",
        "grokbuild",
        "opencode",
        "workbuddy",
    ] {
        let d = root.join(a).join("skills/unmanaged");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("x"), "keep").unwrap();
    }
    let connector = Connector::new(root.join("state"));
    let mut skills = BTreeMap::new();
    skills.insert("deploy".into(), skill);
    let plan = connector
        .plan(ApplyInput {
            manifest: &m,
            provisioning: &p,
            bearer: &Secret::new("super-secret").unwrap(),
            agents: selections(&[
                (AgentId::Claude, "alpha", WireProtocol::Anthropic),
                (AgentId::Codex, "beta", WireProtocol::OpenaiResponses),
                (AgentId::Gemini, "alpha", WireProtocol::Gemini),
                (AgentId::Grokbuild, "alpha", WireProtocol::OpenaiResponses),
                (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
                (AgentId::Workbuddy, "alpha", WireProtocol::OpenaiChat),
            ]),
            installs,
            synchronized_skills: skills,
        })
        .unwrap();
    (connector, plan)
}

#[test]
fn projects_all_clients_preserves_and_disconnects_owned_entries() {
    let t = tempdir().unwrap();
    let (c, p) = setup(t.path());
    let provider = "platform-a";
    let mcp = "docs";
    let skill = "deploy";
    // One SSOT staging operation plus one target per Agent (not one SSOT copy
    // per Agent), in addition to the eleven configuration projections and the
    // GPT(Codex) and Buddy model catalogs.
    assert_eq!(p.changes.len(), 18);
    assert!(!format!("{p:?}").contains("super-secret"));
    c.apply(&p).unwrap();
    assert!(c.verify(&p).unwrap().ok);
    let claude: Value =
        serde_json::from_slice(&fs::read(t.path().join("claude/settings.json")).unwrap()).unwrap();
    assert_eq!(claude["theme"], "dark");
    assert_eq!(claude["env"]["ANTHROPIC_MODEL"], "alpha");
    let cm: Value =
        serde_json::from_slice(&fs::read(t.path().join("claude/.claude.json")).unwrap()).unwrap();
    assert!(
        cm["mcpServers"][&mcp]["headers"]["Authorization"]
            .as_str()
            .unwrap()
            .starts_with("Bearer ")
    );
    assert!(cm["mcpServers"]["mine"].is_object());
    let codex = fs::read_to_string(t.path().join("codex/config.toml")).unwrap();
    assert!(
        codex.contains("# keep-comment")
            && codex.contains("wire_api = \"responses\"")
            && codex.contains("requires_openai_auth = false")
            && codex.contains("x-openai-actor-authorization")
            && codex.contains("image_generation = true")
            && !codex.contains("imagegenext")
            && codex.contains("model = \"beta\"")
            && codex.contains("http_headers"),
        "{codex}"
    );
    assert!(!t.path().join("codex/auth.json").exists());
    let env = fs::read_to_string(t.path().join("gemini/.env")).unwrap();
    assert!(
        env.contains("# keep")
            && env.contains("OTHER=yes")
            && env.contains("GEMINI_API_KEY_AUTH_MECHANISM=\"bearer\"")
            && env.contains("GEMINI_MODEL=\"alpha\"")
            && !env.contains("OPENAI_API_KEY")
            && !env.contains("OPENAI_BASE_URL")
    );
    assert!(claude["env"].get("OPENAI_API_KEY").is_none());
    assert!(claude["env"].get("OPENAI_BASE_URL").is_none());
    let gem: Value =
        serde_json::from_slice(&fs::read(t.path().join("gemini/settings.json")).unwrap()).unwrap();
    assert_eq!(gem["security"]["auth"]["selectedType"], "gemini-api-key");
    assert_eq!(gem["model"]["name"], "alpha");
    assert!(gem["mcpServers"][&mcp]["httpUrl"].is_string());
    let grok = fs::read_to_string(t.path().join("grokbuild/config.toml")).unwrap();
    assert!(
        grok.contains("# grok-comment")
            && grok.contains(&format!("default = \"{provider}\""))
            && grok.contains(&format!("[model.{provider}]"))
            && grok.contains("api_backend = \"responses\"")
            && grok.contains("auth_scheme = \"bearer\"")
            && grok.contains("context_window = 500000")
            && grok.contains("headers")
    );
    let opencode_text = fs::read_to_string(t.path().join("opencode/opencode.json")).unwrap();
    assert!(opencode_text.contains("// comment"));
    let oc: Value = json5::from_str(&opencode_text).unwrap();
    assert_eq!(oc["theme"], "dark");
    assert_eq!(oc["model"], format!("{provider}/alpha"));
    assert!(oc["provider"][&provider]["models"]["beta"].is_object());
    assert_eq!(oc["mcp"][&mcp]["type"], "remote");
    let buddy: Value =
        serde_json::from_slice(&fs::read(t.path().join("workbuddy/settings.json")).unwrap())
            .unwrap();
    assert_eq!(buddy["theme"], "dark");
    assert_eq!(buddy["env"]["KEEP"], "yes");
    assert_eq!(buddy["model"], "alpha");
    // A projected model carries its own endpoint and key, so a global override
    // would only misroute the client's own hosted models.
    assert!(buddy["env"].get("CODEBUDDY_BASE_URL").is_none());
    assert!(buddy["env"].get("CODEBUDDY_API_KEY").is_none());
    assert!(buddy["env"].get("CODEBUDDY_AUTH_TOKEN").is_none());
    let buddy_models: Value =
        serde_json::from_slice(&fs::read(t.path().join("workbuddy/models.json")).unwrap()).unwrap();
    let entries = buddy_models
        .as_array()
        .expect("the client's own array shape survives projection");
    let foreign = entries.iter().find(|e| e["id"] == "mine").unwrap();
    assert_eq!(foreign["apiKey"], "keep");
    for id in ["alpha", "beta"] {
        let entry = entries
            .iter()
            .find(|e| e["id"] == id)
            .unwrap_or_else(|| panic!("{id} missing from {entries:?}"));
        assert_eq!(entry["url"], "https://gw.example/v1/chat/completions");
        assert_eq!(entry["apiKey"], "super-secret");
        assert_eq!(entry["vendor"], "Platform A");
        assert_eq!(entry["supportsToolCall"], true);
    }
    let buddy_mcp: Value =
        serde_json::from_slice(&fs::read(t.path().join("workbuddy/.mcp.json")).unwrap()).unwrap();
    assert!(buddy_mcp["mcpServers"]["mine"].is_object());
    assert!(
        buddy_mcp["mcpServers"][&mcp]["headers"]["Authorization"]
            .as_str()
            .unwrap()
            .starts_with("Bearer ")
    );
    for a in [
        "claude",
        "codex",
        "gemini",
        "grokbuild",
        "opencode",
        "workbuddy",
    ] {
        assert!(
            t.path()
                .join(a)
                .join("skills")
                .join(skill)
                .join("SKILL.md")
                .exists()
        );
        assert!(t.path().join(a).join("skills/unmanaged/x").exists());
    }
    let bearer = Secret::new("super-secret").unwrap();
    c.disconnect("platform-a", &bearer).unwrap();
    c.disconnect("platform-a", &bearer).unwrap();
    assert!(t.path().join("claude/skills/unmanaged/x").exists());
    assert!(!t.path().join("state/skills/platform-a/deploy").exists());
    assert!(!t.path().join("claude/skills").join(skill).exists());
    assert!(!t.path().join("state/receipts/platform-a.json").exists());
    let reverted: Value =
        serde_json::from_slice(&fs::read(t.path().join("workbuddy/models.json")).unwrap()).unwrap();
    assert_eq!(reverted.as_array().unwrap().len(), 1);
    assert_eq!(reverted[0]["id"], "mine");
    assert_eq!(
        fs::read_to_string(t.path().join("opencode/opencode.json")).unwrap(),
        "{// comment\n\"theme\":\"dark\",\"provider\":{\"mine\":{}},\"mcp\":{\"mine\":{}}}"
    );
}

#[test]
fn a_buddy_model_catalog_keeps_the_object_shape_and_the_users_own_filter() {
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true},{"id":"beta","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let t = tempdir().unwrap();
    let root = t.path().join("workbuddy");
    fs::create_dir(&root).unwrap();
    fs::write(
        root.join("models.json"),
        r#"{"availableModels":["mine"],"models":[{"id":"mine","url":"https://other.example/v1/chat/completions"}]}"#,
    )
    .unwrap();
    let connector = Connector::new(t.path().join("state"));
    let apply = || {
        let plan = connector
            .plan(ApplyInput {
                manifest: &manifest,
                provisioning: &provisioning,
                bearer: &Secret::new("secret").unwrap(),
                agents: selections(&[(AgentId::Workbuddy, "alpha", WireProtocol::OpenaiChat)]),
                installs: vec![AgentInstall {
                    agent: AgentId::Workbuddy,
                    root: root.clone(),
                    detected: true,
                }],
                synchronized_skills: BTreeMap::new(),
            })
            .unwrap();
        connector.apply(&plan).unwrap();
        let catalog: Value =
            serde_json::from_slice(&fs::read(root.join("models.json")).unwrap()).unwrap();
        catalog
    };
    let catalog = apply();
    assert_eq!(catalog["availableModels"], serde_json::json!(["mine"]));
    let ids: Vec<&str> = catalog["models"]
        .as_array()
        .expect("object shape survives projection")
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["mine", "alpha", "beta"]);
    // Re-applying must not stack a second copy of the same models.
    assert_eq!(apply()["models"].as_array().unwrap().len(), 3);
}

#[test]
fn grok_and_opencode_project_each_supported_protocol() {
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    for (protocol, backend) in [
        (WireProtocol::OpenaiChat, "chat_completions"),
        (WireProtocol::OpenaiResponses, "responses"),
        (WireProtocol::Anthropic, "messages"),
    ] {
        let t = tempdir().unwrap();
        let root = t.path().join("grok");
        fs::create_dir(&root).unwrap();
        let connector = Connector::new(t.path().join("state"));
        let plan = connector
            .plan(ApplyInput {
                manifest: &manifest,
                provisioning: &provisioning,
                bearer: &Secret::new("secret").unwrap(),
                agents: selections(&[(AgentId::Grokbuild, "alpha", protocol)]),
                installs: vec![AgentInstall {
                    agent: AgentId::Grokbuild,
                    root: root.clone(),
                    detected: true,
                }],
                synchronized_skills: BTreeMap::new(),
            })
            .unwrap();
        connector.apply(&plan).unwrap();
        let config = fs::read_to_string(root.join("config.toml")).unwrap();
        assert!(
            config.contains(&format!("api_backend = \"{backend}\"")),
            "{config}"
        );
        assert!(config.contains("auth_scheme = \"bearer\""), "{config}");
        assert!(config.contains("context_window = 500000"), "{config}");
    }

    for (protocol, package, base, credential_field) in [
        (
            WireProtocol::OpenaiChat,
            "@ai-sdk/openai-compatible",
            "https://gw.example/v1",
            "apiKey",
        ),
        (
            WireProtocol::OpenaiResponses,
            "@ai-sdk/openai",
            "https://gw.example/v1",
            "apiKey",
        ),
        (
            WireProtocol::Anthropic,
            "@ai-sdk/anthropic",
            "https://gw.example/v1",
            "authToken",
        ),
        (
            WireProtocol::Gemini,
            "@ai-sdk/google",
            "https://gw.example/v1beta",
            "apiKey",
        ),
    ] {
        let t = tempdir().unwrap();
        let root = t.path().join("opencode");
        fs::create_dir(&root).unwrap();
        let connector = Connector::new(t.path().join("state"));
        let plan = connector
            .plan(ApplyInput {
                manifest: &manifest,
                provisioning: &provisioning,
                bearer: &Secret::new("secret").unwrap(),
                agents: selections(&[(AgentId::Opencode, "alpha", protocol)]),
                installs: vec![AgentInstall {
                    agent: AgentId::Opencode,
                    root: root.clone(),
                    detected: true,
                }],
                synchronized_skills: BTreeMap::new(),
            })
            .unwrap();
        connector.apply(&plan).unwrap();
        let config: Value =
            serde_json::from_slice(&fs::read(root.join("opencode.json")).unwrap()).unwrap();
        let provider = "platform-a";
        assert_eq!(config["provider"][&provider]["npm"], package);
        assert_eq!(config["provider"][&provider]["options"]["baseURL"], base);
        assert_eq!(
            config["provider"][&provider]["options"][credential_field],
            "secret"
        );
    }
}

#[test]
fn rejects_schema_and_security_errors() {
    let bad = |s: &str| ConnectionManifest::parse(s.as_bytes());
    let base = r#"{"success":true,"data":{"schema_version":VERSION,"platform":{"id":"x","name":"X"},"authentication":{"type":"browser_pkce","authorize_url":"https://x/a","token_url":"https://x/t"},"gateway":{"base_url":"URL","protocols":[]},"provisioning_url":"https://x/p","connection_bearer_origins":["https://x"],"supported_agents":["codex"]}}"#;
    assert!(bad(&base.replace("VERSION", "3").replace("URL", "https://x")).is_err());
    assert!(
        bad(&base
            .replace("VERSION", "2")
            .replace("URL", "http://evil.example"))
        .is_err()
    );
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"x","chat_capable":true}],"default_model":"missing","mcp_servers":[],"skills":[]}}"#).is_err());
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"x","chat_capable":true}],"default_model":"x","mcp_servers":[{"id":"m","name":"m","url":"http://localhost/m","authorization":"connection_bearer"}],"skills":[]}}"#).is_err());
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"openai/gpt-5:latest","chat_capable":true}],"default_model":"openai/gpt-5:latest","mcp_servers":[],"skills":[]}}"#).is_ok());
    assert!(Provisioning::parse(b"{\"success\":true,\"data\":{\"schema_version\":2,\"models\":[{\"id\":\"bad\\nmodel\",\"chat_capable\":true}],\"default_model\":\"bad\\nmodel\",\"mcp_servers\":[],\"skills\":[]}}").is_err());
    let (manifest, mut provisioning) = contracts();
    provisioning.mcp_servers[0].url = "https://attacker.example/mcp".parse().unwrap();
    assert!(provisioning.validate_for(&manifest).is_err());
    provisioning.skills.clear();
    let temp = tempdir().unwrap();
    assert!(
        Connector::new(temp.path().join("state"))
            .plan(ApplyInput {
                manifest: &manifest,
                provisioning: &provisioning,
                bearer: &Secret::new("secret").unwrap(),
                agents: BTreeMap::new(),
                installs: vec![],
                synchronized_skills: BTreeMap::new(),
            })
            .is_err()
    );
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"x","chat_capable":true}],"default_model":"x","mcp_servers":[],"skills":[{"id":"large","name":"Large","version":"1.0.0","archive":{"url":"https://gw.example/large.zip","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":67108865,"format":"zip","authorization":"none"}}]}}"#).is_err());
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"x","chat_capable":true}],"default_model":"x","mcp_servers":[],"skills":[{"id":"con.tools","name":"Reserved","version":"1.0.0","archive":{"url":"https://gw.example/con.zip","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":1,"format":"zip","authorization":"none"}}]}}"#).is_err());
    assert!(
        bad(&base
            .replace("VERSION", "2")
            .replace("URL", "https://x")
            .replace("\"id\":\"x\"", "\"id\":\"con\""))
        .is_err()
    );
    assert!(!format!("{:?}", Secret::new("needle").unwrap()).contains("needle"));
}

#[test]
fn provisioning_enforces_catalog_and_description_bounds() {
    let (_, base) = contracts();
    let mcp = base.mcp_servers[0].clone();
    let mut provisioning = base.clone();
    provisioning.mcp_servers = (0..256)
        .map(|index| {
            let mut item = mcp.clone();
            item.id = format!("mcp-{index}");
            item
        })
        .collect();
    assert!(provisioning.validate().is_ok());
    let mut extra = mcp.clone();
    extra.id = "mcp-256".into();
    provisioning.mcp_servers.push(extra);
    assert!(
        provisioning
            .validate()
            .unwrap_err()
            .to_string()
            .contains("exceeds 256 entries")
    );

    let skill = base.skills[0].clone();
    provisioning = base.clone();
    provisioning.skills = (0..256)
        .map(|index| {
            let mut item = skill.clone();
            item.id = format!("skill-{index}");
            item
        })
        .collect();
    assert!(provisioning.validate().is_ok());
    let mut extra = skill;
    extra.id = "skill-256".into();
    provisioning.skills.push(extra);
    assert!(
        provisioning
            .validate()
            .unwrap_err()
            .to_string()
            .contains("exceeds 256 entries")
    );

    provisioning = base;
    provisioning.mcp_servers[0].description = Some("x".repeat(1024));
    assert!(provisioning.validate().is_ok());
    provisioning.mcp_servers[0].description = Some("x".repeat(1025));
    assert!(provisioning.validate().is_err());
    provisioning.mcp_servers[0].description = Some("bad\ndescription".into());
    assert!(provisioning.validate().is_err());
}

#[test]
fn empty_catalog_is_honest_but_cannot_be_projected_and_duplicates_fail() {
    let empty = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[],"default_model":"","mcp_servers":[],"skills":[]}}"#).unwrap();
    let (manifest, _) = contracts();
    let t = tempdir().unwrap();
    let error = Connector::new(t.path().join("state"))
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &empty,
            bearer: &Secret::new("x").unwrap(),
            agents: BTreeMap::new(),
            installs: vec![],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err()
        .to_string();
    assert!(error.contains("no chat-capable model"), "{error}");
    assert!(Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"x","chat_capable":true},{"id":"x","chat_capable":true}],"default_model":"x","mcp_servers":[],"skills":[]}}"#).is_err());
}

#[test]
fn discovery_honors_override_then_environment_without_creating_paths() {
    use gateway_connector_core::Discovery;
    let t = tempdir().unwrap();
    let home = t.path().join("home");
    let override_path = t.path().join("override");
    let codex_env = t.path().join("codex-env");
    let grok_env = t.path().join("grok-env");
    let xdg = t.path().join("xdg");
    let buddy_env = t.path().join("workbuddy-env");
    let discovery = Discovery {
        overrides: BTreeMap::from([(AgentId::Codex, override_path.clone())]),
    };
    let found = discovery.discover_with(&home, |key| match key {
        "CODEX_HOME" => Some(codex_env.clone()),
        "GROK_HOME" => Some(grok_env.clone()),
        "XDG_CONFIG_HOME" => Some(xdg.clone()),
        "CODEBUDDY_CONFIG_DIR" => Some(buddy_env.clone()),
        _ => None,
    });
    let root = |agent| {
        found
            .iter()
            .find(|x| x.agent == agent)
            .unwrap()
            .root
            .clone()
    };
    assert_eq!(root(AgentId::Codex), override_path);
    assert_eq!(root(AgentId::Grokbuild), grok_env);
    assert_eq!(root(AgentId::Opencode), xdg.join("opencode"));
    assert_eq!(root(AgentId::Workbuddy), buddy_env);
    assert!(found.iter().all(|x| !x.detected));
    assert!(!home.exists() && !codex_env.exists() && !xdg.exists());

    // The client reads its current brand's variable first and only then the
    // one it shipped under before.
    let renamed = t.path().join("renamed-env");
    let found = discovery.discover_with(&home, |key| match key {
        "WORKBUDDY_CONFIG_DIR" => Some(renamed.clone()),
        "CODEBUDDY_CONFIG_DIR" => Some(buddy_env.clone()),
        _ => None,
    });
    let buddy = found
        .iter()
        .find(|install| install.agent == AgentId::Workbuddy)
        .unwrap();
    assert_eq!(buddy.root, renamed);
    let found = discovery.discover_with(&home, |key| match key {
        "WORKBUDDY_CONFIG_DIR" => Some(PathBuf::new()),
        "CODEBUDDY_CONFIG_DIR" => Some(buddy_env.clone()),
        _ => None,
    });
    let buddy = found
        .iter()
        .find(|install| install.agent == AgentId::Workbuddy)
        .unwrap();
    assert_eq!(buddy.root, buddy_env);
}

#[test]
fn duplicate_projection_paths_are_rejected() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let shared = t.path().join("shared");
    fs::create_dir_all(&shared).unwrap();
    let connector = Connector::new(t.path().join("state"));
    let error = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[
                (AgentId::Codex, "alpha", WireProtocol::OpenaiResponses),
                (AgentId::Grokbuild, "alpha", WireProtocol::OpenaiResponses),
            ]),
            installs: vec![
                AgentInstall {
                    agent: AgentId::Codex,
                    root: shared.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Grokbuild,
                    root: shared,
                    detected: true,
                },
            ],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err()
        .to_string();
    assert!(error.contains("same path"), "{error}");
}

#[test]
fn applying_agents_preserves_login_state_without_collision() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let provider = "platform-a";
    let claude = t.path().join("claude");
    let codex = t.path().join("codex");
    let gemini = t.path().join("gemini");
    let grok = t.path().join("grokbuild");
    let opencode = t.path().join("opencode");
    let workbuddy = t.path().join("workbuddy");
    for dir in [&claude, &codex, &gemini, &grok, &opencode, &workbuddy] {
        fs::create_dir_all(dir).unwrap();
    }
    fs::write(
        claude.join("settings.json"),
        r#"{"env":{"ANTHROPIC_API_KEY":"stale-api-key","ANTHROPIC_AUTH_TOKEN":"stale-token","KEEP":"yes"}}"#,
    )
    .unwrap();
    let original_codex_auth =
        br#"{"auth_mode":"chatgpt","OPENAI_API_KEY":"","tokens":{"access_token":"chatgpt-access"}}"#;
    fs::write(codex.join("auth.json"), original_codex_auth).unwrap();
    fs::write(
        codex.join("config.toml"),
        format!(
            "model_provider = \"{provider}\"\n\n[model_providers.{provider}]\nname = \"Old\"\nbase_url = \"https://old.example/v1\"\n"
        ),
    )
    .unwrap();
    fs::write(
        gemini.join(".env"),
        "GOOGLE_GEMINI_BASE_URL=https://boxai.example\nGEMINI_API_KEY=boxai-key\nGEMINI_MODEL=old\n",
    )
    .unwrap();
    fs::write(
        gemini.join("settings.json"),
        r#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#,
    )
    .unwrap();
    fs::write(
        grok.join("config.toml"),
        format!(
            "[models]\ndefault = \"{provider}\"\n\n[model.{provider}]\nmodel = \"old\"\nbase_url = \"https://old.example/v1\"\nname = \"Old\"\napi_key = \"old-key\"\napi_backend = \"chat_completions\"\ncontext_window = 128000\n"
        ),
    )
    .unwrap();
    fs::write(
        opencode.join("opencode.json"),
        serde_json::to_vec(&serde_json::json!({
            "model": "Kimi K2.6",
            "provider": {
                "platform-a": {"user": true},
                "mine": {}
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let mut agents = selections(&[
        (AgentId::Claude, "alpha", WireProtocol::Anthropic),
        (AgentId::Codex, "alpha", WireProtocol::OpenaiResponses),
        (AgentId::Gemini, "alpha", WireProtocol::Gemini),
        (AgentId::Grokbuild, "alpha", WireProtocol::OpenaiResponses),
        (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
        (AgentId::Workbuddy, "alpha", WireProtocol::OpenaiChat),
    ]);
    for selection in agents.values_mut() {
        selection.disabled_skills.insert("deploy".into());
    }
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![
                AgentInstall {
                    agent: AgentId::Claude,
                    root: claude.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Codex,
                    root: codex.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Gemini,
                    root: gemini.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Grokbuild,
                    root: grok.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Opencode,
                    root: opencode.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Workbuddy,
                    root: workbuddy.clone(),
                    detected: true,
                },
            ],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();

    let claude_settings: Value =
        serde_json::from_slice(&fs::read(claude.join("settings.json")).unwrap()).unwrap();
    assert_eq!(claude_settings["env"]["KEEP"], "yes");
    assert_eq!(claude_settings["env"]["ANTHROPIC_AUTH_TOKEN"], "secret");
    assert_eq!(claude_settings["env"]["ANTHROPIC_MODEL"], "alpha");
    assert!(claude_settings["env"].get("ANTHROPIC_API_KEY").is_none());

    assert_eq!(
        fs::read(codex.join("auth.json")).unwrap(),
        original_codex_auth
    );
    let codex_config = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(
        codex_config.contains("https://gw.example/v1"),
        "{codex_config}"
    );
    assert!(
        !codex_config.contains("https://old.example/v1"),
        "{codex_config}"
    );

    let gemini_env = fs::read_to_string(gemini.join(".env")).unwrap();
    assert!(
        gemini_env.contains("GEMINI_API_KEY=\"secret\""),
        "{gemini_env}"
    );
    assert!(!gemini_env.contains("boxai-key"), "{gemini_env}");
    let gemini_settings: Value =
        serde_json::from_slice(&fs::read(gemini.join("settings.json")).unwrap()).unwrap();
    assert_eq!(
        gemini_settings["security"]["auth"]["selectedType"],
        "gemini-api-key"
    );

    let grok_config = fs::read_to_string(grok.join("config.toml")).unwrap();
    assert!(
        grok_config.contains("api_key = \"secret\""),
        "{grok_config}"
    );
    assert!(
        grok_config.contains("context_window = 128000"),
        "{grok_config}"
    );
    assert!(
        grok_config.contains("api_backend = \"responses\""),
        "{grok_config}"
    );
    assert!(!grok_config.contains("old-key"), "{grok_config}");

    let oc: Value =
        json5::from_str(&fs::read_to_string(opencode.join("opencode.json")).unwrap()).unwrap();
    assert_eq!(oc["model"], format!("{provider}/alpha"));
    assert_eq!(oc["provider"][provider]["options"]["apiKey"], "secret");
    assert!(oc["provider"]["mine"].is_object());
    assert!(oc["provider"][provider].get("user").is_none());
}

#[test]
fn independently_branded_connectors_share_agent_ownership_leases() {
    let t = tempdir().unwrap();
    let (first_manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    let install = AgentInstall {
        agent: AgentId::Codex,
        root: codex,
        detected: true,
    };
    let alias_parent = t.path().join("alias-parent");
    fs::create_dir_all(&alias_parent).unwrap();
    let coordinator = t.path().join("shared-coordinator");
    let first_connector = Connector::with_coordinator(t.path().join("first-state"), &coordinator);
    let first_plan = first_connector
        .plan(ApplyInput {
            manifest: &first_manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("first-secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![install.clone()],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    first_connector.apply(&first_plan).unwrap();

    let mut second_manifest = first_manifest.clone();
    second_manifest.platform.id = "platform-b".into();
    second_manifest.platform.name = "Platform B".into();
    let second_connector = Connector::with_coordinator(t.path().join("second-state"), &coordinator);
    let error = second_connector
        .plan(ApplyInput {
            manifest: &second_manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("second-secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                root: alias_parent.join("../codex"),
                ..install.clone()
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("already managed by platform platform-a"),
        "{error}"
    );

    #[cfg(unix)]
    {
        let symlink = t.path().join("codex-link");
        std::os::unix::fs::symlink(&install.root, &symlink).unwrap();
        let error = second_connector
            .plan(ApplyInput {
                manifest: &second_manifest,
                provisioning: &provisioning,
                bearer: &Secret::new("second-secret").unwrap(),
                agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
                installs: vec![AgentInstall {
                    root: symlink,
                    ..install.clone()
                }],
                synchronized_skills: BTreeMap::new(),
            })
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("already managed by platform platform-a"),
            "{error}"
        );
    }

    first_connector
        .disconnect("platform-a", &Secret::new("first-secret").unwrap())
        .unwrap();
    let second_plan = second_connector
        .plan(ApplyInput {
            manifest: &second_manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("second-secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![install],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    second_connector.apply(&second_plan).unwrap();
}

#[test]
fn claude_lease_covers_the_shared_parent_configuration() {
    let t = tempdir().unwrap();
    let (first_manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let home = t.path().join("home");
    let standard_root = home.join(".claude");
    fs::create_dir_all(&standard_root).unwrap();
    let coordinator = t.path().join("shared-coordinator");
    let first = Connector::with_coordinator(t.path().join("first-state"), &coordinator);
    let first_plan = first
        .plan(ApplyInput {
            manifest: &first_manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("first-secret").unwrap(),
            agents: selections(&[(AgentId::Claude, "alpha", WireProtocol::Anthropic)]),
            installs: vec![AgentInstall {
                agent: AgentId::Claude,
                root: standard_root,
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    first.apply(&first_plan).unwrap();

    let mut second_manifest = first_manifest;
    second_manifest.platform.id = "platform-b".into();
    let second = Connector::with_coordinator(t.path().join("second-state"), &coordinator);
    let error = second
        .plan(ApplyInput {
            manifest: &second_manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("second-secret").unwrap(),
            agents: selections(&[(AgentId::Claude, "alpha", WireProtocol::Anthropic)]),
            installs: vec![AgentInstall {
                agent: AgentId::Claude,
                root: home,
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("already managed by platform platform-a"),
        "{error}"
    );
}

#[cfg(unix)]
#[test]
fn configuration_symlinks_are_rejected_without_replacing_them() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    let target = t.path().join("dotfiles-codex.toml");
    fs::write(&target, "keep = true\n").unwrap();
    std::os::unix::fs::symlink(&target, codex.join("config.toml")).unwrap();

    let error = Connector::new(t.path().join("state"))
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("symlink") || error.contains("reparse point"),
        "{error}"
    );
    assert!(
        fs::symlink_metadata(codex.join("config.toml"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::read_to_string(target).unwrap(), "keep = true\n");
}

#[test]
fn skill_replacement_requires_both_owner_marker_and_framed_tree_hash() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[{"id":"deploy","name":"Deploy","version":"1.0.0","archive":{"url":"https://gw.example/skills/deploy.zip","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":1,"format":"zip","authorization":"none"}}]}}"#).unwrap();
    let source = t.path().join("source");
    let claude = t.path().join("claude");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&claude).unwrap();
    fs::write(source.join("a"), "bc").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Claude, "alpha", WireProtocol::Anthropic)]),
            installs: vec![AgentInstall {
                agent: AgentId::Claude,
                root: claude.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::from([("deploy".into(), source)]),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    let target = claude.join("skills/deploy");
    let marker = fs::read(target.join(".gateway-connector-owner")).unwrap();
    fs::remove_dir_all(&target).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("ab"), "c").unwrap();
    fs::write(target.join(".gateway-connector-owner"), marker).unwrap();

    let error = connector
        .disconnect("platform-a", &Secret::new("secret").unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("local changes"), "{error}");
    assert!(target.join("ab").exists());
    assert!(t.path().join("state/receipts/platform-a.json").exists());
}

#[test]
fn image_direct_writes_openai_env_only_for_claude_and_gemini() {
    let t = tempdir().unwrap();
    let (connector, initial) = setup(t.path());
    connector.apply(&initial).unwrap();

    let (manifest, provisioning) = contracts();
    let skill = t.path().join("source-skill");
    let installs = AgentId::ALL
        .into_iter()
        .map(|agent| AgentInstall {
            agent,
            root: t.path().join(agent.as_str()),
            detected: true,
        })
        .collect();
    let mut synchronized_skills = BTreeMap::new();
    synchronized_skills.insert("deploy".into(), skill);
    let agents = AgentId::ALL
        .into_iter()
        .map(|agent| {
            let (model, protocol) = match agent {
                AgentId::Claude => ("alpha", WireProtocol::Anthropic),
                AgentId::Codex => ("beta", WireProtocol::OpenaiResponses),
                AgentId::Gemini => ("alpha", WireProtocol::Gemini),
                AgentId::Grokbuild => ("alpha", WireProtocol::OpenaiResponses),
                AgentId::Opencode => ("alpha", WireProtocol::OpenaiChat),
                AgentId::Workbuddy => ("alpha", WireProtocol::OpenaiChat),
            };
            let mut selection = EffectiveAgentSelection::new(model, protocol);
            selection.image_direct = true;
            (agent, selection)
        })
        .collect();
    let enabled = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("super-secret").unwrap(),
            agents,
            installs,
            synchronized_skills: synchronized_skills.clone(),
        })
        .unwrap();
    assert!(!format!("{enabled:?}").contains("super-secret"));
    connector.apply(&enabled).unwrap();

    let claude: Value =
        serde_json::from_slice(&fs::read(t.path().join("claude/settings.json")).unwrap()).unwrap();
    assert_eq!(claude["env"]["OPENAI_BASE_URL"], "https://gw.example/v1");
    assert_eq!(claude["env"]["OPENAI_API_KEY"], "super-secret");
    let gemini = fs::read_to_string(t.path().join("gemini/.env")).unwrap();
    assert!(
        gemini.contains("OPENAI_BASE_URL=\"https://gw.example/v1\"")
            && gemini.contains("OPENAI_API_KEY=\"super-secret\""),
        "{gemini}"
    );
    let grok = fs::read_to_string(t.path().join("grokbuild/config.toml")).unwrap();
    let opencode = fs::read_to_string(t.path().join("opencode/opencode.json")).unwrap();
    assert!(!grok.contains("OPENAI_API_KEY") && !grok.contains("OPENAI_BASE_URL"));
    assert!(!opencode.contains("OPENAI_API_KEY") && !opencode.contains("OPENAI_BASE_URL"));

    let disabled_agents = selections(&[
        (AgentId::Claude, "alpha", WireProtocol::Anthropic),
        (AgentId::Codex, "beta", WireProtocol::OpenaiResponses),
        (AgentId::Gemini, "alpha", WireProtocol::Gemini),
        (AgentId::Grokbuild, "alpha", WireProtocol::OpenaiResponses),
        (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
        (AgentId::Workbuddy, "alpha", WireProtocol::OpenaiChat),
    ]);
    let installs = AgentId::ALL
        .into_iter()
        .map(|agent| AgentInstall {
            agent,
            root: t.path().join(agent.as_str()),
            detected: true,
        })
        .collect();
    let disabled = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("super-secret").unwrap(),
            agents: disabled_agents,
            installs,
            synchronized_skills,
        })
        .unwrap();
    connector.apply(&disabled).unwrap();
    let claude: Value =
        serde_json::from_slice(&fs::read(t.path().join("claude/settings.json")).unwrap()).unwrap();
    assert!(claude["env"].get("OPENAI_API_KEY").is_none());
    assert!(claude["env"].get("OPENAI_BASE_URL").is_none());
    let gemini = fs::read_to_string(t.path().join("gemini/.env")).unwrap();
    assert!(!gemini.contains("OPENAI_API_KEY") && !gemini.contains("OPENAI_BASE_URL"));
}

#[test]
fn disabled_mcp_and_skills_are_omitted_from_the_agent_plan() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    let mut agents = selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]);
    let selection = agents.get_mut(&AgentId::Codex).expect("codex selection");
    selection.disabled_mcp.insert("docs".into());
    selection.disabled_skills.insert("deploy".into());
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    assert!(
        plan.changes
            .iter()
            .all(|change| !change.path.ends_with("skills/deploy"))
    );
    connector.apply(&plan).unwrap();
    let config = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(!config.contains("docs"), "{config}");
    assert!(!codex.join("skills/deploy").exists());
}

#[test]
fn codex_preferences_project_native_config_and_inherit_original_values() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    fs::write(
        codex.join("config.toml"),
        "# user setting\nmodel_reasoning_effort = \"low\"\nunrelated = true\n",
    )
    .unwrap();
    let install = AgentInstall {
        agent: AgentId::Codex,
        root: codex.clone(),
        detected: true,
    };
    let connector = Connector::new(t.path().join("state"));
    let mut agents = selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]);
    let settings = &mut agents.get_mut(&AgentId::Codex).unwrap().codex;
    settings.reasoning_effort = Some(CodexReasoningEffort::High);
    settings.reasoning_summary = Some(CodexReasoningSummary::Concise);
    settings.verbosity = Some(CodexVerbosity::Medium);
    settings.approval_policy = Some(CodexApprovalPolicy::OnRequest);
    settings.sandbox_mode = Some(CodexSandboxMode::WorkspaceWrite);
    settings.web_search = Some(CodexWebSearch::Indexed);
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![install.clone()],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    let projected = fs::read_to_string(codex.join("config.toml")).unwrap();
    for expected in [
        "model_reasoning_effort = \"high\"",
        "model_reasoning_summary = \"concise\"",
        "model_verbosity = \"medium\"",
        "approval_policy = \"on-request\"",
        "sandbox_mode = \"workspace-write\"",
        "web_search = \"indexed\"",
        "unrelated = true",
    ] {
        assert!(
            projected.contains(expected),
            "missing {expected}: {projected}"
        );
    }

    let inherited = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![install],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&inherited).unwrap();
    let inherited = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(inherited.contains("model_reasoning_effort = \"low\""));
    assert!(inherited.contains("unrelated = true"));
    assert!(!inherited.contains("model_reasoning_summary"));
    assert!(!inherited.contains("approval_policy"));
    assert!(!inherited.contains("sandbox_mode"));
    assert!(!inherited.contains("web_search"));
}

#[test]
fn synchronized_skills_outside_provisioning_are_projected() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let deploy = t.path().join("deploy-src");
    let official = t.path().join("official");
    let claude = t.path().join("claude");
    fs::create_dir_all(&deploy).unwrap();
    fs::create_dir_all(&official).unwrap();
    fs::create_dir_all(&claude).unwrap();
    fs::write(deploy.join("SKILL.md"), "deploy").unwrap();
    fs::write(official.join("SKILL.md"), "# official\n").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Claude, "alpha", WireProtocol::Anthropic)]),
            installs: vec![AgentInstall {
                agent: AgentId::Claude,
                root: claude.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::from([
                ("deploy".into(), deploy),
                ("boxai-deploy".into(), official),
            ]),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    assert_eq!(
        fs::read_to_string(claude.join("skills/boxai-deploy/SKILL.md")).unwrap(),
        "# official\n"
    );
}

#[test]
fn reapply_keeps_first_original_and_drift_disconnect_is_semantic() {
    let t = tempdir().unwrap();
    let original = fs::read(t.path().join("nothing")).ok();
    assert!(original.is_none());
    let (c, first) = setup(t.path());
    let original_codex = fs::read(t.path().join("codex/config.toml")).unwrap();
    c.apply(&first).unwrap();
    let (_, second) = setup(t.path());
    c.apply(&second).unwrap();
    let opencode = t.path().join("opencode/opencode.json");
    let mut drift = fs::read_to_string(&opencode).unwrap();
    let close = drift.rfind('}').unwrap();
    drift.insert_str(close, ",\n// unrelated local comment\n\"user_after\":true");
    fs::write(&opencode, drift).unwrap();
    c.disconnect("platform-a", &Secret::new("super-secret").unwrap())
        .unwrap();
    assert_eq!(
        fs::read(t.path().join("codex/config.toml")).unwrap(),
        original_codex
    );
    let after_text = fs::read_to_string(opencode).unwrap();
    assert!(after_text.contains("// unrelated local comment"));
    let after: Value = json5::from_str(&after_text).unwrap();
    assert_eq!(after["user_after"], true);
    assert!(after["provider"]["platform-a"].is_null());
}

#[test]
fn duplicate_json_keys_are_refused_without_writing() {
    let t = tempdir().unwrap();
    let (connector, plan) = setup(t.path());
    connector.apply(&plan).unwrap();
    let path = t.path().join("opencode/opencode.json");
    let duplicate = b"{\n  // ambiguity must fail closed\n  \"same\": 1,\n  \"nested\": {\"same\": 2, \"same\": 3}\n}\n";
    fs::write(&path, duplicate).unwrap();

    let error = connector
        .disconnect("platform-a", &Secret::new("super-secret").unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("duplicate object key"), "{error}");
    assert_eq!(fs::read(path).unwrap(), duplicate);
}

#[test]
fn reapply_removes_stale_mcp_and_skill_ownership() {
    let t = tempdir().unwrap();
    let mcp = "docs";
    let skill = "deploy";
    let (connector, first) = setup(t.path());
    connector.apply(&first).unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let installs = AgentId::ALL
        .into_iter()
        .map(|agent| AgentInstall {
            agent,
            root: t.path().join(agent.as_str()),
            detected: true,
        })
        .collect();
    let second = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("super-secret").unwrap(),
            agents: selections(&[
                (AgentId::Claude, "alpha", WireProtocol::Anthropic),
                (AgentId::Codex, "alpha", WireProtocol::OpenaiResponses),
                (AgentId::Gemini, "alpha", WireProtocol::Gemini),
                (AgentId::Grokbuild, "alpha", WireProtocol::OpenaiResponses),
                (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
                (AgentId::Workbuddy, "alpha", WireProtocol::OpenaiChat),
            ]),
            installs,
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    assert!(second.changes.iter().any(|change| change.kind
        == gateway_connector_core::ChangeKind::Remove
        && change.path.ends_with("skills/deploy")));
    connector.apply(&second).unwrap();
    assert!(connector.verify(&second).unwrap().ok);

    let claude: Value =
        serde_json::from_slice(&fs::read(t.path().join("claude/.claude.json")).unwrap()).unwrap();
    assert!(claude["mcpServers"]["mine"].is_object());
    assert!(claude["mcpServers"][&mcp].is_null());
    assert!(
        !fs::read_to_string(t.path().join("codex/config.toml"))
            .unwrap()
            .contains(mcp)
    );
    assert!(!t.path().join("state/skills/platform-a/deploy").exists());
    assert!(!t.path().join("opencode/skills").join(skill).exists());
}

#[test]
fn codex_reapply_backups_local_changes_and_overwrites_managed_fields() {
    let t = tempdir().unwrap();
    let (connector, first) = setup(t.path());
    connector.apply(&first).unwrap();
    let codex_root = t.path().join("codex");
    let config = codex_root.join("config.toml");
    let drift = fs::read_to_string(&config).unwrap().replacen(
        "model = \"alpha\"",
        "model = \"locally-modified\"",
        1,
    ) + "\n[marketplaces.openai-bundled]\nlast_updated = 1777777777\n\
           \n[mcp_servers.node_repl.env]\nBROWSER_USE_CODEX_APP_VERSION = \"0.105.0\"\n\
           NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = \"desktop-hash\"\n\
           \n[shell_environment_policy.set]\nNODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = \"shell-hash\"\n";
    fs::write(&config, &drift).unwrap();

    let (manifest, provisioning) = contracts();
    let reapply = || {
        connector.plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("super-secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex_root.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::from([("deploy".into(), t.path().join("source-skill"))]),
        })
    };
    let second = reapply().expect("Codex-owned local changes must not block Apply");
    connector.apply(&second).unwrap();

    let applied = fs::read_to_string(&config).unwrap();
    assert!(applied.contains("model = \"alpha\""), "{applied}");
    assert!(!applied.contains("locally-modified"), "{applied}");
    assert!(applied.contains("last_updated = 1777777777"), "{applied}");
    assert!(
        applied.contains("BROWSER_USE_CODEX_APP_VERSION = \"0.105.0\""),
        "{applied}"
    );
    assert!(
        applied.contains("NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = \"shell-hash\""),
        "{applied}"
    );
    let backups = || {
        fs::read_dir(&codex_root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("config.toml.boxai-backup-"))
            })
            .collect::<Vec<_>>()
    };
    assert!(
        backups()
            .iter()
            .any(|backup| fs::read(backup).unwrap() == drift.as_bytes()),
        "the exact pre-overwrite config must be recoverable"
    );
    let backup_count = backups().len();
    let third = reapply().unwrap();
    connector.apply(&third).unwrap();
    assert_eq!(backups().len(), backup_count);

    connector
        .disconnect("platform-a", &Secret::new("super-secret").unwrap())
        .unwrap();
    let disconnected = fs::read_to_string(config).unwrap();
    assert!(
        disconnected.contains("last_updated = 1777777777"),
        "{disconnected}"
    );
    assert!(
        disconnected.contains("BROWSER_USE_CODEX_APP_VERSION = \"0.105.0\""),
        "{disconnected}"
    );
    assert!(!disconnected.contains("super-secret"), "{disconnected}");
}

#[test]
fn every_agent_reapply_backups_local_changes_and_overwrites_managed_fields() {
    let t = tempdir().unwrap();
    let (connector, first) = setup(t.path());
    connector.apply(&first).unwrap();
    let mut drifts = Vec::new();

    for relative in [
        "claude/settings.json",
        "claude/.claude.json",
        "gemini/settings.json",
        "opencode/opencode.json",
    ] {
        let path = t.path().join(relative);
        let mut value: Value = json5::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        value["user_after"] = serde_json::json!(true);
        match relative {
            "claude/settings.json" => {
                value["env"]["ANTHROPIC_MODEL"] = serde_json::json!("locally-modified")
            }
            "claude/.claude.json" => {
                value["mcpServers"]["docs"]["url"] = serde_json::json!("https://local.example/mcp")
            }
            "gemini/settings.json" => {
                value["mcpServers"]["docs"]["httpUrl"] =
                    serde_json::json!("https://local.example/mcp")
            }
            "opencode/opencode.json" => value["model"] = serde_json::json!("locally-modified"),
            _ => unreachable!(),
        }
        let bytes = serde_json::to_vec_pretty(&value).unwrap();
        fs::write(&path, &bytes).unwrap();
        drifts.push((path, bytes));
    }

    for (relative, managed, local) in [
        (
            "codex/config.toml",
            "model = \"beta\"",
            "model = \"locally-modified\"",
        ),
        (
            "gemini/.env",
            "GEMINI_MODEL=\"alpha\"",
            "GEMINI_MODEL=\"locally-modified\"",
        ),
        (
            "grokbuild/config.toml",
            "model = \"alpha\"",
            "model = \"locally-modified\"",
        ),
    ] {
        let path = t.path().join(relative);
        let bytes = (fs::read_to_string(&path)
            .unwrap()
            .replacen(managed, local, 1)
            + "\nuser_after = true\n")
            .into_bytes();
        assert!(String::from_utf8_lossy(&bytes).contains("locally-modified"));
        fs::write(&path, &bytes).unwrap();
        drifts.push((path, bytes));
    }

    let (manifest, provisioning) = contracts();
    let agents = [
        (AgentId::Claude, "alpha", WireProtocol::Anthropic),
        (AgentId::Codex, "beta", WireProtocol::OpenaiResponses),
        (AgentId::Gemini, "alpha", WireProtocol::Gemini),
        (AgentId::Grokbuild, "alpha", WireProtocol::OpenaiResponses),
        (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
        (AgentId::Workbuddy, "alpha", WireProtocol::OpenaiChat),
    ];
    let installs = agents
        .iter()
        .map(|(agent, _, _)| AgentInstall {
            agent: *agent,
            root: t.path().join(agent.as_str()),
            detected: true,
        })
        .collect();
    let second = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("super-secret").unwrap(),
            agents: selections(&agents),
            installs,
            synchronized_skills: BTreeMap::from([("deploy".into(), t.path().join("source-skill"))]),
        })
        .expect("local Agent configuration changes must not block Apply");
    connector.apply(&second).unwrap();

    for (path, drift) in &drifts {
        assert!(
            has_exact_sibling_backup(path, drift),
            "missing exact pre-overwrite backup for {}",
            path.display()
        );
        assert!(
            !fs::read_to_string(path)
                .unwrap()
                .contains("locally-modified"),
            "managed fields were not restored in {}",
            path.display()
        );
    }
}

#[test]
fn drifted_toml_disconnect_preserves_local_changes_and_keeps_a_backup() {
    let t = tempdir().unwrap();
    let (connector, plan) = setup(t.path());
    connector.apply(&plan).unwrap();
    let codex = t.path().join("codex/config.toml");
    fs::OpenOptions::new()
        .append(true)
        .open(&codex)
        .unwrap()
        .write_all(b"\nuser_after = true\n")
        .unwrap();
    let drift = fs::read(&codex).unwrap();

    connector
        .disconnect("platform-a", &Secret::new("super-secret").unwrap())
        .unwrap();
    let restored = fs::read_to_string(&codex).unwrap();
    assert!(restored.contains("user_after = true"), "{restored}");
    assert!(!restored.contains("super-secret"), "{restored}");
    assert!(!t.path().join("state/receipts/platform-a.json").exists());
    assert!(
        fs::read_dir(codex.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("config.toml.boxai-backup-"))
            })
            .any(|backup| fs::read(backup).unwrap() == drift)
    );
}

#[test]
fn malformed_receipt_nonce_is_rejected_without_panicking() {
    let t = tempdir().unwrap();
    let (connector, plan) = setup(t.path());
    connector.apply(&plan).unwrap();
    let path = t.path().join("state/receipts/platform-a.json");
    let mut receipt: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    receipt["nonce"] = serde_json::json!([]);
    fs::write(&path, serde_json::to_vec(&receipt).unwrap()).unwrap();

    let error = connector
        .disconnect("platform-a", &Secret::new("super-secret").unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("invalid receipt nonce"), "{error}");
}

#[test]
fn rolls_back_an_earlier_write_when_later_write_fails() {
    let t = tempdir().unwrap();
    let (c, p) = setup(t.path());
    let original = fs::read(t.path().join("claude/settings.json")).unwrap();
    fs::remove_file(t.path().join("claude/.claude.json")).unwrap();
    fs::create_dir(t.path().join("claude/.claude.json")).unwrap();
    assert!(c.apply(&p).is_err());
    assert_eq!(
        fs::read(t.path().join("claude/settings.json")).unwrap(),
        original
    );
    assert!(
        !t.path()
            .join("state/backups/platform-a")
            .read_dir()
            .is_ok_and(|mut entries| entries.next().is_some())
    );
}

#[test]
fn receipt_failure_rolls_back_every_projection() {
    let t = tempdir().unwrap();
    let (c, p) = setup(t.path());
    let original = fs::read(t.path().join("codex/config.toml")).unwrap();
    fs::create_dir_all(t.path().join("state")).unwrap();
    fs::write(t.path().join("state/receipts"), "blocks receipt directory").unwrap();

    assert!(c.apply(&p).is_err());
    assert_eq!(
        fs::read(t.path().join("codex/config.toml")).unwrap(),
        original
    );
    assert!(!t.path().join("state/skills/platform-a/deploy").exists());
}

#[test]
fn receipt_is_authenticated_ciphertext_and_verification_rejects_two_missing_directories() {
    let t = tempdir().unwrap();
    let (connector, plan) = setup(t.path());
    connector.apply(&plan).unwrap();
    let receipt = fs::read(t.path().join("state/receipts/platform-a.json")).unwrap();
    assert!(
        !receipt
            .windows(b"super-secret".len())
            .any(|w| w == b"super-secret")
    );
    assert!(
        !receipt
            .windows(b"ANTHROPIC_AUTH_TOKEN".len())
            .any(|w| w == b"ANTHROPIC_AUTH_TOKEN")
    );

    fs::remove_dir_all(t.path().join("source-skill")).unwrap();
    fs::remove_dir_all(t.path().join("state/skills/platform-a/deploy")).unwrap();
    let verification = connector.verify(&plan).unwrap();
    assert!(!verification.ok);
    assert!(
        verification
            .mismatches
            .iter()
            .any(|path| path.ends_with("deploy"))
    );
}

#[cfg(unix)]
#[test]
fn verification_treats_two_skill_hash_errors_as_a_mismatch() {
    use std::os::unix::fs::PermissionsExt;

    let t = tempdir().unwrap();
    let (connector, plan) = setup(t.path());
    connector.apply(&plan).unwrap();
    for path in [
        t.path().join("source-skill/SKILL.md"),
        t.path().join("claude/skills/deploy/SKILL.md"),
    ] {
        fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
    }
    let verification = connector.verify(&plan).unwrap();
    assert!(!verification.ok);
    assert!(
        verification
            .mismatches
            .iter()
            .any(|path| path.ends_with("skills/deploy"))
    );
}

#[test]
fn claude_legacy_settings_and_opencode_jsonc_are_respected() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let claude = t.path().join("custom-claude");
    let opencode = t.path().join("opencode");
    fs::create_dir_all(&claude).unwrap();
    fs::create_dir_all(&opencode).unwrap();
    fs::write(claude.join("claude.json"), r#"{"keep":true}"#).unwrap();
    fs::write(opencode.join("opencode.jsonc"), r#"{"keep":true}"#).unwrap();
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[
                (AgentId::Claude, "alpha", WireProtocol::Anthropic),
                (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
            ]),
            installs: vec![
                AgentInstall {
                    agent: AgentId::Claude,
                    root: claude.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Opencode,
                    root: opencode.clone(),
                    detected: true,
                },
            ],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap_err();
    assert!(
        plan.to_string()
            .contains("missing verified synchronized source")
    );

    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[
                (AgentId::Claude, "alpha", WireProtocol::Anthropic),
                (AgentId::Opencode, "alpha", WireProtocol::OpenaiChat),
            ]),
            installs: vec![
                AgentInstall {
                    agent: AgentId::Claude,
                    root: claude.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Opencode,
                    root: opencode.clone(),
                    detected: true,
                },
            ],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    assert!(claude.join("claude.json").exists());
    assert!(!claude.join("settings.json").exists());
    assert!(claude.join(".claude.json").exists());
    assert!(opencode.join("opencode.jsonc").exists());
    assert!(!opencode.join("opencode.json").exists());
}

fn crash_test_plan(root: &Path) -> (Connector, gateway_connector_core::Plan) {
    let (manifest, provisioning) = contracts();
    let source = root.join("source-skill");
    let connector = std::env::var_os("GATEWAY_CONNECTOR_CRASH_CHILD_COORDINATOR")
        .map(|coordinator| Connector::with_coordinator(root.join("state"), coordinator))
        .unwrap_or_else(|| Connector::new(root.join("state")));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("crash-secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "beta", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: root.join("codex"),
                detected: true,
            }],
            synchronized_skills: BTreeMap::from([("deploy".into(), source)]),
        })
        .unwrap();
    (connector, plan)
}

fn initialize_crash_tree(root: &Path) -> Vec<u8> {
    let codex = root.join("codex");
    let source = root.join("source-skill");
    fs::create_dir_all(&codex).unwrap();
    fs::create_dir_all(&source).unwrap();
    let original = b"# exact original\nsandbox = \"workspace-write\"\n".to_vec();
    fs::write(codex.join("config.toml"), &original).unwrap();
    fs::write(source.join("SKILL.md"), "complete Skill tree").unwrap();
    original
}

#[test]
fn apply_rejects_a_replaced_agent_root_before_any_mutation() {
    let temp = tempdir().unwrap();
    let original = initialize_crash_tree(temp.path());
    let (connector, plan) = crash_test_plan(temp.path());
    let root = temp.path().join("codex");
    let displaced = temp.path().join("original-codex");
    fs::rename(&root, &displaced).unwrap();
    fs::create_dir(&root).unwrap();

    let error = connector.apply(&plan).unwrap_err().to_string();
    assert!(error.contains("replaced after preview"), "{error}");
    assert!(!root.join("config.toml").exists());
    assert_eq!(fs::read(displaced.join("config.toml")).unwrap(), original);
    assert!(!temp.path().join("state/skills").exists());
    assert!(transaction_artifacts(temp.path()).is_empty());
}

#[cfg(unix)]
#[test]
fn projection_rejects_a_symlinked_destination_ancestor() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    initialize_crash_tree(temp.path());
    let (connector, plan) = crash_test_plan(temp.path());
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, temp.path().join("codex/skills")).unwrap();

    let apply_error = connector.apply(&plan).unwrap_err().to_string();
    assert!(
        apply_error.contains("symlink or reparse") || apply_error.contains("changed after"),
        "{apply_error}"
    );
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
}

#[cfg(windows)]
#[test]
fn projection_rejects_a_junction_destination_ancestor() {
    let temp = tempdir().unwrap();
    initialize_crash_tree(temp.path());
    let (connector, plan) = crash_test_plan(temp.path());
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let link = temp.path().join("codex/skills");
    let output = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link.to_string_lossy().replace('/', "\\"))
        .arg(outside.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap();
    assert!(output.status.success(), "mklink /J failed: {output:?}");

    let error = connector.apply(&plan).unwrap_err().to_string();
    assert!(error.contains("symlink or reparse"), "{error}");
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
}

fn transaction_artifacts(root: &Path) -> Vec<PathBuf> {
    fn visit(path: &Path, output: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "active.json"
                || name.starts_with("bundle-")
                || (name.starts_with(".gateway-bundle-") && name.ends_with(".tmp"))
                || name.starts_with(".gateway-stage-")
                || name.starts_with(".gateway-displaced-")
                || (name.starts_with(".connector-") && name.ends_with(".tmp"))
            {
                output.push(path.clone());
            }
            if path.is_dir() {
                visit(&path, output);
            }
        }
    }
    let mut output = Vec::new();
    visit(root, &mut output);
    output
}

#[test]
fn projection_crash_child() {
    let Some(root) = std::env::var_os("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT") else {
        return;
    };
    if std::env::var_os("GATEWAY_CONNECTOR_CRASH_CHILD_DISCONNECT").is_some() {
        Connector::new(Path::new(&root).join("state"))
            .disconnect("platform-a", &Secret::new("crash-secret").unwrap())
            .unwrap();
        return;
    }
    let (connector, plan) = crash_test_plan(Path::new(&root));
    connector.apply(&plan).unwrap();
}

#[test]
fn subprocess_crashes_recover_every_projection_commit_boundary() {
    let mut prepared_boundaries = vec![
        "bundle-created".to_owned(),
        "manifest-temporary-durable".to_owned(),
        "manifest-in-temporary-bundle".to_owned(),
        "manifest-durable".to_owned(),
        "prepared-durable".to_owned(),
        "mutations-complete".to_owned(),
    ];
    for boundary in [
        "stage-durable",
        "destination-displaced",
        "destination-installed",
    ] {
        for occurrence in 1..=5 {
            prepared_boundaries.push(format!("{boundary}:{occurrence}"));
        }
    }
    for occurrence in 1..=4 {
        prepared_boundaries.push(format!("parent-created:{occurrence}"));
    }
    let mut committed_boundaries = vec![
        "committed-durable".to_owned(),
        "active-cleared".to_owned(),
        "bundle-cleared".to_owned(),
    ];
    for occurrence in 1..=5 {
        committed_boundaries.push(format!("cleanup-artifact:{occurrence}"));
    }

    for (failpoint, committed) in prepared_boundaries
        .iter()
        .map(|value| (value.as_str(), false))
        .chain(
            committed_boundaries
                .iter()
                .map(|value| (value.as_str(), true)),
        )
    {
        let temp = tempdir().unwrap();
        let original = initialize_crash_tree(temp.path());
        let status = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("projection_crash_child")
            .arg("--nocapture")
            .env("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT", temp.path())
            .env("GATEWAY_CONNECTOR_TEST_FAILPOINT", failpoint)
            .status()
            .unwrap();
        assert!(!status.success(), "failpoint did not abort: {failpoint}");

        let connector = Connector::new(temp.path().join("state"));
        connector
            .recover("platform-a", &Secret::new("crash-secret").unwrap())
            .unwrap_or_else(|error| panic!("recovery failed at {failpoint}: {error}"));

        let config = temp.path().join("codex/config.toml");
        let target_skill = temp.path().join("codex/skills/deploy");
        let ssot_skill = temp.path().join("state/skills/platform-a/deploy");
        let receipt = temp.path().join("state/receipts/platform-a.json");
        let ownership = temp
            .path()
            .join("state/projection-coordinator/ownership.json");
        if committed {
            assert_ne!(fs::read(&config).unwrap(), original, "{failpoint}");
            assert_eq!(
                fs::read(target_skill.join("SKILL.md")).unwrap(),
                b"complete Skill tree",
                "{failpoint}"
            );
            assert_eq!(
                fs::read(ssot_skill.join("SKILL.md")).unwrap(),
                b"complete Skill tree",
                "{failpoint}"
            );
            assert!(receipt.is_file(), "{failpoint}");
            let coordinator: Value =
                serde_json::from_slice(&fs::read(&ownership).unwrap()).unwrap();
            assert_eq!(
                coordinator["leases"].as_array().map(Vec::len),
                Some(1),
                "{failpoint}"
            );
        } else {
            assert_eq!(fs::read(&config).unwrap(), original, "{failpoint}");
            assert!(!target_skill.exists(), "{failpoint}");
            assert!(!temp.path().join("codex/skills").exists(), "{failpoint}");
            assert!(!ssot_skill.exists(), "{failpoint}");
            assert!(!temp.path().join("state/skills").exists(), "{failpoint}");
            assert!(!receipt.exists(), "{failpoint}");
            assert!(!ownership.exists(), "{failpoint}");
        }
        assert!(
            transaction_artifacts(temp.path()).is_empty(),
            "transaction artifacts remain at {failpoint}: {:?}",
            transaction_artifacts(temp.path())
        );
    }
}

#[test]
fn unpublished_bundle_recovery_cleans_only_unambiguous_preparation_artifacts() {
    for failpoint in ["bundle-created", "manifest-temporary-durable"] {
        let temp = tempdir().unwrap();
        let original = initialize_crash_tree(temp.path());
        let status = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("projection_crash_child")
            .arg("--nocapture")
            .env("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT", temp.path())
            .env("GATEWAY_CONNECTOR_TEST_FAILPOINT", failpoint)
            .status()
            .unwrap();
        assert!(!status.success(), "failpoint did not abort: {failpoint}");
        assert!(
            transaction_artifacts(temp.path()).iter().any(|path| path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".gateway-bundle-")),
            "expected unpublished bundle at {failpoint}"
        );

        Connector::new(temp.path().join("state"))
            .recover("platform-a", &Secret::new("crash-secret").unwrap())
            .unwrap();
        assert_eq!(
            fs::read(temp.path().join("codex/config.toml")).unwrap(),
            original
        );
        assert!(transaction_artifacts(temp.path()).is_empty());
    }
}

#[test]
fn ambiguous_or_tampered_unpublished_bundles_fail_closed() {
    for scenario in ["multiple", "tampered", "unexpected-sibling"] {
        let temp = tempdir().unwrap();
        let transactions = temp
            .path()
            .join("state/projection-coordinator/transactions");
        fs::create_dir_all(&transactions).unwrap();
        let first = transactions.join(format!(".gateway-bundle-{}.tmp", uuid::Uuid::new_v4()));
        fs::create_dir(&first).unwrap();
        if scenario == "multiple" {
            fs::create_dir(
                transactions.join(format!(".gateway-bundle-{}.tmp", uuid::Uuid::new_v4())),
            )
            .unwrap();
        } else if scenario == "tampered" {
            fs::write(first.join("manifest.enc"), b"not a journal").unwrap();
        } else {
            fs::write(
                first.join(format!(".connector-{}.tmp", uuid::Uuid::new_v4())),
                b"partial journal",
            )
            .unwrap();
            fs::write(first.join("unexpected"), b"preserve").unwrap();
        }

        let error = Connector::new(temp.path().join("state"))
            .recover("platform-a", &Secret::new("crash-secret").unwrap())
            .unwrap_err()
            .to_string();
        if scenario == "multiple" {
            assert!(error.contains("ambiguous"), "{error}");
        } else if scenario == "tampered" {
            assert!(error.contains("invalid stored temporary"), "{error}");
        } else {
            assert!(error.contains("unexpected or multiple"), "{error}");
            assert_eq!(fs::read(first.join("unexpected")).unwrap(), b"preserve");
        }
        assert!(first.exists(), "{scenario} artifact was silently removed");
        assert!(!transaction_artifacts(temp.path()).is_empty());
    }
}

#[cfg(unix)]
#[test]
fn unpublished_bundle_cleanup_rejects_a_symlinked_bundle() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let transactions = temp
        .path()
        .join("state/projection-coordinator/transactions");
    let outside = temp.path().join("outside");
    fs::create_dir_all(&transactions).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("preserve"), b"outside").unwrap();
    let bundle = transactions.join(format!(".gateway-bundle-{}.tmp", uuid::Uuid::new_v4()));
    symlink(&outside, &bundle).unwrap();

    let error = Connector::new(temp.path().join("state"))
        .recover("platform-a", &Secret::new("crash-secret").unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("not a plain directory"), "{error}");
    assert_eq!(fs::read(outside.join("preserve")).unwrap(), b"outside");
    assert!(
        fs::symlink_metadata(bundle)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[cfg(windows)]
#[test]
fn unpublished_bundle_cleanup_rejects_a_junction_bundle() {
    let temp = tempdir().unwrap();
    let transactions = temp
        .path()
        .join("state/projection-coordinator/transactions");
    let outside = temp.path().join("outside");
    fs::create_dir_all(&transactions).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("preserve"), b"outside").unwrap();
    let bundle = transactions.join(format!(".gateway-bundle-{}.tmp", uuid::Uuid::new_v4()));
    let output = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(bundle.to_string_lossy().replace('/', "\\"))
        .arg(outside.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap();
    assert!(output.status.success(), "mklink /J failed: {output:?}");

    let error = Connector::new(temp.path().join("state"))
        .recover("platform-a", &Secret::new("crash-secret").unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("not a plain directory"), "{error}");
    assert_eq!(fs::read(outside.join("preserve")).unwrap(), b"outside");
    assert!(bundle.exists());
}

#[test]
fn subprocess_disconnect_crashes_restore_receipt_lease_and_skill_tree() {
    let mut prepared_boundaries = vec![
        "prepared-durable".to_owned(),
        "mutations-complete".to_owned(),
    ];
    for boundary in [
        "stage-durable",
        "destination-displaced",
        "destination-installed",
    ] {
        for occurrence in 1..=5 {
            prepared_boundaries.push(format!("{boundary}:{occurrence}"));
        }
    }
    let mut committed_boundaries = vec![
        "committed-durable".to_owned(),
        "active-cleared".to_owned(),
        "bundle-cleared".to_owned(),
    ];
    for occurrence in 1..=5 {
        committed_boundaries.push(format!("cleanup-artifact:{occurrence}"));
    }

    for (failpoint, committed) in prepared_boundaries
        .iter()
        .map(|value| (value.as_str(), false))
        .chain(
            committed_boundaries
                .iter()
                .map(|value| (value.as_str(), true)),
        )
    {
        let temp = tempdir().unwrap();
        let original = initialize_crash_tree(temp.path());
        let (connector, plan) = crash_test_plan(temp.path());
        connector.apply(&plan).unwrap();
        let applied_config = fs::read(temp.path().join("codex/config.toml")).unwrap();
        let receipt_path = temp.path().join("state/receipts/platform-a.json");
        let ownership_path = temp
            .path()
            .join("state/projection-coordinator/ownership.json");
        let prior_receipt = fs::read(&receipt_path).unwrap();
        let prior_ownership = fs::read(&ownership_path).unwrap();

        let status = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("projection_crash_child")
            .arg("--nocapture")
            .env("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT", temp.path())
            .env("GATEWAY_CONNECTOR_CRASH_CHILD_DISCONNECT", "1")
            .env("GATEWAY_CONNECTOR_TEST_FAILPOINT", failpoint)
            .status()
            .unwrap();
        assert!(!status.success(), "failpoint did not abort: {failpoint}");
        connector
            .recover("platform-a", &Secret::new("crash-secret").unwrap())
            .unwrap_or_else(|error| panic!("disconnect recovery failed at {failpoint}: {error}"));

        let target_skill = temp.path().join("codex/skills/deploy/SKILL.md");
        let ssot_skill = temp.path().join("state/skills/platform-a/deploy/SKILL.md");
        if committed {
            assert_eq!(
                fs::read(temp.path().join("codex/config.toml")).unwrap(),
                original,
                "{failpoint}"
            );
            assert!(!target_skill.exists(), "{failpoint}");
            assert!(!ssot_skill.exists(), "{failpoint}");
            assert!(!receipt_path.exists(), "{failpoint}");
            let coordinator: Value =
                serde_json::from_slice(&fs::read(&ownership_path).unwrap()).unwrap();
            assert_eq!(
                coordinator["leases"].as_array().map(Vec::len),
                Some(0),
                "{failpoint}"
            );
        } else {
            assert_eq!(
                fs::read(temp.path().join("codex/config.toml")).unwrap(),
                applied_config,
                "{failpoint}"
            );
            assert_eq!(
                fs::read(&receipt_path).unwrap(),
                prior_receipt,
                "{failpoint}"
            );
            assert_eq!(
                fs::read(&ownership_path).unwrap(),
                prior_ownership,
                "{failpoint}"
            );
            assert_eq!(fs::read(&target_skill).unwrap(), b"complete Skill tree");
            assert_eq!(fs::read(&ssot_skill).unwrap(), b"complete Skill tree");
        }
        assert!(
            transaction_artifacts(temp.path()).is_empty(),
            "transaction artifacts remain at {failpoint}: {:?}",
            transaction_artifacts(temp.path())
        );
    }
}

#[test]
fn shared_coordinator_recovery_is_owned_by_the_interrupted_distribution() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("distribution-a");
    fs::create_dir(&root).unwrap();
    let original = initialize_crash_tree(&root);
    let coordinator = temp.path().join("shared-coordinator");
    let status = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("projection_crash_child")
        .arg("--nocapture")
        .env("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT", &root)
        .env("GATEWAY_CONNECTOR_CRASH_CHILD_COORDINATOR", &coordinator)
        .env(
            "GATEWAY_CONNECTOR_TEST_FAILPOINT",
            "destination-installed:1",
        )
        .status()
        .unwrap();
    assert!(!status.success());

    let other = Connector::with_coordinator(temp.path().join("state-b"), &coordinator);
    let error = other
        .recover("platform-b", &Secret::new("other-secret").unwrap())
        .unwrap_err()
        .to_string();
    assert!(error.contains("belongs to platform platform-a"), "{error}");
    assert!(!transaction_artifacts(temp.path()).is_empty());

    Connector::with_coordinator(root.join("state"), coordinator)
        .recover("platform-a", &Secret::new("crash-secret").unwrap())
        .unwrap();
    assert_eq!(fs::read(root.join("codex/config.toml")).unwrap(), original);
    assert!(!root.join("codex/skills").exists());
    assert!(transaction_artifacts(temp.path()).is_empty());
}

#[test]
fn missing_or_tampered_active_pointer_never_discards_the_authenticated_bundle() {
    for (failpoint, committed) in [
        ("destination-displaced:1", false),
        ("committed-durable", true),
    ] {
        let temp = tempdir().unwrap();
        let original = initialize_crash_tree(temp.path());
        let status = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("projection_crash_child")
            .arg("--nocapture")
            .env("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT", temp.path())
            .env("GATEWAY_CONNECTOR_TEST_FAILPOINT", failpoint)
            .status()
            .unwrap();
        assert!(!status.success(), "failpoint did not abort: {failpoint}");

        let active = temp
            .path()
            .join("state/projection-coordinator/transactions/active.json");
        let active_bytes = fs::read(&active).unwrap();
        fs::write(&active, b"{}").unwrap();
        let connector = Connector::new(temp.path().join("state"));
        assert!(
            connector
                .recover("platform-a", &Secret::new("crash-secret").unwrap())
                .is_err()
        );
        assert!(!transaction_artifacts(temp.path()).is_empty());

        fs::write(&active, active_bytes).unwrap();
        fs::remove_file(&active).unwrap();
        let transactions = active.parent().unwrap();
        let bundle = fs::read_dir(transactions)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("bundle-")
            })
            .unwrap();
        let manifest = bundle.join("manifest.enc");
        let manifest_bytes = fs::read(&manifest).unwrap();
        fs::write(&manifest, b"{}").unwrap();
        assert!(
            connector
                .recover("platform-a", &Secret::new("crash-secret").unwrap())
                .is_err()
        );
        assert!(bundle.exists());
        fs::remove_file(&manifest).unwrap();
        assert!(
            connector
                .recover("platform-a", &Secret::new("crash-secret").unwrap())
                .is_err()
        );
        assert!(bundle.exists());
        fs::write(&manifest, manifest_bytes).unwrap();

        let wrong_platform = connector
            .recover("platform-b", &Secret::new("crash-secret").unwrap())
            .unwrap_err()
            .to_string();
        assert!(wrong_platform.contains("belongs to platform platform-a"));
        assert!(
            connector
                .recover("platform-a", &Secret::new("wrong-secret").unwrap())
                .is_err()
        );
        assert!(!transaction_artifacts(temp.path()).is_empty());

        connector
            .recover("platform-a", &Secret::new("crash-secret").unwrap())
            .unwrap();
        let config = temp.path().join("codex/config.toml");
        if committed {
            assert_ne!(fs::read(config).unwrap(), original);
            assert!(temp.path().join("state/receipts/platform-a.json").is_file());
        } else {
            assert_eq!(fs::read(config).unwrap(), original);
            assert!(!temp.path().join("state/receipts/platform-a.json").exists());
        }
        assert!(transaction_artifacts(temp.path()).is_empty());
    }
}

#[test]
fn applying_one_agent_leaves_another_agents_files_untouched() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let claude = t.path().join("claude");
    let codex = t.path().join("codex");
    fs::create_dir_all(&claude).unwrap();
    fs::create_dir_all(&codex).unwrap();
    fs::write(claude.join("settings.json"), r#"{"theme":"dark"}"#).unwrap();
    let original_codex = "# keep\nunrelated = true\n";
    fs::write(codex.join("config.toml"), original_codex).unwrap();
    let skill = t.path().join("source-skill");
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "verified").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let installs = vec![
        AgentInstall {
            agent: AgentId::Claude,
            root: claude.clone(),
            detected: true,
        },
        AgentInstall {
            agent: AgentId::Codex,
            root: codex.clone(),
            detected: true,
        },
    ];
    let skills = BTreeMap::from([("deploy".into(), skill)]);
    let claude_plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Claude, "alpha", WireProtocol::Anthropic)]),
            installs: installs.clone(),
            synchronized_skills: skills.clone(),
        })
        .unwrap();
    connector.apply(&claude_plan).unwrap();
    let claude_after_first = fs::read(claude.join("settings.json")).unwrap();
    assert!(claude.join("skills/deploy/SKILL.md").exists());
    assert_eq!(
        fs::read_to_string(codex.join("config.toml")).unwrap(),
        original_codex
    );

    let codex_plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "beta", WireProtocol::OpenaiResponses)]),
            installs,
            synchronized_skills: skills,
        })
        .unwrap();
    connector.apply(&codex_plan).unwrap();
    assert_eq!(
        fs::read(claude.join("settings.json")).unwrap(),
        claude_after_first
    );
    let projected_codex = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(
        projected_codex.contains("model_provider") && projected_codex.contains("unrelated = true"),
        "{projected_codex}"
    );

    connector
        .disconnect("platform-a", &Secret::new("secret").unwrap())
        .unwrap();
    assert_eq!(
        fs::read_to_string(claude.join("settings.json")).unwrap(),
        r#"{"theme":"dark"}"#
    );
    assert_eq!(
        fs::read_to_string(codex.join("config.toml")).unwrap(),
        original_codex
    );
}

#[cfg(unix)]
#[test]
fn applying_codex_ignores_a_user_owned_claude_skill_symlink() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let claude = t.path().join("claude");
    let codex = t.path().join("codex");
    let user_skill = t.path().join("user-skill");
    fs::create_dir_all(&claude).unwrap();
    fs::create_dir_all(&codex).unwrap();
    fs::create_dir_all(&user_skill).unwrap();
    fs::create_dir_all(claude.join("skills")).unwrap();
    fs::write(user_skill.join("SKILL.md"), "mine").unwrap();
    std::os::unix::fs::symlink(&user_skill, claude.join("skills/deploy")).unwrap();
    let skill = t.path().join("source-skill");
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "verified").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![
                AgentInstall {
                    agent: AgentId::Claude,
                    root: claude.clone(),
                    detected: true,
                },
                AgentInstall {
                    agent: AgentId::Codex,
                    root: codex.clone(),
                    detected: true,
                },
            ],
            synchronized_skills: BTreeMap::from([("deploy".into(), skill)]),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    assert!(
        fs::read_to_string(codex.join("config.toml"))
            .unwrap()
            .contains("model_provider")
    );
    let metadata = fs::symlink_metadata(claude.join("skills/deploy")).unwrap();
    assert!(metadata.file_type().is_symlink());
    assert_eq!(
        fs::read_to_string(claude.join("skills/deploy/SKILL.md")).unwrap(),
        "mine"
    );
}

#[test]
fn applying_codex_updates_existing_catalog_mcp_and_keeps_other_servers() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    fs::write(
        codex.join("config.toml"),
        r#"notify = ["turn-ended"]

[mcp_servers.computer-use]
command = "SkyComputerUseClient"
enabled = false

[mcp_servers.docs]
type = "http"
url = "https://old.example/mcp/docs"

[mcp_servers.docs.http_headers]
Authorization = "Bearer leftover"
"#,
    )
    .unwrap();
    let connector = Connector::new(t.path().join("state"));
    let mut agents = selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]);
    agents
        .get_mut(&AgentId::Codex)
        .expect("codex selection")
        .disabled_skills
        .insert("deploy".into());
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: agents.clone(),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    let config = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(config.contains("notify"), "{config}");
    assert!(config.contains("computer-use"), "{config}");
    assert!(config.contains("SkyComputerUseClient"), "{config}");
    assert!(config.contains("https://gw.example/mcp/docs"), "{config}");
    assert!(!config.contains("https://old.example/mcp/docs"), "{config}");
    assert!(!config.contains("leftover"), "{config}");
    assert!(
        config.contains("type = \"http\"") && config.contains("Bearer secret"),
        "{config}"
    );
    let again_plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&again_plan).unwrap();
    let again = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(again.contains("https://gw.example/mcp/docs"), "{again}");
    assert!(again.contains("computer-use"), "{again}");
}

#[cfg(unix)]
#[test]
fn applying_codex_ignores_its_own_user_owned_skill_symlink() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let codex = t.path().join("codex");
    let user_skill = t.path().join("user-skill");
    fs::create_dir_all(&codex).unwrap();
    fs::create_dir_all(&user_skill).unwrap();
    fs::create_dir_all(codex.join("skills")).unwrap();
    fs::write(user_skill.join("SKILL.md"), "mine").unwrap();
    std::os::unix::fs::symlink(&user_skill, codex.join("skills/deploy")).unwrap();
    let skill = t.path().join("source-skill");
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "verified").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::from([("deploy".into(), skill)]),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    assert!(
        fs::read_to_string(codex.join("config.toml"))
            .unwrap()
            .contains("model_provider")
    );
    let metadata = fs::symlink_metadata(codex.join("skills/deploy")).unwrap();
    assert!(metadata.file_type().is_symlink());
    assert_eq!(
        fs::read_to_string(codex.join("skills/deploy/SKILL.md")).unwrap(),
        "mine"
    );
}

#[test]
fn applying_codex_overwrites_an_older_same_name_skill_directory() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let codex = t.path().join("codex");
    let target = codex.join("skills/deploy");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("SKILL.md"), "stale").unwrap();
    let source = t.path().join("source-skill");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("SKILL.md"), "verified").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::from([("deploy".into(), source)]),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    assert_eq!(
        fs::read_to_string(target.join("SKILL.md")).unwrap(),
        "verified"
    );
}

#[test]
fn applying_codex_never_changes_the_account_file() {
    let t = tempdir().unwrap();
    let (manifest, provisioning) = contracts();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    let original_auth = br#"{"auth_mode":"chatgpt","OPENAI_API_KEY":"","tokens":{"access_token":"chatgpt-access"}}"#;
    fs::write(codex.join("auth.json"), original_auth).unwrap();
    fs::write(codex.join("config.toml"), "sandbox = \"workspace-write\"\n").unwrap();
    let mut agents = selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]);
    agents
        .get_mut(&AgentId::Codex)
        .expect("codex selection")
        .disabled_skills
        .insert("deploy".into());
    let connector = Connector::new(t.path().join("state"));
    let install = AgentInstall {
        agent: AgentId::Codex,
        root: codex.clone(),
        detected: true,
    };
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![install],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    assert_eq!(fs::read(codex.join("auth.json")).unwrap(), original_auth);

    connector
        .disconnect("platform-a", &Secret::new("secret").unwrap())
        .unwrap();
    assert_eq!(
        fs::read(codex.join("auth.json")).unwrap(),
        original_auth,
        "the Codex account belongs to Codex, not Connect",
    );
}

#[test]
fn codex_model_catalog_uses_template_fields_and_always_includes_the_selected_model() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true,"responses_native":true,"supported_reasoning":["none","low","medium","high","xhigh","max"]},{"id":"beta","chat_capable":true,"responses_native":true,"supported_reasoning":["low","medium","high"]}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).unwrap();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    fs::write(codex.join("config.toml"), "model_context_window = 128000\n").unwrap();
    let connector = Connector::new(t.path().join("state"));
    let install = AgentInstall {
        agent: AgentId::Codex,
        root: codex.clone(),
        detected: true,
    };
    let mut agents = selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]);
    agents
        .get_mut(&AgentId::Codex)
        .unwrap()
        .codex
        .catalog_models
        .insert("beta".into());
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![install.clone()],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    let catalog: Value =
        serde_json::from_slice(&fs::read(codex.join("connector-model-catalog.json")).unwrap())
            .unwrap();
    let models = catalog["models"].as_array().expect("models array");
    assert_eq!(models.len(), 2);
    for model in models {
        assert!(model.get("base_instructions").is_some(), "{model}");
        assert!(
            model.get("supports_reasoning_summaries").is_some(),
            "{model}"
        );
        assert_eq!(model["context_window"], 128000);
        assert_eq!(model["shell_type"], "shell_command");
        assert!(model.get("apply_patch_tool_type").is_none());
        assert!(model.get("tools").is_none());
    }
    assert_eq!(models[0]["default_reasoning_level"], "medium");
    assert_eq!(
        models[0]["supported_reasoning_levels"]
            .as_array()
            .expect("alpha reasoning levels")
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["none", "low", "medium", "high", "xhigh", "max"]
    );
    assert_eq!(models[1]["default_reasoning_level"], "medium");
    assert_eq!(
        models[1]["supported_reasoning_levels"]
            .as_array()
            .expect("beta reasoning levels")
            .iter()
            .map(|level| level["effort"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["low", "medium", "high"]
    );
    let config = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(
        config.contains("model_catalog_json = \"connector-model-catalog.json\""),
        "{config}"
    );

    let selected_only = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents: selections(&[(AgentId::Codex, "alpha", WireProtocol::OpenaiResponses)]),
            installs: vec![install],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&selected_only).unwrap();
    let catalog: Value =
        serde_json::from_slice(&fs::read(codex.join("connector-model-catalog.json")).unwrap())
            .unwrap();
    let models = catalog["models"].as_array().expect("models array");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0]["slug"], "alpha");
    assert_eq!(
        models[0]["input_modalities"],
        serde_json::json!(["text", "image"])
    );
    let config = fs::read_to_string(codex.join("config.toml")).unwrap();
    assert!(
        config.contains("model_catalog_json = \"connector-model-catalog.json\""),
        "{config}"
    );
}

#[test]
fn codex_model_catalog_keeps_converted_chat_models() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"gpt-5.6-sol","chat_capable":true,"responses_native":true},{"id":"deepseek-v4-pro","chat_capable":true,"endpoints":["openai","openai-response"]}],"default_model":"gpt-5.6-sol","mcp_servers":[],"skills":[]}}"#).unwrap();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    let connector = Connector::new(t.path().join("state"));
    let mut agents = selections(&[(AgentId::Codex, "gpt-5.6-sol", WireProtocol::OpenaiResponses)]);
    agents
        .get_mut(&AgentId::Codex)
        .unwrap()
        .codex
        .catalog_models
        .insert("deepseek-v4-pro".into());
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    let catalog: Value =
        serde_json::from_slice(&fs::read(codex.join("connector-model-catalog.json")).unwrap())
            .unwrap();
    let slugs = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .map(|model| model["slug"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(slugs, vec!["deepseek-v4-pro", "gpt-5.6-sol"]);
}

#[test]
fn codex_model_catalog_keeps_native_grok_46() {
    let t = tempdir().unwrap();
    let (manifest, _) = contracts();
    let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"gpt-5.6-sol","chat_capable":true,"responses_native":true},{"id":"grok-4.6","chat_capable":true,"responses_native":true,"endpoints":["openai-response"]}],"default_model":"gpt-5.6-sol","mcp_servers":[],"skills":[]}}"#).unwrap();
    let codex = t.path().join("codex");
    fs::create_dir_all(&codex).unwrap();
    let connector = Connector::new(t.path().join("state"));
    let mut agents = selections(&[(AgentId::Codex, "gpt-5.6-sol", WireProtocol::OpenaiResponses)]);
    agents
        .get_mut(&AgentId::Codex)
        .unwrap()
        .codex
        .catalog_models
        .insert("grok-4.6".into());
    let plan = connector
        .plan(ApplyInput {
            manifest: &manifest,
            provisioning: &provisioning,
            bearer: &Secret::new("secret").unwrap(),
            agents,
            installs: vec![AgentInstall {
                agent: AgentId::Codex,
                root: codex.clone(),
                detected: true,
            }],
            synchronized_skills: BTreeMap::new(),
        })
        .unwrap();
    connector.apply(&plan).unwrap();
    let catalog: Value =
        serde_json::from_slice(&fs::read(codex.join("connector-model-catalog.json")).unwrap())
            .unwrap();
    let slugs = catalog["models"]
        .as_array()
        .expect("models")
        .iter()
        .map(|model| model["slug"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(slugs, vec!["gpt-5.6-sol", "grok-4.6"]);
}
