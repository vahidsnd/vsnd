import {
  FIGHTERS, getFighter, getStage, getSpell, SPELLS, SPELL_MAX_LEVEL, healAmount, aegisFrames, spellProjectile,
  mapNodes, MAP_SIZE, REGIONS, NODES_PER_REGION, STAR_CHESTS, totalStars, featureUnlocked,
  MILESTONES, WHEEL, WHEEL_ADS_PER_DAY, wheelState, dayKey, leagueSteps, tierFor, romanDiv, promotionReward, SEASON_REWARDS, seasonEndsAt, leagueIndex,
  STAT_KEYS, UPGRADE_MAX, upgradeCost, upgLevels, statEffect, fighterPower, unreadMail,
  type MapNode, type Reward, type StatKey, type LeagueId,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { ads } from '../services/ads.ts';
import { audio } from '../game/audio.ts';
import { t, num, isFa, loc, duration } from '../i18n.ts';
import { h, show, topBar, modal, toast, icon, rewardReveal, grantedToItems, fighterCanvas, type Screen, type Child } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import './progress.css';

type Lx = { fa: string; en: string };
const L = (fa: string, en: string): Lx => ({ fa, en });
const tr = (l: Lx) => (isFa() ? l.fa : l.en);
const home = () => import('./home.ts').then((m) => show(m.homeScreen));
const ltr = (s: string) => h('span', { dir: 'ltr' }, s);

/** Compact reward chips (coins, gems, runes, cards, fighters…). */
export function rewardChips(r: Reward): HTMLElement {
  return h('div', { class: 'chips' },
    r.coins ? h('span', { class: 'cur' }, icon('coin'), num(r.coins)) : null,
    r.gems ? h('span', { class: 'cur' }, icon('gem'), num(r.gems)) : null,
    r.runes ? h('span', { class: 'cur' }, icon('rune'), num(r.runes)) : null,
    r.anyCards ? h('span', { class: 'cur' }, svg('fighters', 14), `${num(r.anyCards)} ${tr(L('کارت', 'cards'))}`) : null,
    r.crates ? h('span', { class: 'cur' }, svg('crate', 14), `×${num(r.crates)}`) : null,
    r.xp ? h('span', { class: 'cur' }, svg('star', 14), `${num(r.xp)} XP`) : null,
    ...(r.fighters ?? []).map((f) => h('span', { class: 'cur hi' }, svg('user', 14), loc(getFighter(f)))),
    ...(r.spells ?? []).map((s) => h('span', { class: 'cur hi' }, svg('sparkles', 14), isFa() ? getSpell(s)!.nameFa : getSpell(s)!.name)),
  );
}

// =============================================================================================
// World map (offline campaign) — clearing it opens online play
// =============================================================================================
const KIND: Record<MapNode['kind'], Lx> = { duel: L('دوئل', 'Duel'), team: L('تیمی ۲ به ۲', 'Team 2v2'), ffa: L('همه با هم', 'Free-for-all'), boss: L('رئیس', 'Boss') };

export function mapScreen(focus?: number): Screen {
  const p = backend.profile;
  const nodes = mapNodes();
  const cleared = p.map.cleared;
  const stars = totalStars(p);
  const H = Math.max(200, Math.min(420, innerHeight - 128));
  const W = Math.round(H * 4.6);

  const lines = h('div', { class: 'map-lines' });
  const pts = nodes.map((n) => [n.x * W, n.y * H]);
  lines.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="#ffffff22" stroke-width="5" stroke-dasharray="2 10" stroke-linecap="round"/><polyline points="${pts.slice(0, Math.max(1, cleared + 1)).map((q) => q.join(',')).join(' ')}" fill="none" stroke="#29e3f0" stroke-width="4" stroke-linecap="round" opacity=".75"/></svg>`;

  const regions = REGIONS.map((r, i) => h('div', { class: 'map-region', style: { left: `${(i / REGIONS.length) * 100}%`, width: `${100 / REGIONS.length}%`, '--rc': r.color } as any },
    h('b', {}, tr({ fa: r.nameFa, en: r.name })),
    h('small', {}, `${num(i * NODES_PER_REGION + 1)}–${num((i + 1) * NODES_PER_REGION)}`)));

  const nodeEls = nodes.map((n) => {
    const st = n.i < cleared ? 'done' : n.i === cleared ? 'cur' : 'locked';
    const s = p.map.stars[n.i] ?? 0;
    return h('button', {
      class: `map-node ${st} k-${n.kind}`, style: { left: `${n.x * W}px`, top: `${n.y * H}px`, '--rc': REGIONS[n.region].color } as any,
      'data-node': n.i,
      onclick: () => (st === 'locked' ? toast(tr(L('اول مرحله قبلی را ببر', 'Beat the previous stage first')), 'info') : nodeModal(n)),
    },
      n.kind === 'boss' ? svg('skull', 20) : st === 'locked' ? svg('lock', 14) : h('b', {}, num(n.i + 1)),
      st === 'done' ? h('span', { class: 'stars' }, [1, 2, 3].map((k) => h('i', { class: k <= s ? 'on' : '' }))) : null,
    );
  });

  const canvas = h('div', { class: 'map-canvas', style: { width: `${W}px`, height: `${H}px` } }, regions, lines, nodeEls);
  const scroller = h('div', { class: 'map-scroll' }, canvas);
  const target = focus ?? Math.min(cleared, MAP_SIZE - 1);
  requestAnimationFrame(() => {
    const x = nodes[target].x * W - scroller.clientWidth / 2;
    scroller.scrollLeft = Math.max(0, x); // the scroller is always laid out left-to-right

  });

  const chests = h('div', { class: 'star-chests' },
    h('span', { class: 'cur', dir: 'ltr' }, svg('star', 16), `${num(stars)} / ${num(MAP_SIZE * 3)}`),
    STAR_CHESTS.map((c, i) => {
      const got = p.map.chests.includes(i);
      const ready = !got && stars >= c.stars;
      return h('button', { class: `chest ${got ? 'got' : ready ? 'ready' : ''}`, onclick: async () => {
        if (!ready) { modal(h('div', { class: 'pick' }, h('h3', {}, `${num(c.stars)} ★`), rewardChips(c.reward))); return; }
        const g = await backend.claimStarChest(i).catch(() => null);
        if (g) rewardReveal(tr(L('صندوق ستاره', 'Star chest')), grantedToItems(g));
        show(() => mapScreen());
      } }, svg(got ? 'check' : 'gift', 16), h('small', {}, num(c.stars)));
    }));

  const onlineOpen = featureUnlocked(p, 'online');
  const banner = h('div', { class: `map-banner ${onlineOpen ? 'open' : ''}` },
    svg(onlineOpen ? 'globe' : 'lock', 16),
    onlineOpen ? tr(L('نقشه فتح شد — بازی آنلاین باز است', 'Map conquered — online play is open'))
      : h('span', {}, tr(L('برای باز شدن بازی آنلاین، قبیله و لیگ نقشه را تمام کن', 'Finish the map to unlock online play, clans and leagues')), ' ', ltr(`${num(cleared)}/${num(MAP_SIZE)}`)),
    h('div', { class: 'xpbar' }, h('div', { style: { width: `${(cleared / MAP_SIZE) * 100}%` } })));

  introOnce('map', [
    { target: '.map-scroll', title: L('نقشه جهان', 'World map'), text: L('هر نقطه یک نبرد در یک میدان جدید است. با بردن هر مرحله، مرحله بعد و آن میدان باز می‌شود. آخر هر منطقه یک رئیس قوی منتظر است که با شکستش یک مبارز جدید می‌گیری.', 'Each point is a battle in a new arena. Winning opens the next stage and that arena. Every region ends with a powerful boss — defeat it to recruit a new fighter.') },
    { target: '.star-chests', title: L('ستاره‌ها', 'Stars'), text: L('برد = ۱ ستاره، حداکثر یک سقوط = ۲ ستاره، بدون سقوط = ۳ ستاره. با جمع کردن ستاره صندوق‌ها باز می‌شوند.', 'Win = 1 star, at most one fall = 2 stars, no falls = 3 stars. Stars open the chests.') },
    { target: '.map-banner', title: L('راه رسیدن به آنلاین', 'Your road to online'), text: L('بازی آنلاین، لیگ، قبیله و چت بعد از فتح کامل نقشه باز می‌شوند. تا آن موقع مبارزه‌ها آفلاین است و دستاوردها را جمع می‌کنی.', 'Online matches, leagues, clans and chat open once the whole map is conquered. Until then you fight offline and collect achievements.') },
  ]);

  return {
    el: h('div', { class: 'page mapscreen' },
      topBar({ back: home, title: tr(L('نقشه جهان', 'World map')) }),
      h('div', { class: 'map-top' }, banner, chests),
      scroller,
    ),
  };
}

function nodeModal(n: MapNode) {
  const p = backend.profile;
  const stage = getStage(n.stage);
  const best = p.map.stars[n.i] ?? 0;
  const first = n.i === p.map.cleared;
  const m = modal(h('div', { class: 'node-modal' },
    h('div', { class: 'node-stage', style: { background: `linear-gradient(160deg, ${stage.theme.sky[0]}, ${stage.theme.sky[1]})` } },
      h('small', {}, tr({ fa: REGIONS[n.region].nameFa, en: REGIONS[n.region].name }), ' · ', num(n.i + 1)),
      h('b', {}, loc(stage)),
      h('span', { class: `tag ${n.kind === 'boss' ? 'gold' : ''}` }, tr(KIND[n.kind]), ' · ', `${num(n.stocks)} ${t('stocks')}`)),
    h('div', { class: 'node-vs' },
      h('div', { class: 'side-a' }, fighterCanvas(p.selFighter, backend.selectedSkin(p.selFighter), 70), n.ally ? fighterCanvas(n.ally.charId, 1, 56) : null),
      h('b', { class: 'vs' }, 'VS'),
      h('div', { class: 'side-b' }, n.foes.map((f) => h('div', { class: 'foe' }, fighterCanvas(f.charId, n.kind === 'boss' ? 3 : 2, n.kind === 'boss' ? 84 : 64),
        h('small', {}, loc(getFighter(f.charId)), ' · ', `Lv ${num(f.lv)}`))))),
    n.kind === 'boss' ? h('p', { class: 'muted small' }, tr(L('رئیس قوی‌تر از حالت عادی است و جادو می‌زند. مبارزت را ارتقا بده!', 'The boss is stronger than normal and casts spells. Upgrade your fighter!'))) : null,
    h('div', { class: 'node-rew' },
      h('small', { class: 'muted' }, first ? tr(L('جایزه اولین برد', 'First-win reward')) : tr(L('قبلاً گرفته شد', 'Already claimed'))),
      first ? rewardChips(n.reward) : h('span', { class: 'stars big' }, [1, 2, 3].map((k) => h('i', { class: k <= best ? 'on' : '' })))),
    h('button', { class: 'btn primary big', onclick: () => { m.close(); import('./play.ts').then((x) => x.startMapNode(n.i)); } }, svg('swords', 18), tr(L('نبرد', 'Fight'))),
  ));
}

// =============================================================================================
// Spells (runes)
// =============================================================================================
function spellStats(id: string, lv: number): string {
  const sp = getSpell(id)!;
  const L1 = Math.max(1, lv);
  if (sp.id === 'heal') return `${isFa() ? 'التیام' : 'Heal'} ${num(healAmount(L1))}%`;
  if (sp.id === 'aegis') return `${num(Math.round(aegisFrames(L1) / 6) / 10)}s`;
  const pd = spellProjectile(sp.id, L1);
  return pd?.dmg ? `${num(pd.dmg)}% ${isFa() ? 'آسیب' : 'dmg'}` : (isFa() ? 'هل دادن قوی' : 'strong push');
}

export function spellsScreen(fighter = backend.profile.selFighter): Screen {
  const p = backend.profile;
  const equipped = p.equip[fighter];
  const list = h('div', { class: 'spells' }, SPELLS.map((sp) => {
    const lv = p.spells[sp.id] ?? 0;
    const cost = lv === 0 ? sp.unlock : lv < SPELL_MAX_LEVEL ? sp.upgrade[lv - 1] : 0;
    const can = p.runes >= cost;
    return h('div', { class: `spell ${lv ? '' : 'locked'} ${equipped === sp.id ? 'eq' : ''}`, style: { '--c': sp.color } as any },
      h('div', { class: 'sp-ico' }, svg(lv ? 'sparkles' : 'lock', 24)),
      h('div', { class: 'sp-main' },
        h('b', {}, isFa() ? sp.nameFa : sp.name, lv ? h('small', { class: 'lv' }, ` Lv ${num(lv)}`) : null),
        h('small', { class: 'muted' }, isFa() ? sp.descFa : sp.desc),
        h('small', { class: 'sp-stat' }, spellStats(sp.id, lv || 1), lv && lv < SPELL_MAX_LEVEL ? ` → ${spellStats(sp.id, lv + 1)}` : '')),
      h('div', { class: 'sp-act' },
        lv && lv >= SPELL_MAX_LEVEL ? h('span', { class: 'tag gold' }, 'MAX')
          : h('button', { class: `btn small ${can ? 'accent' : 'disabled'}`, onclick: async () => {
            const ok = lv ? await backend.upgradeSpell(sp.id) : await backend.learnSpell(sp.id);
            if (ok) { audio.reward(); toast(lv ? tr(L('ارتقا یافت', 'Upgraded')) : tr(L('یاد گرفتی!', 'Learned!')), 'ok'); }
            else toast(tr(L('رون کافی نیست', 'Not enough runes')), 'err');
            show(() => spellsScreen(fighter));
          } }, icon('rune'), num(cost), ' ', lv ? svg('up', 12) : tr(L('یادگیری', 'Learn'))),
        lv ? h('button', { class: `btn small ${equipped === sp.id ? 'primary' : 'ghost'}`, onclick: async () => {
          await backend.equipSpell(fighter, equipped === sp.id ? null : sp.id);
          show(() => spellsScreen(fighter));
        } }, equipped === sp.id ? tr(L('مجهز', 'Equipped')) : tr(L('انتخاب', 'Equip'))) : null,
      ));
  }));
  const picker = h('div', { class: 'sp-fighters' }, p.fighters.map((f) => {
    const sp = getSpell(p.equip[f]);
    return h('button', { class: `sp-f ${f === fighter ? 'sel' : ''}`, onclick: () => show(() => spellsScreen(f)) },
      fighterCanvas(f, backend.selectedSkin(f), 46), h('small', {}, loc(getFighter(f))),
      sp ? h('i', { class: 'sp-dot', style: { background: sp.color } }) : null);
  }));
  introOnce('spells', [
    { target: '.sp-fighters', title: L('جادوی هر مبارز', 'A spell per fighter'), text: L('اول مبارز را انتخاب کن، بعد یک جادو برایش مجهز کن. هر مبارز می‌تواند جادوی متفاوتی داشته باشد.', 'Pick a fighter, then equip one spell for it. Each fighter can carry a different spell.') },
    { target: '.spells', title: L('یادگیری و ارتقا با رون', 'Learn & level with runes'), text: L('رون از نقشه، برد، مایل‌استون، گردونه، جنگ قبیله و لیگ به دست می‌آید. هر جادو ۵ سطح دارد.', 'Runes come from the map, wins, milestones, the wheel, clan wars and leagues. Every spell has 5 levels.') },
    { title: L('در مبارزه', 'In battle'), text: L('نوار جادو زیر درصد آسیب با ضربه زدن و ضربه خوردن پر می‌شود. وقتی پر شد دکمه جادو (یا کلید E) را بزن.', 'The magic meter under your damage fills as you hit and get hit. When it\'s full, press the magic button (or E).') },
  ]);
  return {
    el: h('div', { class: 'page spellscreen' },
      topBar({ back: home, title: tr(L('جادو', 'Spells')) }),
      h('div', { class: 'split sp-split' }, h('div', { class: 'sp-left' }, h('div', { class: 'rune-bal' }, icon('rune'), h('b', {}, num(p.runes)), h('small', { class: 'muted' }, tr(L('رون', 'runes')))), picker), h('div', { class: 'scroll' }, list)),
    ),
  };
}

// =============================================================================================
// Fighter cards & stat upgrades (embedded in the fighters screen)
// =============================================================================================
const STAT_L: Record<StatKey, { name: Lx; icon: string; fx: (l: number) => string }> = {
  atk: { name: L('حمله', 'Attack'), icon: 'swords', fx: (l) => `+${num(Math.round((statEffect.atk(l) - 1) * 100))}%` },
  def: { name: L('دفاع', 'Defense'), icon: 'shield', fx: (l) => `-${num(Math.round((1 - statEffect.def(l)) * 1000) / 10)}%` },
  hp: { name: L('سلامت', 'Health'), icon: 'heart', fx: (l) => `+${num(Math.round((statEffect.hp(l) - 1) * 100))}%` },
};
export function upgradePanel(fid: string, refresh: () => void): HTMLElement {
  const p = backend.profile;
  const u = upgLevels(p, fid);
  const cards = p.cards[fid] ?? 0;
  const sp = getSpell(p.equip[fid]);
  return h('div', { class: 'upg' },
    h('div', { class: 'upg-head' },
      h('span', { class: 'cur' }, svg('fighters', 14), `${num(cards)} ${tr(L('کارت', 'cards'))}`),
      h('span', { class: 'cur' }, svg('zap', 14), `${tr(L('قدرت', 'Power'))} ${num(fighterPower(p, fid))}`),
      h('button', { class: 'btn small ghost', onclick: () => show(() => spellsScreen(fid)) }, svg('sparkles', 14), sp ? (isFa() ? sp.nameFa : sp.name) : tr(L('جادو', 'Spell')))),
    STAT_KEYS.map((k) => {
      const lv = u[k];
      const c = upgradeCost(lv);
      const max = lv >= UPGRADE_MAX;
      const can = !max && cards >= c.cards && p.coins >= c.coins;
      return h('div', { class: 'upg-row' },
        svg(STAT_L[k].icon, 16),
        h('span', { class: 'upg-name' }, tr(STAT_L[k].name)),
        h('div', { class: 'upg-bar' }, Array.from({ length: UPGRADE_MAX }, (_, i) => h('i', { class: i < lv ? 'on' : '' }))),
        h('small', { class: 'upg-fx', dir: 'ltr' }, STAT_L[k].fx(lv)),
        max ? h('span', { class: 'tag gold' }, 'MAX') : h('button', { class: `btn small ${can ? 'gold' : 'disabled'}`, onclick: async () => {
          if (await backend.upgrade(fid, k)) { audio.reward(); toast(`${tr(STAT_L[k].name)} ${num(lv + 1)}`, 'ok'); refresh(); }
          else toast(tr(L('کارت یا سکه کافی نیست', 'Not enough cards or coins')), 'err');
        } }, ltr(`${num(c.cards)}`), svg('fighters', 12), ' ', icon('coin'), num(c.coins)));
    }));
}

// =============================================================================================
// League
// =============================================================================================
export function leagueScreen(): Screen {
  const p = backend.profile;
  const steps = leagueSteps();
  const cur = tierFor(p.rank.mmr);
  const top = leagueIndex(p.rank.peak);
  const curIdx = leagueIndex(p.rank.mmr);
  const next = steps[curIdx + 1];
  const ladder = h('div', { class: 'ladder' }, steps.map((s, i) => {
    const claimed = p.league.claimed.includes(s.key);
    const reached = i <= top;
    const r = promotionReward(s.key);
    return h('div', { class: `rung ${i === curIdx ? 'cur' : ''} ${reached ? 'reached' : ''}`, style: { '--tc': s.tier.color } as any },
      h('div', { class: 'rung-badge' }, svg(s.tier.icon, 18), h('b', {}, s.division ? romanDiv(s.division) : '★')),
      h('div', { class: 'rung-main' }, h('b', {}, `${isFa() ? s.tier.nameFa : s.tier.name} ${s.division ? romanDiv(s.division) : ''}`), h('small', { class: 'muted' }, ltr(`${num(s.min)}+`))),
      i === 0 ? h('span') : claimed ? h('span', { class: 'tag ok' }, svg('check', 12)) : reached
        ? h('button', { class: 'btn small gold', onclick: async () => {
          const g = await backend.claimLeague(s.key).catch(() => null);
          if (g) rewardReveal(`${isFa() ? s.tier.nameFa : s.tier.name} ${romanDiv(s.division)}`, grantedToItems(g));
          show(leagueScreen);
        } }, t('claim'))
        : rewardChips({ coins: r.coins, gems: r.gems, runes: r.runes, crates: r.crates }));
  }).reverse());
  const season = h('div', { class: 'box' },
    h('h3', {}, tr(L('جوایز پایان فصل', 'Season-end rewards'))),
    h('small', { class: 'muted' }, `${tr(L('پایان فصل', 'Season ends in'))} ${duration(seasonEndsAt(Date.now()) - Date.now())} · ${tr(L('بر اساس بهترین لیگ این فصل', 'based on your best league this season'))}`),
    (Object.keys(SEASON_REWARDS) as LeagueId[]).map((k) => {
      const tt = steps.find((s) => s.tier.id === k)!.tier;
      return h('div', { class: 'season-row', style: { '--tc': tt.color } as any }, h('b', {}, isFa() ? tt.nameFa : tt.name), rewardChips(SEASON_REWARDS[k] as Reward));
    }));
  const open = featureUnlocked(p, 'ranked');
  const head = h('div', { class: 'league-head', style: { '--tc': cur.tier.color } as any },
    h('div', { class: 'lh-badge' }, svg(cur.tier.icon, 40)),
    h('div', {},
      h('h2', {}, `${isFa() ? cur.tier.nameFa : cur.tier.name} ${cur.division ? romanDiv(cur.division) : ''}`),
      h('small', { class: 'muted' }, ltr(`${num(p.rank.mmr)}`), ` · ${t('wins')} ${num(p.rank.wins)} · ${t('losses')} ${num(p.rank.losses)}`),
      next ? h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${Math.max(4, Math.min(100, ((p.rank.mmr - steps[curIdx].min) / (next.min - steps[curIdx].min)) * 100))}%` } })) : null,
      next ? h('small', { class: 'muted' }, `${tr(L('تا', 'to'))} ${isFa() ? next.tier.nameFa : next.tier.name} ${romanDiv(next.division)}: `, ltr(num(next.min - p.rank.mmr))) : null),
    h('button', { class: `btn primary big ${open ? '' : 'disabled'}`, onclick: () => import('./play.ts').then((m) => show(() => m.matchmakingScreen('ranked', '1v1'))) }, svg('trophy', 18), tr(L('بازی لیگ', 'League match'))));
  introOnce('league', [
    { target: '.league-head', title: L('لیگ‌ها', 'Leagues'), text: L('برنزی، نقره‌ای، طلایی، کریستالی و افسانه‌ای. هر برد در بازی لیگ امتیاز می‌دهد و هر باخت کم می‌کند؛ برد پیاپی امتیاز اضافه دارد.', 'Bronze, Silver, Gold, Crystal and Legendary. League wins add points, losses remove them; win streaks add a bonus.') },
    { target: '.ladder', title: L('جایزه ارتقا', 'Promotion rewards'), text: L('اولین بار که به هر دسته برسی جایزه‌اش را اینجا بگیر. آخر فصل هم بر اساس بهترین لیگت جایزه به صندوق پیام می‌آید.', 'Claim a reward the first time you reach each division. At season end, a reward for your best league arrives in your inbox.') },
  ]);
  return { el: h('div', { class: 'page leaguescreen' }, topBar({ back: home, title: tr(L('لیگ', 'League')) }), h('div', { class: 'scroll narrow' }, head, h('div', { class: 'two-col league-cols' }, ladder, season))) };
}

// =============================================================================================
// Inbox
// =============================================================================================
export function inboxScreen(): Screen {
  const p = backend.profile;
  const list = p.inbox.length ? p.inbox.map((m) => h('div', { class: `mail ${m.claimed ? 'read' : ''}` },
    svg(m.reward ? 'gift' : 'mail', 22),
    h('div', { class: 'mail-main' }, h('b', {}, isFa() ? m.titleFa : m.title), h('small', { class: 'muted' }, (isFa() ? m.bodyFa : m.body) ?? ''), m.reward && !m.claimed ? rewardChips(m.reward) : null),
    m.reward && !m.claimed ? h('button', { class: 'btn small gold', onclick: async () => {
      const g = await backend.claimMail(m.id).catch(() => null);
      if (g) rewardReveal(isFa() ? m.titleFa : m.title, grantedToItems(g));
      show(inboxScreen);
    } }, t('claim')) : h('small', { class: 'muted' }, new Date(m.t).toLocaleDateString(isFa() ? 'fa-IR' : 'en-GB')),
  )) : [h('p', { class: 'muted center' }, tr(L('صندوق پیام خالی است. جوایز جنگ قبیله، فصل و پیام‌های پلیس بازی اینجا می‌آیند.', 'Your inbox is empty. Clan war and season rewards and Game Police notices arrive here.')))];
  return { el: h('div', { class: 'page inbox' }, topBar({ back: home, title: tr(L('صندوق پیام', 'Inbox')) }), h('div', { class: 'scroll narrow' }, list)) };
}
export { unreadMail };

// =============================================================================================
// Lucky wheel
// =============================================================================================
export function wheelModal(onDone?: () => void) {
  const p = backend.profile;
  const st = wheelState(p, dayKey(Date.now()));
  const size = Math.min(260, innerHeight - 140);
  const q = Math.min(2, devicePixelRatio || 1);
  const cv = h('canvas', { width: size * q, height: size * q, style: { width: `${size}px`, height: `${size}px` } });
  const ctx = cv.getContext('2d')!;
  const seg = (Math.PI * 2) / WHEEL.length;
  const label = (r: Reward) => num(r.coins ?? r.gems ?? r.runes ?? r.anyCards ?? 0);
  const kindColor = (r: Reward) => (r.coins ? '#ffc93c' : r.gems ? '#62c8ff' : r.runes ? '#b48cff' : '#2ee59d');
  const draw = (rot: number) => {
    const c = size * q / 2;
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(rot);
    WHEEL.forEach((w, i) => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, size / 2 - 4, i * seg, (i + 1) * seg); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#141a33' : '#1d2547'; ctx.fill();
      ctx.strokeStyle = w.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.rotate(i * seg + seg / 2); ctx.fillStyle = w.color; ctx.font = '800 13px Vazirmatn, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(label(w.reward), size / 2 - 14, 5);
      // small currency marker: circle = coins, diamond = gems, hexagon = runes, card = cards
      const mx = size * 0.2, kc = kindColor(w.reward);
      ctx.fillStyle = kc; ctx.beginPath();
      if (w.reward.coins) ctx.arc(mx, 0, 6, 0, Math.PI * 2);
      else if (w.reward.gems) { ctx.moveTo(mx, -7); ctx.lineTo(mx + 6, 0); ctx.lineTo(mx, 7); ctx.lineTo(mx - 6, 0); }
      else if (w.reward.runes) for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.lineTo(mx + Math.cos(a) * 6.5, Math.sin(a) * 6.5); }
      else ctx.rect(mx - 4, -6, 8, 12);
      ctx.closePath(); ctx.fill();
      if (w.reward.crates) { ctx.fillStyle = '#ff8a3d'; ctx.fillRect(mx + 9, -4, 8, 8); }
      ctx.restore();
    });
    ctx.restore();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 20, 0, Math.PI * 2); ctx.fillStyle = '#29e3f0'; ctx.fill();
    // pointer at the top
    ctx.beginPath(); ctx.moveTo(size / 2 - 10, 2); ctx.lineTo(size / 2 + 10, 2); ctx.lineTo(size / 2, 22); ctx.closePath(); ctx.fillStyle = '#ff3d7f'; ctx.fill();
    void c;
  };
  let rot = 0;
  draw(rot);
  let spinning = false;
  const spin = async (viaAd: boolean) => {
    if (spinning) return;
    if (viaAd && !(await ads.rewarded('wheel'))) return;
    spinning = true;
    const r = await backend.spinWheel(viaAd).catch(() => null);
    if (!r) { spinning = false; toast(tr(L('چرخش دیگری نداری', 'No spins left')), 'err'); return; }
    // land segment r.index under the pointer (top = -90°)
    const target = -Math.PI / 2 - (r.index * seg + seg / 2);
    const start = rot, end = target - Math.PI * 2 * 6 - ((target - start) % (Math.PI * 2));
    const t0 = performance.now(), T = 3200;
    const anim = (now: number) => {
      const k = Math.min(1, (now - t0) / T);
      rot = start + (end - start) * (1 - Math.pow(1 - k, 3));
      draw(rot);
      if (k < 1) requestAnimationFrame(anim);
      else { spinning = false; m.close(); rewardReveal(tr(L('گردونه شانس', 'Lucky wheel')), grantedToItems(r.granted)); onDone?.(); }
    };
    requestAnimationFrame(anim);
  };
  const m = modal(h('div', { class: 'wheel' },
    h('h2', { class: 'title-grad' }, tr(L('گردونه شانس', 'Lucky wheel'))),
    cv,
    h('div', { class: 'row' },
      h('button', { class: `btn primary ${st.free ? '' : 'disabled'}`, onclick: () => spin(false) }, st.free ? tr(L('چرخش رایگان', 'Free spin')) : tr(L('فردا دوباره', 'Back tomorrow'))),
      h('button', { class: `btn ad ${st.ads > 0 ? '' : 'disabled'}`, onclick: () => spin(true) }, svg('ad', 16), `${num(st.ads)}/${num(WHEEL_ADS_PER_DAY)}`)),
  ));
}

// =============================================================================================
// Daily fight milestones (shown on the quests screen)
// =============================================================================================
export function milestonesBlock(refresh: () => void): HTMLElement {
  const p = backend.profile;
  const max = MILESTONES[MILESTONES.length - 1].fights;
  return h('div', { class: 'box milestones' },
    h('div', { class: 'row space' }, h('h3', {}, svg('flame', 16), ' ', tr(L('مایل‌استون مبارزه امروز', 'Today\'s fight milestones'))), h('b', {}, ltr(`${num(p.daily.fights)} / ${num(max)}`))),
    h('div', { class: 'ms-track' },
      h('div', { class: 'ms-fill', style: { width: `${Math.min(100, (p.daily.fights / max) * 100)}%` } }),
      MILESTONES.map((ms, i) => {
        const got = p.daily.ms.includes(i);
        const ready = !got && p.daily.fights >= ms.fights;
        return h('button', { class: `ms ${got ? 'got' : ready ? 'ready' : ''}`, style: { insetInlineStart: `${(ms.fights / max) * 100}%` }, onclick: async () => {
          if (!ready) { modal(h('div', { class: 'pick' }, h('h3', {}, `${num(ms.fights)} ${tr(L('مبارزه', 'fights'))}`), rewardChips(ms.reward))); return; }
          const g = await backend.claimMilestone(i).catch(() => null);
          if (g) rewardReveal(`${num(ms.fights)} ${tr(L('مبارزه', 'fights'))}`, grantedToItems(g));
          refresh();
        } }, svg(got ? 'check' : 'gift', 14), h('small', {}, num(ms.fights)));
      })));
}

export function mapProgressText(): Child {
  const p = backend.profile;
  return `${num(Math.min(p.map.cleared + 1, MAP_SIZE))}/${num(MAP_SIZE)}`;
}
export { FIGHTERS };
