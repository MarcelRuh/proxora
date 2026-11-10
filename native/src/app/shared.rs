use crate::net::{
    query, seg, ApiResult, Client, GuestsResponse, Host, HostsResponse, Kind, Pending, Resource,
    SelfUpdateStatus, SessionUser, TaskInfo, UpdateSummary,
};
use crate::prefs::Prefs;
use crate::term::TermRequest;
use crate::ui::toast::Toasts;
use crate::updater::{UpdateCmd, UpdateState};
use eframe::egui;
use serde_json::Value;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Page {
    Dashboard,
    Hosts,
    Vms,
    Containers,
    CreateVm,
    CreateLxc,
    Templates,
    Scripts,
    Tasks,
    Storage,
    Backups,
    Updates,
    Proxora,
    Users,
    Roles,
    Audit,
    Wireguard,
    Settings,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Focus {
    Host(String),
    Guest {
        host_id: String,
        node: String,
        vmid: u64,
        kind: Kind,
    },
    Script(String),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tag {
    Hosts,
    Guests,
    Tasks,
    Storage,
    Backups,
    Updates,
    Templates,
    Users,
    Roles,
    Settings,
    Notifications,
    Wireguard,
    SelfUpdate,
    Account,
    Audit,
}

const TAG_COUNT: usize = 15;

pub struct Confirm {
    pub title: String,
    pub body: String,
    pub confirm_label: String,
    pub danger: bool,
    /// When set, the user must type this text (e.g. the VMID) to enable the button.
    pub type_to_confirm: Option<String>,
    pub input: String,
    pub on_confirm: Box<dyn FnOnce(&mut Shared)>,
}

type FollowUp = Box<dyn FnOnce(&mut Shared) + Send>;
type ValueFollowUp = Box<dyn FnOnce(&mut Shared, Value) + Send>;

struct Op {
    key: String,
    label: String,
    pending: Pending<ApiResult<Value>>,
    bumps: Vec<Tag>,
    track_host: Option<String>,
    then: Option<FollowUp>,
    then_value: Option<ValueFollowUp>,
    quiet: bool,
}

pub struct TrackedTask {
    pub key: String,
    pub host_id: String,
    pub node: String,
    pub upid: String,
    pub label: String,
    pub started: Instant,
    pub info: Option<TaskInfo>,
    pub finished_at: Option<Instant>,
    pub ok: bool,
    pub error: Option<String>,
    bumps: Vec<Tag>,
    pending: Option<Pending<ApiResult<TaskInfo>>>,
    last_poll: Option<Instant>,
    failures: u32,
    then: Option<FollowUp>,
}

impl TrackedTask {
    pub fn running(&self) -> bool {
        self.finished_at.is_none()
    }
    pub fn progress(&self) -> Option<f32> {
        self.info.as_ref().and_then(|i| crate::net::log_progress(&i.log))
    }
    pub fn last_line(&self) -> Option<&str> {
        self.info
            .as_ref()
            .and_then(|i| i.log.last())
            .map(|l| l.t.as_str())
    }
}

pub struct Shared {
    pub ctx: egui::Context,
    pub client: Client,
    pub user: SessionUser,
    pub prefs: Prefs,
    pub prefs_dirty: bool,
    pub toasts: Toasts,
    pub confirm: Option<Confirm>,
    pub nav: Option<Page>,
    pub focus: Option<Focus>,
    pub logout: bool,
    pub tasks: Vec<TrackedTask>,
    pub hosts: Resource<Vec<Host>>,
    pub guests: Resource<GuestsResponse>,
    pub update_summary: Resource<UpdateSummary>,
    pub self_update: Resource<SelfUpdateStatus>,
    pub native_update: UpdateState,
    pub updater: Sender<UpdateCmd>,
    pub server_version: Option<String>,
    pub term_requests: Vec<TermRequest>,
    ops: Vec<Op>,
    epochs: [u64; TAG_COUNT],
}

impl Shared {
    pub fn new(
        ctx: &egui::Context,
        client: Client,
        user: SessionUser,
        prefs: Prefs,
        updater: Sender<UpdateCmd>,
    ) -> Self {
        Self {
            ctx: ctx.clone(),
            client,
            user,
            prefs,
            prefs_dirty: false,
            toasts: Toasts::default(),
            confirm: None,
            nav: None,
            focus: None,
            logout: false,
            tasks: Vec::new(),
            hosts: Resource::new(),
            guests: Resource::new(),
            update_summary: Resource::new(),
            self_update: Resource::new(),
            native_update: UpdateState::Checking,
            updater,
            server_version: None,
            term_requests: Vec::new(),
            ops: Vec::new(),
            epochs: [0; TAG_COUNT],
        }
    }

    // ------------------------------------------------------------ invalidation

    pub fn epoch(&self, tag: Tag) -> u64 {
        self.epochs[tag as usize]
    }

    pub fn bump(&mut self, tag: Tag) {
        self.epochs[tag as usize] += 1;
    }

    pub fn bump_all(&mut self) {
        for e in &mut self.epochs {
            *e += 1;
        }
    }

    // ------------------------------------------------------------ navigation

    pub fn go(&mut self, page: Page) {
        self.nav = Some(page);
    }

    pub fn open_guest(&mut self, host_id: &str, node: &str, vmid: u64, kind: Kind) {
        self.focus = Some(Focus::Guest {
            host_id: host_id.to_owned(),
            node: node.to_owned(),
            vmid,
            kind,
        });
        self.go(match kind {
            Kind::Vm => Page::Vms,
            Kind::Lxc => Page::Containers,
        });
    }

    pub fn open_host(&mut self, host_id: &str) {
        self.focus = Some(Focus::Host(host_id.to_owned()));
        self.go(Page::Hosts);
    }

    pub fn open_terminal(&mut self, req: TermRequest) {
        self.term_requests.push(req);
    }

    pub fn open_web(&mut self, path: &str) {
        let url = self.client.web_url(path);
        if let Err(err) = open::that_detached(&url) {
            self.toasts.error("Browser konnte nicht geöffnet werden", err.to_string());
        }
    }

    // ------------------------------------------------------------ global caches

    pub fn host(&self, id: &str) -> Option<&Host> {
        self.hosts.data.as_ref()?.iter().find(|h| h.id == id)
    }

    pub fn ensure_hosts(&mut self) {
        if !self.user.can_any(&["hosts.view", "vm.view", "lxc.view"]) {
            return;
        }
        let epoch = self.epoch(Tag::Hosts);
        let client = self.client.clone();
        self.hosts.ensure(&self.ctx, Duration::from_secs(30), epoch, move || {
            move || client.get::<HostsResponse>("/api/hosts").map(|r| r.hosts)
        });
    }

    pub fn ensure_guests(&mut self) {
        if !self.user.can_any(&["hosts.view", "vm.view", "lxc.view"]) {
            return;
        }
        let epoch = self.epoch(Tag::Guests);
        let client = self.client.clone();
        self.guests.ensure(&self.ctx, Duration::from_secs(20), epoch, move || {
            move || client.get::<GuestsResponse>("/api/dashboard/guests")
        });
    }

    pub fn ensure_update_summary(&mut self) {
        if !self.user.can("updates.view") {
            return;
        }
        let epoch = self.epoch(Tag::Updates);
        let client = self.client.clone();
        self.update_summary
            .ensure(&self.ctx, Duration::from_secs(60), epoch, move || {
                move || client.get::<UpdateSummary>("/api/updates/summary")
            });
    }

    pub fn ensure_self_update(&mut self) {
        if !self.user.can_any(&["updates.view", "proxora.update"]) {
            return;
        }
        let updating = self
            .self_update
            .data
            .as_ref()
            .is_some_and(|s| s.updating);
        let age = if updating {
            Duration::from_millis(1500)
        } else {
            Duration::from_secs(60)
        };
        let epoch = self.epoch(Tag::SelfUpdate);
        let client = self.client.clone();
        self.self_update.ensure(&self.ctx, age, epoch, move || {
            move || client.get::<SelfUpdateStatus>("/api/system/self-update")
        });
    }

    // ------------------------------------------------------------ actions

    pub fn op_running(&self, key: &str) -> bool {
        self.ops.iter().any(|o| o.key == key)
            || self.tasks.iter().any(|t| t.running() && t.key == key)
    }

    pub fn op_prefix_running(&self, prefix: &str) -> bool {
        self.ops.iter().any(|o| o.key.starts_with(prefix))
    }

    /// Runs a mutation in the background; toasts the outcome and bumps tags.
    pub fn run(
        &mut self,
        key: impl Into<String>,
        label: impl Into<String>,
        bumps: &[Tag],
        job: impl FnOnce(&Client) -> ApiResult<Value> + Send + 'static,
    ) {
        self.push_op(key.into(), label.into(), bumps, None, None, false, job);
    }

    /// Like `run`, but follows the returned Proxmox UPID until the task ends.
    pub fn run_task(
        &mut self,
        key: impl Into<String>,
        label: impl Into<String>,
        host_id: &str,
        bumps: &[Tag],
        job: impl FnOnce(&Client) -> ApiResult<Value> + Send + 'static,
    ) {
        self.push_op(key.into(), label.into(), bumps, Some(host_id.to_owned()), None, false, job);
    }

    /// `run_task` with a follow-up that runs after the task succeeded.
    pub fn run_task_then(
        &mut self,
        key: impl Into<String>,
        label: impl Into<String>,
        host_id: &str,
        bumps: &[Tag],
        job: impl FnOnce(&Client) -> ApiResult<Value> + Send + 'static,
        then: impl FnOnce(&mut Shared) + Send + 'static,
    ) {
        self.push_op(
            key.into(),
            label.into(),
            bumps,
            Some(host_id.to_owned()),
            Some(Box::new(then)),
            false,
            job,
        );
    }

    /// Runs a call and hands its JSON result to `then` on success (no toast).
    pub fn run_then(
        &mut self,
        key: impl Into<String>,
        label: impl Into<String>,
        bumps: &[Tag],
        job: impl FnOnce(&Client) -> ApiResult<Value> + Send + 'static,
        then: impl FnOnce(&mut Shared, Value) + Send + 'static,
    ) {
        self.push_op(key.into(), label.into(), bumps, None, None, true, job);
        if let Some(op) = self.ops.last_mut() {
            op.then_value = Some(Box::new(then));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn push_op(
        &mut self,
        key: String,
        label: String,
        bumps: &[Tag],
        track_host: Option<String>,
        then: Option<FollowUp>,
        quiet: bool,
        job: impl FnOnce(&Client) -> ApiResult<Value> + Send + 'static,
    ) {
        let client = self.client.clone();
        let pending = Pending::spawn(&self.ctx, move || job(&client));
        self.ops.push(Op {
            key,
            label,
            pending,
            bumps: bumps.to_vec(),
            track_host,
            then,
            then_value: None,
            quiet,
        });
    }

    /// Tracks an already started Proxmox task (UPID known).
    pub fn track(&mut self, key: &str, host_id: &str, upid: &str, label: impl Into<String>, bumps: &[Tag]) {
        self.track_with(key.to_owned(), host_id, upid, label.into(), bumps.to_vec(), None);
    }

    fn track_with(
        &mut self,
        key: String,
        host_id: &str,
        upid: &str,
        label: String,
        bumps: Vec<Tag>,
        then: Option<FollowUp>,
    ) {
        let node = crate::net::upid_node(upid).unwrap_or_default();
        self.tasks.push(TrackedTask {
            key,
            host_id: host_id.to_owned(),
            node,
            upid: upid.to_owned(),
            label,
            started: Instant::now(),
            info: None,
            finished_at: None,
            ok: false,
            error: None,
            bumps,
            pending: None,
            last_poll: None,
            failures: 0,
            then,
        });
    }

    pub fn running_tasks(&self) -> usize {
        self.tasks.iter().filter(|t| t.running()).count() + self.ops.len()
    }

    pub fn busy_labels(&self) -> Vec<String> {
        self.ops.iter().map(|o| o.label.clone()).collect()
    }

    /// Called once per frame by the workspace.
    pub fn poll(&mut self) {
        // finished mutations
        let mut i = 0;
        let mut follow_ups: Vec<FollowUp> = Vec::new();
        let mut value_follow_ups: Vec<(ValueFollowUp, Value)> = Vec::new();
        while i < self.ops.len() {
            let Some(result) = self.ops[i].pending.poll() else {
                i += 1;
                continue;
            };
            let op = self.ops.remove(i);
            match result {
                Ok(value) => {
                    let upid = value
                        .get("upid")
                        .and_then(Value::as_str)
                        .filter(|u| u.starts_with("UPID:"))
                        .map(str::to_owned);
                    match (op.track_host, upid) {
                        (Some(host), Some(upid)) => {
                            self.track_with(op.key, &host, &upid, op.label, op.bumps, op.then);
                        }
                        _ => {
                            for tag in &op.bumps {
                                self.bump(*tag);
                            }
                            if !op.quiet {
                                self.toasts.success(op.label);
                            }
                            if let Some(then) = op.then {
                                follow_ups.push(then);
                            }
                            if let Some(then) = op.then_value {
                                value_follow_ups.push((then, value));
                            }
                        }
                    }
                }
                Err(err) => {
                    for tag in &op.bumps {
                        self.bump(*tag);
                    }
                    self.toasts.error(format!("{} fehlgeschlagen", op.label), err.message);
                }
            }
        }

        // Proxmox task tracking
        let ctx = self.ctx.clone();
        let client = self.client.clone();
        let mut just_finished = Vec::new();
        for (idx, t) in self.tasks.iter_mut().enumerate() {
            if !t.running() {
                continue;
            }
            if let Some(result) = t.pending.as_ref().and_then(Pending::poll) {
                t.pending = None;
                t.last_poll = Some(Instant::now());
                match result {
                    Ok(info) => {
                        t.failures = 0;
                        let finished = info.status.finished();
                        let ok = info.status.succeeded();
                        let exit = info.status.exitstatus.clone().unwrap_or_default();
                        t.info = Some(info);
                        if finished {
                            t.finished_at = Some(Instant::now());
                            t.ok = ok;
                            if !ok {
                                t.error = Some(exit);
                            }
                            just_finished.push(idx);
                        }
                    }
                    Err(err) => {
                        t.failures += 1;
                        if t.failures >= 4 {
                            t.finished_at = Some(Instant::now());
                            t.error = Some(err.message);
                            just_finished.push(idx);
                        }
                    }
                }
            }
            let due = t
                .last_poll
                .is_none_or(|at| at.elapsed() >= Duration::from_millis(1200));
            if t.pending.is_none() && due && t.running() {
                let client = client.clone();
                let path = format!(
                    "/api/hosts/{}/task{}",
                    seg(&t.host_id),
                    query(&[
                        ("node", t.node.clone()),
                        ("upid", t.upid.clone()),
                        ("limit", "500".into()),
                    ])
                );
                t.pending = Some(Pending::spawn(&ctx, move || client.get::<TaskInfo>(&path)));
            }
        }
        for idx in just_finished {
            let bumps = std::mem::take(&mut self.tasks[idx].bumps);
            for tag in &bumps {
                self.bump(*tag);
            }
            let t = &mut self.tasks[idx];
            let label = t.label.clone();
            if t.ok {
                if let Some(then) = t.then.take() {
                    follow_ups.push(then);
                }
                self.toasts.success(format!("{label} abgeschlossen"));
            } else {
                t.then = None;
                let err = t.error.clone().unwrap_or_default();
                self.toasts.error(format!("{label} fehlgeschlagen"), err);
            }
        }
        // keep finished tasks visible for a while
        self.tasks.retain(|t| {
            t.finished_at
                .is_none_or(|at| at.elapsed() < Duration::from_secs(90))
        });
        if self.tasks.iter().any(TrackedTask::running) || !self.ops.is_empty() {
            self.ctx.request_repaint_after(Duration::from_millis(300));
        }
        for f in follow_ups {
            f(self);
        }
        for (f, v) in value_follow_ups {
            f(self, v);
        }
    }

    // ------------------------------------------------------------ dialogs

    pub fn confirm(
        &mut self,
        title: impl Into<String>,
        body: impl Into<String>,
        confirm_label: impl Into<String>,
        danger: bool,
        on_confirm: impl FnOnce(&mut Shared) + 'static,
    ) {
        self.confirm = Some(Confirm {
            title: title.into(),
            body: body.into(),
            confirm_label: confirm_label.into(),
            danger,
            type_to_confirm: None,
            input: String::new(),
            on_confirm: Box::new(on_confirm),
        });
    }

    pub fn confirm_typed(
        &mut self,
        title: impl Into<String>,
        body: impl Into<String>,
        confirm_label: impl Into<String>,
        expected: impl Into<String>,
        on_confirm: impl FnOnce(&mut Shared) + 'static,
    ) {
        self.confirm = Some(Confirm {
            title: title.into(),
            body: body.into(),
            confirm_label: confirm_label.into(),
            danger: true,
            type_to_confirm: Some(expected.into()),
            input: String::new(),
            on_confirm: Box::new(on_confirm),
        });
    }

    pub fn save_prefs(&mut self) {
        self.prefs_dirty = true;
    }
}

/// Body for guest actions; `wait:false` so long tasks are followed via UPID.
pub fn guest_action_body(action: &str) -> Value {
    serde_json::json!({ "action": action, "wait": false })
}

pub fn guest_path(host_id: &str, kind: Kind, node: &str, vmid: u64) -> String {
    format!(
        "/api/hosts/{}/{}/{}/{}",
        seg(host_id),
        kind.api(),
        seg(node),
        vmid
    )
}
