import {
  ACHIEVEMENTS, COSMETICS, EMOTE_SLOTS, FIGHTERS, MASTERY_MAX, TIERS, cosOwned, emoteByNet, emoteLoadout, equippedFrame, equippedTitle, getCosmetic,
  getFighter, masteryInfo, masteryReward, poseFor, titleText,
  type CosKind, type Cosmetic, type CosSource, type Reward,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { liveops } from '../services/liveops.ts';
import { net } from '../net/net.ts';
import { PLAYER_COLORS } from '../game/art.ts';
import { poseCanvas } from '../game/poses.ts';
import { audio } from '../game/audio.ts';
import { isFa, num, loc } from '../i18n.ts';
import { h, show, topBar, fighterCanvas, modal, toast, rewardReveal, grantedToItems, icon, confirmBox, type Child, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { homeScreen } from './home.ts';
import './liveops.css';

// =============================================================================================
//  Cosmetics UI: collection screen (emotes, frames, titles, victory poses), frame rings,
//  titles, the in-match emote bar and fighter mastery panels.
// =============================================================================================

const tr = (fa: string, en: string) => (isFa() ? fa : en);
const L = (fa: string, en: string) => ({ fa, en });
const cname = (c: Cosmetic) => (isFa() ? c.nameFa : c.name);

// ---- frames & titles -------------------------------------------------------------------------
/** Wraps an avatar in the given profile frame (no-op ring when none). */
export function frameRing(frameId: string | undefined, child: Child, cls = '') {
  const f = frameId ? getCosmetic('frame', frameId) : undefined;
  return h('span', {
    class: `pframe ${f ? 'on' : ''} ${f ? 'pf-' + frameId!.replace(':', '-') : ''} ${frameId === 'vip' ? 'vip' : ''} ${cls}`,
    style: f ? { '--f1': f.c1, '--f2': f.c2 } : undefined,
  }, child);
}
export function myFrame() { return equippedFrame(backend.profile); }
export function titleTag(id: string | undefined, cls = '') {
  const txt = titleText(id, isFa());
  return txt ? h('span', { class: `ptitle ${cls}` }, txt) : null;
}
export function vipBadge() { return h('span', { class: 'vip-badge' }, 'VIP'); }

// ---- reward chips (pass tiers, achievements, weekly podium, match results) ------------------------
const KIND_ICON: Record<CosKind, string> = { emote: 'smile', frame: 'frame', title: 'title', pose: 'pose' };
const KIND_NAME: Record<CosKind, [string, string]> = { emote: ['ایموت', 'Emote'], frame: ['قاب', 'Frame'], title: ['لقب', 'Title'], pose: ['ژست', 'Pose'] };
/** Cosmetics whose source matches the predicate. */
export function cosmeticsWhere(pred: (s: CosSource) => boolean): Cosmetic[] {
  return (Object.keys(COSMETICS) as CosKind[]).flatMap((k) => COSMETICS[k]).filter((c) => pred(c.src));
}
/** Small gold chip naming a cosmetic reward; opens the collection on that tab. */
export function cosChip(c: Cosmetic, compact = false) {
  const label = `${tr(...KIND_NAME[c.kind])}: ${cname(c)}`;
  return h('span', {
    class: `tag gold cos-chip ${compact ? 'compact' : ''}`, title: label,
    onclick: (e: Event) => { e.stopPropagation(); show(() => collectionScreen(c.kind)); },
  }, svg(KIND_ICON[c.kind], 11), compact ? null : h('span', {}, cname(c)));
}
export function cosChipsFor(keys: string[] | undefined): HTMLElement[] {
  return (keys ?? []).map((k) => { const [kind, ...r] = k.split(':'); return getCosmetic(kind as CosKind, r.join(':')); }).filter((c): c is Cosmetic => !!c).map((c) => cosChip(c));
}

// ---- emotes ------------------------------------------------------------------------------------
export function emoteText(n: number) { const e = emoteByNet(n); return e ? cname(e) : '?'; }

/** In-match quick chat (online matches): the player's 6-emote loadout. */
export function emoteBar(root: HTMLElement): { el: HTMLElement; off: () => void } {
  const ids = emoteLoadout(backend.profile);
  let last = 0;
  const el = h('div', { class: 'emotes' }, ids.map((n) => h('button', {
    class: 'btn small emote-btn', onclick: () => { if (Date.now() - last < 900) return; last = Date.now(); net.send({ t: 'emote', id: n }); },
  }, emoteText(n))));
  const off = net.on('emote', (m) => {
    const b = h('div', { class: 'emote-pop', style: { color: PLAYER_COLORS[m.slot] } }, `P${m.slot + 1}: ${emoteText(m.id)}`);
    root.append(b); setTimeout(() => b.remove(), 1800);
  });
  return { el, off };
}

// ---- sources -------------------------------------------------------------------------------------
export function srcText(src: CosSource): string {
  switch (src.t) {
    case 'free': return tr('رایگان', 'Free');
    case 'shop': return tr('فروشگاه', 'Shop');
    case 'pass': return tr(`پاس فصل · مرحله ${num(src.tier)}${src.premium ? ' (ویژه)' : ''}`, `Season pass tier ${num(src.tier)}${src.premium ? ' (premium)' : ''}`);
    case 'ach': { const a = ACHIEVEMENTS.find((x) => x.id === src.id); return tr(`دستاورد «${a?.nameFa ?? src.id}»`, `Achievement "${a?.name ?? src.id}"`); }
    case 'trophy': return src.tier !== undefined
      ? tr(`قهرمان هفته در لیگ ${TIERS[src.tier].nameFa}`, `Weekly champion in ${TIERS[src.tier].name}`)
      : src.place === 1 ? tr('قهرمانی لیگ هفتگی', 'Win a weekly league') : tr('سه نفر اول لیگ هفتگی', 'Top 3 in a weekly league');
    case 'vip': return tr('ویژه VIP', 'VIP members');
    case 'mastery': return tr(`استادی ${loc(getFighter(src.fighter))} سطح ${num(src.level)}`, `${loc(getFighter(src.fighter))} mastery ${num(src.level)}`);
    case 'map': return tr('فتح کامل نقشه جهان', 'Clear the world map');
    case 'raid': return tr(`${num(src.stars)} ستاره در حمله قبیله`, `${num(src.stars)} clan-raid stars`);
    case 'level': return tr(`سطح ${num(src.level)}`, `Level ${num(src.level)}`);
    case 'grant': return tr('بسته ویژه', 'Special pack');
  }
}

// ---- collection screen ------------------------------------------------------------------------------
type Tab = CosKind;
const TAB_L: Record<Tab, { fa: string; en: string; icon: string }> = {
  emote: { fa: 'ایموت‌ها', en: 'Emotes', icon: 'smile' },
  frame: { fa: 'قاب‌ها', en: 'Frames', icon: 'frame' },
  title: { fa: 'لقب‌ها', en: 'Titles', icon: 'title' },
  pose: { fa: 'ژست پیروزی', en: 'Victory poses', icon: 'pose' },
};
let synced = 0;

export function collectionScreen(tab: Tab = 'emote', opts: { slot?: number; fighter?: string } = {}): Screen {
  const p = backend.profile;
  const refresh = (t = tab, o = opts) => show(() => collectionScreen(t, o));
  // persist newly earned (pass / achievements / trophies) unlocks once in a while
  if (Date.now() - synced > 30_000) { synced = Date.now(); liveops.cosSync().then((added) => { if (added?.length && document.querySelector('.collection')) refresh(); }).catch(() => {}); }

  const owned = (c: Cosmetic) => cosOwned(p, c.kind, c.id);
  const buy = async (c: Cosmetic) => {
    const s = c.src as { coins?: number; gems?: number };
    if (!(await confirmBox(`${cname(c)} — ${s.coins ? `${num(s.coins)} ${tr('سکه', 'coins')}` : `${num(s.gems ?? 0)} ${tr('الماس', 'gems')}`}`))) return false;
    const r = await liveops.cosBuy(c.kind, c.id).catch(() => null);
    if (r?.ok) { audio.coin(); toast(tr('خریداری شد', 'Purchased'), 'ok'); return true; }
    toast(r && !r.ok && r.reason === 'funds' ? tr('موجودی کافی نیست', 'Not enough funds') : tr('خطا', 'Error'), 'err');
    return false;
  };
  const priceBtn = (c: Cosmetic, after: () => void) => {
    const s = c.src as { coins?: number; gems?: number };
    return h('button', { class: `btn small ${s.gems ? 'gem' : 'gold'}`, onclick: async () => { if (await buy(c)) after(); } }, icon(s.gems ? 'gem' : 'coin'), num(s.gems ?? s.coins ?? 0));
  };
  const lockLine = (c: Cosmetic) => h('small', { class: 'cos-src' }, svg('lock', 11), srcText(c.src));
  const visible = (c: Cosmetic) => c.src.t !== 'mastery' || owned(c) || p.fighters.includes(c.src.fighter) && masteryInfo(p, c.src.fighter).level >= c.src.level - 2;

  let body: Child;
  if (tab === 'emote') {
    const slot = opts.slot ?? Math.max(0, p.cos!.emotes.indexOf(''));
    const loadout = h('div', { class: 'em-loadout' }, p.cos!.emotes.map((id, i) => {
      const c = id ? getCosmetic('emote', id) : undefined;
      return h('button', { class: `em-slot ${i === slot ? 'sel' : ''} ${c ? '' : 'empty'}`, onclick: () => refresh('emote', { slot: i }) },
        h('small', {}, num(i + 1)), c ? h('b', {}, cname(c)) : svg('smile', 16),
        c && i === slot ? h('span', { class: 'em-clear', onclick: async (e: Event) => { e.stopPropagation(); await liveops.cosEquip('emote', '', { slot: i }); refresh('emote', { slot: i }); } }, svg('close', 12)) : null);
    }));
    const list = h('div', { class: 'cos-grid emotes-grid' }, COSMETICS.emote.map((c) => {
      const own = owned(c);
      const at = p.cos!.emotes.indexOf(c.id);
      return h('div', { class: `cos-card em ${own ? '' : 'locked'} ${at >= 0 ? 'eq' : ''}` },
        h('div', { class: 'em-bubble' }, cname(c)),
        own ? h('button', { class: `btn small ${at === slot ? 'disabled' : 'accent'}`, onclick: async () => {
          await liveops.cosEquip('emote', c.id, { slot });
          const empty = backend.profile.cos!.emotes.indexOf('');
          refresh('emote', { slot: empty >= 0 ? empty : slot });
        } }, at >= 0 ? tr(`خانه ${num(at + 1)}`, `Slot ${num(at + 1)}`) : tr('بگذار', 'Equip'))
          : c.src.t === 'shop' ? priceBtn(c, () => refresh('emote', { slot })) : lockLine(c));
    }));
    body = [h('div', { class: 'box em-box' }, h('div', { class: 'row space' }, h('b', {}, tr('ایموت‌های بازی آنلاین (۶ خانه)', 'Online match quick chat (6 slots)')), h('small', { class: 'muted' }, tr('یک خانه را انتخاب کن، بعد ایموت را بگذار', 'Pick a slot, then equip an emote'))), loadout), list];
  } else if (tab === 'frame') {
    const cur = equippedFrame(p);
    const fav = p.selFighter;
    body = h('div', { class: 'cos-grid' },
      h('div', { class: `cos-card ${cur === '' ? 'eq' : ''}` }, frameRing('', fighterCanvas(fav, backend.selectedSkin(fav), 56), 'big'), h('b', {}, tr('بدون قاب', 'No frame')),
        cur === '' ? h('span', { class: 'tag ok' }, svg('check', 11), tr('فعال', 'Equipped')) : h('button', { class: 'btn small accent', onclick: async () => { await liveops.cosEquip('frame', ''); refresh(); } }, tr('انتخاب', 'Equip'))),
      COSMETICS.frame.filter(visible).map((c) => {
        const own = owned(c);
        return h('div', { class: `cos-card ${own ? '' : 'locked'} ${cur === c.id ? 'eq' : ''}` },
          frameRing(c.id, fighterCanvas(fav, backend.selectedSkin(fav), 56), 'big'),
          h('b', {}, cname(c)),
          cur === c.id ? h('span', { class: 'tag ok' }, svg('check', 11), tr('فعال', 'Equipped'))
            : own ? h('button', { class: 'btn small accent', onclick: async () => { await liveops.cosEquip('frame', c.id); refresh(); } }, tr('انتخاب', 'Equip'))
              : c.src.t === 'shop' ? priceBtn(c, refresh) : lockLine(c));
      }));
  } else if (tab === 'title') {
    const cur = equippedTitle(p);
    body = h('div', { class: 'cos-list' },
      h('div', { class: `cos-row ${cur === '' ? 'eq' : ''}` }, h('b', { class: 'muted' }, tr('بدون لقب', 'No title')), h('span'),
        cur === '' ? h('span', { class: 'tag ok' }, svg('check', 11)) : h('button', { class: 'btn small accent', onclick: async () => { await liveops.cosEquip('title', ''); refresh(); } }, tr('انتخاب', 'Equip'))),
      COSMETICS.title.filter(visible).map((c) => {
        const own = owned(c);
        return h('div', { class: `cos-row ${own ? '' : 'locked'} ${cur === c.id ? 'eq' : ''}` },
          h('span', { class: 'ptitle' }, cname(c)),
          h('small', { class: 'muted cos-src' }, own ? '' : srcText(c.src)),
          cur === c.id ? h('span', { class: 'tag ok' }, svg('check', 11), tr('فعال', 'Equipped'))
            : own ? h('button', { class: 'btn small accent', onclick: async () => { await liveops.cosEquip('title', c.id); refresh(); } }, tr('انتخاب', 'Equip'))
              : c.src.t === 'shop' ? priceBtn(c, refresh) : h('span', { class: 'tag lock' }, svg('lock', 11)));
      }));
  } else {
    const fid = opts.fighter && p.fighters.includes(opts.fighter) ? opts.fighter : p.selFighter;
    const skin = backend.selectedSkin(fid);
    const cur = poseFor(p, fid);
    body = h('div', { class: 'pose-wrap' },
      h('div', { class: 'pose-fighters' }, p.fighters.map((f) => h('button', { class: `pose-f ${f === fid ? 'sel' : ''}`, onclick: () => refresh('pose', { fighter: f }) },
        fighterCanvas(f, backend.selectedSkin(f), 40), h('small', {}, loc(getFighter(f)))))),
      h('div', { class: 'cos-grid poses' }, COSMETICS.pose.map((c) => {
        const own = owned(c);
        return h('div', { class: `cos-card pose ${own ? '' : 'locked'} ${cur === c.id ? 'eq' : ''}` },
          poseCanvas(fid, skin, 92, c.id),
          h('b', {}, cname(c)),
          cur === c.id ? h('span', { class: 'tag ok' }, svg('check', 11), tr('فعال', 'Equipped'))
            : own ? h('button', { class: 'btn small accent', onclick: async () => { await liveops.cosEquip('pose', c.id, { fighter: fid }); refresh('pose', { fighter: fid }); } }, tr('انتخاب', 'Equip'))
              : c.src.t === 'shop' ? priceBtn(c, () => refresh('pose', { fighter: fid })) : lockLine(c));
      })));
  }

  const el = h('div', { class: 'page collection' },
    topBar({ back: () => show(homeScreen), title: tr('کلکسیون', 'Collection') }),
    h('div', { class: 'tabs' }, (Object.keys(TAB_L) as Tab[]).map((k) => h('button', { class: `tab ${k === tab ? 'on' : ''}`, 'data-ct': k, onclick: () => refresh(k, {}) }, svg(TAB_L[k].icon, 13), ' ', tr(TAB_L[k].fa, TAB_L[k].en)))),
    h('div', { class: 'scroll' }, body),
  );
  introOnce('collection', [
    { target: '.collection .tabs', title: L('کلکسیون', 'Collection'), text: L('ایموت‌ها، قاب پروفایل، لقب و ژست پیروزی‌ات را اینجا انتخاب کن. بعضی‌ها را با سکه یا الماس بخر؛ بقیه از پاس فصل، دستاوردها، جام‌های لیگ هفتگی و استادی مبارزها باز می‌شوند.', 'Pick your emotes, profile frame, title and victory pose. Buy some with coins or gems; others come from the season pass, achievements, weekly-league trophies and fighter mastery.') },
    { target: '.collection .scroll', title: L('دیده شدن', 'Show it off'), text: L('قاب و لقب در نوار بالا، پروفایل، رتبه‌بندی، چت و مسابقه دیده می‌شوند؛ ژست پیروزی در صفحه نتیجه.', 'Frames and titles appear in the top bar, profile, leaderboards, chat and matches; the victory pose plays on the results screen.') },
  ]);
  return { el };
}

// =============================================================================================
//  Fighter mastery
// =============================================================================================
function rewardLine(r: Reward, title?: string, frame?: string): Child[] {
  const out: Child[] = [];
  if (r.coins) out.push(h('span', { class: 'cur' }, icon('coin'), num(r.coins)));
  if (r.gems) out.push(h('span', { class: 'cur' }, icon('gem'), num(r.gems)));
  if (r.runes) out.push(h('span', { class: 'cur rune' }, icon('rune'), num(r.runes)));
  for (const n of Object.values(r.cards ?? {})) out.push(h('span', { class: 'cur' }, svg('fighters', 13), num(n)));
  if (title) out.push(h('span', { class: 'tag gold' }, svg('title', 11), tr('لقب', 'Title')));
  if (frame) out.push(h('span', { class: 'tag gold' }, svg('frame', 11), tr('قاب انحصاری', 'Exclusive frame')));
  return out;
}

export function masteryBadge(fid: string) {
  const m = masteryInfo(backend.profile, fid);
  return m.level > 0 ? h('span', { class: `mlv ${m.max ? 'max' : ''} ${m.pending ? 'ready' : ''}` }, num(m.level)) : null;
}

export function masteryClaim(fid: string, after: () => void) {
  return async () => {
    const r = await liveops.masteryClaim(fid).catch(() => null);
    if (!r) { toast(tr('خطا', 'Error'), 'err'); return; }
    const lv = num(r.levels[r.levels.length - 1] ?? 0);
    const m = rewardReveal(tr(`استادی ${loc(getFighter(fid))} · سطح ${lv}`, `${loc(getFighter(fid))} mastery ${lv}`), grantedToItems(r.granted));
    const extra = [...r.titles.map((x) => titleText(x, isFa())), ...r.frames.map((x) => cname(getCosmetic('frame', x)!))];
    if (extra.length) m.el.querySelector('.reveal')?.insertBefore(h('p', { class: 'tag gold' }, svg('sparkles', 12), extra.join(' · ')), m.el.querySelector('.reveal .btn'));
    after();
  };
}

/** Mastery block on the fighters screen. */
export function masteryPanel(fid: string, refresh: () => void): HTMLElement {
  const p = backend.profile;
  const m = masteryInfo(p, fid);
  const own = p.fighters.includes(fid);
  const next = Math.min(MASTERY_MAX, m.level + 1);
  const nr = masteryReward(fid, next);
  return h('div', { class: 'mastery-panel' },
    h('div', { class: 'mp-head' },
      h('span', { class: `mlv big ${m.max ? 'max' : ''}` }, num(m.level)),
      h('div', { class: 'mp-main' },
        h('b', {}, tr('استادی مبارز', 'Fighter mastery'), h('small', { class: 'muted' }, ` · ${num(m.level)}/${num(MASTERY_MAX)}`)),
        h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${m.max ? 100 : Math.round((m.into / Math.max(1, m.need)) * 100)}%` } })),
        h('small', { class: 'muted' }, m.max ? tr('حداکثر سطح', 'Max level') : h('span', {}, h('span', { dir: 'ltr' }, `${num(m.into)} / ${num(m.need)}`), ` · ${tr('بعدی', 'next')}: `, ...rewardLine(nr.reward, nr.title, nr.frame)))),
      own && m.pending ? h('button', { class: 'btn small gold', onclick: masteryClaim(fid, refresh) }, svg('gift', 14), tr('دریافت', 'Claim'), h('span', { class: 'badge' }, num(m.pending)))
        : h('button', { class: 'btn small ghost icon', title: '?', onclick: () => masteryInfoModal(fid) }, svg('help', 16))),
  );
}

export function masteryInfoModal(fid: string) {
  const m = masteryInfo(backend.profile, fid);
  modal(h('div', { class: 'mastery-modal' },
    h('h2', {}, tr(`استادی ${loc(getFighter(fid))}`, `${loc(getFighter(fid))} mastery`)),
    h('p', { class: 'muted' }, tr('با این مبارز بازی کن تا تجربه استادی بگیری؛ برد بیشتر می‌دهد. هر سطح جایزه دارد: سطح ۵ لقب و سطح ۱۰ قاب انحصاری.', 'Play this fighter to earn mastery XP — wins give more. Every level pays a reward: a title at 5 and an exclusive frame at 10.')),
    h('div', { class: 'ml-list' }, Array.from({ length: MASTERY_MAX }, (_, i) => {
      const l = i + 1, r = masteryReward(fid, l);
      return h('div', { class: `ml-row ${l <= m.claimed ? 'got' : l <= m.level ? 'ready' : ''}` }, h('span', { class: 'mlv' }, num(l)), h('div', { class: 'row', style: { justifyContent: 'flex-start' } }, ...rewardLine(r.reward, r.title, r.frame)),
        l <= m.claimed ? svg('check', 14) : null);
    }))));
}

/** Profile: mastery list of every fighter (replaces the old simple bar). */
export function masteryList(): HTMLElement {
  const p = backend.profile;
  const rows = FIGHTERS.map((f) => ({ f, m: masteryInfo(p, f.id), fs: p.fstats[f.id] ?? { m: 0, w: 0 } }))
    .sort((a, b) => b.m.xp - a.m.xp);
  return h('div', { class: 'box' }, h('h3', {}, svg('medal', 16), ' ', tr('استادی مبارزها', 'Fighter mastery')),
    rows.map(({ f, m, fs }) => h('div', { class: 'mastery m2', onclick: () => masteryInfoModal(f.id) },
      fighterCanvas(f.id, backend.selectedSkin(f.id), 34),
      h('div', {}, h('b', {}, loc(f), ' ', h('span', { class: `mlv ${m.max ? 'max' : ''} ${m.pending ? 'ready' : ''}` }, num(m.level))),
        h('div', { class: 'xpbar' }, h('div', { style: { width: `${m.max ? 100 : Math.round((m.into / Math.max(1, m.need)) * 100)}%` } }))),
      h('small', { class: 'muted', dir: 'ltr' }, `${num(fs.w)} / ${num(fs.m)}`))));
}

export { cname as cosmeticName };
