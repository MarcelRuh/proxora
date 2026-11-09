#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod app;
mod prefs;

use app::ProxoraApp;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1180.0, 760.0])
            .with_min_inner_size([900.0, 600.0])
            .with_title("Proxora Native"),
        ..Default::default()
    };
    eframe::run_native(
        "Proxora Native",
        options,
        Box::new(|cc| Ok(Box::new(ProxoraApp::new(cc)))),
    )
}
