# S.H.E.L.L.Y 🌤

A modern, real-time weather client inspired by WeatherStar 4000. Vanilla HTML/CSS/JS, NOAA weather data, IEM NEXRAD radar, animated background music, TTS severe weather alerts, and admin announcements.

---

## ✨ Features

- Live NOAA/NWS weather — no API key required
- IEM NEXRAD animated radar (6 frames, auto-refresh)
- Slides: Conditions, Obs, Hourly, Extended, Precip Chart, Almanac, Air Quality, Radar, Severe Alerts
- Background music (server playlist auto-loaded + folder picker fallback)
- Text-to-speech severe weather alerts with music ducking
- **Admin panel** — push info/warning/emergency banners or full-screen popups to every display
- **Push notifications** — subscribe on any device, receive alerts even in the background
- **PWA** — installable on iOS, Android, and desktop; works offline with last-loaded data cached
- Multiple themes, kiosk/fullscreen mode

---

## 🔒 Security Features

S.H.E.L.L.Y. includes several layered defenses that demonstrate common web-application security concepts.

### HTTP Security Headers

Every response is sent with a hardened set of headers:

| Header | Value / Purpose |
|--------|----------------|
| `Content-Security-Policy` | Restricts script sources to `self` and a trusted CDN; blocks inline scripts loaded from external origins; restricts image and API connection sources |
| `X-Frame-Options` | `SAMEORIGIN` — prevents clickjacking by blocking the page from being embedded in a foreign `<iframe>` |
| `X-Content-Type-Options` | `nosniff` — stops browsers from MIME-sniffing a response away from its declared Content-Type |
| `X-XSS-Protection` | `1; mode=block` — legacy IE/Edge XSS auditor safety net |
| `Referrer-Policy` | `strict-origin-when-cross-origin` — limits referer leakage to cross-origin requests |
| `Permissions-Policy` | Disables camera, microphone, geolocation, and payment APIs |
| `Strict-Transport-Security` | 1-year HSTS; effective when served over TLS/HTTPS |

### Rate Limiting

All `/api/*` routes are protected by a per-IP sliding-window rate limiter (60 requests per minute).  
Responses include standard `X-RateLimit-*` headers so clients can see their usage.  
Exceeding the limit returns **HTTP 429** with a descriptive JSON error.

### Brute-Force / Account-Lockout Protection

Admin authentication routes track failed password attempts per source IP.  
After **5 consecutive failures** the IP is **locked out for 15 minutes** and every subsequent request returns HTTP 429 with a `Retry-After` header.  
A successful login resets the counter.

### Security Event Logging

All notable security events are captured in an in-memory ring buffer (last 500 events) and tagged with a timestamp, source IP, path, user-agent, and event type:

| Event type | Meaning |
|------------|---------|
| `auth_success` | Admin password accepted |
| `auth_failure` | Wrong password provided |
| `lockout` | IP locked out after repeated failures |
| `rate_limited` | Request rejected by the rate limiter |
| `honeypot` | Request hit the honeypot endpoint |

Events are visible in the **Admin Panel → 🔒 Security Log** section (auto-refreshes every 30 s).

### Honeypot Endpoint

`/api/admin-backdoor` is a **honeypot** — a path that looks attractive to automated scanners but serves no legitimate function.  
Any hit is immediately logged as a `honeypot` event, making it easy to spot port-scans, vulnerability probes, and poorly-written bots.

### Security API Endpoints (admin-only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/security/events?limit=N` | Returns the last N security events |
| `GET` | `/api/security/stats` | Returns event-type counts and currently-locked IPs |

---

## 🐳 Running with Docker (Local or Server)

> **Requires:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1 · Configure (optional)

Edit `docker-compose.yml` — change `ADMIN_PASSWORD` from the default before deploying:

```yaml
environment:
  - ADMIN_PASSWORD=yourSecurePassword
  # Optional: set VAPID keys so push subscriptions survive container restarts
  # Generate with: npx web-push generate-vapid-keys
  - VAPID_PUBLIC_KEY=
  - VAPID_PRIVATE_KEY=
  - VAPID_EMAIL=mailto:you@example.com
```

> If `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are **not** set, the server auto-generates them and saves them to `.vapid-keys.json` on first run. This works fine for a single container, but means push subscriptions are lost if the container is recreated.

### 2 · Build and start

```bash
docker compose up -d --build
```

- **Weather display:** http://localhost:8080
- **Admin panel:** http://localhost:8080/admin.html

### 3 · Add music

Drop MP3s into `music/`, regenerate the playlist, restart:

```bash
node generate-playlist.js
docker compose restart weathernow
```

### 4 · Stop

```bash
docker compose down
```

---

## 📣 Admin Panel

Navigate to `/admin.html` on any device on the same network.

| Feature | Details |
|---------|---------|
| **Banner** | Slides in below the alert bar, color-coded by type |
| **Popup** | Full-screen blurred overlay with animated entrance |
| **Types** | Info · Warning · Emergency (emergency pulses like NWS alerts) |
| **Duration** | Manual dismiss or auto-dismiss after 15 s – 10 min |
| **Security** | Password set via `ADMIN_PASSWORD` env var |

---

## ☁️ Hosting on a Central Server with Cloudflare

### Option A — Cloudflare Tunnel (recommended)

Exposes your Docker container publicly without opening firewall ports. Works with both the weather display **and** the admin panel, because the Node.js server handles everything.

1. **Create a tunnel** in [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels → Create tunnel.  Copy the token.

2. **Add your token** to a `.env` file:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=<your token>
   ```

3. **Uncomment** the `cloudflared` service in `docker-compose.yml`:
   ```yaml
   cloudflared:
     image: cloudflare/cloudflared:latest
     restart: unless-stopped
     command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
     depends_on:
       - weathernow
     environment:
       - CLOUDFLARE_TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
   ```

4. In the Cloudflare dashboard, add a **Public Hostname**:
   - Service: `http://weathernow:3000`
   - Your URL: `https://weather.yourdomain.com`

5. Start everything:
   ```bash
   docker compose up -d --build
   ```

   ✅ App live at `https://weather.yourdomain.com`
   ✅ Admin at `https://weather.yourdomain.com/admin.html`

> **Tip:** Protect `/admin.html` with Cloudflare Access (Zero Trust → Applications) so only you can reach it publicly.

---

### Option B — Cloudflare Pages + Functions (fully serverless, with admin panel)

This hosts the static app on **Cloudflare Pages** and runs the admin API as a **Cloudflare Pages Function** (a Worker under the hood), backed by **Cloudflare KV** for message storage. No Docker or VPS required.

#### Prerequisites
- A free Cloudflare account  
- Your domain on Cloudflare (or use the free `*.pages.dev` subdomain)
- Repository pushed to GitHub

#### 1 · Create a KV namespace

In the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → KV → Create namespace**  
Name it `WEATHERNOW_KV` and note the **Namespace ID**.

#### 2 · Deploy to Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git** → select your repo
2. Build settings:
   - Framework preset: **None**
   - Build command: *(leave blank)*
   - Build output directory: `/` (root)
3. Click **Save and Deploy**

#### 3 · Bind KV to your Pages project

After the first deploy:  (note: The reason is called weather now is i don't feel like updating the references in the code and my cf client GPU are welcome to put in a pr to change it)
**Pages project → Settings → Functions → KV namespace bindings → Add binding**

| Variable name       | KV namespace     |
|---------------------|-----------------|
| `WEATHERNOW_KV`     | WEATHERNOW_KV   |

#### 4 · Set your admin password

**Settings → Environment variables → Add variable (Production)**

| Name             | Value                |
|------------------|----------------------|
| `ADMIN_PASSWORD` | `yourSecurePassword` |

#### 5 · Redeploy

Trigger a new deploy (push a commit or use **Deployments → Retry deploy**).

✅ Weather display: `https://your-project.pages.dev`  
✅ Admin panel:  `https://your-project.pages.dev/admin.html`

> **How it works:** The file [`functions/api/[[route]].js`](functions/api/[[route]].js) is a catch-all Pages Function that intercepts all `/api/*` requests and handles the announcement API — identical contract to the Express server, so `announcements.js` and `admin.html` work without any changes.

> **Protect admin access:** In **Pages → Settings → Access** you can add a Cloudflare Access policy so `/admin.html` requires login (your Google/GitHub account etc.) before anyone can reach it.

#### 6 · Enable Push Notifications on Cloudflare Pages

The Pages Function handles push notifications using the Web Crypto API (no npm required). You just need to set your VAPID keys as environment variables.

**Generate VAPID keys** (run once locally, keep the output):
```bash
npx web-push generate-vapid-keys
```

**Add these environment variables** in **Pages → Settings → Environment variables (Production)**:

| Name               | Value                            |
|--------------------|----------------------------------|
| `VAPID_PUBLIC_KEY`  | `BExamplePublicKey...`          |
| `VAPID_PRIVATE_KEY` | `your-private-key`              |
| `VAPID_EMAIL`       | `mailto:you@example.com`        |

> **Important:** Keep `VAPID_PRIVATE_KEY` secret — only set it in the Cloudflare dashboard, never commit it to your repo. The `.vapid-keys.json` file generated by the Docker server is in `.gitignore`.

Trigger a redeploy after setting the variables. Push subscriptions are then stored in KV and survive redeployments.

> **Heads up:** Push notification encryption (the payload body) requires additional Web Crypto work beyond VAPID signing. If you find push notifications arrive empty-bodied in some browsers, this is a known limitation of the serverless implementation. The notification title and badge will always show. For fully encrypted payloads, use the Docker + `web-push` npm route instead.



---

## 🎵 Music Setup

| Method | When to use |
|--------|-------------|
| **Server playlist** | Running via Docker. Tracks load automatically on start. |
| **Folder picker** | Opening `index.html` directly (`file://`). |

```bash
node generate-playlist.js   # regenerate after adding tracks
```

---

## 🛠 Dev (no Docker)

```bash
npm install
node server.js
# → http://localhost:3000
# → http://localhost:3000/admin.html
```

Or just open `index.html` in a browser for everything except music streaming and the admin panel.
