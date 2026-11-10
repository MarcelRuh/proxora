fn main() {
    println!("cargo:rerun-if-changed=packaging/proxora.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("packaging/proxora.ico");
        res.set("ProductName", "Proxora Desktop");
        res.set("FileDescription", "Proxora Desktop");
        res.set("CompanyName", "Proxora");
        if let Err(err) = res.compile() {
            println!("cargo:warning=Windows-Ressourcen (Icon) übersprungen: {err}");
        }
    }
}
