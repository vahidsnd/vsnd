# Neon Brawl — نئون براول

Online 2D platform fighter (Smash-style, **landscape**) for **Myket** and **Google Play**, with 20 fighters, 20 arenas, an offline world-map campaign that unlocks online play, leagues (Bronze → Legendary), spells & runes, fighter cards/upgrades, clans (15 members, roles, gem upgrades, alliances, clan wars), global/clan/alliance/private chat with moderation ("Game Police"), promo codes, a full economy, AdMob/Tapsell ads and in-app purchases.
Full game design document (Persian): **[docs/GDD.md](docs/GDD.md)** · Handoff / release checklist: **[docs/HANDOFF.md](docs/HANDOFF.md)**.

```
shared/   deterministic game simulation, fighters, stages, AI, economy, ranking, net protocol (used by server AND client)
server/   Node.js authoritative game server: WebSocket matches (60 Hz), matchmaking, rooms, REST economy API, IAP verification
client/   HTML5 Canvas game + DOM UI (Vite), Capacitor Android wrapper, ads/billing services
client/plugins/   native Capacitor plugins: Tapsell Plus (ads) and Myket billing
```

## Run locally

```bash
npm install
npm run dev            # server on :8787 + client on :5173 (proxied)
# or a single process serving the built client:
npm run build && npm start   # http://localhost:8787
```

Offline: if the server is unreachable the client falls back to a local profile (VS CPU, training, shop with the same rules).

Tests: `npm test` (sim/economy/progression unit tests + server end-to-end: matchmaking, forfeit, rooms, IAP, clans/chat/police/promo). Typecheck: `npm run typecheck`.

## Server configuration (env)

| var | meaning |
|---|---|
| `PORT` | default 8787 |
| `ADMIN_KEY` | enables the operator panel at `/admin` and `/api/admin/*` (header `x-admin-key`): stats, remote config, promo codes, broadcasts, first admin |
| `WAR_BOT_AFTER_MS` | clans searching for a war this long get a computer rival (default 300000) |
| `UNLOCK_ALL` | `1` skips world-map gating (testing only) |
| `DATA_DIR` | JSON database directory (default `server/data`) |
| `DATABASE_URL` | PostgreSQL connection string; replaces the JSON file when set (`npm run migrate:pg --workspace server` copies an existing JSON store) |
| `FLUSH_MS` | write-behind interval (default 5000) |
| `SPECTATE_MAX`, `SPECTATE_DELAY_MS` | spectators per match (20) and broadcast delay (3000 ms) |
| `REPLAYS_PER_USER` | online replays kept per player (50) |
| `NODE_ENV=production` | disables sandbox purchases |
| `GP_PACKAGE`, `GP_SERVICE_ACCOUNT` | Google Play package + service-account JSON (Android Publisher API) |
| `MYKET_PACKAGE`, `MYKET_ACCESS_TOKEN` | Myket package + developer API token (`MYKET_VERIFY_URL` to override the endpoint) |

Put it behind HTTPS (nginx/Caddy) — native builds need `https://` / `wss://`. Production guide (Persian: Ubuntu VPS, Docker Compose or pm2, Caddy, backups): [docs/DEPLOY.md](docs/DEPLOY.md). `docker compose up -d --build` runs server + PostgreSQL + Caddy.

Storage contract tests run against PostgreSQL too when `DATABASE_URL` is set: `DATABASE_URL=postgresql://… node --import tsx --test server/test/storage.test.ts`.

## Android builds

```bash
cd client
# edit .env.myket / .env.googleplay: VITE_SERVER_URL, ad unit/zone ids, Myket RSA key
npx cap add android                 # once
npm run android:myket               # or android:googleplay
npx cap open android                # build the signed AAB/APK in Android Studio
```

* **Google Play build** → AdMob (`@capacitor-community/admob`, set your real app id in `capacitor.config.ts`) + Play Billing (`cordova-plugin-purchase`).
* **Myket build** → Tapsell Plus + Myket billing (local plugins in `client/plugins`, picked up by `cap sync`).
* Create the in-app products in each console with the SKUs listed in `shared/src/economy.ts` (`IAP_PRODUCTS`).
* The default AdMob ids are Google's **test** ids — replace before release.

> The native plugin Java code and Gradle versions (Tapsell Plus, Myket billing client) follow the vendors' documented APIs but were not compiled in this environment; check the versions against the current Tapsell/Myket docs on first build.

## Quick test APK (no Gradle)

`client/native-shell` is a tiny native WebView shell that packs the game into an APK with plain SDK tools
(demo ads, sandbox purchases, offline profile; set a server in **Settings → Server** to play online):

```bash
ANDROID_JAR=/path/to/platforms/android-34/android.jar client/native-shell/build-apk.sh
# → client/native-shell/build/NeonBrawl-test.apk
```

For store releases use the Capacitor project (`npm run android:myket` / `android:googleplay`; `MARKET=demo npx cap sync` builds without store SDKs).

## Screenshots

| | |
|---|---|
| ![home](docs/screenshots/home.png) | ![online](docs/screenshots/online-match.png) |
| ![results](docs/screenshots/results.png) | ![phone](docs/screenshots/phone-touch.png) |
| ![shop](docs/screenshots/shop.png) | ![pass](docs/screenshots/pass.png) |
