import { isFa } from '../i18n.ts';
import { h } from './dom.ts';

/** Per-fighter special moves (shown on the fighters screen and in the pause menu). */
export const MOVES: Record<string, { fa: string[]; en: string[] }> = {
  blaze: { fa: ['گلوله آتش', 'یورش شعله', 'آپرکات آتشین', 'کوبش هوایی'], en: ['Fireball', 'Flame Dash', 'Rising Flame', 'Meteor Drop'] },
  boulder: { fa: ['پرتاب سنگ', 'شانه‌زنی زره‌دار', 'پرش موشکی', 'زمین‌لرزه'], en: ['Rock Toss', 'Armored Charge', 'Rocket Hop', 'Quake Stomp'] },
  zephyr: { fa: ['تندباد', 'پر تیز', 'اوج‌گیری', 'گردباد'], en: ['Gust', 'Feather Dart', 'Updraft', 'Tornado Spin'] },
  volt: { fa: ['گوی برقی', 'جهش صاعقه', 'تله‌پورت', 'میدان مغناطیسی'], en: ['Spark Orb', 'Zap Dash', 'Teleport', 'Magnet Burst'] },
  kira: { fa: ['شوریکن', 'ضربه پرشی', 'برش صعودی', 'ضدحمله'], en: ['Shuriken', 'Lunge', 'Rising Slash', 'Counter'] },
  pip: { fa: ['بمب', 'غلت‌زدن', 'بادکنک', 'مین'], en: ['Bomb', 'Roll Out', 'Balloon', 'Mine'] },
};
const KEYS = ['B', '→ B', '↑ B', '↓ B'];

export function specialsList(charId: string) {
  const m = MOVES[charId] ?? MOVES.blaze;
  return h('div', { class: 'movelist' }, (isFa() ? m.fa : m.en).flatMap((name, i) => [h('b', { dir: 'ltr' }, KEYS[i]), h('span', {}, name)]));
}

/** The universal move set, same for every fighter. */
export function basicsList() {
  const rows = isFa()
    ? [['A', 'ضربه سریع'], ['جهت + A', 'ضربه جهت‌دار'], ['اسمش (+ جهت)', 'ضربه قدرتی، قابل شارژ'], ['A در هوا', 'حمله هوایی (۵ نوع)'], ['سپر', 'دفاع؛ با جهت = غلت'], ['گرفتن', 'گرفتن + جهت = پرتاب'], ['↑ + B', 'برگشت به صحنه']]
    : [['A', 'Quick attack'], ['Dir + A', 'Tilt attack'], ['Smash (+ dir)', 'Strong attack, chargeable'], ['A in air', 'Aerials (5 kinds)'], ['Shield', 'Block; + direction = roll'], ['Grab', 'Grab + direction = throw'], ['↑ + B', 'Recovery']];
  return h('div', { class: 'movelist' }, rows.flatMap(([k, v]) => [h('b', {}, k), h('span', {}, v)]));
}
