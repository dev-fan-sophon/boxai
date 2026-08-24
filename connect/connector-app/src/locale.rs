//! Host catalogue for GPUI Box library strings and numbers.
//!
//! Caller-owned copy stays in [`crate::preferences::Locale::text`]. This
//! module only replaces the keys BoxAI Connect actually shows.

use gpui::{App, SharedString};
use gpui_kit::prelude::{grouped, set_numbers, set_strings};
use gpui_kit::strings::{NumberAdapter, Plural, StringKey, reset_strings};

use crate::preferences::Locale;

/// Installs Box strings and the number adapter for the active UI language.
pub fn apply_box_locale(locale: Locale, cx: &mut App) {
    reset_strings(cx);
    set_strings(box_strings(locale), cx);
    set_numbers(KitNumbers { locale }, cx);
}

fn box_strings(locale: Locale) -> Vec<(StringKey, SharedString)> {
    match locale {
        Locale::En => vec![
            (StringKey::ServerDisconnected, "Not probed".into()),
            (StringKey::ServerOfferingsUnasked, "Not probed yet".into()),
            (
                StringKey::ServerOfferingsUnaskedDetail,
                "BoxAI Connect lists provisioned servers; it does not handshake.".into(),
            ),
        ],
        Locale::Vi => vec![
            (StringKey::Copy, "Sao chép".into()),
            (StringKey::Dismiss, "Đóng".into()),
            (StringKey::PasswordReveal, "Hiện mật khẩu".into()),
            (StringKey::PasswordConceal, "Ẩn mật khẩu".into()),
            (StringKey::TryAgain, "Thử lại".into()),
            (StringKey::Loading, "Đang tải".into()),
            (StringKey::Expand, "Mở rộng".into()),
            (StringKey::Collapse, "Thu gọn".into()),
            (StringKey::SelectPlaceholder, "Chọn".into()),
            (StringKey::SelectClear, "Bỏ lựa chọn".into()),
            (StringKey::FilterBarLabel, "Bộ lọc".into()),
            (StringKey::FilterBarAdd, "Thêm bộ lọc".into()),
            (StringKey::FilterBarClear, "Xóa tất cả".into()),
            (StringKey::SearchPlaceholder, "Tìm kiếm".into()),
            (StringKey::SearchNoHits, "Không có kết quả".into()),
            (StringKey::ServerDisconnected, "Chưa kiểm tra".into()),
            (StringKey::ServerConnected, "Đã kết nối".into()),
            (StringKey::ServerConnecting, "Đang kết nối".into()),
            (StringKey::ServerFailed, "Lỗi".into()),
            (StringKey::ServerDisabled, "Đã tắt".into()),
            (StringKey::ServerEmpty, "Không có kết nối".into()),
            (
                StringKey::ServerEmptyDetail,
                "Chưa cấu hình máy chủ.".into(),
            ),
            (StringKey::ServerOfferingsUnasked, "Chưa kiểm tra".into()),
            (
                StringKey::ServerOfferingsUnaskedDetail,
                "BoxAI Connect liệt kê máy chủ được cấp; không thực hiện bắt tay.".into(),
            ),
            (StringKey::DescriptionUnknown, "Không xác định".into()),
            (StringKey::DescriptionNotApplicable, "Không áp dụng".into()),
            (
                StringKey::FailureTitle,
                "Không thể hiển thị bảng này".into(),
            ),
            (StringKey::FailureRetrying, "Đang thử lại".into()),
        ],
        Locale::ZhCn => vec![
            (StringKey::Copy, "复制".into()),
            (StringKey::Dismiss, "关闭".into()),
            (StringKey::PasswordReveal, "显示密码".into()),
            (StringKey::PasswordConceal, "隐藏密码".into()),
            (StringKey::TryAgain, "重试".into()),
            (StringKey::Loading, "加载中".into()),
            (StringKey::Expand, "展开".into()),
            (StringKey::Collapse, "收起".into()),
            (StringKey::SelectPlaceholder, "请选择".into()),
            (StringKey::SelectClear, "清除选择".into()),
            (StringKey::CountOfTotal, "{0} / {1}".into()),
            (StringKey::FilterBarLabel, "筛选".into()),
            (StringKey::FilterBarAdd, "添加筛选".into()),
            (StringKey::FilterBarClear, "清除全部".into()),
            (StringKey::FilterBarCounting, "正在计数…".into()),
            (StringKey::FilterBarResultOne, "1 个结果".into()),
            (StringKey::FilterBarResultsMany, "{0} 个结果".into()),
            (StringKey::FilterBarResults, "{0} {1}".into()),
            (StringKey::SearchNotSearched, "尚未搜索".into()),
            (StringKey::SearchPlaceholder, "查找".into()),
            (StringKey::SearchNoHits, "没有结果".into()),
            (StringKey::SearchCounting, "正在计数…".into()),
            (StringKey::ServerDisconnected, "未探测".into()),
            (StringKey::ServerConnected, "已连接".into()),
            (StringKey::ServerConnecting, "连接中".into()),
            (StringKey::ServerFailed, "失败".into()),
            (StringKey::ServerDisabled, "已关闭".into()),
            (StringKey::ServerEmpty, "没有连接".into()),
            (
                StringKey::ServerEmptyDetail,
                "还没有配置任何服务器。".into(),
            ),
            (StringKey::ServerOfferingsUnasked, "尚未探测".into()),
            (
                StringKey::ServerOfferingsUnaskedDetail,
                "BoxAI Connect 只列出已配置的服务器，不会做握手。".into(),
            ),
            (StringKey::SparklineEmpty, "没有读数".into()),
            (StringKey::SparklineUnavailable, "读数不可用".into()),
            (StringKey::SparklineError, "无法加载读数".into()),
            (StringKey::SparklineCurrent, "当前：{0}".into()),
            (StringKey::SparklineMinimum, "最小：{0}".into()),
            (StringKey::SparklineMaximum, "最大：{0}".into()),
            (StringKey::SparklineRange, "最小 {0}；最大 {1}".into()),
            (StringKey::ChartEmpty, "没有可绘制的序列".into()),
            (StringKey::MetricEmpty, "没有读数".into()),
            (StringKey::MetricUnavailable, "读数不可用".into()),
            (StringKey::MetricError, "无法加载读数".into()),
            (StringKey::GaugeEmpty, "没有读数".into()),
            (StringKey::DescriptionUnknown, "未知".into()),
            (StringKey::DescriptionNotApplicable, "不适用".into()),
            (StringKey::DescriptionCopy, "复制 {0}".into()),
            (StringKey::ScrollbarVertical, "纵向".into()),
            (StringKey::ScrollbarHorizontal, "横向".into()),
            (StringKey::FailureTitle, "无法显示此面板".into()),
            (StringKey::FailureRetrying, "正在重试".into()),
        ],
    }
}

#[derive(Debug, Clone, Copy)]
struct KitNumbers {
    locale: Locale,
}

impl NumberAdapter for KitNumbers {
    fn count(&self, value: usize) -> SharedString {
        SharedString::from(grouped(value as f64))
    }

    fn plural(&self, value: usize) -> Plural {
        if value == 1 {
            Plural::One
        } else {
            Plural::Other
        }
    }

    fn count_of_total(&self, done: usize, total: usize) -> SharedString {
        SharedString::from(count_of_total(self.locale, done as f64, total as f64))
    }

    fn percent(&self, value: f32) -> SharedString {
        let rounded = (value * 100.0).round() as i32;
        SharedString::from(format!("{rounded}%"))
    }

    fn decimal(&self, value: f64, precision: usize) -> SharedString {
        if precision == 0 {
            return SharedString::from(grouped(value));
        }
        let formatted = format!("{value:.precision$}");
        let (sign, rest) = formatted
            .strip_prefix('-')
            .map(|rest| ("-", rest))
            .unwrap_or(("", formatted.as_str()));
        let (integer, fraction) = rest.split_once('.').unwrap_or((rest, ""));
        let grouped_integer = grouped(integer.parse().unwrap_or(0.0));
        SharedString::from(format!("{sign}{grouped_integer}.{fraction}"))
    }
}

pub(crate) fn count_of_total(locale: Locale, done: f64, total: f64) -> String {
    let done = grouped(done);
    let total = grouped(total);
    match locale {
        Locale::ZhCn => format!("{done} / {total}"),
        Locale::Vi => format!("{done} trên {total}"),
        Locale::En => format!("{done} of {total}"),
    }
}

/// [`count_of_total`] for quota magnitudes. Item counts stay exact; quota is
/// large enough that the full digit string reads as noise.
pub(crate) fn compact_of_total(locale: Locale, done: i64, total: i64) -> String {
    let done = compact_number(locale, done);
    let total = compact_number(locale, total);
    match locale {
        Locale::ZhCn => format!("{done} / {total}"),
        Locale::Vi => format!("{done} trên {total}"),
        Locale::En => format!("{done} of {total}"),
    }
}

/// Unit-bearing form for quota, token, and request magnitudes. Chinese uses
/// 万/亿; English uses K/M/B. Below the first unit the value is grouped in
/// full, so small readings stay exact.
pub(crate) fn compact_number(locale: Locale, value: i64) -> String {
    let absolute = value.unsigned_abs() as f64;
    let prefix = if value < 0 { "-" } else { "" };
    let (scaled, suffix) = match locale {
        Locale::ZhCn => {
            if absolute >= 100_000_000.0 {
                (absolute / 100_000_000.0, "亿")
            } else if absolute >= 10_000.0 {
                (absolute / 10_000.0, "万")
            } else {
                return grouped(value as f64);
            }
        }
        Locale::En | Locale::Vi => {
            if absolute >= 1_000_000_000.0 {
                (absolute / 1_000_000_000.0, "B")
            } else if absolute >= 1_000_000.0 {
                (absolute / 1_000_000.0, "M")
            } else if absolute >= 1_000.0 {
                (absolute / 1_000.0, "K")
            } else {
                return grouped(value as f64);
            }
        }
    };
    if scaled >= 100.0 {
        format!("{prefix}{scaled:.0}{suffix}")
    } else if scaled >= 10.0 {
        format!("{prefix}{scaled:.1}{suffix}")
    } else {
        format!("{prefix}{scaled:.2}{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_count_of_total_uses_a_slash() {
        assert_eq!(
            count_of_total(Locale::ZhCn, 1_370.0, 3_729.0),
            "1,370 / 3,729"
        );
        assert_eq!(
            count_of_total(Locale::En, 1_370.0, 3_729.0),
            "1,370 of 3,729"
        );
    }

    #[test]
    fn compact_numbers_carry_a_locale_unit() {
        assert_eq!(compact_number(Locale::En, 160_000_000), "160M");
        assert_eq!(compact_number(Locale::ZhCn, 160_000_000), "1.60亿");
        assert_eq!(compact_number(Locale::ZhCn, 1_372_331_981), "13.7亿");
        assert_eq!(compact_number(Locale::ZhCn, 86_400), "8.64万");
        assert_eq!(compact_number(Locale::ZhCn, 9_876), "9,876");
        assert_eq!(compact_number(Locale::En, -2_500), "-2.50K");
        assert_eq!(
            compact_of_total(Locale::ZhCn, 1_370_000, 3_729_000),
            "137万 / 373万"
        );
    }

    #[test]
    fn chinese_overrides_include_gauge_and_server_copy() {
        let keys = box_strings(Locale::ZhCn);
        assert!(
            keys.iter().any(
                |(key, value)| *key == StringKey::CountOfTotal && value.as_ref() == "{0} / {1}"
            )
        );
        assert!(keys.iter().any(
            |(key, value)| *key == StringKey::ServerDisconnected && value.as_ref() == "未探测"
        ));
    }

    #[test]
    fn english_overrides_disconnected_to_not_probed() {
        let keys = box_strings(Locale::En);
        assert!(
            keys.iter()
                .any(|(key, value)| *key == StringKey::ServerDisconnected
                    && value.as_ref() == "Not probed")
        );
    }
}
