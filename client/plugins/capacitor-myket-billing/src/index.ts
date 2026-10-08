import { registerPlugin } from '@capacitor/core';

export interface MyketPurchase { productId: string; purchaseToken: string; orderId: string; developerPayload: string }

export interface MyketBillingPlugin {
  connect(opts: { rsaKey: string }): Promise<void>;
  getPrices(opts: { productIds: string[] }): Promise<{ prices: Record<string, string> }>;
  purchase(opts: { productId: string; payload: string }): Promise<MyketPurchase>;
  consume(opts: { productId: string }): Promise<void>;
  /** owned, not-yet-consumed purchases (for recovering after a crash) */
  pending(): Promise<{ purchases: MyketPurchase[] }>;
}

export const MyketBilling = registerPlugin<MyketBillingPlugin>('MyketBilling');
