import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ir.neonbrawl.game',
  appName: 'Neon Brawl',
  webDir: 'dist',
  android: { backgroundColor: '#0d0620' },
  plugins: {
    AdMob: { appIdAndroid: 'ca-app-pub-3940256099942544~3347511713' },
  },
};

export default config;
