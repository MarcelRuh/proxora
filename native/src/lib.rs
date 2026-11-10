pub mod app;
#[cfg(feature = "demo")]
pub mod demo;
pub mod net;
pub mod pages;
pub mod prefs;
pub mod term;
pub mod theme;
pub mod ui;
pub mod updater;

pub use app::ProxoraApp;

pub fn native_options() -> eframe::NativeOptions {
    let icon = image::load_from_memory(include_bytes!("../assets/proxora-icon.png"))
        .ok()
        .map(|img| {
            let img = img.resize(256, 256, image::imageops::FilterType::Lanczos3).to_rgba8();
            let (width, height) = img.dimensions();
            egui::IconData { rgba: img.into_raw(), width, height }
        });
    let mut viewport = egui::ViewportBuilder::default()
        .with_inner_size([1360.0, 860.0])
        .with_min_inner_size([960.0, 600.0])
        .with_decorations(false)
        .with_title("Proxora")
        .with_app_id("proxora-desktop");
    if let Some(icon) = icon {
        viewport = viewport.with_icon(icon);
    }
    eframe::NativeOptions {
        viewport,
        centered: true,
        ..Default::default()
    }
}

pub fn run() -> eframe::Result<()> {
    eframe::run_native(
        "Proxora",
        native_options(),
        Box::new(|cc| Ok(Box::new(ProxoraApp::new(cc)))),
    )
}
