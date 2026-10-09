import { RULE_PRESETS, type RuleMode } from '@nb/shared';
import { isFa } from '../i18n.ts';
import { h } from './dom.ts';
import { svg } from './icons.ts';

// Rule-set names / descriptions and the small "custom rules" picker used by the vs-CPU set-up
// and private rooms. Kept separate from modes.ts so play.ts doesn't pull in the mode screens.

type Lx = { fa: string; en: string };
export const RULE_INFO: Record<RuleMode, { icon: string; name: Lx; text: Lx }> = {
  lowgrav: { icon: 'sparkles', name: { fa: 'جاذبه کم', en: 'Low gravity' }, text: { fa: 'پرش‌ها بلند و شناورند و پرتاب‌ها دورتر می‌روند. مراقب لبه‌ها باش!', en: 'Floaty, high jumps and long launches. Mind the edges!' } },
  spells: { icon: 'wand', name: { fa: 'فقط جادو', en: 'Spells only' }, text: { fa: 'همه جادو دارند و نوار جادو چند ثانیه‌ای پر می‌شود. ضربه‌های معمولی نصف آسیب دارند — جادو بزن!', en: 'Everyone has a spell and the meter fills in seconds. Normal attacks deal half damage — cast!' } },
  giant: { icon: 'zap', name: { fa: 'حالت غول', en: 'Giant mode' }, text: { fa: 'همه مبارزها بزرگ‌تر و سنگین‌ترند؛ ضربه‌ها دورتر می‌رسند و پرت کردن سخت‌تر است.', en: 'Every fighter is bigger and heavier: longer reach, harder to launch.' } },
  stamina: { icon: 'heart', name: { fa: 'استقامت', en: 'Stamina' }, text: { fa: 'به‌جای درصد، هر زندگی ۱۵۰ جان دارد. با صفر شدن جان ناک‌اوت می‌شوی (بیرون افتادن هم ناک‌اوت است).', en: 'Instead of percent, each life has 150 HP. Reach zero and you are KO\'d (falling off still counts).' } },
  sudden: { icon: 'flame', name: { fa: 'مرگ ناگهانی', en: 'Sudden death' }, text: { fa: 'هر زندگی از ۳۰۰٪ شروع می‌شود. یک ضربه تمیز کافی است!', en: 'Every life starts at 300%. One clean hit is enough!' } },
  items: { icon: 'gift', name: { fa: 'جنون آیتم', en: 'Item frenzy' }, text: { fa: 'آیتم‌ها دو برابر می‌افتند.', en: 'Items drop twice as often.' } },
};
export const RULE_MODES = Object.keys(RULE_PRESETS) as RuleMode[];

/** Row of toggle buttons: classic + every preset. `onPick('')` = classic rules. */
export function rulesPicker(cur: RuleMode | '', onPick: (m: RuleMode | '') => void): HTMLElement {
  const fa = isFa();
  const btn = (m: RuleMode | '') => h('button', { class: `btn small ${cur === m ? 'primary' : ''}`, 'data-rule': m || 'classic', onclick: () => onPick(m) },
    m ? svg(RULE_INFO[m].icon, 14) : null, m ? (fa ? RULE_INFO[m].name.fa : RULE_INFO[m].name.en) : (fa ? 'کلاسیک' : 'Classic'));
  return h('div', { class: 'rule-pick' }, btn(''), ...RULE_MODES.map(btn));
}
