use reqwest::blocking::multipart;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::redirect::Policy;
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

pub const SESSION_COOKIE: &str = "pm_session";

#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct ApiError {
    pub status: Option<u16>,
    pub code: Option<String>,
    pub message: String,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn msg(message: impl Into<String>) -> Self {
        Self {
            status: None,
            code: None,
            message: message.into(),
        }
    }

    fn network(err: reqwest::Error) -> Self {
        let message = if err.is_timeout() {
            "Zeitüberschreitung — der Server antwortet nicht.".to_string()
        } else if err.is_connect() {
            "Server nicht erreichbar. Adresse und Netzwerk prüfen.".to_string()
        } else {
            format!("Netzwerkfehler: {err}")
        };
        Self::msg(message)
    }

    fn http(status: u16, body: &str) -> Self {
        let parsed: Option<Value> = serde_json::from_str(body).ok();
        let server_msg = parsed
            .as_ref()
            .and_then(|v| v.get("error"))
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned);
        let code = parsed
            .as_ref()
            .and_then(|v| v.get("code"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let fallback = match status {
            400 => "Ungültige Anfrage.",
            401 => "Nicht angemeldet oder Sitzung abgelaufen.",
            403 => "Keine Berechtigung für diese Aktion.",
            404 => "Nicht gefunden.",
            409 => "Konflikt — der Zustand hat sich geändert.",
            429 => "Zu viele Anfragen. Kurz warten und erneut versuchen.",
            500..=599 => "Serverfehler.",
            _ => "Anfrage fehlgeschlagen.",
        };
        // Generic auth/limit messages come in English from the server; specific ones stay verbatim.
        let generic = matches!(
            code.as_deref(),
            Some("UNAUTHORIZED" | "FORBIDDEN" | "CSRF" | "RATE_LIMITED" | "INTERNAL_ERROR")
        );
        let message = match (server_msg, generic) {
            (Some(msg), false) => match code.as_deref() {
                Some("HOST_UNREACHABLE") => format!("Host nicht erreichbar: {msg}"),
                _ => msg,
            },
            _ => format!("{fallback} (HTTP {status})"),
        };
        Self {
            status: Some(status),
            code,
            message,
        }
    }

    pub fn is_unauthorized(&self) -> bool {
        self.status == Some(401)
    }

    pub fn is_forbidden(&self) -> bool {
        self.status == Some(403)
    }
}

pub type MockHandler = Arc<dyn Fn(&str, &str, Option<&Value>) -> ApiResult<Value> + Send + Sync>;

struct Inner {
    base: Url,
    http: reqwest::blocking::Client,
    jar: Arc<Jar>,
    mock: Option<MockHandler>,
    unauthorized: AtomicBool,
}

/// Cheap-to-clone handle to one Proxora server. All calls are blocking and
/// meant to run on worker threads (see `net::task`).
#[derive(Clone)]
pub struct Client {
    inner: Arc<Inner>,
}

impl Client {
    pub fn new(server_url: &str, allow_insecure_tls: bool) -> ApiResult<Self> {
        let base = normalize_base(server_url)?;
        let jar = Arc::new(Jar::default());
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(8))
            .cookie_provider(jar.clone())
            .redirect(Policy::limited(5))
            .danger_accept_invalid_certs(allow_insecure_tls)
            .user_agent(concat!("ProxoraNative/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(ApiError::network)?;
        Ok(Self {
            inner: Arc::new(Inner {
                base,
                http,
                jar,
                mock: None,
                unauthorized: AtomicBool::new(false),
            }),
        })
    }

    /// Offline client answering from `handler` — used for UI snapshots.
    pub fn mock(handler: MockHandler) -> Self {
        let base = Url::parse("https://demo.proxora.local/").expect("static url");
        Self {
            inner: Arc::new(Inner {
                base,
                http: reqwest::blocking::Client::new(),
                jar: Arc::new(Jar::default()),
                mock: Some(handler),
                unauthorized: AtomicBool::new(false),
            }),
        }
    }

    pub fn base(&self) -> &Url {
        &self.inner.base
    }

    pub fn host_label(&self) -> String {
        let base = &self.inner.base;
        match (base.host_str(), base.port()) {
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_owned(),
            _ => base.as_str().to_owned(),
        }
    }

    /// Absolute browser URL for a web-UI path (e.g. console pages).
    pub fn web_url(&self, path: &str) -> String {
        self.inner
            .base
            .join(path.trim_start_matches('/'))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| self.inner.base.to_string())
    }

    /// Returns true once after any request got a 401.
    pub fn take_unauthorized(&self) -> bool {
        self.inner.unauthorized.swap(false, Ordering::SeqCst)
    }

    pub fn session_cookie(&self) -> Option<String> {
        let header = self.inner.jar.cookies(&self.inner.base)?;
        let raw = header.to_str().ok()?;
        raw.split(';').find_map(|pair| {
            let (name, value) = pair.trim().split_once('=')?;
            (name == SESSION_COOKIE && !value.is_empty()).then(|| value.to_owned())
        })
    }

    pub fn restore_session(&self, value: &str) {
        let cookie = format!("{SESSION_COOKIE}={value}; Path=/");
        self.inner.jar.add_cookie_str(&cookie, &self.inner.base);
    }

    fn url(&self, path: &str) -> ApiResult<Url> {
        self.inner
            .base
            .join(path.trim_start_matches('/'))
            .map_err(|e| ApiError::msg(format!("Ungültiger Pfad {path}: {e}")))
    }

    fn request(&self, method: Method, path: &str, body: Option<Value>) -> ApiResult<Value> {
        self.request_with(method, path, body, None)
    }

    fn request_with(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        timeout: Option<Duration>,
    ) -> ApiResult<Value> {
        if let Some(mock) = &self.inner.mock {
            return mock(method.as_str(), path, body.as_ref());
        }
        let mut req = self.inner.http.request(method, self.url(path)?);
        if let Some(t) = timeout {
            req = req.timeout(t);
        }
        if let Some(body) = &body {
            req = req.json(body);
        }
        let res = req.send().map_err(ApiError::network)?;
        self.read(path, res)
    }

    fn read(&self, path: &str, res: reqwest::blocking::Response) -> ApiResult<Value> {
        let status = res.status().as_u16();
        let text = res.text().map_err(ApiError::network)?;
        if !(200..300).contains(&status) {
            if status == 401 && !path.starts_with("/api/auth/login") {
                self.inner.unauthorized.store(true, Ordering::SeqCst);
            }
            return Err(ApiError::http(status, &text));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }

    fn decode<T: DeserializeOwned>(path: &str, value: Value) -> ApiResult<T> {
        serde_json::from_value(value)
            .map_err(|e| ApiError::msg(format!("Antwort von {path} nicht lesbar: {e}")))
    }

    pub fn get<T: DeserializeOwned>(&self, path: &str) -> ApiResult<T> {
        Self::decode(path, self.request(Method::GET, path, None)?)
    }

    pub fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> ApiResult<T> {
        Self::decode(path, self.request(method, path, body)?)
    }

    pub fn post<T: DeserializeOwned>(&self, path: &str, body: &impl Serialize) -> ApiResult<T> {
        self.send(Method::POST, path, Some(to_value(body)?))
    }

    /// POST for server calls that block on Proxmox for minutes (e.g. `apt update`).
    pub fn post_long<T: DeserializeOwned>(&self, path: &str, body: &impl Serialize) -> ApiResult<T> {
        let value = self.request_with(Method::POST, path, Some(to_value(body)?), Some(Duration::from_secs(900)))?;
        Self::decode(path, value)
    }

    pub fn put<T: DeserializeOwned>(&self, path: &str, body: &impl Serialize) -> ApiResult<T> {
        self.send(Method::PUT, path, Some(to_value(body)?))
    }

    pub fn patch<T: DeserializeOwned>(&self, path: &str, body: &impl Serialize) -> ApiResult<T> {
        self.send(Method::PATCH, path, Some(to_value(body)?))
    }

    pub fn delete<T: DeserializeOwned>(&self, path: &str) -> ApiResult<T> {
        self.send(Method::DELETE, path, None)
    }

    pub fn delete_with<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> ApiResult<T> {
        self.send(Method::DELETE, path, Some(to_value(body)?))
    }

    /// Streams a binary response to `dest`. Returns bytes written.
    pub fn download(&self, path: &str, dest: &Path) -> ApiResult<u64> {
        if self.inner.mock.is_some() {
            return Err(ApiError::msg("Download im Demo-Modus nicht verfügbar"));
        }
        let mut res = self
            .inner
            .http
            .get(self.url(path)?)
            .timeout(Duration::from_secs(3600))
            .send()
            .map_err(ApiError::network)?;
        let status = res.status().as_u16();
        if !(200..300).contains(&status) {
            let text = res.text().unwrap_or_default();
            return Err(ApiError::http(status, &text));
        }
        let mut file = std::fs::File::create(dest)
            .map_err(|e| ApiError::msg(format!("Datei {} nicht schreibbar: {e}", dest.display())))?;
        res.copy_to(&mut file).map_err(ApiError::network)
    }

    /// Raw-body PUT streaming `file` (guest file uploads).
    pub fn put_file(&self, path: &str, file: &Path, offset: u64, headers: &[(&str, String)]) -> ApiResult<Value> {
        use std::io::{Seek, SeekFrom};
        if self.inner.mock.is_some() {
            return Err(ApiError::msg("Upload im Demo-Modus nicht verfügbar"));
        }
        let mut handle = std::fs::File::open(file)
            .map_err(|e| ApiError::msg(format!("Datei {} nicht lesbar: {e}", file.display())))?;
        let total = handle.metadata().map(|m| m.len()).unwrap_or(0);
        handle
            .seek(SeekFrom::Start(offset))
            .map_err(|e| ApiError::msg(format!("Datei {} nicht lesbar: {e}", file.display())))?;
        let len = total.saturating_sub(offset);
        let mut req = self
            .inner
            .http
            .put(self.url(path)?)
            .timeout(Duration::from_secs(6 * 3600))
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(reqwest::blocking::Body::sized(handle, len));
        for (k, v) in headers {
            req = req.header(*k, v.as_str());
        }
        let res = req.send().map_err(ApiError::network)?;
        self.read(path, res)
    }

    pub fn upload(
        &self,
        path: &str,
        file_field: &str,
        file: &Path,
        fields: &[(&str, String)],
    ) -> ApiResult<Value> {
        if self.inner.mock.is_some() {
            return Err(ApiError::msg("Upload im Demo-Modus nicht verfügbar"));
        }
        let mut form = multipart::Form::new();
        for (k, v) in fields {
            form = form.text(k.to_string(), v.clone());
        }
        form = form
            .file(file_field.to_string(), file)
            .map_err(|e| ApiError::msg(format!("Datei {} nicht lesbar: {e}", file.display())))?;
        let res = self
            .inner
            .http
            .post(self.url(path)?)
            .multipart(form)
            .timeout(Duration::from_secs(3600))
            .send()
            .map_err(ApiError::network)?;
        self.read(path, res)
    }
}

fn to_value(body: &impl Serialize) -> ApiResult<Value> {
    serde_json::to_value(body).map_err(|e| ApiError::msg(format!("Anfrage nicht serialisierbar: {e}")))
}

fn normalize_base(server_url: &str) -> ApiResult<Url> {
    let trimmed = server_url.trim();
    if trimmed.is_empty() {
        return Err(ApiError::msg("Server-Adresse fehlt."));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme)
        .map_err(|e| ApiError::msg(format!("Ungültige Server-Adresse: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ApiError::msg("Nur http:// und https:// werden unterstützt."));
    }
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&format!("{path}/"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// Percent-encodes one path segment (host ids, node names, UPIDs).
pub fn seg(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Builds a query string from key/value pairs, skipping empty values.
pub fn query(pairs: &[(&str, String)]) -> String {
    let parts: Vec<String> = pairs
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{}={}", seg(k), seg(v)))
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("?{}", parts.join("&"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_gets_scheme_and_trailing_slash() {
        let url = normalize_base("proxora.example.com").unwrap();
        assert_eq!(url.as_str(), "https://proxora.example.com/");
        let url = normalize_base("http://10.0.0.5:3000/sub/").unwrap();
        assert_eq!(url.as_str(), "http://10.0.0.5:3000/sub/");
    }

    #[test]
    fn segment_encoding_handles_upids() {
        assert_eq!(seg("UPID:pve:00001:abc:"), "UPID%3Apve%3A00001%3Aabc%3A");
        assert_eq!(seg("node-1"), "node-1");
    }

    #[test]
    fn query_skips_empty() {
        assert_eq!(query(&[("a", "1".into()), ("b", String::new())]), "?a=1");
        assert_eq!(query(&[("b", String::new())]), "");
    }
}
