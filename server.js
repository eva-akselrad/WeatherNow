/* ════════════════════════════════════════════════════════════════
   server.js – WeatherNow Express backend
   Serves static files + admin announcement API + Web Push
   ════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webPush = require('web-push');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

// ── Build hash (automatic cache busting) ───────────────────────
// Hash all local JS, CSS, and HTML files so that any code change
// produces a new CACHE_VERSION in the service worker, forcing the
// browser to install the new SW and discard stale cached assets.
function computeBuildHash() {
    const hash = crypto.createHash('sha256');
    for (const sub of ['js', 'css']) {
        try {
            const dir = path.join(__dirname, sub);
            fs.readdirSync(dir)
                .filter(f => f.endsWith(`.${sub}`))
                .sort()
                .forEach(f => hash.update(fs.readFileSync(path.join(dir, f))));
        } catch { /* skip if directory missing */ }
    }
    for (const f of ['index.html', 'admin.html']) {
        try { hash.update(fs.readFileSync(path.join(__dirname, f))); } catch { /* skip */ }
    }
    return hash.digest('hex').slice(0, 8);
}

const BUILD_HASH = computeBuildHash();
console.log(`[Server] Build hash: ${BUILD_HASH}`);

// Pre-process sw.js once: replace the hardcoded CACHE_VERSION with
// the computed hash so it changes automatically on every deploy.
const SW_CONTENT = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')
    .replace(/const CACHE_VERSION = ['"`][^'"`]*['"`]/, `const CACHE_VERSION = 'shelly-${BUILD_HASH}'`);

// ── Service worker (dynamic, must be before express.static) ────
// Served as a route so the injected CACHE_VERSION is always fresh.
app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(SW_CONTENT);
});

// ── Static files ───────────────────────────────────────────────
app.use(express.static(__dirname, {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
        if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
        if (filePath.endsWith('.flac')) res.setHeader('Content-Type', 'audio/flac');
        if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
        // HTML pages must never be served stale so the browser always
        // gets the latest markup (and triggers a SW update check).
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
        res.setHeader('Accept-Ranges', 'bytes');
    }
}));

// ── VAPID key management ────────────────────────────────────────
const VAPID_FILE = path.join(__dirname, '.vapid-keys.json');

function loadOrGenerateVapidKeys() {
    // Check env vars first
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return {
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY
        };
    }
    // Load from persisted file
    if (fs.existsSync(VAPID_FILE)) {
        try { return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); } catch { /* fall through */ }
    }
    // Generate new keys and persist them
    const keys = webPush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
    console.log('[Push] Generated new VAPID keys → .vapid-keys.json');
    return keys;
}

const vapidKeys = loadOrGenerateVapidKeys();
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@shelly.local';

webPush.setVapidDetails(VAPID_EMAIL, vapidKeys.publicKey, vapidKeys.privateKey);

// ── In-memory stores ────────────────────────────────────────────
let messages = [];
let nextId = 1;
let pushSubscriptions = []; // { endpoint, keys: { auth, p256dh } }

let releaseNotes = [];
let releaseNoteId = 1;

let customForecasts = [];  // array of { id, label, periods, targeting, updatedAt }
let customForecastId = 1;

// Armageddon mode – when set, overrides the entire display with a single message
// Shape: { title, text, type, activatedAt, expiresAt } or null when inactive
let armageddonState = null;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'weathernow';

// ── Rate limiter (admin routes) ────────────────────────────────
const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});
app.use('/api/verify', adminLimiter);
app.use('/api/announce', adminLimiter);
app.use('/api/messages', adminLimiter);
app.use('/api/push', adminLimiter);
app.use('/api/release-notes', adminLimiter);

// ── Auth helper ────────────────────────────────────────────────
function checkAuth(req, res) {
    const provided = req.headers['x-admin-password'] || req.body?.password;
    if (provided !== ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

// ── GET /api/messages?since=ID ─────────────────────────────────
app.get('/api/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    res.json(messages.filter(m => m.id > since));
});

// ── GET /api/poll?since=ID ─────────────────────────────────────
// Combined endpoint: returns messages + armageddon state in one request
app.get('/api/poll', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    if (armageddonState?.expiresAt && Date.now() > armageddonState.expiresAt) {
        armageddonState = null;
        console.log('[Admin] Armageddon mode auto-expired');
    }
    res.json({
        messages: messages.filter(m => m.id > since),
        armageddon: armageddonState ? { active: true, ...armageddonState } : { active: false },
    });
});

// ── GET /api/verify ────────────────────────────────────────────
app.get('/api/verify', (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json({ ok: true });
});

// ── POST /api/announce ─────────────────────────────────────────
// Body: { password, text, type, display, duration, title, tts, push, targeting }
app.post('/api/announce', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { text, type = 'info', display = 'banner', duration = 0, title = '', tts = false, push = false, targeting = { mode: 'all' } } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    const msg = {
        id: nextId++,
        text: text.trim(),
        title: title.trim(),
        type,
        display,
        duration,
        tts: !!tts,
        push: !!push,
        targeting,
        created: Date.now()
    };
    messages.push(msg);
    console.log(`[Admin] New ${type} ${display}: ${text.slice(0, 80)}`);

    // Fan-out push notification if requested
    if (push && pushSubscriptions.length > 0) {
        const payload = JSON.stringify({
            title: title.trim() || `S.H.E.L.L.Y. ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            body: text.trim(),
            type,
            tag: `announce-${msg.id}`,
            url: '/'
        });
        await fanOutPush(payload);
    }

    res.json(msg);
});

// ── DELETE /api/messages/:id ───────────────────────────────────
app.delete('/api/messages/:id', (req, res) => {
    if (!checkAuth(req, res)) return;
    const id = parseInt(req.params.id);
    messages = messages.filter(m => m.id !== id);
    res.json({ ok: true });
});

// ── DELETE /api/messages ───────────────────────────────────────
app.delete('/api/messages', (req, res) => {
    if (!checkAuth(req, res)) return;
    messages = [];
    res.json({ ok: true });
});

// ── GET /api/armageddon ────────────────────────────────────────
// Public – display clients poll this to check override state
app.get('/api/armageddon', (req, res) => {
    if (armageddonState?.expiresAt && Date.now() > armageddonState.expiresAt) {
        armageddonState = null;
        console.log('[Admin] Armageddon mode auto-expired');
    }
    res.json(armageddonState ? { active: true, ...armageddonState } : { active: false });
});

// ── POST /api/armageddon ───────────────────────────────────────
// Body: { title, text, type, duration }  duration = minutes (0 = manual)
app.post('/api/armageddon', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { title = '', text, type = 'emergency', duration = 0 } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });
    const durationMs = Math.max(0, parseInt(duration) || 0) * 60 * 1000;
    armageddonState = {
        title: title.trim(), text: text.trim(), type,
        activatedAt: Date.now(),
        expiresAt: durationMs > 0 ? Date.now() + durationMs : null,
    };
    console.log('[Admin] Armageddon mode ACTIVATED');
    res.json({ ok: true, ...armageddonState });
});

// ── DELETE /api/armageddon ─────────────────────────────────────
app.delete('/api/armageddon', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    armageddonState = null;
    console.log('[Admin] Armageddon mode deactivated');
    res.json({ ok: true });
});

// ── GET /api/push/vapid-key ─────────────────────────────────────
app.get('/api/push/vapid-key', (_, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});
app.get('/api/push/count', (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json({ count: pushSubscriptions.length });
});

// ── POST /api/push/subscribe ────────────────────────────────────
app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'invalid subscription' });
    // Upsert by endpoint
    const existing = pushSubscriptions.findIndex(s => s.endpoint === sub.endpoint);
    if (existing >= 0) {
        pushSubscriptions[existing] = sub;
    } else {
        pushSubscriptions.push(sub);
    }
    console.log(`[Push] Subscribed: ${pushSubscriptions.length} total`);
    res.json({ ok: true, total: pushSubscriptions.length });
});

// ── DELETE /api/push/subscribe ─────────────────────────────────
app.delete('/api/push/subscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
    console.log(`[Push] Unsubscribed: ${pushSubscriptions.length} remaining`);
    res.json({ ok: true, total: pushSubscriptions.length });
});

// ── POST /api/push/send (admin test) ──────────────────────────
app.post('/api/push/send', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { title = 'S.H.E.L.L.Y. Test', body = 'Push notifications are working! 🌤', type = 'info' } = req.body;
    const payload = JSON.stringify({ title, body, type, tag: 'test-push', url: '/' });
    const results = await fanOutPush(payload);
    res.json({ sent: results.sent, failed: results.failed, total: results.total });
});

// ── Fan-out helper ─────────────────────────────────────────────
async function fanOutPush(payload) {
    let sent = 0, failed = 0;
    const stale = [];

    await Promise.all(pushSubscriptions.map(async sub => {
        try {
            await webPush.sendNotification(sub, payload);
            sent++;
        } catch (err) {
            failed++;
            // 410 Gone = subscription is expired/unsubscribed
            if (err.statusCode === 410 || err.statusCode === 404) stale.push(sub.endpoint);
            else console.warn('[Push] Send error:', err.message);
        }
    }));

    // Remove stale subscriptions
    if (stale.length) {
        pushSubscriptions = pushSubscriptions.filter(s => !stale.includes(s.endpoint));
        console.log(`[Push] Removed ${stale.length} stale subscription(s)`);
    }

    console.log(`[Push] Fan-out: ${sent} sent, ${failed} failed / ${pushSubscriptions.length} active`);
    return { sent, failed, total: pushSubscriptions.length };
}

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({
    ok: true,
    uptime: process.uptime(),
    pushSubscribers: pushSubscriptions.length
}));

// ── Release Notes ─────────────────────────────────────────────
app.get('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json(releaseNotes);
});

app.post('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { version = '', notes = '' } = req.body;
    if (!notes.trim()) return res.status(400).json({ error: 'notes required' });
    const note = { id: releaseNoteId++, version: version.trim(), notes: notes.trim(), created: Date.now() };
    releaseNotes.unshift(note);
    console.log(`[Admin] Release note posted: ${version}`);
    res.json(note);
});

app.delete('/api/release-notes/:id', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    releaseNotes = releaseNotes.filter(n => n.id !== parseInt(req.params.id));
    res.json({ ok: true });
});

app.delete('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    releaseNotes = [];
    res.json({ ok: true });
});

// ── Custom Forecast ───────────────────────────────────────────
// Returns array of all custom forecasts
app.get('/api/custom-forecast', (_, res) => {
    // Short public cache — display clients refresh every 10 min anyway.
    // Use stale-while-revalidate so the browser reuses the cached response.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(customForecasts);
});

// Add a new forecast (or replace one with same label if label provided)
app.post('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { periods = [], targeting = { mode: 'all' }, label: rawLabel = '' } = req.body;
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (!periods.length) return res.status(400).json({ error: 'periods required' });
    // If a non-empty label is given and a forecast with that label already exists, replace it
    const existing = label ? customForecasts.findIndex(c => c.label === label) : -1;
    const entry = { id: existing >= 0 ? customForecasts[existing].id : customForecastId++, label, periods, targeting, updatedAt: Date.now() };
    if (existing >= 0) {
        customForecasts[existing] = entry;
    } else {
        customForecasts.push(entry);
    }
    console.log(`[Admin] Custom forecast ${existing >= 0 ? 'updated' : 'added'}: "${label || entry.id}" — ${periods.length} period(s), targeting: ${targeting.mode}`);
    res.json(entry);
});

// Delete a single forecast by id
app.delete('/api/custom-forecast/:id', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const before = customForecasts.length;
    customForecasts = customForecasts.filter(c => c.id !== id);
    if (customForecasts.length === before) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
});

// Delete all forecasts
app.delete('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    customForecasts = [];
    res.json({ ok: true });
});

// ── GET /api/spc-outlook?day=1|2|3 ───────────────────────────
// Proxies SPC categorical outlook GeoJSON to avoid browser CORS restrictions.
// In-memory TTL cache (15 min) so repeated client refreshes don't hammer SPC.
// The cache is permanently bounded to 3 entries (days 1, 2, 3) — no cleanup needed.
const spcCache = {}; // { [day]: { data, expiresAt } }
const SPC_TTL_MS = 15 * 60 * 1000;

app.get('/api/spc-outlook', async (req, res) => {
    const day = req.query.day || '1';
    const validFiles = {
        '1': 'day1otlk_cat.nolyr.geojson',
        '2': 'day2otlk_cat.nolyr.geojson',
        '3': 'day3otlk_cat.nolyr.geojson',
    };
    const file = validFiles[day];
    if (!file) return res.status(400).json({ error: 'Invalid day parameter. Use 1, 2, or 3.' });

    // Serve from cache if fresh
    const cached = spcCache[day];
    if (cached && Date.now() < cached.expiresAt) {
        res.setHeader('Cache-Control', 'public, max-age=900');
        return res.json(cached.data);
    }

    const url = `https://www.spc.noaa.gov/products/outlook/${file}`;
    try {
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'S.H.E.L.L.Y.-WeatherClient/1.0 (weather display)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!upstream.ok) {
            // On upstream error, serve stale cache if available
            if (cached) {
                res.setHeader('Cache-Control', 'public, max-age=900');
                return res.json(cached.data);
            }
            return res.status(502).json({ error: `SPC returned ${upstream.status}` });
        }
        const data = await upstream.json();
        spcCache[day] = { data, expiresAt: Date.now() + SPC_TTL_MS };
        res.setHeader('Cache-Control', 'public, max-age=900');
        res.json(data);
    } catch (err) {
        console.error('[SPC] Proxy error:', err.message);
        // Serve stale cache rather than returning an error
        if (cached) {
            res.setHeader('Cache-Control', 'public, max-age=900');
            return res.json(cached.data);
        }
        res.status(502).json({ error: 'Failed to fetch SPC outlook data' });
    }
});

// ── GET /api/local-cam?lat=X&lon=Y ───────────────────────────
// Proxies Windy Webcam API v3 to find webcams within 20 miles of a location.
// Requires WINDY_API_KEY environment variable (free registration at windy.com).
// Returns { cameras: [] } gracefully if no key is set or no cameras are found.
// In-memory TTL cache (10 min) keyed by rounded coordinates.
const camCache = {}; // { [key]: { data, expiresAt } }
const CAM_TTL_MS = 10 * 60 * 1000;
const CAM_RADIUS_METERS = 32187; // 20 miles

app.get('/api/local-cam', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ error: 'lat and lon must be valid coordinates' });
    }

    const apiKey = process.env.WINDY_API_KEY;
    if (!apiKey) {
        return res.json({ cameras: [] });
    }

    // Round to 2 decimal places (~1 km) for cache key
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = camCache[cacheKey];
    if (cached && Date.now() < cached.expiresAt) {
        res.setHeader('Cache-Control', 'public, max-age=600');
        return res.json(cached.data);
    }

    const url = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},${CAM_RADIUS_METERS}&limit=5&include=location,player,images`;
    try {
        const upstream = await fetch(url, {
            headers: {
                'x-windy-api-key': apiKey,
                'User-Agent': 'S.H.E.L.L.Y.-WeatherClient/1.0 (weather display)',
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!upstream.ok) {
            if (cached) {
                res.setHeader('Cache-Control', 'public, max-age=600');
                return res.json(cached.data);
            }
            return res.json({ cameras: [] });
        }
        const data = await upstream.json();
        const result = { cameras: Array.isArray(data.webcams) ? data.webcams : [] };
        camCache[cacheKey] = { data: result, expiresAt: Date.now() + CAM_TTL_MS };
        res.setHeader('Cache-Control', 'public, max-age=600');
        res.json(result);
    } catch (err) {
        console.error('[LocalCam] Proxy error:', err.message);
        if (cached) {
            res.setHeader('Cache-Control', 'public, max-age=600');
            return res.json(cached.data);
        }
        res.json({ cameras: [] });
    }
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WeatherNow running on http://0.0.0.0:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
    console.log(`VAPID public key: ${vapidKeys.publicKey.slice(0, 20)}…`);
});
