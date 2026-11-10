//! Custom window chrome injected into every main-frame document.
//! Keeps min/max/close + drag working with `decorations(false)`.

pub const TITLEBAR_BOOTSTRAP: &str = r##"(function () {
  if (window.__proxoraTitlebarBoot) return;
  window.__proxoraTitlebarBoot = true;

  var HEIGHT = 36;
  var STYLE_ID = "proxora-desktop-titlebar-style";
  var BAR_ID = "proxora-desktop-titlebar";

  function winApi() {
    try {
      return window.__TAURI__ && window.__TAURI__.window
        ? window.__TAURI__.window.getCurrentWindow()
        : null;
    } catch (e) {
      return null;
    }
  }

  function coreInvoke(cmd, args) {
    try {
      var core = window.__TAURI__ && window.__TAURI__.core;
      if (!core || typeof core.invoke !== "function") return Promise.reject();
      return core.invoke(cmd, args || {});
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent = [
      "html[data-desktop-chrome]{--desktop-titlebar-height:" + HEIGHT + "px;}",
      "html[data-desktop-chrome] body{box-sizing:border-box;height:100dvh;padding-top:var(--desktop-titlebar-height)!important;overflow:hidden;}",
      "html[data-desktop-chrome] .app-shell,html[data-desktop-chrome] .h-dvh,html[data-desktop-chrome] [data-desktop-frame]{height:calc(100dvh - var(--desktop-titlebar-height))!important;max-height:calc(100dvh - var(--desktop-titlebar-height));}",
      "html[data-desktop-chrome] .app-sidebar.fixed{top:var(--desktop-titlebar-height);height:calc(100dvh - var(--desktop-titlebar-height));}",
      "#" + BAR_ID + "{position:fixed;top:0;left:0;right:0;z-index:2147483000;height:" + HEIGHT + "px;display:flex;align-items:stretch;user-select:none;color:#f4f4f8;background:linear-gradient(180deg,rgba(255,255,255,0.03),transparent 70%),#0a0a0f;border-bottom:1px solid rgba(255,255,255,0.08);font:600 12px/1 'Segoe UI','IBM Plex Sans',system-ui,sans-serif;}",
      "#" + BAR_ID + " .px-drag{flex:1;display:flex;align-items:center;gap:10px;padding:0 12px;min-width:0;-webkit-app-region:drag;}",
      "#" + BAR_ID + " .px-mark{width:16px;height:16px;border-radius:3px;background:linear-gradient(135deg,#ff006e,#7b2cbf);box-shadow:0 0 0 1px rgba(255,0,110,0.35);flex:0 0 auto;}",
      "#" + BAR_ID + " .px-brand{letter-spacing:0.22em;font-size:11px;font-weight:800;color:#fff;}",
      "#" + BAR_ID + " .px-sub{color:#a0a0b0;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-size:10px;opacity:0.9;}",
      "#" + BAR_ID + " .px-actions{display:flex;align-items:stretch;flex:0 0 auto;-webkit-app-region:no-drag;}",
      "#" + BAR_ID + " .px-menu{position:relative;display:flex;}",
      "#" + BAR_ID + " button.px-btn{appearance:none;border:0;background:transparent;color:#c8c8d8;width:46px;min-width:46px;padding:0;margin:0;cursor:pointer;display:grid;place-items:center;transition:background .12s ease,color .12s ease;}",
      "#" + BAR_ID + " button.px-btn:hover{background:rgba(255,255,255,0.06);color:#fff;}",
      "#" + BAR_ID + " button.px-btn.px-close:hover{background:#ff006e;color:#fff;}",
      "#" + BAR_ID + " button.px-btn:focus-visible{outline:2px solid rgba(255,0,110,0.55);outline-offset:-2px;}",
      "#" + BAR_ID + " .px-drop{display:none;position:absolute;top:100%;right:0;min-width:188px;padding:6px;border:1px solid rgba(255,255,255,0.1);border-radius:4px;background:#12121a;box-shadow:0 16px 40px rgba(0,0,0,0.45);}",
      "#" + BAR_ID + " .px-menu.open .px-drop{display:grid;gap:2px;}",
      "#" + BAR_ID + " .px-drop button{appearance:none;border:0;background:transparent;color:#e8e8f0;text-align:left;padding:8px 10px;border-radius:3px;font:600 12px/1.2 'Segoe UI',system-ui,sans-serif;cursor:pointer;}",
      "#" + BAR_ID + " .px-drop button:hover{background:rgba(255,0,110,0.12);color:#fff;}"
    ].join("");
    (document.head || document.documentElement).appendChild(css);
  }

  function svg(path, size) {
    return (
      '<svg width="' +
      (size || 10) +
      '" height="' +
      (size || 10) +
      '" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
      path +
      "</svg>"
    );
  }

  async function refreshMaxState(btn) {
    var w = winApi();
    if (!w || !btn) return;
    try {
      var max = await w.isMaximized();
      btn.innerHTML = max
        ? svg('<path d="M2.5 3.5h4v4h-4zM3.5 2.5h4v4"/>')
        : svg('<rect x="2" y="2" width="6" height="6"/>');
      btn.setAttribute("aria-label", max ? "Restore" : "Maximize");
      btn.title = max ? "Restore" : "Maximize";
    } catch (e) {}
  }

  function ensureBar() {
    if (!document.body) return;
    ensureStyle();
    document.documentElement.setAttribute("data-desktop-chrome", "1");
    if (document.getElementById(BAR_ID)) return;

    var bar = document.createElement("header");
    bar.id = BAR_ID;
    bar.setAttribute("role", "banner");
    bar.innerHTML =
      '<div class="px-drag" data-tauri-drag-region>' +
      '<span class="px-mark" data-tauri-drag-region></span>' +
      '<span class="px-brand" data-tauri-drag-region>PROXORA</span>' +
      '<span class="px-sub" data-tauri-drag-region>Desktop</span>' +
      "</div>" +
      '<div class="px-actions">' +
      '<div class="px-menu">' +
      '<button type="button" class="px-btn px-more" aria-label="Menu" title="Menu">' +
      svg(
        '<path d="M2 2.5h6M2 5h6M2 7.5h6" stroke-linecap="round"/>',
        12
      ) +
      "</button>" +
      '<div class="px-drop" role="menu">' +
      '<button type="button" data-act="reload">Reload</button>' +
      '<button type="button" data-act="change">Change server…</button>' +
      '<button type="button" data-act="updates">Check for updates…</button>' +
      "</div></div>" +
      '<button type="button" class="px-btn px-min" aria-label="Minimize" title="Minimize">' +
      svg('<path d="M2 5h6" stroke-linecap="round"/>') +
      "</button>" +
      '<button type="button" class="px-btn px-max" aria-label="Maximize" title="Maximize">' +
      svg('<rect x="2" y="2" width="6" height="6"/>') +
      "</button>" +
      '<button type="button" class="px-btn px-close" aria-label="Close" title="Close">' +
      svg('<path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke-linecap="round"/>') +
      "</button></div>";

    // Append (not prepend) so Next.js hydration is less likely to fight the first body child.
    document.body.appendChild(bar);

    var drag = bar.querySelector(".px-drag");
    var menu = bar.querySelector(".px-menu");
    var more = bar.querySelector(".px-more");
    var min = bar.querySelector(".px-min");
    var max = bar.querySelector(".px-max");
    var close = bar.querySelector(".px-close");

    function closeMenu() {
      if (menu) menu.classList.remove("open");
    }

    if (drag) {
      drag.addEventListener("mousedown", function (ev) {
        if (ev.button !== 0) return;
        var w = winApi();
        if (w && typeof w.startDragging === "function") {
          try {
            w.startDragging();
          } catch (e) {}
        }
      });
      drag.addEventListener("dblclick", function () {
        var w = winApi();
        if (w && typeof w.toggleMaximize === "function") {
          w.toggleMaximize().then(function () {
            refreshMaxState(max);
          });
        }
      });
    }

    if (more && menu) {
      more.addEventListener("click", function (ev) {
        ev.stopPropagation();
        menu.classList.toggle("open");
      });
      document.addEventListener("click", closeMenu);
      menu.querySelectorAll("[data-act]").forEach(function (el) {
        el.addEventListener("click", function () {
          var act = el.getAttribute("data-act");
          closeMenu();
          if (act === "reload") {
            location.reload();
            return;
          }
          if (act === "change") {
            coreInvoke("clear_server").catch(function () {});
            return;
          }
          if (act === "updates") {
            coreInvoke("check_for_updates").catch(function () {});
          }
        });
      });
    }

    if (min) {
      min.addEventListener("click", function () {
        var w = winApi();
        if (w) w.minimize();
      });
    }
    if (max) {
      max.addEventListener("click", function () {
        var w = winApi();
        if (w) {
          w.toggleMaximize().then(function () {
            refreshMaxState(max);
          });
        }
      });
      refreshMaxState(max);
    }
    if (close) {
      close.addEventListener("click", function () {
        var w = winApi();
        if (w) w.close();
      });
    }
  }

  function boot() {
    ensureBar();
    // Re-create if a framework wipe removes the chrome node.
    try {
      var obs = new MutationObserver(function () {
        if (document.body && !document.getElementById(BAR_ID)) ensureBar();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();"##;
