// =====================================================================================
//  Accounts & progress recovery (pure rules, no I/O):
//   • one-time codes for phone-number login (expiry, attempts, per-phone / per-IP limits)
//   • account transfer codes (12 characters, single use, regenerate invalidates the old one)
//   • short public player codes (add a friend / referral code)
//  The server keeps an AccountsDb on disk and the OTP state in memory; the offline build uses
//  the code helpers locally. Every function takes `now` / `rand` so tests are deterministic.
// =====================================================================================

export class AccountError extends Error { constructor(public code: string) { super(code); } }
const fail = (code: string): never => { throw new AccountError(code); };

const MIN = 60_000, HOUR = 60 * MIN;
export const OTP = {
  length: 5,
  ttlMs: 2 * MIN,          // a code is valid for two minutes
  maxAttempts: 5,          // wrong guesses before the code is burned
  resendMs: MIN,           // one SMS per phone per minute
  perPhoneHour: 5,         // SMS per phone per hour
  perIpHour: 10,           // SMS per IP per hour
  verifyPerIpHour: 40,     // verification attempts per IP per hour (brute force over many phones)
};

// ---- phone numbers ------------------------------------------------------------------------------
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function latinDigits(s: string) {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}
/**
 * Normalises a mobile number. Iranian mobiles (09xx…, +989xx…, 00989…, 9xx…) become `09xxxxxxxxx`;
 * other international numbers must start with + or 00 and become `+<digits>`. Returns null if invalid.
 */
export function normalizePhone(raw: unknown): string | null {
  let s = latinDigits(String(raw ?? '')).replace(/[\s\-()./]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^\+98\d+$/.test(s)) s = '0' + s.slice(3);
  else if (/^98\d{10}$/.test(s)) s = '0' + s.slice(2);
  else if (/^9\d{9}$/.test(s)) s = '0' + s;
  if (/^09\d{9}$/.test(s)) return s;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}
/** 0912***4567 — what the UI shows for a linked number. */
export function maskPhone(p: string) {
  if (p.length < 8) return '***';
  return p.slice(0, 4) + '*'.repeat(Math.max(3, p.length - 8)) + p.slice(-4);
}

// ---- one-time codes ---------------------------------------------------------------------------------
export interface OtpRec { code: string; exp: number; attempts: number; sentAt: number }
/** In-memory OTP state (never persisted: codes expire in two minutes anyway). */
export interface OtpState { codes: Record<string, OtpRec>; sends: Record<string, number[]>; verifies: Record<string, number[]> }
export function newOtpState(): OtpState { return { codes: {}, sends: {}, verifies: {} }; }

function recent(list: number[] | undefined, now: number, win: number) { return (list ?? []).filter((t) => now - t < win); }

export function genOtp(rand: () => number = Math.random) {
  let s = '';
  for (let i = 0; i < OTP.length; i++) s += String(Math.floor(rand() * 10) % 10);
  if (s[0] === '0') s = String(1 + Math.floor(rand() * 9)) + s.slice(1); // no leading zero (some SMS apps strip it)
  return s;
}

/** Issues a code for `phone` (already normalised). Throws 'cooldown' | 'rate-phone' | 'rate-ip'. */
export function otpRequest(st: OtpState, phone: string, ip: string, now: number, rand: () => number = Math.random): { code: string; exp: number; retryIn: number } {
  const pk = 'p:' + phone, ik = 'i:' + ip;
  const ps = (st.sends[pk] = recent(st.sends[pk], now, HOUR));
  const is = (st.sends[ik] = recent(st.sends[ik], now, HOUR));
  const last = ps[ps.length - 1];
  if (last !== undefined && now - last < OTP.resendMs) fail('cooldown');
  if (ps.length >= OTP.perPhoneHour) fail('rate-phone');
  if (is.length >= OTP.perIpHour) fail('rate-ip');
  ps.push(now); is.push(now);
  const code = genOtp(rand);
  st.codes[phone] = { code, exp: now + OTP.ttlMs, attempts: 0, sentAt: now };
  // keep memory bounded
  if (Object.keys(st.sends).length > 20_000) for (const k of Object.keys(st.sends)) if (!recent(st.sends[k], now, HOUR).length) delete st.sends[k];
  return { code, exp: now + OTP.ttlMs, retryIn: OTP.resendMs };
}

/** Checks a code. Throws 'no-code' | 'expired' | 'attempts' | 'wrong' | 'rate-ip'. Consumes the code on success. */
export function otpVerify(st: OtpState, phone: string, code: string, ip: string, now: number): true {
  const ik = 'v:' + ip;
  const vs = (st.verifies[ik] = recent(st.verifies[ik], now, HOUR));
  if (vs.length >= OTP.verifyPerIpHour) fail('rate-ip');
  vs.push(now);
  const rec = st.codes[phone] ?? fail('no-code');
  if (now > rec.exp) { delete st.codes[phone]; fail('expired'); }
  if (rec.attempts >= OTP.maxAttempts) { delete st.codes[phone]; fail('attempts'); }
  if (latinDigits(String(code ?? '')).trim() !== rec.code) {
    rec.attempts++;
    if (rec.attempts >= OTP.maxAttempts) delete st.codes[phone];
    fail(rec.attempts >= OTP.maxAttempts ? 'attempts' : 'wrong');
  }
  delete st.codes[phone];
  return true;
}

// ---- persistent account links -------------------------------------------------------------------------
/** 32 symbols without look-alikes (no 0/O, 1/I/L). */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TRANSFER_LEN = 12;
export const PLAYER_CODE_LEN = 8;

export function randomCode(len: number, rand: () => number = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}
/** Upper-cases and strips separators so "abcd-efgh-jkmn" works. */
export function normalizeCode(raw: unknown) {
  return latinDigits(String(raw ?? '')).toUpperCase().replace(/[\s\-_.]/g, '');
}
/** XXXX-XXXX-XXXX for display. */
export function formatTransfer(code: string) { return code.replace(/(.{4})(?=.)/g, '$1-'); }

export interface AccountsDb {
  phones: Record<string, string>;        // phone -> user id
  userPhone: Record<string, string>;     // user id -> phone
  transfer: Record<string, string>;      // transfer code -> user id
  userTransfer: Record<string, string>;  // user id -> transfer code
  gpg: Record<string, string>;           // Play Games player id -> user id
  userGpg: Record<string, string>;
  codes: Record<string, string>;         // public player code -> user id
  userCode: Record<string, string>;
}
export function newAccountsDb(): AccountsDb {
  return { phones: {}, userPhone: {}, transfer: {}, userTransfer: {}, gpg: {}, userGpg: {}, codes: {}, userCode: {} };
}

/** The player's public short code (assigned on first use). */
export function playerCode(db: AccountsDb, uid: string, rand: () => number = Math.random) {
  const have = db.userCode[uid];
  if (have) return have;
  let c = randomCode(PLAYER_CODE_LEN, rand);
  while (db.codes[c]) c = randomCode(PLAYER_CODE_LEN, rand);
  db.codes[c] = uid; db.userCode[uid] = c;
  return c;
}
export function userByCode(db: AccountsDb, code: string) { return db.codes[normalizeCode(code)] ?? null; }

/** New transfer code for the user; the previous one stops working. */
export function issueTransfer(db: AccountsDb, uid: string, rand: () => number = Math.random) {
  const old = db.userTransfer[uid];
  if (old) delete db.transfer[old];
  let c = randomCode(TRANSFER_LEN, rand);
  while (db.transfer[c]) c = randomCode(TRANSFER_LEN, rand);
  db.transfer[c] = uid; db.userTransfer[uid] = c;
  return c;
}
/** Redeems a transfer code: returns the account id. The code is single use (a fresh one is issued). */
export function redeemTransfer(db: AccountsDb, code: string, rand: () => number = Math.random): string {
  const c = normalizeCode(code);
  if (c.length !== TRANSFER_LEN) fail('bad-code');
  const uid = db.transfer[c] ?? fail('not-found');
  issueTransfer(db, uid, rand);
  return uid;
}

/**
 * Links an identity (phone / Play Games id) to the signed-in account, or — when another account
 * already owns it — tells the caller to log in to that account instead.
 */
export function linkIdentity(db: AccountsDb, kind: 'phone' | 'gpg', key: string, currentUid: string | null): { uid: string; switched: boolean; linked: boolean } {
  const owner = kind === 'phone' ? db.phones : db.gpg;
  const back = kind === 'phone' ? db.userPhone : db.userGpg;
  const existing = owner[key];
  if (existing && existing !== currentUid) return { uid: existing, switched: true, linked: false };
  if (existing === currentUid) return { uid: existing, switched: false, linked: false };
  if (!currentUid) fail('auth');
  const prev = back[currentUid!];
  if (prev) delete owner[prev];   // re-linking a new number replaces the old one
  owner[key] = currentUid!; back[currentUid!] = key;
  return { uid: currentUid!, switched: false, linked: true };
}

// ---- offline profile export (test build without a server) -----------------------------------------------
/** Light checksum so a typo in a pasted export code is caught (not a security feature). */
export function checksum(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
