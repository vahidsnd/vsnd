import { featureUnlocked, featureRequirement, tierFor, getFighter, FRIENDS, REFERRAL, type FriendsView, type PlayerBrief, type ReferralView, type Reward } from '@nb/shared';
import { friends } from '../services/friends.ts';
import { backend } from '../services/backend.ts';
import { net } from '../net/net.ts';
import { h, show, topBar, toast, confirmBox, fighterCanvas, rewardReveal, grantedToItems, icon, lockText, type Screen, type Child } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { ago } from './notifs.ts';
import { isFa, num, loc } from '../i18n.ts';
import { homeScreen } from './home.ts';
import './accounts.css';

// =============================================================================================
//  Friends: list (online / last seen / fighter / league), requests, add by player code,
//  daily gifts, room invites — and the referral ("Invite") tab, which stays open for new
//  players even before the friends feature unlocks.
// =============================================================================================

type LL = { fa: string; en: string };
const tr = (l: LL) => (isFa() ? l.fa : l.en);
const L = {
  title: { fa: 'دوستان', en: 'Friends' },
  tFriends: { fa: 'دوستان', en: 'Friends' },
  tRequests: { fa: 'درخواست‌ها', en: 'Requests' },
  tAdd: { fa: 'افزودن', en: 'Add' },
  tInvite: { fa: 'دعوت و جایزه', en: 'Invite & earn' },
  myCode: { fa: 'کد بازیکن من', en: 'My player code' },
  copied: { fa: 'کپی شد', en: 'Copied' },
  collect: { fa: 'دریافت هدیه‌ها', en: 'Collect gifts' },
  giftsLeft: { fa: 'هدیه باقی‌مانده امروز', en: 'Gifts left today' },
  online: { fa: 'آنلاین', en: 'Online' },
  seen: { fa: 'آخرین بازدید', en: 'Last seen' },
  gift: { fa: 'هدیه', en: 'Gift' },
  gifted: { fa: 'فرستاده شد', en: 'Sent' },
  invite: { fa: 'دعوت به اتاق', en: 'Invite' },
  remove: { fa: 'حذف', en: 'Remove' },
  removeQ: { fa: 'از لیست دوستان حذف شود؟', en: 'Remove from your friends?' },
  noFriends: { fa: 'هنوز دوستی نداری. کد بازیکن دوستت را در بخش «افزودن» وارد کن یا کد خودت را برایش بفرست.', en: 'No friends yet. Enter a friend\'s player code under "Add", or send them yours.' },
  addNow: { fa: 'افزودن دوست', en: 'Add a friend' },
  incoming: { fa: 'درخواست‌های دریافتی', en: 'Incoming' },
  outgoing: { fa: 'درخواست‌های ارسالی', en: 'Sent' },
  noReq: { fa: 'درخواستی نداری.', en: 'No requests.' },
  accept: { fa: 'قبول', en: 'Accept' },
  decline: { fa: 'رد', en: 'Decline' },
  cancel: { fa: 'لغو', en: 'Cancel' },
  pending: { fa: 'در انتظار', en: 'Pending' },
  codePh: { fa: 'کد ۸ حرفی بازیکن', en: '8-character player code' },
  send: { fa: 'ارسال درخواست', en: 'Send request' },
  sent: { fa: 'درخواست دوستی ارسال شد', en: 'Friend request sent' },
  accepted: { fa: 'حالا با هم دوستید', en: 'You are now friends' },
  addHelp: { fa: 'کد بازیکن تو بالای همین صفحه و در تنظیمات ← حساب کاربری نوشته شده است. هر روز می‌توانی به هر دوست یک هدیه ۵۰ سکه‌ای بدهی (تا ۲۰ هدیه در روز).', en: 'Your player code is at the top of this screen and in Settings → Account. Send each friend one 50-coin gift a day (up to 20 a day).' },
  suggest: { fa: 'بازیکن‌های پیشنهادی (کامپیوتری در نسخه آفلاین)', en: 'Suggested players (computer players in the offline build)' },
  lockedNote: { fa: 'لیست دوستان، هدیه و دعوت به اتاق بعد از فتح نقشه جهان باز می‌شود. دعوت دوستان و جایزه دعوت از همین حالا فعال است.', en: 'The friends list, gifts and room invites open after the world map. Inviting friends and invite rewards work right away.' },
  // referral
  refTitle: { fa: 'دوستانت را بیاور، هر دو جایزه بگیرید', en: 'Bring your friends, both get rewards' },
  refCode: { fa: 'کد دعوت تو', en: 'Your invite code' },
  share: { fa: 'اشتراک', en: 'Share' },
  shareText: { fa: 'بیا نئون براول بازی کنیم! موقع شروع، کد دعوت من را وارد کن تا هر دو جایزه بگیریم: ', en: 'Play Neon Brawl with me! Enter my invite code when you start and we both get rewards: ' },
  youGet: { fa: 'دوست تازه‌وارد می‌گیرد', en: 'Your new friend gets' },
  iGet: { fa: 'تو برای هر دعوت می‌گیری', en: 'You get per invite' },
  msTitle: { fa: 'جایزه وقتی دوستت به این سطح برسد', en: 'Bonus when your friend reaches' },
  level: { fa: 'سطح', en: 'Level' },
  enter: { fa: 'کد دعوت داری؟', en: 'Have an invite code?' },
  enterHelp: { fa: 'بازیکن‌های تازه (زیر سطح ۵ و تا ۷ روز بعد از ساخت حساب) یک بار می‌توانند کد دعوت وارد کنند.', en: 'New players (below level 5, within 7 days of creating the account) can enter one invite code, once.' },
  redeem: { fa: 'ثبت کد', en: 'Redeem' },
  redeemed: { fa: 'کد دعوت ثبت شد', en: 'Invite code redeemed' },
  referredBy: { fa: 'دعوت‌شده توسط', en: 'Invited by' },
  invited: { fa: 'دعوت‌شده‌ها', en: 'Players you invited' },
  noInvited: { fa: 'هنوز کسی با کد تو وارد نشده.', en: 'Nobody has joined with your code yet.' },
  counted: { fa: 'شمارش‌شده', en: 'counted' },
  notCounted: { fa: 'بیش از سقف', en: 'over the cap' },
  until: { fa: 'تا', en: 'until' },
};
const ERR: Record<string, LL> = {
  'not-found': { fa: 'بازیکنی با این کد پیدا نشد', en: 'No player with that code' },
  self: { fa: 'این کد خودت است', en: 'That is your own code' },
  'already-friends': { fa: 'از قبل دوست هستید', en: 'Already friends' },
  'already-sent': { fa: 'قبلاً درخواست فرستاده‌ای', en: 'Request already sent' },
  'max-friends': { fa: `حداکثر ${FRIENDS.max} دوست`, en: `At most ${FRIENDS.max} friends` },
  'their-max': { fa: 'لیست دوستان او پر است', en: 'Their friends list is full' },
  'their-inbox-full': { fa: 'درخواست‌های او پر است', en: 'They have too many pending requests' },
  'already-gifted': { fa: 'امروز به این دوست هدیه داده‌ای', en: 'Already gifted this friend today' },
  'gift-limit': { fa: 'سقف ۲۰ هدیه امروز پر شد', en: 'Daily limit of 20 gifts reached' },
  'not-friend': { fa: 'دوست نیستید', en: 'Not friends' },
  already: { fa: 'قبلاً کد دعوت وارد کرده‌ای', en: 'You already used an invite code' },
  level: { fa: 'فقط زیر سطح ۵ می‌شود کد دعوت وارد کرد', en: 'Invite codes are for players below level 5' },
  'too-late': { fa: 'مهلت ۷ روزه وارد کردن کد تمام شده', en: 'The 7-day window for invite codes has passed' },
  'device-used': { fa: 'روی این گوشی قبلاً کد دعوت استفاده شده', en: 'An invite code was already used on this device' },
  'same-device': { fa: 'دعوت از حساب دیگرِ همین گوشی پذیرفته نیست', en: 'Inviting another account on the same device is not allowed' },
  'rate-ip': { fa: 'تعداد دعوت از این شبکه امروز زیاد است', en: 'Too many invites from this network today' },
  circular: { fa: 'این بازیکن با کد تو وارد شده است', en: 'This player joined with your code' },
  locked: { fa: 'این بخش هنوز باز نشده', en: 'Not unlocked yet' },
};
export const errText = (e: unknown) => { const c = (e as Error)?.message ?? ''; return ERR[c] ? tr(ERR[c]) : isFa() ? 'خطا: ' + c : 'Error: ' + c; };

const fighterName = (id: string) => { try { return loc(getFighter(id)); } catch { return id; } };

type Tab = 'friends' | 'requests' | 'add' | 'invite';

export function friendsScreen(start?: Tab): Screen {
  const svc = friends();
  const p = backend.profile;
  const open = featureUnlocked(p, 'friends');
  let tab: Tab = open ? start ?? 'friends' : 'invite';
  let view: FriendsView | null = null;
  let code = '';
  const tabsEl = h('div', { class: 'tabs acc-tabs' });
  const head = h('div', { class: 'acc-headwrap' });
  const body = h('div', { class: 'scroll' });
  const el = h('div', { class: 'page friends' }, topBar({ back: () => show(homeScreen), title: tr(L.title) }), h('div', { class: 'acc-bar' }, head, tabsEl), body);

  const load = async () => {
    try { [view, code] = await Promise.all([open ? svc.view() : Promise.resolve(null), svc.myCode()]); } catch (e) { toast(errText(e), 'err'); }
    render();
  };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, 'ok'); } catch (e) { toast(errText(e), 'err'); }
    await load();
  };

  const renderHead = () => {
    head.innerHTML = '';
    const copy = () => { void navigator.clipboard?.writeText(code).catch(() => {}); toast(tr(L.copied), 'ok'); };
    head.append(h('div', { class: 'acc-strip' },
      h('button', { class: 'acc-code', onclick: copy, title: tr(L.myCode) }, h('small', {}, tr(L.myCode)), h('b', { class: 'ltr' }, code || '········'), svg('copy', 14)),
      view ? h('span', { class: 'acc-chip' }, svg('gift', 14), `${tr(L.giftsLeft)}: ${num(view.giftsLeft)}`) : null,
      h('span', { class: 'grow' }),
      view && view.giftsCollectable > 0 ? h('button', { class: 'btn small gold', onclick: () => act(async () => {
        const r = await svc.collect();
        if (r.n) rewardReveal(tr(L.collect), [{ kind: 'coin', amount: r.coins }]);
      }) }, svg('gift', 14), h('span', { class: 'fr-btxt' }, tr(L.collect)), ` (${num(view.giftsCollectable)})`) : null,
    ));
  };

  const renderTabs = () => {
    tabsEl.innerHTML = '';
    const tabs: [Tab, LL, number][] = [['friends', L.tFriends, 0], ['requests', L.tRequests, view?.incoming.length ?? 0], ['add', L.tAdd, 0], ['invite', L.tInvite, 0]];
    for (const [id, label, n] of tabs) {
      const locked = !open && id !== 'invite';
      tabsEl.append(h('button', { class: `tab ${id === tab ? 'on' : ''} ${locked ? 'locked' : ''}`, 'data-t': id, onclick: () => {
        if (locked) { toast(`${isFa() ? 'باز می‌شود در' : 'Unlocks at'} ${lockText(featureRequirement('friends'))}`, 'info'); return; }
        tab = id; render();
      } }, locked ? svg('lock', 12) : null, tr(label), n ? h('span', { class: 'acc-tabn' }, num(n)) : null));
    }
  };

  const playerRow = (b: PlayerBrief, extra: Child, sub?: Child) => {
    const tier = tierFor(b.mmr);
    return h('div', { class: 'fr-row' },
      h('div', { class: 'fr-av' }, fighterCanvas(b.fighter, 0, 64), h('i', { class: `fr-dot ${b.online ? 'on' : ''}` })),
      h('div', { class: 'fr-main' },
        h('div', { class: 'fr-name' }, h('b', {}, b.name), h('span', { class: 'fr-lvl' }, `${isFa() ? 'سطح' : 'Lv'} ${num(b.level)}`),
          h('span', { class: 'fr-tier', style: { color: tier.tier.color, borderColor: tier.tier.color + '66' } }, isFa() ? tier.tier.nameFa : tier.tier.name)),
        h('small', { class: 'fr-sub' }, sub ?? [b.online ? h('span', { class: 'fr-on' }, tr(L.online)) : `${tr(L.seen)}: ${ago(b.seen)}`, ' · ', fighterName(b.fighter)]),
      ),
      h('div', { class: 'fr-acts' }, extra),
    );
  };

  const inviteToRoom = async (b: PlayerBrief) => {
    if (svc.demo) {
      await svc.invite(b.id, 'DEMO0').catch(() => {});
      const ok = await confirmBox(isFa() ? `${b.name} دعوت را قبول کرد. اتاق خصوصی به سرور نیاز دارد؛ یک بازی دوستانه مقابل کامپیوتر شروع شود؟` : `${b.name} accepted. Private rooms need the server — start a friendly match against the computer?`);
      if (ok) import('./play.ts').then((m) => m.startCpuMatch({ opponents: 1, stocks: 3 }));
      return;
    }
    if (!(await net.connect())) { toast(isFa() ? 'اتصال برقرار نشد' : 'Could not connect', 'err'); return; }
    const play = await import('./play.ts');
    show(play.roomScreen);
    const off = net.on('room', (m) => {
      if (!m.room?.code) return;
      off();
      svc.invite(b.id, m.room.code).then((r) => toast(r.online ? (isFa() ? `دعوت برای ${b.name} فرستاده شد` : `Invite sent to ${b.name}`) : (isFa() ? `${b.name} آفلاین است؛ اعلان برایش فرستاده شد` : `${b.name} is offline; a notification was sent`), 'ok')).catch((e) => toast(errText(e), 'err'));
    });
    const p = backend.profile;
    net.send({ t: 'room_create', fighter: p.selFighter, skin: backend.selectedSkin(p.selFighter) });
  };

  const renderFriends = () => {
    if (!view) return;
    if (!view.friends.length) {
      body.append(h('div', { class: 'acc-card acc-center' }, svg('users', 30), h('p', { class: 'muted' }, tr(L.noFriends)),
        h('button', { class: 'btn accent', onclick: () => { tab = 'add'; render(); } }, svg('userPlus', 16), tr(L.addNow))));
      return;
    }
    body.append(h('div', { class: 'fr-list' }, view.friends.map((f) => playerRow(f, [
      h('button', { class: `btn small ${f.gifted ? '' : 'gold'}`, disabled: f.gifted || view!.giftsLeft <= 0, title: tr(L.gift), onclick: () => act(() => svc.gift(f.id), isFa() ? `۵۰ سکه برای ${f.name} فرستاده شد` : `50 coins sent to ${f.name}`) },
        svg(f.gifted ? 'check' : 'gift', 14), h('span', { class: 'fr-btxt' }, f.gifted ? tr(L.gifted) : tr(L.gift))),
      h('button', { class: 'btn small accent', title: tr(L.invite), onclick: () => inviteToRoom(f) }, svg('gamepad', 14), h('span', { class: 'fr-btxt' }, tr(L.invite))),
      h('button', { class: 'btn small ghost icon-only', title: tr(L.remove), 'aria-label': tr(L.remove), onclick: async () => { if (await confirmBox(`${f.name}: ${tr(L.removeQ)}`)) void act(() => svc.remove(f.id)); } }, svg('close', 14)),
    ]))));
  };

  const renderRequests = () => {
    if (!view) return;
    body.append(h('h3', { class: 'acc-h' }, tr(L.incoming)));
    if (!view.incoming.length) body.append(h('p', { class: 'muted acc-small' }, tr(L.noReq)));
    body.append(h('div', { class: 'fr-list' }, view.incoming.map((r) => {
      const b = r.brief ?? { id: r.from, name: r.name, code: '', fighter: 'blaze', level: 1, mmr: 1000, online: false, seen: r.t };
      return playerRow(b, [
        h('button', { class: 'btn small primary', onclick: () => act(() => svc.respond(r.from, true), tr(L.accepted)) }, svg('check', 14), tr(L.accept)),
        h('button', { class: 'btn small ghost', onclick: () => act(() => svc.respond(r.from, false)) }, tr(L.decline)),
      ], ago(r.t));
    })));
    if (view.outgoing.length) {
      body.append(h('h3', { class: 'acc-h' }, tr(L.outgoing)));
      body.append(h('div', { class: 'fr-list' }, view.outgoing.map((b) => playerRow(b, [
        h('span', { class: 'tag' }, tr(L.pending)),
        h('button', { class: 'btn small ghost', onclick: () => act(() => svc.cancel(b.id)) }, tr(L.cancel)),
      ]))));
    }
  };

  const renderAdd = () => {
    const inp = h('input', { class: 'input acc-codein ltr', placeholder: tr(L.codePh), maxlength: 12, dir: 'ltr', autocapitalize: 'characters' }) as HTMLInputElement;
    const send = () => {
      const c = inp.value.trim();
      if (!c) return;
      void act(async () => { const r = await svc.add(c); inp.value = ''; toast(r === 'accepted' ? tr(L.accepted) : tr(L.sent), 'ok'); });
    };
    body.append(h('div', { class: 'acc-card' },
      h('div', { class: 'acc-field' }, svg('userPlus', 18), inp, h('button', { class: 'btn primary', onclick: send }, tr(L.send))),
      h('p', { class: 'muted acc-small' }, tr(L.addHelp)),
    ));
    const sug = svc.suggestions();
    if (sug.length) {
      body.append(h('h3', { class: 'acc-h' }, tr(L.suggest)));
      body.append(h('div', { class: 'fr-list' }, sug.map((b) => playerRow(b, [
        h('button', { class: 'btn small accent', onclick: () => act(async () => { await svc.add(b.code); }, tr(L.sent)) }, svg('userPlus', 14), tr(L.tAdd)),
      ], h('span', {}, h('span', { class: 'ltr fr-code' }, b.code), ' · ', b.online ? tr(L.online) : ago(b.seen))))));
    }
  };

  const rewardLine = (r: Reward) => h('span', { class: 'acc-reward' },
    r.coins ? h('span', { class: 'cur' }, icon('coin'), num(r.coins)) : null,
    r.gems ? h('span', { class: 'cur' }, icon('gem'), num(r.gems)) : null,
    r.runes ? h('span', { class: 'cur rune' }, icon('rune'), num(r.runes)) : null,
    r.anyCards ? h('span', { class: 'cur' }, svg('fighters', 12), `${num(r.anyCards)} ${isFa() ? 'کارت' : 'cards'}`) : null,
    r.crates ? h('span', { class: 'cur' }, svg('crate', 12), `${num(r.crates)} ${isFa() ? 'جعبه' : 'crate'}`) : null,
  );

  const renderInvite = async () => {
    if (!open) body.append(h('div', { class: 'acc-note' }, svg('lock', 14), tr(L.lockedNote)));
    let rv: ReferralView;
    try { rv = await svc.referral(); } catch (e) { body.append(h('p', { class: 'muted' }, errText(e))); return; }
    if (tab !== 'invite') return;
    const share = async () => {
      const text = tr(L.shareText) + rv.code;
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch { /* cancelled */ }
      void navigator.clipboard?.writeText(text).catch(() => {});
      toast(tr(L.copied), 'ok');
    };
    const inp = h('input', { class: 'input acc-codein ltr', placeholder: tr(L.codePh), maxlength: 12, dir: 'ltr' }) as HTMLInputElement;
    body.append(h('div', { class: 'acc-grid' },
      h('div', { class: 'acc-card ref-card' },
        h('b', { class: 'acc-cardtitle' }, svg('share', 16), tr(L.refTitle)),
        h('div', { class: 'ref-code' }, h('small', {}, tr(L.refCode)), h('b', { class: 'ltr' }, rv.code),
          h('button', { class: 'btn small accent', onclick: share }, svg('share', 14), tr(L.share))),
        h('div', { class: 'ref-rw' }, h('small', {}, tr(L.youGet)), rewardLine(rv.newReward)),
        h('div', { class: 'ref-rw' }, h('small', {}, tr(L.iGet)), rewardLine(rv.referrerReward)),
        h('div', { class: 'ref-rw' }, h('small', {}, tr(L.msTitle)),
          h('div', { class: 'ref-ms' }, rv.milestones.map((m) => h('span', { class: 'ref-msi' }, h('b', {}, `${tr(L.level)} ${num(m.level)}`), rewardLine(m.reward))))),
      ),
      h('div', { class: 'acc-col' },
        rv.referredBy ? h('div', { class: 'acc-card' }, h('small', { class: 'muted' }, tr(L.referredBy)), h('b', {}, rv.referredBy))
          : rv.eligible ? h('div', { class: 'acc-card' },
            h('b', { class: 'acc-cardtitle' }, svg('ticket', 16), tr(L.enter)),
            h('div', { class: 'acc-field' }, inp, h('button', { class: 'btn small gold', onclick: () => {
              const c = inp.value.trim(); if (!c) return;
              svc.redeemReferral(c).then((g) => { rewardReveal(tr(L.redeemed), grantedToItems(g)); void load(); }).catch((e) => toast(errText(e), 'err'));
            } }, tr(L.redeem))),
            h('small', { class: 'muted acc-small' }, tr(L.enterHelp), ' ', `(${tr(L.until)} ${new Date(rv.until).toLocaleDateString(isFa() ? 'fa-IR' : 'en-GB')})`))
            : null,
        h('div', { class: 'acc-card' },
          h('b', { class: 'acc-cardtitle' }, svg('users', 16), tr(L.invited), h('span', { class: 'ref-count' }, `${num(rv.counted)} / ${num(rv.max)}`)),
          rv.invited.length ? h('div', { class: 'ref-list' }, rv.invited.map((x) => h('div', { class: 'ref-item' },
            h('b', {}, x.name), h('small', { class: 'muted' }, x.level !== null ? `${tr(L.level)} ${num(x.level)}` : ago(x.t)),
            h('span', { class: 'grow' }),
            REFERRAL.milestones.map((m) => h('span', { class: `ref-pip ${x.ms.includes(m.level) ? 'on' : ''}`, title: `${tr(L.level)} ${m.level}` }, num(m.level))),
            x.counted ? null : h('small', { class: 'muted' }, tr(L.notCounted)),
          ))) : h('p', { class: 'muted acc-small' }, tr(L.noInvited)),
        ),
      ),
    ));
  };

  const render = () => {
    renderHead();
    renderTabs();
    body.innerHTML = '';
    if (tab === 'friends') renderFriends();
    else if (tab === 'requests') renderRequests();
    else if (tab === 'add') renderAdd();
    else void renderInvite();
  };

  const off = svc.onChange(() => { if (el.isConnected) void load(); });
  render();
  void load();
  introOnce('friends', [
    { target: '.acc-code', title: { fa: 'کد بازیکن', en: 'Player code' }, text: { fa: 'این کد را برای دوستانت بفرست تا تو را اضافه کنند. همین کد، کد دعوت تو هم هست.', en: 'Send this code to friends so they can add you. It is also your invite code.' } },
    { target: '.acc-tabs', title: { fa: 'دوستان، درخواست‌ها، دعوت', en: 'Friends, requests, invites' }, text: { fa: 'هر روز به هر دوست یک هدیه بده، دوستان آنلاین را به اتاق خصوصی دعوت کن و با دعوت بازیکن‌های تازه جایزه بگیر.', en: 'Gift each friend once a day, invite online friends to a private room and earn rewards for bringing new players.' } },
  ]);
  return { el, destroy: () => off() };
}
