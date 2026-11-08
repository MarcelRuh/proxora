use url::Url;

/// Normalize a user-entered Proxora URL (same rules as the Android client).
pub fn normalize_server_url(raw: &str) -> Result<String, String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return Err("URL required".into());
  }
  let with_scheme = if trimmed.contains("://") {
    trimmed.to_string()
  } else {
    format!("https://{trimmed}")
  };
  let uri = Url::parse(&with_scheme).map_err(|_| "Invalid URL".to_string())?;
  let scheme = uri.scheme().to_ascii_lowercase();
  if scheme != "http" && scheme != "https" {
    return Err("Only http and https are allowed".into());
  }
  if !uri.username().is_empty() || uri.password().is_some() {
    return Err("URL must not include credentials".into());
  }
  let host = uri
    .host_str()
    .map(|h| h.trim().trim_matches('.'))
    .filter(|h| !h.is_empty())
    .ok_or_else(|| "Host required".to_string())?;
  let port = uri
    .port()
    .map(|p| format!(":{p}"))
    .unwrap_or_default();
  let path = uri.path().trim_end_matches('/');
  let path = if path.is_empty() || path == "/" {
    String::new()
  } else {
    path.to_string()
  };
  Ok(format!("{scheme}://{host}{port}{path}"))
}

pub fn same_origin(a: &str, b: &str) -> bool {
  let Ok(ua) = Url::parse(a) else {
    return false;
  };
  let Ok(ub) = Url::parse(b) else {
    return false;
  };
  ua.scheme() == ub.scheme()
    && ua.host() == ub.host()
    && ua.port_or_known_default() == ub.port_or_known_default()
}

pub fn is_setup_url(url: &str) -> bool {
  let Ok(u) = Url::parse(url) else {
    return false;
  };
  match u.scheme() {
    "tauri" | "asset" => true,
    "http" | "https" => matches!(
      u.host_str(),
      Some("localhost") | Some("tauri.localhost") | Some("ipc.localhost")
    ),
    _ => false,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn adds_https_and_strips_slash() {
    assert_eq!(
      normalize_server_url("proxora.home.arpa/").unwrap(),
      "https://proxora.home.arpa"
    );
  }

  #[test]
  fn keeps_http_and_port() {
    assert_eq!(
      normalize_server_url("http://192.168.1.10:3000").unwrap(),
      "http://192.168.1.10:3000"
    );
  }

  #[test]
  fn rejects_credentials() {
    assert!(normalize_server_url("https://u:p@host").is_err());
  }

  #[test]
  fn setup_hosts() {
    assert!(is_setup_url("http://tauri.localhost/index.html"));
    assert!(!is_setup_url("http://192.168.1.10:3000/"));
  }
}
