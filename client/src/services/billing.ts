import { track } from './analytics.ts';
import { IAP_PRODUCTS, type IapProduct } from '@nb/shared';
import { backend } from './backend.ts';
import { isNative, MARKET } from './platform.ts';
import { t } from '../i18n.ts';

/**
 * In-app purchases.
 *  - Google Play build: cordova-plugin-purchase (Play Billing v7) → server verifies with the Play Developer API.
 *  - Myket build: Myket billing (custom Capacitor plugin) → server verifies with the Myket developer API.
 *  - Web: sandbox purchase dialog (server accepts "sandbox-" tokens only when IAP_SANDBOX is on).
 * Items are granted ONLY after server verification; consumables are consumed after granting.
 */
interface Provider {
  init(): Promise<void>;
  price(id: string): string | null;
  buy(p: IapProduct): Promise<boolean>;
}

const env = import.meta.env as Record<string, string>;

class PlayProvider implements Provider {
  private store: any;
  private pending = new Map<string, (ok: boolean) => void>();
  async init() {
    // cordova-plugin-purchase is injected as a global by the native runtime (Capacitor runs Cordova plugins)
    const CdvPurchase = (window as any).CdvPurchase;
    if (!CdvPurchase) throw new Error('cordova-plugin-purchase missing');
    const { store, ProductType, Platform } = CdvPurchase;
    this.store = store;
    store.register(IAP_PRODUCTS.map((p) => ({ id: p.id, platform: Platform.GOOGLE_PLAY, type: p.consumable ? ProductType.CONSUMABLE : ProductType.NON_CONSUMABLE })));
    store.when()
      .approved(async (tx: any) => {
        const productId = tx.products[0]?.id;
        const ok = await backend.verifyIap('googleplay', productId, tx.purchaseId ?? tx.transactionId).catch(() => false);
        if (ok) await tx.finish();
        this.pending.get(productId)?.(ok);
        this.pending.delete(productId);
      });
    await store.initialize([Platform.GOOGLE_PLAY]);
  }
  price(id: string) { return this.store?.get(id)?.pricing?.price ?? null; }
  buy(p: IapProduct) {
    return new Promise<boolean>((resolve) => {
      const offer = this.store.get(p.id)?.getOffer();
      if (!offer) return resolve(false);
      this.pending.set(p.id, resolve);
      offer.order().then((err: any) => { if (err) { this.pending.delete(p.id); resolve(false); } });
    });
  }
}

class MyketProvider implements Provider {
  private m!: typeof import('capacitor-myket-billing').MyketBilling;
  private prices: Record<string, string> = {};
  async init() {
    this.m = (await import('capacitor-myket-billing')).MyketBilling;
    await this.m.connect({ rsaKey: env.VITE_MYKET_RSA });
    this.prices = (await this.m.getPrices({ productIds: IAP_PRODUCTS.map((p) => p.id) }).catch(() => ({ prices: {} }))).prices;
    // recover purchases that were paid but not granted (crash / network loss)
    const { purchases } = await this.m.pending().catch(() => ({ purchases: [] }));
    for (const pu of purchases) await this.finish(pu.productId, pu.purchaseToken);
  }
  price(id: string) { return this.prices[id] ?? null; }
  private async finish(productId: string, token: string) {
    const ok = await backend.verifyIap('myket', productId, token).catch(() => false);
    const prod = IAP_PRODUCTS.find((x) => x.id === productId);
    if (ok && prod?.consumable) await this.m.consume({ productId }).catch(() => {});
    return ok;
  }
  async buy(p: IapProduct) {
    try {
      const pu = await this.m.purchase({ productId: p.id, payload: backend.profile.id });
      return await this.finish(p.id, pu.purchaseToken);
    } catch { return false; }
  }
}

class WebProvider implements Provider {
  async init() {}
  price(id: string) { return IAP_PRODUCTS.find((p) => p.id === id)?.price.web ?? null; }
  async buy(p: IapProduct) {
    if (!confirm(`${t('sandboxBuy')}\n${t('lang') === 'fa' ? p.nameFa : p.name} — ${p.price.web}`)) return false;
    return backend.verifyIap('web', p.id, 'sandbox-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  }
}

class BillingService {
  private provider: Provider = new WebProvider();
  ready = false;
  async init() {
    if (isNative && MARKET !== 'web') this.provider = MARKET === 'myket' ? new MyketProvider() : new PlayProvider();
    try { await this.provider.init(); this.ready = true; } catch (e) { console.warn('billing init failed', e); this.ready = !isNative || MARKET === 'web'; }
  }
  price(p: IapProduct): string {
    return this.provider.price(p.id) ?? p.price[MARKET] ?? p.price.web;
  }
  async buy(id: string): Promise<boolean> {
    const p = IAP_PRODUCTS.find((x) => x.id === id);
    if (!p || !this.ready) return false;
    if (!backend.online && isNative && MARKET !== 'web') return false; // purchases always need the server to verify
    const ok = await this.provider.buy(p);
    if (ok) track('purchase', p.id);
    return ok;
  }
}

export const billing = new BillingService();
