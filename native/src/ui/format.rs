//! Human-readable formatting for sizes, durations and timestamps (German).

pub fn bytes(value: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut v = value as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{value} B")
    } else if v >= 100.0 {
        format!("{v:.0} {}", UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

pub fn bytes_opt(value: Option<u64>) -> String {
    value.map(bytes).unwrap_or_else(|| "—".into())
}

pub fn used_of(used: u64, total: u64) -> String {
    format!("{} / {}", bytes(used), bytes(total))
}

pub fn ratio(used: u64, total: u64) -> f32 {
    if total == 0 {
        0.0
    } else {
        (used as f64 / total as f64) as f32
    }
}

pub fn percent(frac: f64) -> String {
    format!("{:.0} %", (frac * 100.0).clamp(0.0, 999.0))
}

pub fn uptime(secs: u64) -> String {
    if secs == 0 {
        return "—".into();
    }
    let days = secs / 86_400;
    let hours = (secs % 86_400) / 3_600;
    let mins = (secs % 3_600) / 60;
    if days > 0 {
        format!("{days} d {hours} h")
    } else if hours > 0 {
        format!("{hours} h {mins} min")
    } else {
        format!("{mins} min")
    }
}

/// Parses RFC 3339 / ISO timestamps or unix seconds into local time text.
pub fn timestamp(raw: &str) -> String {
    use chrono::{DateTime, Local, TimeZone};
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return dt.with_timezone(&Local).format("%d.%m.%Y %H:%M").to_string();
    }
    if let Ok(secs) = raw.parse::<i64>() {
        if let Some(dt) = Local.timestamp_opt(secs, 0).single() {
            return dt.format("%d.%m.%Y %H:%M").to_string();
        }
    }
    raw.to_owned()
}

pub fn unix_time(secs: i64) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_opt(secs, 0)
        .single()
        .map(|dt| dt.format("%d.%m.%Y %H:%M:%S").to_string())
        .unwrap_or_else(|| "—".into())
}

/// "vor 3 min" style relative time for ISO timestamps.
pub fn relative(raw: &str) -> String {
    use chrono::{DateTime, Utc};
    let Ok(dt) = DateTime::parse_from_rfc3339(raw) else {
        return timestamp(raw);
    };
    let secs = (Utc::now() - dt.with_timezone(&Utc)).num_seconds();
    relative_secs(secs)
}

pub fn relative_secs(secs: i64) -> String {
    if secs < 0 {
        return "gerade eben".into();
    }
    match secs {
        0..=44 => "gerade eben".into(),
        45..=3_599 => format!("vor {} min", (secs + 30) / 60),
        3_600..=86_399 => format!("vor {} h", secs / 3_600),
        _ => format!("vor {} d", secs / 86_400),
    }
}

pub fn clock_now() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_bytes() {
        assert_eq!(bytes(512), "512 B");
        assert_eq!(bytes(1536), "1.5 KiB");
        assert_eq!(bytes(200 * 1024 * 1024 * 1024), "200 GiB");
    }

    #[test]
    fn formats_uptime() {
        assert_eq!(uptime(0), "—");
        assert_eq!(uptime(90), "1 min");
        assert_eq!(uptime(3 * 86_400 + 4 * 3_600), "3 d 4 h");
    }

    #[test]
    fn relative_times() {
        assert_eq!(relative_secs(10), "gerade eben");
        assert_eq!(relative_secs(600), "vor 10 min");
        assert_eq!(relative_secs(7_200), "vor 2 h");
    }
}
