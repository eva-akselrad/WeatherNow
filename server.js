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

// ── Trusted-proxy support ──────────────────────────────────────
// Set TRUST_PROXY=1 (or any truthy string) when running behind a
// single-hop reverse proxy / Cloudflare Tunnel so that req.ip
// resolves to the real client address instead of the container IP.
// Without this, rate-limiting and brute-force protection would key
// on the proxy address, applying those limits globally.
if (process.env.TRUST_PROXY) {
    const hops = parseInt(process.env.TRUST_PROXY);
    app.set('trust proxy', isNaN(hops) ? 1 : hops);
}

// ── Security: HTTP security headers ───────────────────────────
app.use((req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Block MIME-type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Prevent cross-site scripting via legacy IE header
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Only send Referrer when same origin
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Disable camera/mic/payment; allow geolocation for self (used by weather location feature)
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
    // HSTS – enforce HTTPS for 1 year (only effective over TLS)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Content Security Policy
    // Allow-list covers all third-party origins used by index.html and admin.html:
    //   fonts.googleapis.com / fonts.gstatic.com – Google Fonts
    //   unpkg.com – Leaflet CSS + JS
    //   cdn.jsdelivr.net – marked.js
    //   tilecache.rainviewer.com / api.rainviewer.com – radar tiles
    //   *.cartocdn.com – basemap tiles
    //   openstreetmap.org / nominatim.openstreetmap.org – geocoding
    //   api.open-meteo.com / air-quality-api.open-meteo.com – forecast/AQI
    //   api.weather.gov – NWS/NOAA data
    //   ipapi.co – IP geolocation
    //   airnowapi.org – air quality
    //   api.ipify.org – public IP lookup
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob: https://mesonet.agron.iastate.edu https://api.weather.gov https://tilecache.rainviewer.com https://*.cartocdn.com https://unpkg.com",
            "connect-src 'self' https://api.weather.gov https://airnowapi.org https://api.ipify.org https://api.open-meteo.com https://air-quality-api.open-meteo.com https://nominatim.openstreetmap.org https://ipapi.co https://api.rainviewer.com",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self'"
        ].join('; ')
    );
    next();
});

// ── Security: in-memory event log ─────────────────────────────
const MAX_SECURITY_EVENTS = 500;
const securityEvents = [];
let securityEventCounter = 0;

function logSecurityEvent(type, req, detail = '') {
    // Use req.ip (respects trust proxy setting) rather than trusting
    // the X-Forwarded-For header directly to prevent IP spoofing.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const event = {
        id: ++securityEventCounter,
        ts: new Date().toISOString(),
        type,        // 'auth_failure' | 'auth_success' | 'rate_limited' | 'honeypot' | 'lockout'
        ip,
        method: req.method,
        path: req.path,
        ua: (req.headers['user-agent'] || '').slice(0, 200),
        detail
    };
    securityEvents.unshift(event); // newest first
    if (securityEvents.length > MAX_SECURITY_EVENTS) securityEvents.pop();
    console.log(`[Security] ${type.toUpperCase()} ip=${ip} path=${req.path}${detail ? ' ' + detail : ''}`);
    return event;
}

// ── Security: brute-force lockout (per-IP, auth endpoints) ────
const bruteForceMap = new Map(); // ip → { failures, lockedUntil, lastAttempt }
const BRUTE_MAX_FAILURES = 5;
const BRUTE_LOCKOUT_MS = 15 * 60_000; // 15 minutes
const BRUTE_IDLE_TTL_MS = 60 * 60_000; // evict idle entries after 1 hour

function checkBruteForce(req, res) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = bruteForceMap.get(ip) || { failures: 0, lockedUntil: 0, lastAttempt: 0 };
    if (entry.lockedUntil > now) {
        const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
        logSecurityEvent('lockout', req, `retry_after=${retryAfter}s`);
        res.setHeader('Retry-After', retryAfter);
        res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfter}s` });
        return false;
    }
    return true;
}

function recordAuthSuccess(req) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    bruteForceMap.delete(ip);
    // Only log auth_success on the verify (login) endpoint to avoid
    // filling the ring buffer with routine admin polling events.
    if (req.path === '/api/verify') {
        logSecurityEvent('auth_success', req);
    }
}

function recordAuthFailure(req) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = bruteForceMap.get(ip) || { failures: 0, lockedUntil: 0, lastAttempt: 0 };
    entry.failures++;
    entry.lastAttempt = now;
    if (entry.failures >= BRUTE_MAX_FAILURES) {
        entry.lockedUntil = now + BRUTE_LOCKOUT_MS;
        logSecurityEvent('lockout', req, `failures=${entry.failures}`);
    } else {
        logSecurityEvent('auth_failure', req, `failures=${entry.failures}/${BRUTE_MAX_FAILURES}`);
    }
    bruteForceMap.set(ip, entry);
}

// Periodically evict idle entries from the brute-force map to prevent
// unbounded memory growth in long-running deployments.
// Only entries that haven't been touched for BRUTE_IDLE_TTL_MS and are
// no longer locked are removed; active failure counters are preserved.
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of bruteForceMap) {
        const idle = now - entry.lastAttempt > BRUTE_IDLE_TTL_MS;
        const unlocked = entry.lockedUntil < now;
        if (idle && unlocked) bruteForceMap.delete(ip);
    }
}, 5 * 60_000); // run every 5 minutes

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

let customForecast = { periods: [], targeting: { mode: 'all' }, updatedAt: null };

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
app.use('/api/security', adminLimiter);
app.use('/api/custom-forecast', (req, res, next) => {
    if (req.method === 'GET') {
        return next();
    }
    return adminLimiter(req, res, next);
});

// ── Auth helper ────────────────────────────────────────────────
function checkAuth(req, res) {
    if (!checkBruteForce(req, res)) return false;
    const provided = req.headers['x-admin-password'] || req.body?.password;
    if (provided !== ADMIN_PASSWORD) {
        recordAuthFailure(req);
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    recordAuthSuccess(req);
    return true;
}

// ── GET /api/messages?since=ID ─────────────────────────────────
app.get('/api/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    res.json(messages.filter(m => m.id > since));
});

// ── GET /api/verify ────────────────────────────────────────────
app.get('/api/verify', (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json({ ok: true });
});

// ── POST /api/announce ─────────────────────────────────────────
// Body: { password, text, type, display, duration, title, tts, push }
app.post('/api/announce', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { text, type = 'info', display = 'banner', duration = 0, title = '', tts = false, push = false } = req.body;
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

// ── GET /api/push/vapid-key ─────────────────────────────────────
app.get('/api/push/vapid-key', (_, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

// ── GET /api/push/count (admin) ────────────────────────────────
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

// ── Security: honeypot endpoint ───────────────────────────────
// Legitimate users never hit this path. Any request here is logged
// as a suspicious probe (automated scanner, vulnerability tester, etc.).
// A believable 403 is returned to frustrate automated tools.
app.all('/api/admin-backdoor', (req, res) => {
    logSecurityEvent('honeypot', req, `method=${req.method}`);
    res.status(403).json({ error: 'Forbidden' });
});

// ── Security: events log (admin only) ─────────────────────────
app.get('/api/security/events', (req, res) => {
    if (!checkAuth(req, res)) return;
    const limit = Math.min(parseInt(req.query.limit) || 100, MAX_SECURITY_EVENTS);
    res.json({ events: securityEvents.slice(0, limit), total: securityEvents.length });
});

// ── Security: stats summary (admin only) ──────────────────────
app.get('/api/security/stats', (req, res) => {
    if (!checkAuth(req, res)) return;
    const counts = {};
    for (const e of securityEvents) counts[e.type] = (counts[e.type] || 0) + 1;
    const lockedIps = [];
    const now = Date.now();
    bruteForceMap.forEach((v, ip) => { if (v.lockedUntil > now) lockedIps.push(ip); });
    res.json({ counts, lockedIps, totalEvents: securityEvents.length });
});

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
app.get('/api/custom-forecast', (_, res) => {
    res.json(customForecast);
});

app.post('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { periods = [], targeting = { mode: 'all' } } = req.body;
    customForecast = { periods, targeting, updatedAt: Date.now() };
    console.log(`[Admin] Custom forecast updated: ${periods.length} period(s), targeting: ${targeting.mode}`);
    res.json(customForecast);
});

app.delete('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    customForecast = { periods: [], targeting: { mode: 'all' }, updatedAt: null };
    res.json({ ok: true });
});

// ── GET /api/spc-outlook?day=1|2|3 ───────────────────────────
// Proxies SPC categorical outlook GeoJSON to avoid browser CORS restrictions.
app.get('/api/spc-outlook', async (req, res) => {
    const day = req.query.day || '1';
    const validFiles = {
        '1': 'day1otlk_cat.nolyr.geojson',
        '2': 'day2otlk_cat.nolyr.geojson',
        '3': 'day3otlk_cat.nolyr.geojson',
    };
    const file = validFiles[day];
    if (!file) return res.status(400).json({ error: 'Invalid day parameter. Use 1, 2, or 3.' });

    const url = `https://www.spc.noaa.gov/products/outlook/${file}`;
    try {
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'S.H.E.L.L.Y.-WeatherClient/1.0 (weather display)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!upstream.ok) {
            return res.status(502).json({ error: `SPC returned ${upstream.status}` });
        }
        const data = await upstream.json();
        res.setHeader('Cache-Control', 'public, max-age=900'); // 15-minute cache
        res.json(data);
    } catch (err) {
        console.error('[SPC] Proxy error:', err.message);
        res.status(502).json({ error: 'Failed to fetch SPC outlook data' });
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
