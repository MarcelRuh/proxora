use super::shared::Shared;
use crate::theme::{self, c};
use crate::ui::widgets::{self as w, Btn};
use eframe::egui::{self, Frame, Margin, RichText, Stroke};
use egui_phosphor::regular as ph;

/// Renders the pending confirmation (if any) as a modal.
pub fn show_confirm(ctx: &egui::Context, sh: &mut Shared) {
    let Some(mut dlg) = sh.confirm.take() else {
        return;
    };
    let mut close = false;
    let mut accept = false;
    let modal = egui::Modal::new(egui::Id::new("proxora_confirm"))
        .backdrop_color(egui::Color32::from_black_alpha(150))
        .frame(
            Frame::new()
                .fill(c::PANEL)
                .stroke(Stroke::new(1.0_f32, c::BORDER_STRONG))
                .corner_radius(6)
                .shadow(ctx.style().visuals.window_shadow)
                .inner_margin(Margin::symmetric(22, 20)),
        )
        .show(ctx, |ui| {
            ui.set_width(420.0);
            ui.horizontal(|ui| {
                let (icon, color) = if dlg.danger {
                    (ph::WARNING, c::DANGER)
                } else {
                    (ph::QUESTION, c::CYAN)
                };
                ui.label(w::icon_text(icon, 20.0, color));
                ui.label(RichText::new(&dlg.title).font(theme::semibold(16.0)).color(c::TEXT));
            });
            ui.add_space(8.0);
            ui.add(egui::Label::new(w::secondary(dlg.body.clone())).wrap());
            let mut ready = true;
            if let Some(expected) = dlg.type_to_confirm.clone() {
                ui.add_space(12.0);
                ui.label(w::label(format!("Zur Bestätigung „{expected}“ eingeben")));
                let r = w::text_input(ui, &mut dlg.input, &expected, ui.available_width());
                r.request_focus();
                ready = dlg.input.trim() == expected;
            }
            ui.add_space(18.0);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let btn = if dlg.danger {
                    Btn::danger(&dlg.confirm_label)
                } else {
                    Btn::primary(&dlg.confirm_label)
                };
                if ui.add(btn.enabled(ready)).clicked() {
                    accept = true;
                }
                if ui.add(Btn::secondary("Abbrechen")).clicked() {
                    close = true;
                }
            });
            if ready && dlg.type_to_confirm.is_none() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                accept = true;
            }
        });
    if modal.should_close() {
        close = true;
    }
    if accept {
        (dlg.on_confirm)(sh);
    } else if !close {
        sh.confirm = Some(dlg);
    }
}

/// Generic modal frame for forms. Returns `true` when it should close.
pub fn form_modal(
    ctx: &egui::Context,
    id: &str,
    title: &str,
    width: f32,
    add_contents: impl FnOnce(&mut egui::Ui),
) -> bool {
    let modal = egui::Modal::new(egui::Id::new(id))
        .backdrop_color(egui::Color32::from_black_alpha(150))
        .frame(
            Frame::new()
                .fill(c::PANEL)
                .stroke(Stroke::new(1.0_f32, c::BORDER_STRONG))
                .corner_radius(6)
                .shadow(ctx.style().visuals.window_shadow)
                .inner_margin(Margin::symmetric(22, 20)),
        )
        .show(ctx, |ui| {
            ui.set_width(width);
            ui.label(RichText::new(title).font(theme::semibold(17.0)).color(c::TEXT));
            ui.add_space(14.0);
            let max_h = ctx.screen_rect().height() - 160.0;
            egui::ScrollArea::vertical()
                .max_height(max_h)
                .auto_shrink([false, true])
                .show(ui, add_contents);
        });
    modal.should_close()
}
