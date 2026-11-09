#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod app;
mod prefs;
mod theme;
mod updater;

use app::ProxoraApp;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1240.0, 800.0])
            .with_min_inner_size([960.0, 640.0])
            .with_decorations(false)
            .with_transparent(false)
            .with_title("Proxora Native"),
        ..Default::default()
    };
    eframe::run_native(
        "Proxora Native",
        options,
        Box::new(|cc| Ok(Box::new(ProxoraApp::new(cc)))),
    )
}
