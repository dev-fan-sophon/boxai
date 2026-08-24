use gpui::{
    AnyElement, App, ClipboardItem, InteractiveElement, IntoElement, ParentElement, SharedString,
    Styled, div, px,
};
use gpui_kit::foundation::text;
use gpui_kit::prelude::*;
use gpui_kit_theme::{Space, Theme, TypeScale};

use crate::preferences::Locale;

// Visible copy uses `gpui_kit::foundation::text` and `TypeScale`.
// KPI readouts are `MetricCard` states so loading, unavailable, and failed
// never collapse into the same dash; axis ticks use `compact_axis`. Do not set
// a second `font_family` under the shell.

/// Full-window stage for signed-out and loading. The canvas is the surface;
/// content is centred and has no card or glass frame.
pub(crate) fn signed_out_stage(theme: &Theme, child: impl IntoElement) -> AnyElement {
    div()
        .id("connector.shell.signed-out")
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .p_token(theme, Space::Xl)
        .child(child)
        .into_any_element()
}

/// Official page column. GPUI Box has no Stack primitive; framed children
/// (`Card`, `SettingsSection`, `Callout`) compose with [`StyledExt::column`].
pub(crate) fn page_column(
    theme: &Theme,
    children: impl IntoIterator<Item = AnyElement>,
) -> AnyElement {
    div()
        .w_full()
        .column()
        .gap_token(theme, Space::Xl)
        .children(children)
        .into_any_element()
}

/// One page banner: what the page is, one honest sentence of scope, and the
/// actions that belong to the whole page rather than to a single card.
pub(crate) fn page_header(
    theme: &Theme,
    title: impl Into<SharedString>,
    subtitle: Option<SharedString>,
    actions: Option<AnyElement>,
) -> AnyElement {
    let mut identity = div()
        .flex_1()
        .min_w(px(220.0))
        .column()
        .gap_token(theme, Space::Xs)
        .child(text(theme, TypeScale::Title, title));
    if let Some(subtitle) = subtitle {
        identity = identity
            .child(text(theme, TypeScale::Caption, subtitle).text_color(theme.colors.text_muted));
    }
    let mut row = div()
        .w_full()
        .flex()
        .flex_row()
        .flex_wrap()
        .items_center()
        .justify_between()
        .gap_token(theme, Space::Md)
        .child(identity);
    if let Some(actions) = actions {
        row = row.child(actions);
    }
    row.into_any_element()
}

/// Two panes with a measured width share. Stacks below 720px.
pub(crate) fn responsive_split_ratio(
    id: impl Into<Ident>,
    theme: Theme,
    left_share: f32,
    right_share: f32,
    left: AnyElement,
    right: AnyElement,
) -> AnyElement {
    Responsive::new(id, move |size, _, _| {
        let wide = size.width().is_some_and(|width| width >= 720.0);
        let row = div().w_full().gap_token(&theme, Space::Lg);
        if wide {
            row.flex()
                .flex_row()
                .items_start()
                .child(
                    div()
                        .flex_grow(left_share)
                        .flex_shrink(1.0)
                        .flex_basis(px(0.0))
                        .min_w(px(0.0))
                        .child(left),
                )
                .child(
                    div()
                        .flex_grow(right_share)
                        .flex_shrink(1.0)
                        .flex_basis(px(0.0))
                        .min_w(px(0.0))
                        .child(right),
                )
                .into_any_element()
        } else {
            row.column().child(left).child(right).into_any_element()
        }
    })
    .into_any_element()
}

/// Catalog tiles. Column count comes from the container's measured width.
pub(crate) fn responsive_grid(
    id: impl Into<Ident>,
    theme: Theme,
    min_width: f32,
    children: Vec<AnyElement>,
) -> AnyElement {
    Responsive::new(id, move |size, _, _| {
        let width = size.width().unwrap_or(min_width);
        let columns = ((width / min_width).floor() as usize).max(1);
        let gap = theme.space(Space::Md);
        let column_width = if columns == 1 {
            width
        } else {
            ((width - gap * (columns.saturating_sub(1) as f32)) / columns as f32).max(0.0)
        };
        div()
            .w_full()
            .flex()
            .flex_row()
            .flex_wrap()
            .gap_token(&theme, Space::Md)
            .children(children.into_iter().map(|child| {
                div()
                    .w(px(column_width))
                    .flex()
                    .items_stretch()
                    .child(child)
                    .into_any_element()
            }))
            .into_any_element()
    })
    .into_any_element()
}

pub(crate) fn page_enter(
    id: impl Into<gpui::ElementId>,
    theme: &Theme,
    child: impl IntoElement,
) -> gpui::AnyElement {
    gpui_kit::motion::surface_in(id, theme, div().child(child)).into_any_element()
}

pub(crate) fn grouped_number(value: f64) -> String {
    grouped(value)
}

pub(crate) fn compact_number(locale: Locale, value: i64) -> String {
    crate::locale::compact_number(locale, value)
}

pub(crate) fn compact_of_total(locale: Locale, done: i64, total: i64) -> String {
    crate::locale::compact_of_total(locale, done, total)
}

pub(crate) fn format_seconds(locale: Locale, seconds: i64) -> String {
    format!("{}{}", grouped_number(seconds as f64), locale.text("s"))
}

pub(crate) fn copy_text(cx: &mut App, value: impl Into<String>) {
    cx.write_to_clipboard(ClipboardItem::new_string(value.into()));
}

/// Formats a Unix timestamp as UTC civil time. The value is the host's; this
/// only names the instant.
pub(crate) fn format_unix_utc_locale(locale: Locale, seconds: i64) -> String {
    format_unix_parts(locale, seconds, true)
}

/// Compact civil time for table cells: `08-19 07:44 UTC`.
pub(crate) fn format_unix_compact_locale(locale: Locale, seconds: i64) -> String {
    format_unix_parts(locale, seconds, false)
}

fn format_unix_parts(locale: Locale, seconds: i64, with_year: bool) -> String {
    if seconds < 0 {
        return seconds.to_string();
    }
    let days = seconds.div_euclid(86_400);
    let tod = seconds.rem_euclid(86_400);
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let (year, month, day) = civil_from_days(days);
    let zone = locale.text("UTC");
    if with_year {
        format!("{year:04}-{month:02}-{day:02} {hour:02}:{min:02} {zone}")
    } else {
        format!("{month:02}-{day:02} {hour:02}:{min:02} {zone}")
    }
}

pub(crate) fn format_unix_date(seconds: i64) -> String {
    if seconds < 0 {
        return seconds.to_string();
    }
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    format!("{year:04}-{month:02}-{day:02}")
}

/// Howard Hinnant's `civil_from_days` (days since Unix epoch).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use crate::preferences::Locale;

    use super::{format_seconds, format_unix_utc_locale};

    #[test]
    fn unix_epoch_is_utc_civil_time() {
        assert_eq!(
            format_unix_utc_locale(Locale::En, 0),
            "1970-01-01 00:00 UTC"
        );
        assert_eq!(
            format_unix_utc_locale(Locale::En, 1_704_067_200),
            "2024-01-01 00:00 UTC"
        );
        assert_eq!(
            super::format_unix_compact_locale(Locale::En, 1_704_067_200),
            "01-01 00:00 UTC"
        );
    }

    #[test]
    fn seconds_use_locale_suffix() {
        assert_eq!(format_seconds(Locale::En, 12), "12s");
        assert_eq!(format_seconds(Locale::ZhCn, 12), "12 秒");
    }
}
