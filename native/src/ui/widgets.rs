use crate::net::ApiError;
use crate::theme::{self, c, radius, tint};
use eframe::egui::{
    self, Align, Color32, CornerRadius, FontId, Frame, Galley, Layout, Margin, Pos2,
    Rect, Response, RichText, Sense, Stroke, StrokeKind, Ui, Vec2, Widget,
};
use eframe::egui::{PopupCloseBehavior};
use egui_phosphor::regular as ph;
use std::sync::Arc;

// ---------------------------------------------------------------- text

pub fn body(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::regular(13.5)).color(c::TEXT)
}

pub fn secondary(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::regular(13.0)).color(c::TEXT_2)
}

pub fn muted(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::regular(12.5)).color(c::MUTED)
}

pub fn small(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::regular(11.5)).color(c::MUTED)
}

pub fn label(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::medium(12.5)).color(c::TEXT_2)
}

pub fn strong(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::semibold(13.5)).color(c::TEXT)
}

pub fn title(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::semibold(15.0)).color(c::TEXT)
}

pub fn mono(s: impl Into<String>) -> RichText {
    RichText::new(s).font(theme::mono(12.0)).color(c::TEXT_2)
}

pub fn icon_text(icon: &str, size: f32, color: Color32) -> RichText {
    RichText::new(icon).font(theme::icon_font(size)).color(color)
}

fn galley(ui: &Ui, text: &str, font: FontId) -> Arc<Galley> {
    ui.fonts(|f| f.layout_no_wrap(text.to_owned(), font, Color32::PLACEHOLDER))
}

// ---------------------------------------------------------------- buttons

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tone {
    Primary,
    Secondary,
    Ghost,
    Danger,
}

pub struct Btn<'a> {
    label: &'a str,
    icon: Option<&'a str>,
    tone: Tone,
    small: bool,
    enabled: bool,
    loading: bool,
    selected: bool,
    min_width: f32,
    fill_width: bool,
    tooltip: Option<&'a str>,
}

impl<'a> Btn<'a> {
    pub fn new(tone: Tone, label: &'a str) -> Self {
        Self {
            label,
            icon: None,
            tone,
            small: false,
            enabled: true,
            loading: false,
            selected: false,
            min_width: 0.0,
            fill_width: false,
            tooltip: None,
        }
    }
    pub fn primary(label: &'a str) -> Self {
        Self::new(Tone::Primary, label)
    }
    pub fn secondary(label: &'a str) -> Self {
        Self::new(Tone::Secondary, label)
    }
    pub fn ghost(label: &'a str) -> Self {
        Self::new(Tone::Ghost, label)
    }
    pub fn danger(label: &'a str) -> Self {
        Self::new(Tone::Danger, label)
    }
    /// Square icon-only ghost button.
    pub fn icon_only(icon: &'a str, tooltip: &'a str) -> Self {
        Self::new(Tone::Ghost, "").icon(icon).tooltip(tooltip)
    }
    pub fn icon(mut self, icon: &'a str) -> Self {
        self.icon = Some(icon);
        self
    }
    pub fn small(mut self) -> Self {
        self.small = true;
        self
    }
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    pub fn min_width(mut self, width: f32) -> Self {
        self.min_width = width;
        self
    }
    pub fn fill_width(mut self) -> Self {
        self.fill_width = true;
        self
    }
    pub fn tooltip(mut self, tooltip: &'a str) -> Self {
        self.tooltip = Some(tooltip);
        self
    }
}

struct Palette {
    bg: Color32,
    bg_hover: Color32,
    bg_down: Color32,
    fg: Color32,
    fg_hover: Color32,
    border: Color32,
    border_hover: Color32,
}

fn palette(tone: Tone, selected: bool) -> Palette {
    if selected {
        return Palette {
            bg: tint(c::PINK, 30),
            bg_hover: tint(c::PINK, 40),
            bg_down: tint(c::PINK, 52),
            fg: c::PINK,
            fg_hover: c::PINK,
            border: tint(c::PINK, 90),
            border_hover: c::PINK,
        };
    }
    match tone {
        Tone::Primary => Palette {
            bg: c::PINK_FILL,
            bg_hover: c::PINK_FILL_HOVER,
            bg_down: c::PINK_FILL_DOWN,
            fg: Color32::WHITE,
            fg_hover: Color32::WHITE,
            border: Color32::TRANSPARENT,
            border_hover: Color32::TRANSPARENT,
        },
        Tone::Secondary => Palette {
            bg: c::RAISED,
            bg_hover: c::HOVER,
            bg_down: c::BORDER,
            fg: c::TEXT,
            fg_hover: c::TEXT,
            border: c::BORDER,
            border_hover: c::BORDER_STRONG,
        },
        Tone::Ghost => Palette {
            bg: Color32::TRANSPARENT,
            bg_hover: c::HOVER,
            bg_down: c::RAISED,
            fg: c::TEXT_2,
            fg_hover: c::TEXT,
            border: Color32::TRANSPARENT,
            border_hover: Color32::TRANSPARENT,
        },
        Tone::Danger => Palette {
            bg: c::DANGER_FILL,
            bg_hover: c::DANGER_FILL_HOVER,
            bg_down: c::DANGER_FILL,
            fg: Color32::WHITE,
            fg_hover: Color32::WHITE,
            border: Color32::TRANSPARENT,
            border_hover: Color32::TRANSPARENT,
        },
    }
}

impl Widget for Btn<'_> {
    fn ui(self, ui: &mut Ui) -> Response {
        let height = if self.small { 28.0 } else { 34.0 };
        let font = theme::medium(if self.small { 12.5 } else { 13.5 });
        let icon_font = theme::icon_font(if self.small { 14.5 } else { 16.0 });
        let label_g = (!self.label.is_empty()).then(|| galley(ui, self.label, font));
        let icon_g = self.icon.map(|i| galley(ui, i, icon_font));
        let gap = if label_g.is_some() && icon_g.is_some() { 7.0 } else { 0.0 };
        let icon_w = icon_g.as_ref().map_or(0.0, |g| g.size().x);
        let label_w = label_g.as_ref().map_or(0.0, |g| g.size().x);
        let pad = if self.small { 10.0 } else { 14.0 };
        let mut width = if label_g.is_none() {
            height
        } else {
            icon_w + gap + label_w + pad * 2.0
        };
        width = width.max(self.min_width);
        if self.fill_width {
            width = width.max(ui.available_width());
        }
        let interactive = self.enabled && !self.loading;
        let sense = if interactive { Sense::click() } else { Sense::hover() };
        let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(width, height), sense);

        if ui.is_rect_visible(rect) {
            let p = palette(self.tone, self.selected);
            let hovered = interactive && resp.hovered();
            let t = ui
                .ctx()
                .animate_bool_with_time(resp.id.with("hover"), hovered, 0.12);
            let mut bg = p.bg.lerp_to_gamma(p.bg_hover, t);
            if interactive && resp.is_pointer_button_down_on() {
                bg = p.bg_down;
            }
            let border = p.border.lerp_to_gamma(p.border_hover, t);
            let mut fg = p.fg.lerp_to_gamma(p.fg_hover, t);
            if !self.enabled {
                bg = bg.gamma_multiply(0.45);
                fg = c::FAINT;
            }
            let painter = ui.painter();
            painter.rect(rect, radius(), bg, Stroke::new(1.0_f32, border), StrokeKind::Inside);
            if resp.has_focus() {
                painter.rect_stroke(
                    rect.expand(2.0),
                    CornerRadius::same(theme::RADIUS + 2),
                    Stroke::new(1.5_f32, c::PINK),
                    StrokeKind::Outside,
                );
            }
            let content_w = icon_w + gap + label_w;
            let mut x = rect.center().x - content_w / 2.0;
            if let Some(g) = icon_g {
                let icon_rect = Rect::from_min_size(
                    Pos2::new(x, rect.center().y - g.size().y / 2.0),
                    g.size(),
                );
                if self.loading {
                    egui::Spinner::new()
                        .size(g.size().y.min(14.0))
                        .color(fg)
                        .paint_at(ui, icon_rect);
                } else {
                    painter.galley(icon_rect.min, g, fg);
                }
                x += icon_w + gap;
            } else if self.loading {
                let s = 14.0;
                egui::Spinner::new().size(s).color(fg).paint_at(
                    ui,
                    Rect::from_center_size(Pos2::new(rect.left() + pad / 2.0 + 2.0, rect.center().y), Vec2::splat(s)),
                );
            }
            if let Some(g) = label_g {
                painter.galley(Pos2::new(x, rect.center().y - g.size().y / 2.0), g, fg);
            }
        }
        if let Some(tip) = self.tooltip {
            resp = resp.on_hover_text(tip);
        }
        resp
    }
}

// ---------------------------------------------------------------- badges & states

pub fn badge(ui: &mut Ui, text: &str, color: Color32) -> Response {
    let g = galley(ui, text, theme::medium(11.5));
    let size = Vec2::new(g.size().x + 14.0, 20.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    let painter = ui.painter();
    painter.rect_filled(rect, CornerRadius::same(3), tint(color, 30));
    painter.galley(
        Pos2::new(rect.left() + 7.0, rect.center().y - g.size().y / 2.0),
        g,
        color,
    );
    resp
}

pub fn dot(ui: &mut Ui, color: Color32) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(10.0), Sense::hover());
    ui.painter().circle_filled(rect.center(), 3.5, color);
    resp
}

/// Dot + German status label, e.g. "● Läuft".
pub fn state_badge(ui: &mut Ui, state: &str) -> Response {
    let (color, text) = theme::state_tone(state);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 6.0;
        dot(ui, color);
        ui.label(RichText::new(text).font(theme::medium(12.5)).color(color));
    })
    .response
}

// ---------------------------------------------------------------- meters

pub fn usage_color(frac: f32) -> Color32 {
    if frac >= 0.9 {
        c::DANGER
    } else if frac >= 0.75 {
        c::WARN
    } else {
        c::PINK
    }
}

/// Thin capacity bar. Brand gradient (purple → pink) below 75 %, semantic above.
pub fn meter(ui: &mut Ui, frac: f32, width: f32, height: f32) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::hover());
    paint_meter(ui, rect, frac);
    resp
}

pub fn paint_meter(ui: &Ui, rect: Rect, frac: f32) {
    let frac = if frac.is_finite() { frac.clamp(0.0, 1.0) } else { 0.0 };
    let painter = ui.painter();
    let r = rect.height() / 2.0;
    painter.rect_filled(rect, CornerRadius::same(r as u8), c::RAISED);
    if frac <= 0.0 {
        return;
    }
    let fill_w = (rect.width() * frac).max(rect.height());
    let fill = Rect::from_min_size(rect.min, Vec2::new(fill_w, rect.height()));
    let semantic = usage_color(frac);
    if semantic != c::PINK {
        painter.rect_filled(fill, CornerRadius::same(r as u8), semantic);
        return;
    }
    // Rounded gradient: caps + horizontal gradient quad between cap centres.
    let start = c::PURPLE;
    let end = c::PURPLE.lerp_to_gamma(c::PINK, (frac / 0.75).clamp(0.0, 1.0));
    painter.circle_filled(Pos2::new(fill.left() + r, fill.center().y), r, start);
    painter.circle_filled(Pos2::new(fill.right() - r, fill.center().y), r, end);
    let quad = Rect::from_min_max(
        Pos2::new(fill.left() + r, fill.top()),
        Pos2::new(fill.right() - r, fill.bottom()),
    );
    if quad.width() > 0.0 {
        let mut mesh = egui::Mesh::default();
        mesh.colored_vertex(quad.left_top(), start);
        mesh.colored_vertex(quad.right_top(), end);
        mesh.colored_vertex(quad.right_bottom(), end);
        mesh.colored_vertex(quad.left_bottom(), start);
        mesh.add_triangle(0, 1, 2);
        mesh.add_triangle(0, 2, 3);
        painter.add(egui::Shape::mesh(mesh));
    }
}

/// Label + value line with a full-width meter underneath.
pub fn meter_block(ui: &mut Ui, name: &str, frac: f32, detail: &str) {
    ui.horizontal(|ui| {
        ui.label(label(name));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(RichText::new(detail).font(theme::mono(12.0)).color(c::TEXT_2));
        });
    });
    ui.add_space(2.0);
    meter(ui, frac, ui.available_width(), 6.0);
    ui.add_space(10.0);
}

/// Compact inline meter with percentage text, for table cells.
pub fn meter_cell(ui: &mut Ui, frac: Option<f32>) {
    match frac {
        Some(f) if f.is_finite() => {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 8.0;
                meter(ui, f, 64.0, 5.0);
                ui.label(
                    RichText::new(format!("{:>3.0}%", f.clamp(0.0, 9.99) * 100.0))
                        .font(theme::mono(11.5))
                        .color(c::TEXT_2),
                );
            });
        }
        _ => {
            ui.label(small("—"));
        }
    }
}

// ---------------------------------------------------------------- layout blocks

pub fn panel_frame() -> Frame {
    Frame::new()
        .fill(c::PANEL)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(radius())
        .inner_margin(Margin::same(16))
}

/// Bordered panel with a title row (optional right-side actions).
pub fn section<R>(
    ui: &mut Ui,
    heading: &str,
    actions: impl FnOnce(&mut Ui),
    add_contents: impl FnOnce(&mut Ui) -> R,
) -> R {
    panel_frame()
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(title(heading));
                ui.with_layout(Layout::right_to_left(Align::Center), actions);
            });
            ui.add_space(10.0);
            add_contents(ui)
        })
        .inner
}

/// Page title row: title + optional context line, actions on the right.
pub fn page_header(ui: &mut Ui, heading: &str, context: Option<&str>, actions: impl FnOnce(&mut Ui)) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.spacing_mut().item_spacing.y = 2.0;
            ui.label(RichText::new(heading).font(theme::semibold(22.0)).color(c::TEXT));
            if let Some(ctx) = context {
                ui.label(muted(ctx));
            }
        });
        ui.with_layout(Layout::right_to_left(Align::Center), actions);
    });
    ui.add_space(18.0);
}

pub fn empty_state(ui: &mut Ui, icon: &str, heading: &str, text: &str) {
    ui.vertical_centered(|ui| {
        ui.add_space(28.0);
        ui.label(icon_text(icon, 30.0, c::FAINT));
        ui.add_space(8.0);
        ui.label(title(heading));
        ui.add_space(2.0);
        ui.label(muted(text));
        ui.add_space(28.0);
    });
}

/// Inline error callout. Returns true when "Erneut versuchen" was clicked.
pub fn error_box(ui: &mut Ui, err: &ApiError) -> bool {
    let mut retry = false;
    Frame::new()
        .fill(tint(c::DANGER, 22))
        .stroke(Stroke::new(1.0_f32, tint(c::DANGER, 90)))
        .corner_radius(radius())
        .inner_margin(Margin::symmetric(14, 10))
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(icon_text(ph::WARNING_CIRCLE, 18.0, c::DANGER));
                ui.vertical(|ui| {
                    ui.spacing_mut().item_spacing.y = 2.0;
                    let heading = if err.is_forbidden() {
                        "Keine Berechtigung"
                    } else {
                        "Laden fehlgeschlagen"
                    };
                    ui.label(strong(heading));
                    ui.label(secondary(err.message.clone()));
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if !err.is_forbidden()
                        && ui
                            .add(Btn::secondary("Erneut versuchen").icon(ph::ARROW_CLOCKWISE).small())
                            .clicked()
                    {
                        retry = true;
                    }
                });
            });
        });
    retry
}

/// Soft callout for hints (info / warning).
pub fn callout(ui: &mut Ui, icon: &str, color: Color32, text: &str) {
    Frame::new()
        .fill(tint(color, 18))
        .stroke(Stroke::new(1.0_f32, tint(color, 70)))
        .corner_radius(radius())
        .inner_margin(Margin::symmetric(12, 8))
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                ui.label(icon_text(icon, 16.0, color));
                ui.label(secondary(text));
            });
        });
}

/// Loading placeholder rows with a gentle pulse.
pub fn skeleton(ui: &mut Ui, rows: usize) {
    let t = ui.input(|i| i.time) as f32;
    let alpha = 0.55 + 0.25 * (t * 2.4).sin();
    for i in 0..rows {
        let w = ui.available_width() * if i % 3 == 2 { 0.62 } else { 1.0 };
        let (rect, _) = ui.allocate_exact_size(Vec2::new(w, 14.0), Sense::hover());
        ui.painter()
            .rect_filled(rect, CornerRadius::same(3), c::RAISED.gamma_multiply(alpha));
        ui.add_space(12.0);
    }
    ui.ctx().request_repaint();
}

/// Key/value rows aligned in two columns.
pub fn kv_grid(ui: &mut Ui, id: &str, rows: &[(&str, String)]) {
    egui::Grid::new(id)
        .num_columns(2)
        .spacing([24.0, 9.0])
        .min_col_width(120.0)
        .show(ui, |ui| {
            for (k, v) in rows {
                ui.label(muted(*k));
                ui.label(body(if v.is_empty() { "—".to_owned() } else { v.clone() }));
                ui.end_row();
            }
        });
}

// ---------------------------------------------------------------- inputs

pub fn search_input(ui: &mut Ui, value: &mut String, hint: &str, width: f32) -> Response {
    Frame::new()
        .fill(c::INPUT)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(radius())
        .inner_margin(Margin::symmetric(10, 0))
        .show(ui, |ui| {
            ui.set_width(width - 20.0);
            ui.horizontal(|ui| {
                ui.label(icon_text(ph::MAGNIFYING_GLASS, 15.0, c::MUTED));
                ui.add(
                    egui::TextEdit::singleline(value)
                        .hint_text(RichText::new(hint).color(c::MUTED))
                        .frame(false)
                        .desired_width(f32::INFINITY)
                        .margin(Margin::symmetric(2, 8)),
                )
            })
            .inner
        })
        .inner
}

pub fn text_input(ui: &mut Ui, value: &mut String, hint: &str, width: f32) -> Response {
    ui.add(
        egui::TextEdit::singleline(value)
            .hint_text(RichText::new(hint).color(c::MUTED))
            .desired_width(width)
            .margin(Margin::symmetric(10, 8)),
    )
}

pub fn password_input(ui: &mut Ui, value: &mut String, hint: &str, width: f32) -> Response {
    ui.add(
        egui::TextEdit::singleline(value)
            .password(true)
            .hint_text(RichText::new(hint).color(c::MUTED))
            .desired_width(width)
            .margin(Margin::symmetric(10, 8)),
    )
}

/// Vertical form field: label above, control below, optional hint under it.
pub fn field<R>(ui: &mut Ui, name: &str, hint: Option<&str>, control: impl FnOnce(&mut Ui) -> R) -> R {
    ui.label(label(name));
    ui.add_space(2.0);
    let r = control(ui);
    if let Some(h) = hint {
        ui.label(small(h));
    }
    ui.add_space(8.0);
    r
}

pub fn combo<T: PartialEq + Clone>(
    ui: &mut Ui,
    id: impl std::hash::Hash,
    current: &mut T,
    options: &[(T, String)],
    width: f32,
) -> bool {
    let selected_text = options
        .iter()
        .find(|(v, _)| v == current)
        .map(|(_, l)| l.clone())
        .unwrap_or_else(|| "—".into());
    let mut changed = false;
    egui::ComboBox::from_id_salt(id)
        .width(width)
        .selected_text(RichText::new(selected_text).color(c::TEXT))
        .show_ui(ui, |ui| {
            for (value, text) in options {
                if ui
                    .selectable_label(current == value, text.as_str())
                    .clicked()
                    && current != value
                {
                    *current = value.clone();
                    changed = true;
                }
            }
        });
    changed
}

/// Underlined tab strip. Returns true when the selection changed.
pub fn tabs<T: PartialEq + Copy>(ui: &mut Ui, current: &mut T, items: &[(T, &str)]) -> bool {
    let mut changed = false;
    let line_y;
    {
        let rect = ui
            .horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                for (value, text) in items {
                    let selected = *current == *value;
                    let g = galley(ui, text, theme::medium(13.0));
                    let size = Vec2::new(g.size().x + 20.0, 34.0);
                    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
                    let hovered = resp.hovered();
                    let color = if selected {
                        c::TEXT
                    } else if hovered {
                        c::TEXT_2
                    } else {
                        c::MUTED
                    };
                    ui.painter().galley(
                        Pos2::new(rect.left() + 10.0, rect.center().y - g.size().y / 2.0 - 1.0),
                        g,
                        color,
                    );
                    if selected {
                        ui.painter().rect_filled(
                            Rect::from_min_max(
                                Pos2::new(rect.left() + 6.0, rect.bottom() - 2.0),
                                Pos2::new(rect.right() - 6.0, rect.bottom()),
                            ),
                            CornerRadius::same(1),
                            c::PINK,
                        );
                    }
                    if resp.clicked() && !selected {
                        *current = *value;
                        changed = true;
                    }
                }
            })
            .response
            .rect;
        line_y = rect.bottom();
    }
    let full = ui.max_rect();
    ui.painter().hline(full.x_range(), line_y + 0.5, Stroke::new(1.0_f32, c::BORDER));
    ui.add_space(14.0);
    changed
}

/// Compact segmented toggle (filters). Returns true when changed.
pub fn segmented<T: PartialEq + Copy>(ui: &mut Ui, current: &mut T, items: &[(T, &str)]) -> bool {
    let mut changed = false;
    Frame::new()
        .fill(c::INPUT)
        .stroke(Stroke::new(1.0_f32, c::BORDER))
        .corner_radius(radius())
        .inner_margin(Margin::same(2))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (value, text) in items {
                    let selected = *current == *value;
                    let g = galley(ui, text, theme::medium(12.5));
                    let size = Vec2::new(g.size().x + 18.0, 26.0);
                    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
                    let bg = if selected {
                        c::RAISED
                    } else if resp.hovered() {
                        c::HOVER
                    } else {
                        Color32::TRANSPARENT
                    };
                    ui.painter().rect_filled(rect, CornerRadius::same(3), bg);
                    let fg = if selected { c::TEXT } else { c::MUTED };
                    ui.painter().galley(
                        Pos2::new(rect.left() + 9.0, rect.center().y - g.size().y / 2.0),
                        g,
                        fg,
                    );
                    if resp.clicked() && !selected {
                        *current = *value;
                        changed = true;
                    }
                }
            });
        });
    changed
}

/// Header cell text for tables.
pub fn th(ui: &mut Ui, text: &str) {
    ui.label(RichText::new(text).font(theme::medium(12.0)).color(c::MUTED));
}

pub fn copy_button(ui: &mut Ui, value: &str) {
    if ui.add(Btn::icon_only(ph::COPY, "Kopieren").small()).clicked() {
        ui.ctx().copy_text(value.to_owned());
    }
}

pub fn separator(ui: &mut Ui) {
    let rect = ui.available_rect_before_wrap();
    let y = ui.cursor().top() + 4.0;
    ui.painter()
        .hline(rect.x_range(), y, Stroke::new(1.0_f32, c::BORDER));
    ui.add_space(9.0);
}

// ---------------------------------------------------------------- menus

/// Button that toggles a dropdown below it. Items should call `menu_item`.
pub fn menu_button(ui: &mut Ui, id: impl std::hash::Hash, btn: Btn<'_>, add_contents: impl FnOnce(&mut Ui)) {
    let popup_id = ui.make_persistent_id(id);
    let resp = ui.add(btn);
    if resp.clicked() {
        ui.memory_mut(|m| m.toggle_popup(popup_id));
    }
    egui::popup_below_widget(ui, popup_id, &resp, PopupCloseBehavior::CloseOnClickOutside, |ui| {
        ui.set_min_width(220.0);
        ui.spacing_mut().item_spacing.y = 2.0;
        add_contents(ui);
    });
}

/// Menu row with icon; closes the popup on click. Returns true when chosen.
pub fn menu_item(ui: &mut Ui, icon: &str, text: &str, enabled: bool, danger: bool) -> bool {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width().max(200.0), 30.0), if enabled { Sense::click() } else { Sense::hover() });
    let hovered = enabled && resp.hovered();
    if hovered {
        ui.painter().rect_filled(rect, CornerRadius::same(3), c::HOVER);
    }
    let fg = if !enabled {
        c::FAINT
    } else if danger {
        c::DANGER
    } else if hovered {
        c::TEXT
    } else {
        c::TEXT_2
    };
    ui.painter().text(rect.left_center() + Vec2::new(14.0, 0.0), egui::Align2::CENTER_CENTER, icon, theme::icon_font(15.0), fg);
    ui.painter().text(rect.left_center() + Vec2::new(30.0, 0.0), egui::Align2::LEFT_CENTER, text, theme::medium(13.0), fg);
    let chosen = enabled && resp.clicked();
    if chosen {
        ui.memory_mut(|m| m.close_popup());
    }
    chosen
}

pub fn menu_separator(ui: &mut Ui) {
    let rect = ui.available_rect_before_wrap();
    let y = ui.cursor().top() + 3.0;
    ui.painter().hline(rect.x_range(), y, Stroke::new(1.0_f32, c::BORDER));
    ui.add_space(7.0);
}
