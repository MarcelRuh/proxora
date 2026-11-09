use crate::api::models::*;
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use reqwest::redirect::Policy;
use serde::Serialize;
use std::time::Duration;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Clone)]
pub struct ProxoraClient {
    base: Url,
    http: Client,
}

impl ProxoraClient {
    pub fn new(server_url: &str, allow_insecure_tls: bool) -> ApiResult<Self> {
        let mut base = Url::parse(server_url.trim())?;
        if base.path() == "" {
            base.set_path("/");
        }
        // Normalize trailing slash away from path for join convenience.
        let path = base.path().trim_end_matches('/').to_string();
        base.set_path(if path.is_empty() { "/" } else { &path });

        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .cookie_store(true)
            .redirect(Policy::limited(5))
            .danger_accept_invalid_certs(allow_insecure_tls)
            .user_agent(format!("ProxoraNative/{}", env!("CARGO_PKG_VERSION")))
            .build()?;

        Ok(Self { base, http })
    }

    fn url(&self, path: &str) -> ApiResult<Url> {
        Ok(self.base.join(path.trim_start_matches('/'))?)
    }

    fn read_error(res: Response) -> ApiError {
        let status = res.status();
        let body = res.text().unwrap_or_default();
        if let Ok(parsed) = serde_json::from_str::<ApiErrorBody>(&body) {
            if let Some(msg) = parsed.error.filter(|s| !s.is_empty()) {
                return ApiError::Message(format!("{status}: {msg}"));
            }
        }
        if body.trim().is_empty() {
            ApiError::Message(format!("HTTP {status}"))
        } else {
            ApiError::Message(format!("HTTP {status}: {}", body.chars().take(200).collect::<String>()))
        }
    }

    fn get_json<T: for<'de> serde::Deserialize<'de>>(&self, path: &str) -> ApiResult<T> {
        let res = self.http.get(self.url(path)?).send()?;
        if !res.status().is_success() {
            return Err(Self::read_error(res));
        }
        Ok(res.json()?)
    }

    fn post_json<T: for<'de> serde::Deserialize<'de>, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> ApiResult<T> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let res = self
            .http
            .post(self.url(path)?)
            .headers(headers)
            .json(body)
            .send()?;
        if !res.status().is_success() {
            return Err(Self::read_error(res));
        }
        Ok(res.json()?)
    }

    fn post_json_empty<B: Serialize>(&self, path: &str, body: &B) -> ApiResult<()> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let res = self
            .http
            .post(self.url(path)?)
            .headers(headers)
            .json(body)
            .send()?;
        if !res.status().is_success() {
            return Err(Self::read_error(res));
        }
        Ok(())
    }

    pub fn health(&self) -> ApiResult<HealthResponse> {
        self.get_json("/api/health")
    }

    pub fn login(&self, username: &str, password: &str) -> ApiResult<LoginResponse> {
        #[derive(Serialize)]
        struct Body<'a> {
            username: &'a str,
            password: &'a str,
        }
        // Login can return 200 with totpRequired or user.
        let res = self
            .http
            .post(self.url("/api/auth/login")?)
            .json(&Body { username, password })
            .send()?;
        let status = res.status();
        let text = res.text()?;
        if !(status.is_success() || status.as_u16() == 401) {
            if let Ok(parsed) = serde_json::from_str::<ApiErrorBody>(&text) {
                if let Some(msg) = parsed.error {
                    return Err(ApiError::Message(msg));
                }
            }
            return Err(ApiError::Message(format!("HTTP {status}")));
        }
        let parsed: LoginResponse = serde_json::from_str(&text)
            .map_err(|e| ApiError::Message(format!("login parse: {e}")))?;
        if status.as_u16() == 401 {
            return Err(ApiError::Message(
                parsed.error.unwrap_or_else(|| "Invalid credentials".into()),
            ));
        }
        Ok(parsed)
    }

    pub fn login_totp(&self, ticket: &str, totp: &str) -> ApiResult<SessionUser> {
        #[derive(Serialize)]
        struct Body<'a> {
            ticket: &'a str,
            totp: &'a str,
        }
        let parsed: LoginResponse = self.post_json("/api/auth/login", &Body { ticket, totp })?;
        parsed
            .user
            .ok_or_else(|| ApiError::Message("TOTP login returned no user".into()))
    }

    #[allow(dead_code)]
    pub fn me(&self) -> ApiResult<SessionUser> {
        let parsed: MeResponse = self.get_json("/api/auth/me")?;
        Ok(parsed.user)
    }

    pub fn logout(&self) -> ApiResult<()> {
        let res = self.http.post(self.url("/api/auth/logout")?).send()?;
        if !res.status().is_success() {
            return Err(Self::read_error(res));
        }
        Ok(())
    }

    pub fn hosts(&self) -> ApiResult<Vec<PublicHost>> {
        let parsed: HostsResponse = self.get_json("/api/hosts")?;
        Ok(parsed.hosts)
    }

    pub fn dashboard(&self) -> ApiResult<Dashboard> {
        self.get_json("/api/dashboard")
    }

    pub fn guests(&self) -> ApiResult<DashboardGuests> {
        self.get_json("/api/dashboard/guests")
    }

    pub fn guest_action(
        &self,
        kind: &str,
        host_id: &str,
        node: &str,
        vmid: u32,
        action: &str,
    ) -> ApiResult<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            action: &'a str,
        }
        let segment = if kind == "lxc" { "lxc" } else { "vms" };
        let path = format!(
            "/api/hosts/{}/{}/{}/{}",
            urlencoding_path(host_id),
            segment,
            urlencoding_path(node),
            vmid
        );
        self.post_json_empty(&path, &Body { action })
    }
}

fn urlencoding_path(value: &str) -> String {
    // Encode path segments without turning `/` into structure.
    value
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}
