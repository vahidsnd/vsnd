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
  kage: { fa: ['موج شمشیر', 'یورش نیش', 'برش ماه', 'زوزه'], en: ['Blade Wave', 'Fang Rush', 'Moonrise Slash', 'Howl'] },
  sirocco: { fa: ['تف زهر', 'نیش کژدم', 'جهش دُم', 'تله شنی'], en: ['Venom Spit', 'Stinger Lunge', 'Tail Vault', 'Sand Trap'] },
  rime: { fa: ['نیزه یخ', 'دیوار یخی', 'صعود یخبندان', 'دفع یخ'], en: ['Frost Lance', 'Glacier Wall', 'Frost Ascent', 'Frost Parry'] },
  nyx: { fa: ['تیر سایه', 'شهاب تاریک', 'گام سایه', 'کسوف'], en: ['Shadow Bolt', 'Dark Comet', 'Shade Step', 'Eclipse'] },
  rivet: { fa: ['مشت موشکی', 'یورش مته', 'جت', 'رگبار موشک'], en: ['Rocket Fist', 'Drill Dash', 'Jet Boost', 'Missile Volley'] },
  azhi: { fa: ['افعی', 'شلاق دُم', 'فنر حلقه', 'پوست‌اندازی'], en: ['Viper', 'Tail Lash', 'Coil Spring', 'Shed Skin'] },
  ursa: { fa: ['موج کف دست', 'صد ضربه', 'نیلوفر صعودی', 'ایستادن کوه'], en: ['Palm Wave', 'Hundred Palms', 'Rising Lotus', 'Mountain Stance'] },
  sigrun: { fa: ['نیزه تندر', 'پیچش باد', 'صعود والکیری', 'فراخوان صاعقه'], en: ['Thunder Spear', 'Gale Spiral', 'Valkyrie Ascent', 'Lightning Call'] },
  azar: { fa: ['گدازه', 'مشت آتشفشان', 'فوران', 'ستون آتش'], en: ['Magma Glob', 'Eruption Fist', 'Volcanic Rise', 'Fire Pillar'] },
  corvin: { fa: ['شلیک سریع', 'ساچمه', 'پرواز کلاغ', 'کمانه'], en: ['Quickdraw', 'Buckshot', 'Murder Flight', 'Ricochet'] },
  onyx: { fa: ['دیسک چنگال', 'جهش پلنگ', 'چنگ صعودی', 'ضربه فازی'], en: ['Claw Disc', 'Pounce', 'Neon Rake', 'Phase Strike'] },
  kavir: { fa: ['موج تلماسه', 'گردباد شن', 'فواره', 'لرزه'], en: ['Dune Wave', 'Sand Cyclone', 'Geyser', 'Tremor'] },
  riptide: { fa: ['حباب انفجاری', 'اژدر', 'فواره آب', 'آرواره'], en: ['Bubble Burst', 'Torpedo', 'Waterspout', 'Jaws'] },
  mira: { fa: ['شعله سرگردان', 'چرخش فانوس', 'پرواز جارو', 'فانوس ارواح'], en: ['Will-o\'-Wisp', 'Lantern Swing', 'Broom Flight', 'Soul Lantern'] },
};
const KEYS = ['B', '→ B', '↑ B', '↓ B'];

export function specialsList(charId: string) {
  const m = MOVES[charId] ?? MOVES.blaze;
  return h('div', { class: 'movelist' }, (isFa() ? m.fa : m.en).flatMap((name, i) => [h('b', { dir: 'ltr' }, KEYS[i]), h('span', {}, name)]));
}

/** The universal move set, same for every fighter. */
export function basicsList() {
  const rows = isFa()
    ? [['A', 'ضربه سریع'], ['جهت + A', 'ضربه جهت‌دار'], ['اسمش (+ جهت)', 'ضربه قدرتی، قابل شارژ'], ['A در هوا', 'حمله هوایی (۵ نوع)'], ['سپر', 'دفاع؛ با جهت = غلت'], ['گرفتن', 'گرفتن + جهت = پرتاب'], ['↑ + B', 'برگشت به صحنه'], ['جادو (E)', 'وقتی نوار جادو پر شد']]
    : [['A', 'Quick attack'], ['Dir + A', 'Tilt attack'], ['Smash (+ dir)', 'Strong attack, chargeable'], ['A in air', 'Aerials (5 kinds)'], ['Shield', 'Block; + direction = roll'], ['Grab', 'Grab + direction = throw'], ['↑ + B', 'Recovery'], ['Magic (E)', 'When the magic meter is full']];
  return h('div', { class: 'movelist' }, rows.flatMap(([k, v]) => [h('b', {}, k), h('span', {}, v)]));
}
