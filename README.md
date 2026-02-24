# WeatherNow 🌤

A modern, real-time weather client inspired by WeatherStar 4000. Vanilla HTML/CSS/JS, NOAA weather data, IEM NEXRAD radar, animated background music, TTS severe weather alerts, and admin announcements.

---

## ✨ Features

- Live NOAA/NWS weather — no API key required
- IEM NEXRAD animated radar (6 frames, auto-refresh)
- Slides: Conditions, Obs, Hourly, Extended, Precip Chart, Almanac, Air Quality, Pollen, Radar, Severe Alerts
- Background music (server playlist auto-loaded + folder picker fallback)
- Text-to-speech severe weather alerts with music ducking
- **Admin panel** — push info/warning/emergency banners or full-screen popups to every display
- Multiple themes, kiosk/fullscreen mode

---

## 🐳 Running with Docker (Local or Server)

> **Requires:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1 · Configure (optional)

Edit `docker-compose.yml` — change `ADMIN_PASSWORD` from the default before deploying:

```yaml
environment:
  - ADMIN_PASSWORD=yourSecurePassword
```

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

After the first deploy:  
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
