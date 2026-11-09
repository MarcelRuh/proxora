use eframe::egui::{self, Color32, FontFamily, FontId, Stroke, TextStyle, Visuals};

/// Proxora web DNA (pink / purple / cyan), denser desktop chrome.
/// Same brand language as the web UI — not a clone of its glass/atmosphere look.
pub mod c {
    use eframe::egui::Color32;

    // Web tokens from app/globals.css [data-ui=standard]
    pub const BG: Color32 = Color32::from_rgb(0x0a, 0x0a, 0x0f);
    pub const BG_ELEV: Color32 = Color32::from_rgb(0x0c, 0x0c, 0x14);
    pub const PANEL: Color32 = Color32::from_rgb(0x0d, 0x0d, 0x15);
    pub const PANEL_2: Color32 = Color32::from_rgb(0x14, 0x14, 0x22);
    // Opaque approximations of web purple/pink translucency (egui const-friendly).
    pub const BORDER: Color32 = Color32::from_rgb(0x2b, 0x1a, 0x3d);
    pub const BORDER_SOFT: Color32 = Color32::from_rgb(0x1e, 0x14, 0x2c);
    pub const TEXT: Color32 = Color32::from_rgb(0xff, 0xff, 0xff);
    pub const MUTED: Color32 = Color32::from_rgb(0x88, 0x88, 0xaa);
    pub const FAINT: Color32 = Color32::from_rgb(0xa0, 0xa0, 0xb0);
    pub const PINK: Color32 = Color32::from_rgb(0xff, 0x00, 0x6e);
    pub const PURPLE: Color32 = Color32::from_rgb(0x83, 0x38, 0xec);
    pub const CYAN: Color32 = Color32::from_rgb(0x00, 0xb4, 0xd8);
    pub const ACCENT_DIM: Color32 = Color32::from_rgb(0xb0, 0x00, 0x4c);
    pub const WARN: Color32 = Color32::from_rgb(0xff, 0xd6, 0x0a);
    pub const DANGER: Color32 = Color32::from_rgb(0xff, 0x54, 0x00);
    pub const OK: Color32 = Color32::from_rgb(0x06, 0xd6, 0xa0);
    pub const TITLEBAR: Color32 = Color32::from_rgb(0x0a, 0x0a, 0x0f);
    pub const NAV_ACTIVE_BG: Color32 = Color32::from_rgb(0x2a, 0x0a, 0x1a);
    pub const SIDEBAR_MUTED: Color32 = Color32::from_rgb(0xa0, 0xa0, 0xb0);
}

pub const TITLEBAR_H: f32 = 38.0;
pub const SIDEBAR_W: f32 = 248.0;

pub fn apply(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    style.visuals = Visuals::dark();
    style.visuals.dark_mode = true;
    style.visuals.panel_fill = c::BG;
    style.visuals.window_fill = c::PANEL;
    style.visuals.extreme_bg_color = c::BG_ELEV;
    style.visuals.faint_bg_color = c::PANEL_2;
    style.visuals.code_bg_color = c::BG_ELEV;
    style.visuals.override_text_color = Some(c::TEXT);
    style.visuals.hyperlink_color = c::CYAN;
    style.visuals.warn_fg_color = c::WARN;
    style.visuals.error_fg_color = c::DANGER;
    style.visuals.widgets.noninteractive.bg_fill = c::PANEL;
    style.visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, c::MUTED);
    style.visuals.widgets.inactive.bg_fill = c::PANEL_2;
    style.visuals.widgets.inactive.weak_bg_fill = c::PANEL_2;
    style.visuals.widgets.inactive.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    style.visuals.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, c::BORDER);
    style.visuals.widgets.hovered.bg_fill = Color32::from_rgba_unmultiplied(0xff, 0x00, 0x6e, 18);
    style.visuals.widgets.hovered.weak_bg_fill = Color32::from_rgba_unmultiplied(0xff, 0x00, 0x6e, 18);
    style.visuals.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, c::PURPLE);
    style.visuals.widgets.hovered.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    style.visuals.widgets.active.bg_fill = c::ACCENT_DIM;
    style.visuals.widgets.active.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    style.visuals.widgets.open.bg_fill = c::PANEL_2;
    style.visuals.selection.bg_fill = Color32::from_rgba_unmultiplied(0xff, 0x00, 0x6e, 48);
    style.visuals.selection.stroke = Stroke::new(1.0_f32, c::PINK);
    style.visuals.window_stroke = Stroke::new(1.0_f32, c::BORDER);
    style.visuals.widgets.noninteractive.corner_radius = 4.0.into();
    style.visuals.widgets.inactive.corner_radius = 4.0.into();
    style.visuals.widgets.hovered.corner_radius = 4.0.into();
    style.visuals.widgets.active.corner_radius = 4.0.into();
    style.spacing.item_spacing = egui::vec2(10.0, 8.0);
    style.spacing.button_padding = egui::vec2(12.0, 7.0);
    style.spacing.window_margin = egui::Margin::same(0);
    style.text_styles.insert(TextStyle::Heading, FontId::new(22.0, FontFamily::Proportional));
    style.text_styles.insert(TextStyle::Body, FontId::new(14.0, FontFamily::Proportional));
    style.text_styles.insert(TextStyle::Button, FontId::new(13.5, FontFamily::Proportional));
    style.text_styles.insert(TextStyle::Small, FontId::new(12.0, FontFamily::Proportional));
    style.text_styles.insert(TextStyle::Monospace, FontId::new(12.5, FontFamily::Monospace));
    ctx.set_style(style);
}

pub fn state_color(state: &str) -> Color32 {
    match state.to_lowercase().as_str() {
        "online" | "running" => c::OK,
        "offline" | "stopped" => c::FAINT,
        "error" => c::DANGER,
        "paused" | "maintenance" | "connecting" => c::WARN,
        _ => c::MUTED,
    }
}
