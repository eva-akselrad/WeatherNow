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
- **Custom Forecast** — publish a hand-crafted forecast slide targeted by map area, ZIP code, or county
- **Push notifications** — subscribe on any device, receive alerts even in the background
- **PWA** — installable on iOS, Android, and desktop; works offline with last-loaded data cached
- Multiple themes, kiosk/fullscreen mode

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

### Markdown support

All admin messages (banners, popups), custom forecast descriptions, and release notes support **Markdown** formatting. Use it to add emphasis, lists, links, or code to any message.

#### Example admin message (popup)

> **Title:** ⚠️ Scheduled Maintenance  
> **Text:**
> ```markdown
> The weather display will be **offline for ~10 minutes** tonight at *11:00 PM*.
>
> During this window:
> - Data refresh will be paused
> - Push notifications may be delayed
>
> No action is required on your part. Thank you for your patience!
> ```

#### Example custom forecast period description

> **Period name:** Tonight  
> **Description:**
> ```markdown
> Partly cloudy with a **30% chance of showers** after midnight.
> Winds **SW 10–15 mph**, gusting to *25 mph* near the coast.
> Stay weather-aware — [NWS discussion](https://forecast.weather.gov) updated hourly.
> ```

#### Example release notes

> **Version:** v2.3.0  
> **Notes:**
> ```markdown
> ## What's New
>
> - **Custom Forecast** descriptions now render **Markdown** — bold, italics, lists, and links all work.
> - Release notes history in the admin panel also renders Markdown.
> - Fixed a bug where the radar slide would briefly flash on slow connections.
>
> > Upgrade by pulling the latest image: `docker compose pull && docker compose up -d`
> ```

---

## 🗺 Custom Forecast & Location Targeting

Admins can publish a hand-crafted forecast that appears as a dedicated slide on every weather display. The forecast can be restricted to a specific geographic area so that only viewers in that area see it.

### Building a forecast

1. Open the admin panel (`/admin.html`) and scroll to **Custom Forecast**.
2. Click **＋ Add Forecast Period** and fill in one or more periods (name is required; all other fields are optional).
3. Configure a **Target Area** (see below).
4. Click **📡 PUBLISH FORECAST**.

To remove the forecast from all displays, click **Clear Forecast**.

### Target Area modes

| Mode | How it works |
|------|-------------|
| 🌍 **All Viewers** | Default — the slide appears on every display regardless of location. |
| 📍 **Map Area** | Click the interactive map to drop a center pin, then enter a radius in miles. Viewers within that circle see the slide. |
| 🏷 **ZIP Codes** | Enter a comma-separated list of 5-digit US ZIP codes. The slide appears only for viewers whose location reverse-geocodes to one of those ZIPs. |
| 🗺 **Counties** | Enter comma-separated county names with state abbreviation (e.g. `Jefferson County CO, Cook County IL`). The slide appears only for viewers in a matching county. |

> **How location is resolved:** When a viewer sets their location (search, GPS, or IP), the display silently reverse-geocodes their coordinates via Nominatim to obtain a ZIP code and county. This information is used to evaluate Map Area, ZIP, and County targeting entirely on the client — no personal data is sent to the admin server.

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
