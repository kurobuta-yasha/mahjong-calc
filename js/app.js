import { calculate, DEFAULT_RULES } from "./engine.js";
import { isHonor } from "./tiles.js";
import { tileHTML, meldHTML, resultDetailHTML, headline, esc } from "./render.js";
import { initQuiz } from "./quiz.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- 保存（失敗しても動く）
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode など */ }
  },
};

let rules = { ...DEFAULT_RULES, ...store.get("mj.rules", {}) };
const getRules = () => rules;

// ---------------------------------------------------------------- 状態
const state = {
  mode: "hand",
  hand: [],        // 門前の牌（和了牌を含む）。入れた順
  agariIdx: -1,    // hand の中の和了牌の位置
  melds: [],
  dora: [],
  ura: [],
  tsumo: false,
  seatWind: 1,
  roundWind: 0,
  riichi: 0,
  ippatsu: false,
  haitei: false,
  rinshan: false,
  chankan: false,
  tenchi: false,
  aka: 0,
  honba: 0,
};
const undoStack = [];
const snapshot = () => JSON.stringify({ hand: state.hand, agariIdx: state.agariIdx, melds: state.melds, dora: state.dora, ura: state.ura });
const pushUndo = () => { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); };

const closedMax = (meldCount = state.melds.length) => 14 - 3 * meldCount;
const hasOpenMeld = () => state.melds.some((m) => m.type !== "ankan");

function usedCounts() {
  const c = new Array(34).fill(0);
  state.hand.forEach((t) => c[t.id]++);
  state.melds.forEach((m) => m.tiles.forEach((t) => c[t.id]++));
  state.dora.forEach((t) => c[t]++);
  state.ura.forEach((t) => c[t]++);
  return c;
}

// ---------------------------------------------------------------- 入力操作
const MODE_HINTS = {
  hand: "タップで手牌に追加（最後の牌＝和了牌）",
  chi: "チーする順子の一番小さい牌をタップ（例: 345 なら 3）",
  pon: "ポンした牌をタップ",
  minkan: "明槓（大明槓・加槓）した牌をタップ",
  ankan: "暗槓した牌をタップ",
  dora: "ドラ表示牌をタップ（ドラそのものではなく表示牌）",
  ura: "裏ドラ表示牌をタップ",
};

function tapTile(id) {
  const used = usedCounts();
  const need = { hand: 1, chi: 0, pon: 3, minkan: 4, ankan: 4, dora: 1, ura: 1 }[state.mode];
  if (state.mode !== "chi" && used[id] + need > 4) return flash("その牌はもう残っていません");

  if (state.mode === "hand") {
    if (state.hand.length >= closedMax()) return flash("手牌はもういっぱいです");
    pushUndo();
    state.hand.push({ id, red: false });
    state.agariIdx = state.hand.length - 1;
  } else if (state.mode === "dora" || state.mode === "ura") {
    pushUndo();
    state[state.mode].push(id);
  } else {
    if (state.melds.length >= 4) return flash("副露は4つまでです");
    if (state.hand.length > closedMax(state.melds.length + 1)) return flash("手牌が多すぎて副露を追加できません。先に手牌を減らしてください");
    let ids;
    if (state.mode === "chi") {
      if (isHonor(id) || id % 9 > 6) return flash("チーは 1〜7 の牌をタップ（一番小さい牌）");
      ids = [id, id + 1, id + 2];
      if (ids.some((t) => used[t] + 1 > 4)) return flash("その順子に使う牌が残っていません");
    } else {
      ids = new Array(state.mode === "pon" ? 3 : 4).fill(id);
    }
    pushUndo();
    state.melds.push({ type: state.mode, tiles: ids.map((t) => ({ id: t, red: false })) });
    if (hasOpenMeld()) { state.riichi = 0; state.ippatsu = false; }
    state.tenchi = false;
  }
  render();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  Object.assign(state, JSON.parse(prev));
  render();
}

function clearAll() {
  if (!state.hand.length && !state.melds.length && !state.dora.length && !state.ura.length) return;
  pushUndo();
  Object.assign(state, { hand: [], agariIdx: -1, melds: [], dora: [], ura: [] });
  render();
}

let flashTimer;
function flash(msg) {
  const el = $("#mode-hint");
  el.textContent = msg;
  el.classList.add("warn");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.classList.remove("warn"); renderModeHint(); }, 2200);
}

// ---------------------------------------------------------------- 描画
function buildPalette() {
  const rows = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16, 17],
    [18, 19, 20, 21, 22, 23, 24, 25, 26],
    [27, 28, 29, 30, 31, 32, 33],
  ];
  $("#palette").innerHTML = rows.map((r) =>
    `<div class="pal-row">${r.map((id) => `<button data-tile="${id}">${tileHTML(id)}</button>`).join("")}</div>`,
  ).join("");
}

function renderModeHint() {
  const el = $("#mode-hint");
  if (!el.classList.contains("warn")) el.textContent = MODE_HINTS[state.mode];
}

function render() {
  // 手牌
  const agari = state.hand[state.agariIdx];
  const rest = state.hand.map((t, i) => ({ ...t, i })).filter((t) => t.i !== state.agariIdx).sort((a, b) => a.id - b.id);
  let html = rest.map((t) => `<button class="tile-btn" data-idx="${t.i}" aria-label="和了牌にする">${tileHTML(t.id)}</button>`).join("");
  if (agari) html += `<span class="gap"></span>${tileHTML(agari.id, { cls: "agari" })}`;
  html += state.melds.map((m, i) => meldHTML(m, `data-meld="${i}" role="button" aria-label="副露を消す"`)).join("");
  $("#hand").innerHTML = html || `<span class="hint">ここに手牌が並びます</span>`;

  const remain = closedMax() - state.hand.length;
  $("#hand-hint").textContent = remain > 0
    ? `あと${remain}枚${state.hand.length ? "（手牌の牌をタップで和了牌を変更）" : ""}`
    : "手牌の牌をタップすると和了牌を変えられます";

  // ドラ表示
  const ind = (arr, key, label) => arr.length
    ? `<span class="ind-group">${label} ${arr.map((id, i) => `<button data-${key}="${i}" aria-label="消す">${tileHTML(id)}</button>`).join("")}</span>` : "";
  $("#indicators").innerHTML = ind(state.dora, "dora", "ドラ表示") + ind(state.ura, "ura", "裏ドラ表示");

  // パレット
  const used = usedCounts();
  $$("#palette button").forEach((b) => {
    const id = Number(b.dataset.tile);
    let disabled = used[id] >= 4;
    if (state.mode === "chi") disabled = isHonor(id) || id % 9 > 6;
    if (["pon"].includes(state.mode)) disabled = used[id] > 1;
    if (["minkan", "ankan"].includes(state.mode)) disabled = used[id] > 0;
    b.disabled = disabled;
  });

  // モード
  $$(".modes button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.mode === state.mode);
    if (b.dataset.mode === "ura") b.disabled = !state.riichi;
  });
  if (state.mode === "ura" && !state.riichi) state.mode = "hand";
  renderModeHint();

  renderConds();
  renderResult();
}

function renderConds() {
  // 条件の整合性
  if (hasOpenMeld()) state.riichi = 0;
  if (!state.riichi) { state.ippatsu = false; }
  if (!state.tsumo) { state.rinshan = false; state.tenchi = false; }
  if (state.tsumo) state.chankan = false;
  if (state.melds.length || state.riichi) state.tenchi = false;

  $$(".conds .seg").forEach((seg) => {
    const key = seg.dataset.key;
    $$("button", seg).forEach((b) => {
      b.setAttribute("aria-pressed", String(state[key]) === b.dataset.v);
      if (key === "riichi") b.disabled = hasOpenMeld() && b.dataset.v !== "0";
    });
  });
  const can = {
    ippatsu: state.riichi > 0,
    haitei: true,
    rinshan: state.tsumo,
    chankan: !state.tsumo,
    tenchi: state.tsumo && !state.melds.length && !state.riichi,
  };
  $$(".tog").forEach((b) => {
    const key = b.dataset.key;
    b.setAttribute("aria-pressed", state[key]);
    b.disabled = !can[key];
  });
  const hai = $('[data-key="haitei"] span');
  hai.textContent = state.tsumo ? hai.dataset.tsumo : hai.dataset.ron;
  const ten = $('[data-key="tenchi"] span');
  ten.textContent = state.seatWind === 0 ? ten.dataset.oya : ten.dataset.ko;
  $$(".stepper").forEach((s) => ($("output", s).textContent = state[s.dataset.key]));
}

function currentInput() {
  const agari = state.hand[state.agariIdx] || null;
  return {
    hand: state.hand.filter((_, i) => i !== state.agariIdx),
    agari,
    melds: state.melds,
    dora: state.dora,
    ura: state.ura,
    tsumo: state.tsumo,
    seatWind: state.seatWind,
    roundWind: state.roundWind,
    riichi: state.riichi,
    ippatsu: state.ippatsu,
    haitei: state.haitei,
    rinshan: state.rinshan,
    chankan: state.chankan,
    tenchi: state.tenchi,
    aka: state.aka,
    honba: state.honba,
  };
}

function renderResult() {
  const bar = $("#result-bar");
  const detail = $("#detail");
  if (!state.hand.length && !state.melds.length) {
    bar.classList.remove("err");
    $("#rb-points").textContent = "—";
    $("#rb-sub").textContent = "手牌を入れてください";
    detail.hidden = true;
    return;
  }
  const r = calculate(currentInput(), rules);
  if (!r.ok) {
    bar.classList.add("err");
    $("#rb-points").textContent = r.incomplete ? "入力中…" : "和了できません";
    $("#rb-sub").textContent = r.error;
    detail.hidden = true;
    return;
  }
  bar.classList.remove("err");
  $("#rb-points").innerHTML = `${esc(r.text)}<small>点</small>`;
  const who = `${r.isOya ? "親" : "子"}の${r.tsumo ? "ツモ" : "ロン"}`;
  $("#rb-sub").textContent = `${headline(r)} ・ ${who}`;
  detail.innerHTML = resultDetailHTML(r);
  detail.hidden = false;
}

// ---------------------------------------------------------------- イベント
function bind() {
  $("#palette").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tile]");
    if (b && !b.disabled) tapTile(Number(b.dataset.tile));
  });
  $("#hand").addEventListener("click", (e) => {
    const t = e.target.closest("[data-idx]");
    if (t) { state.agariIdx = Number(t.dataset.idx); return render(); }
    const m = e.target.closest("[data-meld]");
    if (m) { pushUndo(); state.melds.splice(Number(m.dataset.meld), 1); render(); }
  });
  $("#indicators").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    pushUndo();
    if (b.dataset.dora != null) state.dora.splice(Number(b.dataset.dora), 1);
    if (b.dataset.ura != null) state.ura.splice(Number(b.dataset.ura), 1);
    render();
  });
  $(".modes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || b.disabled) return;
    state.mode = b.dataset.mode;
    $("#mode-hint").classList.remove("warn");
    render();
  });
  $("#undo").addEventListener("click", undo);
  $("#clear").addEventListener("click", clearAll);

  $$(".conds .seg").forEach((seg) => seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const key = seg.dataset.key;
    state[key] = key === "tsumo" ? b.dataset.v === "true" : Number(b.dataset.v);
    render();
  }));
  $$(".tog").forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    state[b.dataset.key] = !state[b.dataset.key];
    render();
  }));
  $$(".stepper").forEach((s) => s.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const key = s.dataset.key;
    state[key] = Math.max(0, Math.min(Number(s.dataset.max), state[key] + Number(b.dataset.d)));
    render();
  }));

  // タブ
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
    for (const name of ["calc", "quiz", "rules"]) $(`#tab-${name}`).hidden = name !== b.dataset.tab;
    if (b.dataset.tab === "quiz") quiz.ensure();
    window.scrollTo(0, 0);
  }));

  // ルール
  $$("[data-rule]").forEach((cb) => {
    cb.checked = !!rules[cb.dataset.rule];
    cb.addEventListener("change", () => { rules[cb.dataset.rule] = cb.checked; saveRules(); });
  });
  const seg = $("[data-rule-seg]");
  const paintSeg = () => $$("button", seg).forEach((b) => b.setAttribute("aria-pressed", String(rules[seg.dataset.ruleSeg]) === b.dataset.v));
  paintSeg();
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    rules[seg.dataset.ruleSeg] = Number(b.dataset.v);
    paintSeg();
    saveRules();
  });
}

function saveRules() {
  store.set("mj.rules", rules);
  render();
}

const quiz = initQuiz({ getRules, store });
buildPalette();
bind();
render();
