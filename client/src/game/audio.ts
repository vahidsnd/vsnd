import type { GameEvent } from '@nb/shared';

/**
 * Fully synthesised audio (no asset files): punchy SFX + a looping synthwave track.
 */
class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxGain!: GainNode;
  musicGain!: GainNode;
  sfxOn = true;
  musicOn = true;
  private musicTimer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private noiseBuf: AudioBuffer | null = null;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.28; this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setSfx(on: boolean) { this.sfxOn = on; }
  setMusic(on: boolean) { this.musicOn = on; if (!on) this.stopMusic(); }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, when = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, when = 0, target?: GainNode) {
    if (!this.ctx || !this.noiseBuf) return;
    if (!target && !this.sfxOn) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(target ?? this.sfxGain);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  ui() { this.tone(880, 0.06, 'square', 0.08, 1320); }
  coin() { this.tone(1046, 0.08, 'square', 0.08); this.tone(1568, 0.14, 'square', 0.08, undefined, 0.07); }
  reward() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.12, undefined, i * 0.08)); }

  event(e: GameEvent, local: boolean) {
    switch (e.t) {
      case 'hit': {
        const p = Math.min(1, e.kb / 160);
        this.noise(0.08 + p * 0.15, 0.35 + p * 0.3, 1800 - p * 1200, 0.8);
        this.tone(160 - p * 80, 0.12 + p * 0.2, 'sine', 0.5 + p * 0.3, 40);
        if (e.kb > 110) this.tone(90, 0.4, 'sawtooth', 0.15, 30);
        break;
      }
      case 'shieldhit': this.tone(1200, 0.08, 'triangle', 0.15, 900); break;
      case 'swing': this.noise(0.09, 0.12, 3000, 2); break;
      case 'jump': if (local) this.tone(320, 0.12, 'square', 0.07, 640); break;
      case 'land': this.noise(0.05, 0.05, 400); break;
      case 'proj': this.tone(600, 0.15, 'sawtooth', 0.07, 300); break;
      case 'ko':
        this.noise(0.9, 0.6, 500, 0.5);
        this.tone(220, 0.8, 'sawtooth', 0.25, 30);
        this.tone(880, 0.5, 'square', 0.08, 110, 0.05);
        break;
      case 'explode': this.noise(0.5, 0.5, 300, 0.4); this.tone(80, 0.4, 'sine', 0.4, 30); break;
      case 'shieldbreak': this.tone(1500, 0.6, 'square', 0.12, 200); break;
      case 'counter': this.tone(1320, 0.2, 'triangle', 0.2, 1760); break;
      case 'spawn': this.tone(440, 0.3, 'triangle', 0.1, 880); break;
      case 'end': [784, 659, 523].forEach((f, i) => this.tone(f, 0.25, 'square', 0.1, undefined, i * 0.12)); break;
    }
  }

  // ---- music: 16-step synthwave loop ------------------------------------------------------
  startMusic(kind: 'menu' | 'battle' = 'menu') {
    if (!this.ctx || !this.musicOn || this.musicTimer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    const bpm = kind === 'battle' ? 128 : 100;
    const stepDur = 60 / bpm / 4;
    const roots = kind === 'battle' ? [45, 45, 41, 43] : [45, 41, 48, 43]; // A F C G (midi)
    const arp = [0, 7, 12, 15, 12, 7, 3, 7];
    const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
    const sched = () => {
      if (!this.ctx) return;
      while (this.nextTime < this.ctx.currentTime + 0.15) {
        const bar = Math.floor(this.step / 16) % 4;
        const s = this.step % 16;
        const root = roots[bar];
        const t = this.nextTime - this.ctx.currentTime;
        // bass on 8ths
        if (s % 2 === 0) this.mtone(mtof(root - 12), stepDur * 1.8, 'sawtooth', 0.22, t);
        // arp
        this.mtone(mtof(root + 12 + arp[s % 8]), stepDur * 0.9, 'square', 0.05, t);
        // drums
        if (kind === 'battle' ? s % 4 === 0 : s % 8 === 0) this.kick(t);
        if (s % 8 === 4) this.noise(0.12, 0.25, 1800, 0.7, t, this.musicGain);
        if (s % 2 === 1) this.noise(0.03, 0.08, 8000, 1, t, this.musicGain);
        this.nextTime += stepDur;
        this.step++;
      }
    };
    this.musicTimer = window.setInterval(sched, 50);
  }
  stopMusic() { if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  private mtone(freq: number, dur: number, type: OscillatorType, vol: number, when: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }
  private kick(when: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.22);
  }
}

export const audio = new Audio();
