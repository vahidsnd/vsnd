import { registerPlugin } from '@capacitor/core';

export interface TapsellPlusPlugin {
  initialize(opts: { key: string }): Promise<void>;
  requestRewarded(opts: { zoneId: string }): Promise<{ responseId: string }>;
  showRewarded(opts: { responseId: string }): Promise<{ rewarded: boolean }>;
  requestInterstitial(opts: { zoneId: string }): Promise<{ responseId: string }>;
  showInterstitial(opts: { responseId: string }): Promise<void>;
  showBanner(opts: { zoneId: string }): Promise<void>;
  hideBanner(): Promise<void>;
}

export const TapsellPlus = registerPlugin<TapsellPlusPlugin>('TapsellPlus');
