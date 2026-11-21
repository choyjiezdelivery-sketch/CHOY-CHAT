# Deploying CHOY-CHAT

CHOY-CHAT is a single Node.js process: Express serves the API and the static
SPA, and a WebSocket hub shares the same port. That means **one service, one
port, no separate frontend build** — any Node host works.

The app is host-agnostic: the browser talks to `/api/*` and `/ws` on whatever
origin served the page, so there is no URL to configure.

---

## What you need before you start

| Thing | Why | Where |
|---|---|---|
| A GitHub account with this repo | The host deploys from it | https://github.com/choyjiezdelivery-sketch/CHOY-CHAT |
| A host account | Runs the app | Render / Railway / Fly — see below |
| A `JWT_SECRET` | Signs session tokens | Generate locally, see below |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**The app refuses to start in production without a real `JWT_SECRET`.** That is
deliberate: the development fallback would let anyone forge a login token.

---

## Option A — Render (easiest, has a free tier)

1. Push this repo to GitHub (already done).
2. Go to https://dashboard.render.com/blueprints and click **New Blueprint Instance**.
3. Pick `choyjiezdelivery-sketch/CHOY-CHAT`. Render reads `render.yaml` and
   creates the service, generates `JWT_SECRET`, and mounts a 1 GB disk at
   `/var/data`.
4. When prompted, fill the `sync: false` variables (`ADMIN_USERNAME`,
   `ADMIN_PIN`, and the Supabase/GitHub ones if you want them).
5. Click **Apply**. First build takes ~3 minutes.
6. Your app is live at `https://choy-chat-xxxx.onrender.com`.

**Free-tier warning:** without a disk, the filesystem is ephemeral — the SQLite
database and uploads are wiped on every deploy and on every restart after the
service sleeps. `render.yaml` requests a disk, which requires a paid plan. On
the free plan, expect to re-seed after each restart.

---

## Option B — Railway

1. Go to https://railway.app/new and choose **Deploy from GitHub repo**.
2. Select `choyjiezdelivery-sketch/CHOY-CHAT`. Railway detects `railway.json`
   and builds the `Dockerfile`.
3. Open **Variables** and add at minimum:
   - `JWT_SECRET` — the generated secret
   - `NODE_ENV` — `production`
   - `ADMIN_USERNAME` — your username
4. Open **Settings → Volumes**, add a volume mounted at `/app/data`.
5. Set `DB_PATH=/app/data/choy-chat.db` and `UPLOAD_DIR=/app/data/uploads`.
6. **Settings → Networking → Generate Domain** to get a public URL.

---

## Option C — Fly.io

```bash
# one-time
curl -L https://fly.io/install.sh | sh
fly auth login

# in the repo
fly launch --no-deploy          # accept the existing fly.toml
fly volumes create choy_data --size 1 --region sin
fly secrets set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
fly secrets set ADMIN_USERNAME=choy ADMIN_PIN=1234
fly deploy
```

`fly.toml` already sets `DB_PATH=/data/choy-chat.db`, mounts the volume at
`/data`, forces HTTPS and health-checks `/api/ready`.

---

## Option D — any Docker host (VPS, DigitalOcean, ECS, Cloud Run)

```bash
docker build -t choy-chat .
docker run -d --name choy-chat \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" \
  -e ADMIN_USERNAME=choy \
  -v choy-data:/app/data \
  -v choy-uploads:/app/uploads \
  choy-chat
```

Put a TLS-terminating proxy (Caddy, nginx, Traefik) in front. **HTTPS is
required** for two features: the browser's geolocation API (Live GPS) and
`getUserMedia` (video calls, camera and microphone capture). On plain HTTP the
browser blocks both.

---

## Environment variables — the complete list

Set these in your host's Environment panel. Only `JWT_SECRET` is required in
production.

### Required in production

| Variable | Default | What it does | Where to get it |
|---|---|---|---|
| `JWT_SECRET` | dev fallback (refused in prod) | Signs every session token. Min 32 chars. | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

### Server

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on. Most hosts set this automatically. |
| `NODE_ENV` | — | Set to `production` to enable the secret guard, HSTS and proxy trust. |
| `TRUST_PROXY` | — | Set `true` to trust one proxy hop when not using `NODE_ENV=production`. |
| `JWT_TTL` | `7d` | Session lifetime. |
| `AUTH_RATE_LIMIT_MAX` | `20` | Sign-in attempts per IP per 15 minutes. |
| `RATE_LIMIT_DISABLED` | — | `true` disables the limiter. Tests set this; do not set it in production. |

### Storage

| Variable | Default | What it does |
|---|---|---|
| `DB_PATH` | `data/choy-chat.db` | SQLite file. **Use an absolute path on a mounted volume.** |
| `UPLOAD_DIR` | `uploads` | Where media is written with the local storage driver. |
| `UPLOAD_MAX_BYTES` | `26214400` (25 MB) | Largest accepted upload. |

### Admin

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_USERNAME` | — | This user is promoted to admin on boot. Use your own CHOY-CHAT username. |
| `ADMIN_PIN` | — | Optional 4–8 digit PIN required to open the admin dashboard. |

### Supabase (optional — only for cloud media storage)

Without these, uploads are written to `UPLOAD_DIR` on local disk, which works
fine on a host with a volume.

| Variable | What it does | Where to get it |
|---|---|---|
| `SUPABASE_URL` | Your project URL | https://app.supabase.com/project/_/settings/api → **Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key that bypasses row-level security. **Never expose to the browser.** | Same page → **API keys** → `service_role` (click reveal) |
| `SUPABASE_ANON_KEY` | Public key, safe for the browser | Same page → **API keys** → `anon` / `public` |
| `SUPABASE_BUCKET` | Storage bucket name (default `choy-chat-media`) | https://app.supabase.com/project/_/storage/buckets → **New bucket** |

### GitHub (optional — lets the admin dashboard commit)

| Variable | What it does | Where to get it |
|---|---|---|
| `GITHUB_TOKEN` | Personal access token with **Contents: Read and write** on this repo | https://github.com/settings/tokens → Fine-grained tokens → Generate new token |
| `GITHUB_REPO` | `owner/name` the dashboard commits to | Defaults to `choyjiezdelivery-sketch/CHOY-CHAT` |
| `GITHUB_BRANCH` | Branch to commit to | Defaults to `main` |

---

## After the first deploy

1. Open the URL. You will see the sign-in screen.
2. Register your own account, then set `ADMIN_USERNAME` to that username and
   redeploy — you are promoted to admin on boot.
3. Open **Admin → Environment** to see which variables the running app can
   actually see. Anything showing "not configured" is missing from the host.
4. Open **Admin → Security Studio** to confirm the hardening checks pass.

### Seeding demo data

`npm run seed` creates five demo users and some posts. It is safe to run once
on an empty database; it does not wipe existing data.

```bash
# on Render: add it to the build command, or run it from the shell tab
npm run seed
```

Demo accounts after seeding: `choy`, `maya`, `juan`, `ana`, `ben` — password
`password123`. **Change or delete these before letting anyone else use the app.**

---

## Verifying a deployment

```bash
# liveness — process is up
curl https://YOUR-URL/api/health

# readiness — database is reachable
curl https://YOUR-URL/api/ready

# security headers are present
curl -sI https://YOUR-URL/ | grep -i x-content-type-options
```

`/api/health` returns the app version and the live WebSocket connection count.
`/api/ready` returns 503 if the database cannot be opened.

---

## Things that will bite you

- **Ephemeral filesystem.** Most free tiers wipe the disk on redeploy. Mount a
  volume, or the database resets every time.
- **HTTPS is not optional.** Live GPS and video calls need a secure context.
  A plain-HTTP deployment will look broken for exactly those two features.
- **One instance only.** SQLite and the in-memory WebSocket registry are
  per-process. Running two replicas means users on different replicas cannot
  see each other's messages. Scale up, not out, until you move to Postgres.
- **WebSockets through a proxy.** If you put nginx in front, it must forward
  `Upgrade` and `Connection` headers or realtime silently degrades to polling
  (which this app does not implement — the UI will show "Offline").
- **`JWT_SECRET` rotation logs everyone out.** That is expected; tokens are
  signed, not stored.
