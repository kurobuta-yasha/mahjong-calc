// 点数計算クイズ：ランダムな和了形を作って 4択で点数を当てる
import { calculate, pointsFor } from "./engine.js";
import { WIND_NAMES } from "./tiles.js";
import { tileHTML, meldHTML, resultDetailHTML, headline, esc } from "./render.js";

const $ = (sel) => document.querySelector(sel);
const rand = (n) => Math.floor(Math.random() * n);
const chance = (p) => Math.random() < p;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** 和了形をランダムに作る。役がある・（設定により）満貫未満の手が出るまで引き直す */
export function generateQuestion(rules, { allowLimit = false } = {}) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const counts = new Array(34).fill(0);
    const take = (ids) => {
      if (ids.some((t) => counts[t] + ids.filter((x) => x === t).length > 4)) return false;
      ids.forEach((t) => counts[t]++);
      return true;
    };

    const groups = [];
    let bad = false;
    for (let g = 0; g < 4 && !bad; g++) {
      let ok = false;
      for (let k = 0; k < 20 && !ok; k++) {
        if (chance(0.68)) {
          const s = rand(3) * 9 + rand(7);
          const ids = [s, s + 1, s + 2];
          if (take(ids)) { groups.push({ kind: "seq", ids }); ok = true; }
        } else {
          const t = rand(34);
          const ids = [t, t, t];
          if (take(ids)) { groups.push({ kind: "trip", ids }); ok = true; }
        }
      }
      if (!ok) bad = true;
    }
    if (bad) continue;
    let pairTile;
    for (let k = 0; k < 20; k++) {
      const t = rand(34);
      if (take([t, t])) { pairTile = t; break; }
    }
    if (pairTile == null) continue;

    // 副露
    const nMelds = chance(0.35) ? 1 + rand(2) : 0;
    const melds = [];
    const closed = [pairTile, pairTile];
    groups.forEach((g, i) => {
      if (i < nMelds) {
        if (g.kind === "seq") melds.push({ type: "chi", tiles: g.ids.map((id) => ({ id, red: false })) });
        else if (counts[g.ids[0]] < 4 && chance(0.15)) {
          counts[g.ids[0]]++;
          melds.push({ type: "minkan", tiles: [...g.ids, g.ids[0]].map((id) => ({ id, red: false })) });
        } else melds.push({ type: "pon", tiles: g.ids.map((id) => ({ id, red: false })) });
      } else {
        closed.push(...g.ids);
      }
    });

    const agariPos = rand(closed.length);
    const agari = closed[agariPos];
    const hand = closed.filter((_, i) => i !== agariPos).map((id) => ({ id, red: false }));

    const open = melds.length > 0;
    const riichi = !open && chance(0.6) ? 1 : 0;
    const pickFree = () => {
      for (let k = 0; k < 50; k++) {
        const t = rand(34);
        if (counts[t] < 4) { counts[t]++; return t; }
      }
      return null;
    };
    const dora = [pickFree()].filter((x) => x != null);
    const ura = riichi ? [pickFree()].filter((x) => x != null) : [];
    const hasFive = [4, 13, 22].some((t) => counts[t] > 0);

    const input = {
      hand, agari: { id: agari, red: false }, melds,
      tsumo: chance(0.4),
      seatWind: rand(4),
      roundWind: chance(0.75) ? 0 : 1,
      riichi,
      ippatsu: riichi && chance(0.12),
      dora, ura,
      aka: hasFive && chance(0.25) ? 1 : 0,
      honba: 0,
    };
    const result = calculate(input, rules);
    if (!result.ok || result.yakuman.length) continue;
    if (!allowLimit && result.limitName) continue;
    if (allowLimit && !result.limitName && chance(0.3)) continue; // 満貫以上を少し多めに
    return { input, result };
  }
  throw new Error("問題を作れませんでした");
}

/** 正解＋紛らわしい3択 */
export function makeChoices(result, rules) {
  const opts = { oya: result.isOya, tsumo: result.tsumo, honba: 0 };
  const correct = result.text;
  const seen = new Set([correct]);
  const near = [];
  const push = (han, fu) => {
    if (han < 1 || fu < 20 || fu > 110) return;
    if (fu === 20 && (!result.tsumo || han < 2)) return; // 20符ロン・1翻20符は存在しない
    if (fu === 25 && han < 2) return;
    const p = pointsFor(han, fu, opts, rules);
    if (!seen.has(p.text)) { seen.add(p.text); near.push(p.text); }
  };
  if (result.limitName) {
    [[4, 30], [5, 30], [6, 30], [8, 30], [11, 30], [4, 40], [3, 70]].forEach(([h, f]) => push(h, f));
  } else {
    const { han, fu } = result;
    const fus = fu === 25 ? [25, 30, 50] : [fu - 10, fu + 10, fu + 20, fu - 20];
    fus.forEach((f) => push(han, f));
    [han - 1, han + 1].forEach((h) => [fu, fu + 10, fu - 10].forEach((f) => push(h, f)));
  }
  const distractors = shuffle(near.slice(0, 6)).slice(0, 3);
  return shuffle([correct, ...distractors]);
}

export function initQuiz({ getRules, store }) {
  let current = null;
  let answered = false;
  const stats = { n: 0, ok: 0, streak: 0, best: 0, ...store.get("mj.quiz", {}) };
  const limitBox = $("#q-limit");
  limitBox.checked = !!store.get("mj.quiz.limit", false);
  limitBox.addEventListener("change", () => store.set("mj.quiz.limit", limitBox.checked));

  function renderStats() {
    const rate = stats.n ? Math.round((stats.ok / stats.n) * 100) : 0;
    $("#quiz-score").innerHTML =
      `<span>正解 ${stats.ok}/${stats.n}（${rate}%）</span><span>連続 ${stats.streak}・最高 ${stats.best}</span>`;
  }

  function next() {
    const rules = getRules();
    current = generateQuestion(rules, { allowLimit: limitBox.checked });
    answered = false;
    const { input, result } = current;

    const chips = [
      `<span class="${input.seatWind === 0 ? "hot" : ""}">${input.seatWind === 0 ? "親" : "子"}（${WIND_NAMES[input.seatWind]}家）</span>`,
      `<span>${WIND_NAMES[input.roundWind]}場</span>`,
      `<span class="hot">${input.tsumo ? "ツモ" : "ロン"}</span>`,
      input.riichi ? `<span>立直</span>` : "",
      input.ippatsu ? `<span>一発</span>` : "",
      input.aka ? `<span>赤ドラ ${input.aka}</span>` : "",
    ];
    $("#q-conds").innerHTML = chips.join("");

    const rest = [...input.hand].sort((a, b) => a.id - b.id);
    $("#q-hand").innerHTML =
      rest.map((t) => tileHTML(t.id)).join("") +
      `<span class="gap"></span>${tileHTML(input.agari.id, { cls: "agari" })}` +
      input.melds.map((m) => meldHTML(m)).join("");

    const ind = (arr, label) => arr.length
      ? `<span class="ind-group">${label} ${arr.map((id) => tileHTML(id)).join("")}</span>` : "";
    $("#q-inds").innerHTML = ind(input.dora, "ドラ表示") + ind(input.ura, "裏ドラ表示");

    const choices = makeChoices(result, rules);
    $("#q-choices").innerHTML = choices.map((c) => `<button data-v="${esc(c)}">${esc(c)}</button>`).join("");
    $("#q-result").hidden = true;
    renderStats();
  }

  function answer(btn) {
    if (answered) return;
    answered = true;
    const { result } = current;
    const ok = btn.dataset.v === result.text;
    stats.n++;
    if (ok) { stats.ok++; stats.streak++; stats.best = Math.max(stats.best, stats.streak); }
    else stats.streak = 0;
    store.set("mj.quiz", stats);

    document.querySelectorAll("#q-choices button").forEach((b) => {
      b.disabled = true;
      if (b.dataset.v === result.text) b.classList.add("correct");
      else if (b === btn) b.classList.add("wrong");
    });
    const wait = result.waitName ? `（${result.waitName}待ち）` : "";
    $("#q-result").innerHTML = `
      <p class="verdict ${ok ? "ok" : "ng"}">${ok ? "正解！" : "ざんねん"}　${esc(result.text)}点</p>
      <p class="sub">${esc(headline(result))}${esc(wait)}</p>
      <div class="detail">${resultDetailHTML(result)}</div>
      <button class="primary q-next-inline" data-next>次の問題 →</button>`;
    $("#q-result").hidden = false;
    renderStats();
  }

  $("#q-choices").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) answer(b);
  });
  $("#q-next").addEventListener("click", next);
  $("#q-result").addEventListener("click", (e) => {
    if (e.target.closest("[data-next]")) { next(); window.scrollTo(0, 0); }
  });

  return {
    ensure() { if (!current) next(); },
  };
}
