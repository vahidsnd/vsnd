import { createGame, STAGES, COUNTDOWN, type MatchConfig } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { prefs, setPref, type CtlLayout } from '../services/prefs.ts';
import { TouchControls, TOUCH_BUTTONS } from '../game/input.ts';
import { Renderer } from '../game/renderer.ts';
import { isFa, num } from '../i18n.ts';
import { h, toast, confirmBox, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { picon } from './proicons.ts';
import { introOnce } from './tutorial.ts';

type L = { fa: string; en: string };
const D = {
  title: { fa: 'چیدمان دکمه‌ها', en: 'Control layout' },
  hint: { fa: 'دکمه را بکش تا جابه‌جا شود؛ گوشه‌اش را بکش تا بزرگ و کوچک شود.', en: 'Drag a button to move it; drag its corner to resize.' },
  save: { fa: 'ذخیره', en: 'Save' },
  reset: { fa: 'پیش‌فرض', en: 'Default' },
  resetQ: { fa: 'چیدمان به حالت پیش‌فرض برگردد؟', en: 'Restore the default layout?' },
  cancel: { fa: 'انصراف', en: 'Cancel' },
  leaveQ: { fa: 'تغییرات ذخیره نشده. خارج می‌شوی؟', en: 'Leave without saving?' },
  saved: { fa: 'چیدمان ذخیره شد', en: 'Layout saved' },
  size: { fa: 'اندازه', en: 'Size' },
  stick: { fa: 'ناحیه جوی‌استیک', en: 'Stick area' },
  lefty: { fa: 'حالت چپ‌دست: چیدمان آینه‌ای می‌شود', en: 'Left-handed mode: the layout is mirrored' },
  pick: { fa: 'یک دکمه را انتخاب کن', en: 'Pick a button' },
  names: {
    attack: { fa: 'حمله', en: 'Attack' }, special: { fa: 'ویژه', en: 'Special' }, jump: { fa: 'پرش', en: 'Jump' }, shield: { fa: 'سپر', en: 'Shield' },
    grab: { fa: 'گرفتن', en: 'Grab' }, smash: { fa: 'اسمش', en: 'Smash' }, magic: { fa: 'جادو', en: 'Magic' }, stick: { fa: 'جوی‌استیک', en: 'Stick' },
  } as Record<string, L>,
};
const tr = (l: L) => (isFa() ? l.fa : l.en);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Settings → Controls → layout editor: drag / resize every touch button and the stick zone over a
 * real arena. Saved in device prefs (right-handed frame, mirrored in left-handed mode).
 */
export function controlsEditorScreen(back: () => void): Screen {
  const canvas = h('canvas', { class: 'game-canvas' });
  const el = h('div', { class: 'game ctl-editor' }, canvas);
  const renderer = new Renderer(canvas);
  const p = backend.profile;
  const stage = STAGES.find((s) => s.id === 'bazaar') ?? STAGES[0];
  const cfg: MatchConfig = {
    stageId: stage.id, stocks: 3, timeLimit: 0, teams: false,
    players: [{ charId: p.selFighter, skin: backend.selectedSkin(p.selFighter), team: 0, name: p.name }, { charId: 'boulder', skin: 1, team: 1, name: 'CPU', bot: true }],
  };
  const state = createGame(cfg);
  state.frame = COUNTDOWN + 240; // past the "GO!" banner
  const paint = () => renderer.draw(state, { localSlots: [0], time: 0, instantCam: true });

  let touch = new TouchControls(el, { editor: true, layout: prefs.layout });
  touch.el.classList.add('has-magic');
  const zoneLabel = h('span', { class: 'ctl-zone-label' }, picon('layout', 14), tr(D.stick));
  let layout: CtlLayout | null = null;
  let defaults: CtlLayout | null = null;
  let dirty = false;
  let sel = '';

  // selection frame with a resize handle
  const handle = h('div', { class: 'ctl-handle' });
  const frame = h('div', { class: 'ctl-frame' }, handle);
  const sizeOut = h('b', { class: 'ctl-size-val', dir: 'ltr' }, '—');
  const selName = h('span', { class: 'ctl-sel-name' }, tr(D.pick));

  const measureDefaults = (): CtlLayout => {
    const probe = new TouchControls(el, { editor: true, layout: null });
    probe.el.classList.add('has-magic');
    probe.el.style.visibility = 'hidden';
    const m = probe.measure();
    probe.destroy();
    return m;
  };
  const node = (k: string): HTMLElement | null => (k === 'stick' ? touch.el.querySelector('.stick-zone') : touch.el.querySelector(`.tb[data-k=${k}]`));
  const placeFrame = () => {
    const n = sel ? node(sel) : null;
    if (!n) { frame.style.display = 'none'; sizeOut.textContent = '—'; selName.textContent = tr(D.pick); return; }
    const r = n.getBoundingClientRect(), r0 = el.getBoundingClientRect();
    Object.assign(frame.style, { display: 'block', left: `${r.left - r0.left - 3}px`, top: `${r.top - r0.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    // handle on the outer-bottom corner, flipped when it would leave the screen
    const right = r.right + 14 < r0.right;
    handle.classList.toggle('flip', !right);
    selName.textContent = tr(D.names[sel] ?? { fa: sel, en: sel });
    sizeOut.textContent = sel === 'stick' ? `${num(Math.round((layout!.stick.w) * 100))}%` : `${num(Math.round((layout!.btn[sel]?.s ?? 1) * 100))}%`;
    for (const b of touch.el.querySelectorAll('.sel')) b.classList.remove('sel');
    n.classList.add('sel');
  };
  const apply = () => { touch.applyLayout(layout); zoneLabel.remove(); touch.el.querySelector('.stick-zone')?.append(zoneLabel); placeFrame(); };
  const setSize = (mult: number) => {
    if (!layout || !sel) return;
    if (sel === 'stick') {
      const s = layout.stick, nw = clamp(s.w * mult, 0.15, 0.7), nh = clamp(s.h * mult, 0.25, 1);
      layout.stick = { ...s, w: nw, h: nh, y: clamp(s.y, 0, 1 - nh) };
    } else {
      const b = layout.btn[sel];
      if (b) b.s = clamp(Math.round(b.s * mult * 100) / 100, 0.6, 1.8);
    }
    dirty = true; apply();
  };

  // ---- dragging --------------------------------------------------------------------------------
  let drag: { id: number; kind: 'move' | 'size'; k: string; sx: number; sy: number; start: CtlLayout } | null = null;
  const W = () => touch.el.clientWidth || innerWidth;
  const H = () => touch.el.clientHeight || innerHeight;
  const hit = (target: EventTarget | null): string => {
    const t = target as HTMLElement | null;
    const b = t?.closest?.('.tb') as HTMLElement | null;
    if (b) return b.dataset.k ?? '';
    if (t?.closest?.('.stick-zone')) return 'stick';
    return '';
  };
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.ctl-bar')) return;
    if (!layout) return;
    const kind = e.target === handle ? 'size' : 'move';
    const k = kind === 'size' ? sel : hit(e.target);
    if (!k) { sel = ''; placeFrame(); for (const b of touch.el.querySelectorAll('.sel')) b.classList.remove('sel'); return; }
    sel = k;
    drag = { id: e.pointerId, kind, k, sx: e.clientX, sy: e.clientY, start: structuredClone(layout) };
    try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
    e.preventDefault();
    placeFrame();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !layout) return;
    const w = W(), hh = H();
    const dx = ((e.clientX - drag.sx) / w) * (touch.lefty ? -1 : 1), dy = (e.clientY - drag.sy) / hh;
    if (drag.k === 'stick') {
      const s0 = drag.start.stick;
      if (drag.kind === 'move') layout.stick = { ...s0, x: clamp(s0.x + dx, 0, 1 - s0.w), y: clamp(s0.y + dy, 0, 1 - s0.h) };
      else layout.stick = { ...s0, w: clamp(s0.w + dx, 0.15, Math.min(0.7, 1 - s0.x)), h: clamp(s0.h + dy, 0.25, 1 - s0.y) };
    } else {
      const b0 = drag.start.btn[drag.k];
      if (!b0) return;
      if (drag.kind === 'move') layout.btn[drag.k] = { ...b0, x: clamp(b0.x + dx, 0.02, 0.98), y: clamp(b0.y + dy, 0.05, 0.97) };
      else {
        const base = TOUCH_BUTTONS[drag.k].size * prefs.btnScale;
        const grow = (Math.abs(e.clientX - drag.sx) > Math.abs(e.clientY - drag.sy) ? (e.clientX - drag.sx) * (touch.lefty || handle.classList.contains('flip') ? -1 : 1) : e.clientY - drag.sy) * 2;
        layout.btn[drag.k] = { ...b0, s: clamp(Math.round(((b0.s * base + grow) / base) * 100) / 100, 0.6, 1.8) };
      }
    }
    dirty = true;
    apply();
  });
  const endDrag = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // ---- toolbar ---------------------------------------------------------------------------------
  const leave = async () => { if (!dirty || (await confirmBox(tr(D.leaveQ)))) back(); };
  const bar = h('div', { class: 'ctl-bar' },
    h('button', { class: 'btn icon small', onclick: leave, 'aria-label': tr(D.cancel) }, svg(isFa() ? 'chevron' : 'back', 16)),
    h('div', { class: 'ctl-title' }, h('b', {}, tr(D.title)), h('small', { class: 'muted' }, touch.lefty ? tr(D.lefty) : tr(D.hint))),
    h('div', { class: 'ctl-size' }, selName,
      h('button', { class: 'btn icon small', onclick: () => setSize(1 / 1.1), 'aria-label': '-' }, '−'), sizeOut,
      h('button', { class: 'btn icon small', onclick: () => setSize(1.1), 'aria-label': '+' }, '+')),
    h('button', { class: 'btn small ghost ctl-reset', onclick: async () => {
      if (!(await confirmBox(tr(D.resetQ)))) return;
      layout = structuredClone(defaults!); dirty = true; apply();
    } }, svg('refresh', 14), tr(D.reset)),
    h('button', { class: 'btn small primary ctl-save', onclick: () => {
      // the default layout is stored as "no custom layout" so future default changes still apply
      setPref('layout', JSON.stringify(layout) === JSON.stringify(defaults) ? null : layout);
      dirty = false; toast(tr(D.saved), 'ok'); back();
    } }, svg('check', 14), tr(D.save)),
  );
  el.append(frame, bar);

  const onResize = () => { renderer.resize(); paint(); apply(); };
  addEventListener('resize', onResize);
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    renderer.resize();
    paint();
    defaults = measureDefaults();
    layout = structuredClone(prefs.layout ?? defaults);
    // older saves may miss a button → fill from the defaults
    for (const k of Object.keys(defaults.btn)) layout.btn[k] ??= defaults.btn[k];
    touch.destroy();
    touch = new TouchControls(el, { editor: true, layout });
    touch.el.classList.add('has-magic');
    el.insertBefore(touch.el, frame);
    apply();
    introOnce('ctl-editor', [{ target: '.ctl-bar', title: { fa: 'چیدمان دلخواه', en: 'Your own layout' }, text: { fa: 'هر دکمه و ناحیه جوی‌استیک را بکش و جابه‌جا کن. با گوشه یا دکمه‌های + و − اندازه را عوض کن و در پایان ذخیره بزن.', en: 'Drag any button or the stick area. Resize with the corner handle or + / −, then save.' } }]);
  });
  return { el, destroy: () => { removeEventListener('resize', onResize); touch.destroy(); } };
}
