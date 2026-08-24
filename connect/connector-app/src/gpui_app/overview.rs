use std::collections::BTreeMap;
use std::rc::Rc;

use gateway_connector_backend::Overview;
use gateway_connector_core::{
    AccountSnapshot, AgentId, Billing, RequestLogEntry, UsageBucket, UsageSnapshot, UsageStat,
};
use gpui::{
    Context, InteractiveElement, IntoElement, ParentElement, SharedString, Styled, div, px,
};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::{Space, Theme, TypeScale};

use crate::preferences::Locale;
use crate::{AppState, AsyncStatus, AsyncValue};

use super::chrome::{
    compact_number, format_seconds, format_unix_compact_locale, format_unix_date, page_column,
    responsive_grid, responsive_split_ratio,
};
use super::controls::agent_logo;
use super::host::{ConnectorHost, UsageMetricKind, UsageRange};

impl ConnectorHost {
    pub(crate) fn render_overview(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let AppState::Connected { .. } = &self.state else {
            unreachable!("overview requires connected state")
        };
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let banner = self.page_banner(
            &theme,
            "Overview",
            Some(SharedString::from(locale.text("Last 30 days"))),
            "connector.overview.refresh",
            cx,
        );
        if !self.has_remote_overview() {
            return page_column(
                &theme,
                [
                    banner,
                    unavailable_card(
                        "connector.overview",
                        locale.text("Overview"),
                        locale.text("Overview data is unavailable for direct connections."),
                    ),
                ],
            );
        }
        let overview = self
            .overview_value()
            .expect("connected remote overview always has async state");
        let content = div()
            .w_full()
            .column()
            .gap_token(&theme, Space::Lg)
            .child(self.render_overview_kpi_strip(cx))
            .child(self.render_overview_trend_and_breakdown(cx))
            .child(self.render_overview_agents(cx))
            .child(self.render_overview_recent_logs(cx));
        div()
            .w_full()
            .column()
            .gap_token(&theme, Space::Lg)
            .child(banner)
            .child(StateView::new("connector.overview.state", overview).content(content))
            .into_any_element()
    }

    fn render_overview_kpi_strip(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let theme = cx.theme().clone();
        responsive_grid(
            "connector.overview.kpi",
            theme.clone(),
            200.0,
            self.usage_metric_cards("connector.overview.kpi", true),
        )
    }

    /// The wallet, lifetime, and window readings both the Overview and the
    /// Account page show. Wallet and lifetime totals come from provisioning;
    /// the rates come from the usage window, so each card states its own
    /// source's condition instead of borrowing a neighbour's.
    ///
    /// No card carries a trend: the shape of the window is the trend chart's
    /// job, and a card-sized sparkline can only label its extremes with the
    /// card's own value, which reads as a measurement it never took.
    pub(crate) fn usage_metric_cards(
        &self,
        prefix: &'static str,
        include_tokens: bool,
    ) -> Vec<gpui::AnyElement> {
        let locale = self.preferences.locale;
        let unavailable =
            SharedString::from(locale.text("Overview data is unavailable for direct connections."));
        let usage = self.provisioned_usage();
        let rate = self.overview_usage_stat();
        let series = self.overview_usage_series();
        let (rpm, tpm) = match rate {
            RemoteBlock::Ready(stat) => (Some(stat.rpm), Some(stat.tpm)),
            RemoteBlock::Unavailable | RemoteBlock::Loading | RemoteBlock::Error(_) => (None, None),
        };
        let window_quota = match series {
            RemoteBlock::Ready(buckets) => {
                Some(buckets.iter().map(|bucket| bucket.quota).sum::<i64>())
            }
            RemoteBlock::Unavailable | RemoteBlock::Loading | RemoteBlock::Error(_) => None,
        };

        let wallet = match usage {
            Some(usage) => {
                let empty = usage.wallet_quota_remaining == 0;
                MetricState::Ready(
                    MetricReading::new(compact_number(locale, usage.wallet_quota_remaining)).delta(
                        locale.text(if empty { "Empty" } else { "Available" }),
                        if empty { Tone::Danger } else { Tone::Success },
                    ),
                )
            }
            None => MetricState::Unavailable(unavailable.clone()),
        };
        let used = match usage {
            Some(usage) => {
                let mut reading =
                    MetricReading::new(compact_number(locale, usage.lifetime_quota_used));
                if let Some(window_quota) = window_quota {
                    reading = reading.delta(
                        format!(
                            "{} · {}",
                            compact_number(locale, window_quota),
                            locale.text("Last 30 days")
                        ),
                        Tone::Neutral,
                    );
                }
                MetricState::Ready(reading)
            }
            None => MetricState::Unavailable(unavailable.clone()),
        };
        let requests = match usage {
            Some(usage) => {
                let mut reading =
                    MetricReading::new(compact_number(locale, usage.lifetime_request_count));
                if let Some(rpm) = rpm {
                    reading = reading.delta(
                        format!(
                            "{} · {}",
                            compact_number(locale, rpm),
                            locale.text("Requests per minute")
                        ),
                        Tone::Neutral,
                    );
                }
                MetricState::Ready(reading)
            }
            None => MetricState::Unavailable(unavailable.clone()),
        };
        let mut cards = vec![
            MetricCard::new(
                format!("{prefix}.wallet"),
                locale.text("Wallet remaining"),
                wallet,
            )
            .into_any_element(),
            MetricCard::new(format!("{prefix}.quota"), locale.text("Used quota"), used)
                .into_any_element(),
            MetricCard::new(
                format!("{prefix}.requests"),
                locale.text("Request count"),
                requests,
            )
            .into_any_element(),
        ];
        if include_tokens {
            let tokens = match series {
                RemoteBlock::Ready(_) => {
                    let total = series_token_total(series).unwrap_or_default();
                    let mut reading = MetricReading::new(compact_number(locale, total));
                    if let Some(tpm) = tpm {
                        reading = reading.delta(
                            format!(
                                "{} · {}",
                                compact_number(locale, tpm),
                                locale.text("Tokens per minute")
                            ),
                            Tone::Neutral,
                        );
                    }
                    MetricState::Ready(reading)
                }
                RemoteBlock::Loading => MetricState::Loading,
                RemoteBlock::Error(error) => {
                    MetricState::Error(SharedString::from(error.to_owned()))
                }
                RemoteBlock::Unavailable => MetricState::Unavailable(unavailable),
            };
            cards.push(
                MetricCard::new(format!("{prefix}.tokens"), locale.text("Tokens"), tokens)
                    .into_any_element(),
            );
        }
        cards
    }

    fn render_overview_trend_and_breakdown(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let series = self.overview_usage_series();
        let range = self.usage_range;
        let selected_metric = self.usage_metric;
        let (trend, models_content) = match series {
            RemoteBlock::Ready(buckets) => {
                let filtered = filter_buckets(buckets, range);
                let by_day = aggregate_by_day(&filtered, selected_metric);
                let by_model = aggregate_by_model(&filtered, selected_metric);
                (
                    usage_line_chart(
                        "connector.overview.usage.day",
                        locale,
                        locale.text("Usage by day"),
                        &by_day,
                    ),
                    Some(usage_rank_list(
                        "connector.overview.usage.model",
                        &theme,
                        locale,
                        locale.text("No usage in this range."),
                        &by_model,
                    )),
                )
            }
            RemoteBlock::Loading => (
                LineChart::new(
                    "connector.overview.usage.day",
                    locale.text("Usage by day"),
                    ChartState::Loading,
                )
                .into_any_element(),
                None,
            ),
            RemoteBlock::Error(error) => (
                LineChart::new(
                    "connector.overview.usage.day",
                    locale.text("Usage by day"),
                    ChartState::Error(error.into()),
                )
                .into_any_element(),
                None,
            ),
            RemoteBlock::Unavailable => (
                LineChart::new(
                    "connector.overview.usage.day",
                    locale.text("Usage by day"),
                    ChartState::Unavailable(
                        locale
                            .text("Overview data is unavailable for direct connections.")
                            .into(),
                    ),
                )
                .into_any_element(),
                None,
            ),
        };
        let loading_label = locale.text("Usage by model");
        let models_state = StateView::new("connector.overview.usage.model.state", series).slot(
            slot::LOADING,
            move |_window, _cx| {
                Skeleton::new("connector.overview.usage.model.loading")
                    .label(loading_label)
                    .rows(5)
                    .into_any_element()
            },
        );
        let models = match models_content {
            Some(content) => models_state.content(content),
            None => models_state,
        };
        let range_view = cx.entity().downgrade();
        let metric_view = cx.entity().downgrade();
        let trend_card = Card::new()
            .id("connector.overview.usage")
            .variant(CardVariant::Elevated)
            .header(
                CardHeader::new(locale.text("Usage trend"))
                    .subtitle(locale.text(selected_metric.label())),
            )
            .padded(true)
            .child(page_column(
                &theme,
                [
                    usage_controls(
                        &theme,
                        locale,
                        range,
                        selected_metric,
                        move |choice, cx| {
                            let _ = range_view.update(cx, |this, cx| {
                                this.usage_range = choice;
                                cx.notify();
                            });
                        },
                        move |choice, cx| {
                            let _ = metric_view.update(cx, |this, cx| {
                                this.usage_metric = choice;
                                cx.notify();
                            });
                        },
                    ),
                    trend,
                ],
            ))
            .into_any_element();
        let rank_card = Card::new()
            .id("connector.overview.usage.models")
            .variant(CardVariant::Elevated)
            .header(CardHeader::new(locale.text("Usage by model")))
            .padded(true)
            .child(models)
            .into_any_element();
        responsive_split_ratio(
            "connector.overview.usage.breakdown",
            theme,
            65.0,
            35.0,
            trend_card,
            rank_card,
        )
    }

    fn render_overview_recent_logs(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let logs = self.overview_recent_logs();
        if matches!(logs, RemoteBlock::Unavailable) {
            return unavailable_card(
                "connector.overview.logs",
                locale.text("Recent requests"),
                locale.text("Overview data is unavailable for direct connections."),
            );
        }
        let (sort_key, sort_direction) = self.request_sort.clone();
        let mut entries = match logs {
            RemoteBlock::Ready(entries) => entries.to_vec(),
            RemoteBlock::Unavailable | RemoteBlock::Loading | RemoteBlock::Error(_) => Vec::new(),
        };
        entries.sort_by(|left, right| {
            let ordering = match sort_key.as_str() {
                "model" => left.model_name.cmp(&right.model_name),
                "quota" => left.quota.cmp(&right.quota),
                "tokens" => log_tokens(left).cmp(&log_tokens(right)),
                "duration" => left.use_time.cmp(&right.use_time),
                _ => left.created_at.cmp(&right.created_at),
            };
            match sort_direction {
                SortDirection::Ascending => ordering,
                SortDirection::Descending => ordering.reverse(),
            }
        });
        let entries = Rc::new(entries);
        let count = entries.len();
        let row_theme = theme.clone();
        let sort_view = cx.entity().downgrade();
        // The whole fetched page is sorted and handed to the table, which
        // builds only the rows its viewport holds.
        let mut table = Table::new("connector.overview.logs.table")
            .columns([
                Column::new("time", locale.text("Time"))
                    .fixed(156.0)
                    .sortable(true),
                Column::new("model", locale.text("Model"))
                    .flex(1.5)
                    .sortable(true),
                Column::new("quota", locale.text("Quota"))
                    .flex(0.75)
                    .align(Align::End)
                    .sortable(true),
                Column::new("tokens", locale.text("Tokens"))
                    .flex(0.75)
                    .align(Align::End)
                    .sortable(true),
                Column::new("duration", locale.text("Duration"))
                    .flex(0.55)
                    .align(Align::End)
                    .sortable(true),
            ])
            .lines(GridLines::Rows)
            .sorted_by(sort_key, sort_direction)
            .rows_from(count, move |index, _window, _cx| {
                log_row(&row_theme, locale, &entries[index])
            })
            .visible_rows(8)
            .loading(matches!(logs, RemoteBlock::Loading))
            .empty(
                EmptyState::new(
                    "connector.overview.logs.empty",
                    locale.text("No recent requests."),
                )
                .kind(EmptyKind::Empty),
            )
            .on_sort(move |key, direction, _window, cx| {
                let _ = sort_view.update(cx, |this, cx| {
                    this.request_sort = (key.to_string(), direction);
                    cx.notify();
                });
            });
        if let RemoteBlock::Error(error) = logs {
            table = table.failure(error.to_owned());
        }
        Card::new()
            .id("connector.overview.logs")
            .variant(CardVariant::Ghost)
            .header(
                CardHeader::new(locale.text("Recent requests"))
                    .subtitle(locale.text("Current account")),
            )
            .child(table)
            .into_any_element()
    }

    fn render_overview_agents(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let locale = self.preferences.locale;
        let theme = cx.theme().clone();
        let rows = self
            .distribution
            .supported_agents
            .iter()
            .copied()
            .map(|agent| agent_status_row(&theme, locale, agent, self.agent_status_facts(agent)))
            .collect::<Vec<_>>();
        Card::new()
            .id("connector.overview.agents")
            .variant(CardVariant::Elevated)
            .header(CardHeader::new(locale.text("Agent status")))
            .padded(true)
            .child(responsive_grid(
                "connector.overview.agents.grid",
                theme,
                220.0,
                rows,
            ))
            .into_any_element()
    }

    fn agent_status_facts(&self, agent: AgentId) -> (bool, bool, bool) {
        let detected = match &self.state {
            AppState::Connected { installs, .. } => installs
                .value
                .as_ref()
                .and_then(|values| values.iter().find(|install| install.agent == agent))
                .is_some_and(|install| install.detected),
            _ => false,
        };
        (
            detected,
            self.agent_is_managed(agent),
            self.agent_has_unapplied_edits(agent),
        )
    }

    fn overview_value(&self) -> Option<&AsyncValue<Overview>> {
        match &self.state {
            AppState::Connected { overview, .. } => Some(overview.as_ref()),
            _ => None,
        }
    }

    fn has_remote_overview(&self) -> bool {
        matches!(
            &self.state,
            AppState::Connected { connection, .. } if connection.manifest.is_some()
        )
    }

    pub(crate) fn provisioned_account(&self) -> Option<&AccountSnapshot> {
        self.provisioning()?.account.as_ref()
    }

    pub(crate) fn provisioned_usage(&self) -> Option<&UsageSnapshot> {
        self.provisioning()?.usage.as_ref()
    }

    pub(crate) fn provisioned_billing(&self) -> Option<&Billing> {
        self.provisioning()?.billing.as_ref()
    }

    pub(crate) fn provisioning(&self) -> Option<&gateway_connector_core::Provisioning> {
        match &self.state {
            AppState::Connected { connection, .. } => connection.provisioning.as_ref(),
            _ => None,
        }
    }

    fn overview_usage_stat(&self) -> RemoteBlock<'_, &UsageStat> {
        self.remote_field(|overview| overview.usage_stat.as_ref())
    }

    fn overview_usage_series(&self) -> RemoteBlock<'_, &[UsageBucket]> {
        self.remote_field(|overview| overview.usage_series.as_ref().map(Vec::as_slice))
    }

    fn overview_recent_logs(&self) -> RemoteBlock<'_, &[RequestLogEntry]> {
        self.remote_field(|overview| overview.recent_logs.as_ref().map(Vec::as_slice))
    }

    fn remote_field<'a, T>(
        &'a self,
        field: impl FnOnce(&'a Overview) -> Result<T, &'a String>,
    ) -> RemoteBlock<'a, T> {
        if !self.has_remote_overview() {
            return RemoteBlock::Unavailable;
        }
        let Some(overview) = self.overview_value() else {
            return RemoteBlock::Unavailable;
        };
        match (&overview.status, overview.value.as_ref()) {
            (AsyncStatus::Idle | AsyncStatus::Loading, None) => RemoteBlock::Loading,
            (_, Some(value)) => match field(value) {
                Ok(item) => RemoteBlock::Ready(item),
                Err(error) => RemoteBlock::Error(error),
            },
            (AsyncStatus::Error(error), None) => RemoteBlock::Error(error),
            (AsyncStatus::Refreshing, None) => RemoteBlock::Loading,
            _ => RemoteBlock::Loading,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum RemoteBlock<'a, T> {
    Unavailable,
    Loading,
    Error(&'a str),
    Ready(T),
}

impl<T> HasPhase for RemoteBlock<'_, T> {
    fn phase(&self) -> Phase {
        match self {
            Self::Unavailable => Phase::Unavailable,
            Self::Loading => Phase::Loading,
            Self::Error(_) => Phase::Error,
            Self::Ready(_) => Phase::Ready,
        }
    }

    fn reason(&self) -> Option<&str> {
        match self {
            Self::Error(error) => Some(error),
            _ => None,
        }
    }
}

fn unavailable_card(
    id: &'static str,
    title: &'static str,
    reason: &'static str,
) -> gpui::AnyElement {
    Card::new()
        .id(id)
        .variant(CardVariant::Elevated)
        .header(CardHeader::new(title))
        .padded(true)
        .child(EmptyState::new(format!("{id}.unavailable"), reason).kind(EmptyKind::Unavailable))
        .into_any_element()
}

fn usage_controls(
    theme: &Theme,
    locale: Locale,
    range: UsageRange,
    metric: UsageMetricKind,
    on_range: impl Fn(UsageRange, &mut gpui::App) + 'static,
    on_metric: impl Fn(UsageMetricKind, &mut gpui::App) + 'static,
) -> gpui::AnyElement {
    let range_control = SegmentedControl::new("connector.overview.usage.range")
        .label(locale.text("Usage by day"))
        .control_size(ControlSize::Sm)
        .segments([UsageRange::Days7, UsageRange::Days30].map(|choice| {
            Segment::new(
                choice.id(),
                locale.text(match choice {
                    UsageRange::Days7 => "7 days",
                    UsageRange::Days30 => "30 days",
                }),
            )
        }))
        .selected(range.id())
        .on_select(move |id, _window, cx| {
            on_range(
                if id.as_ref() == UsageRange::Days7.id() {
                    UsageRange::Days7
                } else {
                    UsageRange::Days30
                },
                cx,
            );
        });
    let metric_control = SegmentedControl::new("connector.overview.usage.metric")
        .label(locale.text("Usage"))
        .control_size(ControlSize::Sm)
        .segments(
            [
                UsageMetricKind::Quota,
                UsageMetricKind::Tokens,
                UsageMetricKind::Requests,
            ]
            .map(|choice| Segment::new(choice.id(), locale.text(choice.label()))),
        )
        .selected(metric.id())
        .on_select(move |id, _window, cx| {
            let choice = match id.as_ref() {
                "tokens" => UsageMetricKind::Tokens,
                "requests" => UsageMetricKind::Requests,
                _ => UsageMetricKind::Quota,
            };
            on_metric(choice, cx);
        });
    div()
        .w_full()
        .flex()
        .flex_row()
        .flex_wrap()
        .items_center()
        .justify_between()
        .gap_token(theme, Space::Md)
        .child(range_control)
        .child(metric_control)
        .into_any_element()
}

fn usage_line_chart(
    id: &'static str,
    locale: Locale,
    label: &'static str,
    series: &[(String, i64)],
) -> gpui::AnyElement {
    if series.is_empty() {
        return LineChart::new(id, label, ChartState::Empty).into_any_element();
    }
    let points = chart_points(locale, series);
    let max = series
        .iter()
        .map(|(_, value)| *value)
        .max()
        .unwrap_or(0)
        .max(1);
    let x_start = series.first().map(|(name, _)| name.as_str()).unwrap_or("0");
    let x_end = series.last().map(|(name, _)| name.as_str()).unwrap_or("0");
    LineChart::new(
        id,
        label,
        ChartState::Ready(vec![ChartSeries::new("usage", label).points(points)]),
    )
    .area()
    .axes(
        ChartAxes::default()
            .x_ends(x_start.to_owned(), x_end.to_owned())
            .y_ends("0", compact_number(locale, max)),
    )
    .into_any_element()
}

fn usage_rank_list(
    id: &'static str,
    theme: &Theme,
    locale: Locale,
    empty: &'static str,
    series: &[(String, i64)],
) -> gpui::AnyElement {
    if series.is_empty() {
        return EmptyState::new(format!("{id}.empty"), empty)
            .kind(EmptyKind::Empty)
            .into_any_element();
    }
    let max = series
        .iter()
        .map(|(_, value)| *value)
        .max()
        .unwrap_or(0)
        .max(1) as f32;
    page_column(
        theme,
        series
            .iter()
            .enumerate()
            .map(|(index, (name, value))| {
                ProgressBar::new(format!("{id}.{index}"))
                    .label(name.clone())
                    .fraction((*value as f32 / max).clamp(0.0, 1.0))
                    .display(compact_number(locale, *value))
                    .into_any_element()
            })
            .collect::<Vec<_>>(),
    )
}

fn chart_points(locale: Locale, series: &[(String, i64)]) -> Vec<ChartPoint> {
    let max = series
        .iter()
        .map(|(_, value)| *value)
        .max()
        .unwrap_or(0)
        .max(1) as f32;
    let last = (series.len().saturating_sub(1)) as f32;
    series
        .iter()
        .enumerate()
        .map(|(index, (name, value))| {
            let x = if last == 0.0 {
                0.0
            } else {
                index as f32 / last
            };
            ChartPoint::new(
                name.clone(),
                x,
                (*value as f32 / max).clamp(0.0, 1.0),
                name.clone(),
                compact_number(locale, *value),
            )
        })
        .collect()
}

fn filter_buckets(buckets: &[UsageBucket], range: UsageRange) -> Vec<&UsageBucket> {
    let end = buckets
        .iter()
        .map(|bucket| bucket.created_at)
        .max()
        .unwrap_or(0);
    let start = end.saturating_sub(range.seconds());
    buckets
        .iter()
        .filter(|bucket| bucket.created_at >= start)
        .collect()
}

fn bucket_value(bucket: &UsageBucket, metric: UsageMetricKind) -> i64 {
    match metric {
        UsageMetricKind::Quota => bucket.quota,
        UsageMetricKind::Tokens => bucket.token_used,
        UsageMetricKind::Requests => bucket.count,
    }
}

fn aggregate_by_day(buckets: &[&UsageBucket], metric: UsageMetricKind) -> Vec<(String, i64)> {
    let mut totals = BTreeMap::new();
    for bucket in buckets {
        *totals
            .entry(format_unix_date(bucket.created_at))
            .or_insert(0) += bucket_value(bucket, metric);
    }
    totals.into_iter().collect()
}

fn aggregate_by_model(buckets: &[&UsageBucket], metric: UsageMetricKind) -> Vec<(String, i64)> {
    let mut totals = BTreeMap::new();
    for bucket in buckets {
        let name = if bucket.model_name.trim().is_empty() {
            "unknown"
        } else {
            bucket.model_name.as_str()
        };
        *totals.entry(name.to_owned()).or_insert(0) += bucket_value(bucket, metric);
    }
    let mut items = totals.into_iter().collect::<Vec<_>>();
    items.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    items.truncate(6);
    items
}

fn series_token_total(series: RemoteBlock<'_, &[UsageBucket]>) -> Option<i64> {
    match series {
        RemoteBlock::Ready(buckets) => Some(buckets.iter().map(|bucket| bucket.token_used).sum()),
        RemoteBlock::Unavailable | RemoteBlock::Loading | RemoteBlock::Error(_) => None,
    }
}

fn clipped_cell(theme: &Theme, value: impl Into<SharedString>) -> Cell {
    let value = value.into();
    Cell::new(
        text(theme, TypeScale::Body, value.clone())
            .w_full()
            .min_w(px(0.0))
            .whitespace_nowrap()
            .truncate(),
    )
    .text(value)
}

fn log_model_name(locale: Locale, entry: &RequestLogEntry) -> SharedString {
    let name = entry.model_name.trim();
    if name.is_empty() {
        SharedString::from(locale.text("Unknown"))
    } else {
        SharedString::from(name.to_owned())
    }
}

fn log_row(theme: &Theme, locale: Locale, entry: &RequestLogEntry) -> Row {
    let tokens = entry.prompt_tokens.saturating_add(entry.completion_tokens);
    let model = log_model_name(locale, entry);
    let id = if entry.id == 0 {
        format!("{}-{}", entry.created_at, model)
    } else {
        entry.id.to_string()
    };
    Row::new(id)
        .text(model.clone())
        .cell(
            "time",
            clipped_cell(theme, format_unix_compact_locale(locale, entry.created_at)),
        )
        .cell("model", clipped_cell(theme, model))
        .cell("quota", compact_number(locale, entry.quota))
        .cell("tokens", compact_number(locale, tokens))
        .cell(
            "duration",
            clipped_cell(theme, format_seconds(locale, entry.use_time)),
        )
}

fn log_tokens(entry: &RequestLogEntry) -> i64 {
    entry.prompt_tokens.saturating_add(entry.completion_tokens)
}

fn agent_status_row(
    theme: &Theme,
    locale: Locale,
    agent: AgentId,
    (detected, managed, dirty): (bool, bool, bool),
) -> gpui::AnyElement {
    let (label, tone) = if dirty {
        (locale.text("Unapplied changes"), Tone::Warning)
    } else if managed {
        (locale.text("Managed by this connection"), Tone::Success)
    } else if detected {
        (locale.text("Detected"), Tone::Success)
    } else {
        (locale.text("Not detected"), Tone::Neutral)
    };
    div()
        .id(format!("connector.overview.agent.{}", agent.as_str()))
        .w_full()
        .min_w(px(0.0))
        .flex()
        .flex_row()
        .items_center()
        .gap_token(theme, Space::Sm)
        .child(agent_logo(
            format!("connector.overview.agent.{}.logo", agent.as_str()),
            agent,
            24.0,
        ))
        .child(
            text(theme, TypeScale::Label, agent.display_name())
                .flex_1()
                .min_w(px(0.0))
                .truncate(),
        )
        .child(StatusLine::new(label, tone).id(format!(
            "connector.overview.agent.{}.status",
            agent.as_str()
        )))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use gateway_connector_core::UsageBucket;

    use super::{RemoteBlock, series_token_total};

    fn bucket(token_used: i64) -> UsageBucket {
        UsageBucket {
            created_at: 0,
            model_name: "test".into(),
            count: 1,
            quota: 0,
            token_used,
        }
    }

    #[test]
    fn token_kpi_sums_loaded_series() {
        let buckets = [bucket(10), bucket(25), bucket(5)];
        assert_eq!(
            series_token_total(RemoteBlock::Ready(buckets.as_slice())),
            Some(40)
        );
        assert_eq!(series_token_total(RemoteBlock::Loading), None);
        assert_eq!(series_token_total(RemoteBlock::Unavailable), None);
    }
}
