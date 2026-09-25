import { test } from "node:test";
import assert from "node:assert/strict";
import { pointsFor } from "../js/engine.js";

// 一般的な点数早見表（切り上げ満貫なし）との照合
const noKiri = { kiriage: false };
const cases = [
  // [翻, 符, 親?, ツモ?, 期待値]
  [1, 30, false, false, "1,000"], [2, 30, false, false, "2,000"], [3, 30, false, false, "3,900"],
  [4, 30, false, false, "7,700"], [1, 40, false, false, "1,300"], [2, 40, false, false, "2,600"],
  [3, 40, false, false, "5,200"], [2, 25, false, false, "1,600"], [3, 25, false, false, "3,200"],
  [1, 110, false, false, "3,600"], [3, 70, false, false, "8,000"], [1, 50, false, false, "1,600"],
  [1, 30, true, false, "1,500"], [2, 30, true, false, "2,900"], [3, 30, true, false, "5,800"],
  [4, 30, true, false, "11,600"], [2, 40, true, false, "3,900"], [2, 25, true, false, "2,400"],
  [1, 30, false, true, "300 / 500"], [2, 20, false, true, "400 / 700"], [3, 20, false, true, "700 / 1,300"],
  [4, 20, false, true, "1,300 / 2,600"], [2, 25, false, true, "400 / 800"], [3, 40, false, true, "1,300 / 2,600"],
  [1, 30, true, true, "500オール"], [2, 20, true, true, "700オール"], [4, 30, true, true, "3,900オール"],
  [5, 30, false, false, "8,000"], [6, 30, false, false, "12,000"], [8, 30, true, false, "24,000"],
  [11, 30, false, true, "6,000 / 12,000"], [13, 30, false, false, "32,000"],
];
for (const [han, fu, oya, tsumo, want] of cases) {
  test(`${oya ? "親" : "子"}${tsumo ? "ツモ" : "ロン"} ${han}翻${fu}符 = ${want}`, () => {
    assert.equal(pointsFor(han, fu, { oya, tsumo }, noKiri).text, want);
  });
}

test("切り上げ満貫あり: 子ロン4翻30符=8000, 3翻60符=8000, 親ツモ4翻30符=4000オール", () => {
  assert.equal(pointsFor(4, 30, { oya: false, tsumo: false }).text, "8,000");
  assert.equal(pointsFor(3, 60, { oya: false, tsumo: false }).text, "8,000");
  assert.equal(pointsFor(4, 30, { oya: true, tsumo: true }).text, "4,000オール");
});
