pub mod chrome;
pub mod dialog;
pub mod nav;
pub mod palette;
pub mod shared;
pub mod workspace;

use crate::net::{Client, SessionUser};
use crate::pages::auth::{AuthOutcome, AuthScreen};
use crate::prefs::{self, Prefs};
use crate::theme;
use crate::updater::{self, UpdateCmd, UpdateMsg, UpdateState};
use eframe::egui;
use shared::Page;
use std::sync::mpsc::{Receiver, Sender};
use workspace::Workspace;

enum Phase {
    Auth(Box<AuthScreen>),
    Main(Box<Workspace>),
}

pub struct ProxoraApp {
    prefs: Prefs,
    phase: Phase,
    update_state: UpdateState,
    update_cmd: Sender<UpdateCmd>,
    update_rx: Receiver<UpdateMsg>,
}

impl ProxoraApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        Self::with_context(&cc.egui_ctx, prefs::load())
    }

    pub fn with_context(ctx: &egui::Context, prefs: Prefs) -> Self {
        egui_extras::install_image_loaders(ctx);
        theme::install(ctx);
        if (prefs.ui_scale - 1.0).abs() > f32::EPSILON {
            ctx.set_zoom_factor(prefs.ui_scale.clamp(0.75, 2.0));
        }
        let (update_cmd, update_rx) = updater::spawn();
        if prefs.auto_check_updates {
            let _ = update_cmd.send(UpdateCmd::Check);
        }
        let phase = Phase::Auth(Box::new(AuthScreen::new(ctx, &prefs, None)));
        Self {
            prefs,
            phase,
            update_state: UpdateState::UpToDate,
            update_cmd,
            update_rx,
        }
    }

    /// Starts directly inside the workspace (demo / snapshots).
    pub fn signed_in(
        ctx: &egui::Context,
        prefs: Prefs,
        client: Client,
        user: SessionUser,
        page: Page,
    ) -> Self {
        let mut app = Self::with_context(ctx, prefs);
        let mut ws = Workspace::new(ctx, client, user, app.prefs.clone(), app.update_cmd.clone(), Some("2.4.18".into()));
        ws.set_page(page);
        app.phase = Phase::Main(Box::new(ws));
        app
    }

    #[cfg(feature = "demo")]
    pub fn demo_login(ctx: &egui::Context, prefs: Prefs, client: Client) -> Self {
        let mut app = Self::with_context(ctx, prefs);
        app.phase = Phase::Auth(Box::new(AuthScreen::demo(ctx, client, &app.prefs)));
        app
    }

    pub fn workspace_mut(&mut self) -> Option<&mut Workspace> {
        match &mut self.phase {
            Phase::Main(ws) => Some(ws),
            Phase::Auth(_) => None,
        }
    }

    pub fn ui(&mut self, ctx: &egui::Context) {
        while let Ok(UpdateMsg::State(state)) = self.update_rx.try_recv() {
            self.update_state = state;
        }
        app_chrome_edges(ctx);

        let mut next: Option<Phase> = None;
        match &mut self.phase {
            Phase::Auth(screen) => {
                if let AuthOutcome::LoggedIn { client, user, server_version } = screen.ui(ctx, &mut self.prefs) {
                    next = Some(Phase::Main(Box::new(Workspace::new(
                        ctx,
                        client,
                        user,
                        self.prefs.clone(),
                        self.update_cmd.clone(),
                        server_version,
                    ))));
                }
            }
            Phase::Main(ws) => {
                ws.ui(ctx, &self.update_state);
                if ws.sh.prefs_dirty {
                    ws.sh.prefs_dirty = false;
                    self.prefs = ws.sh.prefs.clone();
                    let _ = prefs::save(&self.prefs);
                }
                let expired = ws.sh.client.take_unauthorized();
                if ws.sh.logout || expired {
                    if ws.sh.logout {
                        let client = ws.sh.client.clone();
                        std::thread::spawn(move || {
                            let _ = client.post::<serde_json::Value>("/api/auth/logout", &serde_json::json!({}));
                        });
                    }
                    self.prefs.session_token = None;
                    let _ = prefs::save(&self.prefs);
                    let notice = expired.then(|| "Die Sitzung ist abgelaufen. Bitte erneut anmelden.".to_owned());
                    next = Some(Phase::Auth(Box::new(AuthScreen::new(ctx, &self.prefs, notice))));
                }
            }
        }
        if let Some(phase) = next {
            self.phase = phase;
        }
    }
}

fn app_chrome_edges(ctx: &egui::Context) {
    chrome::resize_edges(ctx);
}

impl eframe::App for ProxoraApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.ui(ctx);
    }
}
