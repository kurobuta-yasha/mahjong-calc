// 牌は 0..33 の整数で表す。
//   0- 8: 萬子 1-9 / 9-17: 筒子 1-9 / 18-26: 索子 1-9
//   27-30: 東南西北 / 31-33: 白發中
// 赤5は同じ番号で、別途 red フラグ（または赤の枚数）で持つ。

export const HONOR_NAMES = ["東", "南", "西", "北", "白", "發", "中"];
export const WIND_NAMES = ["東", "南", "西", "北"];
const SUIT_CHARS = ["m", "p", "s", "z"];
const KANJI_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

export const suitOf = (t) => Math.floor(t / 9); // 0萬 1筒 2索 3字
export const numOf = (t) => (t % 9) + 1;
export const isHonor = (t) => t >= 27;
export const isWind = (t) => t >= 27 && t <= 30;
export const isDragon = (t) => t >= 31;
export const isTerminal = (t) => t < 27 && (t % 9 === 0 || t % 9 === 8);
export const isYaochu = (t) => isHonor(t) || isTerminal(t);
export const isSimple = (t) => !isYaochu(t);

/** ドラ表示牌 → ドラ */
export function doraFromIndicator(t) {
  if (t < 27) return t % 9 === 8 ? t - 8 : t + 1;
  if (t <= 30) return t === 30 ? 27 : t + 1;
  return t === 33 ? 31 : t + 1;
}

/** 牌の表示名（"五萬" "東" など） */
export function tileName(t, red = false) {
  if (t >= 27) return HONOR_NAMES[t - 27];
  const s = ["萬", "筒", "索"][suitOf(t)];
  return (red ? "赤" : "") + KANJI_NUM[t % 9] + s;
}

/**
 * "123m406p789s11z" 形式 → [{id, red}]。0 は赤5。テストやクイズで使う。
 */
export function parseTiles(str) {
  const out = [];
  let digits = [];
  for (const ch of str.replace(/\s+/g, "")) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
    } else {
      const s = SUIT_CHARS.indexOf(ch);
      if (s < 0) throw new Error("bad tile string: " + str);
      for (const d of digits) {
        const n = Number(d);
        const red = n === 0;
        out.push({ id: s * 9 + (red ? 5 : n) - 1, red });
      }
      digits = [];
    }
  }
  if (digits.length) throw new Error("suit missing: " + str);
  return out;
}

export function toCounts(ids) {
  const c = new Array(34).fill(0);
  for (const t of ids) c[t]++;
  return c;
}
