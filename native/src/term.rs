//! Native terminal: Proxora `/ws/console` WebSocket + vt100 emulation.

use crate::net::Client;
use crate::theme::{self, c};
use eframe::egui::{self, Color32, Event, EventFilter, Key, Modifiers, Pos2, Rect, Sense, Ui, Vec2};
use serde_json::{json, Value};
use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::num::NonZeroU16;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::client::IntoClientRequest;
use tungstenite::Message;

#[derive(Clone, Debug)]
pub struct TermRequest {
    pub title: String,
    pub host_id: String,
    pub node: String,
    /// `node`, `vm` or `lxc`.
    pub kind: String,
    pub vmid: Option<u64>,
    /// Server-side command mode, e.g. `upgrade` (apt dist-upgrade on the node).
    pub cmd: Option<String>,
    /// Typed into the shell once a prompt appears (community scripts).
    pub initial_input: Option<String>,
}

enum Incoming {
    Data(Vec<u8>),
    Connected,
    Error(String),
    Closed(Option<String>),
}

enum Outgoing {
    Input(String),
    Resize(u16, u16),
    Close,
}

#[derive(Clone, PartialEq)]
pub enum TermState {
    Connecting,
    Connected,
    Closed(String),
}

pub struct TermSession {
    pub id: u64,
    pub req: TermRequest,
    pub state: TermState,
    parser: vt100::Parser,
    rx: Receiver<Incoming>,
    tx: Sender<Outgoing>,
    cols: u16,
    rows: u16,
    font_size: f32,
    pending_input: Option<String>,
    last_output: Instant,
    started: Instant,
    focus_id: Option<egui::Id>,
}

fn nz(v: u16) -> NonZeroU16 {
    NonZeroU16::new(v.max(1)).expect("non-zero")
}

impl TermSession {
    pub fn open(ctx: &egui::Context, client: &Client, insecure: bool, req: TermRequest, id: u64) -> Self {
        let (in_tx, rx) = mpsc::channel();
        let (tx, out_rx) = mpsc::channel();
        let url = ws_url(client, &req, 100, 30);
        let cookie = client.session_cookie();
        let ctx2 = ctx.clone();
        thread::Builder::new()
            .name("proxora-term".into())
            .spawn(move || run_socket(url, cookie, insecure, in_tx, out_rx, ctx2))
            .expect("spawn terminal thread");
        Self {
            id,
            pending_input: req.initial_input.clone(),
            req,
            state: TermState::Connecting,
            parser: vt100::Parser::new(nz(30), nz(100), 5000),
            rx,
            tx,
            cols: 100,
            rows: 30,
            font_size: 13.0,
            last_output: Instant::now(),
            started: Instant::now(),
            focus_id: None,
        }
    }

    pub fn has_focus(&self, ctx: &egui::Context) -> bool {
        self.focus_id.is_some_and(|id| ctx.memory(|m| m.has_focus(id)))
    }

    pub fn close(&mut self) {
        let _ = self.tx.send(Outgoing::Close);
    }

    pub fn send(&self, text: &str) {
        let _ = self.tx.send(Outgoing::Input(text.to_owned()));
    }

    fn poll(&mut self) {
        loop {
            match self.rx.try_recv() {
                Ok(Incoming::Data(bytes)) => {
                    self.parser.process(&bytes);
                    self.last_output = Instant::now();
                }
                Ok(Incoming::Connected) => self.state = TermState::Connected,
                Ok(Incoming::Error(msg)) => {
                    let text = format!("\r\n\x1b[31m{msg}\x1b[0m\r\n");
                    self.parser.process(text.as_bytes());
                }
                Ok(Incoming::Closed(reason)) => {
                    let reason = reason.unwrap_or_else(|| "Verbindung beendet".into());
                    if !matches!(self.state, TermState::Closed(_)) {
                        let text = format!("\r\n\x1b[90m— {reason} —\x1b[0m\r\n");
                        self.parser.process(text.as_bytes());
                    }
                    self.state = TermState::Closed(reason);
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    if !matches!(self.state, TermState::Closed(_)) {
                        self.state = TermState::Closed("Verbindung beendet".into());
                    }
                    break;
                }
            }
        }
        // Type the queued command once the shell looks ready.
        if self.pending_input.is_some() && self.state == TermState::Connected {
            let quiet = self.last_output.elapsed() > Duration::from_millis(700);
            let line = self.cursor_line();
            let prompt = line.trim_end().ends_with('#') || line.trim_end().ends_with('$');
            if (prompt && quiet) || self.started.elapsed() > Duration::from_secs(12) {
                if let Some(cmd) = self.pending_input.take() {
                    self.send(&format!("{cmd}\r"));
                }
            }
        }
    }

    fn cursor_line(&self) -> String {
        let screen = self.parser.screen();
        let (row, _) = screen.cursor_position();
        let (_, cols) = screen.size();
        (0..cols.get())
            .filter_map(|col| screen.cell(row, col).map(|c| c.contents().to_owned()))
            .collect::<String>()
    }

    pub fn screen_text(&self) -> String {
        self.parser.screen().contents()
    }

    pub fn zoom(&mut self, delta: f32) {
        self.font_size = (self.font_size + delta).clamp(9.0, 22.0);
    }

    /// Renders the terminal grid and routes keyboard input while focused.
    pub fn ui(&mut self, ui: &mut Ui) {
        self.poll();
        let font = theme::mono(self.font_size);
        let char_w = ui.fonts(|f| f.glyph_width(&font, 'M'));
        let row_h = (self.font_size * 1.32).round();
        let avail = ui.available_size();
        let cols = ((avail.x - 16.0) / char_w).floor().clamp(20.0, 400.0) as u16;
        let rows = ((avail.y - 12.0) / row_h).floor().clamp(5.0, 200.0) as u16;
        if cols != self.cols || rows != self.rows {
            self.cols = cols;
            self.rows = rows;
            self.parser.set_size(nz(rows), nz(cols));
            let _ = self.tx.send(Outgoing::Resize(cols, rows));
        }

        let (rect, resp) = ui.allocate_exact_size(avail, Sense::click());
        let id = resp.id;
        self.focus_id = Some(id);
        if resp.clicked() {
            ui.memory_mut(|m| m.request_focus(id));
        }
        let focused = ui.memory(|m| m.has_focus(id));
        if focused {
            ui.memory_mut(|m| {
                m.set_focus_lock_filter(id, EventFilter { tab: true, horizontal_arrows: true, vertical_arrows: true, escape: true })
            });
            self.handle_input(ui);
        }

        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 4.0, TERM_BG);
        let origin = rect.min + Vec2::new(8.0, 6.0);
        let screen = self.parser.screen();
        let (cur_row, cur_col) = screen.cursor_position();
        for row in 0..rows {
            let y = origin.y + row as f32 * row_h;
            let mut col = 0u16;
            while col < cols {
                let Some(cell) = screen.cell(row, col) else {
                    col += 1;
                    continue;
                };
                if cell.is_wide_continuation() {
                    col += 1;
                    continue;
                }
                let (mut fg, mut bg) = (color(cell.fgcolor(), true), color(cell.bgcolor(), false));
                if cell.bold() && cell.fgcolor() == vt100::Color::Default {
                    fg = TERM_BRIGHT;
                }
                if cell.inverse() {
                    std::mem::swap(&mut fg, &mut bg);
                    if bg == Color32::TRANSPARENT {
                        bg = TERM_FG;
                    }
                    if fg == Color32::TRANSPARENT {
                        fg = TERM_BG;
                    }
                }
                if cell.dim() {
                    fg = fg.gamma_multiply(0.6);
                }
                let width = if cell.is_wide() { 2.0 } else { 1.0 };
                let x = origin.x + col as f32 * char_w;
                if bg != Color32::TRANSPARENT {
                    painter.rect_filled(Rect::from_min_size(Pos2::new(x, y), Vec2::new(char_w * width, row_h)), 0.0, bg);
                }
                let text = cell.contents();
                if !text.is_empty() && text != " " {
                    painter.text(Pos2::new(x, y + row_h / 2.0), egui::Align2::LEFT_CENTER, text, font.clone(), fg);
                }
                if cell.underline() {
                    painter.hline(x..=x + char_w * width, y + row_h - 2.0, egui::Stroke::new(1.0_f32, fg));
                }
                col += 1;
            }
        }
        if !screen.hide_cursor() && self.state == TermState::Connected {
            let x = origin.x + cur_col as f32 * char_w;
            let y = origin.y + cur_row as f32 * row_h;
            let cursor = Rect::from_min_size(Pos2::new(x, y + 1.0), Vec2::new(char_w, row_h - 2.0));
            if focused {
                let blink = (ui.input(|i| i.time) * 1.6).fract() < 0.6;
                if blink {
                    painter.rect_filled(cursor, 1.0, c::PINK.gamma_multiply(0.85));
                }
                ui.ctx().request_repaint_after(Duration::from_millis(250));
            } else {
                painter.rect_stroke(cursor, 1.0, egui::Stroke::new(1.0_f32, c::MUTED), egui::StrokeKind::Inside);
            }
        }
        if !focused {
            painter.rect_stroke(rect, 4.0, egui::Stroke::new(1.0_f32, c::BORDER), egui::StrokeKind::Inside);
        } else {
            painter.rect_stroke(rect, 4.0, egui::Stroke::new(1.0_f32, theme::tint(c::PINK, 120)), egui::StrokeKind::Inside);
        }
        if self.state != TermState::Connected {
            ui.ctx().request_repaint_after(Duration::from_millis(200));
        }
    }

    fn handle_input(&mut self, ui: &mut Ui) {
        let app_cursor = self.parser.screen().application_cursor();
        let events = ui.input(|i| i.events.clone());
        let mut out = String::new();
        for ev in events {
            match ev {
                Event::Text(t) => out.push_str(&t),
                Event::Paste(t) => out.push_str(&t.replace("\r\n", "\r").replace('\n', "\r")),
                Event::Copy => out.push('\x03'),
                Event::Cut => out.push('\x18'),
                Event::Key { key, pressed: true, modifiers, .. } => {
                    if let Some(seq) = key_seq(key, modifiers, app_cursor) {
                        out.push_str(&seq);
                    }
                }
                _ => {}
            }
        }
        if !out.is_empty() {
            self.send(&out);
        }
    }
}

impl Drop for TermSession {
    fn drop(&mut self) {
        let _ = self.tx.send(Outgoing::Close);
    }
}

const TERM_BG: Color32 = Color32::from_rgb(0x07, 0x07, 0x0b);
const TERM_FG: Color32 = Color32::from_rgb(0xd8, 0xd8, 0xe4);
const TERM_BRIGHT: Color32 = Color32::from_rgb(0xff, 0xff, 0xff);

const PALETTE: [Color32; 16] = [
    Color32::from_rgb(0x1a, 0x1a, 0x24),
    Color32::from_rgb(0xff, 0x54, 0x5e),
    Color32::from_rgb(0x06, 0xd6, 0xa0),
    Color32::from_rgb(0xff, 0xd6, 0x0a),
    Color32::from_rgb(0x4f, 0x8c, 0xff),
    Color32::from_rgb(0xc2, 0x5c, 0xff),
    Color32::from_rgb(0x00, 0xb4, 0xd8),
    Color32::from_rgb(0xd8, 0xd8, 0xe4),
    Color32::from_rgb(0x5c, 0x5c, 0x78),
    Color32::from_rgb(0xff, 0x7a, 0x82),
    Color32::from_rgb(0x4a, 0xf0, 0xbe),
    Color32::from_rgb(0xff, 0xe5, 0x6b),
    Color32::from_rgb(0x7f, 0xab, 0xff),
    Color32::from_rgb(0xd9, 0x8e, 0xff),
    Color32::from_rgb(0x5c, 0xd8, 0xf0),
    Color32::from_rgb(0xff, 0xff, 0xff),
];

fn color(c: vt100::Color, fg: bool) -> Color32 {
    match c {
        vt100::Color::Default => {
            if fg {
                TERM_FG
            } else {
                Color32::TRANSPARENT
            }
        }
        vt100::Color::Idx(i) if i < 16 => PALETTE[i as usize],
        vt100::Color::Idx(i) if i < 232 => {
            let i = i - 16;
            let level = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
            Color32::from_rgb(level(i / 36), level((i / 6) % 6), level(i % 6))
        }
        vt100::Color::Idx(i) => {
            let g = 8 + (i - 232) * 10;
            Color32::from_rgb(g, g, g)
        }
        vt100::Color::Rgb(r, g, b) => Color32::from_rgb(r, g, b),
    }
}

fn key_seq(key: Key, m: Modifiers, app_cursor: bool) -> Option<String> {
    let csi = |s: &str| format!("\x1b[{s}");
    let arrow = |c: char| if app_cursor { format!("\x1bO{c}") } else { format!("\x1b[{c}") };
    if m.ctrl && !m.alt {
        let name = key.name();
        if name.len() == 1 {
            let ch = name.chars().next()?.to_ascii_lowercase();
            if ch.is_ascii_lowercase() {
                return Some(((ch as u8 - b'a' + 1) as char).to_string());
            }
        }
    }
    Some(match key {
        Key::Enter => "\r".into(),
        Key::Backspace => "\x7f".into(),
        Key::Tab => if m.shift { csi("Z") } else { "\t".into() },
        Key::Escape => "\x1b".into(),
        Key::ArrowUp => arrow('A'),
        Key::ArrowDown => arrow('B'),
        Key::ArrowRight => arrow('C'),
        Key::ArrowLeft => arrow('D'),
        Key::Home => csi("H"),
        Key::End => csi("F"),
        Key::PageUp => csi("5~"),
        Key::PageDown => csi("6~"),
        Key::Insert => csi("2~"),
        Key::Delete => csi("3~"),
        Key::F1 => "\x1bOP".into(),
        Key::F2 => "\x1bOQ".into(),
        Key::F3 => "\x1bOR".into(),
        Key::F4 => "\x1bOS".into(),
        Key::F5 => csi("15~"),
        Key::F6 => csi("17~"),
        Key::F7 => csi("18~"),
        Key::F8 => csi("19~"),
        Key::F9 => csi("20~"),
        Key::F10 => csi("21~"),
        _ => return None,
    })
}

fn ws_url(client: &Client, req: &TermRequest, cols: u16, rows: u16) -> String {
    let mut url = client.base().join("ws/console").expect("static path");
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    let _ = url.set_scheme(scheme);
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("hostId", &req.host_id);
        q.append_pair("node", &req.node);
        q.append_pair("kind", &req.kind);
        if let Some(v) = req.vmid {
            q.append_pair("vmid", &v.to_string());
        }
        q.append_pair("cols", &cols.to_string());
        q.append_pair("rows", &rows.to_string());
        if let Some(cmd) = &req.cmd {
            q.append_pair("cmd", cmd);
        }
    }
    url.to_string()
}

#[derive(Debug)]
struct NoVerify(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn tls_config(insecure: bool) -> Arc<rustls::ClientConfig> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("tls versions");
    let config = if insecure {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerify(provider)))
            .with_no_client_auth()
    } else {
        let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
        builder.with_root_certificates(roots).with_no_client_auth()
    };
    Arc::new(config)
}

fn run_socket(
    url: String,
    cookie: Option<String>,
    insecure: bool,
    tx: Sender<Incoming>,
    rx: Receiver<Outgoing>,
    ctx: egui::Context,
) {
    let notify = |msg: Incoming| {
        let _ = tx.send(msg);
        ctx.request_repaint();
    };
    let parsed = match url::Url::parse(&url) {
        Ok(u) => u,
        Err(e) => return notify(Incoming::Closed(Some(e.to_string()))),
    };
    let host = parsed.host_str().unwrap_or_default().to_owned();
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addr = match (host.as_str(), port).to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => return notify(Incoming::Closed(Some(format!("{host} nicht auflösbar")))),
    };
    let stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(8)) {
        Ok(s) => s,
        Err(e) => return notify(Incoming::Closed(Some(format!("Verbindung fehlgeschlagen: {e}")))),
    };
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let mut request = match url.as_str().into_client_request() {
        Ok(r) => r,
        Err(e) => return notify(Incoming::Closed(Some(e.to_string()))),
    };
    if let Some(cookie) = cookie {
        if let Ok(v) = format!("{}={cookie}", crate::net::client::SESSION_COOKIE).parse() {
            request.headers_mut().insert("Cookie", v);
        }
    }
    if let Ok(v) = concat!("ProxoraNative/", env!("CARGO_PKG_VERSION")).parse() {
        request.headers_mut().insert("User-Agent", v);
    }
    let connector = if parsed.scheme() == "wss" {
        tungstenite::Connector::Rustls(tls_config(insecure))
    } else {
        tungstenite::Connector::Plain
    };
    let (mut ws, _) = match tungstenite::client_tls_with_config(request, stream, None, Some(connector)) {
        Ok(ok) => ok,
        Err(e) => return notify(Incoming::Closed(Some(format!("WebSocket-Handshake fehlgeschlagen: {e}")))),
    };
    let set_timeout = |ws: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>, d: Duration| {
        match ws.get_mut() {
            tungstenite::stream::MaybeTlsStream::Plain(s) => {
                let _ = s.set_read_timeout(Some(d));
            }
            tungstenite::stream::MaybeTlsStream::Rustls(s) => {
                let _ = s.get_mut().set_read_timeout(Some(d));
            }
            _ => {}
        }
    };
    set_timeout(&mut ws, Duration::from_millis(25));
    let mut last_ping = Instant::now();
    loop {
        match ws.read() {
            Ok(Message::Binary(bytes)) => notify(Incoming::Data(bytes.to_vec())),
            Ok(Message::Text(text)) => {
                let s = text.as_str();
                match serde_json::from_str::<Value>(s) {
                    Ok(v) if v.get("type").and_then(Value::as_str) == Some("status") => {
                        match v.get("status").and_then(Value::as_str) {
                            Some("connected") => notify(Incoming::Connected),
                            Some("error") => {
                                let msg = v.get("message").and_then(Value::as_str).unwrap_or("Fehler").to_owned();
                                notify(Incoming::Error(msg));
                            }
                            _ => {}
                        }
                    }
                    Ok(_) => {}
                    Err(_) => notify(Incoming::Data(s.as_bytes().to_vec())),
                }
            }
            Ok(Message::Close(frame)) => {
                let reason = frame.map(|f| match u16::from(f.code) {
                    4401 => "Nicht angemeldet".to_owned(),
                    4403 => "Keine Berechtigung".to_owned(),
                    4404 => "Host oder Gast nicht gefunden".to_owned(),
                    4400 => format!("Konsole nicht verfügbar: {}", f.reason),
                    _ if !f.reason.is_empty() => f.reason.to_string(),
                    _ => "Verbindung beendet".to_owned(),
                });
                return notify(Incoming::Closed(reason));
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                return notify(Incoming::Closed(None));
            }
            Err(e) => return notify(Incoming::Closed(Some(e.to_string()))),
        }
        loop {
            match rx.try_recv() {
                Ok(Outgoing::Input(data)) => {
                    let msg = json!({ "type": "input", "data": data }).to_string();
                    if ws.send(Message::Text(msg.into())).is_err() {
                        return notify(Incoming::Closed(None));
                    }
                }
                Ok(Outgoing::Resize(cols, rows)) => {
                    let msg = json!({ "type": "resize", "cols": cols, "rows": rows }).to_string();
                    let _ = ws.send(Message::Text(msg.into()));
                }
                Ok(Outgoing::Close) | Err(TryRecvError::Disconnected) => {
                    let _ = ws.close(None);
                    let _ = ws.flush();
                    return;
                }
                Err(TryRecvError::Empty) => break,
            }
        }
        if last_ping.elapsed() > Duration::from_secs(30) {
            last_ping = Instant::now();
            let _ = ws.send(Message::Text(json!({ "type": "ping" }).to_string().into()));
        }
    }
}
