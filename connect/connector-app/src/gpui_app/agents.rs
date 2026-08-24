use std::path::Path;

use gateway_connector_core::{AgentId, CodexApprovalPolicy, CodexSandboxMode, Protocol};
use gpui::{Context, IntoElement, ParentElement, WeakEntity};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::TypeScale;

use crate::{AppState, AsyncStatus, ProjectionSemantic, app::Action};

use super::chrome::page_column;
use super::controls::{CodexSetting, agent_logo, codex_setting_label};
use super::host::ConnectorHost;

impl ConnectorHost {
    pub(crate) fn render_agents(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { .. } = &self.state else {
            unreachable!("connected renderer requires connected state")
        };
        self.render_selected_agent(cx)
    }

    fn render_selected_agent(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected {
            connection,
            installs,
            projection,
            ..
        } = &self.state
        else {
            unreachable!("connected renderer requires connected state")
        };
        let agent = self.selected_agent;
        let theme = cx.theme().clone();
        let locale = self.preferences.locale;
        let models = &connection.models;
        let projection_semantic = projection.semantic();
        let install = installs
            .value
            .as_ref()
            .and_then(|values| values.iter().find(|install| install.agent == agent));
        let detected = install.is_some_and(|install| install.detected);
        let selection = &connection.profile.agents[&agent];
        let dirty = self.agent_has_unapplied_edits(agent);
        let managed = self.agent_is_managed(agent);
        let location = install
            .map(|install| install.root.display().to_string())
            .unwrap_or_else(|| locale.text("Checking standard root…").into());
        let availability = match &installs.status {
            AsyncStatus::Idle | AsyncStatus::Loading if installs.value.is_none() => {
                locale.text("Unknown").into()
            }
            AsyncStatus::Error(error) if installs.value.is_none() => {
                format!("{} {error}", locale.text("Error:"))
            }
            _ if detected => locale.text("Detected").into(),
            _ => locale.text("Not detected").into(),
        };
        let ownership = match (&installs.status, managed) {
            (_, true) => locale.text("Managed by this connection").into(),
            (AsyncStatus::Idle | AsyncStatus::Loading, false) if installs.value.is_none() => {
                locale.text("Unknown").into()
            }
            (AsyncStatus::Error(error), false) if installs.value.is_none() => {
                format!("{} {error}", locale.text("Error:"))
            }
            _ => locale.text("Not managed").into(),
        };

        let apply_enabled = self.agent_apply_enabled(agent);
        let apply = agent_apply_button(
            format!("connector.{}.apply", agent.as_str()),
            locale,
            apply_enabled,
            self.projection_busy,
            agent,
            cx.entity().downgrade(),
        );

        let availability_tone = match &installs.status {
            AsyncStatus::Error(_) if installs.value.is_none() => Tone::Danger,
            _ if detected => Tone::Success,
            _ => Tone::Warning,
        };
        let mut header = ListRow::new()
            .id(format!("connector.{}.header", agent.as_str()))
            .leading(agent_logo(
                format!("connector.{}.logo", agent.as_str()),
                agent,
                32.0,
            ))
            .child(text(&theme, TypeScale::Strong, agent.display_name()))
            .child(
                StatusLine::new(availability, availability_tone)
                    .id(format!("connector.{}.availability", agent.as_str())),
            );
        if managed {
            header = header.child(Badge::new(locale.text("Managed by this connection")).accent());
        }
        header = header.trailing(apply);

        let detected_count = installs
            .value
            .as_ref()
            .map(|values| values.iter().filter(|install| install.detected).count());
        let mut children = vec![
            self.page_banner(
                &theme,
                "Agents",
                Some(gpui::SharedString::from(match detected_count {
                    Some(count) => format!(
                        "{count} / {} {}",
                        self.distribution.supported_agents.len(),
                        locale.text("Detected")
                    ),
                    None => locale.text("Checking standard root…").to_owned(),
                })),
                "connector.agents.refresh",
                cx,
            ),
            Card::new()
                .id(format!("connector.{}.identity", agent.as_str()))
                .padded(true)
                .child(header)
                .children(dirty.then(|| {
                    StatusLine::new(locale.text("Unapplied changes"), Tone::Warning)
                        .id(format!("connector.{}.unapplied", agent.as_str()))
                }))
                .into_any_element(),
            self.render_connection_card(agent, cx),
        ];
        if agent == AgentId::Codex {
            children.push(self.render_codex_catalog_card(cx));
            children.push(self.render_codex_runtime_card(cx));
        }
        children.push(self.render_image_card(agent, selection, cx));
        children.push(self.render_agent_mcp_card(agent, cx));
        children.push(self.render_agent_skills_card(agent, cx));
        children.push(self.render_destination_card(
            agent,
            &ownership,
            &location,
            detected,
            managed,
            dirty,
            models.is_empty(),
            projection_semantic,
            install.map(|install| install.root.as_path()),
            !selection.codex.catalog_models.is_empty(),
            cx,
        ));
        page_column(&theme, children)
    }

    fn render_connection_card(&self, agent: AgentId, _cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("connection card requires connected state")
        };
        let locale = self.preferences.locale;
        let model = self
            .model_selects
            .iter()
            .find(|(candidate, _)| *candidate == agent)
            .expect("all Agent model selects exist")
            .1
            .clone();
        let protocol = self
            .protocol_selects
            .iter()
            .find(|(candidate, _)| *candidate == agent)
            .expect("all Agent protocol selects exist")
            .1
            .clone();
        let mut section = SettingsSection::new(
            format!("connector.{}.connection-settings", agent.as_str()),
            locale.text("Connection"),
        )
        .description(locale.text(
            "Choose what this Agent uses. Gateway address and credentials stay managed by BoxAI Connect.",
        ))
        .row(
            SettingsRow::new(
                format!("connector.{}.model", agent.as_str()),
                locale.text("Default model"),
            )
            .description(locale.text("Used for new sessions unless the Agent overrides it."))
            .control(model),
        );
        section = if agent.supported_wire_protocols().len() == 1 {
            let name = match agent.supported_wire_protocols()[0] {
                gateway_connector_core::WireProtocol::Anthropic => {
                    locale.text(Protocol::Anthropic.display_name())
                }
                gateway_connector_core::WireProtocol::OpenaiResponses => {
                    locale.text("Responses API")
                }
                gateway_connector_core::WireProtocol::Gemini => {
                    locale.text(Protocol::Gemini.display_name())
                }
                gateway_connector_core::WireProtocol::OpenaiChat => {
                    locale.text(Protocol::OpenaiChat.display_name())
                }
            };
            section.row(
                SettingsRow::new(
                    format!("connector.{}.protocol", agent.as_str()),
                    locale.text("Protocol"),
                )
                .value(name),
            )
        } else {
            section.row(
                SettingsRow::new(
                    format!("connector.{}.protocol", agent.as_str()),
                    locale.text("Protocol"),
                )
                .description(locale.text(
                    "Automatic chooses the first protocol supported by both the Agent and Gateway.",
                ))
                .control(protocol),
            )
        };
        section = section.row(
            SettingsRow::new(
                format!("connector.{}.gateway", agent.as_str()),
                locale.text("Gateway"),
            )
            .value(connection.profile.base_url.to_string()),
        );
        section.into_any_element()
    }

    fn render_codex_catalog_card(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("Codex catalog card requires connected state")
        };
        let locale = self.preferences.locale;
        let selection = &connection.profile.agents[&AgentId::Codex];
        let default_model = selection
            .default_model
            .clone()
            .or_else(|| {
                connection
                    .provisioning
                    .as_ref()
                    .map(|value| value.default_model.clone())
            })
            .unwrap_or_default();
        let chat_models = connection
            .provisioning
            .as_ref()
            .map(|value| {
                value
                    .models
                    .iter()
                    .filter(|model| model.is_codex_catalog_model())
                    .map(|model| (model.id.clone(), model.is_responses_native()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if chat_models.is_empty() {
            return Card::new()
                .id("connector.codex.catalog-settings")
                .variant(CardVariant::Ghost)
                .header(
                    CardHeader::new(locale.text("Codex model list")).subtitle(locale.text(
                        "Native and converted Responses models can be written to model_catalog_json. BoxAI Connect lets you choose.",
                    )),
                )
                .padded(true)
                .child(
                    EmptyState::new(
                        "connector.codex.catalog.empty",
                        locale.text("The Gateway currently offers no Codex Responses models."),
                    )
                    .kind(EmptyKind::Empty),
                )
                .into_any_element();
        }
        let items = chat_models
            .into_iter()
            .map(|(model, native)| {
                let is_default = model == default_model;
                let enabled = is_default || selection.codex.catalog_models.contains(&model);
                let kind = if native {
                    locale.text("Native")
                } else {
                    locale.text("Converted")
                };
                ToggleSetting {
                    id: model.clone(),
                    name: model,
                    detail: if is_default {
                        locale
                            .text("Always included as the default model.")
                            .to_owned()
                    } else {
                        String::new()
                    },
                    enabled,
                    locked: is_default,
                    badge: Some(if is_default {
                        locale.text("Default").to_owned()
                    } else {
                        kind.to_owned()
                    }),
                }
            })
            .collect();
        SettingsSection::new(
            "connector.codex.catalog-settings",
            locale.text("Codex model list"),
        )
        .description(locale.text(
            "Native and converted Responses models can be written to model_catalog_json. BoxAI Connect lets you choose.",
        ))
        .rows(agent_toggle_rows(
            "connector.codex.catalog",
            items,
            self.projection_busy,
            cx,
            |id, enabled| Action::SetCodexCatalog { id, enabled },
        ))
        .into_any_element()
    }

    fn render_codex_runtime_card(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("Codex runtime card requires connected state")
        };
        let locale = self.preferences.locale;
        let selection = &connection.profile.agents[&AgentId::Codex];
        let mut section =
            SettingsSection::new("connector.codex.runtime-settings", locale.text("Runtime"));
        for setting in CodexSetting::ALL {
            let control = self
                .codex_selects
                .iter()
                .find(|(candidate, _)| *candidate == setting)
                .expect("all Codex setting selects exist")
                .1
                .clone();
            section = section.row(
                SettingsRow::new(
                    format!("connector.codex.{}.row", setting.id()),
                    codex_setting_label(setting, locale),
                )
                .control(control),
            );
        }
        let mut children = vec![
            section
                .description(locale.text(
                    "Tune supported Responses models without changing the Gateway connection.",
                ))
                .into_any_element(),
        ];
        if selection.codex.approval_policy == Some(CodexApprovalPolicy::Never)
            || selection.codex.sandbox_mode == Some(CodexSandboxMode::DangerFullAccess)
        {
            children.push(
                Callout::new(
                    locale.text("This Codex configuration reduces local safety checks. Use it only in a trusted environment."),
                    Tone::Danger,
                )
                .id("connector.codex.safety-warning")
                .into_any_element(),
            );
        }
        page_column(&cx.theme().clone(), children)
    }

    fn render_image_card(
        &self,
        agent: AgentId,
        selection: &gateway_connector_core::AgentSelection,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        SettingsSection::new(
            format!("connector.{}.image-settings", agent.as_str()),
            locale.text("Direct image generation"),
        )
        .row(self.image_direct_row(agent, selection, cx))
        .into_any_element()
    }

    fn render_agent_mcp_card(&self, agent: AgentId, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("Agent MCP card requires connected state")
        };
        let locale = self.preferences.locale;
        let Some(provisioning) = connection
            .provisioning
            .as_ref()
            .filter(|provisioning| !provisioning.mcp_servers.is_empty())
        else {
            return Card::new()
                .id(format!("connector.{}.mcp", agent.as_str()))
                .variant(CardVariant::Ghost)
                .header(
                    CardHeader::new(locale.text("MCP servers"))
                        .subtitle(locale.text("Enablement is written when you apply this Agent.")),
                )
                .padded(true)
                .child(
                    EmptyState::new(
                        format!("connector.{}.mcp.empty", agent.as_str()),
                        locale.text("No MCP servers were provisioned."),
                    )
                    .kind(EmptyKind::Empty),
                )
                .into_any_element();
        };
        let items = provisioning
            .mcp_servers
            .iter()
            .map(|server| ToggleSetting {
                id: server.id.clone(),
                name: server.name.clone(),
                detail: server.url.to_string(),
                enabled: connection.profile.agents[&agent].mcp_enabled(&server.id),
                locked: false,
                badge: None,
            })
            .collect::<Vec<_>>();
        SettingsSection::new(
            format!("connector.{}.mcp", agent.as_str()),
            locale.text("MCP servers"),
        )
        .description(locale.text("Enablement is written when you apply this Agent."))
        .rows(agent_toggle_rows(
            format!("connector.{}.mcp.list", agent.as_str()),
            items,
            self.projection_busy,
            cx,
            move |id, enabled| Action::SetMcp { agent, id, enabled },
        ))
        .into_any_element()
    }

    fn render_agent_skills_card(&self, agent: AgentId, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { connection, .. } = &self.state else {
            unreachable!("Agent Skills card requires connected state")
        };
        let locale = self.preferences.locale;
        let selection = &connection.profile.agents[&agent];
        let mut skill_ids = connection
            .provisioning
            .as_ref()
            .map(|provisioning| {
                provisioning
                    .skills
                    .iter()
                    .map(|skill| (skill.id.clone(), skill.name.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let extra_skills = connection
            .synchronized_skills
            .keys()
            .filter(|id| !skill_ids.iter().any(|(known, _)| known == *id))
            .map(|id| (id.clone(), id.clone()))
            .collect::<Vec<_>>();
        skill_ids.extend(extra_skills);
        if skill_ids.is_empty() {
            return Card::new()
                .id(format!("connector.{}.skills", agent.as_str()))
                .variant(CardVariant::Ghost)
                .header(
                    CardHeader::new(locale.text("Skills"))
                        .subtitle(locale.text("Enablement is written when you apply this Agent.")),
                )
                .padded(true)
                .child(
                    EmptyState::new(
                        format!("connector.{}.skills.empty", agent.as_str()),
                        locale.text("No Skills were provisioned."),
                    )
                    .kind(EmptyKind::Empty),
                )
                .into_any_element();
        }
        let items = skill_ids
            .into_iter()
            .map(|(id, name)| ToggleSetting {
                id: id.clone(),
                name,
                detail: String::new(),
                enabled: selection.skill_enabled(&id),
                locked: false,
                badge: None,
            })
            .collect::<Vec<_>>();
        SettingsSection::new(
            format!("connector.{}.skills", agent.as_str()),
            locale.text("Skills"),
        )
        .description(locale.text("Enablement is written when you apply this Agent."))
        .rows(agent_toggle_rows(
            format!("connector.{}.skill.list", agent.as_str()),
            items,
            self.projection_busy,
            cx,
            move |id, enabled| Action::SetSkill { agent, id, enabled },
        ))
        .into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn render_destination_card(
        &self,
        agent: AgentId,
        ownership: &str,
        location: &str,
        detected: bool,
        _managed: bool,
        dirty: bool,
        no_models: bool,
        projection_semantic: ProjectionSemantic,
        root: Option<&Path>,
        catalog: bool,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let apply_enabled = self.agent_apply_enabled(agent);
        let projection_busy = self.projection_busy;
        let apply_view = cx.entity().downgrade();
        let mut details =
            DescriptionList::new(format!("connector.{}.details.list", agent.as_str()))
                .columns(2)
                .item(DescriptionItem::new(
                    format!("connector.{}.ownership", agent.as_str()),
                    locale.text("Connection status"),
                    ownership.to_owned(),
                ))
                .item(DescriptionItem::new(
                    format!("connector.{}.root", agent.as_str()),
                    locale.text("Configuration folder"),
                    location.to_owned(),
                ));
        for (index, path) in write_targets(agent, root, catalog).into_iter().enumerate() {
            details = details.item(DescriptionItem::new(
                format!("connector.{}.write.{index}", agent.as_str()),
                locale.text("Writes"),
                path,
            ));
        }
        let mut card = Card::new()
            .id(format!("connector.{}.destination", agent.as_str()))
            .header(
                CardHeader::new(locale.text("Write location"))
                    .subtitle(
                        locale.text("Apply writes only this Agent. Other Agents stay as they are."),
                    )
                    .action(move |_, _| {
                        agent_apply_button(
                            format!("connector.{}.destination.apply", agent.as_str()),
                            locale,
                            apply_enabled,
                            projection_busy,
                            agent,
                            apply_view.clone(),
                        )
                        .into_any_element()
                    }),
            )
            .padded(true)
            .child(details);
        if dirty {
            card = card.child(
                StatusLine::new(locale.text("Unapplied changes"), Tone::Warning).id(format!(
                    "connector.{}.destination.unapplied",
                    agent.as_str()
                )),
            );
        }
        if self.projection_busy {
            card = card.child(
                ProgressBar::new("connector.projection.progress")
                    .label(locale.text("Updating managed Agent configuration")),
            );
        }
        if !detected {
            card = card.child(
                Callout::new(
                    locale.text("Install a supported Agent before applying configuration."),
                    Tone::Info,
                )
                .id(format!("connector.{}.no-agent", agent.as_str())),
            );
        }
        if no_models {
            card = card.child(
                Callout::new(
                    locale.text("The Gateway currently offers no chat-capable models."),
                    Tone::Warning,
                )
                .id("connector.no-models"),
            );
        }
        if matches!(
            projection_semantic,
            ProjectionSemantic::Applying
                | ProjectionSemantic::ApplyFailed
                | ProjectionSemantic::DisconnectFailed
        ) {
            let tone = match projection_semantic {
                ProjectionSemantic::ApplyFailed | ProjectionSemantic::DisconnectFailed => {
                    Tone::Danger
                }
                _ => Tone::Info,
            };
            card = card.child(
                Callout::new(locale.text(projection_semantic.message()), tone)
                    .id("connector.projection-lifecycle-summary"),
            );
        }
        card.into_any_element()
    }

    fn image_direct_row(
        &self,
        agent: AgentId,
        selection: &gateway_connector_core::AgentSelection,
        cx: &mut Context<Self>,
    ) -> SettingsRow {
        let locale = self.preferences.locale;
        let description = locale.text(if agent.image_direct_env() {
            "Write OPENAI_BASE_URL and OPENAI_API_KEY so image skills can call the Gateway Images API directly."
        } else if agent.image_direct_native() {
            "Codex already uses the Gateway Responses provider for native image generation."
        } else {
            "This Agent has no environment-variable channel for Images API credentials."
        });
        let mut row = SettingsRow::new(
            format!("connector.{}.image-direct", agent.as_str()),
            locale.text("Direct image generation"),
        )
        .description(description);
        if agent.image_direct_env() {
            let handle = cx.entity().downgrade();
            let mut toggle =
                Switch::new(format!("connector.{}.image-direct.toggle", agent.as_str()))
                    .on(selection.image_direct);
            if !self.projection_busy {
                toggle = toggle.on_change(move |on, _, cx| {
                    let _ = handle.update(cx, move |this, cx| {
                        this.dispatch(Action::SetImageDirect { agent, enabled: on }, cx);
                    });
                });
            } else {
                toggle = toggle.disabled(true);
            }
            row = row.control(toggle);
        } else if agent.image_direct_native() {
            row = row.value(locale.text("Responses API"));
        } else {
            row = row.control(
                Switch::new(format!("connector.{}.image-direct.toggle", agent.as_str()))
                    .on(false)
                    .disabled(true),
            );
        }
        row
    }
}

struct ToggleSetting {
    id: String,
    name: String,
    detail: String,
    enabled: bool,
    locked: bool,
    badge: Option<String>,
}

fn agent_apply_button(
    id: String,
    locale: crate::preferences::Locale,
    enabled: bool,
    busy: bool,
    agent: AgentId,
    view: WeakEntity<ConnectorHost>,
) -> Button {
    let apply = Button::new(id)
        .label(locale.text(if busy { "Working…" } else { "Apply" }))
        .primary();
    if enabled {
        apply.on_click(move |_window, cx| {
            let _ = view.update(cx, |this, cx| this.dispatch(Action::ApplyAgent(agent), cx));
        })
    } else {
        apply.disabled(true)
    }
}

fn agent_toggle_rows(
    id: impl Into<String>,
    items: Vec<ToggleSetting>,
    busy: bool,
    cx: &mut Context<ConnectorHost>,
    action: impl Fn(String, bool) -> Action + Clone + 'static,
) -> Vec<SettingsRow> {
    let id = id.into();
    let handle = cx.entity().downgrade();
    items
        .into_iter()
        .map(|item| {
            let mut toggle = Switch::new(format!("{id}.{}.toggle", item.id))
                .named(item.name.clone())
                .on(item.enabled);
            if item.locked || busy {
                toggle = toggle.disabled(true);
            } else {
                let handle = handle.clone();
                let action = action.clone();
                let item_id = item.id.clone();
                toggle = toggle.on_change(move |on, _, cx| {
                    let item_id = item_id.clone();
                    let action = action.clone();
                    let _ = handle.update(cx, move |this, cx| {
                        this.dispatch(action(item_id, on), cx);
                    });
                });
            }
            let mut row = SettingsRow::new(format!("{id}.{}", item.id), item.name);
            if !item.detail.is_empty() {
                row = row.description(item.detail);
            }
            if let Some(badge) = item.badge {
                row = row.badge(badge);
            }
            row.control(toggle)
        })
        .collect()
}

fn write_targets(agent: AgentId, root: Option<&Path>, catalog: bool) -> Vec<String> {
    let Some(root) = root else {
        return Vec::new();
    };
    let mut paths = match agent {
        AgentId::Claude => {
            let mcp = if root.file_name().and_then(|name| name.to_str()) == Some(".claude") {
                root.parent().unwrap_or(root).join(".claude.json")
            } else {
                root.join(".claude.json")
            };
            vec![root.join("settings.json"), mcp, root.join("skills/<id>/")]
        }
        AgentId::Codex => {
            let mut paths = vec![root.join("config.toml")];
            if catalog {
                paths.push(root.join("connector-model-catalog.json"));
            }
            paths.push(root.join("skills/<id>/"));
            paths
        }
        AgentId::Gemini => vec![
            root.join(".env"),
            root.join("settings.json"),
            root.join("skills/<id>/"),
        ],
        AgentId::Grokbuild => vec![root.join("config.toml"), root.join("skills/<id>/")],
        AgentId::Opencode => vec![root.join("opencode.json"), root.join("skills/<id>/")],
        AgentId::Workbuddy => vec![
            root.join("models.json"),
            root.join("settings.json"),
            root.join(".mcp.json"),
            root.join("skills/<id>/"),
        ],
    };
    paths
        .drain(..)
        .map(|path| path.display().to_string())
        .collect()
}
