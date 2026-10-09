import { tierFor, xpForLevel, type CrateResult, getFighter, getSpell, FIGHTERS, type Granted } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { audio } from '../game/audio.ts';
import { previewFighter } from '../game/art.ts';
import { t, num, isFa, loc } from '../i18n.ts';
import { svg } from './icons.ts';

export type Child = Node | string | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else (el.style as any)[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') {
      const ev = k.slice(2).toLowerCase();
      el.addEventListener(ev, (e) => { if (ev === 'click') audio.ui(); v(e); });
    } else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export interface Screen { el: HTMLElement; destroy?: () => void; bannerAd?: boolean }

let current: Screen | null = null;
let root: HTMLElement;
let onScreenChange: (s: Screen) => void = () => {};

export function initDom(r: HTMLElement, onChange: (s: Screen) => void) { root = r; onScreenChange = onChange; }

export function show(make: () => Screen) {
  if (current) { current.destroy?.(); cleanup(current.el); current.el.remove(); }
  current = make();
  current.el.classList.add('screen');
  root.querySelector('#ui')!.appendChild(current.el);
  onScreenChange(current);
}

// ---- small widgets ---------------------------------------------------------------------------
export function icon(kind: 'coin' | 'gem' | 'xp' | 'rune') {
  return h('span', { class: `ico ico-${kind}` });
}

export function currency(kind: 'coin' | 'gem' | 'rune', amount: number) {
  return h('span', { class: 'cur' }, icon(kind), num(amount));
}

export function topBar(opts: { back?: () => void; title?: string } = {}) {
  const p = backend.profile;
  const xpNeed = xpForLevel(p.level);
  const tier = tierFor(p.rank.mmr);
  const coins = h('span', { class: 'cur' }, icon('coin'), num(p.coins));
  const gems = h('span', { class: 'cur' }, icon('gem'), num(p.gems));
  const runes = h('span', { class: 'cur rune' }, icon('rune'), num(p.runes ?? 0));
  const bar = h('div', { class: opts.title ? 'topbar titled' : 'topbar' },
    opts.back ? h('button', { class: 'btn icon back', onclick: opts.back }, svg(isFa() ? 'chevron' : 'back', 20)) : null,
    opts.title ? h('h2', { class: 'title' }, opts.title) : h('div', { class: 'player-chip', onclick: () => import('./meta.ts').then((m) => show(m.profileScreen)) },
      h('div', { class: 'lvl', style: { '--xp': `${Math.round((p.xp / xpNeed) * 100)}%` } as any }, h('span', {}, num(p.level))),
      h('div', { class: 'pinfo' },
        h('div', { class: 'pname' }, p.name, ' ', h('span', { class: 'tier', style: { color: tier.tier.color } }, isFa() ? tier.tier.nameFa : tier.tier.name)),
        h('div', { class: 'xpbar' }, h('div', { style: { width: `${(p.xp / xpNeed) * 100}%` } })),
      ),
    ),
    h('div', { class: 'grow' }),
    h('button', { class: 'wallet', onclick: () => import('./meta.ts').then((m) => show(() => m.shopScreen('gems'))) }, coins, gems, runes, h('span', { class: 'plus' }, '+')),
  );
  const un = backend.onChange((np) => {
    coins.lastChild!.textContent = num(np.coins);
    gems.lastChild!.textContent = num(np.gems);
    runes.lastChild!.textContent = num(np.runes ?? 0);
  });
  (bar as any)._cleanup = un;
  return bar;
}

/** Small "locked" helper: requirement text for a feature that isn't open yet. */
export function lockText(req: { level?: number; matches?: number; map?: number }) {
  if (req.map) return isFa() ? `نقشه ${num(req.map)}` : `Map ${num(req.map)}`;
  if (req.level) return `${t('level')} ${num(req.level)}`;
  return `${num(req.matches ?? 0)} ${t('matchesShort')}`;
}

export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  const el = h('div', { class: `toast ${kind}` }, msg);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 2200);
}

export function modal(content: Child, opts: { onClose?: () => void; closable?: boolean; cls?: string } = {}) {
  const close = () => { wrap.remove(); opts.onClose?.(); };
  const wrap = h('div', { class: 'modal-wrap', onclick: (e: Event) => { if (e.target === wrap && opts.closable !== false) close(); } },
    h('div', { class: `modal ${opts.cls ?? ''}` },
      opts.closable !== false ? h('button', { class: 'btn icon modal-x', onclick: close }, svg('close', 18)) : null,
      content,
    ),
  );
  document.body.appendChild(wrap);
  return { close, el: wrap };
}

export function confirmBox(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const m = modal(h('div', { class: 'confirm' },
      h('p', {}, msg),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, t('cancel')),
        h('button', { class: 'btn primary', onclick: () => { m.close(); resolve(true); } }, 'OK'),
      ),
    ), { closable: false });
  });
}

/** Animated reveal for rewards (crate, pass, login…) */
export type RewardItem = { kind: 'coin' | 'gem' | 'fighter' | 'skin' | 'xp' | 'rune' | 'cards' | 'spell'; amount?: number; id?: string };
export function rewardReveal(title: string, items: RewardItem[]) {
  audio.reward();
  const cards = items.map((it, i) => {
    let body: Child;
    if (it.kind === 'coin' || it.kind === 'gem' || it.kind === 'rune') body = [h('div', { class: `big-ico ico-${it.kind}` }), h('b', {}, `+${num(it.amount ?? 0)}`)];
    else if (it.kind === 'cards') body = [h('div', { class: 'card-stack' }, fighterCanvas(it.id!, 0, 80)), h('b', {}, `+${num(it.amount ?? 0)} ${isFa() ? 'کارت' : 'cards'}`), h('small', {}, loc(getFighter(it.id!)))];
    else if (it.kind === 'spell') { const sp = getSpell(it.id); body = [h('div', { class: 'big-ico spell-ico', style: { '--c': sp?.color ?? '#fff' } as any }, svg('sparkles', 44)), h('b', {}, sp ? (isFa() ? sp.nameFa : sp.name) : '?')]; }
    else if (it.kind === 'fighter') body = [fighterCanvas(it.id!, 0, 110), h('b', {}, loc(getFighter(it.id!)))];
    else if (it.kind === 'skin') {
      const f = getFighterBySkin(it.id!);
      body = f ? [fighterCanvas(f.f, f.idx, 110), h('b', {}, loc(getFighter(f.f).skins[f.idx]))] : h('b', {}, '?');
    } else body = h('b', {}, `+${num(it.amount ?? 0)} XP`);
    return h('div', { class: 'reward-card', style: { animationDelay: `${i * 0.12}s` } }, body);
  });
  const m = modal(h('div', { class: 'reveal' }, h('h2', { class: 'shine' }, title), h('div', { class: 'reward-row' }, cards),
    h('button', { class: 'btn primary', onclick: () => m.close() }, 'OK')));
  return m;
}

export function crateToItems(c: CrateResult | null | undefined): RewardItem[] {
  if (!c) return [];
  if (c.kind === 'coins') return [{ kind: 'coin', amount: c.amount }];
  if (c.kind === 'gems') return [{ kind: 'gem', amount: c.amount }];
  if (c.kind === 'runes') return [{ kind: 'rune', amount: c.amount }];
  if (c.kind === 'cards') return [{ kind: 'cards', amount: c.amount, id: c.id }];
  if (c.id) return [{ kind: c.kind, id: c.id }];
  return [{ kind: 'coin', amount: c.dupCoins }];
}

/** Everything a generic reward granted, as reveal cards. */
export function grantedToItems(g: Granted | null | undefined): RewardItem[] {
  if (!g) return [];
  const r = g.reward;
  const out: RewardItem[] = [];
  if (r.coins) out.push({ kind: 'coin', amount: r.coins });
  if (r.gems) out.push({ kind: 'gem', amount: r.gems });
  if (r.runes) out.push({ kind: 'rune', amount: r.runes });
  for (const f of r.fighters ?? []) out.push({ kind: 'fighter', id: f });
  for (const s of r.skins ?? []) out.push({ kind: 'skin', id: s });
  for (const s of r.spells ?? []) out.push({ kind: 'spell', id: s });
  for (const [f, n] of Object.entries(g.cards)) out.push({ kind: 'cards', id: f, amount: n });
  for (const c of g.crates) out.push(...crateToItems(c));
  if (r.xp) out.push({ kind: 'xp', amount: r.xp });
  return out;
}

export function getFighterBySkin(skinId: string): { f: string; idx: number } | null {
  for (const id of FIGHTERS.map((f) => f.id)) {
    const idx = getFighter(id).skins.findIndex((s) => s.id === skinId);
    if (idx >= 0) return { f: id, idx };
  }
  return null;
}

// One shared ~30 fps ticker for all animated menu previews (instead of one rAF loop per canvas).
const animated = new Set<(now: number) => boolean>();
let tickerOn = false;
let lastTick = 0;
function tick(now: number) {
  if (now - lastTick >= 33) {
    lastTick = now;
    for (const fn of [...animated]) if (!fn(now)) animated.delete(fn);
  }
  if (animated.size) requestAnimationFrame(tick); else tickerOn = false;
}

/** Fighter preview for menus. Small thumbnails are drawn once; big ones (≥110px) animate. */
export function fighterCanvas(charId: string, skin: number, size: number, action: 'idle' | 'air' | 'run' = 'idle') {
  const q = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'fcanvas', width: Math.round(size * q), height: Math.round(size * q), style: { width: `${size}px`, height: `${size}px` } });
  const ctx = c.getContext('2d')!;
  const def = getFighter(charId);
  const scale = (c.width * 0.62) / (def.stats.h + 30);
  const t0 = performance.now();
  const draw = (now: number) => {
    ctx.clearRect(0, 0, c.width, c.height);
    previewFighter(ctx, charId, skin, c.width / 2, c.height * 0.84, scale, (now - t0) / 1000, action);
  };
  draw(t0);
  if (size >= 110) {
    let seen = false, waited = 0;
    animated.add((now) => {
      if (!c.isConnected) { if (seen || ++waited > 60) return false; return true; }
      seen = true;
      draw(now);
      return true;
    });
    if (!tickerOn) { tickerOn = true; requestAnimationFrame(tick); }
  }
  return c;
}

export function cleanup(el: HTMLElement) {
  el.querySelectorAll('*').forEach((n) => (n as any)._cleanup?.());
  (el as any)._cleanup?.();
}
