import type { CapacitorConfig } from '@capacitor/cli';

// MARKET=demo → standalone test APK without store SDKs (demo ads, sandbox purchases)
const market = process.env.MARKET ?? 'googleplay';
const storePlugins: Record<string, string[]> = {
  googleplay: ['@capacitor/app', '@capacitor/haptics', '@capacitor-community/admob', 'cordova-plugin-purchase'],
  myket: ['@capacitor/app', '@capacitor/haptics', 'capacitor-tapsell-plus', 'capacitor-myket-billing'],
  demo: ['@capacitor/app', '@capacitor/haptics'],
};

const config: CapacitorConfig = {
  appId: 'ir.neonbrawl.game',
  appName: 'Neon Brawl',
  webDir: 'dist',
  android: { backgroundColor: '#0d0620', includePlugins: storePlugins[market] },
  plugins: {
    AdMob: { appIdAndroid: 'ca-app-pub-3940256099942544~3347511713' },
  },
};

export default config;
