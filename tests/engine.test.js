import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, DEFAULT_RULES } from "../js/engine.js";
import { parseTiles } from "../js/tiles.js";

// hand: 和了牌以外の門前手牌, agari: 和了牌, melds: [["pon","777z"], ...]
function calc(hand, agari, opts = {}, rules = {}) {
  const melds = (opts.melds || []).map(([type, s]) => ({ type, tiles: parseTiles(s) }));
  return calculate(
    {
      hand: parseTiles(hand),
      agari: parseTiles(agari)[0],
      seatWind: 1,
      roundWind: 0,
      ...opts,
      melds,
      dora: opts.dora ? parseTiles(opts.dora).map((t) => t.id) : [],
      ura: opts.ura ? parseTiles(opts.ura).map((t) => t.id) : [],
    },
    { ...DEFAULT_RULES, ...rules },
  );
}
const names = (r) => [...r.yaku.map((y) => y.name), ...r.yakuman.map((y) => y.name)];

test("平和ロン 子 1翻30符 1000点", () => {
  const r = calc("23m456m234p678s99p", "4m");
  assert.equal(r.ok, true);
  assert.deepEqual(names(r), ["平和"]);
  assert.equal(r.fu, 30);
  assert.equal(r.ron, 1000);
});

test("立直平和ツモ 子 3翻20符 700/1300", () => {
  const r = calc("23m456m234p678s99p", "4m", { tsumo: true, riichi: 1 });
  assert.deepEqual(names(r).sort(), ["門前清自摸和", "立直", "平和"].sort());
  assert.equal(r.fu, 20);
  assert.equal(r.ko, 700);
  assert.equal(r.oyaPay, 1300);
});

test("リーチタンヤオ平和ドラ2 = 満貫 8000", () => {
  const r = calc("23m456m234p678s88p", "4m", { riichi: 1, dora: "1m7s" });
  assert.equal(r.han, 5);
  assert.equal(r.limitName, "満貫");
  assert.equal(r.ron, 8000);
});

test("4翻30符 切り上げなし7700 / ありで8000", () => {
  // 立直・平和・タンヤオ・ドラ1 = 4翻30符
  const opts = { riichi: 1, dora: "1m" };
  assert.equal(calc("23m456m234p678s88p", "4m", opts, { kiriage: false }).ron, 7700);
  assert.equal(calc("23m456m234p678s88p", "4m", opts, { kiriage: true }).ron, 8000);
});

test("七対子 立直ロン 3翻25符 3200", () => {
  const r = calc("1133m5577p22s33z4z", "4z", { riichi: 1 });
  assert.equal(r.fu, 25);
  assert.equal(r.han, 3);
  assert.equal(r.ron, 3200);
});

test("中ポン 場風単騎 1翻30符（28符切り上げ）", () => {
  const r = calc("123m456p789s1z", "1z", { melds: [["pon", "777z"]] });
  assert.deepEqual(names(r), ["役牌 中"]);
  assert.equal(r.rawFu, 28);
  assert.equal(r.fu, 30);
  assert.equal(r.ron, 1000);
});

test("親ロン 2翻40符 3900", () => {
  // 111m暗刻(8) + 嵌張(2) + 門前ロン(10) + 副底(20) = 40符、立直+ドラ1
  const r = calc("111m35p456s789s22z", "4p", { seatWind: 0, riichi: 1, dora: "8s" });
  assert.equal(r.fu, 40);
  assert.equal(r.han, 2);
  assert.equal(r.ron, 3900);
});

test("本場は1本300点", () => {
  const r = calc("23m456m234p678s99p", "4m", { honba: 2 });
  assert.equal(r.ron, 1600);
});

test("鳴いて役なしはエラー", () => {
  const r = calc("23m456m678s99p", "4m", { melds: [["chi", "234p"]], dora: "3m" });
  assert.equal(r.ok, false);
  assert.equal(r.noYaku, true);
});

test("喰いタン なしルールだと役なし", () => {
  const hand = ["23m456m678s88p", "4m", { melds: [["chi", "234p"]] }];
  assert.equal(calc(...hand).ok, true);
  assert.equal(calc(...hand, { kuitan: false }).ok, false);
});

test("国士無双 / 十三面（ダブル役満設定）", () => {
  assert.equal(calc("19m19p19s1234567z", "1m").ron, 32000);
  const single = calc("119m19p19s123456z", "7z", {}, { doubleYakuman: true });
  assert.equal(single.yakuman[0].name, "国士無双");
  assert.equal(single.ron, 32000);
  const thirteen = calc("19m19p19s1234567z", "1m", {}, { doubleYakuman: true });
  assert.equal(thirteen.yakuman[0].name, "国士無双十三面待ち");
  assert.equal(thirteen.ron, 64000);
});

test("四暗刻ツモは役満、シャンポンロンは三暗刻対々", () => {
  const tsumo = calc("111m333p555s77z22z", "7z", { tsumo: true });
  assert.equal(tsumo.limitName, "役満");
  assert.equal(tsumo.ko, 8000);
  assert.equal(tsumo.oyaPay, 16000);
  const ron = calc("111m333p555s77z22z", "7z");
  assert.ok(names(ron).includes("三暗刻"));
  assert.ok(names(ron).includes("対々和"));
});

test("純正九蓮宝燈", () => {
  const r = calc("1112345678999m", "5m", {}, { doubleYakuman: true });
  assert.equal(r.yakuman[0].name, "純正九蓮宝燈");
  assert.equal(r.ron, 64000);
});

test("小三元 / 大三元", () => {
  const s = calc("555z66z123m45p", "6p", { melds: [["pon", "777z"]] });
  assert.ok(names(s).includes("小三元"));
  const d = calc("666z777z12m99p", "3m", { melds: [["pon", "555z"]] });
  assert.equal(d.yakuman[0].name, "大三元");
});

test("一気通貫・混一色・役牌の複合（鳴き）", () => {
  const r = calc("123456789m1z", "1z", { melds: [["pon", "555z"]] });
  const n = names(r);
  assert.ok(n.includes("一気通貫"));
  assert.ok(n.includes("混一色"));
  assert.ok(n.includes("役牌 白"));
  assert.equal(r.han, 1 + 2 + 1); // 喰い下がり: 一通1 混一2 白1
});

test("立直平和一盃口", () => {
  const r = calc("12233m456p789s55s", "1m", { riichi: 1 });
  assert.deepEqual(names(r).sort(), ["一盃口", "平和", "立直"].sort());
});

test("高い方の解釈が選ばれる（単騎 vs 両面）", () => {
  // 4566m に 6m：456+66（両面→平和）とも 456+66単騎 ともとれる
  const r = calc("4566m234p567s789s", "6m", { riichi: 1 });
  assert.ok(names(r).includes("平和"));
  assert.equal(r.ron, 2000);
});

test("辺張は平和にならない", () => {
  const r = calc("11223m456p789s55s", "3m", { riichi: 1 });
  assert.ok(!names(r).includes("平和"));
  assert.ok(names(r).includes("一盃口"));
  assert.equal(r.waitName, "辺張");
});

test("純全帯么九 と 三色同順", () => {
  const r = calc("123m123p123s789m9p", "9p");
  const n = names(r);
  assert.ok(n.includes("純全帯么九"));
  assert.ok(n.includes("三色同順"));
});

test("手牌が足りなければ incomplete", () => {
  const r = calculate({ hand: parseTiles("123m"), agari: null, melds: [] });
  assert.equal(r.ok, false);
  assert.equal(r.incomplete, true);
});

test("5枚目はエラー", () => {
  const r = calc("1111m23m456p789s1z", "1m");
  assert.equal(r.ok, false);
});

test("連風牌の雀頭 2符/4符", () => {
  // 東場の親（東）、東単騎。明刻なし・ロン。
  const base = ["234m567p345s678s1z", "1z", { seatWind: 0, riichi: 1 }];
  const two = calc(...base, { renpuFu: 2 });
  const four = calc(...base, { renpuFu: 4 });
  assert.equal(two.rawFu, 20 + 10 + 2 + 2);
  assert.equal(four.rawFu, 20 + 10 + 4 + 2);
});
