import { normalizePhone, OTP } from '@nb/shared';
import { account, exportProfile, decodeExport, importProfile, type AccountInfo } from '../services/account.ts';
import { backend } from '../services/backend.ts';
import { h, show, topBar, toast, confirmBox, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { isFa, num } from '../i18n.ts';
import './accounts.css';

// =============================================================================================
//  Settings → Account: protect / recover progress.
//  Online: phone number + one-time SMS code, transfer code, Google Play Games.
//  Offline test build: explains that those need the server and offers export / import of the
//  local profile as a code instead.
// =============================================================================================

type LL = { fa: string; en: string };
const tr = (l: LL) => (isFa() ? l.fa : l.en);
const L = {
  title: { fa: 'حساب کاربری', en: 'Account' },
  guest: { fa: 'حساب مهمان', en: 'Guest account' },
  guestNote: { fa: 'پیشرفتت فقط روی همین گوشی است. با شماره موبایل یا کد انتقال از آن محافظت کن تا اگر گوشی عوض شد چیزی از دست نرود.', en: 'Your progress lives on this phone only. Protect it with your phone number or a transfer code so nothing is lost if you switch phones.' },
  safe: { fa: 'حساب محافظت‌شده', en: 'Protected account' },
  playerCode: { fa: 'کد بازیکن', en: 'Player code' },
  phone: { fa: 'شماره موبایل', en: 'Phone number' },
  phoneHelp: { fa: 'یک کد ۵ رقمی پیامک می‌شود. اگر این شماره قبلاً به حسابی وصل باشد، وارد همان حساب می‌شوی.', en: 'We text you a 5-digit code. If the number already belongs to an account, you sign in to that account.' },
  phonePh: { fa: '۰۹۱۲۳۴۵۶۷۸۹', en: '09123456789' },
  sendCode: { fa: 'ارسال کد', en: 'Send code' },
  codePh: { fa: 'کد ۵ رقمی', en: '5-digit code' },
  verify: { fa: 'تأیید', en: 'Verify' },
  resendIn: { fa: 'ارسال دوباره تا', en: 'Resend in' },
  resend: { fa: 'ارسال دوباره', en: 'Resend' },
  expires: { fa: 'اعتبار کد', en: 'Code valid for' },
  linkedTo: { fa: 'وصل به', en: 'Linked to' },
  change: { fa: 'تغییر شماره', en: 'Change number' },
  linked: { fa: 'شماره به حسابت وصل شد', en: 'Phone number linked' },
  switched: { fa: 'وارد حساب قبلی‌ات شدی؛ بازی دوباره بارگذاری می‌شود…', en: 'Signed in to your existing account; reloading…' },
  devCode: { fa: 'حالت توسعه — کد', en: 'Dev mode — code' },
  transfer: { fa: 'کد انتقال حساب', en: 'Account transfer code' },
  transferHelp: { fa: 'این کد ۱۲ حرفی را جایی امن یادداشت کن. روی گوشی جدید با آن حسابت را برمی‌گردانی. هر کد یک بار کار می‌کند و ساخت کد جدید، کد قبلی را باطل می‌کند.', en: 'Write this 12-character code down somewhere safe; it restores your account on a new phone. Each code works once and generating a new one cancels the old one.' },
  none: { fa: 'هنوز کدی نساخته‌ای', en: 'No code yet' },
  gen: { fa: 'ساخت کد', en: 'Generate code' },
  regen: { fa: 'ساخت کد جدید', en: 'New code' },
  regenQ: { fa: 'کد قبلی دیگر کار نمی‌کند. ادامه می‌دهی؟', en: 'The old code will stop working. Continue?' },
  restore: { fa: 'بازگرداندن با کد', en: 'Restore with a code' },
  restoreQ: { fa: 'این گوشی به حساب صاحب کد منتقل می‌شود و حساب مهمان فعلی کنار گذاشته می‌شود. ادامه می‌دهی؟', en: 'This phone will switch to the account that owns the code; the current guest account is left behind. Continue?' },
  restorePh: { fa: 'XXXX-XXXX-XXXX', en: 'XXXX-XXXX-XXXX' },
  restoreBtn: { fa: 'بازگرداندن', en: 'Restore' },
  copied: { fa: 'کپی شد', en: 'Copied' },
  gpg: { fa: 'گوگل پلی گیمز', en: 'Google Play Games' },
  gpgHelp: { fa: 'ورود با حساب گوگل پلی گیمز (نسخه گوگل‌پلی).', en: 'Sign in with Google Play Games (Google Play build).' },
  gpgBtn: { fa: 'ورود با پلی گیمز', en: 'Sign in with Play Games' },
  gpgLinked: { fa: 'متصل', en: 'Connected' },
  gpgNoPlugin: { fa: 'این نسخه بازی پلی گیمز ندارد (فقط نسخه گوگل‌پلی).', en: 'This build has no Play Games support (Google Play build only).' },
  offlineTitle: { fa: 'نسخه آفلاین', en: 'Offline build' },
  offlineNote: { fa: 'ورود با شماره موبایل، گوگل پلی گیمز و کد انتقال ابری به سرور آنلاین نیاز دارند (تنظیمات ← سرور). در نسخه آفلاین می‌توانی کل پیشرفتت را به شکل یک کد خروجی بگیری و روی گوشی دیگری وارد کنی.', en: 'Phone login, Google Play Games and cloud transfer codes need the online server (Settings → Server). Offline, you can export your whole progress as a code and import it on another phone.' },
  needsServer: { fa: 'نیاز به سرور', en: 'Needs the server' },
  export: { fa: 'خروجی گرفتن از پیشرفت', en: 'Export progress' },
  exportHelp: { fa: 'کد زیر همه پیشرفت آفلاین تو است. کپی‌اش کن و جایی نگه دار.', en: 'The code below is your whole offline progress. Copy it and keep it somewhere.' },
  copy: { fa: 'کپی', en: 'Copy' },
  import: { fa: 'وارد کردن پیشرفت', en: 'Import progress' },
  importPh: { fa: 'کد خروجی را اینجا بچسبان (NBX1…)', en: 'Paste an export code (NBX1…)' },
  importQ: { fa: 'پیشرفت فعلی این گوشی با پیشرفت داخل کد جایگزین می‌شود. ادامه می‌دهی؟', en: 'The progress on this phone will be replaced by the one in the code. Continue?' },
  imported: { fa: 'پیشرفت وارد شد', en: 'Progress imported' },
  invite: { fa: 'دعوت دوستان و جایزه', en: 'Invite friends & earn' },
};
const ERR: Record<string, LL> = {
  'bad-phone': { fa: 'شماره موبایل درست نیست', en: 'Invalid phone number' },
  cooldown: { fa: 'کمی صبر کن و دوباره بفرست', en: 'Wait a moment before resending' },
  'rate-phone': { fa: 'برای این شماره پیامک زیادی فرستاده شده؛ یک ساعت دیگر امتحان کن', en: 'Too many codes for this number; try again in an hour' },
  'rate-ip': { fa: 'درخواست زیاد از این شبکه؛ بعداً امتحان کن', en: 'Too many requests from this network; try later' },
  wrong: { fa: 'کد اشتباه است', en: 'Wrong code' },
  expired: { fa: 'کد منقضی شده؛ دوباره بفرست', en: 'Code expired; send a new one' },
  attempts: { fa: 'تلاش زیاد؛ کد باطل شد', en: 'Too many attempts; the code was cancelled' },
  'no-code': { fa: 'اول کد را بفرست', en: 'Request a code first' },
  'not-found': { fa: 'کد پیدا نشد یا قبلاً استفاده شده', en: 'Code not found or already used' },
  'bad-code': { fa: 'کد درست نیست', en: 'Invalid code' },
  'not-configured': { fa: 'ورود با پلی گیمز روی سرور تنظیم نشده', en: 'Play Games sign-in is not configured on the server' },
  'gpg-unavailable': { fa: 'پلی گیمز در دسترس نیست', en: 'Play Games is not available' },
  'gpg-cancelled': { fa: 'ورود لغو شد', en: 'Sign-in cancelled' },
};
const errText = (e: unknown) => { const c = String((e as Error)?.message ?? '').replace(/^verify-failed:/, ''); return ERR[c] ? tr(ERR[c]) : c.startsWith('sms') ? (isFa() ? 'ارسال پیامک ناموفق بود' : 'Could not send the SMS') : (isFa() ? 'خطا: ' : 'Error: ') + c; };
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; return isFa() ? t.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : t; };
const copy = (s: string) => { void navigator.clipboard?.writeText(s).catch(() => {}); toast(tr(L.copied), 'ok'); };

export function accountScreen(): Screen {
  const back = () => import('./meta.ts').then((m) => show(m.settingsScreen));
  const body = h('div', { class: 'scroll' });
  const el = h('div', { class: 'page account' }, topBar({ back, title: tr(L.title) }), body);
  const timers: number[] = [];
  const destroy = () => timers.forEach((t) => clearInterval(t));
  if (backend.online) void renderOnline(body, timers); else renderOffline(body);
  introOnce('account', [
    { target: '.acc-status', title: { fa: 'از پیشرفتت محافظت کن', en: 'Protect your progress' }, text: { fa: 'حساب مهمان فقط روی همین گوشی است. با شماره موبایل یا کد انتقال، حسابت را روی هر گوشی دیگری برگردان.', en: 'A guest account lives on this phone only. With a phone number or a transfer code you can restore it on any other phone.' } },
  ]);
  return { el, destroy };
}

function card(icon: string, title: string, ...children: (Node | string | null | false)[]) {
  return h('div', { class: 'acc-card' }, h('b', { class: 'acc-cardtitle' }, svg(icon, 16), title), ...children);
}

async function renderOnline(body: HTMLElement, timers: number[]) {
  let info: AccountInfo;
  try { info = await account.info(); } catch (e) { body.append(h('p', { class: 'muted' }, errText(e))); return; }
  const rerender = () => { body.innerHTML = ''; void renderOnline(body, timers); };
  const p = backend.profile;
  const safe = !!(info.phone || info.transfer || info.gpg);

  // ---- status ----
  const status = h('div', { class: `acc-status ${safe ? 'ok' : 'warn'}` },
    h('span', { class: 'acc-hero' }, svg(safe ? 'police' : 'user', 26)),
    h('div', { class: 'acc-statusmain' },
      h('b', {}, safe ? tr(L.safe) : tr(L.guest)),
      h('small', {}, safe ? [info.phone ? `${tr(L.linkedTo)} ${info.phone}` : '', info.gpg ? ` · ${tr(L.gpg)}` : ''].join('') : tr(L.guestNote)),
    ),
    h('button', { class: 'acc-code', onclick: () => copy(info.code) }, h('small', {}, tr(L.playerCode)), h('b', { class: 'ltr' }, info.code), svg('copy', 14)),
  );

  // ---- phone ----
  const phoneIn = h('input', { class: 'input ltr', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: tr(L.phonePh), maxlength: 20 }) as HTMLInputElement;
  const codeIn = h('input', { class: 'input ltr acc-otp', inputmode: 'numeric', dir: 'ltr', placeholder: tr(L.codePh), maxlength: OTP.length }) as HTMLInputElement;
  const stage2 = h('div', { class: 'acc-otpbox', style: { display: 'none' } });
  const sendBtn = h('button', { class: 'btn small accent' }, svg('send', 14), tr(L.sendCode)) as HTMLButtonElement;
  let sentTo = '';
  const send = async () => {
    const ph = normalizePhone(phoneIn.value);
    if (!ph) { toast(errText(new Error('bad-phone')), 'err'); return; }
    sendBtn.disabled = true;
    try {
      const r = await account.requestOtp(ph);
      sentTo = ph;
      stage2.style.display = '';
      const exp = Date.now() + r.ttl, retry = Date.now() + r.retryIn;
      const timerEl = h('small', { class: 'muted' });
      stage2.innerHTML = '';
      stage2.append(
        h('div', { class: 'acc-field' }, codeIn, h('button', { class: 'btn small primary', onclick: verify }, svg('check', 14), tr(L.verify))),
        timerEl,
        ...(r.devCode ? [h('small', { class: 'acc-dev' }, `${tr(L.devCode)}: `, h('b', { class: 'ltr' }, r.devCode))] : []),
      );
      const tick = () => {
        const left = exp - Date.now(), rl = retry - Date.now();
        timerEl.textContent = `${tr(L.expires)} ${clock(left)}` + (rl > 0 ? ` · ${tr(L.resendIn)} ${clock(rl)}` : '');
        sendBtn.disabled = rl > 0;
        sendBtn.lastChild!.textContent = rl > 0 ? tr(L.sendCode) : tr(L.resend);
      };
      tick();
      timers.push(window.setInterval(tick, 1000));
      setTimeout(() => codeIn.focus(), 50);
    } catch (e) { sendBtn.disabled = false; toast(errText(e), 'err'); }
  };
  sendBtn.onclick = send;
  const verify = async () => {
    try {
      const r = await account.verifyOtp(sentTo, codeIn.value.trim());
      if (r === 'switched') { toast(tr(L.switched), 'ok'); return; }
      toast(tr(L.linked), 'ok');
      rerender();
    } catch (e) { toast(errText(e), 'err'); }
  };
  const phoneCard = card('phone', tr(L.phone),
    info.phone ? h('div', { class: 'acc-linked' }, svg('check', 14), h('span', { class: 'ltr' }, info.phone)) : null,
    h('div', { class: 'acc-field' }, phoneIn, sendBtn),
    stage2,
    h('small', { class: 'muted acc-small' }, info.phone ? `${tr(L.change)} — ${tr(L.phoneHelp)}` : tr(L.phoneHelp)),
  );

  // ---- transfer ----
  const restoreIn = h('input', { class: 'input ltr acc-codein', dir: 'ltr', placeholder: tr(L.restorePh), maxlength: 16, autocapitalize: 'characters' }) as HTMLInputElement;
  const transferCard = card('key', tr(L.transfer),
    h('div', { class: 'acc-transfer' },
      info.transfer ? h('button', { class: 'acc-bigcode ltr', onclick: () => copy(info.transfer!) }, info.transfer, svg('copy', 14)) : h('span', { class: 'muted' }, tr(L.none)),
      h('button', { class: 'btn small gold', onclick: async () => {
        if (info.transfer && !(await confirmBox(tr(L.regenQ)))) return;
        try { await account.newTransfer(); rerender(); } catch (e) { toast(errText(e), 'err'); }
      } }, svg('refresh', 14), info.transfer ? tr(L.regen) : tr(L.gen)),
    ),
    h('small', { class: 'muted acc-small' }, tr(L.transferHelp)),
    h('div', { class: 'acc-sep' }),
    h('small', { class: 'acc-label' }, tr(L.restore)),
    h('div', { class: 'acc-field' }, restoreIn, h('button', { class: 'btn small accent', onclick: async () => {
      const c = restoreIn.value.trim(); if (!c) return;
      if (!(await confirmBox(tr(L.restoreQ)))) return;
      try { const r = await account.redeemTransfer(c); toast(r === 'switched' ? tr(L.switched) : tr(L.linked), 'ok'); } catch (e) { toast(errText(e), 'err'); }
    } }, svg('login', 14), tr(L.restoreBtn))),
  );

  // ---- Play Games ----
  const gpgAvail = account.gpgAvailable();
  const gpgCard = card('gamepad', tr(L.gpg),
    info.gpg ? h('div', { class: 'acc-linked' }, svg('check', 14), tr(L.gpgLinked)) : null,
    h('button', { class: `btn small ${gpgAvail && info.gpgConfigured ? '' : 'ghost'}`, onclick: async () => {
      if (!gpgAvail) { toast(tr(L.gpgNoPlugin), 'info'); return; }
      if (!info.gpgConfigured) { toast(tr(ERR['not-configured']), 'info'); return; }
      try { const r = await account.gpgSignIn(); toast(r === 'switched' ? tr(L.switched) : tr(L.linked), 'ok'); if (r !== 'switched') rerender(); } catch (e) { toast(errText(e), 'err'); }
    } }, svg('gamepad', 14), tr(L.gpgBtn)),
    h('small', { class: 'muted acc-small' }, !gpgAvail ? tr(L.gpgNoPlugin) : !info.gpgConfigured ? tr(ERR['not-configured']) : tr(L.gpgHelp)),
  );

  body.append(status, h('div', { class: 'acc-grid' }, h('div', { class: 'acc-col' }, phoneCard, gpgCard), h('div', { class: 'acc-col' }, transferCard, inviteCard())));
  void p;
}

function inviteCard() {
  return h('button', { class: 'acc-card acc-link', onclick: () => import('./friends.ts').then((m) => show(() => m.friendsScreen('invite'))) },
    svg('share', 18), h('b', {}, tr(L.invite)), h('span', { class: 'grow' }), svg(isFa() ? 'back' : 'chevron', 16));
}

function renderOffline(body: HTMLElement) {
  const out = h('textarea', { class: 'input acc-export ltr', readonly: true, dir: 'ltr', rows: 3 }) as HTMLTextAreaElement;
  const inp = h('textarea', { class: 'input acc-export ltr', dir: 'ltr', rows: 2, placeholder: tr(L.importPh) }) as HTMLTextAreaElement;
  const outWrap = h('div', { class: 'acc-exportbox', style: { display: 'none' } }, h('small', { class: 'muted acc-small' }, tr(L.exportHelp)), out,
    h('button', { class: 'btn small accent', onclick: () => copy(out.value) }, svg('copy', 14), tr(L.copy)));
  body.append(
    h('div', { class: 'acc-status warn' },
      h('span', { class: 'acc-hero' }, svg('globe', 26)),
      h('div', { class: 'acc-statusmain' }, h('b', {}, tr(L.offlineTitle)), h('small', {}, tr(L.offlineNote))),
    ),
    h('div', { class: 'acc-grid' },
      h('div', { class: 'acc-col' },
        card('key', tr(L.export),
          h('button', { class: 'btn small gold', onclick: async () => { out.value = await exportProfile(); outWrap.style.display = ''; out.select(); } }, svg('share', 14), tr(L.export)),
          outWrap),
        card('login', tr(L.import), inp,
          h('button', { class: 'btn small accent', onclick: async () => {
            const c = inp.value.trim(); if (!c) return;
            try {
              const p = await decodeExport(c);
              if (!(await confirmBox(tr(L.importQ)))) return;
              importProfile(p);
              toast(tr(L.imported), 'ok');
              setTimeout(() => location.reload(), 800);
            } catch (e) { toast(errText(e), 'err'); }
          } }, svg('login', 14), tr(L.import))),
      ),
      h('div', { class: 'acc-col' },
        card('phone', tr(L.phone), h('span', { class: 'tag lock' }, svg('lock', 12), tr(L.needsServer)), h('small', { class: 'muted acc-small' }, tr(L.phoneHelp))),
        card('gamepad', tr(L.gpg), h('span', { class: 'tag lock' }, svg('lock', 12), tr(L.needsServer))),
        inviteCard(),
      ),
    ),
  );
  void num;
}
