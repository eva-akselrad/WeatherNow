# WeatherNow 🌤

A modern, real-time weather client inspired by WeatherStar 4000, built with vanilla HTML/CSS/JS and powered by NOAA weather APIs.

---

## ✨ Features

- Live NOAA/NWS weather data – no API key required
- Slides: Current Conditions, Detailed Observations, Hourly, Extended, Precipitation Chart, Almanac, Air Quality, Pollen, Radar, Severe Alerts
- Background music player (server playlist + local folder picker)
- Text-to-speech severe weather alerts
- Multiple themes, kiosk mode, customizable cycle speed

---

## 🐳 Running with Docker (Local)

> **Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.

### 1 · Build and start

```bash
# From the project root
docker compose up -d --build
```

The app will be available at **http://localhost:8080**

### 2 · Add or change music

Drop MP3 files into the `music/` folder alongside `playlist.json`, then regenerate the playlist:

```bash
node generate-playlist.js
```

Because `music/` is volume-mounted, no rebuild is needed — just restart the container:

```bash
docker compose restart weathernow
```

### 3 · Stop

```bash
docker compose down
```

---

## ☁️ Hosting on a Central Server with Cloudflare

There are two recommended paths depending on your setup.

---

### Option A — Cloudflare Tunnel (recommended for home/VPS servers)

This exposes your local or VPS Docker container publicly without opening firewall ports.

#### Prerequisites
- A Cloudflare account (free tier works)
- Your domain added to Cloudflare DNS

#### Steps

1. **Install `cloudflared`** on the *server machine*:
   ```bash
   # Linux/amd64
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
   chmod +x /usr/local/bin/cloudflared
   ```

2. **Log in** and **create a tunnel**:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create weathernow
   ```
   Note the **Tunnel ID** printed (e.g. `abc123…`).

3. **Get the tunnel token** from the Cloudflare Zero Trust dashboard:
   *Zero Trust → Networks → Tunnels → "weathernow" → Configure → Copy token*

4. **Create a `.env` file** in the project root:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=<paste your token here>
   ```

5. **Uncomment the `cloudflared` service** in `docker-compose.yml`:
   ```yaml
   cloudflared:
     image: cloudflare/cloudflared:latest
     container_name: weathernow-tunnel
     restart: unless-stopped
     command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
     depends_on:
       - weathernow
     environment:
       - CLOUDFLARE_TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
   ```

6. In the **Cloudflare Zero Trust dashboard**, add a Public Hostname:
   - Subdomain: `weather` (or whatever you like)
   - Domain: `yourdomain.com`
   - Service: `http://weathernow:80`

7. **Start everything:**
   ```bash
   docker compose up -d --build
   ```

   Your app is now live at `https://weather.yourdomain.com` with automatic HTTPS handled by Cloudflare. ✅

---

### Option B — Cloudflare Pages (static hosting, no server required)

Use this if you don't have a persistent server and want fully managed hosting. Note: music streaming from `music/` won't work this way — users would need the folder picker.

1. Push this repository to GitHub.
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → Create → Pages → Connect to Git**.
3. Select your repo. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/` (root)
4. Click **Save and Deploy**.

Cloudflare will detect changes on every `git push` and redeploy automatically.

---

## 🎵 Music Setup

| Method | When to use |
|--------|-------------|
| **Server playlist** (`music/playlist.json`) | When running via Docker / web server. Tracks load automatically. |
| **Folder picker** (⚙ Settings → Load Music Folder) | When opening `index.html` directly in a browser (`file://`). |

Regenerate `playlist.json` after adding tracks:
```bash
node generate-playlist.js
```

---

## 🛠 Development (no Docker)

Just open `index.html` in your browser — no build step required.  
For music streaming, serve the folder with a local server:

```bash
# Python 3
python -m http.server 8080

# Node (if you have npx)
npx serve .
```

Then open **http://localhost:8080**.
