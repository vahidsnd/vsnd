import {
  applyMatch, buyItem, claimFreeCrate, claimLogin, claimPass, claimQuest, doubleLastReward, getFighter, grantIap,
  newProfile, refreshDaily, rerollQuest,
  type BuyResult, type CrateResult, type MatchSummary, type PassReward, type Profile, type Quest, type RewardResult,
} from '@nb/shared';
import { serverHttp, store } from './platform.ts';

type Listener = (p: Profile) => void;

/**
 * Single façade over the authoritative server (online) and a local fallback (offline).
 * Offline mode runs the very same shared economy rules against a localStorage profile so the
 * game is fully playable vs CPU without a connection.
 */
class Backend {
  online = false;
  token = store.get<string>('token', '');
  profile!: Profile;
  private listeners = new Set<Listener>();

  onChange(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private set(p: Profile) { this.profile = p; if (!this.online) store.set('profile', p); this.listeners.forEach((l) => l(p)); }

  async init(): Promise<void> {
    try {
      if (!serverHttp()) throw new Error('no-server');
      if (!this.token) {
        const r = await this.req<{ token: string; profile: Profile }>('POST', '/api/guest', { name: store.get('profile', null as Profile | null)?.name });
        this.token = r.token; store.set('token', r.token);
        this.online = true; this.set(r.profile);
      } else {
        const r = await this.req<{ profile: Profile }>('GET', '/api/profile');
        this.online = true; this.set(r.profile);
      }
    } catch (e) {
      if ((e as Error).message === 'auth') { this.token = ''; store.set('token', ''); return this.init(); }
      this.online = false;
      const p = store.get<Profile | null>('profile', null) ?? newProfile('local', 'Player' + Math.floor(1000 + Math.random() * 9000));
      refreshDaily(p);
      this.set(p);
    }
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(serverHttp() + path, {
        method, signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'http-' + res.status);
      return j as T;
    } finally { clearTimeout(to); }
  }

  private async run<R>(path: string, body: unknown, local: (p: Profile) => R, pick: (j: any) => R): Promise<R> {
    if (this.online) {
      const j = await this.req<any>('POST', path, body);
      if (j.profile) this.set(j.profile);
      return pick(j);
    }
    const r = local(this.profile);
    this.set(this.profile);
    return r;
  }

  saveProfile(patch: { name?: string; selFighter?: string; selSkin?: { fighter: string; idx: number }; settings?: Partial<Profile['settings']> }) {
    const p = this.profile;
    if (patch.name) p.name = patch.name.slice(0, 16);
    if (patch.selFighter) p.selFighter = patch.selFighter;
    if (patch.selSkin) p.selSkin[patch.selSkin.fighter] = patch.selSkin.idx;
    if (patch.settings) Object.assign(p.settings, patch.settings);
    this.set(p);
    if (this.online) this.req('POST', '/api/profile', patch).catch(() => {});
  }

  claimLogin() { return this.run('/api/login/claim', {}, (p) => claimLogin(p), (j) => j.reward as { coins: number; gems: number } | null); }
  claimQuest(idx: number) { return this.run('/api/quest/claim', { idx }, (p) => claimQuest(p, idx), (j) => j.quest as Quest | null); }
  rerollQuest(idx: number, viaAd: boolean) {
    return this.run('/api/quest/reroll', { idx, viaAd }, (p) => {
      if (p.daily.rerolls > 0) p.daily.rerolls--; else if (!viaAd) return false;
      return rerollQuest(p, idx);
    }, () => true);
  }
  buy(itemId: string) { return this.run('/api/shop/buy', { itemId }, (p) => buyItem(p, itemId), (j) => j.result as BuyResult); }
  freeCrate() { return this.run('/api/crate/free', {}, (p) => claimFreeCrate(p), (j) => j.crate as CrateResult | null); }
  claimPass(tier: number, premium: boolean) {
    return this.run('/api/pass/claim', { tier, premium }, (p) => claimPass(p, tier, premium), (j) => j.result as { reward: PassReward; crate?: CrateResult } | null);
  }
  adReward(placement: 'double' | 'coins', matchId?: string) {
    return this.run('/api/ad/reward', { placement, matchId }, (p) => {
      if (placement === 'double') return doubleLastReward(p, matchId ?? '');
      p.coins += 60; return 60;
    }, (j) => j.granted as number);
  }
  verifyIap(market: string, productId: string, purchaseToken: string) {
    return this.run('/api/iap/verify', { market, productId, purchaseToken }, (p) => grantIap(p, productId), (j) => !!j.ok);
  }
  reportCpu(summary: MatchSummary) {
    return this.run('/api/match/offline', { summary }, (p) => applyMatch(p, summary), (j) => j.reward as RewardResult | null);
  }
  /** apply a profile pushed by the match server */
  applyServerProfile(p: Profile) { this.set(p); }

  async leaderboard(): Promise<{ pos: number; name: string; mmr: number; wins: number; losses: number; fighter: string; level: number; id: string }[]> {
    if (!this.online) return [];
    return (await this.req<any>('GET', '/api/leaderboard')).top;
  }

  selectedSkin(fighterId: string) {
    const idx = this.profile.selSkin[fighterId] ?? 0;
    const f = getFighter(fighterId);
    return idx === 0 || this.profile.skins.includes(f.skins[idx]?.id) ? idx : 0;
  }
}

export const backend = new Backend();
