import 'vazirmatn/Vazirmatn-font-face.css';
import './styles.css';
import './ui/progress.css';
import { backend } from './services/backend.ts';
import { ads } from './services/ads.ts';
import { billing } from './services/billing.ts';
import { isNative } from './services/platform.ts';
import { net } from './net/net.ts';
import { audio } from './game/audio.ts';
import { setLang, t } from './i18n.ts';
import { initDom, show, h } from './ui/dom.ts';
import { homeScreen } from './ui/home.ts';
import './ui/play.ts'; // registers the global "match found" handler

async function boot() {
  const root = document.getElementById('app')!;
  const splash = h('div', { class: 'splash' }, h('h1', { class: 'logo' }, 'NEON', h('span', {}, 'BRAWL')), h('div', { class: 'loader' }));
  document.body.appendChild(splash);

  await backend.init();
  setLang(backend.profile.settings.lang);
  audio.setSfx(backend.profile.settings.sfx);
  audio.setMusic(backend.profile.settings.music);
  if (backend.online) net.connect();

  initDom(root, (screen) => { ads.banner(!!screen.bannerAd); });
  // ads & billing initialise in the background; the menu is usable immediately
  ads.init().then(() => ads.banner(true));
  billing.init();

  splash.classList.add('out');
  setTimeout(() => splash.remove(), 400);
  show(homeScreen);

  const unlock = () => { audio.unlock(); audio.startMusic('menu'); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  if (isNative) {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      const atHome = !!document.querySelector('.home');
      if (atHome) App.exitApp(); else show(homeScreen);
    });
    App.addListener('pause', () => audio.stopMusic());
    App.addListener('resume', () => { audio.unlock(); audio.startMusic('menu'); });
  }
  // hooks for the lightweight Android test shell (client/native-shell)
  const w = window as any;
  w.nbBack = () => {
    if (document.querySelector('.modal-wrap')) { (document.querySelector('.modal-wrap .modal-x') as HTMLElement | null)?.click(); return true; }
    if (document.querySelector('.home')) return false;
    if (document.querySelector('.game')) { (document.querySelector('.pause-btn') as HTMLElement | null)?.click(); return true; }
    show(homeScreen); return true;
  };
  w.nbPause = () => { audio.stopMusic(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.stopMusic(); else audio.startMusic('menu'); });
  document.title = t('title');
}

boot();
