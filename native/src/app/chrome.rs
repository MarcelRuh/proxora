//! Custom window chrome: title bar with window controls, resize edges, status bar.

use crate::theme::{self, c, STATUSBAR_H, TITLEBAR_H};
use eframe::egui::{
    self, viewport::ResizeDirection, Align, Align2, Color32, CursorIcon, Frame,
    Id, Layout, Margin, Pos2, Sense, Stroke, Ui, UiBuilder, Vec2, ViewportCommand,
};
use egui_phosphor::regular as ph;

const EDGE: f32 = 5.0;

fn maximized(ctx: &egui::Context) -> bool {
    ctx.input(|i| i.viewport().maximized.unwrap_or(false) || i.viewport().fullscreen.unwrap_or(false))
}

fn edge_at(ctx: &egui::Context) -> Option<ResizeDirection> {
    if maximized(ctx) {
        return None;
    }
    let rect = ctx.screen_rect();
    let pos = ctx.input(|i| i.pointer.hover_pos())?;
    let left = pos.x - rect.left() <= EDGE;
    let right = rect.right() - pos.x <= EDGE;
    let top = pos.y - rect.top() <= EDGE;
    let bottom = rect.bottom() - pos.y <= EDGE;
    match (left, right, top, bottom) {
        (true, _, true, _) => Some(ResizeDirection::NorthWest),
        (_, true, true, _) => Some(ResizeDirection::NorthEast),
        (true, _, _, true) => Some(ResizeDirection::SouthWest),
        (_, true, _, true) => Some(ResizeDirection::SouthEast),
        (true, _, _, _) => Some(ResizeDirection::West),
        (_, true, _, _) => Some(ResizeDirection::East),
        (_, _, true, _) => Some(ResizeDirection::North),
        (_, _, _, true) => Some(ResizeDirection::South),
        _ => None,
    }
}

/// Undecorated windows need their own resize handles.
pub fn resize_edges(ctx: &egui::Context) {
    let Some(dir) = edge_at(ctx) else {
        return;
    };
    let icon = match dir {
        ResizeDirection::North | ResizeDirection::South => CursorIcon::ResizeVertical,
        ResizeDirection::East | ResizeDirection::West => CursorIcon::ResizeHorizontal,
        ResizeDirection::NorthWest | ResizeDirection::SouthEast => CursorIcon::ResizeNwSe,
        ResizeDirection::NorthEast | ResizeDirection::SouthWest => CursorIcon::ResizeNeSw,
    };
    ctx.set_cursor_icon(icon);
    if ctx.input(|i| i.pointer.primary_pressed()) {
        ctx.send_viewport_cmd(ViewportCommand::BeginResize(dir));
    }
}

pub fn toggle_maximize(ctx: &egui::Context) {
    let max = ctx.input(|i| i.viewport().maximized.unwrap_or(false));
    ctx.send_viewport_cmd(ViewportCommand::Maximized(!max));
}

pub fn title_bar(ctx: &egui::Context, add_contents: impl FnOnce(&mut Ui)) {
    egui::TopBottomPanel::top("proxora_titlebar")
        .exact_height(TITLEBAR_H)
        .frame(Frame::new().fill(c::CHROME))
        .show_separator_line(false)
        .show(ctx, |ui| {
            let rect = ui.max_rect();
            ui.painter()
                .hline(rect.x_range(), rect.bottom() - 0.5, Stroke::new(1.0_f32, c::BORDER));

            // Registered first so every widget drawn later wins the hit test.
            let drag = ui.interact(rect, Id::new("proxora_titlebar_drag"), Sense::click_and_drag());
            if drag.double_clicked() {
                toggle_maximize(ctx);
            } else if drag.drag_started_by(egui::PointerButton::Primary) && edge_at(ctx).is_none() {
                ctx.send_viewport_cmd(ViewportCommand::StartDrag);
            }

            ui.scope_builder(
                UiBuilder::new()
                    .max_rect(rect)
                    .layout(Layout::right_to_left(Align::Center)),
                |ui| {
                    ui.spacing_mut().item_spacing.x = 0.0;
                    window_controls(ui, ctx);
                    ui.add_space(8.0);
                    ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        add_contents(ui);
                    });
                },
            );
        });
}

fn window_controls(ui: &mut Ui, ctx: &egui::Context) {
    let max = maximized(ctx);
    if control_button(ui, ph::X, true).on_hover_text("Schließen").clicked() {
        ctx.send_viewport_cmd(ViewportCommand::Close);
    }
    let restore_icon = if max { ph::COPY } else { ph::SQUARE };
    let tip = if max { "Wiederherstellen" } else { "Maximieren" };
    if control_button(ui, restore_icon, false).on_hover_text(tip).clicked() {
        toggle_maximize(ctx);
    }
    if control_button(ui, ph::MINUS, false).on_hover_text("Minimieren").clicked() {
        ctx.send_viewport_cmd(ViewportCommand::Minimized(true));
    }
}

fn control_button(ui: &mut Ui, icon: &str, close: bool) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(46.0, TITLEBAR_H), Sense::click());
    let hovered = resp.hovered();
    let bg = match (hovered, close) {
        (true, true) => Color32::from_rgb(0xc4, 0x2b, 0x1c),
        (true, false) => c::HOVER,
        _ => Color32::TRANSPARENT,
    };
    ui.painter().rect_filled(rect, 0.0, bg);
    let fg = if hovered { c::TEXT } else { c::MUTED };
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        icon,
        theme::icon_font(15.0),
        fg,
    );
    resp
}

/// Brand lockup used in the title bar and on auth screens.
pub fn brand(ui: &mut Ui, size: f32) {
    ui.add(
        egui::Image::new(egui::include_image!("../../assets/proxora-icon.png"))
            .fit_to_exact_size(Vec2::splat(size))
            .corner_radius(4.0),
    );
    ui.label(
        egui::RichText::new("PROXORA")
            .font(theme::display(size * 0.52))
            .color(c::TEXT),
    );
}

pub fn status_bar(ctx: &egui::Context, add_contents: impl FnOnce(&mut Ui)) {
    egui::TopBottomPanel::bottom("proxora_statusbar")
        .exact_height(STATUSBAR_H)
        .frame(
            Frame::new()
                .fill(c::CHROME)
                .inner_margin(Margin::symmetric(12, 0)),
        )
        .show_separator_line(false)
        .show(ctx, |ui| {
            let rect = ui.max_rect().expand2(Vec2::new(12.0, 0.0));
            ui.painter()
                .hline(rect.x_range(), rect.top() + 0.5, Stroke::new(1.0_f32, c::BORDER));
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 14.0;
                add_contents(ui);
            });
        });
}

/// Small text + icon item for the status bar. Returns the response for tooltips / clicks.
pub fn status_item(ui: &mut Ui, icon: &str, text: &str, color: Color32) -> egui::Response {
    let font = theme::regular(11.5);
    let icon_font = theme::icon_font(13.0);
    let ig = ui.fonts(|f| f.layout_no_wrap(icon.to_owned(), icon_font, color));
    let tg = ui.fonts(|f| f.layout_no_wrap(text.to_owned(), font, c::TEXT_2));
    let size = Vec2::new(ig.size().x + 6.0 + tg.size().x + 8.0, STATUSBAR_H);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(rect.shrink2(Vec2::new(0.0, 3.0)), 3.0, c::HOVER);
    }
    let y = rect.center().y;
    ui.painter()
        .galley(Pos2::new(rect.left() + 4.0, y - ig.size().y / 2.0), ig.clone(), color);
    ui.painter().galley(
        Pos2::new(rect.left() + 4.0 + ig.size().x + 6.0, y - tg.size().y / 2.0),
        tg,
        c::TEXT_2,
    );
    resp
}
