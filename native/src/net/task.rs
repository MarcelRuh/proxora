use super::client::{ApiError, ApiResult};
use eframe::egui;
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

/// Result of a closure running on a worker thread. Repaints the UI when done.
pub struct Pending<T> {
    rx: Receiver<T>,
}

impl<T: Send + 'static> Pending<T> {
    pub fn spawn(ctx: &egui::Context, job: impl FnOnce() -> T + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel();
        let ctx = ctx.clone();
        thread::Builder::new()
            .name("proxora-io".into())
            .spawn(move || {
                let _ = tx.send(job());
                ctx.request_repaint();
            })
            .expect("spawn worker thread");
        Self { rx }
    }

    pub fn poll(&self) -> Option<T> {
        self.rx.try_recv().ok()
    }
}

/// A server resource with loading / error / staleness bookkeeping.
pub struct Resource<T> {
    pub data: Option<T>,
    pub error: Option<ApiError>,
    pending: Option<Pending<ApiResult<T>>>,
    loaded_at: Option<Instant>,
    loaded_epoch: u64,
    key: Option<String>,
}

impl<T> Default for Resource<T> {
    fn default() -> Self {
        Self {
            data: None,
            error: None,
            pending: None,
            loaded_at: None,
            loaded_epoch: 0,
            key: None,
        }
    }
}

impl<T: Send + 'static> Resource<T> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies a finished request. Returns true when fresh data arrived.
    pub fn poll(&mut self) -> bool {
        let Some(result) = self.pending.as_ref().and_then(Pending::poll) else {
            return false;
        };
        self.pending = None;
        self.loaded_at = Some(Instant::now());
        match result {
            Ok(data) => {
                self.data = Some(data);
                self.error = None;
                true
            }
            Err(err) => {
                self.error = Some(err);
                false
            }
        }
    }

    pub fn loading(&self) -> bool {
        self.pending.is_some()
    }

    /// First load still running (nothing to show yet).
    pub fn initial_loading(&self) -> bool {
        self.pending.is_some() && self.data.is_none()
    }

    pub fn fetch(
        &mut self,
        ctx: &egui::Context,
        job: impl FnOnce() -> ApiResult<T> + Send + 'static,
    ) {
        if self.pending.is_none() {
            self.pending = Some(Pending::spawn(ctx, job));
        }
    }

    /// Polls, then refetches when never loaded, older than `max_age`, or the
    /// invalidation `epoch` moved past the one this data was loaded at.
    pub fn ensure<F>(
        &mut self,
        ctx: &egui::Context,
        max_age: Duration,
        epoch: u64,
        make_job: impl FnOnce() -> F,
    ) where
        F: FnOnce() -> ApiResult<T> + Send + 'static,
    {
        self.poll();
        if self.pending.is_some() {
            return;
        }
        // Transient errors retry after a few seconds; permission errors keep the normal cadence.
        let limit = match &self.error {
            Some(err) if !err.is_forbidden() => max_age.min(Duration::from_secs(5)),
            _ => max_age,
        };
        let stale = match self.loaded_at {
            None => true,
            Some(at) => at.elapsed() >= limit || epoch > self.loaded_epoch,
        };
        if stale {
            self.loaded_epoch = epoch;
            self.fetch(ctx, make_job());
        } else if let Some(at) = self.loaded_at {
            let remaining = limit.saturating_sub(at.elapsed());
            ctx.request_repaint_after(remaining.max(Duration::from_millis(250)));
        }
    }

    pub fn invalidate(&mut self) {
        self.loaded_at = None;
    }

    /// Switches to another parameter set (e.g. another host); drops old data.
    pub fn set_key(&mut self, key: &str) -> bool {
        if self.key.as_deref() == Some(key) {
            return false;
        }
        self.key = Some(key.to_owned());
        self.data = None;
        self.error = None;
        self.pending = None;
        self.loaded_at = None;
        true
    }

    pub fn age(&self) -> Option<Duration> {
        self.loaded_at.map(|at| at.elapsed())
    }
}
