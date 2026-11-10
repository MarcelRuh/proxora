//! Design tokens for Proxora Desktop.
//!
//! Brand DNA comes from the web UI's standard skin (near-black canvas, pink
//! primary, purple-tinted hairlines, cyan info). The desktop shell is denser and
//! uses its own chrome: dark title/status bars, master-detail views, no glass.

use eframe::egui::{
    self, style::ScrollStyle, Color32, CornerRadius, FontData, FontDefinitions, FontFamily,
    FontId, Margin, Shadow, Stroke, Visuals,
};

pub mod c {
    use eframe::egui::Color32;

    pub const CHROME: Color32 = Color32::from_rgb(0x08, 0x08, 0x0d);
    pub const BG: Color32 = Color32::from_rgb(0x0b, 0x0b, 0x12);
    pub const PANEL: Color32 = Color32::from_rgb(0x10, 0x10, 0x1a);
    pub const RAISED: Color32 = Color32::from_rgb(0x17, 0x17, 0x25);
    pub const INPUT: Color32 = Color32::from_rgb(0x0d, 0x0d, 0x16);
    pub const HOVER: Color32 = Color32::from_rgb(0x1b, 0x1a, 0x2b);
    pub const BORDER: Color32 = Color32::from_rgb(0x22, 0x1b, 0x34);
    pub const BORDER_STRONG: Color32 = Color32::from_rgb(0x3a, 0x2a, 0x5c);

    pub const TEXT: Color32 = Color32::from_rgb(0xf5, 0xf5, 0xfa);
    pub const TEXT_2: Color32 = Color32::from_rgb(0xc4, 0xc4, 0xd6);
    pub const MUTED: Color32 = Color32::from_rgb(0x8f, 0x8f, 0xb0);
    pub const FAINT: Color32 = Color32::from_rgb(0x5c, 0x5c, 0x78);

    pub const PINK: Color32 = Color32::from_rgb(0xff, 0x00, 0x6e);
    /// Primary CTA — brand pink (same as web `--primary`).
    pub const PINK_FILL: Color32 = Color32::from_rgb(0xff, 0x00, 0x6e);
    pub const PINK_FILL_HOVER: Color32 = Color32::from_rgb(0xff, 0x2a, 0x85);
    pub const PINK_FILL_DOWN: Color32 = Color32::from_rgb(0xe0, 0x00, 0x60);
    pub const PURPLE: Color32 = Color32::from_rgb(0x83, 0x38, 0xec);
    pub const CYAN: Color32 = Color32::from_rgb(0x00, 0xb4, 0xd8);

    pub const OK: Color32 = Color32::from_rgb(0x06, 0xd6, 0xa0);
    pub const WARN: Color32 = Color32::from_rgb(0xff, 0xd6, 0x0a);
    pub const DANGER: Color32 = Color32::from_rgb(0xff, 0x54, 0x00);
    pub const DANGER_FILL: Color32 = Color32::from_rgb(0xc2, 0x3c, 0x00);
    pub const DANGER_FILL_HOVER: Color32 = Color32::from_rgb(0xd6, 0x44, 0x00);
}

pub const TITLEBAR_H: f32 = 40.0;
pub const STATUSBAR_H: f32 = 26.0;
pub const SIDEBAR_W: f32 = 240.0;
pub const SIDEBAR_RAIL_W: f32 = 64.0;
pub const RADIUS: u8 = 6;
pub const ROW_H: f32 = 36.0;

pub fn radius() -> CornerRadius {
    CornerRadius::same(RADIUS)
}

/// Translucent tint with gamma-space premultiplication, so `alpha` reads as the
/// visible opacity (egui's `from_rgba_unmultiplied` premultiplies in linear space,
/// which makes low alphas look far stronger on the gamma-space framebuffer).
pub fn tint(color: Color32, alpha: u8) -> Color32 {
    let a = alpha as u16;
    let m = |ch: u8| ((ch as u16 * a + 127) / 255) as u8;
    Color32::from_rgba_premultiplied(m(color.r()), m(color.g()), m(color.b()), alpha)
}

pub fn icon_font(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("icons".into()))
}

pub fn regular(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}

pub fn medium(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("medium".into()))
}

pub fn semibold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("semibold".into()))
}

pub fn display(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("display".into()))
}

pub fn mono(size: f32) -> FontId {
    FontId::new(size, FontFamily::Monospace)
}

pub fn install(ctx: &egui::Context) {
    install_fonts(ctx);
    apply_style(ctx);
}

fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let mut add = |name: &str, bytes: &'static [u8]| {
        fonts
            .font_data
            .insert(name.to_owned(), FontData::from_static(bytes).into());
    };
    add("inter", include_bytes!("../assets/fonts/Inter-Regular.ttf"));
    add("inter-medium", include_bytes!("../assets/fonts/Inter-Medium.ttf"));
    add("inter-semibold", include_bytes!("../assets/fonts/Inter-SemiBold.ttf"));
    add("jbmono", include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf"));
    add("orbitron", include_bytes!("../assets/fonts/Orbitron-Black.ttf"));
    fonts.font_data.insert(
        "phosphor".into(),
        egui_phosphor::Variant::Regular.font_data().into(),
    );

    let default_prop = fonts
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();
    let default_mono = fonts
        .families
        .get(&FontFamily::Monospace)
        .cloned()
        .unwrap_or_default();

    // Icons live in their own family: Inter maps glyphs into the same private-use
    // codepoints Phosphor uses, so mixing them in one family renders wrong symbols.
    let with_fallbacks = |primary: &str| -> Vec<String> {
        let mut list = vec![primary.to_owned(), "inter".to_owned()];
        list.extend(default_prop.iter().cloned());
        list.dedup();
        list
    };

    fonts
        .families
        .insert(FontFamily::Proportional, with_fallbacks("inter"));
    fonts
        .families
        .insert(FontFamily::Name("medium".into()), with_fallbacks("inter-medium"));
    fonts.families.insert(
        FontFamily::Name("semibold".into()),
        with_fallbacks("inter-semibold"),
    );
    fonts
        .families
        .insert(FontFamily::Name("display".into()), with_fallbacks("orbitron"));
    let mut mono = vec!["jbmono".to_owned()];
    mono.extend(default_mono);
    fonts.families.insert(FontFamily::Monospace, mono);
    fonts.families.insert(
        FontFamily::Name("icons".into()),
        vec!["phosphor".to_owned(), "inter".to_owned()],
    );

    ctx.set_fonts(fonts);
}

fn apply_style(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    let mut v = Visuals::dark();

    v.dark_mode = true;
    v.override_text_color = None;
    v.panel_fill = c::BG;
    v.window_fill = c::PANEL;
    v.window_stroke = Stroke::new(1.0_f32, c::BORDER_STRONG);
    v.window_corner_radius = CornerRadius::same(6);
    v.window_shadow = Shadow {
        offset: [0, 16],
        blur: 40,
        spread: 0,
        color: Color32::from_black_alpha(150),
    };
    v.popup_shadow = Shadow {
        offset: [0, 8],
        blur: 24,
        spread: 0,
        color: Color32::from_black_alpha(140),
    };
    v.menu_corner_radius = CornerRadius::same(6);
    v.extreme_bg_color = c::INPUT;
    v.faint_bg_color = Color32::from_rgb(0x13, 0x13, 0x1f);
    v.code_bg_color = c::INPUT;
    v.hyperlink_color = c::CYAN;
    v.warn_fg_color = c::WARN;
    v.error_fg_color = c::DANGER;
    // Opaque so egui_extras' per-cell row fills never double-blend at cell seams.
    v.selection.bg_fill = Color32::from_rgb(0x3b, 0x0d, 0x29);
    v.selection.stroke = Stroke::new(1.0_f32, c::PINK);
    v.text_cursor.stroke = Stroke::new(2.0_f32, c::PINK);
    v.striped = false;
    v.slider_trailing_fill = true;
    v.handle_shape = egui::style::HandleShape::Circle;
    v.interact_cursor = Some(egui::CursorIcon::PointingHand);

    let r = radius();
    let w = &mut v.widgets;
    w.noninteractive.bg_fill = c::PANEL;
    w.noninteractive.weak_bg_fill = c::PANEL;
    w.noninteractive.bg_stroke = Stroke::new(1.0_f32, c::BORDER);
    w.noninteractive.fg_stroke = Stroke::new(1.0_f32, c::TEXT_2);
    w.noninteractive.corner_radius = r;

    w.inactive.bg_fill = c::RAISED;
    w.inactive.weak_bg_fill = c::RAISED;
    w.inactive.bg_stroke = Stroke::new(1.0_f32, c::BORDER);
    w.inactive.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    w.inactive.corner_radius = r;

    w.hovered.bg_fill = c::HOVER;
    w.hovered.weak_bg_fill = c::HOVER;
    w.hovered.bg_stroke = Stroke::new(1.0_f32, c::BORDER_STRONG);
    w.hovered.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    w.hovered.corner_radius = r;
    w.hovered.expansion = 0.0;

    w.active.bg_fill = c::BORDER_STRONG;
    w.active.weak_bg_fill = c::BORDER_STRONG;
    w.active.bg_stroke = Stroke::new(1.0_f32, c::PURPLE);
    w.active.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    w.active.corner_radius = r;
    w.active.expansion = 0.0;

    w.open.bg_fill = c::RAISED;
    w.open.weak_bg_fill = c::RAISED;
    w.open.bg_stroke = Stroke::new(1.0_f32, c::BORDER_STRONG);
    w.open.fg_stroke = Stroke::new(1.0_f32, c::TEXT);
    w.open.corner_radius = r;

    style.visuals = v;

    let s = &mut style.spacing;
    s.item_spacing = egui::vec2(8.0, 8.0);
    s.button_padding = egui::vec2(12.0, 6.0);
    s.interact_size = egui::vec2(40.0, 30.0);
    s.window_margin = Margin::same(16);
    s.menu_margin = Margin::same(6);
    s.combo_width = 180.0;
    s.text_edit_width = 260.0;
    s.icon_width = 16.0;
    s.icon_width_inner = 9.0;
    s.icon_spacing = 8.0;
    s.indent = 16.0;
    s.scroll = ScrollStyle {
        bar_width: 8.0,
        floating: true,
        floating_allocated_width: 0.0,
        ..ScrollStyle::thin()
    };

    use egui::TextStyle as T;
    style.text_styles = [
        (T::Small, regular(11.5)),
        (T::Body, regular(13.5)),
        (T::Button, medium(13.5)),
        (T::Heading, semibold(20.0)),
        (T::Monospace, mono(12.5)),
    ]
    .into();

    style.interaction.selectable_labels = false;
    style.interaction.tooltip_delay = 0.35;
    style.animation_time = 0.14;
    ctx.set_style(style);
}

/// Semantic color + German label for Proxmox guest / host states.
pub fn state_tone(state: &str) -> (Color32, &'static str) {
    match state.to_ascii_lowercase().as_str() {
        "running" => (c::OK, "Läuft"),
        "online" => (c::OK, "Online"),
        "stopped" => (c::MUTED, "Gestoppt"),
        "offline" => (c::DANGER, "Offline"),
        "paused" | "suspended" => (c::WARN, "Pausiert"),
        "connecting" => (c::WARN, "Verbinde"),
        "maintenance" => (c::WARN, "Wartung"),
        "error" => (c::DANGER, "Fehler"),
        "template" => (c::PURPLE, "Vorlage"),
        _ => (c::MUTED, "Unbekannt"),
    }
}
