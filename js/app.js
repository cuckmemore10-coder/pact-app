(function () {
  "use strict";

  const PIN_LEN = 4;
  const LS = {
    pinHash: "pact_pin_hash",
    pinSalt: "pact_pin_salt",
    pinEnabled: "pact_pin_enabled",
    contracts: "pact_contracts"
  };

  const STEPS = [
    { id: "names", title: "Names & roles" },
    { id: "tone", title: "Tone" },
    { id: "boundaries", title: "Boundaries" },
    { id: "safety", title: "Safety" },
    { id: "communication", title: "Communication" },
    { id: "perks", title: "Perks & Teasing" },
    { id: "duration", title: "Duration & review" },
    { id: "preview", title: "Preview & sign" }
  ];

  function emptyDraft() {
    return {
      id: null,
      title: "",
      tone: "playful",
      partners: {
        a: { name: "", role: "cuck" },
        b: { name: "", role: "hotwife" },
        bull: { name: "", enabled: false }
      },
      safeword: "Red",
      checkInNote: "",
      startDate: todayISO(),
      reviewDate: "",
      durationNote: "",
      enabled: {},
      custom: { boundaries: [], safety: [], communication: [], perks: [], duration: [] },
      signatures: { a: { dataUrl: "", signedAt: "" }, b: { dataUrl: "", signedAt: "" } }
    };
  }

  const state = {
    pinBuffer: "",
    settingPin: false,
    confirmPin: null,
    step: 0,
    draft: emptyDraft(),
    dirty: false
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function todayISO() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y) return iso;
    try {
      return new Date(y, m - 1, d).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric"
      });
    } catch {
      return iso;
    }
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  async function sha256(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function hashPin(pin, salt) {
    return sha256(salt + ":" + pin);
  }

  function showScreen(name) {
    $$(".screen").forEach((el) => el.classList.toggle("active", el.id === "screen-" + name));
    const titles = { home: "Pact", builder: "New pact", settings: "Settings" };
    $("#header-title").textContent = titles[name] || "Pact";
    $("#btn-settings").classList.toggle("hidden", name === "settings" || name === "builder");
    $("#btn-home-link").classList.toggle("hidden", name === "home");
  }

  function roleLabel(id) {
    const r = window.PACT_META.roles.find((x) => x.id === id);
    return r ? r.label : id || "partner";
  }

  function ctxNames() {
    const p = state.draft.partners;
    return {
      a: (p.a.name || "").trim() || "Partner A",
      b: (p.b.name || "").trim() || "Partner B",
      bull: (p.bull.enabled && (p.bull.name || "").trim()) ? p.bull.name.trim() : "an approved bull",
      aRole: roleLabel(p.a.role),
      bRole: roleLabel(p.b.role)
    };
  }

  function defaultTitle() {
    const c = ctxNames();
    return "Pact of " + c.a + " & " + c.b;
  }

  /* ---------- storage ---------- */
  function loadContracts() {
    try {
      return JSON.parse(localStorage.getItem(LS.contracts) || "[]");
    } catch {
      return [];
    }
  }
  function saveContracts(list) {
    localStorage.setItem(LS.contracts, JSON.stringify(list));
  }
  function uid() {
    return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function persistDraft(silent) {
    const list = loadContracts();
    const now = Date.now();
    const copy = JSON.parse(JSON.stringify(state.draft));
    if (!copy.title) copy.title = defaultTitle();
    copy.updated = now;
    if (!copy.id) {
      copy.id = uid();
      copy.created = now;
      state.draft.id = copy.id;
      state.draft.created = now;
      list.unshift(copy);
    } else {
      const i = list.findIndex((x) => x.id === copy.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], copy);
      else list.unshift(copy);
    }
    try {
      saveContracts(list);
      state.dirty = false;
      if (!silent) toast("Saved");
      return true;
    } catch (e) {
      toast("Couldn't save — storage may be full");
      return false;
    }
  }

  /* ---------- PIN ---------- */
  function pinEnabled() {
    return localStorage.getItem(LS.pinEnabled) === "1" && !!localStorage.getItem(LS.pinHash);
  }
  function updatePinDots(error) {
    $$(".pin-dot").forEach((d, i) => {
      d.classList.toggle("filled", i < state.pinBuffer.length);
      d.classList.toggle("error", !!error);
    });
  }
  function showLock(mode) {
    $("#lock-screen").classList.remove("hidden");
    $("#app").classList.add("hidden");
    state.pinBuffer = "";
    state.settingPin = mode === "set" || mode === "change";
    if (mode !== "confirm") state.confirmPin = null;
    const title = $("#lock-title");
    const sub = $("#lock-sub");
    if (mode === "set") {
      title.textContent = "Create a PIN";
      sub.textContent = "Optional lock for Pact on this device.";
    } else if (mode === "confirm") {
      title.textContent = "Confirm PIN";
      sub.textContent = "Enter the same PIN again.";
    } else if (mode === "change") {
      title.textContent = "New PIN";
      sub.textContent = "Enter a new 4-digit PIN.";
    } else {
      title.textContent = "Enter PIN";
      sub.textContent = "Pact is locked.";
    }
    $("#lock-error").textContent = "";
    updatePinDots(false);
  }
  function unlockApp() {
    sessionStorage.setItem("pact_session_ok", "1");
    $("#lock-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    renderHome();
    showScreen("home");
  }
  async function onPinComplete(pin) {
    const errEl = $("#lock-error");
    if (state.settingPin && state.confirmPin === null) {
      state.confirmPin = pin;
      state.pinBuffer = "";
      showLock("confirm");
      state.settingPin = true;
      return;
    }
    if (state.settingPin && state.confirmPin !== null) {
      if (pin !== state.confirmPin) {
        errEl.textContent = "PINs didn’t match. Try again.";
        state.confirmPin = null;
        state.pinBuffer = "";
        updatePinDots(true);
        setTimeout(() => showLock("set"), 450);
        return;
      }
      const salt = randomSalt();
      localStorage.setItem(LS.pinSalt, salt);
      localStorage.setItem(LS.pinHash, await hashPin(pin, salt));
      localStorage.setItem(LS.pinEnabled, "1");
      state.confirmPin = null;
      state.settingPin = false;
      toast("PIN enabled");
      unlockApp();
      syncPinToggle();
      return;
    }
    const salt = localStorage.getItem(LS.pinSalt);
    const expected = localStorage.getItem(LS.pinHash);
    if ((await hashPin(pin, salt)) === expected) unlockApp();
    else {
      errEl.textContent = "Wrong PIN";
      state.pinBuffer = "";
      updatePinDots(true);
      setTimeout(() => updatePinDots(false), 400);
    }
  }
  function bindPinPad() {
    $$(".pin-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.key;
        if (k === "del") {
          state.pinBuffer = state.pinBuffer.slice(0, -1);
          updatePinDots(false);
          return;
        }
        if (state.pinBuffer.length >= PIN_LEN) return;
        state.pinBuffer += k;
        updatePinDots(false);
        if (state.pinBuffer.length === PIN_LEN) onPinComplete(state.pinBuffer);
      });
    });
  }
  function syncPinToggle() {
    const on = pinEnabled();
    $("#pin-toggle").classList.toggle("on", on);
    $("#pin-toggle-label").textContent = on ? "On" : "Off";
  }

  /* ---------- builder ---------- */
  function startNew() {
    state.draft = emptyDraft();
    state.step = 0;
    state.dirty = false;
    showScreen("builder");
    renderStep();
  }

  function openDraft(item, asCopy) {
    const d = JSON.parse(JSON.stringify(item));
    if (asCopy) {
      d.id = null;
      d.title = (d.title || "Pact") + " (copy)";
      d.created = null;
      d.updated = null;
      d.signatures = { a: { dataUrl: "", signedAt: "" }, b: { dataUrl: "", signedAt: "" } };
    }
    state.draft = Object.assign(emptyDraft(), d);
    if (!state.draft.custom) state.draft.custom = emptyDraft().custom;
    if (!state.draft.signatures) state.draft.signatures = emptyDraft().signatures;
    state.step = 0;
    state.dirty = !!asCopy;
    showScreen("builder");
    renderStep();
  }

  function fillClause(c) {
    const tone = state.draft.tone || "playful";
    const text = (c.tones && c.tones[tone]) || (c.tones && c.tones.playful) || "";
    return window.PactLib.fill(text, ctxNames());
  }

  function renderStep() {
    const step = STEPS[state.step];
    $("#progress-fill").style.width = ((state.step / (STEPS.length - 1)) * 100) + "%";
    $("#step-label").textContent = step.title;
    $("#step-count").textContent = (state.step + 1) + " / " + STEPS.length;
    $("#btn-back").textContent = state.step === 0 ? "Home" : "Back";
    $("#btn-next").textContent = state.step === STEPS.length - 1 ? "Save pact" : "Continue";

    $$(".step-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.step !== step.id));
    const clauseSteps = ["boundaries", "safety", "communication", "perks", "duration"];
    $("#clause-chrome").classList.toggle("hidden", clauseSteps.indexOf(step.id) < 0);

    if (step.id === "names") renderNames();
    else if (step.id === "tone") renderTone();
    else if (["boundaries", "safety", "communication", "perks", "duration"].indexOf(step.id) >= 0) {
      renderClauseStep(step.id);
    } else if (step.id === "preview") {
      renderPreview();
    }
  }

  function renderNames() {
    const p = state.draft.partners;
    $("#title-input").value = state.draft.title;
    $("#name-a").value = p.a.name;
    $("#name-b").value = p.b.name;
    $("#role-a").value = p.a.role;
    $("#role-b").value = p.b.role;
    $("#bull-enabled").classList.toggle("on", !!p.bull.enabled);
    $("#bull-fields").classList.toggle("hidden", !p.bull.enabled);
    $("#bull-name").value = p.bull.name;
    $("#safeword-input").value = state.draft.safeword || "Red";
  }

  function pullNames() {
    const d = state.draft;
    d.title = $("#title-input").value.trim();
    d.partners.a.name = $("#name-a").value.trim();
    d.partners.b.name = $("#name-b").value.trim();
    d.partners.a.role = $("#role-a").value;
    d.partners.b.role = $("#role-b").value;
    d.partners.bull.name = $("#bull-name").value.trim();
    d.safeword = $("#safeword-input").value.trim() || "Red";
    state.dirty = true;
  }

  function renderTone() {
    $$("#tone-seg button").forEach((b) => b.classList.toggle("active", b.dataset.tone === state.draft.tone));
    const sample = window.PACT_CLAUSES.find((c) => c.id === "b01");
    $("#tone-sample").textContent = sample ? fillClause(sample) : "";
  }

  function renderClauseStep(section) {
    const meta = window.PACT_META.sections.find((s) => s.id === section);
    $("#clause-title").textContent = meta.title;
    $("#clause-blurb").textContent = meta.blurb;
    const bullOn = !!state.draft.partners.bull.enabled;
    const list = window.PactLib.bySection(section).filter((c) => !c.needsBull || bullOn);
    const root = $("#clause-list");
    root.innerHTML = "";
    list.forEach((c) => {
      const on = !!state.draft.enabled[c.id];
      const el = document.createElement("button");
      el.type = "button";
      el.className = "clause" + (on ? " on" : "");
      el.innerHTML =
        '<span class="check"></span><span class="body"><p class="lab-name"></p><p class="preview-line"></p></span>';
      el.querySelector(".lab-name").textContent = window.PactLib.fill(c.label, ctxNames());
      el.querySelector(".preview-line").textContent = fillClause(c);
      el.addEventListener("click", () => {
        state.draft.enabled[c.id] = !state.draft.enabled[c.id];
        state.dirty = true;
        el.classList.toggle("on", !!state.draft.enabled[c.id]);
      });
      root.appendChild(el);
    });

    if (section === "duration") {
      $("#duration-extra").classList.remove("hidden");
      $("#start-date").value = state.draft.startDate || todayISO();
      $("#review-date").value = state.draft.reviewDate || "";
      $("#duration-note").value = state.draft.durationNote || "";
    } else {
      $("#duration-extra").classList.add("hidden");
    }
    if (section === "communication") {
      $("#comm-extra").classList.remove("hidden");
      $("#checkin-note").value = state.draft.checkInNote || "";
    } else {
      $("#comm-extra").classList.add("hidden");
    }

    renderCustom(section);
  }

  function renderCustom(section) {
    const items = state.draft.custom[section] || [];
    const box = $("#custom-list");
    box.innerHTML = items.length
      ? items
          .map(
            (t, i) =>
              '<div class="custom-item"><span></span><button type="button" data-i="' + i + '">Remove</button></div>'
          )
          .join("")
      : "";
    Array.from(box.querySelectorAll(".custom-item")).forEach((row, i) => {
      row.querySelector("span").textContent = items[i];
    });
    box.onclick = (e) => {
      const btn = e.target.closest("button[data-i]");
      if (!btn) return;
      state.draft.custom[section].splice(Number(btn.dataset.i), 1);
      state.dirty = true;
      renderCustom(section);
    };
  }

  function addCustom() {
    const section = STEPS[state.step].id;
    if (!state.draft.custom[section]) return;
    const input = $("#custom-input");
    const t = input.value.trim();
    if (!t) return;
    state.draft.custom[section].push(t);
    input.value = "";
    state.dirty = true;
    renderCustom(section);
  }

  function selectedClauses(section) {
    const bullOn = !!state.draft.partners.bull.enabled;
    return window.PactLib.bySection(section)
      .filter((c) => state.draft.enabled[c.id] && (!c.needsBull || bullOn))
      .map((c) => fillClause(c))
      .concat(state.draft.custom[section] || []);
  }

  function documentModel() {
    const c = ctxNames();
    const title = state.draft.title || defaultTitle();
    const sections = window.PACT_META.sections.map((s) => ({
      id: s.id,
      title: s.title,
      items: selectedClauses(s.id)
    })).filter((s) => s.items.length || s.id === "duration");

    if (state.draft.startDate || state.draft.reviewDate || state.draft.durationNote) {
      const dur = sections.find((s) => s.id === "duration") || { id: "duration", title: "Duration & Review", items: [] };
      if (!sections.includes(dur) && (state.draft.startDate || state.draft.reviewDate || state.draft.durationNote)) {
        sections.push(dur);
      }
      if (state.draft.startDate) dur.items.unshift("Effective date: " + formatDate(state.draft.startDate) + ".");
      if (state.draft.reviewDate) dur.items.push("Scheduled review date: " + formatDate(state.draft.reviewDate) + ".");
      if (state.draft.durationNote) dur.items.push(state.draft.durationNote);
    }

    const extras = [];
    if (state.draft.safeword) extras.push("The couple's safeword is “" + state.draft.safeword + ".”");
    if (state.draft.checkInNote) extras.push("Check-in notes: " + state.draft.checkInNote);
    const comm = sections.find((s) => s.id === "communication");
    if (comm && extras.length) comm.items = extras.concat(comm.items);

    return {
      title,
      parties: c,
      tone: state.draft.tone,
      sections,
      footer: window.PACT_META.footer,
      signatures: state.draft.signatures,
      startDate: state.draft.startDate
    };
  }

  function renderPreview() {
    const doc = documentModel();
    const c = doc.parties;
    const paper = $("#paper");
    let html = "";
    html += '<div class="mast"><div class="kicker">Private household pact</div>';
    html += "<h1></h1>";
    html += '<p class="parties"></p></div>';
    doc.sections.forEach((s) => {
      if (!s.items.length) return;
      html += "<h3></h3><ol>";
      s.items.forEach(() => { html += "<li></li>"; });
      html += "</ol>";
    });
    html += '<div class="sig-block">';
    html += sigHtml("a") + sigHtml("b");
    html += "</div>";
    html += '<p class="doc-foot"></p>';
    paper.innerHTML = html;
    paper.querySelector("h1").textContent = doc.title;
    const partiesLine =
      "Entered into by " + c.a + " (" + c.aRole + ") and " + c.b + " (" + c.bRole + ")" +
      (state.draft.partners.bull.enabled && state.draft.partners.bull.name
        ? ", with approved partner nickname “" + c.bull + "”"
        : "") +
      (doc.startDate ? ", dated " + formatDate(doc.startDate) : "") + ".";
    paper.querySelector(".parties").textContent = partiesLine;
    const headings = paper.querySelectorAll("h3");
    const ols = paper.querySelectorAll("ol");
    let hi = 0;
    doc.sections.forEach((s) => {
      if (!s.items.length) return;
      headings[hi].textContent = s.title;
      const lis = ols[hi].querySelectorAll("li");
      s.items.forEach((t, i) => { lis[i].textContent = t; });
      hi += 1;
    });
    paper.querySelector(".doc-foot").textContent = doc.footer;

    $("#sig-label-a").textContent = c.a + " · " + c.aRole;
    $("#sig-label-b").textContent = c.b + " · " + c.bRole;
    drawStoredSignature("a");
    drawStoredSignature("b");
  }

  function sigHtml(who) {
    const sig = state.draft.signatures[who] || {};
    let inner = "";
    if (sig.dataUrl) inner = "<img alt='signature' />";
    else inner = '<p class="when">Signature pending</p>';
    return (
      '<div class="sig" data-who="' + who + '">' + inner +
      '<div class="who"></div><div class="when"></div></div>'
    );
  }

  /* Signature pads */
  const pads = {};
  function setupPad(who) {
    const canvas = $("#pad-" + who);
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    function resize() {
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 140;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a1612";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      const stored = state.draft.signatures[who] && state.draft.signatures[who].dataUrl;
      if (stored) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, w, h);
        img.src = stored;
      }
    }
    const pad = { drawing: false, last: null, dirty: false, resize };
    function pos(ev) {
      const r = canvas.getBoundingClientRect();
      const t = ev.touches ? ev.touches[0] : ev;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function start(ev) {
      pad.drawing = true;
      pad.last = pos(ev);
      ev.preventDefault();
    }
    function move(ev) {
      if (!pad.drawing) return;
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(pad.last.x, pad.last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      pad.last = p;
      pad.dirty = true;
      ev.preventDefault();
    }
    function end() {
      if (!pad.drawing) return;
      pad.drawing = false;
      if (pad.dirty) commitSignature(who);
    }
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    pads[who] = pad;
    resize();
  }

  function commitSignature(who) {
    const canvas = $("#pad-" + who);
    state.draft.signatures[who] = {
      dataUrl: canvas.toDataURL("image/png"),
      signedAt: new Date().toISOString()
    };
    state.dirty = true;
    renderPreviewSignaturesOnly();
  }

  function clearSignature(who) {
    state.draft.signatures[who] = { dataUrl: "", signedAt: "" };
    state.dirty = true;
    if (pads[who]) pads[who].resize();
    renderPreviewSignaturesOnly();
  }

  function drawStoredSignature(who) {
    if (pads[who]) pads[who].resize();
    const block = $("#paper").querySelector('.sig[data-who="' + who + '"]');
    if (!block) return;
    const sig = state.draft.signatures[who] || {};
    const c = ctxNames();
    const name = who === "a" ? c.a + " · " + c.aRole : c.b + " · " + c.bRole;
    block.querySelector(".who").textContent = name;
    const when = block.querySelector(".when");
    if (sig.dataUrl) {
      let img = block.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "signature";
        block.insertBefore(img, block.querySelector(".who"));
        const pending = block.querySelector("p.when");
        if (pending) pending.remove();
      }
      img.src = sig.dataUrl;
      when.textContent = "Signed " + formatSigned(sig.signedAt);
    } else {
      const img = block.querySelector("img");
      if (img) img.remove();
      when.textContent = "Signature pending";
    }
  }

  function renderPreviewSignaturesOnly() {
    drawStoredSignature("a");
    drawStoredSignature("b");
  }

  function formatSigned(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch {
      return iso;
    }
  }

  /* ---------- PDF ---------- */
  function jsPDFCtor() {
    const g = window.jspdf;
    if (g && g.jsPDF) return g.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  async function buildPdfBlob() {
    const Ctor = jsPDFCtor();
    if (!Ctor) throw new Error("jsPDF missing");
    const docm = documentModel();
    const pdf = new Ctor({ unit: "pt", format: "letter" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 56;
    const maxW = pageW - margin * 2;
    let y = 64;

    function ensure(space) {
      if (y + space > pageH - 64) {
        footer();
        pdf.addPage();
        pdf.setFillColor(246, 241, 231);
        pdf.rect(0, 0, pageW, pageH, "F");
        y = 64;
      }
    }
    function footer() {
      pdf.setFont("times", "italic");
      pdf.setFontSize(8);
      pdf.setTextColor(110, 100, 90);
      const lines = pdf.splitTextToSize(docm.footer, maxW);
      pdf.text(lines, margin, pageH - 36);
      pdf.setFont("times", "normal");
      pdf.setFontSize(8);
      pdf.text(String(pdf.internal.getNumberOfPages()), pageW - margin, pageH - 36, { align: "right" });
    }

    pdf.setFillColor(246, 241, 231);
    pdf.rect(0, 0, pageW, pageH, "F");

    pdf.setTextColor(138, 106, 59);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("PRIVATE HOUSEHOLD PACT", pageW / 2, y, { align: "center" });
    y += 22;
    pdf.setTextColor(26, 22, 18);
    pdf.setFont("times", "bold");
    pdf.setFontSize(22);
    const titleLines = pdf.splitTextToSize(docm.title, maxW);
    titleLines.forEach((ln) => {
      pdf.text(ln, pageW / 2, y, { align: "center" });
      y += 24;
    });
    y += 4;
    pdf.setFont("times", "italic");
    pdf.setFontSize(11);
    pdf.setTextColor(80, 72, 64);
    const c = docm.parties;
    let parties =
      "Entered into by " + c.a + " (" + c.aRole + ") and " + c.b + " (" + c.bRole + ")";
    if (state.draft.partners.bull.enabled && state.draft.partners.bull.name) {
      parties += ', with approved partner nickname “' + c.bull + '”';
    }
    if (docm.startDate) parties += ", dated " + formatDate(docm.startDate);
    parties += ".";
    const pLines = pdf.splitTextToSize(parties, maxW);
    pLines.forEach((ln) => { pdf.text(ln, pageW / 2, y, { align: "center" }); y += 14; });
    y += 8;
    pdf.setDrawColor(217, 207, 192);
    pdf.line(margin, y, pageW - margin, y);
    y += 20;

    docm.sections.forEach((s) => {
      if (!s.items.length) return;
      ensure(40);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(138, 106, 59);
      pdf.text(s.title.toUpperCase(), margin, y);
      y += 16;
      pdf.setFont("times", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(26, 22, 18);
      s.items.forEach((item, idx) => {
        const prefix = (idx + 1) + ". ";
        const lines = pdf.splitTextToSize(prefix + item, maxW);
        ensure(lines.length * 14 + 8);
        lines.forEach((ln) => {
          pdf.text(ln, margin, y);
          y += 14;
        });
        y += 4;
      });
      y += 8;
    });

    y += 8;
    ensure(130);
    pdf.setDrawColor(217, 207, 192);
    pdf.line(margin, y, pageW - margin, y);
    y += 18;

    function addSig(who, x) {
      const sig = state.draft.signatures[who] || {};
      const name = who === "a"
        ? c.a + " · " + c.aRole
        : c.b + " · " + c.bRole;
      if (sig.dataUrl) {
        try {
          pdf.addImage(sig.dataUrl, "PNG", x, y, 200, 56);
        } catch (e) { /* ignore */ }
      }
      pdf.setDrawColor(26, 22, 18);
      pdf.line(x, y + 62, x + 220, y + 62);
      pdf.setFont("times", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(26, 22, 18);
      pdf.text(name, x, y + 76);
      pdf.setFontSize(8);
      pdf.setTextColor(110, 100, 90);
      pdf.text(sig.signedAt ? "Signed " + formatSigned(sig.signedAt) : "Signature pending", x, y + 88);
    }
    addSig("a", margin);
    addSig("b", pageW / 2 + 10);
    y += 110;

    // paint cream background on additional pages
    const total = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i);
      // footer already reserved; redraw footer on all
      // First page already has cream; added pages need cream behind content.
      if (i > 1) {
        // can't easily redraw under existing content; add cream at start of each new page instead (already done in ensure)
      }
      footer();
    }

    // Fix later pages background: when adding pages in ensure() we should fill cream. Patch ensure by doing it now if only 1 page it's fine.
    return pdf.output("blob");
  }

  // Improve addPage cream fill by wrapping — monkey patch after first build? Better fix ensure() above.
  // I'll patch ensure in a follow-up if needed. Let me update ensure to fill cream on new pages — already planned but I only filled first page.
  // I'll fix by rewriting ensure... too late in this string. I'll patch file after if tests fail.
  // Actually I need to fix this. I'll use a slightly different approach after writing - search replace.

  async function exportPdf() {
    let blob;
    try {
      blob = await buildPdfBlob();
    } catch (e) {
      console.error(e);
      toast("PDF export failed");
      return;
    }
    const name = (state.draft.title || defaultTitle()).replace(/[^\w\s-]+/g, "").trim() || "pact";
    const file = new File([blob], name + ".pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        toast("Shared");
        return blob;
      } catch (e) {
        if (e && e.name === "AbortError") return blob;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("PDF saved");
    return blob;
  }
  // exposed for tests
  window.__pactExportPdf = exportPdf;
  window.__pactBuildPdfBlob = buildPdfBlob;
  window.__pactStartDemo = function () {
    state.draft = emptyDraft();
    state.draft.title = "Demo Pact";
    state.draft.partners.a.name = "Alex";
    state.draft.partners.b.name = "Jordan";
    state.draft.enabled.b01 = true;
    state.draft.enabled.s01 = true;
    state.draft.enabled.c09 = true;
    state.draft.enabled.d10 = true;
  };

  /* ---------- home ---------- */
  function renderHome() {
    const list = loadContracts();
    const root = $("#saved-list");
    $("#clause-count-home").textContent = window.PactLib.count() + " preset clauses";
    if (!list.length) {
      root.innerHTML = '<p class="muted" style="padding:8px 0">No saved pacts yet.</p>';
      return;
    }
    root.innerHTML = list
      .map((item) => {
        const when = item.updated ? formatSigned(new Date(item.updated).toISOString()) : "";
        const names = ((item.partners && item.partners.a && item.partners.a.name) || "Partner A") +
          " & " + ((item.partners && item.partners.b && item.partners.b.name) || "Partner B");
        return (
          '<div class="saved-item" data-id="' + item.id + '">' +
          "<h3></h3><div class='meta'></div>" +
          '<div class="btn-row">' +
          '<button class="btn" data-act="edit">Edit</button>' +
          '<button class="btn" data-act="dup">Duplicate</button>' +
          '<button class="btn danger" data-act="del">Delete</button>' +
          "</div></div>"
        );
      })
      .join("");
    Array.from(root.querySelectorAll(".saved-item")).forEach((el, i) => {
      const item = list[i];
      el.querySelector("h3").textContent = item.title || "Untitled pact";
      const when = item.updated ? formatSigned(new Date(item.updated).toISOString()) : "";
      const names = ((item.partners && item.partners.a && item.partners.a.name) || "Partner A") +
        " & " + ((item.partners && item.partners.b && item.partners.b.name) || "Partner B");
      el.querySelector(".meta").textContent = names + (when ? " · " + when : "");
    });
  }

  function bindUI() {
    $("#btn-new").addEventListener("click", startNew);
    $("#btn-settings").addEventListener("click", () => {
      syncPinToggle();
      showScreen("settings");
    });
    $("#btn-settings-back").addEventListener("click", () => {
      renderHome();
      showScreen("home");
    });
    $("#btn-home-link").addEventListener("click", () => {
      if (state.dirty) persistDraft(true);
      renderHome();
      showScreen("home");
    });

    $("#btn-back").addEventListener("click", () => {
      pullCurrent();
      if (state.step === 0) {
        if (state.dirty) persistDraft(true);
        renderHome();
        showScreen("home");
        return;
      }
      state.step -= 1;
      renderStep();
    });
    $("#btn-next").addEventListener("click", () => {
      pullCurrent();
      if (state.step === STEPS.length - 1) {
        persistDraft(false);
        renderHome();
        showScreen("home");
        return;
      }
      state.step += 1;
      renderStep();
    });

    $("#title-input").addEventListener("input", pullNames);
    $("#name-a").addEventListener("input", pullNames);
    $("#name-b").addEventListener("input", pullNames);
    $("#role-a").addEventListener("change", pullNames);
    $("#role-b").addEventListener("change", pullNames);
    $("#bull-name").addEventListener("input", pullNames);
    $("#safeword-input").addEventListener("input", pullNames);
    $("#bull-enabled").addEventListener("click", () => {
      state.draft.partners.bull.enabled = !state.draft.partners.bull.enabled;
      state.dirty = true;
      renderNames();
    });

    $$("#tone-seg button").forEach((b) => {
      b.addEventListener("click", () => {
        state.draft.tone = b.dataset.tone;
        state.dirty = true;
        renderTone();
      });
    });

    $("#btn-add-custom").addEventListener("click", addCustom);
    $("#custom-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addCustom(); }
    });
    $("#start-date").addEventListener("change", () => {
      state.draft.startDate = $("#start-date").value;
      state.dirty = true;
    });
    $("#review-date").addEventListener("change", () => {
      state.draft.reviewDate = $("#review-date").value;
      state.dirty = true;
    });
    $("#duration-note").addEventListener("input", () => {
      state.draft.durationNote = $("#duration-note").value;
      state.dirty = true;
    });
    $("#checkin-note").addEventListener("input", () => {
      state.draft.checkInNote = $("#checkin-note").value;
      state.dirty = true;
    });

    $("#btn-clear-a").addEventListener("click", () => clearSignature("a"));
    $("#btn-clear-b").addEventListener("click", () => clearSignature("b"));
    $("#btn-export").addEventListener("click", () => { persistDraft(true); exportPdf(); });

    $("#saved-list").addEventListener("click", (e) => {
      const itemEl = e.target.closest(".saved-item");
      if (!itemEl) return;
      const id = itemEl.dataset.id;
      const list = loadContracts();
      const item = list.find((x) => x.id === id);
      if (!item) return;
      const act = e.target.dataset.act;
      if (act === "edit") openDraft(item, false);
      else if (act === "dup") openDraft(item, true);
      else if (act === "del") {
        saveContracts(list.filter((x) => x.id !== id));
        renderHome();
        toast("Deleted");
      }
    });

    $("#pin-toggle").addEventListener("click", () => {
      if (pinEnabled()) {
        localStorage.setItem(LS.pinEnabled, "0");
        toast("PIN lock off");
        syncPinToggle();
      } else if (localStorage.getItem(LS.pinHash)) {
        localStorage.setItem(LS.pinEnabled, "1");
        toast("PIN lock on");
        syncPinToggle();
      } else showLock("set");
    });
    $("#btn-change-pin").addEventListener("click", () => showLock("change"));
    $("#btn-lock-now").addEventListener("click", () => {
      if (!pinEnabled()) { toast("Enable PIN first"); return; }
      sessionStorage.removeItem("pact_session_ok");
      showLock("enter");
    });
    $("#btn-clear-all").addEventListener("click", () => {
      localStorage.removeItem(LS.contracts);
      renderHome();
      toast("Saved pacts cleared");
    });
  }

  function pullCurrent() {
    const id = STEPS[state.step].id;
    if (id === "names") pullNames();
    if (id === "duration" && $("#start-date")) {
      state.draft.startDate = $("#start-date").value;
      state.draft.reviewDate = $("#review-date").value;
      state.draft.durationNote = $("#duration-note").value;
    }
    if (id === "communication" && $("#checkin-note")) {
      state.draft.checkInNote = $("#checkin-note").value;
    }
  }

  function fillRoleSelects() {
    const html = window.PACT_META.roles.map((r) => '<option value="' + r.id + '">' + r.label + "</option>").join("");
    $("#role-a").innerHTML = html;
    $("#role-b").innerHTML = html;
  }

  function init() {
    bindPinPad();
    fillRoleSelects();
    bindUI();
    setupPad("a");
    setupPad("b");
    window.addEventListener("resize", () => {
      if (pads.a) pads.a.resize();
      if (pads.b) pads.b.resize();
    });

    if (pinEnabled() && sessionStorage.getItem("pact_session_ok") !== "1") {
      showLock("enter");
    } else {
      $("#lock-screen").classList.add("hidden");
      $("#app").classList.remove("hidden");
      renderHome();
      showScreen("home");
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
