// 牌・結果の HTML 描画（計算画面とクイズで共用）
import { suitOf, HONOR_NAMES, WIND_NAMES } from "./tiles.js";

const KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 牌1枚。opts: {cls, attrs, sideways} */
export function tileHTML(id, opts = {}) {
  const s = suitOf(id);
  let face;
  if (s === 0) face = `<b class="n">${KANJI[id % 9]}</b><i class="u man">萬</i>`;
  else if (s === 1) face = `<b class="n pin">${CIRCLED[id % 9]}</b>`;
  else if (s === 2) face = `<b class="n sou">${(id % 9) + 1}</b><i class="u sou">索</i>`;
  else if (id === 31) face = `<span class="haku"></span>`;
  else face = `<b class="n h h${id}">${HONOR_NAMES[id - 27]}</b>`;
  const cls = ["tile", opts.cls || ""].join(" ").trim();
  return `<span class="${cls}" ${opts.attrs || ""} aria-label="${tileLabel(id)}">${face}</span>`;
}

export function tileLabel(id) {
  if (id >= 27) return HONOR_NAMES[id - 27];
  return `${(id % 9) + 1}${["萬", "筒", "索"][suitOf(id)]}`;
}

const MELD_LABEL = { chi: "チー", pon: "ポン", minkan: "明槓", ankan: "暗槓" };

/** 副露1つ。暗槓は両端を伏せる */
export function meldHTML(m, attrs = "") {
  const ids = m.tiles.map((t) => t.id).sort((a, b) => a - b);
  const tiles = ids.map((id, i) =>
    m.type === "ankan" && (i === 0 || i === 3) ? `<span class="tile back"></span>` : tileHTML(id),
  ).join("");
  return `<span class="meld" ${attrs}><span class="meld-tiles">${tiles}</span><small>${MELD_LABEL[m.type]}</small></span>`;
}

/** 結果の詳細（役・符・支払い） */
export function resultDetailHTML(r) {
  const yakuRows = r.yakuman.length
    ? r.yakuman.map((y) => `<li><span>${esc(y.name)}</span><b>${y.mult > 1 ? "ダブル役満" : "役満"}</b></li>`)
    : r.yaku.map((y) => `<li class="${y.dora ? "dora" : ""}"><span>${esc(y.name)}</span><b>${y.han}翻</b></li>`);

  const fuBlock = r.yakuman.length ? "" : `
    <h4>符の内訳 <small>${r.rawFu && r.rawFu !== r.fu ? `${r.rawFu}符 → 切り上げ` : ""} ${r.fu}符</small></h4>
    <ul class="fu">${r.fuDetail.map((f) => `<li><span>${esc(f.label)}</span><b>${f.fu}符</b></li>`).join("")}</ul>`;

  return `
    <h4>役</h4>
    <ul class="yaku">${yakuRows.join("")}</ul>
    ${fuBlock}
    <h4>支払い</h4>
    <p class="pay">${esc(paymentText(r))}</p>`;
}

export function paymentText(r) {
  if (!r.tsumo) return `放銃者が ${r.ron.toLocaleString("ja-JP")}点`;
  if (r.isOya) return `子が各 ${r.all.toLocaleString("ja-JP")}点（計 ${r.total.toLocaleString("ja-JP")}点）`;
  return `子が各 ${r.ko.toLocaleString("ja-JP")}点・親が ${r.oyaPay.toLocaleString("ja-JP")}点（計 ${r.total.toLocaleString("ja-JP")}点）`;
}

/** 「3翻40符」「満貫」など */
export function headline(r) {
  if (r.yakuman.length) return r.limitName;
  const hf = `${r.han}翻${r.fu}符`;
  return r.limitName ? `${hf} ${r.limitName}` : hf;
}

export const windName = (w) => WIND_NAMES[w];
