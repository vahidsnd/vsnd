import { backend } from './backend.ts';
import { isNative, MARKET, store } from './platform.ts';
import { t } from '../i18n.ts';

/**
 * Ad design
 * ─────────
 *  Rewarded (opt-in, always available, even for "No Ads" buyers):
 *    • double   – x2 coins on the results screen
 *    • crate    – free crate every 4h
 *    • reroll   – extra daily-quest reroll
 *    • trial    – play one match with a locked fighter
 *    • coins    – +60 coins (shop, max 5/day)
 *  Interstitial: only between matches, never in the first 3 matches of a player's life, at most
 *    every 3rd match and 150 s apart (every 5th for payers). Removed by "No Ads".
 *  Banner: main menu only, never during gameplay. Removed by "No Ads".
 *  Network: Google Play build → AdMob, Myket build → Tapsell Plus, web → demo overlay.
 */
export type RewardedPlacement = 'double' | 'crate' | 'reroll' | 'trial' | 'coins';

interface Provider {
  init(): Promise<void>;
  rewarded(): Promise<boolean>;
  interstitial(): Promise<void>;
  banner(show: boolean): Promise<void>;
}

const env = import.meta.env as Record<string, string>;

class AdMobProvider implements Provider {
  private m!: typeof import('@capacitor-community/admob');
  async init() {
    this.m = await import('@capacitor-community/admob');
    const { AdMob } = this.m;
    await AdMob.initialize({ initializeForTesting: env.DEV === 'true' });
    try {
      const info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === this.m.AdmobConsentStatus.REQUIRED) await AdMob.showConsentForm();
    } catch { /* UMP not configured */ }
  }
  async rewarded() {
    const { AdMob } = this.m;
    await AdMob.prepareRewardVideoAd({ adId: env.VITE_ADMOB_REWARDED });
    let rewarded = false;
    const h = await AdMob.addListener(this.m.RewardAdPluginEvents.Rewarded, () => { rewarded = true; });
    try { await AdMob.showRewardVideoAd(); } finally { h.remove(); }
    return rewarded;
  }
  async interstitial() {
    const { AdMob } = this.m;
    await AdMob.prepareInterstitial({ adId: env.VITE_ADMOB_INTERSTITIAL });
    await AdMob.showInterstitial();
  }
  async banner(show: boolean) {
    const { AdMob, BannerAdSize, BannerAdPosition } = this.m;
    if (show) await AdMob.showBanner({ adId: env.VITE_ADMOB_BANNER, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER, margin: 0 });
    else await AdMob.removeBanner().catch(() => {});
  }
}

class TapsellProvider implements Provider {
  private p!: typeof import('capacitor-tapsell-plus').TapsellPlus;
  async init() {
    this.p = (await import('capacitor-tapsell-plus')).TapsellPlus;
    await this.p.initialize({ key: env.VITE_TAPSELL_KEY });
  }
  async rewarded() {
    const { responseId } = await this.p.requestRewarded({ zoneId: env.VITE_TAPSELL_REWARDED });
    return (await this.p.showRewarded({ responseId })).rewarded;
  }
  async interstitial() {
    const { responseId } = await this.p.requestInterstitial({ zoneId: env.VITE_TAPSELL_INTERSTITIAL });
    await this.p.showInterstitial({ responseId });
  }
  async banner(show: boolean) {
    if (show) await this.p.showBanner({ zoneId: env.VITE_TAPSELL_BANNER });
    else await this.p.hideBanner();
  }
}

/** Browser demo: a fake full-screen ad so the whole flow can be tested without SDKs. */
class DemoProvider implements Provider {
  async init() {}
  private overlay(seconds: number, skippable: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'demo-ad';
      el.innerHTML = `<div class="demo-ad-box"><div class="demo-ad-tag">AD · ${t('demoAd')}</div>
        <div class="demo-ad-art">⚡ NEON BRAWL ⚡</div><div class="demo-ad-count"></div>
        <button class="btn small demo-ad-close" disabled>✕</button></div>`;
      document.body.appendChild(el);
      const count = el.querySelector('.demo-ad-count') as HTMLElement;
      const close = el.querySelector('.demo-ad-close') as HTMLButtonElement;
      let left = seconds;
      const tick = () => {
        count.textContent = left > 0 ? `${left}` : t('rewardEarned');
        if (left <= 0 || skippable) close.disabled = false;
      };
      tick();
      const iv = setInterval(() => { left--; tick(); if (left <= 0) clearInterval(iv); }, 1000);
      close.onclick = () => { clearInterval(iv); el.remove(); resolve(left <= 0); };
    });
  }
  rewarded() { return this.overlay(5, false); }
  async interstitial() { await this.overlay(3, true); }
  async banner(show: boolean) {
    let b = document.getElementById('demo-banner');
    if (show && !b) {
      b = document.createElement('div'); b.id = 'demo-banner'; b.textContent = 'Banner ad · 320×50 (demo)';
      document.body.appendChild(b);
    } else if (!show && b) b.remove();
  }
}

class AdService {
  private provider: Provider = new DemoProvider();
  private ready = false;
  private matchesSince = store.get('ads.since', 0);
  private lastInterstitial = 0;
  private bannerOn = false;

  async init() {
    // store builds use the real SDKs; a 'web' market build (also inside the APK) uses demo ads
    if (isNative && MARKET !== 'web') this.provider = MARKET === 'myket' ? new TapsellProvider() : new AdMobProvider();
    try { await this.provider.init(); this.ready = true; } catch (e) {
      console.warn('ads init failed', e);
      this.provider = new DemoProvider(); this.ready = !isNative || MARKET === 'web';
    }
  }

  get available() { return this.ready; }

  async rewarded(_placement: RewardedPlacement): Promise<boolean> {
    if (!this.ready) return false;
    try {
      await this.banner(false, true);
      return await this.provider.rewarded();
    } catch (e) { console.warn('rewarded failed', e); return false; }
  }

  /** Call after each finished match. */
  noteMatch() { this.matchesSince++; store.set('ads.since', this.matchesSince); }

  async maybeInterstitial(): Promise<void> {
    const p = backend.profile;
    if (!this.ready || p.noAds || p.stats.matches < 3) return;
    const every = p.payer ? 5 : 3;
    if (this.matchesSince < every || Date.now() - this.lastInterstitial < 150_000) return;
    this.matchesSince = 0; store.set('ads.since', 0);
    this.lastInterstitial = Date.now();
    try { await this.provider.interstitial(); } catch (e) { console.warn('interstitial failed', e); }
  }

  async banner(show: boolean, temporary = false) {
    if (!this.ready) return;
    const want = show && !backend.profile.noAds;
    if (want === this.bannerOn) return;
    if (!temporary) this.bannerOn = want;
    try { await this.provider.banner(want); } catch { /* no fill */ }
  }
}

export const ads = new AdService();
