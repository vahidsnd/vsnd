import { getFighter, ITEM_LIFE, staminaHp, staminaMax, type FighterState, type GameState, type ItemKind } from '@nb/shared';
import { INK, star } from './art.ts';

// =====================================================================================
//  Match-rule visuals: items on the stage, item buffs on fighters, the held bomb,
//  the co-op boss HP bar and the survival wave counter. Cheap shapes only (no shadowBlur).
// =====================================================================================

export const ITEM_COLORS: Record<ItemKind, string> = { heal: '#ff4f6d', bomb: '#ffb347', boots: '#2ee6ff', bubble: '#9ad8ff', mana: '#b48cff' };
export const ITEM_NAMES: Record<ItemKind, { fa: string; en: string }> = {
  heal: { fa: 'درمان', en: 'Heal' }, bomb: { fa: 'بمب', en: 'Bomb' }, boots: { fa: 'کفش سرعت', en: 'Speed boots' },
  bubble: { fa: 'حباب محافظ', en: 'Shield bubble' }, mana: { fa: 'گوی جادو', en: 'Mana orb' },
};

/** One item icon centred on (0,0), radius ~r. Used on the stage, in the HUD and in menus. */
export function drawItemIcon(ctx: CanvasRenderingContext2D, kind: ItemKind, r: number, time: number) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, r * 0.16);
  switch (kind) {
    case 'heal': {
      // capsule: red / white halves with a plus
      ctx.save(); ctx.rotate(-0.5);
      const w = r * 1.9, hh = r * 1.0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(-w / 2, -hh / 2, w, hh, hh / 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -hh, w / 2, hh * 2); ctx.clip();
      ctx.fillStyle = '#ff4f6d'; ctx.beginPath(); ctx.roundRect(-w / 2, -hh / 2, w, hh, hh / 2); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.roundRect(-w / 2, -hh / 2, w, hh, hh / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(-w * 0.36, -hh * 0.32, w * 0.22, hh * 0.14);
      ctx.restore();
      ctx.fillStyle = '#ff4f6d';
      ctx.fillRect(r * 0.42, -r * 0.12 - r * 0.62, r * 0.16, r * 0.5); ctx.fillRect(r * 0.25, -r * 0.62 + r * 0.05, r * 0.5, r * 0.16);
      break;
    }
    case 'bomb': {
      ctx.fillStyle = '#2a2140';
      ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.82, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.18, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b5a78'; ctx.fillRect(-r * 0.2, -r * 0.86, r * 0.4, r * 0.24); ctx.strokeRect(-r * 0.2, -r * 0.86, r * 0.4, r * 0.24);
      ctx.strokeStyle = '#c9a26b'; ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.beginPath(); ctx.moveTo(0, -r * 0.86); ctx.quadraticCurveTo(r * 0.3, -r * 1.25, r * 0.55, -r * 1.1); ctx.stroke();
      const fl = 0.7 + 0.3 * Math.sin(time * 30);
      star(ctx, r * 0.58, -r * 1.12, r * 0.32 * fl, '#ffd23f', time * 8);
      break;
    }
    case 'boots': {
      ctx.fillStyle = '#2ee6ff';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.8); ctx.lineTo(r * 0.05, -r * 0.8); ctx.lineTo(r * 0.1, -r * 0.05);
      ctx.quadraticCurveTo(r * 0.95, 0, r * 0.95, r * 0.5); ctx.lineTo(-r * 0.55, r * 0.5); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-r * 0.55, r * 0.3, r * 1.5, r * 0.2); ctx.strokeRect(-r * 0.55, r * 0.3, r * 1.5, r * 0.2);
      // wing
      ctx.fillStyle = '#fff6c2';
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.45);
      ctx.quadraticCurveTo(-r * 1.25, -r * 0.95, -r * 1.2, -r * 0.2); ctx.quadraticCurveTo(-r * 0.95, -r * 0.35, -r * 0.5, -r * 0.1);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(46,230,255,0.8)'; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(-r * (1.1 + i * 0.25), r * (0.05 + i * 0.25)); ctx.lineTo(-r * (0.7 + i * 0.25), r * (0.05 + i * 0.25)); ctx.stroke(); }
      break;
    }
    case 'bubble': {
      ctx.fillStyle = 'rgba(154,216,255,0.35)';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, r * 0.12); ctx.stroke();
      ctx.strokeStyle = '#9ad8ff'; ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0.3 + time * 2, 2 + time * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.12, -0.7, 0, Math.PI * 2); ctx.fill();
      // little shield crest
      ctx.fillStyle = '#5ab8ff'; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.beginPath(); ctx.moveTo(0, -r * 0.35); ctx.lineTo(r * 0.3, -r * 0.22); ctx.lineTo(r * 0.25, r * 0.15); ctx.lineTo(0, r * 0.38); ctx.lineTo(-r * 0.25, r * 0.15); ctx.lineTo(-r * 0.3, -r * 0.22); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'mana': {
      ctx.save(); ctx.rotate(Math.sin(time * 2) * 0.15);
      ctx.fillStyle = '#7a4ce0';
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.62, -r * 0.15); ctx.lineTo(0, r * 0.95); ctx.lineTo(-r * 0.62, -r * 0.15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a8ff';
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.62, -r * 0.15); ctx.lineTo(0, -r * 0.05); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.moveTo(-r * 0.12, -r * 0.7); ctx.lineTo(-r * 0.4, -r * 0.18); ctx.lineTo(-r * 0.2, -r * 0.18); ctx.closePath(); ctx.fill();
      ctx.restore();
      star(ctx, r * 0.75, -r * 0.7, r * 0.22 * (0.7 + 0.3 * Math.sin(time * 9)), '#ffffff', time * 3);
      break;
    }
  }
}

/** Items lying on the stage (world space). */
export function drawItems(ctx: CanvasRenderingContext2D, state: GameState, time: number) {
  if (!state.items?.length) return;
  for (const it of state.items) {
    const pop = Math.min(1, it.t / 20);
    const left = ITEM_LIFE - it.t;
    if (left < 120 && Math.floor(time * 10) % 2 === 0) continue; // blink before despawning
    const col = ITEM_COLORS[it.kind];
    const bob = Math.sin(time * 4 + it.id) * 3;
    ctx.save();
    ctx.translate(it.x, it.y);
    // glowing base ring
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 6 + it.id);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0, -1, 26 * pop, 6 * pop, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.moveTo(-18 * pop, -1); ctx.lineTo(-8 * pop, -60); ctx.lineTo(8 * pop, -60); ctx.lineTo(18 * pop, -1); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.translate(0, -30 + bob);
    ctx.scale(pop, pop);
    drawItemIcon(ctx, it.kind, 18, time);
    ctx.restore();
  }
}

/** Buff visuals on one fighter (world space): shield bubble, speed streaks, a held bomb. */
export function drawBuffs(ctx: CanvasRenderingContext2D, f: FighterState, time: number) {
  if (f.action === 'dead' || (!f.bub && !f.spd && !f.held)) return;
  const st = getFighter(f.charId).stats;
  ctx.save();
  if (f.bub) {
    const r = Math.max(st.w, st.h) * 0.7;
    const fade = f.bub < 60 && Math.floor(time * 12) % 2 === 0 ? 0.4 : 1;
    ctx.globalAlpha = 0.22 * fade; ctx.fillStyle = '#9ad8ff';
    ctx.beginPath(); ctx.arc(f.x, f.y - st.h * 0.5, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = '#5ab8ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y - st.h * 0.5, r * 0.86, time * 3, time * 3 + 1.4); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (f.spd) {
    const moving = Math.abs(f.vx) > 1;
    ctx.strokeStyle = '#2ee6ff'; ctx.lineWidth = 3; ctx.globalAlpha = moving ? 0.8 : 0.45;
    const dir = f.vx >= 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const y = f.y - 6 - i * st.h * 0.28;
      const len = (moving ? 26 : 10) + ((time * 60 + i * 13) % 12);
      ctx.beginPath(); ctx.moveTo(f.x + dir * st.w * 0.45, y); ctx.lineTo(f.x + dir * (st.w * 0.45 + len), y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (f.held) {
    ctx.translate(f.x + f.facing * st.w * 0.15, f.y - st.h - 16 + Math.sin(time * 8) * 2);
    drawItemIcon(ctx, 'bomb', 14, time);
  }
  ctx.restore();
}

/** HUD text for a fighter's card: HP in stamina rules, otherwise the percent meter. */
export function hudDamageText(state: GameState, slot: number): { text: string; heat: number } | null {
  const max = staminaMax(state, slot);
  if (!max) return null;
  const hp = staminaHp(state, slot);
  return { text: `${Math.ceil(hp)}`, heat: 1 - hp / max };
}

/** Big boss HP bar at the top of the screen (co-op boss). */
export function drawBossBar(ctx: CanvasRenderingContext2D, state: GameState, w: number, name: string, time: number) {
  const b = state.boss;
  if (!b) return;
  const bw = Math.min(420, w * 0.5), x = (w - bw) / 2, y = 52, hh = 12;
  const k = Math.max(0, b.hp / b.max);
  ctx.save();
  ctx.fillStyle = 'rgba(20,11,36,0.85)'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x - 3, y - 3, bw + 6, hh + 6, 8); ctx.fill(); ctx.stroke();
  const g = ctx.createLinearGradient(x, 0, x + bw, 0);
  g.addColorStop(0, '#ff2e63'); g.addColorStop(1, '#ffb347');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, bw * k, hh, 6); ctx.fill();
  if (k < 0.25) { ctx.globalAlpha = 0.3 + 0.3 * Math.sin(time * 12); ctx.fillStyle = '#fff'; ctx.fillRect(x, y, bw * k, hh); ctx.globalAlpha = 1; }
  ctx.font = '800 11px Vazirmatn, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = INK;
  const label = `${name} · ${Math.ceil(b.hp)} / ${b.max}`;
  ctx.strokeText(label, w / 2, y + hh / 2 + 1); ctx.fillStyle = '#fff'; ctx.fillText(label, w / 2, y + hh / 2 + 1);
  ctx.restore();
}

/** Survival wave counter (top-left, under the pause button). */
export function drawWave(ctx: CanvasRenderingContext2D, state: GameState, label: string, x: number, y: number) {
  if (!state.sv) return;
  ctx.save();
  ctx.font = '900 18px Vazirmatn, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 5; ctx.strokeStyle = INK;
  const s = `${label} ${state.sv.wave}`;
  ctx.strokeText(s, x, y); ctx.fillStyle = '#ffd23f'; ctx.fillText(s, x, y);
  ctx.restore();
}
