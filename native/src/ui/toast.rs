use crate::theme::{self, c, tint, STATUSBAR_H};
use crate::ui::widgets::{icon_text, muted};
use eframe::egui::{self, Align, Align2, Frame, Layout, Margin, RichText, Sense, Stroke, Vec2};
use egui_phosphor::regular as ph;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ToastKind {
    Success,
    Error,
    Info,
    Warning,
}

struct Toast {
    id: u64,
    kind: ToastKind,
    title: String,
    detail: Option<String>,
    created: Instant,
    ttl: Duration,
}

#[derive(Default)]
pub struct Toasts {
    items: Vec<Toast>,
    next_id: u64,
}

impl Toasts {
    pub fn push(&mut self, kind: ToastKind, title: impl Into<String>, detail: Option<String>) {
        let ttl = match kind {
            ToastKind::Error => Duration::from_secs(9),
            ToastKind::Warning => Duration::from_secs(7),
            _ => Duration::from_secs(4),
        };
        self.next_id += 1;
        self.items.push(Toast {
            id: self.next_id,
            kind,
            title: title.into(),
            detail,
            created: Instant::now(),
            ttl,
        });
        if self.items.len() > 5 {
            self.items.remove(0);
        }
    }

    pub fn success(&mut self, title: impl Into<String>) {
        self.push(ToastKind::Success, title, None);
    }

    pub fn info(&mut self, title: impl Into<String>) {
        self.push(ToastKind::Info, title, None);
    }

    pub fn error(&mut self, title: impl Into<String>, detail: impl Into<String>) {
        self.push(ToastKind::Error, title, Some(detail.into()));
    }

    pub fn warning(&mut self, title: impl Into<String>, detail: impl Into<String>) {
        self.push(ToastKind::Warning, title, Some(detail.into()));
    }

    pub fn show(&mut self, ctx: &egui::Context) {
        self.items.retain(|t| t.created.elapsed() < t.ttl);
        if self.items.is_empty() {
            return;
        }
        let mut dismiss = None;
        egui::Area::new(egui::Id::new("proxora_toasts"))
            .anchor(Align2::RIGHT_BOTTOM, Vec2::new(-16.0, -(STATUSBAR_H + 14.0)))
            .order(egui::Order::Foreground)
            .interactable(true)
            .show(ctx, |ui| {
                ui.with_layout(Layout::bottom_up(Align::RIGHT), |ui| {
                    for toast in self.items.iter().rev() {
                        let age = toast.created.elapsed();
                        let remaining = toast.ttl.saturating_sub(age).as_secs_f32();
                        let enter = (age.as_secs_f32() / 0.16).min(1.0);
                        let opacity = enter * (remaining / 0.3).min(1.0);
                        let (color, icon) = match toast.kind {
                            ToastKind::Success => (c::OK, ph::CHECK_CIRCLE),
                            ToastKind::Error => (c::DANGER, ph::WARNING_CIRCLE),
                            ToastKind::Warning => (c::WARN, ph::WARNING),
                            ToastKind::Info => (c::CYAN, ph::INFO),
                        };
                        ui.scope(|ui| {
                            ui.multiply_opacity(opacity);
                            let resp = Frame::new()
                                .fill(c::RAISED)
                                .stroke(Stroke::new(1.0_f32, tint(color, 110)))
                                .corner_radius(theme::radius())
                                .shadow(ui.visuals().popup_shadow)
                                .inner_margin(Margin::symmetric(14, 11))
                                .show(ui, |ui| {
                                    ui.set_width(340.0);
                                    ui.horizontal(|ui| {
                                        ui.label(icon_text(icon, 18.0, color));
                                        ui.vertical(|ui| {
                                            ui.spacing_mut().item_spacing.y = 2.0;
                                            ui.label(
                                                RichText::new(&toast.title)
                                                    .font(theme::semibold(13.5))
                                                    .color(c::TEXT),
                                            );
                                            if let Some(d) = &toast.detail {
                                                ui.add(egui::Label::new(muted(d.clone())).wrap());
                                            }
                                        });
                                    });
                                })
                                .response
                                .interact(Sense::click());
                            if resp.clicked() {
                                dismiss = Some(toast.id);
                            }
                        });
                        ui.add_space(8.0);
                    }
                });
            });
        if let Some(id) = dismiss {
            self.items.retain(|t| t.id != id);
        }
        ctx.request_repaint_after(Duration::from_millis(100));
    }
}
