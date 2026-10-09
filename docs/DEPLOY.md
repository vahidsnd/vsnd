# نئون براول — راهنمای راه‌اندازی سرور (Deploy)

این راهنما برای راه‌اندازی سرور بازی روی یک **VPS اوبونتو (۲۲.۰۴ یا ۲۴.۰۴) در ایران** است، با HTTPS از طریق **Caddy**. یک پروسه Node هم API و WebSocket بازی را سرو می‌کند، هم نسخه وب بازی (`client/dist`) و هم پنل مدیریت (`/admin`).

دو روش داریم؛ یکی را انتخاب کنید:

- **روش الف — Docker Compose** (پیشنهادی): سرور + PostgreSQL + Caddy با یک دستور.
- **روش ب — pm2 بدون Docker**: Node مستقیم روی سرور، Caddy از apt، ذخیره‌سازی JSON یا PostgreSQL.

---

## ۰. پیش‌نیازها

| مورد | حداقل | پیشنهاد |
|---|---|---|
| سرور | ۱ هسته، ۱ گیگ رم | ۲ هسته، ۴ گیگ رم، SSD |
| سیستم‌عامل | Ubuntu 22.04 | Ubuntu 24.04 |
| دامنه | یک ساب‌دامین مثل `game.example.ir` که رکورد A آن به IP سرور اشاره کند | |
| پورت‌ها | ۸۰ و ۴۴۳ باز (برای گرفتن گواهی Let's Encrypt لازم است) | ۲۲ فقط برای IP خودتان |

> **نکته ایران:** اگر از CDN ابر آروان (یا مشابه) استفاده می‌کنید، در شروع کار CDN را برای این ساب‌دامین **خاموش** کنید تا Caddy بتواند گواهی بگیرد؛ بعد از گرفتن گواهی می‌توانید CDN را روشن کنید (WebSocket را در تنظیمات CDN فعال کنید و حالت SSL را روی «Full» بگذارید).

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
sudo timedatectl set-timezone Asia/Tehran     # لیگ هفتگی با ساعت تهران حساب می‌شود (سرور خودش هم درست حساب می‌کند، ولی لاگ‌ها خواناتر می‌شوند)
```

---

## ۱. متغیرهای محیطی (env)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | `8787` | پورت HTTP/WebSocket سرور (پشت Caddy) |
| `NODE_ENV` | — | در سرور واقعی حتماً `production` (خرید آزمایشی را خاموش می‌کند) |
| `DATA_DIR` | `server/data` | پوشه فایل JSON و ریپلی‌ها (وقتی PostgreSQL ندارید) |
| `DATABASE_URL` | خالی | اگر مقدار داشته باشد به‌جای فایل JSON از PostgreSQL استفاده می‌شود، مثل `postgresql://neonbrawl:PASS@127.0.0.1:5432/neonbrawl` |
| `FLUSH_MS` | `5000` | فاصله ذخیره تغییرات روی دیسک/دیتابیس (میلی‌ثانیه) |
| `ADMIN_KEY` | خالی | کلید پنل مدیریت `/admin` و APIهای `/api/admin/*`. خالی = پنل خاموش. یک رشته طولانی تصادفی بگذارید: `openssl rand -hex 32` |
| `CORS_ORIGIN` | `*` | اگر نسخه وب روی دامنه دیگری است، همان دامنه را بگذارید |
| `SPECTATE_MAX` | `20` | حداکثر تماشاگر هر مسابقه |
| `SPECTATE_DELAY_MS` | `3000` | تأخیر پخش برای تماشاگرها (جلوگیری از تقلب در جنگ قبیله) |
| `REPLAYS_PER_USER` | `50` | تعداد ریپلی آنلاین نگه‌داشته‌شده برای هر بازیکن |
| `IAP_SANDBOX` | — | `1` = خرید بدون تأیید (فقط برای تست؛ **هرگز در سرور واقعی**) |
| `MYKET_ACCESS_TOKEN` / `MYKET_PACKAGE` | — | تأیید خرید مایکت |
| `GP_SERVICE_ACCOUNT` / `GP_PACKAGE` | — | JSON حساب سرویس گوگل‌پلی (یک‌خطی) برای تأیید خرید |
| `UNLOCK_ALL` | — | `1` = همه قابلیت‌ها باز (فقط تست) |
| `WAR_BOT_AFTER_MS` | `300000` | بعد از این مدت جستجو، جنگ قبیله رقیب کامپیوتری می‌گیرد |

فایل نمونه: `.env.example` در ریشه پروژه.

---

## ۲. روش الف — Docker Compose (سرور + PostgreSQL + Caddy)

### نصب Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # بعد یک بار خارج و دوباره وارد شوید
```

> **نکته ایران:** Docker Hub از ایران معمولاً تحریم/مسدود است. یک میرور داخلی تنظیم کنید، مثلاً در `/etc/docker/daemon.json`:
> ```json
> { "registry-mirrors": ["https://docker.arvancloud.ir"] }
> ```
> و بعد `sudo systemctl restart docker`. اگر `get.docker.com` باز نمی‌شود، از مخزن apt میرورهای داخلی (یا بسته `docker.io` خود اوبونتو: `sudo apt install docker.io docker-compose-v2`) استفاده کنید. برای `npm ci` داخل build هم اگر npmjs کند بود، می‌توانید قبل از build یک میرور npm تنظیم کنید (`npm config set registry ...`) یا build را روی سیستم خودتان انجام دهید و ایمیج را با `docker save`/`docker load` منتقل کنید.

### اجرا

```bash
git clone <آدرس مخزن> neonbrawl && cd neonbrawl
cp .env.example .env
nano .env        # DOMAIN، ADMIN_KEY و POSTGRES_PASSWORD را عوض کنید
docker compose up -d --build
docker compose logs -f game     # باید «[db] postgres storage» و «Neon Brawl server on :8787» را ببینید
```

بعد از چند ثانیه `https://DOMAIN` بازی وب را باز می‌کند و `https://DOMAIN/admin` پنل مدیریت است. در اپ اندروید آدرس سرور را `https://DOMAIN` بگذارید.

### به‌روزرسانی

```bash
git pull
docker compose up -d --build game
```
سرور هنگام توقف (SIGTERM) آخرین تغییرات را ذخیره می‌کند؛ مهاجرت‌های جدول‌ها هنگام شروع خودکار و تکرارپذیر اجرا می‌شوند.

### فقط Docker، بدون Compose و PostgreSQL (ساده‌ترین حالت)

```bash
docker build -t neonbrawl .
docker run -d --name nb --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -v nbdata:/data -e ADMIN_KEY=... neonbrawl
```
در این حالت داده‌ها فایل JSON در volume `nbdata` است و Caddy را مثل روش ب (بخش ۳-۳) جلوی آن بگذارید.

---

## ۳. روش ب — pm2 بدون Docker

### ۳-۱. Node.js 22 و pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```
(اگر nodesource در دسترس نبود، فایل باینری Node 22 را از nodejs.org یا یک میرور داخلی دانلود کنید.)

### ۳-۲. کد و build

```bash
sudo adduser --disabled-password --gecos "" nb
sudo -iu nb
git clone <آدرس مخزن> neonbrawl && cd neonbrawl
npm ci
npm run build          # نسخه وب → client/dist (سرور خودش سرو می‌کند)
```

### ۳-۳. (اختیاری) PostgreSQL

برای چند هزار بازیکن، فایل JSON کافی است. برای بیشتر، یا اگر پشتیبان‌گیری حرفه‌ای می‌خواهید، PostgreSQL:

```bash
sudo apt install -y postgresql
sudo -u postgres psql -c "CREATE USER neonbrawl WITH PASSWORD 'یک-رمز-قوی';"
sudo -u postgres psql -c "CREATE DATABASE neonbrawl OWNER neonbrawl;"
```
جدول‌ها خودکار ساخته می‌شوند. اگر قبلاً با فایل JSON کار می‌کردید، **سرور را متوقف کنید** و یک بار داده‌ها را منتقل کنید:

```bash
DATA_DIR=server/data DATABASE_URL=postgresql://neonbrawl:PASS@127.0.0.1:5432/neonbrawl npm run migrate:pg --workspace server
```
(اسکریپت اگر دیتابیس مقصد خالی نباشد کاری نمی‌کند، مگر با `FORCE=1`.)

### ۳-۴. اجرا با pm2

فایل `ecosystem.config.cjs` در ریشه پروژه بسازید:

```js
module.exports = {
  apps: [{
    name: 'neonbrawl',
    cwd: __dirname,
    script: 'npm',
    args: 'start',
    kill_timeout: 10000,            // فرصت ذخیره نهایی هنگام توقف
    env: {
      NODE_ENV: 'production',
      PORT: 8787,
      DATA_DIR: '/home/nb/neonbrawl-data',
      // DATABASE_URL: 'postgresql://neonbrawl:PASS@127.0.0.1:5432/neonbrawl',
      ADMIN_KEY: 'خروجی openssl rand -hex 32',
    },
  }],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # دستوری که چاپ می‌کند را با sudo اجرا کنید تا بعد از ریبوت بالا بیاید
pm2 logs neonbrawl
```

به‌روزرسانی: `git pull && npm ci && npm run build && pm2 restart neonbrawl`

> فقط **یک** نمونه از سرور اجرا کنید (حالت cluster نه): وضعیت مسابقه‌ها و صف‌ها در حافظه همان پروسه است.

### ۳-۵. Caddy برای HTTPS

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
(اگر cloudsmith در دسترس نبود، فایل باینری caddy را از گیت‌هاب دانلود و در `/usr/local/bin` بگذارید.)

`/etc/caddy/Caddyfile`:

```
game.example.ir {
    encode gzip zstd
    reverse_proxy 127.0.0.1:8787
}
```
WebSocket به‌صورت خودکار از `reverse_proxy` رد می‌شود. بعد: `sudo systemctl reload caddy`.

> برای امنیت بیشتر می‌توانید `/admin` و `/api/admin/*` را فقط برای IP خودتان باز بگذارید:
> ```
> @admin {
>     path /admin* /api/admin/*
>     not remote_ip 1.2.3.4
> }
> respond @admin 404
> ```

---

## ۴. پشتیبان‌گیری (Backup)

**حتماً روزانه پشتیبان بگیرید و یک نسخه را خارج از همان سرور نگه دارید** (سرور دیگر، فضای ابری داخلی مثل آروان Object Storage).

### با PostgreSQL

```bash
sudo mkdir -p /var/backups/neonbrawl && sudo chown $USER /var/backups/neonbrawl
crontab -e
```
```
# هر شب ۴ صبح؛ ۱۴ روز آخر نگه داشته می‌شود
0 4 * * * pg_dump -Fc "postgresql://neonbrawl:PASS@127.0.0.1:5432/neonbrawl" > /var/backups/neonbrawl/nb-$(date +\%F).dump && find /var/backups/neonbrawl -name 'nb-*.dump' -mtime +14 -delete
```
در Docker Compose:
```
0 4 * * * cd /home/nb/neonbrawl && docker compose exec -T db pg_dump -Fc -U neonbrawl neonbrawl > /var/backups/neonbrawl/nb-$(date +\%F).dump
```
بازگردانی: `pg_restore --clean --if-exists -d "<DATABASE_URL>" nb-2026-10-09.dump` (سرور بازی را قبلش متوقف کنید).

### با فایل JSON

پوشه `DATA_DIR` (فایل `db.json` و پوشه `replays/`) را کپی کنید. فایل به‌صورت اتمی (نوشتن روی فایل موقت و rename) ذخیره می‌شود، پس کپی در حین اجرا هم سالم است:
```
0 4 * * * tar czf /var/backups/neonbrawl/nb-$(date +\%F).tgz -C /home/nb neonbrawl-data && find /var/backups/neonbrawl -name 'nb-*.tgz' -mtime +14 -delete
```
در Docker: `docker run --rm -v nbdata:/data -v /var/backups/neonbrawl:/b alpine tar czf /b/nb-$(date +%F).tgz -C /data .`

انتقال به سرور دیگر: `rsync -a /var/backups/neonbrawl/ backup@IP:/backups/neonbrawl/` (در cron بعد از پشتیبان).

---

## ۵. بعد از راه‌اندازی

- **سلامت سرور:** `curl https://DOMAIN/api/health` → `{"ok":true}`
- **پنل مدیریت:** `https://DOMAIN/admin` با `ADMIN_KEY`؛ آمار روزانه (DAU، نصب، ماندگاری D1/D7/D30، درآمد)، تنظیمات از راه دور (ضریب سکه، رویدادها، پیام روز، فعال/غیرفعال کردن قابلیت‌ها) بدون انتشار نسخه جدید، کد هدیه، ارسال پیام همگانی.
- **لاگ:** `pm2 logs neonbrawl` یا `docker compose logs -f game`
- **مانیتورینگ ساده:** یک سرویس مثل UptimeRobot یا مانیتور داخلی روی `/api/health`.
- **فایروال:** پورت ۸۷۸۷ نباید از بیرون باز باشد (فقط Caddy).

## ۶. عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| Caddy گواهی نمی‌گیرد | رکورد A دامنه را چک کنید، پورت ۸۰/۴۴۳ باز باشد، CDN موقتاً خاموش |
| بازی وصل می‌شود ولی مسابقه آنلاین قطع می‌شود | در CDN، WebSocket را فعال کنید؛ تایم‌اوت را بالا ببرید |
| `admin panel disabled` | `ADMIN_KEY` تنظیم نشده |
| `client not built` در صفحه اصلی | `npm run build` اجرا نشده (در Docker خودکار است) |
| خطای اتصال PostgreSQL هنگام شروع | `DATABASE_URL` و رمز را چک کنید؛ در Compose سرویس `db` باید healthy باشد |
| `pg` نصب نیست | `npm i pg --workspace server` (به‌صورت optional نصب می‌شود؛ فقط با `DATABASE_URL` لازم است) |
