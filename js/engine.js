// 点数計算エンジン。UI には依存しない（node --test でそのまま動く）。
import {
  suitOf, isHonor, isWind, isDragon, isTerminal, isYaochu, isSimple,
  doraFromIndicator, toCounts, HONOR_NAMES, WIND_NAMES,
} from "./tiles.js";

export const DEFAULT_RULES = {
  kuitan: true,          // 喰いタン
  kiriage: true,         // 切り上げ満貫（4翻30符・3翻60符 → 満貫）
  kazoe: true,           // 数え役満（13翻以上 → 役満）
  doubleYakuman: false,  // 国士13面・四暗刻単騎・純正九蓮・大四喜をダブル役満にする
  renpuFu: 2,            // 連風牌の雀頭の符（2 or 4）
};

/**
 * @param {object} input
 *   hand:   [{id, red}]  和了牌を除いた門前の手牌
 *   agari:  {id, red}    和了牌
 *   melds:  [{type: "chi"|"pon"|"minkan"|"ankan", tiles: [{id, red}]}]
 *   tsumo, seatWind(0-3, 0=東=親), roundWind(0-3),
 *   riichi(0|1|2=ダブル), ippatsu, haitei, rinshan, chankan, tenchi(天和/地和),
 *   dora: [表示牌id], ura: [表示牌id], aka(赤ドラ枚数。省略時は red フラグから数える), honba
 * @returns {{ok:true, ...} | {ok:false, error:string}}
 */
export function calculate(input, rules = DEFAULT_RULES) {
  rules = { ...DEFAULT_RULES, ...rules };
  const melds = input.melds || [];
  const hand = input.hand || [];
  const agari = input.agari;

  const need = 13 - 3 * melds.length;
  if (!agari || hand.length !== need) {
    const have = hand.length + (agari ? 1 : 0);
    return { ok: false, error: `手牌があと${need + 1 - have}枚必要です`, incomplete: true };
  }
  for (const m of melds) {
    const err = validateMeld(m);
    if (err) return { ok: false, error: err };
  }

  const meldTiles = melds.flatMap((m) => m.tiles);
  const allPhysical = [...hand, agari, ...meldTiles];
  const physCounts = toCounts([
    ...allPhysical.map((t) => t.id),
    ...(input.dora || []),
    ...(input.ura || []),
  ]);
  const over = physCounts.findIndex((n) => n > 4);
  if (over >= 0) return { ok: false, error: "同じ牌が5枚以上あります" };
  for (const five of [4, 13, 22]) {
    if (allPhysical.filter((t) => t.id === five && t.red).length > 1) {
      return { ok: false, error: "赤5は各色1枚までです" };
    }
  }

  const closedIds = [...hand.map((t) => t.id), agari.id];
  const ctx = {
    rules,
    melds: melds.map(meldToGroup),
    menzen: melds.every((m) => m.type === "ankan"),
    noCalls: melds.length === 0,
    closedCounts: toCounts(closedIds),
    agari: agari.id,
    tsumo: !!input.tsumo,
    seat: input.seatWind ?? 0,
    round: input.roundWind ?? 0,
    riichi: input.riichi || 0,
    ippatsu: !!input.ippatsu,
    haitei: !!input.haitei,
    rinshan: !!input.rinshan,
    chankan: !!input.chankan,
    tenchi: !!input.tenchi,
    honba: input.honba || 0,
  };
  ctx.oya = ctx.seat === 0;
  // 役判定用：手牌に含まれる牌の種類（槓子は1種として数える）
  ctx.kinds = [...new Set([...closedIds, ...meldTiles.map((t) => t.id)])];

  // ドラ
  const allIds = allPhysical.map((t) => t.id);
  const countDora = (inds) => inds.reduce((s, ind) => {
    const d = doraFromIndicator(ind);
    return s + allIds.filter((t) => t === d).length;
  }, 0);
  ctx.doraCount = {
    dora: countDora(input.dora || []),
    aka: input.aka ?? allPhysical.filter((t) => t.red).length, // UI は枚数で渡す
    ura: ctx.riichi ? countDora(input.ura || []) : 0,
  };

  const candidates = [];
  const kokushi = evalKokushi(ctx);
  if (kokushi) candidates.push(kokushi);
  const chiitoi = evalChiitoi(ctx);
  if (chiitoi) candidates.push(chiitoi);
  for (const dec of decompose(ctx.closedCounts)) {
    for (const cand of agariPlacements(dec, ctx)) candidates.push(evalStandard(cand, ctx));
  }

  if (candidates.length === 0) return { ok: false, error: "和了の形になっていません" };

  const scored = candidates.map((c) => finalize(c, ctx));
  const valid = scored.filter((s) => s.ok);
  if (valid.length === 0) return { ok: false, error: "役がありません（ドラだけでは和了れません）", noYaku: true };
  valid.sort((a, b) => b.total - a.total || b.han - a.han || b.fu - a.fu);
  return valid[0];
}

function validateMeld(m) {
  const ids = m.tiles.map((t) => t.id);
  if (m.type === "chi") {
    const [a, b, c] = [...ids].sort((x, y) => x - y);
    if (ids.length !== 3 || isHonor(a) || suitOf(a) !== suitOf(c) || b !== a + 1 || c !== a + 2) {
      return "チーは同じ色の連続した3枚です";
    }
  } else {
    const n = m.type === "pon" ? 3 : 4;
    if (ids.length !== n || ids.some((t) => t !== ids[0])) return "ポン・カンは同じ牌です";
  }
  return null;
}

function meldToGroup(m) {
  const tile = Math.min(...m.tiles.map((t) => t.id));
  if (m.type === "chi") return { type: "seq", tile, open: true, concealed: false };
  if (m.type === "pon") return { type: "trip", tile, open: true, concealed: false };
  if (m.type === "minkan") return { type: "kan", tile, open: true, concealed: false };
  return { type: "kan", tile, open: false, concealed: true }; // ankan
}

// ---------------------------------------------------------------- 面子分解

/** 門前部分を 雀頭1 + 面子 に分解する全パターン */
export function decompose(counts) {
  const c = [...counts];
  const results = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    extract(c, 0, [], (sets) => results.push({ pair: p, sets: sets.map((s) => ({ ...s })) }));
    c[p] += 2;
  }
  return results;
}

function extract(c, i, acc, cb) {
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) return cb(acc);
  if (c[i] >= 3) {
    c[i] -= 3;
    acc.push({ type: "trip", tile: i });
    extract(c, i, acc, cb);
    acc.pop();
    c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    acc.push({ type: "seq", tile: i });
    extract(c, i, acc, cb);
    acc.pop();
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

/** 和了牌がどのブロックに入ったか（＝待ちの形）の全解釈 */
function agariPlacements(dec, ctx) {
  const a = ctx.agari;
  const out = [];
  const base = dec.sets.map((s) => ({ ...s, open: false, concealed: true }));
  const make = (wait, idx) => {
    const sets = base.map((s, i) => {
      // ロンで刻子が完成した場合は明刻扱い
      if (i === idx && s.type === "trip" && !ctx.tsumo) return { ...s, concealed: false };
      return s;
    });
    return { pair: dec.pair, sets: [...sets, ...ctx.melds], wait };
  };
  if (dec.pair === a) out.push(make("tanki", -1));
  base.forEach((s, i) => {
    if (s.type === "trip" && s.tile === a) out.push(make("shanpon", i));
    if (s.type === "seq" && a >= s.tile && a <= s.tile + 2) {
      let wait;
      if (a === s.tile + 1) wait = "kanchan";
      else if ((a === s.tile + 2 && s.tile % 9 === 0) || (a === s.tile && s.tile % 9 === 6)) wait = "penchan";
      else wait = "ryanmen";
      out.push(make(wait, i));
    }
  });
  return out;
}

// ---------------------------------------------------------------- 役判定

const WAIT_NAMES = { ryanmen: "両面", kanchan: "嵌張", penchan: "辺張", tanki: "単騎", shanpon: "双碰" };
const GREEN = new Set([19, 20, 21, 23, 25, 32]);

function commonYaku(ctx) {
  const y = [];
  if (ctx.menzen && ctx.riichi === 2) y.push(["ダブル立直", 2]);
  else if (ctx.menzen && ctx.riichi === 1) y.push(["立直", 1]);
  if (ctx.menzen && ctx.riichi && ctx.ippatsu) y.push(["一発", 1]);
  if (ctx.menzen && ctx.tsumo) y.push(["門前清自摸和", 1]);
  if (ctx.tsumo && ctx.rinshan) y.push(["嶺上開花", 1]);
  if (!ctx.tsumo && ctx.chankan) y.push(["槍槓", 1]);
  if (ctx.tsumo && ctx.haitei) y.push(["海底摸月", 1]);
  if (!ctx.tsumo && ctx.haitei) y.push(["河底撈魚", 1]);
  return y;
}

/** 形に依存しない役満（天和・地和・字一色・緑一色・清老頭・九蓮宝燈） */
function handYakuman(ctx) {
  const ym = [];
  if (ctx.tenchi && ctx.tsumo && ctx.noCalls) ym.push([ctx.oya ? "天和" : "地和", 1]);
  if (ctx.kinds.every(isHonor)) ym.push(["字一色", 1]);
  if (ctx.kinds.every((t) => GREEN.has(t))) ym.push(["緑一色", 1]);
  if (ctx.kinds.every(isTerminal)) ym.push(["清老頭", 1]);
  if (ctx.noCalls) {
    const c = ctx.closedCounts;
    const s = suitOf(ctx.agari);
    if (s < 3 && ctx.kinds.every((t) => suitOf(t) === s)) {
      const b = s * 9;
      const pattern = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      if (pattern.every((n, i) => c[b + i] >= n)) {
        const before = [...c];
        before[ctx.agari]--;
        const junsei = pattern.every((n, i) => before[b + i] === n);
        ym.push(junsei ? ["純正九蓮宝燈", ctx.rules.doubleYakuman ? 2 : 1] : ["九蓮宝燈", 1]);
      }
    }
  }
  return ym;
}

function suitYaku(ctx, menzen) {
  const suits = new Set(ctx.kinds.filter((t) => !isHonor(t)).map(suitOf));
  const hasHonor = ctx.kinds.some(isHonor);
  if (suits.size === 1 && !hasHonor) return [["清一色", menzen ? 6 : 5]];
  if (suits.size === 1 && hasHonor) return [["混一色", menzen ? 3 : 2]];
  return [];
}

function evalKokushi(ctx) {
  if (!ctx.noCalls) return null;
  const c = ctx.closedCounts;
  const yaochu = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  if (!yaochu.every((t) => c[t] >= 1) || yaochu.reduce((s, t) => s + c[t], 0) !== 14) return null;
  const before = [...c];
  before[ctx.agari]--;
  const thirteen = yaochu.every((t) => before[t] === 1);
  const ym = handYakuman(ctx).filter(([n]) => n === "天和" || n === "地和");
  ym.push(thirteen ? ["国士無双十三面待ち", ctx.rules.doubleYakuman ? 2 : 1] : ["国士無双", 1]);
  return { yakuman: ym, yaku: [], fu: 0, fuDetail: [], shape: "国士無双" };
}

function evalChiitoi(ctx) {
  if (!ctx.noCalls) return null;
  const c = ctx.closedCounts;
  if (c.filter((n) => n === 2).length !== 7) return null;
  const ym = handYakuman(ctx);
  if (ym.length) return { yakuman: ym, yaku: [], fu: 25, fuDetail: [["七対子", 25]], shape: "七対子" };
  const yaku = [...commonYaku(ctx), ["七対子", 2]];
  if (ctx.kinds.every(isSimple)) yaku.push(["断么九", 1]);
  if (ctx.kinds.every(isYaochu)) yaku.push(["混老頭", 2]);
  yaku.push(...suitYaku(ctx, true));
  return { yakuman: [], yaku, fu: 25, fuDetail: [["七対子", 25]], shape: "七対子" };
}

function isValuePair(t, ctx) {
  return isDragon(t) || t === 27 + ctx.seat || t === 27 + ctx.round;
}

function evalStandard({ pair, sets, wait }, ctx) {
  const menzen = ctx.menzen;
  const seqs = sets.filter((g) => g.type === "seq");
  const trips = sets.filter((g) => g.type !== "seq"); // 刻子＋槓子
  const kans = sets.filter((g) => g.type === "kan");
  const ankou = trips.filter((g) => g.concealed).length;
  const tripTiles = trips.map((g) => g.tile);
  const seqTiles = seqs.map((g) => g.tile);
  const shape = { pair, sets, wait };

  // --- 役満
  const ym = handYakuman(ctx);
  if (ankou === 4) ym.push(wait === "tanki" ? ["四暗刻単騎", ctx.rules.doubleYakuman ? 2 : 1] : ["四暗刻", 1]);
  if (tripTiles.filter(isDragon).length === 3) ym.push(["大三元", 1]);
  const windTrips = tripTiles.filter(isWind).length;
  if (windTrips === 4) ym.push(["大四喜", ctx.rules.doubleYakuman ? 2 : 1]);
  else if (windTrips === 3 && isWind(pair)) ym.push(["小四喜", 1]);
  if (kans.length === 4) ym.push(["四槓子", 1]);
  if (ym.length) return { yakuman: ym, yaku: [], fu: 0, fuDetail: [], shape };

  // --- 通常役
  const yaku = commonYaku(ctx);
  const pinfu = menzen && seqs.length === 4 && wait === "ryanmen" && !isValuePair(pair, ctx);
  if (pinfu) yaku.push(["平和", 1]);
  if (ctx.kinds.every(isSimple) && (menzen || ctx.rules.kuitan)) yaku.push(["断么九", 1]);

  if (menzen) {
    const cnt = {};
    seqTiles.forEach((t) => (cnt[t] = (cnt[t] || 0) + 1));
    const peko = Object.values(cnt).reduce((s, n) => s + Math.floor(n / 2), 0);
    if (peko === 2) yaku.push(["二盃口", 3]);
    else if (peko === 1) yaku.push(["一盃口", 1]);
  }

  for (const t of tripTiles) {
    if (isDragon(t)) yaku.push([`役牌 ${HONOR_NAMES[t - 27]}`, 1]);
    if (t === 27 + ctx.seat) yaku.push([`自風 ${WIND_NAMES[ctx.seat]}`, 1]);
    if (t === 27 + ctx.round) yaku.push([`場風 ${WIND_NAMES[ctx.round]}`, 1]);
  }

  for (let n = 0; n < 7; n++) {
    if (seqTiles.includes(n) && seqTiles.includes(9 + n) && seqTiles.includes(18 + n)) {
      yaku.push(["三色同順", menzen ? 2 : 1]);
      break;
    }
  }
  for (let s = 0; s < 3; s++) {
    const b = s * 9;
    if (seqTiles.includes(b) && seqTiles.includes(b + 3) && seqTiles.includes(b + 6)) {
      yaku.push(["一気通貫", menzen ? 2 : 1]);
      break;
    }
  }
  if (trips.length === 4) yaku.push(["対々和", 2]);
  if (ankou === 3) yaku.push(["三暗刻", 2]);
  for (let n = 0; n < 9; n++) {
    if (tripTiles.includes(n) && tripTiles.includes(9 + n) && tripTiles.includes(18 + n)) {
      yaku.push(["三色同刻", 2]);
      break;
    }
  }
  if (kans.length === 3) yaku.push(["三槓子", 2]);
  if (tripTiles.filter(isDragon).length === 2 && isDragon(pair)) yaku.push(["小三元", 2]);

  if (ctx.kinds.every(isYaochu)) {
    yaku.push(["混老頭", 2]);
  } else if (seqs.length > 0) {
    const groupHasYaochu = (g) =>
      g.type === "seq" ? g.tile % 9 === 0 || g.tile % 9 === 6 : isYaochu(g.tile);
    if (sets.every(groupHasYaochu) && isYaochu(pair)) {
      if (ctx.kinds.some(isHonor)) yaku.push(["混全帯么九", menzen ? 2 : 1]);
      else yaku.push(["純全帯么九", menzen ? 3 : 2]);
    }
  }
  yaku.push(...suitYaku(ctx, menzen));

  // --- 符
  const fuDetail = [];
  let fu;
  if (pinfu && ctx.tsumo) {
    fu = 20;
    fuDetail.push(["平和ツモ", 20]);
  } else if (pinfu) {
    fu = 30;
    fuDetail.push(["副底", 20], ["門前ロン", 10]);
  } else {
    fu = 20;
    fuDetail.push(["副底", 20]);
    if (menzen && !ctx.tsumo) { fu += 10; fuDetail.push(["門前ロン", 10]); }
    if (ctx.tsumo) { fu += 2; fuDetail.push(["ツモ", 2]); }
    for (const g of trips) {
      let f = 2;
      if (isYaochu(g.tile)) f *= 2;
      if (g.concealed) f *= 2;
      if (g.type === "kan") f *= 4;
      const kind = (g.type === "kan" ? (g.concealed ? "暗槓" : "明槓") : g.concealed ? "暗刻" : "明刻");
      fu += f;
      fuDetail.push([`${kind}（${shortName(g.tile)}）`, f]);
    }
    const pf = pairFu(pair, ctx);
    if (pf) { fu += pf; fuDetail.push([`役牌の雀頭（${shortName(pair)}）`, pf]); }
    if (wait === "kanchan" || wait === "penchan" || wait === "tanki") {
      fu += 2;
      fuDetail.push([`${WAIT_NAMES[wait]}待ち`, 2]);
    }
    if (!menzen && fu === 20) {
      fu = 30;
      fuDetail.push(["鳴き平和形の最低符", 10]);
    }
  }
  const raw = fu;
  fu = Math.ceil(fu / 10) * 10;
  return { yakuman: [], yaku, fu, rawFu: raw, fuDetail, shape, waitName: WAIT_NAMES[wait] };
}

function pairFu(t, ctx) {
  if (isDragon(t)) return 2;
  const seat = t === 27 + ctx.seat;
  const round = t === 27 + ctx.round;
  if (seat && round) return ctx.rules.renpuFu;
  return seat || round ? 2 : 0;
}

function shortName(t) {
  if (t >= 27) return HONOR_NAMES[t - 27];
  return `${(t % 9) + 1}${["萬", "筒", "索"][suitOf(t)]}`;
}

// ---------------------------------------------------------------- 点数

const ceil100 = (x) => Math.ceil(x / 100) * 100;

function finalize(cand, ctx) {
  const { rules } = ctx;
  let han = 0;
  let base;
  let limitName = null;
  let yaku = cand.yaku.map(([name, h]) => ({ name, han: h }));
  let yakuman = cand.yakuman.map(([name, mult]) => ({ name, mult }));

  if (yakuman.length) {
    const mult = yakuman.reduce((s, y) => s + y.mult, 0);
    base = 8000 * mult;
    limitName = ["", "役満", "ダブル役満", "トリプル役満"][mult] || `${mult}倍役満`;
  } else {
    if (yaku.length === 0) return { ok: false };
    const { dora, aka, ura } = ctx.doraCount;
    if (dora) yaku.push({ name: "ドラ", han: dora, dora: true });
    if (aka) yaku.push({ name: "赤ドラ", han: aka, dora: true });
    if (ura) yaku.push({ name: "裏ドラ", han: ura, dora: true });
    han = yaku.reduce((s, y) => s + y.han, 0);
    const fu = cand.fu;
    if (han >= 13 && rules.kazoe) { base = 8000; limitName = "数え役満"; }
    else if (han >= 11) { base = 6000; limitName = "三倍満"; }
    else if (han >= 8) { base = 4000; limitName = "倍満"; }
    else if (han >= 6) { base = 3000; limitName = "跳満"; }
    else if (han >= 5) { base = 2000; limitName = "満貫"; }
    else {
      base = fu * 2 ** (han + 2);
      if (base >= 2000) { base = 2000; limitName = "満貫"; }
      else if (rules.kiriage && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) {
        base = 2000; limitName = "切り上げ満貫";
      }
    }
  }

  const h = ctx.honba;
  let points;
  if (!ctx.tsumo) {
    const ron = ceil100(base * (ctx.oya ? 6 : 4)) + h * 300;
    points = { ron, total: ron, text: ron.toLocaleString("ja-JP") };
  } else if (ctx.oya) {
    const all = ceil100(base * 2) + h * 100;
    points = { all, total: all * 3, text: `${all.toLocaleString("ja-JP")}オール` };
  } else {
    const ko = ceil100(base) + h * 100;
    const oyaPay = ceil100(base * 2) + h * 100;
    points = { ko, oyaPay, total: ko * 2 + oyaPay, text: `${ko.toLocaleString("ja-JP")} / ${oyaPay.toLocaleString("ja-JP")}` };
  }

  return {
    ok: true,
    han,
    fu: yakuman.length ? 0 : cand.fu,
    rawFu: cand.rawFu,
    yaku,
    yakuman,
    fuDetail: cand.fuDetail.map(([label, f]) => ({ label, fu: f })),
    limitName,
    shape: cand.shape,
    waitName: cand.waitName,
    isOya: ctx.oya,
    tsumo: ctx.tsumo,
    ...points,
  };
}

/** 翻・符から点数だけ出す（クイズの選択肢づくり用） */
export function pointsFor(han, fu, { oya, tsumo, honba = 0 }, rules = DEFAULT_RULES) {
  const fake = {
    yaku: [["x", han]], yakuman: [], fu, fuDetail: [], shape: null,
  };
  const ctx = {
    rules: { ...DEFAULT_RULES, ...rules }, honba, oya, tsumo,
    doraCount: { dora: 0, aka: 0, ura: 0 },
  };
  return finalize(fake, ctx);
}
