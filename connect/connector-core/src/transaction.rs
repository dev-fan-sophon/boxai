use crate::{
    AgentId, AgentInstall, CodexSettings, ConnectionManifest, Error, Model, Provisioning, Result,
    Secret, WireProtocol, io,
};
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, AeadCore, OsRng},
};
use fs2::FileExt;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::io::Write;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
use toml_edit::{DocumentMut, Item, Table, value};

const SKILL_OWNER_FILE: &str = ".gateway-connector-owner";
const CODEX_MODEL_CATALOG_FILE: &str = "connector-model-catalog.json";
const BUDDY_MODEL_CATALOG_FILE: &str = "models.json";
const GROK_DEFAULT_CONTEXT_WINDOW: i64 = 500_000;
const MAX_JOURNAL_BYTES: u64 = 16 * 1024 * 1024;
const TEMPORARY_BUNDLE_PREFIX: &str = ".gateway-bundle-";
const TEMPORARY_BUNDLE_SUFFIX: &str = ".tmp";

#[derive(Debug)]
pub struct ApplyInput<'a> {
    pub manifest: &'a ConnectionManifest,
    pub provisioning: &'a Provisioning,
    pub bearer: &'a Secret,
    pub agents: BTreeMap<AgentId, EffectiveAgentSelection>,
    pub installs: Vec<AgentInstall>,
    pub synchronized_skills: BTreeMap<String, PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveAgentSelection {
    pub model: String,
    pub protocol: WireProtocol,
    pub disabled_mcp: BTreeSet<String>,
    pub disabled_skills: BTreeSet<String>,
    pub codex: CodexSettings,
    pub image_direct: bool,
}

impl EffectiveAgentSelection {
    pub fn new(model: impl Into<String>, protocol: WireProtocol) -> Self {
        Self {
            model: model.into(),
            protocol,
            disabled_mcp: BTreeSet::new(),
            disabled_skills: BTreeSet::new(),
            codex: CodexSettings::default(),
            image_direct: false,
        }
    }
}

fn catalog_skill_ids(input: &ApplyInput<'_>) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for skill in &input.provisioning.skills {
        ids.insert(skill.id.clone());
    }
    ids.extend(input.synchronized_skills.keys().cloned());
    ids
}

fn projection_scope(
    requested: &BTreeMap<AgentId, EffectiveAgentSelection>,
    projected: &BTreeSet<AgentId>,
) -> Result<BTreeSet<AgentId>> {
    let scope = requested.keys().copied().collect::<BTreeSet<_>>();
    if !scope.is_subset(projected) {
        return Err(Error::Validation(
            "effective Agent selections include Agents that are not detected or not supported"
                .into(),
        ));
    }
    if scope.is_empty() && !projected.is_empty() {
        return Err(Error::Validation(
            "effective Agent selections do not include any detected supported Agent".into(),
        ));
    }
    Ok(scope)
}

fn lease_in_scope(lease: &ProjectionLease, scope: &BTreeSet<AgentId>) -> bool {
    AgentId::from_id(&lease.agent).is_some_and(|agent| scope.contains(&agent))
}

fn path_in_scope(path: &Path, scope: &BTreeSet<AgentId>, leases: &[ProjectionLease]) -> bool {
    leases
        .iter()
        .any(|lease| lease_in_scope(lease, scope) && lease_boundary_for_path(lease, path).is_some())
}

fn is_ssot_skill(state_dir: &Path, path: &Path) -> bool {
    path.starts_with(state_dir.join("skills"))
}

fn skill_id_from_path(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeKind {
    Create,
    Update,
    Remove,
    ProjectSkill,
}
#[derive(Debug, Clone)]
pub struct Change {
    pub path: PathBuf,
    pub kind: ChangeKind,
    pub managed_entries: Vec<String>,
}
#[derive(Clone)]
struct Op {
    path: PathBuf,
    guard: RootGuard,
    kind: OpKind,
}
#[derive(Clone)]
enum OpKind {
    File { bytes: Vec<u8> },
    Dir { source: PathBuf, marker: Vec<u8> },
    Remove,
}
impl Op {
    fn file(root: &Path, path: PathBuf, bytes: Vec<u8>) -> Result<Self> {
        Ok(Self {
            guard: RootGuard::capture(root, &path)?,
            path,
            kind: OpKind::File { bytes },
        })
    }

    fn dir(root: &Path, path: PathBuf, source: PathBuf, marker: Vec<u8>) -> Result<Self> {
        Ok(Self {
            guard: RootGuard::capture(root, &path)?,
            path,
            kind: OpKind::Dir { source, marker },
        })
    }

    fn remove(root: &Path, path: PathBuf) -> Result<Self> {
        Ok(Self {
            guard: RootGuard::capture(root, &path)?,
            path,
            kind: OpKind::Remove,
        })
    }
}
type FileProjection = (PathBuf, Vec<u8>, Vec<String>);
struct JsonProjection {
    value: Value,
    source: Option<String>,
}
impl std::ops::Deref for JsonProjection {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.value
    }
}
impl std::ops::DerefMut for JsonProjection {
    fn deref_mut(&mut self) -> &mut Value {
        &mut self.value
    }
}
#[derive(Clone)]
pub struct Plan {
    pub platform_id: String,
    pub changes: Vec<Change>,
    ops: Vec<Op>,
    receipt: Receipt,
    key: [u8; 32],
    expected_files: BTreeMap<PathBuf, Option<String>>,
    expected_skills: BTreeMap<PathBuf, Option<Vec<u8>>>,
    expected_receipt: Option<String>,
}
impl std::fmt::Debug for Plan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Plan")
            .field("platform_id", &self.platform_id)
            .field("changes", &self.changes)
            .finish()
    }
}
impl Plan {
    pub fn credential_matches(&self, bearer: &Secret) -> Result<bool> {
        Ok(self.key == receipt_key(bearer)?)
    }
}
#[derive(Debug)]
pub struct Verification {
    pub ok: bool,
    pub mismatches: Vec<PathBuf>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
    platform_id: String,
    files: Vec<FileReceipt>,
    skills: Vec<SkillReceipt>,
    #[serde(default)]
    leases: Vec<ProjectionLease>,
}
#[derive(Clone, Serialize, Deserialize)]
struct FileReceipt {
    path: PathBuf,
    original: Option<Vec<u8>>,
    applied: Vec<u8>,
}
#[derive(Clone, Serialize, Deserialize)]
struct SkillReceipt {
    path: PathBuf,
    applied_hash: Vec<u8>,
    marker: Vec<u8>,
    kind: SkillKind,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ProjectionLease {
    platform_id: String,
    agent: String,
    root: PathBuf,
}
#[derive(Default, Serialize, Deserialize)]
struct ProjectionCoordinator {
    leases: Vec<ProjectionLease>,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
enum SkillKind {
    Directory,
}
#[derive(Serialize, Deserialize)]
struct SealedReceipt {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}
#[derive(Debug)]
pub struct Connector {
    state_dir: PathBuf,
    coordinator_dir: PathBuf,
}
impl Connector {
    pub fn new(state_dir: impl Into<PathBuf>) -> Self {
        let state_dir = state_dir.into();
        let coordinator_dir = state_dir.join("projection-coordinator");
        Self {
            state_dir,
            coordinator_dir,
        }
    }
    pub fn with_coordinator(
        state_dir: impl Into<PathBuf>,
        coordinator_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            state_dir: state_dir.into(),
            coordinator_dir: coordinator_dir.into(),
        }
    }
    pub fn plan(&self, input: ApplyInput<'_>) -> Result<Plan> {
        let _lock = self.lock(&input.manifest.platform.id)?;
        ensure_plain_dir(&self.state_dir)?;
        self.recover_locked(&input.manifest.platform.id, &receipt_key(input.bearer)?)?;
        input.manifest.validate()?;
        input.provisioning.validate_for(input.manifest)?;
        let catalog_skill_ids = catalog_skill_ids(&input);
        if !input
            .provisioning
            .models
            .iter()
            .any(|model| model.chat_capable)
        {
            return Err(Error::Validation(
                "cannot project Agent configuration: account has no chat-capable model".into(),
            ));
        }
        let mut installs = input.installs;
        let projected_agents = installs
            .iter()
            .filter(|install| install.detected)
            .map(|install| install.agent)
            .collect::<BTreeSet<_>>();
        let scope = projection_scope(&input.agents, &projected_agents)?;
        for install in installs
            .iter_mut()
            .filter(|install| install.detected && scope.contains(&install.agent))
        {
            install.root = fs::canonicalize(&install.root).map_err(|error| {
                Error::Validation(format!(
                    "could not canonicalize detected {} root {}: {error}",
                    install.agent.as_str(),
                    install.root.display()
                ))
            })?;
        }
        let platform = &input.manifest.platform.id;
        let provider = platform.clone();
        let mut ops = Vec::new();
        let mut changes = Vec::new();
        let mut projected_paths = BTreeSet::new();
        let key = receipt_key(input.bearer)?;
        let receipt_path = self.receipt_path(platform);
        RootGuard::capture(&self.state_dir, &receipt_path)?;
        let expected_receipt = snapshot_file(&receipt_path)?;
        let old_receipt = self.load_receipt(platform, &key)?;
        if let Some(receipt) = &old_receipt {
            validate_receipt_paths(&self.state_dir, receipt)?;
        }
        let mut projection_bases = BTreeMap::new();
        let mut expected_files = BTreeMap::new();
        let mut expected_skills = BTreeMap::new();
        let ownership_path = self.ownership_path();
        let ownership_snapshot = snapshot_file(&ownership_path)?;
        let mut coordinator = self.load_coordinator()?;
        if let Some(receipt) = &old_receipt {
            for lease in &receipt.leases {
                if !coordinator.leases.contains(lease) {
                    return Err(Error::Validation(format!(
                        "shared Agent ownership changed for {} at {}; disconnect or repair the owning Connector first",
                        lease.agent,
                        lease.root.display()
                    )));
                }
            }
        }
        let mut leases = old_receipt
            .as_ref()
            .map(|receipt| {
                receipt
                    .leases
                    .iter()
                    .filter(|lease| !lease_in_scope(lease, &scope))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let scoped_leases = installs
            .iter()
            .filter(|install| install.detected && scope.contains(&install.agent))
            .map(|install| ProjectionLease {
                platform_id: platform.clone(),
                agent: install.agent.as_str().into(),
                root: install.root.clone(),
            })
            .collect::<Vec<_>>();
        for lease in &scoped_leases {
            if let Some(owner) = coordinator.leases.iter().find(|existing| {
                lease_key(existing) == lease_key(lease) && existing.platform_id.as_str() != platform
            }) {
                return Err(Error::Validation(format!(
                    "{} at {} is already managed by platform {}; disconnect it there before applying {}",
                    lease.agent,
                    lease.root.display(),
                    owner.platform_id,
                    platform
                )));
            }
        }
        leases.extend(scoped_leases);
        leases.sort_by_key(|lease| (lease_key(lease), lease.platform_id.clone()));
        coordinator
            .leases
            .retain(|lease| lease.platform_id.as_str() != platform);
        coordinator.leases.extend(leases.iter().cloned());
        coordinator
            .leases
            .sort_by_key(|lease| (lease_key(lease), lease.platform_id.clone()));
        expected_files.insert(ownership_path.clone(), ownership_snapshot);
        let projected_skill_ids = catalog_skill_ids
            .iter()
            .filter(|id| {
                input
                    .agents
                    .values()
                    .any(|selection| !selection.disabled_skills.contains(*id))
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        if let Some(receipt) = &old_receipt {
            for file in &receipt.files {
                if !path_in_scope(&file.path, &scope, &receipt.leases) {
                    continue;
                }
                expected_files.insert(file.path.clone(), snapshot_file(&file.path)?);
                match reconciled_file(file)? {
                    Some(bytes) => {
                        projection_bases.insert(file.path.clone(), bytes);
                    }
                    None if exists(&file.path) => {
                        // A managed-only file still needs an explicit empty
                        // base; otherwise projection would read its stale
                        // managed contents back from disk.
                        projection_bases.insert(file.path.clone(), Vec::new());
                    }
                    None => {}
                }
            }
            for skill in &receipt.skills {
                let ssot = is_ssot_skill(&self.state_dir, &skill.path);
                let in_scope = path_in_scope(&skill.path, &scope, &receipt.leases);
                if ssot {
                    let Some(id) = skill_id_from_path(&skill.path) else {
                        continue;
                    };
                    if !projected_skill_ids.contains(&id) {
                        continue;
                    }
                } else if !in_scope {
                    continue;
                }
                if is_symlink(&skill.path) {
                    // A user-owned symlink (often left by the previous Kit)
                    // is not a managed directory. Leave it alone.
                    continue;
                }
                if exists(&skill.path) && !skill_matches(skill) {
                    return Err(Error::Validation(format!(
                        "managed Skill has local changes: {}",
                        skill.path.display()
                    )));
                }
                expected_skills.insert(skill.path.clone(), snapshot_skill(&skill.path)?);
            }
        }
        let mut files = Vec::new();
        let mut skills = Vec::new();
        // Stage each platform/skill source once, independently of Agent count.
        for skill_id in catalog_skill_ids
            .iter()
            .filter(|id| projected_skill_ids.contains(*id))
        {
            let source = input.synchronized_skills.get(skill_id).ok_or_else(|| {
                Error::Validation(format!(
                    "missing verified synchronized source for {skill_id}"
                ))
            })?;
            if !source.is_dir() {
                return Err(Error::Validation(format!(
                    "skill source {} is not a directory",
                    source.display()
                )));
            }
            if source.join(SKILL_OWNER_FILE).exists() {
                return Err(Error::Validation(format!(
                    "synchronized Skill contains reserved ownership marker: {}",
                    source.display()
                )));
            }
            let source_hash = hash_skill_content(source)?;
            expected_skills.insert(source.clone(), Some(source_hash.clone()));
            let ssot = self.state_dir.join("skills").join(platform).join(skill_id);
            claim_path(&mut projected_paths, &ssot)?;
            changes.push(Change {
                path: ssot.clone(),
                kind: ChangeKind::ProjectSkill,
                managed_entries: vec![skill_id.clone()],
            });
            skills.push(SkillReceipt {
                path: ssot.clone(),
                applied_hash: source_hash,
                marker: ownership_marker(),
                kind: SkillKind::Directory,
            });
            let marker = skills
                .last()
                .expect("staged Skill receipt exists")
                .marker
                .clone();
            ops.push(Op::dir(&self.state_dir, ssot, source.clone(), marker)?);
        }
        for install in installs.iter().filter(|x| x.detected) {
            if !scope.contains(&install.agent) {
                continue;
            }
            let boundary = install_boundary(install)?;
            validate_agent_destinations(install, boundary)?;
            let selection = &input.agents[&install.agent];
            let model = &selection.model;
            if !install
                .agent
                .supported_wire_protocols()
                .contains(&selection.protocol)
            {
                return Err(Error::Validation(format!(
                    "{} does not support the {} protocol",
                    install.agent.display_name(),
                    selection.protocol
                )));
            }
            if !input
                .manifest
                .gateway
                .protocols
                .contains(&selection.protocol)
            {
                return Err(Error::Validation(format!(
                    "Gateway does not advertise {} selected for {}",
                    selection.protocol,
                    install.agent.display_name()
                )));
            }
            if !input
                .provisioning
                .models
                .iter()
                .any(|m| &m.id == model && m.chat_capable)
            {
                return Err(Error::Validation(format!(
                    "selected model {model} is not a chat-capable catalog model"
                )));
            }
            let projections = project(
                install,
                input.manifest,
                input.provisioning,
                input.bearer,
                selection,
                &provider,
                &projection_bases,
            )?;
            for (path, bytes, entries) in projections {
                claim_path(&mut projected_paths, &path)?;
                if is_symlink(&path) {
                    return Err(Error::Validation(format!(
                        "configuration symlinks are not supported: {}",
                        path.display()
                    )));
                }
                expected_files
                    .entry(path.clone())
                    .or_insert(snapshot_file(&path)?);
                let previous = old_receipt
                    .as_ref()
                    .and_then(|receipt| receipt.files.iter().find(|file| file.path == path));
                let current = fs::read(&path).ok();
                if current.as_deref() != Some(bytes.as_slice())
                    && previous
                        .is_none_or(|file| current.as_deref() != Some(file.applied.as_slice()))
                    && let Some(current) = current.as_deref()
                {
                    let (backup, op) = backup_op(boundary, &path, current)?;
                    if let Some(op) = op {
                        expected_files.insert(backup, None);
                        ops.push(op);
                    }
                }
                let kind = if path.exists() {
                    ChangeKind::Update
                } else {
                    ChangeKind::Create
                };
                changes.push(Change {
                    path: path.clone(),
                    kind,
                    managed_entries: entries,
                });
                let original = projection_bases
                    .get(&path)
                    .cloned()
                    .or_else(|| previous.and_then(|file| file.original.clone()))
                    .or(current);
                files.push(FileReceipt {
                    path: path.clone(),
                    original,
                    applied: bytes.clone(),
                });
                ops.push(Op::file(boundary, path, bytes)?);
            }
            for skill_id in catalog_skill_ids
                .iter()
                .filter(|id| !input.agents[&install.agent].disabled_skills.contains(*id))
            {
                let ssot = self.state_dir.join("skills").join(platform).join(skill_id);
                let target = install.root.join("skills").join(skill_id);
                let previous = old_receipt
                    .as_ref()
                    .and_then(|receipt| receipt.skills.iter().find(|owned| owned.path == target));
                if is_symlink(&target) {
                    // Leave a user-owned Skill symlink (Claude, Codex, or the
                    // previous Kit installer) alone rather than writing
                    // through it or failing this Agent's Apply.
                    continue;
                }
                if exists(&target) {
                    match previous {
                        Some(previous) if skill_matches(previous) => {}
                        Some(_) => {
                            return Err(Error::Validation(format!(
                                "managed Skill has local changes: {}",
                                target.display()
                            )));
                        }
                        // Applying an explicitly enabled same-name Skill owns
                        // that destination. Replace an older plain directory
                        // so bundled and synchronized Skill updates are not
                        // silently shadowed forever.
                        None => {}
                    }
                }
                if let Err(error) = RootGuard::capture(boundary, &target) {
                    if previous.is_none() {
                        continue;
                    }
                    return Err(error);
                }
                claim_path(&mut projected_paths, &target)?;
                expected_skills
                    .entry(target.clone())
                    .or_insert(snapshot_skill(&target)?);
                changes.push(Change {
                    path: target.clone(),
                    kind: ChangeKind::ProjectSkill,
                    managed_entries: vec![skill_id.clone()],
                });
                let applied_hash = skills
                    .iter()
                    .find(|receipt| receipt.path == ssot)
                    .expect("staged Skill receipt exists")
                    .applied_hash
                    .clone();
                skills.push(SkillReceipt {
                    path: target.clone(),
                    applied_hash,
                    marker: ownership_marker(),
                    kind: SkillKind::Directory,
                });
                let marker = skills
                    .last()
                    .expect("target Skill receipt exists")
                    .marker
                    .clone();
                ops.push(Op::dir(
                    boundary,
                    target,
                    // Capture every target from the immutable synchronized
                    // input.  Preparing a transaction must not depend on an
                    // earlier operation having populated the SSOT directory.
                    input
                        .synchronized_skills
                        .get(skill_id)
                        .expect("validated synchronized Skill")
                        .clone(),
                    marker,
                )?);
            }
        }
        if let Some(old) = &old_receipt {
            for file in &old.files {
                if files.iter().any(|new| new.path == file.path) {
                    continue;
                }
                if path_in_scope(&file.path, &scope, &old.leases) {
                    continue;
                }
                files.push(file.clone());
            }
            for skill in &old.skills {
                if skills.iter().any(|new| new.path == skill.path) {
                    continue;
                }
                if is_ssot_skill(&self.state_dir, &skill.path) {
                    continue;
                }
                if path_in_scope(&skill.path, &scope, &old.leases) {
                    continue;
                }
                skills.push(skill.clone());
            }
            for skill in &old.skills {
                if !is_ssot_skill(&self.state_dir, &skill.path) {
                    continue;
                }
                if skills.iter().any(|new| new.path == skill.path) {
                    continue;
                }
                let Some(id) = skill_id_from_path(&skill.path) else {
                    continue;
                };
                let still_needed = skills.iter().any(|owned| {
                    !is_ssot_skill(&self.state_dir, &owned.path)
                        && skill_id_from_path(&owned.path).as_deref() == Some(id.as_str())
                });
                if still_needed {
                    skills.push(skill.clone());
                }
            }
        }
        let receipt = Receipt {
            platform_id: platform.clone(),
            files,
            skills,
            leases,
        };
        let mut cleanup_ops = Vec::new();
        if let Some(old) = &old_receipt {
            for file in &old.files {
                if !receipt.files.iter().any(|new| new.path == file.path) {
                    let root = receipt_root(&self.state_dir, old, &file.path)?;
                    match reconciled_file(file)? {
                        Some(bytes)
                            if fs::read(&file.path).ok().as_deref() != Some(bytes.as_slice()) =>
                        {
                            if let Ok(current) = fs::read(&file.path)
                                && current != file.applied
                            {
                                let (backup, op) = backup_op(root, &file.path, &current)?;
                                if let Some(op) = op {
                                    expected_files.insert(backup, None);
                                    cleanup_ops.push(op);
                                }
                            }
                            changes.push(Change {
                                path: file.path.clone(),
                                kind: ChangeKind::Update,
                                managed_entries: vec!["restore prior configuration".into()],
                            });
                            cleanup_ops.push(Op::file(root, file.path.clone(), bytes)?);
                        }
                        Some(_) => {}
                        None if exists(&file.path) => {
                            let current =
                                fs::read(&file.path).map_err(|error| io(&file.path, error))?;
                            if current != file.applied {
                                let (backup, op) = backup_op(root, &file.path, &current)?;
                                if let Some(op) = op {
                                    expected_files.insert(backup, None);
                                    cleanup_ops.push(op);
                                }
                            }
                            changes.push(Change {
                                path: file.path.clone(),
                                kind: ChangeKind::Remove,
                                managed_entries: vec!["remove managed configuration".into()],
                            });
                            cleanup_ops.push(Op::remove(root, file.path.clone())?);
                        }
                        None => {}
                    }
                }
            }
            for skill in &old.skills {
                if !receipt.skills.iter().any(|new| new.path == skill.path) && exists(&skill.path) {
                    changes.push(Change {
                        path: skill.path.clone(),
                        kind: ChangeKind::Remove,
                        managed_entries: vec!["remove managed Skill".into()],
                    });
                    cleanup_ops.push(Op::remove(
                        receipt_root(&self.state_dir, old, &skill.path)?,
                        skill.path.clone(),
                    )?);
                }
            }
        }
        cleanup_ops.extend(ops);
        cleanup_ops.push(Op::file(
            &self.coordinator_dir,
            ownership_path,
            serde_json::to_vec_pretty(&coordinator)
                .map_err(|error| Error::Transaction(error.to_string()))?,
        )?);
        Ok(Plan {
            platform_id: platform.clone(),
            changes,
            ops: cleanup_ops,
            receipt,
            key,
            expected_files,
            expected_skills,
            expected_receipt,
        })
    }
    pub fn apply(&self, plan: &Plan) -> Result<()> {
        let _lock = self.lock(&plan.platform_id)?;
        ensure_plain_dir(&self.state_dir)?;
        self.recover_locked(&plan.platform_id, &plan.key)?;
        for op in &plan.ops {
            op.guard.validate(&op.path)?;
        }
        let receipt_path = self.receipt_path(&plan.platform_id);
        RootGuard::capture(&self.state_dir, &receipt_path)?;
        if snapshot_file(&receipt_path)? != plan.expected_receipt {
            return Err(Error::Validation(
                "Connector state changed after this plan was created; preview again".into(),
            ));
        }
        for (path, expected) in &plan.expected_files {
            if &snapshot_file(path)? != expected {
                return Err(Error::Validation(format!(
                    "configuration changed after this plan was created: {}",
                    path.display()
                )));
            }
        }
        for (path, expected) in &plan.expected_skills {
            if &snapshot_skill(path)? != expected {
                return Err(Error::Validation(format!(
                    "Skill changed after this plan was created: {}",
                    path.display()
                )));
            }
        }
        let mut all_ops = plan.ops.clone();
        let receipt_bytes = seal_receipt(&plan.receipt, &plan.key)?;
        all_ops.push(Op::file(&self.state_dir, receipt_path, receipt_bytes)?);
        execute_ops(&self.coordinator_dir, &plan.platform_id, &plan.key, all_ops)
    }
    pub fn verify(&self, plan: &Plan) -> Result<Verification> {
        let _lock = self.lock(&plan.platform_id)?;
        self.recover_locked(&plan.platform_id, &plan.key)?;
        let mut mismatches = Vec::new();
        for op in &plan.ops {
            op.guard.validate(&op.path)?;
            match &op.kind {
                OpKind::File { bytes } => {
                    if fs::read(&op.path).ok().as_deref() != Some(bytes) {
                        mismatches.push(op.path.clone())
                    }
                }
                OpKind::Dir { source, marker } => {
                    let content_matches =
                        match (hash_skill_content(&op.path), hash_skill_content(source)) {
                            (Ok(applied), Ok(expected)) => applied == expected,
                            _ => false,
                        };
                    if fs::read(op.path.join(SKILL_OWNER_FILE)).ok().as_deref()
                        != Some(marker.as_slice())
                        || !content_matches
                    {
                        mismatches.push(op.path.clone())
                    }
                }
                OpKind::Remove => {
                    if exists(&op.path) {
                        mismatches.push(op.path.clone())
                    }
                }
            }
        }
        Ok(Verification {
            ok: mismatches.is_empty(),
            mismatches,
        })
    }
    pub fn disconnect(&self, platform: &str, bearer: &Secret) -> Result<()> {
        let _lock = self.lock(platform)?;
        ensure_plain_dir(&self.state_dir)?;
        let key = receipt_key(bearer)?;
        self.recover_locked(platform, &key)?;
        let rp = self.receipt_path(platform);
        RootGuard::capture(&self.state_dir, &rp)?;
        if !rp.exists() {
            return Ok(());
        }
        let receipt = open_receipt(&fs::read(&rp).map_err(|e| io(&rp, e))?, &key)?;
        if receipt.platform_id != platform {
            return Err(Error::Transaction(
                "receipt does not belong to the requested platform".into(),
            ));
        }
        validate_receipt_paths(&self.state_dir, &receipt)?;
        let mut ops = Vec::new();
        for file in &receipt.files {
            let root = receipt_root(&self.state_dir, &receipt, &file.path)?;
            match reconciled_file(file)? {
                Some(bytes) if fs::read(&file.path).ok().as_deref() != Some(bytes.as_slice()) => {
                    if let Ok(current) = fs::read(&file.path)
                        && current != file.applied
                        && let (_, Some(backup)) = backup_op(root, &file.path, &current)?
                    {
                        ops.push(backup);
                    }
                    ops.push(Op::file(root, file.path.clone(), bytes)?);
                }
                Some(_) => {}
                None if exists(&file.path) => {
                    let current = fs::read(&file.path).map_err(|error| io(&file.path, error))?;
                    if current != file.applied
                        && let (_, Some(backup)) = backup_op(root, &file.path, &current)?
                    {
                        ops.push(backup);
                    }
                    ops.push(Op::remove(root, file.path.clone())?);
                }
                None => {}
            }
        }
        let mut skills = receipt
            .skills
            .iter()
            .filter(|skill| exists(&skill.path) && !is_symlink(&skill.path))
            .collect::<Vec<_>>();
        if let Some(skill) = skills.iter().find(|skill| !skill_matches(skill)) {
            return Err(Error::Validation(format!(
                "managed Skill has local changes: {}",
                skill.path.display()
            )));
        }
        skills.sort_by_key(|skill| !is_symlink(&skill.path));
        for skill in skills {
            ops.push(Op::remove(
                receipt_root(&self.state_dir, &receipt, &skill.path)?,
                skill.path.clone(),
            )?);
        }
        let mut coordinator = self.load_coordinator()?;
        for lease in &receipt.leases {
            if !coordinator.leases.contains(lease) {
                return Err(Error::Validation(format!(
                    "shared Agent ownership changed for {} at {}; disconnect or repair the owning Connector first",
                    lease.agent,
                    lease.root.display()
                )));
            }
        }
        coordinator
            .leases
            .retain(|lease| !receipt.leases.iter().any(|owned| owned == lease));
        ops.push(Op::file(
            &self.coordinator_dir,
            self.ownership_path(),
            serde_json::to_vec_pretty(&coordinator)
                .map_err(|error| Error::Transaction(error.to_string()))?,
        )?);
        // Removing the authenticated receipt is the final transactional step.
        // Any earlier failure rolls every projection back and leaves ownership
        // recoverable with the credential still held by the caller.
        ops.push(Op::remove(&self.state_dir, rp)?);
        execute_ops(&self.coordinator_dir, platform, &key, ops)
    }
    pub fn managed_agents(&self, platform: &str, bearer: &Secret) -> Result<BTreeSet<AgentId>> {
        // Fresh installs have no prior apply; create the connector state root so
        // ownership queries can report "not managed" instead of failing closed.
        ensure_plain_dir(&self.state_dir)?;
        self.recover(platform, bearer)?;
        let Some(receipt) = self.load_receipt(platform, &receipt_key(bearer)?)? else {
            return Ok(BTreeSet::new());
        };
        Ok(receipt
            .leases
            .iter()
            .filter_map(|lease| AgentId::from_id(&lease.agent))
            .collect())
    }
    /// Recovers or finishes the single global projection transaction.
    pub fn recover(&self, platform: &str, bearer: &Secret) -> Result<()> {
        let _lock = self.lock(platform)?;
        self.recover_locked(platform, &receipt_key(bearer)?)
    }

    fn recover_locked(&self, platform: &str, key: &[u8; 32]) -> Result<()> {
        recover_transaction(&self.coordinator_dir, platform, key)
    }
    fn lock(&self, _platform: &str) -> Result<fs::File> {
        ensure_plain_dir(&self.coordinator_dir)?;
        let locks = self.coordinator_dir.join("locks");
        ensure_plain_dir(&locks)?;
        // Agent config paths are global even when receipt/credential state is
        // platform-partitioned, so all platforms share one process lock.
        let path = locks.join("connector.lock");
        reject_absolute_reparse_components(&path)?;
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(
                windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT,
            );
        }
        let file = options.open(&path).map_err(|error| io(&path, error))?;
        reject_absolute_reparse_components(&path)?;
        file.lock_exclusive().map_err(|error| io(&path, error))?;
        Ok(file)
    }
    fn ownership_path(&self) -> PathBuf {
        self.coordinator_dir.join("ownership.json")
    }
    fn load_coordinator(&self) -> Result<ProjectionCoordinator> {
        let path = self.ownership_path();
        RootGuard::capture(&self.coordinator_dir, &path)?;
        match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| Error::Config {
                path,
                message: error.to_string(),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ProjectionCoordinator::default())
            }
            Err(error) => Err(io(&path, error)),
        }
    }
    fn receipt_path(&self, p: &str) -> PathBuf {
        self.state_dir.join("receipts").join(format!("{p}.json"))
    }
    fn load_receipt(&self, platform: &str, key: &[u8; 32]) -> Result<Option<Receipt>> {
        let path = self.receipt_path(platform);
        RootGuard::capture(&self.state_dir, &path)?;
        if !path.exists() {
            return Ok(None);
        }
        let receipt = open_receipt(&fs::read(&path).map_err(|e| io(&path, e))?, key)?;
        if receipt.platform_id != platform {
            return Err(Error::Transaction(
                "receipt does not belong to the requested platform".into(),
            ));
        }
        Ok(Some(receipt))
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct RootGuard {
    root: PathBuf,
    ancestors: Vec<PathIdentity>,
}

#[derive(Clone, Serialize, Deserialize)]
struct PathIdentity {
    path: PathBuf,
    device: u64,
    file: u64,
}

impl RootGuard {
    fn capture(root: &Path, path: &Path) -> Result<Self> {
        validate_lexical_boundary(root, path)?;
        reject_reparse_components(root, path)?;
        let mut ancestors = Vec::new();
        let parent = path
            .parent()
            .ok_or_else(|| Error::Validation("destination has no parent".into()))?;
        let mut current = root.to_path_buf();
        if let Some(identity) = existing_identity(&current)? {
            ancestors.push(identity);
        }
        let relative = parent.strip_prefix(root).map_err(|_| {
            Error::Validation(format!(
                "destination escapes its canonical root: {}",
                path.display()
            ))
        })?;
        for component in relative.components() {
            current.push(component.as_os_str());
            match existing_identity(&current)? {
                Some(identity) => ancestors.push(identity),
                None => break,
            }
        }
        let guard = Self {
            root: root.to_path_buf(),
            ancestors,
        };
        guard.validate(path)?;
        Ok(guard)
    }

    fn validate(&self, path: &Path) -> Result<()> {
        validate_lexical_boundary(&self.root, path)?;
        reject_reparse_components(&self.root, path)?;
        for expected in &self.ancestors {
            let actual = existing_identity(&expected.path)?.ok_or_else(|| {
                Error::Validation(format!(
                    "projection parent was removed after preview: {}",
                    expected.path.display()
                ))
            })?;
            if actual.device != expected.device || actual.file != expected.file {
                return Err(Error::Validation(format!(
                    "projection parent was replaced after preview: {}",
                    expected.path.display()
                )));
            }
        }
        let root_canonical = canonical_existing(&self.root)?;
        let ancestor = nearest_existing(path)?;
        let ancestor_canonical =
            fs::canonicalize(&ancestor).map_err(|error| io(&ancestor, error))?;
        if !ancestor_canonical.starts_with(&root_canonical) {
            return Err(Error::Validation(format!(
                "projection destination resolves outside its canonical root: {}",
                path.display()
            )));
        }
        Ok(())
    }
}

fn validate_lexical_boundary(root: &Path, path: &Path) -> Result<()> {
    use std::path::Component;
    if !root.is_absolute()
        || !path.is_absolute()
        || root
            .components()
            .chain(path.components())
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
        || path == root
        || !path.starts_with(root)
    {
        return Err(Error::Validation(format!(
            "projection destination is outside its canonical root: {}",
            path.display()
        )));
    }
    Ok(())
}

fn reject_reparse_components(root: &Path, path: &Path) -> Result<()> {
    let mut current = root.to_path_buf();
    check_component(&current, true)?;
    let relative = path.strip_prefix(root).map_err(|_| {
        Error::Validation(format!(
            "projection destination escapes its root: {}",
            path.display()
        ))
    })?;
    let components = relative.components().collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        current.push(component.as_os_str());
        check_component(&current, index + 1 < components.len())?;
        if !exists(&current) {
            break;
        }
    }
    Ok(())
}

fn check_component(path: &Path, must_be_directory: bool) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io(path, error)),
    };
    if is_reparse(&metadata) {
        return Err(Error::Validation(format!(
            "projection path contains a symlink or reparse point: {}",
            path.display()
        )));
    }
    if (!metadata.is_file() && !metadata.is_dir()) || (must_be_directory && !metadata.is_dir()) {
        return Err(Error::Validation(format!(
            "projection path contains a special or non-directory component: {}",
            path.display()
        )));
    }
    Ok(())
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

#[cfg_attr(windows, allow(unsafe_code))]
fn existing_identity(path: &Path) -> Result<Option<PathIdentity>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io(path, error)),
    };
    if is_reparse(&metadata) || !metadata.is_dir() {
        return Err(Error::Validation(format!(
            "projection parent is not a plain directory: {}",
            path.display()
        )));
    }
    #[cfg(unix)]
    let (device, file) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    };
    #[cfg(windows)]
    let (device, file) = {
        use std::{mem::zeroed, os::windows::io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
            GetFileInformationByHandle,
        };
        let mut options = fs::OpenOptions::new();
        use std::os::windows::fs::OpenOptionsExt;
        options
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
        let handle = options.open(path).map_err(|error| io(path, error))?;
        let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
        if unsafe { GetFileInformationByHandle(handle.as_raw_handle() as _, &mut information) } == 0
        {
            return Err(io(path, std::io::Error::last_os_error()));
        }
        (
            u64::from(information.dwVolumeSerialNumber),
            (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
        )
    };
    Ok(Some(PathIdentity {
        path: path.to_path_buf(),
        device,
        file,
    }))
}

fn canonical_existing(root: &Path) -> Result<PathBuf> {
    let existing = nearest_existing(root)?;
    if existing != root {
        return Err(Error::Validation(format!(
            "projection root does not exist: {}",
            root.display()
        )));
    }
    fs::canonicalize(root).map_err(|error| io(root, error))
}

fn nearest_existing(path: &Path) -> Result<PathBuf> {
    let mut current = path.to_path_buf();
    loop {
        match fs::symlink_metadata(&current) {
            Ok(_) => return Ok(current),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !current.pop() {
                    return Err(Error::Validation(format!(
                        "projection path has no existing ancestor: {}",
                        path.display()
                    )));
                }
            }
            Err(error) => return Err(io(&current, error)),
        }
    }
}

fn receipt_root<'a>(state_dir: &'a Path, receipt: &'a Receipt, path: &Path) -> Result<&'a Path> {
    if path.starts_with(state_dir) && path != state_dir {
        return Ok(state_dir);
    }
    receipt
        .leases
        .iter()
        .filter_map(|lease| lease_boundary_for_path(lease, path).map(|root| (lease, root)))
        .max_by_key(|(lease, _)| lease.root.components().count())
        .map(|(_, root)| root)
        .ok_or_else(|| {
            Error::Validation(format!(
                "authenticated receipt path is outside every leased root: {}",
                path.display()
            ))
        })
}

fn install_boundary(install: &AgentInstall) -> Result<&Path> {
    if install.agent == AgentId::Claude
        && install.root.file_name().and_then(|name| name.to_str()) == Some(".claude")
    {
        install.root.parent().ok_or_else(|| {
            Error::Validation("the canonical Claude root has no security boundary parent".into())
        })
    } else {
        Ok(&install.root)
    }
}

fn validate_agent_destinations(install: &AgentInstall, boundary: &Path) -> Result<()> {
    let mut paths = match install.agent {
        AgentId::Claude => vec![
            install.root.join("settings.json"),
            install.root.join("claude.json"),
            install.root.join(".claude.json"),
        ],
        AgentId::Gemini => vec![
            install.root.join(".env"),
            install.root.join("settings.json"),
        ],
        AgentId::Opencode => vec![
            install.root.join("opencode.json"),
            install.root.join("opencode.jsonc"),
        ],
        AgentId::Codex => vec![
            install.root.join("config.toml"),
            install.root.join(CODEX_MODEL_CATALOG_FILE),
        ],
        AgentId::Grokbuild => vec![install.root.join("config.toml")],
        AgentId::Workbuddy => vec![
            install.root.join(BUDDY_MODEL_CATALOG_FILE),
            install.root.join("settings.json"),
            install.root.join(".mcp.json"),
            install.root.join("mcp.json"),
        ],
    };
    if install.agent == AgentId::Claude
        && install.root.file_name().and_then(|name| name.to_str()) == Some(".claude")
    {
        paths.push(
            install
                .root
                .parent()
                .ok_or_else(|| Error::Validation("Claude root has no parent".into()))?
                .join(".claude.json"),
        );
    }
    for path in paths {
        RootGuard::capture(boundary, &path)?;
    }
    Ok(())
}

fn lease_boundary_for_path<'a>(lease: &'a ProjectionLease, path: &Path) -> Option<&'a Path> {
    if path.starts_with(&lease.root) && path != lease.root {
        return Some(&lease.root);
    }
    if lease.agent == AgentId::Claude.as_str()
        && lease.root.file_name().and_then(|name| name.to_str()) == Some(".claude")
        && path == lease.root.parent()?.join(".claude.json")
    {
        lease.root.parent()
    } else {
        None
    }
}

fn validate_receipt_paths(state_dir: &Path, receipt: &Receipt) -> Result<()> {
    for path in receipt.files.iter().map(|file| &file.path) {
        RootGuard::capture(receipt_root(state_dir, receipt, path)?, path)?;
    }
    for skill in &receipt.skills {
        if is_symlink(&skill.path) {
            continue;
        }
        RootGuard::capture(receipt_root(state_dir, receipt, &skill.path)?, &skill.path)?;
    }
    Ok(())
}

fn reject_absolute_reparse_components(path: &Path) -> Result<()> {
    use std::path::Component;

    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        // A Windows drive/UNC prefix is not independently openable. Check it
        // once the following RootDir component has formed the volume root.
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_reparse(&metadata) => {
                return Err(Error::Validation(format!(
                    "storage path contains a symlink or reparse point: {}",
                    current.display()
                )));
            }
            Ok(metadata) if current != path && (!metadata.is_dir() || is_reparse(&metadata)) => {
                return Err(Error::Validation(format!(
                    "storage path contains a non-directory component: {}",
                    current.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(io(&current, error)),
        }
    }
    Ok(())
}

fn ensure_plain_dir(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(Error::Validation(format!(
            "storage directory must be absolute: {}",
            path.display()
        )));
    }
    reject_absolute_reparse_components(path)?;
    fs::create_dir_all(path).map_err(|error| io(path, error))?;
    reject_absolute_reparse_components(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|error| io(path, error))?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(Error::Validation(format!(
            "storage path is not a plain directory: {}",
            path.display()
        )));
    }
    sync_parent(path)
}

#[derive(Clone, Serialize, Deserialize)]
struct ActiveHeader {
    version: u32,
    transaction: String,
    platform: String,
    bundle: String,
    salt: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
struct JournalManifest {
    ops: Vec<JournalOp>,
    created_parents: Vec<CreatedParent>,
}
#[derive(Serialize, Deserialize)]
struct JournalOp {
    path: PathBuf,
    guard: RootGuard,
    prior: Snapshot,
    intended: Snapshot,
    stage: PathBuf,
    displaced: PathBuf,
}
#[derive(Serialize, Deserialize)]
struct CreatedParent {
    path: PathBuf,
    guard: RootGuard,
}
#[derive(Clone, Serialize, Deserialize)]
enum Snapshot {
    Missing,
    File {
        digest: Vec<u8>,
        length: u64,
        mode: u32,
    },
    Directory {
        entries: Vec<TreeEntry>,
        mode: u32,
    },
}
#[derive(Clone, Serialize, Deserialize)]
struct TreeEntry {
    path: PathBuf,
    directory: bool,
    digest: Vec<u8>,
    length: u64,
    mode: u32,
}
#[derive(Serialize, Deserialize)]
struct SealedJournal {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
struct StoredJournal {
    header: ActiveHeader,
    manifest: SealedJournal,
}

fn journal_key(receipt: &[u8; 32], salt: &[u8]) -> Result<[u8; 32]> {
    let mut key = [0; 32];
    Hkdf::<Sha256>::new(Some(salt), receipt)
        .expand(b"Gateway Connector durable projection journal v1", &mut key)
        .map_err(|_| Error::Transaction("could not derive journal key".into()))?;
    Ok(key)
}
fn seal_journal<T: Serialize>(value: &T, key: &[u8; 32], aad: &[u8]) -> Result<Vec<u8>> {
    use aes_gcm::aead::Payload;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let plain = serde_json::to_vec(value).map_err(|e| Error::Transaction(e.to_string()))?;
    let ciphertext = Aes256Gcm::new(key.into())
        .encrypt(&nonce, Payload { msg: &plain, aad })
        .map_err(|_| Error::Transaction("journal encryption failed".into()))?;
    serde_json::to_vec(&SealedJournal {
        nonce: nonce.to_vec(),
        ciphertext,
    })
    .map_err(|e| Error::Transaction(e.to_string()))
}
fn open_journal<T: for<'a> Deserialize<'a>>(bytes: &[u8], key: &[u8; 32], aad: &[u8]) -> Result<T> {
    use aes_gcm::aead::Payload;
    let sealed: SealedJournal = serde_json::from_slice(bytes)
        .map_err(|e| Error::Transaction(format!("invalid transaction envelope: {e}")))?;
    if sealed.nonce.len() != 12 {
        return Err(Error::Transaction("invalid transaction nonce".into()));
    }
    let plain = Aes256Gcm::new(key.into()).decrypt(aes_gcm::Nonce::from_slice(&sealed.nonce),
        Payload { msg: &sealed.ciphertext, aad })
        .map_err(|_| Error::Transaction("transaction authentication failed; preserve the transaction bundle and use the original credential".into()))?;
    serde_json::from_slice(&plain)
        .map_err(|e| Error::Transaction(format!("invalid transaction manifest: {e}")))
}

fn execute_ops(
    coordinator: &Path,
    platform: &str,
    receipt_key: &[u8; 32],
    ops: Vec<Op>,
) -> Result<()> {
    validate_operation_graph(&ops)?;
    let txid = uuid::Uuid::new_v4().to_string();
    let transactions = coordinator.join("transactions");
    ensure_plain_dir(&transactions)?;
    let active_path = transactions.join("active.json");
    recover_transaction(coordinator, platform, receipt_key)?;
    if exists(&active_path) {
        return Err(Error::Transaction(
            "projection transaction remains active after recovery".into(),
        ));
    }
    if fs::read_dir(&transactions)
        .map_err(|error| io(&transactions, error))?
        .next()
        .is_some()
    {
        return Err(Error::Transaction(
            "projection transaction directory is not clean after recovery".into(),
        ));
    }
    let bundle_name = format!("bundle-{txid}");
    let bundle = transactions.join(&bundle_name);
    let temporary_bundle = transactions.join(format!(
        "{TEMPORARY_BUNDLE_PREFIX}{txid}{TEMPORARY_BUNDLE_SUFFIX}"
    ));
    let salt = Aes256Gcm::generate_nonce(&mut OsRng).to_vec();
    let header = ActiveHeader {
        version: 1,
        transaction: txid.clone(),
        platform: platform.into(),
        bundle: bundle_name,
        salt,
    };
    let aad = serde_json::to_vec(&header).map_err(|e| Error::Transaction(e.to_string()))?;
    let key = journal_key(receipt_key, &header.salt)?;
    let mut journal_ops = Vec::new();
    let mut created_parents = BTreeMap::<PathBuf, CreatedParent>::new();
    for (index, op) in ops.iter().enumerate() {
        op.guard.validate(&op.path)?;
        let intended = match &op.kind {
            OpKind::File { bytes } => file_snapshot(bytes, managed_file_mode()),
            OpKind::Dir { source, marker } => {
                let mut snapshot = take_snapshot(source)?;
                if let Snapshot::Directory { entries, .. } = &mut snapshot {
                    entries.push(TreeEntry {
                        path: PathBuf::from(SKILL_OWNER_FILE),
                        directory: false,
                        digest: Sha256::digest(marker).to_vec(),
                        length: marker.len() as u64,
                        mode: managed_file_mode(),
                    });
                    entries.sort_by(|left, right| left.path.cmp(&right.path));
                }
                snapshot
            }
            OpKind::Remove => Snapshot::Missing,
        };
        let parent = op
            .path
            .parent()
            .ok_or_else(|| Error::Transaction("destination has no parent".into()))?;
        for missing in missing_parents(&op.guard.root, parent)? {
            created_parents
                .entry(missing.clone())
                .or_insert(CreatedParent {
                    guard: RootGuard::capture(&op.guard.root, &missing)?,
                    path: missing,
                });
        }
        let stage = parent.join(format!(".gateway-stage-{txid}-{index}"));
        let displaced = parent.join(format!(".gateway-displaced-{txid}-{index}"));
        op.guard.validate(&stage)?;
        op.guard.validate(&displaced)?;
        if exists(&stage) || exists(&displaced) {
            return Err(Error::Transaction(
                "transaction sibling already exists before prepare".into(),
            ));
        }
        journal_ops.push(JournalOp {
            path: op.path.clone(),
            guard: op.guard.clone(),
            prior: take_snapshot(&op.path)?,
            intended,
            stage,
            displaced,
        });
    }
    let mut created_parents = created_parents.into_values().collect::<Vec<_>>();
    created_parents.sort_by_key(|parent| parent.path.components().count());
    let manifest = JournalManifest {
        ops: journal_ops,
        created_parents,
    };
    validate_journal_manifest(&manifest)?;
    let manifest_envelope: SealedJournal =
        serde_json::from_slice(&seal_journal(&manifest, &key, &aad)?)
            .map_err(|error| Error::Transaction(error.to_string()))?;
    let stored_journal = serde_json::to_vec(&StoredJournal {
        header: header.clone(),
        manifest: manifest_envelope,
    })
    .map_err(|error| Error::Transaction(error.to_string()))?;
    if stored_journal.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(Error::Transaction(
            "projection journal exceeds its serialized size limit".into(),
        ));
    }
    ensure_plain_dir(&temporary_bundle)?;
    let temporary_guard = RootGuard::capture(&transactions, &temporary_bundle)?;
    temporary_guard.validate(&temporary_bundle)?;
    maybe_failpoint("bundle-created");
    atomic_with_failpoint(
        &temporary_bundle.join("manifest.enc"),
        &stored_journal,
        Some("manifest-temporary-durable"),
    )?;
    maybe_failpoint("manifest-in-temporary-bundle");
    if exists(&bundle) {
        return Err(Error::Transaction(format!(
            "projection transaction bundle already exists: {}",
            bundle.display()
        )));
    }
    let bundle_guard = RootGuard::capture(&transactions, &bundle)?;
    temporary_guard.validate(&temporary_bundle)?;
    bundle_guard.validate(&bundle)?;
    durable_publish_bundle(&temporary_bundle, &bundle)?;
    maybe_failpoint("manifest-durable");
    atomic(&active_path, &aad)?;
    maybe_failpoint("prepared-durable");
    let prepared_result = (|| {
        create_journal_parents(&manifest.created_parents)?;
        for (journal_op, op) in manifest.ops.iter().zip(&ops) {
            apply_journal_op(journal_op, op)?;
        }
        maybe_failpoint("mutations-complete");
        let mut commit_aad = aad.clone();
        commit_aad.extend_from_slice(b"/committed");
        atomic(
            &bundle.join("committed.enc"),
            &seal_journal(&txid, &key, &commit_aad)?,
        )
    })();
    if let Err(error) = prepared_result {
        return match recover_transaction(coordinator, platform, receipt_key) {
            Ok(()) => Err(error),
            Err(recovery) => Err(Error::Transaction(format!(
                "projection failed ({error}); durable recovery also failed ({recovery})"
            ))),
        };
    }
    maybe_failpoint("committed-durable");
    cleanup_transaction(&transactions, &bundle, &manifest)
}

fn recover_transaction(coordinator: &Path, platform: &str, receipt_key: &[u8; 32]) -> Result<()> {
    let transactions = coordinator.join("transactions");
    if !transactions.exists() {
        return Ok(());
    }
    let active = transactions.join("active.json");
    RootGuard::capture(coordinator, &transactions)?;
    RootGuard::capture(&transactions, &active)?;
    let active_aad = read_optional_bounded(&active)?;
    if active_aad.is_none() {
        recover_temporary_bundle(&transactions, platform, receipt_key)?;
    }
    let active_header = active_aad
        .as_deref()
        .map(|bytes| {
            serde_json::from_slice::<ActiveHeader>(bytes).map_err(|error| {
                Error::Transaction(format!("invalid global active transaction header: {error}"))
            })
        })
        .transpose()?;
    if let Some(header) = &active_header {
        validate_active_header(header)?;
    }
    let bundle = transaction_bundle(
        &transactions,
        active_header.as_ref().map(|header| header.bundle.as_str()),
    )?;
    let Some(bundle) = bundle else {
        return if active_header.is_some() {
            Err(Error::Transaction(
                "incomplete projection transaction has no authenticated bundle".into(),
            ))
        } else {
            Ok(())
        };
    };
    RootGuard::capture(&transactions, &bundle)?;
    let manifest_path = bundle.join("manifest.enc");
    RootGuard::capture(&bundle, &manifest_path)?;
    let stored: StoredJournal =
        serde_json::from_slice(&read_bounded(&manifest_path)?).map_err(|error| {
            Error::Transaction(format!("invalid stored transaction journal: {error}"))
        })?;
    validate_active_header(&stored.header)?;
    if bundle.file_name().and_then(|name| name.to_str()) != Some(stored.header.bundle.as_str()) {
        return Err(Error::Transaction(
            "authenticated transaction header does not match its bundle".into(),
        ));
    }
    let aad = serde_json::to_vec(&stored.header)
        .map_err(|error| Error::Transaction(error.to_string()))?;
    if active_aad.as_deref().is_some_and(|active| active != aad) {
        return Err(Error::Transaction(
            "active transaction pointer does not match the authenticated bundle header".into(),
        ));
    }
    let header = stored.header;
    if header.platform != platform {
        return Err(Error::Transaction(format!(
            "global projection transaction {} belongs to platform {}; recover it with that platform credential",
            header.transaction, header.platform
        )));
    }
    let key = journal_key(receipt_key, &header.salt)?;
    let manifest_envelope = serde_json::to_vec(&stored.manifest)
        .map_err(|error| Error::Transaction(error.to_string()))?;
    let manifest: JournalManifest = open_journal(&manifest_envelope, &key, &aad)?;
    validate_journal_manifest(&manifest)?;
    let committed = bundle.join("committed.enc");
    if committed.exists() {
        RootGuard::capture(&bundle, &committed)?;
        let mut commit_aad = aad.clone();
        commit_aad.extend_from_slice(b"/committed");
        let id: String = open_journal(&read_bounded(&committed)?, &key, &commit_aad)?;
        if id != header.transaction {
            return Err(Error::Transaction(
                "commit marker transaction mismatch".into(),
            ));
        }
        for op in &manifest.ops {
            op.guard.validate(&op.path)?;
            if !snapshot_matches(&op.path, &op.intended)? {
                return Err(Error::Transaction(format!(
                    "committed destination does not match authenticated intent: {}",
                    op.path.display()
                )));
            }
            if exists(&op.stage) {
                return Err(Error::Transaction(format!(
                    "committed transaction has an unexpected stage: {}",
                    op.stage.display()
                )));
            }
            if exists(&op.displaced) && !snapshot_matches(&op.displaced, &op.prior)? {
                return Err(Error::Transaction(format!(
                    "committed transaction has an invalid displaced snapshot: {}",
                    op.displaced.display()
                )));
            }
        }
    } else {
        for op in manifest.ops.iter().rev() {
            rollback_journal_op(op)?;
        }
        remove_created_parents(&manifest.created_parents)?;
    }
    cleanup_transaction(&transactions, &bundle, &manifest)
}

fn validate_active_header(header: &ActiveHeader) -> Result<()> {
    let expected_bundle = format!("bundle-{}", header.transaction);
    if header.version != 1
        || header.salt.len() != 12
        || uuid::Uuid::parse_str(&header.transaction).is_err()
        || header.bundle != expected_bundle
    {
        return Err(Error::Transaction(
            "invalid global active transaction header fields".into(),
        ));
    }
    Ok(())
}

fn recover_temporary_bundle(
    transactions: &Path,
    platform: &str,
    receipt_key: &[u8; 32],
) -> Result<()> {
    let mut temporary = Vec::new();
    let mut other_artifacts = false;
    for entry in fs::read_dir(transactions).map_err(|error| io(transactions, error))? {
        let entry = entry.map_err(|error| io(transactions, error))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(transaction) = temporary_bundle_transaction(&name) {
            let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
            if is_reparse(&metadata) || !metadata.is_dir() {
                return Err(Error::Transaction(format!(
                    "temporary transaction bundle is not a plain directory: {}",
                    path.display()
                )));
            }
            temporary.push((path, transaction));
        } else {
            other_artifacts = true;
        }
    }
    if temporary.is_empty() {
        return Ok(());
    }
    if temporary.len() != 1 || other_artifacts {
        return Err(Error::Transaction(
            "temporary projection bundle is ambiguous with other transaction artifacts".into(),
        ));
    }
    let (temporary, transaction) = temporary.pop().expect("one temporary bundle");
    let guard = RootGuard::capture(transactions, &temporary)?;
    let mut entries = fs::read_dir(&temporary)
        .map_err(|error| io(&temporary, error))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| io(&temporary, error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    match entries.as_slice() {
        [] => {
            // The final bundle name was never published, so no mutation could
            // have begun. An empty private preparation directory is safe to
            // discard after reparse/containment checks.
            guard.validate(&temporary)?;
            durable_remove_empty_dir(&temporary)
        }
        [entry] if atomic_temporary_name(&entry.file_name().to_string_lossy()) => {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
            if is_reparse(&metadata) || !metadata.is_file() {
                return Err(Error::Transaction(format!(
                    "manifest temporary is not a plain file: {}",
                    path.display()
                )));
            }
            // This is the synced-but-not-renamed file created inside the
            // unpublished bundle. Mutations remain impossible at this point.
            guard.validate(&temporary)?;
            let file_guard = RootGuard::capture(&temporary, &path)?;
            file_guard.validate(&path)?;
            fs::remove_file(&path).map_err(|error| io(&path, error))?;
            sync_parent(&path)?;
            guard.validate(&temporary)?;
            durable_remove_empty_dir(&temporary)
        }
        [entry] if entry.file_name() == "manifest.enc" => {
            let manifest_path = entry.path();
            RootGuard::capture(&temporary, &manifest_path)?;
            let stored: StoredJournal = serde_json::from_slice(&read_bounded(&manifest_path)?)
                .map_err(|error| {
                    Error::Transaction(format!(
                        "invalid stored temporary transaction journal: {error}"
                    ))
                })?;
            validate_active_header(&stored.header)?;
            if stored.header.transaction != transaction {
                return Err(Error::Transaction(
                    "temporary bundle name does not match its authenticated header".into(),
                ));
            }
            if stored.header.platform != platform {
                return Err(Error::Transaction(format!(
                    "temporary projection transaction {} belongs to platform {}; recover it with that platform credential",
                    stored.header.transaction, stored.header.platform
                )));
            }
            let aad = serde_json::to_vec(&stored.header)
                .map_err(|error| Error::Transaction(error.to_string()))?;
            let key = journal_key(receipt_key, &stored.header.salt)?;
            let envelope = serde_json::to_vec(&stored.manifest)
                .map_err(|error| Error::Transaction(error.to_string()))?;
            let manifest: JournalManifest = open_journal(&envelope, &key, &aad)?;
            validate_journal_manifest(&manifest)?;
            let final_bundle = transactions.join(&stored.header.bundle);
            if exists(&final_bundle) {
                return Err(Error::Transaction(
                    "temporary and final projection bundles both exist".into(),
                ));
            }
            let final_guard = RootGuard::capture(transactions, &final_bundle)?;
            guard.validate(&temporary)?;
            final_guard.validate(&final_bundle)?;
            durable_publish_bundle(&temporary, &final_bundle)
        }
        _ => Err(Error::Transaction(
            "temporary projection bundle contains unexpected or multiple artifacts".into(),
        )),
    }
}

fn temporary_bundle_transaction(name: &str) -> Option<String> {
    let transaction = name
        .strip_prefix(TEMPORARY_BUNDLE_PREFIX)?
        .strip_suffix(TEMPORARY_BUNDLE_SUFFIX)?;
    uuid::Uuid::parse_str(transaction)
        .ok()
        .map(|_| transaction.to_owned())
}

fn atomic_temporary_name(name: &str) -> bool {
    name.strip_prefix(".connector-")
        .and_then(|value| value.strip_suffix(".tmp"))
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}

fn transaction_bundle(transactions: &Path, expected: Option<&str>) -> Result<Option<PathBuf>> {
    let mut bundle = None;
    let mut temporary = false;
    for entry in fs::read_dir(transactions).map_err(|error| io(transactions, error))? {
        let entry = entry.map_err(|error| io(transactions, error))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "active.json" {
            continue;
        }
        if name.starts_with(".connector-") && name.ends_with(".tmp") {
            let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
            if is_reparse(&metadata) || !metadata.is_file() {
                return Err(Error::Transaction(format!(
                    "invalid transaction temporary artifact: {}",
                    path.display()
                )));
            }
            temporary = true;
            continue;
        }
        let valid_bundle = name
            .strip_prefix("bundle-")
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok());
        let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
        if !valid_bundle || is_reparse(&metadata) || !metadata.is_dir() {
            return Err(Error::Transaction(format!(
                "unknown or invalid content in transaction directory: {}",
                path.display()
            )));
        }
        if expected.is_some_and(|expected| expected != name) || bundle.replace(path).is_some() {
            return Err(Error::Transaction(
                "multiple or mismatched projection transaction bundles require manual recovery"
                    .into(),
            ));
        }
    }
    if expected.is_some() && bundle.is_none() {
        return Err(Error::Transaction(
            "active projection transaction bundle is missing".into(),
        ));
    }
    if temporary && bundle.is_none() {
        return Err(Error::Transaction(
            "incomplete transaction temporary has no authenticated bundle".into(),
        ));
    }
    Ok(bundle)
}

fn apply_journal_op(op: &JournalOp, source: &Op) -> Result<()> {
    op.guard.validate(&op.path)?;
    op.guard.validate(&op.stage)?;
    op.guard.validate(&op.displaced)?;
    if exists(&op.stage) || exists(&op.displaced) {
        return Err(Error::Transaction(
            "transaction sibling already exists".into(),
        ));
    }
    if !matches!(op.intended, Snapshot::Missing) {
        stage_operation(source, &op.stage)?;
        sync_tree(&op.stage)?;
        if !snapshot_matches(&op.stage, &op.intended)? {
            return Err(Error::Transaction(format!(
                "durable stage does not match authenticated intent: {}",
                op.stage.display()
            )));
        }
    }
    maybe_failpoint("stage-durable");
    op.guard.validate(&op.path)?;
    if exists(&op.path) {
        durable_rename(&op.path, &op.displaced)?;
    }
    maybe_failpoint("destination-displaced");
    op.guard.validate(&op.path)?;
    if !matches!(op.intended, Snapshot::Missing) {
        durable_rename(&op.stage, &op.path)?;
    }
    maybe_failpoint("destination-installed");
    Ok(())
}
fn cleanup_transaction(
    transactions: &Path,
    bundle: &Path,
    manifest: &JournalManifest,
) -> Result<()> {
    for op in &manifest.ops {
        op.guard.validate(&op.path)?;
        if exists(&op.stage) {
            op.guard.validate(&op.stage)?;
            durable_remove_any(&op.stage)?;
        }
        if exists(&op.displaced) {
            op.guard.validate(&op.displaced)?;
            durable_remove_any(&op.displaced)?;
        }
        maybe_failpoint("cleanup-artifact");
    }
    let active = transactions.join("active.json");
    if active.exists() {
        durable_remove_any(&active)?;
    }
    maybe_failpoint("active-cleared");
    cleanup_transaction_temporaries(transactions)?;
    if bundle.exists() {
        durable_remove_any(bundle)?;
    }
    maybe_failpoint("bundle-cleared");
    Ok(())
}

fn rollback_journal_op(op: &JournalOp) -> Result<()> {
    op.guard.validate(&op.path)?;
    op.guard.validate(&op.stage)?;
    op.guard.validate(&op.displaced)?;
    let destination_is_prior = snapshot_matches(&op.path, &op.prior)?;
    let destination_is_intended = snapshot_matches(&op.path, &op.intended)?;
    let displaced_is_prior = snapshot_matches(&op.displaced, &op.prior)?;

    if !matches!(op.prior, Snapshot::Missing) && exists(&op.displaced) && !displaced_is_prior {
        return Err(Error::Transaction(format!(
            "rollback found an invalid displaced snapshot: {}",
            op.displaced.display()
        )));
    }
    if matches!(op.prior, Snapshot::Missing) && exists(&op.displaced) {
        return Err(Error::Transaction(format!(
            "rollback found an unexpected displaced snapshot: {}",
            op.displaced.display()
        )));
    }

    if destination_is_prior {
        if exists(&op.stage) {
            op.guard.validate(&op.stage)?;
            durable_remove_any(&op.stage)?;
        }
        if exists(&op.displaced) {
            op.guard.validate(&op.displaced)?;
            durable_remove_any(&op.displaced)?;
        }
        return Ok(());
    }

    if matches!(op.prior, Snapshot::Missing) {
        if exists(&op.path) && !destination_is_intended {
            return Err(Error::Transaction(format!(
                "rollback found unknown destination content: {}",
                op.path.display()
            )));
        }
        if exists(&op.path) {
            op.guard.validate(&op.path)?;
            durable_remove_any(&op.path)?;
        }
        if exists(&op.stage) {
            op.guard.validate(&op.stage)?;
            durable_remove_any(&op.stage)?;
        }
        return Ok(());
    }

    if displaced_is_prior {
        if exists(&op.path) && !destination_is_intended {
            return Err(Error::Transaction(format!(
                "rollback found unknown destination content: {}",
                op.path.display()
            )));
        }
        if exists(&op.path) {
            op.guard.validate(&op.path)?;
            durable_remove_any(&op.path)?;
        }
        if exists(&op.stage) {
            op.guard.validate(&op.stage)?;
            durable_remove_any(&op.stage)?;
        }
        op.guard.validate(&op.displaced)?;
        durable_rename(&op.displaced, &op.path)?;
        if !snapshot_matches(&op.path, &op.prior)? {
            return Err(Error::Transaction(format!(
                "rollback did not restore the authenticated prior snapshot: {}",
                op.path.display()
            )));
        }
        return Ok(());
    }

    Err(Error::Transaction(format!(
        "rollback cannot locate the authenticated prior snapshot for {}",
        op.path.display()
    )))
}

fn missing_parents(root: &Path, parent: &Path) -> Result<Vec<PathBuf>> {
    validate_lexical_boundary(root, &parent.join(".gateway-parent-probe"))?;
    let mut missing = Vec::new();
    let mut current = parent.to_path_buf();
    while current != root && !exists(&current) {
        missing.push(current.clone());
        if !current.pop() {
            return Err(Error::Validation(
                "destination parent escaped its root".into(),
            ));
        }
    }
    if current != root && !current.starts_with(root) {
        return Err(Error::Validation(
            "destination parent escaped its root".into(),
        ));
    }
    missing.reverse();
    Ok(missing)
}

fn create_journal_parents(parents: &[CreatedParent]) -> Result<()> {
    for parent in parents {
        parent.guard.validate(&parent.path)?;
        if exists(&parent.path) {
            return Err(Error::Validation(format!(
                "destination parent appeared after the journal was prepared: {}",
                parent.path.display()
            )));
        }
        fs::create_dir(&parent.path).map_err(|error| io(&parent.path, error))?;
        sync_parent(&parent.path)?;
        maybe_failpoint("parent-created");
    }
    Ok(())
}

fn remove_created_parents(parents: &[CreatedParent]) -> Result<()> {
    for parent in parents.iter().rev() {
        parent.guard.validate(&parent.path)?;
        if !exists(&parent.path) {
            continue;
        }
        if fs::read_dir(&parent.path)
            .map_err(|error| io(&parent.path, error))?
            .next()
            .is_some()
        {
            return Err(Error::Transaction(format!(
                "journal-created parent is not empty during rollback: {}",
                parent.path.display()
            )));
        }
        fs::remove_dir(&parent.path).map_err(|error| io(&parent.path, error))?;
        sync_parent(&parent.path)?;
    }
    Ok(())
}

fn validate_operation_graph(ops: &[Op]) -> Result<()> {
    const MAX_OPS: usize = 2048;
    if ops.is_empty() || ops.len() > MAX_OPS {
        return Err(Error::Transaction(
            "projection transaction has an invalid operation count".into(),
        ));
    }
    for (index, op) in ops.iter().enumerate() {
        op.guard.validate(&op.path)?;
        for other in ops.iter().skip(index + 1) {
            let left = op.path.to_string_lossy().to_lowercase();
            let right = other.path.to_string_lossy().to_lowercase();
            if left == right || op.path.starts_with(&other.path) || other.path.starts_with(&op.path)
            {
                return Err(Error::Validation(format!(
                    "projection operations overlap: {} and {}",
                    op.path.display(),
                    other.path.display()
                )));
            }
        }
    }
    Ok(())
}

fn validate_journal_manifest(manifest: &JournalManifest) -> Result<()> {
    if manifest.ops.is_empty() || manifest.ops.len() > 2048 {
        return Err(Error::Transaction(
            "authenticated journal has an invalid operation count".into(),
        ));
    }
    for op in &manifest.ops {
        validate_snapshot(&op.prior)?;
        validate_snapshot(&op.intended)?;
        op.guard.validate(&op.path)?;
        let parent = op.path.parent().ok_or_else(|| {
            Error::Transaction("authenticated journal destination has no parent".into())
        })?;
        if op.stage.parent() != Some(parent)
            || op.displaced.parent() != Some(parent)
            || op.stage == op.displaced
        {
            return Err(Error::Transaction(
                "authenticated journal has invalid sibling paths".into(),
            ));
        }
        op.guard.validate(&op.stage)?;
        op.guard.validate(&op.displaced)?;
    }
    for (index, op) in manifest.ops.iter().enumerate() {
        for other in manifest.ops.iter().skip(index + 1) {
            if op.path == other.path
                || op.path.starts_with(&other.path)
                || other.path.starts_with(&op.path)
            {
                return Err(Error::Transaction(
                    "authenticated journal contains overlapping operations".into(),
                ));
            }
        }
    }
    let mut entries = 0usize;
    let mut bytes = 0u64;
    for snapshot in manifest.ops.iter().flat_map(|op| [&op.prior, &op.intended]) {
        match snapshot {
            Snapshot::Missing => {}
            Snapshot::File { length, .. } => {
                entries = entries.checked_add(1).ok_or_else(|| {
                    Error::Transaction("journal snapshot entry count overflow".into())
                })?;
                bytes = bytes.checked_add(*length).ok_or_else(|| {
                    Error::Transaction("journal snapshot byte count overflow".into())
                })?;
            }
            Snapshot::Directory {
                entries: tree_entries,
                ..
            } => {
                entries = entries.checked_add(tree_entries.len()).ok_or_else(|| {
                    Error::Transaction("journal snapshot entry count overflow".into())
                })?;
                for entry in tree_entries {
                    bytes = bytes.checked_add(entry.length).ok_or_else(|| {
                        Error::Transaction("journal snapshot byte count overflow".into())
                    })?;
                }
            }
        }
    }
    if entries > 4096 || bytes > 4 * 1024 * 1024 * 1024 {
        return Err(Error::Transaction(
            "projection journal exceeds its aggregate snapshot budget".into(),
        ));
    }
    Ok(())
}

fn validate_snapshot(snapshot: &Snapshot) -> Result<()> {
    match snapshot {
        Snapshot::Missing => Ok(()),
        Snapshot::File { digest, .. } if digest.len() == 32 => Ok(()),
        Snapshot::Directory { entries, .. } => {
            let mut previous: Option<&Path> = None;
            for entry in entries {
                if entry.path.is_absolute()
                    || entry.path.components().any(|component| {
                        matches!(
                            component,
                            std::path::Component::ParentDir
                                | std::path::Component::CurDir
                                | std::path::Component::RootDir
                                | std::path::Component::Prefix(_)
                        )
                    })
                    || (!entry.directory && entry.digest.len() != 32)
                    || (entry.directory && (!entry.digest.is_empty() || entry.length != 0))
                    || previous.is_some_and(|path| path >= entry.path.as_path())
                {
                    return Err(Error::Transaction(
                        "authenticated journal contains an invalid tree snapshot".into(),
                    ));
                }
                previous = Some(&entry.path);
            }
            Ok(())
        }
        Snapshot::File { .. } => Err(Error::Transaction(
            "authenticated journal contains an invalid file snapshot".into(),
        )),
    }
}

fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|error| io(path, error))?;
    if is_reparse(&metadata) || !metadata.is_file() || metadata.len() > MAX_JOURNAL_BYTES {
        return Err(Error::Transaction(format!(
            "journal file is special or exceeds the size limit: {}",
            path.display()
        )));
    }
    fs::read(path).map_err(|error| io(path, error))
}

fn read_optional_bounded(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if is_reparse(&metadata) || !metadata.is_file() || metadata.len() > MAX_JOURNAL_BYTES {
                return Err(Error::Transaction(format!(
                    "journal file is special or exceeds the size limit: {}",
                    path.display()
                )));
            }
            fs::read(path).map(Some).map_err(|error| io(path, error))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io(path, error)),
    }
}

fn cleanup_transaction_temporaries(transactions: &Path) -> Result<()> {
    for entry in fs::read_dir(transactions).map_err(|error| io(transactions, error))? {
        let entry = entry.map_err(|error| io(transactions, error))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let temporary = name.starts_with(".connector-") && name.ends_with(".tmp");
        if temporary {
            let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
            if is_reparse(&metadata) || !metadata.is_file() {
                return Err(Error::Transaction(format!(
                    "invalid transaction temporary artifact: {}",
                    path.display()
                )));
            }
            durable_remove_any(&path)?;
        }
    }
    Ok(())
}

fn mode(metadata: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o7777
    }
    #[cfg(not(unix))]
    {
        if metadata.permissions().readonly() {
            0o444
        } else {
            0o666
        }
    }
}
fn take_snapshot(path: &Path) -> Result<Snapshot> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Snapshot::Missing),
        Err(e) => return Err(io(path, e)),
    };
    if is_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(Error::Validation(format!(
            "symlink or special filesystem entry is not supported in a transaction: {}",
            path.display()
        )));
    }
    if metadata.is_file() {
        return Ok(Snapshot::File {
            digest: digest_file(path)?,
            length: metadata.len(),
            mode: mode(&metadata),
        });
    }
    let mut entries = Vec::new();
    snapshot_tree(path, path, &mut entries)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(Snapshot::Directory {
        entries,
        mode: mode(&metadata),
    })
}
fn snapshot_tree(root: &Path, directory: &Path, out: &mut Vec<TreeEntry>) -> Result<()> {
    let mut children = fs::read_dir(directory)
        .map_err(|e| io(directory, e))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| io(directory, e))?;
    children.sort_by_key(fs::DirEntry::file_name);
    for child in children {
        let path = child.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| io(&path, e))?;
        if is_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
            return Err(Error::Validation(format!(
                "symlink or special Skill entry is not supported: {}",
                path.display()
            )));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| Error::Transaction("invalid tree path".into()))?
            .to_owned();
        out.push(TreeEntry {
            path: relative,
            directory: metadata.is_dir(),
            digest: if metadata.is_file() {
                digest_file(&path)?
            } else {
                Vec::new()
            },
            length: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
            mode: mode(&metadata),
        });
        if metadata.is_dir() {
            snapshot_tree(root, &path, out)?;
        }
    }
    Ok(())
}

fn file_snapshot(bytes: &[u8], mode: u32) -> Snapshot {
    Snapshot::File {
        digest: Sha256::digest(bytes).to_vec(),
        length: bytes.len() as u64,
        mode,
    }
}

fn managed_file_mode() -> u32 {
    #[cfg(unix)]
    {
        0o600
    }
    #[cfg(not(unix))]
    {
        0o666
    }
}

fn digest_file(path: &Path) -> Result<Vec<u8>> {
    let mut file = open_source_nofollow(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer).map_err(|error| io(path, error))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest.finalize().to_vec())
}

fn stage_operation(op: &Op, stage: &Path) -> Result<()> {
    op.guard.validate(stage)?;
    match &op.kind {
        OpKind::File { bytes } => {
            atomic(stage, bytes)?;
            op.guard.validate(stage)?;
            set_mode(stage, 0o600)
        }
        OpKind::Dir { source, marker } => {
            copy_tree_durable(source, stage, &op.guard)?;
            let source_mode =
                mode(&fs::symlink_metadata(source).map_err(|error| io(source, error))?);
            set_mode(stage, source_mode | 0o200)?;
            let owner = stage.join(SKILL_OWNER_FILE);
            op.guard.validate(&owner)?;
            atomic(&owner, marker)?;
            set_mode(&owner, 0o600)?;
            set_mode(stage, source_mode)
        }
        OpKind::Remove => Ok(()),
    }
}

fn copy_tree_durable(source: &Path, destination: &Path, guard: &RootGuard) -> Result<()> {
    let metadata = fs::symlink_metadata(source).map_err(|error| io(source, error))?;
    if is_reparse(&metadata) || !metadata.is_dir() {
        return Err(Error::Validation(format!(
            "Skill source is not a plain directory: {}",
            source.display()
        )));
    }
    guard.validate(destination)?;
    fs::create_dir(destination).map_err(|error| io(destination, error))?;
    let mut children = fs::read_dir(source)
        .map_err(|error| io(source, error))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| io(source, error))?;
    children.sort_by_key(fs::DirEntry::file_name);
    for child in children {
        let source_path = child.path();
        let destination_path = destination.join(child.file_name());
        let child_metadata =
            fs::symlink_metadata(&source_path).map_err(|error| io(&source_path, error))?;
        if is_reparse(&child_metadata) || (!child_metadata.is_file() && !child_metadata.is_dir()) {
            return Err(Error::Validation(format!(
                "Skill source contains a symlink or special entry: {}",
                source_path.display()
            )));
        }
        guard.validate(&destination_path)?;
        if child_metadata.is_dir() {
            copy_tree_durable(&source_path, &destination_path, guard)?;
        } else {
            copy_file_durable(&source_path, &destination_path)?;
        }
        guard.validate(&destination_path)?;
        set_mode(&destination_path, mode(&child_metadata))?;
    }
    guard.validate(destination)?;
    set_mode(destination, mode(&metadata))
}

fn open_source_nofollow(path: &Path) -> Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path).map_err(|error| io(path, error))
}

fn copy_file_durable(source: &Path, destination: &Path) -> Result<()> {
    let mut input = open_source_nofollow(source)?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut output = options
        .open(destination)
        .map_err(|error| io(destination, error))?;
    std::io::copy(&mut input, &mut output).map_err(|error| io(destination, error))?;
    output.sync_all().map_err(|error| io(destination, error))
}

fn set_mode(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|e| io(path, e))
    }
    #[cfg(not(unix))]
    {
        let mut p = fs::metadata(path).map_err(|e| io(path, e))?.permissions();
        p.set_readonly(mode & 0o200 == 0);
        fs::set_permissions(path, p).map_err(|e| io(path, e))
    }
}
fn snapshot_matches(path: &Path, expected: &Snapshot) -> Result<bool> {
    let actual = take_snapshot(path)?;
    let a = serde_json::to_vec(&actual).map_err(|e| Error::Transaction(e.to_string()))?;
    let b = serde_json::to_vec(expected).map_err(|e| Error::Transaction(e.to_string()))?;
    Ok(a == b)
}

fn project(
    i: &AgentInstall,
    m: &ConnectionManifest,
    p: &Provisioning,
    b: &Secret,
    selection: &EffectiveAgentSelection,
    provider: &str,
    projection_bases: &BTreeMap<PathBuf, Vec<u8>>,
) -> Result<Vec<FileProjection>> {
    let model = selection.model.as_str();
    let protocol = selection.protocol;
    let native_base = gateway_api_base(&m.gateway.base_url, None);
    let v1_base = gateway_api_base(&m.gateway.base_url, Some("v1"));
    let v1beta_base = gateway_api_base(&m.gateway.base_url, Some("v1beta"));
    let mut out = Vec::new();
    let mcps: Vec<_> = p
        .mcp_servers
        .iter()
        .filter(|x| !selection.disabled_mcp.contains(&x.id))
        .map(|x| (x.id.clone(), x))
        .collect();
    match i.agent {
        AgentId::Claude => {
            debug_assert_eq!(protocol, WireProtocol::Anthropic);
            let current_settings = i.root.join("settings.json");
            let legacy_settings = i.root.join("claude.json");
            let settings = if !current_settings.exists() && legacy_settings.exists() {
                legacy_settings
            } else {
                current_settings
            };
            let mut v = read_json_projection(&settings, false, projection_bases)?;
            let env = obj(&mut v, "env")?;
            for (k, val) in [
                ("ANTHROPIC_BASE_URL", native_base.as_str()),
                ("ANTHROPIC_AUTH_TOKEN", b.expose()),
                ("ANTHROPIC_MODEL", model),
            ] {
                env.insert(k.into(), json!(val));
            }
            // Claude Code warns and may keep the official login when both
            // token keys are present. Origin and the previous Kit write
            // AUTH_TOKEN only.
            env.remove("ANTHROPIC_API_KEY");
            if selection.image_direct {
                env.insert("OPENAI_BASE_URL".into(), json!(v1_base.as_str()));
                env.insert("OPENAI_API_KEY".into(), json!(b.expose()));
            } else {
                env.remove("OPENAI_BASE_URL");
                env.remove("OPENAI_API_KEY");
            }
            out.push(file(
                settings,
                v,
                vec!["env.ANTHROPIC_*".into(), "env.OPENAI_*".into()],
            )?);
            let path = if i.root.file_name().and_then(|name| name.to_str()) == Some(".claude") {
                i.root.parent().unwrap_or(&i.root).join(".claude.json")
            } else {
                i.root.join(".claude.json")
            };
            let mut v = read_json_projection(&path, false, projection_bases)?;
            let map = obj(&mut v, "mcpServers")?;
            for (id, x) in mcps {
                map.insert(
                    id,
                    json!({"type":"http","url":x.url,"headers":{"Authorization":format!("Bearer {}",b.expose())}}),
                );
            }
            out.push(file(path, v, vec!["mcpServers".into()])?)
        }
        AgentId::Gemini => {
            debug_assert_eq!(protocol, WireProtocol::Gemini);
            let ep = i.root.join(".env");
            let text = read_text_projection(&ep, projection_bases)?;
            let mut items = vec![
                ("GOOGLE_GEMINI_BASE_URL", native_base.as_str()),
                ("GEMINI_API_KEY", b.expose()),
                ("GEMINI_API_KEY_AUTH_MECHANISM", "bearer"),
                ("GEMINI_MODEL", model),
            ];
            if selection.image_direct {
                items.push(("OPENAI_BASE_URL", v1_base.as_str()));
                items.push(("OPENAI_API_KEY", b.expose()));
            }
            let env = if selection.image_direct {
                merge_env(&text, &items)
            } else {
                strip_env_keys(&merge_env(&text, &items), IMAGE_DIRECT_ENV_KEYS)
            };
            out.push((ep, env.into_bytes(), vec!["managed Gemini env keys".into()]));
            let path = i.root.join("settings.json");
            let mut v = read_json_projection(&path, false, projection_bases)?;
            obj(&mut v, "security")?
                .insert("auth".into(), json!({"selectedType":"gemini-api-key"}));
            if !v.get("model").is_some_and(Value::is_object) {
                v["model"] = json!({});
            }
            obj(&mut v, "model")?.insert("name".into(), json!(model));
            let map = obj(&mut v, "mcpServers")?;
            for (id, x) in mcps {
                map.insert(
                    id,
                    json!({"httpUrl":x.url,"headers":{"Authorization":format!("Bearer {}",b.expose())}}),
                );
            }
            out.push(file(
                path,
                v,
                vec!["security.auth".into(), "mcpServers".into()],
            )?)
        }
        AgentId::Opencode => {
            let json = i.root.join("opencode.json");
            let jsonc = i.root.join("opencode.jsonc");
            let path = if !json.exists() && jsonc.exists() {
                jsonc
            } else {
                json
            };
            let mut v = read_json_projection(&path, true, projection_bases)?;
            let catalog: Map<String, Value> = p
                .models
                .iter()
                .filter(|model| model.chat_capable)
                .map(|x| (x.id.clone(), json!({"name":x.id})))
                .collect();
            let (npm, options) = match protocol {
                WireProtocol::OpenaiChat => (
                    "@ai-sdk/openai-compatible",
                    json!({"baseURL":v1_base,"apiKey":b.expose()}),
                ),
                WireProtocol::OpenaiResponses => (
                    "@ai-sdk/openai",
                    json!({"baseURL":v1_base,"apiKey":b.expose()}),
                ),
                WireProtocol::Anthropic => (
                    "@ai-sdk/anthropic",
                    json!({"baseURL":v1_base,"authToken":b.expose()}),
                ),
                WireProtocol::Gemini => (
                    "@ai-sdk/google",
                    json!({"baseURL":v1beta_base,"apiKey":b.expose()}),
                ),
            };
            v["model"] = json!(format!("{provider}/{model}"));
            obj(&mut v, "provider")?.insert(
                provider.into(),
                json!({"npm":npm,"options":options,"models":catalog}),
            );
            let map = obj(&mut v, "mcp")?;
            for (id, x) in mcps {
                map.insert(
                    id,
                    json!({"type":"remote","url":x.url,"headers":{"Authorization":format!("Bearer {}",b.expose())}}),
                );
            }
            out.push(file(path, v, vec![provider.into(), "mcp".into()])?)
        }
        AgentId::Workbuddy => {
            debug_assert_eq!(protocol, WireProtocol::OpenaiChat);
            // A Buddy client takes custom models from `models.json`, not from
            // an endpoint override: each entry carries its own full
            // chat-completions URL and key, and only the OpenAI chat shape is
            // read. `CODEBUDDY_BASE_URL` would redirect the client's own
            // hosted models instead, so the projection no longer writes it.
            let catalog = i.root.join(BUDDY_MODEL_CATALOG_FILE);
            let endpoint = format!("{v1_base}/chat/completions");
            let mut v = read_json_projection(&catalog, false, projection_bases)?;
            let projected: Vec<&Model> =
                p.models.iter().filter(|model| model.chat_capable).collect();
            let ids: BTreeSet<&str> = projected.iter().map(|model| model.id.as_str()).collect();
            // The client reads a bare array or an object holding `models`, and
            // writes the array itself. Keep whichever shape is already there so
            // a hand-written or client-written catalog survives the projection.
            let mut models: Vec<Value> = v
                .as_array()
                .or_else(|| v.get("models").and_then(Value::as_array))
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .filter(|entry| {
                    // Anything already aimed at this endpoint is a previous
                    // apply of ours; anything sharing an id is superseded.
                    entry.get("url").and_then(Value::as_str) != Some(endpoint.as_str())
                        && !entry
                            .get("id")
                            .and_then(Value::as_str)
                            .is_some_and(|id| ids.contains(id))
                })
                .cloned()
                .collect();
            models.extend(projected.iter().map(|model| {
                let mut entry = Map::new();
                entry.insert("id".into(), json!(model.id));
                entry.insert("name".into(), json!(model.id));
                entry.insert(
                    "vendor".into(),
                    json!(
                        model
                            .vendor
                            .as_ref()
                            .map_or(m.platform.name.as_str(), |vendor| vendor.name.as_str())
                    ),
                );
                entry.insert("url".into(), json!(endpoint));
                entry.insert("apiKey".into(), json!(b.expose()));
                // The Gateway relays tool calls on every chat model it lists;
                // without this flag the client offers the model no tools.
                entry.insert("supportsToolCall".into(), json!(true));
                if !model.supported_reasoning.is_empty() {
                    entry.insert("supportsReasoning".into(), json!(true));
                }
                Value::Object(entry)
            }));
            v.value = match std::mem::take(&mut v.value) {
                // `availableModels` is the user's own filter, and an absent one
                // shows everything, so the projection leaves it alone.
                Value::Object(mut catalog) => {
                    catalog.insert("models".into(), Value::Array(models));
                    Value::Object(catalog)
                }
                _ => Value::Array(models),
            };
            out.push(file(catalog, v, vec!["models".into()])?);
            let settings = i.root.join("settings.json");
            let mut v = read_json_projection(&settings, false, projection_bases)?;
            v.value["model"] = json!(model);
            // Kit used to point the whole client at the Gateway through these.
            // A projected model now carries its own endpoint and key, so a
            // global override would only misroute the client's hosted models.
            if let Some(env) = v.get_mut("env").and_then(Value::as_object_mut) {
                env.remove("CODEBUDDY_BASE_URL");
                env.remove("CODEBUDDY_API_KEY");
                env.remove("CODEBUDDY_AUTH_TOKEN");
            }
            out.push(file(
                settings,
                v,
                vec!["model".into(), "env.CODEBUDDY_*".into()],
            )?);
            let current_mcp = i.root.join(".mcp.json");
            let legacy_mcp = i.root.join("mcp.json");
            let mcp_path = if !current_mcp.exists() && legacy_mcp.exists() {
                legacy_mcp
            } else {
                current_mcp
            };
            let mut v = read_json_projection(&mcp_path, false, projection_bases)?;
            let map = obj(&mut v, "mcpServers")?;
            for (id, x) in mcps {
                map.insert(
                    id,
                    json!({"type":"http","url":x.url,"headers":{"Authorization":format!("Bearer {}",b.expose())}}),
                );
            }
            out.push(file(mcp_path, v, vec!["mcpServers".into()])?)
        }
        AgentId::Codex | AgentId::Grokbuild => {
            let path = i.root.join("config.toml");
            let mut d = read_toml_projection(&path, projection_bases)?;
            if i.agent == AgentId::Codex {
                debug_assert_eq!(protocol, WireProtocol::OpenaiResponses);
                d["model"] = value(model);
                d["model_provider"] = value(provider);
                ensure_table(&mut d, "model_providers");
                let mut t = Table::new();
                t["name"] = value(&m.platform.name);
                t["base_url"] = value(v1_base.as_str());
                t["wire_api"] = value("responses");
                // The provider carries its own Gateway credential. Codex CLI
                // and Desktop share CODEX_HOME/auth.json, so treating this
                // provider as the user's global OpenAI account can break the
                // Desktop login and startup state.
                t["requires_openai_auth"] = value(false);
                t["experimental_bearer_token"] = value(b.expose());
                let mut headers = Table::new();
                headers["x-openai-actor-authorization"] = value(b.expose());
                t["http_headers"] = Item::Table(headers);
                d["model_providers"][provider] = Item::Table(t);
                ensure_table(&mut d, "features");
                d["features"]
                    .as_table_mut()
                    .expect("features was normalized to a table")
                    .remove("imagegenext");
                d["features"]["image_generation"] = value(true);
                for (key, choice) in [
                    (
                        "model_reasoning_effort",
                        selection.codex.reasoning_effort.map(|value| value.as_str()),
                    ),
                    (
                        "model_reasoning_summary",
                        selection
                            .codex
                            .reasoning_summary
                            .map(|value| value.as_str()),
                    ),
                    (
                        "model_verbosity",
                        selection.codex.verbosity.map(|value| value.as_str()),
                    ),
                    (
                        "approval_policy",
                        selection.codex.approval_policy.map(|value| value.as_str()),
                    ),
                    (
                        "sandbox_mode",
                        selection.codex.sandbox_mode.map(|value| value.as_str()),
                    ),
                    (
                        "web_search",
                        selection.codex.web_search.map(|value| value.as_str()),
                    ),
                ] {
                    if let Some(choice) = choice {
                        d[key] = value(choice);
                    }
                }
                let mut catalog = selection.codex.catalog_models.clone();
                catalog.retain(|id| {
                    p.models
                        .iter()
                        .any(|model| model.id == *id && model.is_codex_catalog_model())
                });
                if p.models
                    .iter()
                    .any(|item| item.id == model && item.is_codex_catalog_model())
                {
                    catalog.insert(model.to_owned());
                }
                d["model_catalog_json"] = value(CODEX_MODEL_CATALOG_FILE);
                out.push((
                    i.root.join(CODEX_MODEL_CATALOG_FILE),
                    codex_catalog_document(&catalog, &p.models, toml_context_window(&d)),
                    vec!["Codex model catalog".into()],
                ));
            } else {
                ensure_table(&mut d, "models");
                d["models"]["default"] = value(provider);
                ensure_table(&mut d, "model");
                let context_window = grok_context_window(&d, provider);
                let mut t = Table::new();
                t["model"] = value(model);
                t["base_url"] = value(v1_base.as_str());
                t["name"] = value(&m.platform.name);
                t["api_key"] = value(b.expose());
                t["auth_scheme"] = value("bearer");
                t["api_backend"] = value(match protocol {
                    WireProtocol::OpenaiChat => "chat_completions",
                    WireProtocol::OpenaiResponses => "responses",
                    WireProtocol::Anthropic => "messages",
                    WireProtocol::Gemini => {
                        return Err(Error::Validation(
                            "Grok Build does not support the Gemini protocol".into(),
                        ));
                    }
                });
                t["context_window"] = value(context_window);
                d["model"][provider] = Item::Table(t);
            }
            ensure_table(&mut d, "mcp_servers");
            for (id, x) in mcps {
                let mut t = Table::new();
                if i.agent == AgentId::Codex {
                    t["type"] = value("http");
                }
                t["url"] = value(x.url.as_str());
                let mut h = Table::new();
                h["Authorization"] = value(format!("Bearer {}", b.expose()));
                t[if i.agent == AgentId::Codex {
                    "http_headers"
                } else {
                    "headers"
                }] = Item::Table(h);
                d["mcp_servers"][&id] = Item::Table(t);
            }
            out.push((
                path,
                d.to_string().into_bytes(),
                if i.agent == AgentId::Codex {
                    vec![
                        provider.into(),
                        "model".into(),
                        "model_provider".into(),
                        "Codex preferences".into(),
                        "Codex image generation".into(),
                        "mcp_servers".into(),
                    ]
                } else {
                    vec![provider.into(), "mcp_servers".into()]
                },
            ));
        }
    }
    Ok(out)
}

fn gateway_api_base(gateway: &url::Url, version: Option<&str>) -> String {
    let mut base = gateway.clone();
    let path = base.path().trim_end_matches('/');
    let route_root = ["/v1/models", "/v1beta/models", "/v1", "/v1beta"]
        .into_iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(path)
        .trim_end_matches('/');
    let path = version.map_or_else(
        || route_root.to_owned(),
        |version| format!("{route_root}/{version}"),
    );
    let path = if path.is_empty() {
        "/".to_owned()
    } else {
        path
    };
    base.set_path(&path);
    base.to_string().trim_end_matches('/').to_owned()
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::{
        ApplyInput, Connector, EffectiveAgentSelection, FileReceipt, ProjectionCoordinator,
        ProjectionLease, Receipt, durable_publish_bundle, edit_json, gateway_api_base, receipt_key,
        seal_receipt,
    };
    use crate::{AgentId, AgentInstall, ConnectionManifest, Provisioning, Secret, WireProtocol};
    use serde_json::json;
    use std::{collections::BTreeMap, fs};

    #[test]
    fn normalizes_protocol_api_bases_without_duplicate_versions() {
        for (input, native, v1, v1beta) in [
            (
                "https://gateway.example",
                "https://gateway.example",
                "https://gateway.example/v1",
                "https://gateway.example/v1beta",
            ),
            (
                "https://gateway.example/nested",
                "https://gateway.example/nested",
                "https://gateway.example/nested/v1",
                "https://gateway.example/nested/v1beta",
            ),
            (
                "https://gateway.example/v1",
                "https://gateway.example",
                "https://gateway.example/v1",
                "https://gateway.example/v1beta",
            ),
            (
                "https://gateway.example/v1/models",
                "https://gateway.example",
                "https://gateway.example/v1",
                "https://gateway.example/v1beta",
            ),
            (
                "https://gateway.example/nested/v1beta/models",
                "https://gateway.example/nested",
                "https://gateway.example/nested/v1",
                "https://gateway.example/nested/v1beta",
            ),
        ] {
            let input = input.parse().expect("test URL must parse");
            assert_eq!(gateway_api_base(&input, None), native);
            assert_eq!(gateway_api_base(&input, Some("v1")), v1);
            assert_eq!(gateway_api_base(&input, Some("v1beta")), v1beta);
        }
    }

    #[test]
    fn jsonc_removal_preserves_neighboring_comments_and_formatting() {
        let source = r#"{
  "theme": "dark", // unrelated theme comment
  "managed": {},
  "nested": {
    "keep": true, /* unrelated nested comment */
    "managed_one": {},
    "managed_two": {} // trailing local comment
  }
}
"#;
        let target = json!({"theme":"dark","nested":{"keep":true}});
        let edited = edit_json(source, &target).expect("surgical JSONC edit");

        assert!(
            edited.contains("  \"theme\": \"dark\", // unrelated theme comment"),
            "{edited}"
        );
        assert!(edited.contains("  \"nested\": {"), "{edited}");
        assert!(
            edited.contains("    \"keep\": true /* unrelated nested comment */"),
            "{edited}"
        );
        assert!(edited.contains("// trailing local comment"), "{edited}");
        assert_eq!(
            json5::from_str::<serde_json::Value>(&edited).expect("edited JSONC must parse"),
            target
        );
    }

    #[test]
    fn json_replaces_an_object_when_every_key_changes() {
        let source = r#"{"model":"Kimi K2.6","provider":{"platform-a":{"user":true},"mine":{}}}"#;
        let target = json!({
            "model": "platform-a/alpha",
            "provider": {
                "platform-a": {
                    "npm": "@ai-sdk/openai-compatible",
                    "options": {"apiKey": "secret", "baseURL": "https://gw.example/v1"},
                    "models": {"alpha": {"name": "alpha"}}
                },
                "mine": {}
            }
        });
        let edited = edit_json(source, &target).expect("replace leftover provider object");
        assert_eq!(
            json5::from_str::<serde_json::Value>(&edited).expect("edited JSON must parse"),
            target
        );
    }

    #[test]
    fn reapply_restores_auth_from_legacy_codex_receipt() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let root = fs::canonicalize(temporary.path()).expect("canonical temporary directory");
        let state = root.join("state");
        let coordinator = state.join("projection-coordinator");
        let codex = root.join("codex");
        fs::create_dir_all(state.join("receipts")).expect("receipt directory");
        fs::create_dir_all(&coordinator).expect("coordinator directory");
        fs::create_dir_all(&codex).expect("Codex directory");

        let auth = codex.join("auth.json");
        let original = br#"{"auth_mode":"chatgpt","tokens":{"access_token":"original"}}"#;
        let legacy_applied = br#"{"auth_mode":"apikey","OPENAI_API_KEY":"secret","tokens":{"access_token":"original"}}"#;
        fs::write(&auth, legacy_applied).expect("legacy projected account");

        let lease = ProjectionLease {
            platform_id: "platform-a".into(),
            agent: AgentId::Codex.as_str().into(),
            root: codex.clone(),
        };
        let receipt = Receipt {
            platform_id: "platform-a".into(),
            files: vec![FileReceipt {
                path: auth.clone(),
                original: Some(original.to_vec()),
                applied: legacy_applied.to_vec(),
            }],
            skills: Vec::new(),
            leases: vec![lease.clone()],
        };
        let bearer = Secret::new("secret").expect("bearer");
        let key = receipt_key(&bearer).expect("receipt key");
        fs::write(
            state.join("receipts/platform-a.json"),
            seal_receipt(&receipt, &key).expect("sealed receipt"),
        )
        .expect("legacy receipt");
        fs::write(
            coordinator.join("ownership.json"),
            serde_json::to_vec_pretty(&ProjectionCoordinator {
                leases: vec![lease],
            })
            .expect("ownership JSON"),
        )
        .expect("ownership state");

        let manifest = ConnectionManifest::parse(br#"{"success":true,"data":{"schema_version":2,"platform":{"id":"platform-a","name":"Platform A"},"authentication":{"type":"browser_pkce","authorize_url":"https://id.example/auth","token_url":"https://id.example/token"},"gateway":{"base_url":"https://gw.example","protocols":["openai_responses"]},"provisioning_url":"https://gw.example/provision","connection_bearer_origins":["https://gw.example"],"supported_agents":["codex"]}}"#).expect("manifest");
        let provisioning = Provisioning::parse(br#"{"success":true,"data":{"schema_version":2,"models":[{"id":"alpha","chat_capable":true,"responses_native":true}],"default_model":"alpha","mcp_servers":[],"skills":[]}}"#).expect("provisioning");
        let connector = Connector::new(&state);
        let plan = connector
            .plan(ApplyInput {
                manifest: &manifest,
                provisioning: &provisioning,
                bearer: &bearer,
                agents: BTreeMap::from([(
                    AgentId::Codex,
                    EffectiveAgentSelection::new("alpha", WireProtocol::OpenaiResponses),
                )]),
                installs: vec![AgentInstall {
                    agent: AgentId::Codex,
                    root: codex,
                    detected: true,
                }],
                synchronized_skills: BTreeMap::new(),
            })
            .expect("replacement plan");
        connector.apply(&plan).expect("replacement apply");

        assert_eq!(fs::read(auth).expect("restored account"), original);
        let receipt = connector
            .load_receipt("platform-a", &key)
            .expect("current receipt")
            .expect("managed projection");
        assert!(
            receipt
                .files
                .iter()
                .all(|file| file.path.file_name().and_then(|name| name.to_str())
                    != Some("auth.json"))
        );
    }

    #[test]
    fn bundle_publication_never_replaces_an_existing_destination() {
        let root = tempfile::tempdir().expect("temporary directory");
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        fs::create_dir(&source).expect("source directory");
        fs::write(source.join("manifest.enc"), b"source").expect("source manifest");
        fs::create_dir(&destination).expect("destination directory");

        assert!(durable_publish_bundle(&source, &destination).is_err());
        assert_eq!(
            fs::read(source.join("manifest.enc")).expect("source is preserved"),
            b"source"
        );
        assert!(destination.is_dir());
    }
}
fn receipt_key(secret: &Secret) -> Result<[u8; 32]> {
    let mut key = [0; 32];
    Hkdf::<Sha256>::new(
        Some(b"Gateway Connector receipt v2"),
        secret.expose().as_bytes(),
    )
    .expand(b"authenticated receipt", &mut key)
    .map_err(|_| Error::Transaction("could not derive receipt key".into()))?;
    Ok(key)
}
fn seal_receipt(receipt: &Receipt, key: &[u8; 32]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let plain = serde_json::to_vec(receipt).map_err(|e| Error::Transaction(e.to_string()))?;
    let ciphertext = cipher
        .encrypt(&nonce, plain.as_ref())
        .map_err(|_| Error::Transaction("receipt encryption failed".into()))?;
    serde_json::to_vec(&SealedReceipt {
        nonce: nonce.to_vec(),
        ciphertext,
    })
    .map_err(|e| Error::Transaction(e.to_string()))
}
fn ownership_marker() -> Vec<u8> {
    Aes256Gcm::generate_nonce(&mut OsRng).to_vec()
}
fn open_receipt(bytes: &[u8], key: &[u8; 32]) -> Result<Receipt> {
    let sealed: SealedReceipt = serde_json::from_slice(bytes)
        .map_err(|e| Error::Transaction(format!("invalid sealed receipt: {e}")))?;
    if sealed.nonce.len() != 12 {
        return Err(Error::Transaction("invalid receipt nonce".into()));
    }
    let cipher = Aes256Gcm::new(key.into());
    let nonce = aes_gcm::Nonce::from_slice(&sealed.nonce);
    let plain = cipher
        .decrypt(nonce, sealed.ciphertext.as_ref())
        .map_err(|_| Error::Transaction("receipt authentication failed".into()))?;
    serde_json::from_slice(&plain).map_err(|e| Error::Transaction(e.to_string()))
}
fn skill_matches(skill: &SkillReceipt) -> bool {
    matches!(skill.kind, SkillKind::Directory)
        && skill.path.is_dir()
        && !is_symlink(&skill.path)
        && fs::read(skill.path.join(SKILL_OWNER_FILE)).ok().as_deref()
            == Some(skill.marker.as_slice())
        && hash_skill_content(&skill.path).is_ok_and(|hash| hash == skill.applied_hash)
}

fn backup_op(root: &Path, path: &Path, bytes: &[u8]) -> Result<(PathBuf, Option<Op>)> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            Error::Validation(format!(
                "configuration has no file name: {}",
                path.display()
            ))
        })?;
    let digest = Sha256::digest(bytes);
    let suffix = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let backup = path.with_file_name(format!("{name}.boxai-backup-{suffix}"));
    match fs::read(&backup) {
        Ok(existing) if existing == bytes => Ok((backup, None)),
        Ok(_) => Err(Error::Transaction(format!(
            "configuration backup collision: {}",
            backup.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let op = Op::file(root, backup.clone(), bytes.to_vec())?;
            Ok((backup, Some(op)))
        }
        Err(error) => Err(io(&backup, error)),
    }
}

fn reconciled_file(file: &FileReceipt) -> Result<Option<Vec<u8>>> {
    let current = match fs::read(&file.path) {
        Ok(v) => v,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io(&file.path, error)),
    };
    if current == file.applied {
        return Ok(file.original.clone());
    }
    if file.original.as_deref() == Some(current.as_slice()) {
        return Ok(Some(current));
    }
    let original = file.original.as_deref().unwrap_or(b"{}");
    if matches!(
        file.path.extension().and_then(|x| x.to_str()),
        Some("json" | "jsonc")
    ) {
        let current_text = std::str::from_utf8(&current).map_err(|e| Error::Config {
            path: file.path.clone(),
            message: e.to_string(),
        })?;
        JsonSyntax::parse(current_text).map_err(|message| Error::Config {
            path: file.path.clone(),
            message,
        })?;
        let mut cur: Value = json5::from_str(current_text).map_err(|e| Error::Config {
            path: file.path.clone(),
            message: e.to_string(),
        })?;
        let original_text = std::str::from_utf8(original).map_err(|e| Error::Config {
            path: file.path.clone(),
            message: e.to_string(),
        })?;
        JsonSyntax::parse(original_text).map_err(|message| Error::Config {
            path: file.path.clone(),
            message,
        })?;
        let old: Value = json5::from_str(original_text).map_err(|e| Error::Config {
            path: file.path.clone(),
            message: e.to_string(),
        })?;
        let applied_text =
            std::str::from_utf8(&file.applied).map_err(|e| Error::Transaction(e.to_string()))?;
        JsonSyntax::parse(applied_text).map_err(|e| Error::Transaction(e.to_string()))?;
        let applied: Value =
            json5::from_str(applied_text).map_err(|e| Error::Transaction(e.to_string()))?;
        reconcile_json(&mut cur, Some(&old), &applied);
        return edit_json(current_text, &cur).map(|text| Some(text.into_bytes()));
    }
    if file
        .path
        .extension()
        .and_then(|extension| extension.to_str())
        == Some("toml")
    {
        let current_text = std::str::from_utf8(&current).map_err(|error| Error::Config {
            path: file.path.clone(),
            message: error.to_string(),
        })?;
        let mut current = match current_text.parse::<DocumentMut>() {
            Ok(current) => current,
            // The exact bytes are backed up before Apply. A malformed local
            // document must not permanently wedge a managed Agent.
            Err(_) => return Ok(file.original.clone()),
        };
        let original_text = std::str::from_utf8(file.original.as_deref().unwrap_or_default())
            .map_err(|error| Error::Config {
                path: file.path.clone(),
                message: error.to_string(),
            })?;
        let original = if original_text.trim().is_empty() {
            DocumentMut::new()
        } else {
            original_text.parse::<DocumentMut>().map_err(|error| {
                Error::Transaction(format!(
                    "invalid original TOML receipt for {}: {error}",
                    file.path.display()
                ))
            })?
        };
        let applied_text = std::str::from_utf8(&file.applied)
            .map_err(|error| Error::Transaction(error.to_string()))?;
        let applied = applied_text.parse::<DocumentMut>().map_err(|error| {
            Error::Transaction(format!(
                "invalid applied TOML receipt for {}: {error}",
                file.path.display()
            ))
        })?;
        reconcile_toml(
            current.as_table_mut(),
            Some(original.as_table()),
            applied.as_table(),
        );
        return Ok(Some(current.to_string().into_bytes()));
    }
    // Other text formats are replaced directly. Their exact pre-overwrite
    // bytes are kept in a user-visible sibling backup.
    Ok(file.original.clone())
}

fn reconcile_json(current: &mut Value, original: Option<&Value>, applied: &Value) {
    let (Some(cur), Some(app)) = (current.as_object_mut(), applied.as_object()) else {
        return;
    };
    let old = original.and_then(Value::as_object);
    for (key, applied_value) in app {
        let old_value = old.and_then(|o| o.get(key));
        if old_value == Some(applied_value) {
            continue;
        }
        let nested = cur.get(key).is_some_and(Value::is_object)
            && applied_value.is_object()
            && old_value.is_none_or(Value::is_object);
        if nested {
            let value = cur.get_mut(key).expect("checked current JSON member");
            reconcile_json(value, old_value, applied_value);
            if old_value.is_none() && value.as_object().is_some_and(Map::is_empty) {
                cur.remove(key);
            }
        } else {
            match old_value {
                Some(value) => {
                    cur.insert(key.clone(), value.clone());
                }
                None => {
                    cur.remove(key);
                }
            }
        }
    }
}

fn reconcile_toml(current: &mut Table, original: Option<&Table>, applied: &Table) {
    let keys = applied
        .iter()
        .map(|(key, _)| key.to_owned())
        .collect::<Vec<_>>();
    for key in keys {
        let applied_value = applied
            .get(&key)
            .expect("key collected from applied TOML table");
        let original_value = original.and_then(|table| table.get(&key));
        if original_value.is_some_and(|value| value.to_string() == applied_value.to_string()) {
            continue;
        }
        let nested = current.get(&key).and_then(Item::as_table).is_some()
            && applied_value.as_table().is_some()
            && original_value.is_none_or(|value| value.as_table().is_some());
        if nested {
            let table = current
                .get_mut(&key)
                .and_then(Item::as_table_mut)
                .expect("checked current TOML table");
            reconcile_toml(
                table,
                original_value.and_then(Item::as_table),
                applied_value
                    .as_table()
                    .expect("checked applied TOML table"),
            );
            if original_value.is_none() && table.is_empty() {
                current.remove(&key);
            }
        } else {
            match original_value {
                Some(value) => {
                    current.insert(&key, value.clone());
                }
                None => {
                    current.remove(&key);
                }
            }
        }
    }
}
fn grok_context_window(document: &DocumentMut, provider: &str) -> i64 {
    document
        .get("model")
        .and_then(Item::as_table)
        .and_then(|models| models.get(provider))
        .and_then(Item::as_table)
        .and_then(|model| model.get("context_window"))
        .and_then(Item::as_integer)
        .filter(|value| *value > 0)
        .unwrap_or(GROK_DEFAULT_CONTEXT_WINDOW)
}

fn toml_context_window(document: &DocumentMut) -> Option<u64> {
    document
        .get("model_context_window")
        .and_then(Item::as_integer)
        .and_then(|value| u64::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn codex_catalog_template() -> Value {
    serde_json::from_str(include_str!(
        "resources/codex_native_responses_template.json"
    ))
    .expect("bundled Codex native-responses template must be valid JSON")
}

fn codex_catalog_document(
    models: &BTreeSet<String>,
    catalog: &[Model],
    context_window: Option<u64>,
) -> Vec<u8> {
    let template = codex_catalog_template();
    let entries = models
        .iter()
        .enumerate()
        .map(|(index, id)| {
            let mut entry = template.clone();
            let object = entry
                .as_object_mut()
                .expect("Codex catalog template is an object");
            object.insert("slug".into(), json!(id));
            object.insert("display_name".into(), json!(id));
            object.insert("description".into(), json!(id));
            object.insert("priority".into(), json!(1000 + index));
            let reasoning = catalog
                .iter()
                .find(|model| model.id == *id)
                .map(|model| model.supported_reasoning.as_slice())
                .unwrap_or_default();
            object.insert(
                "supported_reasoning_levels".into(),
                Value::Array(
                    reasoning
                        .iter()
                        .map(|effort| {
                            json!({
                                "effort": effort,
                                "description": format!("Reasoning effort: {effort}"),
                            })
                        })
                        .collect(),
                ),
            );
            if reasoning.is_empty() {
                object.remove("default_reasoning_level");
            } else {
                object.insert(
                    "default_reasoning_level".into(),
                    json!(reasoning[(reasoning.len() - 1) / 2]),
                );
            }
            if let Some(window) = context_window {
                object.insert("context_window".into(), json!(window));
                object.insert("max_context_window".into(), json!(window));
            }
            entry
        })
        .collect::<Vec<_>>();
    serde_json::to_vec_pretty(&json!({ "models": entries })).expect("catalog JSON")
}
fn lease_key(lease: &ProjectionLease) -> String {
    let owned_path = if lease.agent == AgentId::Claude.as_str() {
        if lease.root.file_name().and_then(|name| name.to_str()) == Some(".claude") {
            lease
                .root
                .parent()
                .unwrap_or(&lease.root)
                .join(".claude.json")
        } else {
            lease.root.join(".claude.json")
        }
    } else {
        lease.root.clone()
    };
    format!(
        "{}:{}",
        lease.agent,
        owned_path
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase()
    )
}
fn claim_path(paths: &mut BTreeSet<String>, path: &Path) -> Result<()> {
    // Conservatively case-fold on every platform so a plan prepared on Linux
    // cannot become colliding when the same roots are used on Windows/macOS.
    let key = path.to_string_lossy().to_lowercase();
    if paths.insert(key) {
        Ok(())
    } else {
        Err(Error::Validation(format!(
            "multiple Agent projections resolve to the same path: {}",
            path.display()
        )))
    }
}
fn snapshot_file(path: &Path) -> Result<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(hash_bytes(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io(path, error)),
    }
}
fn snapshot_skill(path: &Path) -> Result<Option<Vec<u8>>> {
    if exists(path) {
        hash_dir(path).map(Some)
    } else {
        Ok(None)
    }
}
fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| is_reparse(&metadata))
}
fn read_text_projection(path: &Path, bases: &BTreeMap<PathBuf, Vec<u8>>) -> Result<String> {
    match bases.get(path) {
        Some(bytes) => String::from_utf8(bytes.clone()).map_err(|error| Error::Config {
            path: path.into(),
            message: error.to_string(),
        }),
        None if path.exists() => fs::read_to_string(path).map_err(|error| io(path, error)),
        None => Ok(String::new()),
    }
}

#[derive(Clone)]
struct JsonSyntax {
    start: usize,
    end: usize,
    object: Option<JsonObject>,
}
#[derive(Clone)]
struct JsonObject {
    close: usize,
    members: Vec<JsonMember>,
}
#[derive(Clone)]
struct JsonMember {
    key: String,
    start: usize,
    comma: Option<usize>,
    value: JsonSyntax,
}
struct JsonParser<'a> {
    text: &'a str,
    at: usize,
}
impl JsonSyntax {
    fn parse(text: &str) -> std::result::Result<Self, String> {
        let mut parser = JsonParser { text, at: 0 };
        parser.trivia()?;
        let node = parser.value()?;
        parser.trivia()?;
        if parser.at != text.len() {
            return Err("unsupported content after JSON value".into());
        }
        Ok(node)
    }
}
impl JsonParser<'_> {
    fn trivia(&mut self) -> std::result::Result<(), String> {
        loop {
            while self.peek().is_some_and(|byte| byte.is_ascii_whitespace()) {
                self.at += 1;
            }
            if self.rest().starts_with("//") {
                self.at += 2;
                while self.peek().is_some_and(|b| b != b'\n') {
                    self.at += 1;
                }
            } else if self.rest().starts_with("/*") {
                let Some(n) = self.rest()[2..].find("*/") else {
                    return Err("unterminated JSON comment".into());
                };
                self.at += n + 4;
            } else {
                return Ok(());
            }
        }
    }
    fn value(&mut self) -> std::result::Result<JsonSyntax, String> {
        self.trivia()?;
        let start = self.at;
        let object =
            match self.peek() {
                Some(b'{') => Some(self.object()?),
                Some(b'[') => {
                    self.array()?;
                    None
                }
                Some(b'"') => {
                    self.string()?;
                    None
                }
                Some(b'-' | b'0'..=b'9') => {
                    self.number()?;
                    None
                }
                _ if self.rest().starts_with("true") => {
                    self.at += 4;
                    None
                }
                _ if self.rest().starts_with("false") => {
                    self.at += 5;
                    None
                }
                _ if self.rest().starts_with("null") => {
                    self.at += 4;
                    None
                }
                _ => return Err(
                    "unsupported JSON/JSONC construct (keys and strings must use double quotes)"
                        .into(),
                ),
            };
        Ok(JsonSyntax {
            start,
            end: self.at,
            object,
        })
    }
    fn object(&mut self) -> std::result::Result<JsonObject, String> {
        self.at += 1;
        let mut members = Vec::new();
        let mut keys = BTreeSet::new();
        loop {
            self.trivia()?;
            if self.peek() == Some(b'}') {
                let close = self.at;
                self.at += 1;
                return Ok(JsonObject { close, members });
            }
            let start = self.at;
            if self.peek() != Some(b'"') {
                return Err("object keys must use double quotes".into());
            }
            let key_start = self.at;
            self.string()?;
            let key: String =
                serde_json::from_str(&self.text[key_start..self.at]).map_err(|e| e.to_string())?;
            if !keys.insert(key.clone()) {
                return Err(format!("duplicate object key `{key}`"));
            }
            self.trivia()?;
            if self.peek() != Some(b':') {
                return Err("expected `:` after object key".into());
            }
            self.at += 1;
            let value = self.value()?;
            self.trivia()?;
            let comma = if self.peek() == Some(b',') {
                let p = self.at;
                self.at += 1;
                Some(p)
            } else {
                None
            };
            members.push(JsonMember {
                key,
                start,
                comma,
                value,
            });
            if comma.is_none() {
                self.trivia()?;
                if self.peek() != Some(b'}') {
                    return Err("expected `,` or `}`".into());
                }
            }
        }
    }
    fn array(&mut self) -> std::result::Result<(), String> {
        self.at += 1;
        loop {
            self.trivia()?;
            if self.peek() == Some(b']') {
                self.at += 1;
                return Ok(());
            }
            self.value()?;
            self.trivia()?;
            if self.peek() == Some(b',') {
                self.at += 1;
            } else if self.peek() != Some(b']') {
                return Err("expected `,` or `]`".into());
            }
        }
    }
    fn string(&mut self) -> std::result::Result<(), String> {
        self.at += 1;
        while let Some(b) = self.peek() {
            self.at += 1;
            if b == b'"' {
                return Ok(());
            }
            if b == b'\\' {
                if self.peek().is_none() {
                    break;
                }
                self.at += 1;
            } else if b < 0x20 {
                return Err("control character in JSON string".into());
            }
        }
        Err("unterminated JSON string".into())
    }
    fn number(&mut self) -> std::result::Result<(), String> {
        let start = self.at;
        while self
            .peek()
            .is_some_and(|b| b.is_ascii_digit() || matches!(b, b'-' | b'+' | b'.' | b'e' | b'E'))
        {
            self.at += 1;
        }
        serde_json::from_str::<serde_json::Number>(&self.text[start..self.at])
            .map(|_| ())
            .map_err(|_| "unsupported JSON number".into())
    }
    fn peek(&self) -> Option<u8> {
        self.text.as_bytes().get(self.at).copied()
    }
    fn rest(&self) -> &str {
        &self.text[self.at..]
    }
}

fn edit_json(source: &str, target: &Value) -> Result<String> {
    let syntax = JsonSyntax::parse(source).map_err(Error::Transaction)?;
    let original: Value = json5::from_str(source).map_err(|e| Error::Transaction(e.to_string()))?;
    let mut edits = Vec::new();
    collect_json_edits(source, &syntax, &original, target, &mut edits)?;
    edits.sort_by_key(|edit| edit.0);
    edits.dedup();
    let mut out = source.to_owned();
    for (start, end, replacement) in edits.into_iter().rev() {
        out.replace_range(start..end, &replacement);
    }
    Ok(out)
}
fn collect_json_edits(
    source: &str,
    syntax: &JsonSyntax,
    old: &Value,
    new: &Value,
    edits: &mut Vec<(usize, usize, String)>,
) -> Result<()> {
    if old == new {
        return Ok(());
    }
    let (Some(object), Some(old_map), Some(new_map)) =
        (&syntax.object, old.as_object(), new.as_object())
    else {
        edits.push((
            syntax.start,
            syntax.end,
            serde_json::to_string_pretty(new).map_err(|e| Error::Transaction(e.to_string()))?,
        ));
        return Ok(());
    };
    for member in &object.members {
        match new_map.get(&member.key) {
            Some(value) => {
                collect_json_edits(source, &member.value, &old_map[&member.key], value, edits)?
            }
            None => {
                edits.push((member.start, member.value.end, String::new()));
            }
        }
    }
    for (index, member) in object.members.iter().enumerate() {
        let Some(comma) = member.comma else {
            continue;
        };
        let retained = new_map.contains_key(&member.key);
        let later_retained = object.members[index + 1..]
            .iter()
            .any(|later| new_map.contains_key(&later.key));
        let original_trailing_comma = index + 1 == object.members.len();
        if !(retained && (later_retained || original_trailing_comma)) {
            edits.push((comma, comma + 1, String::new()));
        }
    }
    let added: Vec<_> = new_map
        .iter()
        .filter(|(key, _)| !old_map.contains_key(*key))
        .collect();
    if !added.is_empty() {
        let multiline = source[syntax.start..object.close].contains('\n');
        let indent = if multiline {
            object
                .members
                .first()
                .map(|m| &source[source[..m.start].rfind('\n').map_or(m.start, |p| p + 1)..m.start])
                .unwrap_or("  ")
        } else {
            ""
        };
        let mut insertion = String::new();
        let last_retained = object
            .members
            .iter()
            .rev()
            .find(|member| new_map.contains_key(&member.key));
        let needs_comma = last_retained.is_some_and(|member| {
            let is_last_original = object
                .members
                .last()
                .is_some_and(|last| last.start == member.start);
            !(is_last_original && member.comma.is_some())
        });
        if needs_comma {
            insertion.push(',');
        }
        for (i, (key, value)) in added.iter().enumerate() {
            if multiline {
                insertion.push('\n');
                insertion.push_str(indent);
            } else if !object.members.is_empty() || i > 0 {
                insertion.push(' ');
            }
            insertion.push_str(
                &serde_json::to_string(key).map_err(|e| Error::Transaction(e.to_string()))?,
            );
            insertion.push_str(if multiline { ": " } else { ":" });
            insertion.push_str(
                &serde_json::to_string(value).map_err(|e| Error::Transaction(e.to_string()))?,
            );
            if i + 1 < added.len() {
                insertion.push(',');
            }
        }
        edits.push((object.close, object.close, insertion));
    }
    Ok(())
}
fn read_json_projection(
    path: &Path,
    json5_ok: bool,
    bases: &BTreeMap<PathBuf, Vec<u8>>,
) -> Result<JsonProjection> {
    let s = read_text_projection(path, bases)?;
    if s.trim().is_empty() {
        return Ok(JsonProjection {
            value: json!({}),
            source: None,
        });
    }
    if json5_ok {
        let value = json5::from_str(&s).map_err(|e| Error::Config {
            path: path.into(),
            message: e.to_string(),
        })?;
        JsonSyntax::parse(&s).map_err(|message| Error::Config {
            path: path.into(),
            message,
        })?;
        Ok(JsonProjection {
            value,
            source: Some(s),
        })
    } else {
        let value = serde_json::from_str(&s).map_err(|e| Error::Config {
            path: path.into(),
            message: e.to_string(),
        })?;
        JsonSyntax::parse(&s).map_err(|message| Error::Config {
            path: path.into(),
            message,
        })?;
        Ok(JsonProjection {
            value,
            source: Some(s),
        })
    }
}
fn read_toml_projection(path: &Path, bases: &BTreeMap<PathBuf, Vec<u8>>) -> Result<DocumentMut> {
    let s = read_text_projection(path, bases)?;
    if s.trim().is_empty() {
        Ok(DocumentMut::new())
    } else {
        s.parse::<DocumentMut>().map_err(|e| Error::Config {
            path: path.into(),
            message: e.to_string(),
        })
    }
}
fn ensure_table(doc: &mut DocumentMut, key: &str) {
    if !doc.get(key).is_some_and(Item::is_table) {
        doc[key] = Item::Table(Table::new());
    }
}
fn obj<'a>(v: &'a mut Value, key: &str) -> Result<&'a mut Map<String, Value>> {
    if v.get(key).is_none() {
        v[key] = json!({});
    }
    v.get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| Error::Validation(format!("{key} must be an object")))
}
fn file(
    path: PathBuf,
    v: JsonProjection,
    e: Vec<String>,
) -> Result<(PathBuf, Vec<u8>, Vec<String>)> {
    let bytes = match v.source {
        Some(source) => edit_json(&source, &v.value)?.into_bytes(),
        None => {
            serde_json::to_vec_pretty(&v.value).map_err(|x| Error::Transaction(x.to_string()))?
        }
    };
    Ok((path, bytes, e))
}
const IMAGE_DIRECT_ENV_KEYS: &[&str] = &["OPENAI_BASE_URL", "OPENAI_API_KEY"];

fn env_line_key(line: &str) -> Option<&str> {
    line.split_once('=').map(|(key, _)| key)
}

fn strip_env_keys(old: &str, keys: &[&str]) -> String {
    let lines: Vec<String> = old
        .lines()
        .filter(|line| env_line_key(line).is_none_or(|key| !keys.contains(&key)))
        .map(str::to_owned)
        .collect();
    if lines.is_empty() {
        return String::new();
    }
    lines.join("\n") + "\n"
}

fn merge_env(old: &str, items: &[(&str, &str)]) -> String {
    let mut lines: Vec<String> = old
        .lines()
        .filter(|l| !items.iter().any(|(k, _)| l.starts_with(&format!("{k}="))))
        .map(str::to_owned)
        .collect();
    lines.extend(
        items
            .iter()
            .map(|(key, value)| format!("{key}={}", dotenv_value(value))),
    );
    lines.join("\n") + "\n"
}
fn dotenv_value(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "\\$")
    )
}
#[cfg_attr(windows, allow(unsafe_code))]
fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_with_failpoint(path, bytes, None)
}

#[cfg_attr(windows, allow(unsafe_code))]
fn atomic_with_failpoint(
    path: &Path,
    bytes: &[u8],
    before_rename_failpoint: Option<&str>,
) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Transaction("path has no parent".into()))?;
    reject_absolute_reparse_components(parent)?;
    fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
    reject_absolute_reparse_components(parent)?;
    reject_absolute_reparse_components(path)?;
    let temp = parent.join(format!(".connector-{}.tmp", uuid::Uuid::new_v4()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let write = (|| -> std::io::Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()
        })();
        if let Err(error) = write {
            let _ = fs::remove_file(&temp);
            return Err(io(&temp, error));
        }
    }
    #[cfg(not(unix))]
    {
        let write = (|| -> std::io::Result<()> {
            use std::io::Write as _;
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.custom_flags(
                    windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT,
                );
            }
            let mut file = options.open(&temp)?;
            file.write_all(bytes)?;
            file.sync_all()
        })();
        if let Err(error) = write {
            let _ = fs::remove_file(&temp);
            return Err(io(&temp, error));
        }
    }
    if let Some(failpoint) = before_rename_failpoint {
        maybe_failpoint(failpoint);
    }
    #[cfg(not(windows))]
    {
        match fs::rename(&temp, path) {
            Ok(()) => sync_parent(path),
            Err(error) => {
                let _ = fs::remove_file(&temp);
                Err(io(path, error))
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // MoveFileExW replaces in-place without a remove/rename visibility gap.
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            let error = std::io::Error::last_os_error();
            let _ = fs::remove_file(&temp);
            Err(io(path, error))
        } else {
            sync_parent(path)
        }
    }
}

fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        let Some(parent) = path.parent() else {
            return Ok(());
        };
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| io(parent, error))?;
    }
    #[cfg(windows)]
    let _ = path;
    // Windows has no documented POSIX-equivalent parent-directory fsync.
    // File writes are flushed and renames use MOVEFILE_WRITE_THROUGH instead.
    Ok(())
}

fn sync_tree(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| io(path, error))?;
    if is_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(Error::Validation(format!(
            "cannot sync a special filesystem entry: {}",
            path.display()
        )));
    }
    if metadata.is_file() {
        #[cfg(unix)]
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| io(path, error))?;
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|error| io(path, error))? {
        let entry = entry.map_err(|error| io(path, error))?;
        sync_tree(&entry.path())?;
    }
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io(path, error))?;
    Ok(())
}

#[allow(unsafe_code)]
fn durable_publish_bundle(from: &Path, to: &Path) -> Result<()> {
    if from.parent() != to.parent() {
        return Err(Error::Transaction(
            "durable bundle publication must stay within one parent".into(),
        ));
    }
    reject_absolute_reparse_components(from)?;
    reject_absolute_reparse_components(to)?;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let from_name = CString::new(from.as_os_str().as_bytes())
            .map_err(|_| Error::Transaction("bundle path contains a NUL byte".into()))?;
        let to_name = CString::new(to.as_os_str().as_bytes())
            .map_err(|_| Error::Transaction("bundle path contains a NUL byte".into()))?;
        if unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from_name.as_ptr(),
                libc::AT_FDCWD,
                to_name.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        } != 0
        {
            return Err(io(from, std::io::Error::last_os_error()));
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let from_name = CString::new(from.as_os_str().as_bytes())
            .map_err(|_| Error::Transaction("bundle path contains a NUL byte".into()))?;
        let to_name = CString::new(to.as_os_str().as_bytes())
            .map_err(|_| Error::Transaction("bundle path contains a NUL byte".into()))?;
        if unsafe { libc::renamex_np(from_name.as_ptr(), to_name.as_ptr(), libc::RENAME_EXCL) } != 0
        {
            return Err(io(from, std::io::Error::last_os_error()));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
        let from_wide = from
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let to_wide = to
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        if unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0
        {
            return Err(io(from, std::io::Error::last_os_error()));
        }
    }
    #[cfg(all(
        unix,
        not(any(target_os = "linux", target_os = "android", target_os = "macos"))
    ))]
    return Err(Error::Transaction(
        "exclusive durable bundle publication is unsupported on this platform".into(),
    ));
    sync_parent(to)
}

#[cfg_attr(windows, allow(unsafe_code))]
fn durable_rename(from: &Path, to: &Path) -> Result<()> {
    if from.parent() != to.parent() {
        return Err(Error::Transaction(
            "durable projection rename must stay within one parent".into(),
        ));
    }
    reject_absolute_reparse_components(from)?;
    reject_absolute_reparse_components(to)?;
    #[cfg(not(windows))]
    fs::rename(from, to).map_err(|error| io(from, error))?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
        let from_wide = from
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let to_wide = to
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        if unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0
        {
            return Err(io(from, std::io::Error::last_os_error()));
        }
    }
    sync_parent(to)
}

fn durable_remove_empty_dir(path: &Path) -> Result<()> {
    reject_absolute_reparse_components(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|error| io(path, error))?;
    if is_reparse(&metadata) || !metadata.is_dir() {
        return Err(Error::Validation(format!(
            "refusing to remove a special temporary bundle: {}",
            path.display()
        )));
    }
    fs::remove_dir(path).map_err(|error| io(path, error))?;
    sync_parent(path)
}

fn durable_remove_any(path: &Path) -> Result<()> {
    remove_any(path)?;
    sync_parent(path)
}

#[cfg(debug_assertions)]
fn maybe_failpoint(name: &str) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static MATCHES: AtomicUsize = AtomicUsize::new(0);
    if std::env::var_os("GATEWAY_CONNECTOR_CRASH_CHILD_ROOT").is_none() {
        return;
    }
    let Ok(value) = std::env::var("GATEWAY_CONNECTOR_TEST_FAILPOINT") else {
        return;
    };
    let (requested, occurrence) = value
        .rsplit_once(':')
        .and_then(|(name, occurrence)| occurrence.parse::<usize>().ok().map(|n| (name, n)))
        .unwrap_or((value.as_str(), 1));
    if requested == name && MATCHES.fetch_add(1, Ordering::SeqCst) + 1 == occurrence {
        std::process::abort();
    }
}

#[cfg(not(debug_assertions))]
fn maybe_failpoint(_name: &str) {}

fn remove_any(p: &Path) -> Result<()> {
    if !exists(p) {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(p).map_err(|e| io(p, e))?;
    if is_reparse(&metadata) {
        return Err(Error::Validation(format!(
            "refusing to remove a symlink or reparse point: {}",
            p.display()
        )));
    }
    if metadata.is_dir() {
        validate_plain_tree(p)?;
        fs::remove_dir_all(p)
    } else {
        fs::remove_file(p)
    }
    .map_err(|e| io(p, e))
}

fn validate_plain_tree(directory: &Path) -> Result<()> {
    for entry in fs::read_dir(directory).map_err(|error| io(directory, error))? {
        let entry = entry.map_err(|error| io(directory, error))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
        if is_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
            return Err(Error::Validation(format!(
                "refusing to remove a tree containing a symlink, reparse point, or special entry: {}",
                path.display()
            )));
        }
        if metadata.is_dir() {
            validate_plain_tree(&path)?;
        }
    }
    Ok(())
}
fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}
fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash_dir(path: &Path) -> Result<Vec<u8>> {
    hash_tree(path, false)
}
fn hash_skill_content(path: &Path) -> Result<Vec<u8>> {
    hash_tree(path, true)
}
fn hash_tree(p: &Path, skip_owner: bool) -> Result<Vec<u8>> {
    type Entry = (Vec<u8>, u8, bool, Vec<u8>);
    let mut entries = Vec::new();
    fn walk(base: &Path, directory: &Path, skip_owner: bool, out: &mut Vec<Entry>) -> Result<()> {
        for entry in fs::read_dir(directory).map_err(|error| io(directory, error))? {
            let entry = entry.map_err(|error| io(directory, error))?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| io(&path, error))?;
            let relative = path
                .strip_prefix(base)
                .map_err(|_| Error::Transaction("invalid Skill tree path".into()))?;
            if skip_owner && relative == Path::new(SKILL_OWNER_FILE) {
                continue;
            }
            let name = os_bytes(relative.as_os_str());
            if is_reparse(&metadata) {
                return Err(Error::Validation(format!(
                    "unsupported symlink or reparse point in Skill: {}",
                    path.display()
                )));
            } else if metadata.is_dir() {
                out.push((name, b'D', false, Vec::new()));
                walk(base, &path, skip_owner, out)?;
            } else if metadata.is_file() {
                out.push((
                    name,
                    b'F',
                    executable(&metadata),
                    fs::read(&path).map_err(|error| io(&path, error))?,
                ));
            } else {
                return Err(Error::Validation(format!(
                    "unsupported entry in synchronized Skill: {}",
                    path.display()
                )));
            }
        }
        Ok(())
    }
    walk(p, p, skip_owner, &mut entries)?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut h = Sha256::new();
    h.update((entries.len() as u64).to_be_bytes());
    for (path, kind, executable, payload) in entries {
        h.update([kind]);
        h.update([u8::from(executable)]);
        h.update((path.len() as u64).to_be_bytes());
        h.update(path);
        h.update((payload.len() as u64).to_be_bytes());
        h.update(payload);
    }
    Ok(h.finalize().to_vec())
}

#[cfg(unix)]
fn executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(windows)]
fn executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn os_bytes(value: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    value.as_bytes().to_vec()
}

#[cfg(windows)]
fn os_bytes(value: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    value
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>()
}
