import { getSpell, type ProjectileState } from '@nb/shared';

/** Spell projectiles: bright, readable, cheap (no shadowBlur; layered alpha shapes). */
export function drawSpellProjectile(ctx: CanvasRenderingContext2D, p: ProjectileState, time: number) {
  const r = p.def.r;
  const k = 1 - p.life / p.def.life; // 0 → 1 over the projectile's life
  switch (p.kind) {
    case 'sp_nova': {
      const rr = r * (0.35 + k * 0.75);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 3; i > 0; i--) {
        ctx.globalAlpha = (1 - k) * 0.22 * i;
        ctx.fillStyle = i === 1 ? '#fff1c4' : i === 2 ? '#ffb347' : '#ff5a1f';
        ctx.beginPath(); ctx.arc(0, 0, rr * (0.45 + i * 0.2), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'sp_frost': {
      ctx.rotate(p.vx < 0 ? Math.PI : 0);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#7fd8ff';
      ctx.beginPath(); ctx.ellipse(-26, 0, 34, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8fbff'; ctx.strokeStyle = '#2b6f9a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(r * 1.6, 0); ctx.lineTo(0, -r * 0.55); ctx.lineTo(-r * 1.4, 0); ctx.lineTo(0, r * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7fd8ff'; ctx.beginPath(); ctx.moveTo(-r * 1.2, 0); ctx.lineTo(r * 1.3, 0); ctx.stroke();
      break;
    }
    case 'sp_thunder': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#fff6a8'; ctx.lineWidth = 5; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(0, -420);
      for (let y = -400; y <= 0; y += 40) ctx.lineTo(Math.sin(y * 0.7 + time * 40) * 16, y);
      ctx.stroke();
      ctx.lineWidth = 12; ctx.globalAlpha = 0.25; ctx.strokeStyle = '#ffe45c'; ctx.stroke();
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#ffe45c';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'sp_meteor': {
      const ang = Math.atan2(p.vy, p.vx);
      ctx.rotate(ang);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) { ctx.globalAlpha = 0.18 * (4 - i); ctx.fillStyle = i % 2 ? '#ff4f5e' : '#ffb347'; ctx.beginPath(); ctx.ellipse(-r * (1 + i * 0.7), 0, r * (1.2 - i * 0.2), r * (0.8 - i * 0.12), 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#4a2a2a'; ctx.strokeStyle = '#110808'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff7a3d'; ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.2, r * 0.35, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'sp_gale': {
      ctx.scale(p.vx < 0 ? -1 : 1, 1);
      ctx.strokeStyle = '#a5f0e0'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.55 - i * 0.1;
        const o = ((time * 300 + i * 30) % 60) - 30;
        ctx.beginPath(); ctx.arc(o - 20, 0, r * (0.5 + i * 0.18), -1.1, 1.1); ctx.stroke();
      }
      break;
    }
    case 'sp_shade': {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#b48cff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.7); ctx.lineTo(r, r * 0.7); ctx.moveTo(r, -r * 0.7); ctx.lineTo(-r, r * 0.7); ctx.stroke();
      ctx.fillStyle = '#2a1650'; ctx.globalAlpha = (1 - k) * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      break;
    }
    default: {
      const sp = getSpell(p.kind.slice(3));
      ctx.fillStyle = sp?.color ?? '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
