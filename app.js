"use strict";

const PRESETS_KEY = "pt.presets";
const LAST_KEY = "pt.last";

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let config = { name: "", sections: [] }; // sections: {name, durationSec}
let rt = null;   // runtime
let pendingMode = "stopwatch"; // "stopwatch" | "timer" — chosen in setup

const ENDING_COLOR = { L: 0.46, C: 0.02, H: 240 };
let tickId = null;
let wakeLock = null;

// ---------- Setup view ----------
function blankSection(name = "") {
  return { name, min: 5, sec: 0 };
}

let setupSections = [blankSection("Intro"), blankSection("Main"), blankSection("Q&A")];

function renderSections() {
  const list = $("sectionList");
  list.innerHTML = "";
  setupSections.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "section-row";
    li.innerHTML = `
      <input class="num" type="text" placeholder="Section ${i + 1}" value="${escapeAttr(s.name)}" data-i="${i}" data-k="name">
      <input type="number" min="0" max="999" value="${s.min}" data-i="${i}" data-k="min" aria-label="minutes">
      <input type="number" min="0" max="59" value="${s.sec}" data-i="${i}" data-k="sec" aria-label="seconds">
      <button class="del" data-i="${i}" aria-label="Remove section">✕</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = +inp.dataset.i, k = inp.dataset.k;
      if (k === "name") setupSections[i].name = inp.value;
      else setupSections[i][k] = clampInt(inp.value, 0, k === "sec" ? 59 : 999);
      updateTotalSum();
    });
  });
  list.querySelectorAll(".del").forEach((btn) => {
    btn.addEventListener("click", () => {
      setupSections.splice(+btn.dataset.i, 1);
      if (setupSections.length === 0) setupSections.push(blankSection());
      renderSections();
      updateTotalSum();
    });
  });
  updateTotalSum();
}

function sectionDurSec(s) { return (s.min | 0) * 60 + (s.sec | 0); }

function updateTotalSum() {
  const total = setupSections.reduce((a, s) => a + sectionDurSec(s), 0);
  $("totalSum").textContent = "Total " + fmt(total);
}

// ---------- Presets ----------
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; }
  catch { return {}; }
}
function refreshPresetSelect() {
  const presets = loadPresets();
  const sel = $("presetSelect");
  sel.innerHTML = '<option value="">— Saved presets —</option>';
  Object.keys(presets).sort().forEach((name) => {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });
}
function savePreset() {
  const name = (prompt("Save preset as:", $("presName").value || "Untitled") || "").trim();
  if (!name) return;
  const presets = loadPresets();
  presets[name] = {
    name: $("presName").value,
    sections: setupSections.map((s) => ({ name: s.name, min: s.min, sec: s.sec })),
  };
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  refreshPresetSelect();
  $("presetSelect").value = name;
}
function applyPreset(p) {
  $("presName").value = p.name || "";
  setupSections = (p.sections || []).map((s) => ({
    name: s.name || "", min: s.min | 0, sec: s.sec | 0,
  }));
  if (setupSections.length === 0) setupSections.push(blankSection());
  renderSections();
}

// ---------- Build config & start ----------
function buildConfig() {
  const sections = setupSections
    .map((s, i) => ({ name: s.name.trim() || `Section ${i + 1}`, durationSec: sectionDurSec(s) }))
    .filter((s) => s.durationSec > 0);
  return { name: $("presName").value.trim(), sections };
}

function start() {
  const c = buildConfig();
  if (c.sections.length === 0) { alert("Add at least one section with a duration."); return; }
  config = c;
  localStorage.setItem(LAST_KEY, JSON.stringify({
    name: $("presName").value,
    sections: setupSections,
  }));
  rt = {
    mode: pendingMode,
    totalPlanned: config.sections.reduce((a, s) => a + s.durationSec, 0),
    sectionIndex: 0,
    running: false,
    // elapsed bookkeeping (timestamp based)
    totalElapsedMs: 0,
    sectionElapsedMs: 0,
    lastResume: 0,
  };
  $("setup").classList.add("hidden");
  $("run").classList.remove("hidden");
  requestFullscreen();
  renderRun();
  startLoop();
}

// ---------- Runtime loop ----------
function nowMs() { return performance.now(); }

function accumulate() {
  if (rt.running) {
    const t = nowMs();
    const d = t - rt.lastResume;
    rt.totalElapsedMs += d;
    rt.sectionElapsedMs += d;
    rt.lastResume = t;
  }
}

function startLoop() {
  if (tickId) clearInterval(tickId);
  tickId = setInterval(() => { accumulate(); renderRun(); }, 250);
}

function setRunning(on) {
  accumulate();
  rt.running = on;
  if (on) { rt.lastResume = nowMs(); requestWakeLock(); }
  $("playBtn").textContent = on ? "⏸ Pause" : "▶ Start";
}

function gotoSection(idx) {
  accumulate();
  if (idx < 0 || idx >= config.sections.length) return;
  rt.sectionIndex = idx;
  rt.sectionElapsedMs = 0;
  rt.lastResume = nowMs();
  renderRun();
}

function resetAll() {
  if (!confirm("Reset timer to the beginning?")) return;
  rt.totalElapsedMs = 0;
  rt.sectionElapsedMs = 0;
  rt.sectionIndex = 0;
  rt.lastResume = nowMs();
  setRunning(false);
  renderRun();
}

function exitRun() {
  setRunning(false);
  if (tickId) { clearInterval(tickId); tickId = null; }
  releaseWakeLock();
  exitFullscreen();
  $("run").classList.remove("overtime");
  $("run").classList.add("hidden");
  $("setup").classList.remove("hidden");
}

// ---------- Render ----------
function renderRun() {
  const N = config.sections.length;

  // Auto-advance (default on): roll overshoot forward, may cross multiple
  // section boundaries within a single tick. Never advances past the last.
  if ($("autoAdvance").checked) {
    while (rt.sectionIndex < N - 1) {
      const cur = config.sections[rt.sectionIndex];
      const overMs = rt.sectionElapsedMs - cur.durationSec * 1000;
      if (overMs < 0) break;
      rt.sectionIndex++;
      rt.sectionElapsedMs = overMs;
    }
  }

  const sec = config.sections[rt.sectionIndex];
  const secElapsed = rt.sectionElapsedMs / 1000;
  const secRemain = sec.durationSec - secElapsed;
  const totalElapsed = rt.totalElapsedMs / 1000;

  // Big number depends on mode (mode never affects background color)
  if (rt.mode === "stopwatch") {
    $("bigTime").textContent = fmt(Math.floor(totalElapsed));
  } else {
    const neg = secRemain < 0;
    $("bigTime").textContent = (neg ? "-" : "") + fmt(Math.abs(Math.ceil(secRemain - 1e-6)));
  }
  $("bigName").textContent = sec.name;

  // Top bar
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("sectionLabel").textContent = `${rt.sectionIndex + 1}/${N} · ${sec.name}`;
  $("totalLabel").textContent = `${fmt(Math.floor(totalElapsed))} / ${fmt(rt.totalPlanned)}`;
  $("modeToggle").textContent = rt.mode === "stopwatch" ? "STOPWATCH" : "TIMER";

  // Background: distinct per-section OKLCH color; over the last 25% of a
  // section, cross-fade toward the next section's color (or a neutral
  // "ending" color on the final section) so the fade itself is the cue.
  const p = sec.durationSec > 0 ? Math.min(1, secElapsed / sec.durationSec) : 1;
  const f = clamp01((p - 0.75) / 0.25);
  const e = f * f * (3 - 2 * f); // smoothstep
  const from = sectionColor(rt.sectionIndex, N);
  const to = rt.sectionIndex < N - 1 ? sectionColor(rt.sectionIndex + 1, N) : ENDING_COLOR;
  $("run").style.backgroundColor = oklchStr(lerpOklch(from, to, e));

  $("prevBtn").disabled = rt.sectionIndex === 0;
  $("nextBtn").disabled = rt.sectionIndex >= N - 1;
}

// ---------- Color (OKLCH) ----------
function sectionColor(i, n) {
  return { L: 0.52, C: 0.11, H: (212 + (i * 280) / Math.max(1, n)) % 360 };
}
function lerpOklch(a, b, t) {
  const dH = (((b.H - a.H + 540) % 360) - 180); // shortest hue path
  return {
    L: a.L + (b.L - a.L) * t,
    C: a.C + (b.C - a.C) * t,
    H: (a.H + dH * t + 360) % 360,
  };
}
function oklchStr(c) {
  return `oklch(${c.L.toFixed(4)} ${c.C.toFixed(4)} ${c.H.toFixed(2)})`;
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// ---------- Helpers ----------
function fmt(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function clampInt(v, lo, hi) {
  v = parseInt(v, 10); if (isNaN(v)) v = 0;
  return Math.max(lo, Math.min(hi, v));
}
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ---------- Fullscreen + Wake Lock ----------
function requestFullscreen() {
  const el = document.documentElement;
  (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el).catch(() => {});
}
function exitFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch { /* unsupported / denied */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && rt && rt.running) requestWakeLock();
});

// ---------- Wire up ----------
$("addSection").addEventListener("click", () => {
  setupSections.push(blankSection());
  renderSections();
});
$("savePreset").addEventListener("click", savePreset);
$("loadPreset").addEventListener("click", () => {
  const name = $("presetSelect").value;
  if (!name) return;
  const p = loadPresets()[name];
  if (p) applyPreset(p);
});
$("deletePreset").addEventListener("click", () => {
  const name = $("presetSelect").value;
  if (!name || !confirm(`Delete preset "${name}"?`)) return;
  const presets = loadPresets();
  delete presets[name];
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  refreshPresetSelect();
});
function setPendingMode(m) {
  pendingMode = m;
  $("modeStopwatch").classList.toggle("active", m === "stopwatch");
  $("modeTimer").classList.toggle("active", m === "timer");
}
$("modeStopwatch").addEventListener("click", () => setPendingMode("stopwatch"));
$("modeTimer").addEventListener("click", () => setPendingMode("timer"));

$("startBtn").addEventListener("click", start);

$("modeToggle").addEventListener("click", () => {
  rt.mode = rt.mode === "stopwatch" ? "timer" : "stopwatch";
  renderRun();
});
$("playBtn").addEventListener("click", () => setRunning(!rt.running));
$("nextBtn").addEventListener("click", () => gotoSection(rt.sectionIndex + 1));
$("prevBtn").addEventListener("click", () => gotoSection(rt.sectionIndex - 1));
$("resetBtn").addEventListener("click", resetAll);
$("exitBtn").addEventListener("click", exitRun);

// Restore last setup
(function init() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY));
    if (last) {
      $("presName").value = last.name || "";
      if (Array.isArray(last.sections) && last.sections.length) {
        setupSections = last.sections.map((s) => ({
          name: s.name || "", min: s.min | 0, sec: s.sec | 0,
        }));
      }
    }
  } catch { /* ignore */ }
  renderSections();
  refreshPresetSelect();
})();

// ---------- Fullscreen ----------
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function requestFS() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) req.call(el).catch(() => {});
}

function updateFsBtn() {
  $("fsBtn").classList.toggle("hidden", isFullscreen());
}

$("fsBtn").addEventListener("click", requestFS);

// Hide the button whenever fullscreen is active; show it when lost
document.addEventListener("fullscreenchange", updateFsBtn);
document.addEventListener("webkitfullscreenchange", updateFsBtn);

// Re-check when the user returns to the app after locking the phone
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    // Small delay so the browser has settled before we check/show the button
    setTimeout(updateFsBtn, 300);
  }
});

// Initial state on load
updateFsBtn();

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
