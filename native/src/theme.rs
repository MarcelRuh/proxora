use eframe::egui::{self, Color32, FontFamily, FontId, Stroke, TextStyle, Visuals};

/// Industrial control-room palette — charcoal + acid green, no purple/glow kitsch.
pub mod c {
    use eframe::egui::Color32;
    pub const BG: Color32 = Color32::from_rgb(9, 11, 14);
    pub const BG_ELEV: Color32 = Color32::from_rgb(14, 17, 22);
    pub const PANEL: Color32 = Color32::from_rgb(18, 22, 29);
    pub const PANEL_2: Color32 = Color32::from_rgb(22, 27, 36);
    pub const BORDER: Color32 = Color32::from_rgb(36, 44, 56);
    pub const BORDER_SOFT: Color32 = Color32::from_rgb(28, 34, 44);
    pub const TEXT: Color32 = Color32::from_rgb(232, 236, 242);
    pub const MUTED: Color32 = Color32::from_rgb(120, 132, 148);
    pub const FAINT: Color32 = Color32::from_rgb(78, 88, 102);
    pub const ACCENT: Color32 = Color32::from_rgb(46, 230, 166);
    pub const ACCENT_DIM: Color32 = Color32::from_rgb(24, 120, 90);
    pub const WARN: Color32 = Color32::from_rgb(240, 168, 48);
    pub const DANGER: Color32 = Color32::from_rgb(255, 92, 92);
    pub const OK: Color32 = Color32::from_rgb(52, 211, 128);
    pub const TITLEBAR: Color32 = Color32::from_rgb(12, 14, 18);
}

pub const TITLEBAR_H: f32 = 40.0;
pub const SIDEBAR_W: f32 = 208.0;

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
    style.visuals.hyperlink_color = c::ACCENT;
    style.visuals.warn_fg_color = c::WARN;
    style.visuals.error_fg_color = c::DANGER;
    style.visuals.widgets.noninteractive.bg_fill = c::PANEL;
    style.visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, c::MUTED);
    style.visuals.widgets.inactive.bg_fill = c::PANEL_2;
    style.visuals.widgets.inactive.weak_bg_fill = c::PANEL_2;
    style.visuals.widgets.inactive.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    style.visuals.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, c::BORDER);
    style.visuals.widgets.hovered.bg_fill = Color32::from_rgb(28, 40, 48);
    style.visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(28, 40, 48);
    style.visuals.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, c::ACCENT_DIM);
    style.visuals.widgets.hovered.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    style.visuals.widgets.active.bg_fill = c::ACCENT_DIM;
    style.visuals.widgets.active.fg_stroke = Stroke::new(1.0_f32, c::BG);
    style.visuals.widgets.open.bg_fill = c::PANEL_2;
    style.visuals.selection.bg_fill = Color32::from_rgba_unmultiplied(46, 230, 166, 40);
    style.visuals.selection.stroke = Stroke::new(1.0_f32, c::ACCENT);
    style.visuals.window_stroke = Stroke::new(1.0_f32, c::BORDER);
    style.visuals.widgets.noninteractive.corner_radius = 4.0.into();
    style.visuals.widgets.inactive.corner_radius = 4.0.into();
    style.visuals.widgets.hovered.corner_radius = 4.0.into();
    style.visuals.widgets.active.corner_radius = 4.0.into();
    style.spacing.item_spacing = egui::vec2(10.0, 8.0);
    style.spacing.button_padding = egui::vec2(12.0, 6.0);
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
