/* ════════════════════════════════════════════════════════════════
   server.js – WeatherNow Express backend
   Serves static files + admin announcement API + Web Push
   ════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const webPush = require('web-push');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

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
    // Permissions policy – disable access to sensors/camera/mic
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // HSTS – enforce HTTPS for 1 year (only effective over TLS)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Content Security Policy
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://mesonet.agron.iastate.edu https://api.weather.gov",
            "connect-src 'self' https://api.weather.gov https://airnowapi.org https://api.ipify.org",
            "font-src 'self'",
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
    // Use socket address directly; do not trust X-Forwarded-For unless behind a
    // known-trusted reverse proxy (Cloudflare, nginx) to prevent IP spoofing.
    const ip = req.socket.remoteAddress || 'unknown';
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

// ── Security: rate limiter (per-IP, express-rate-limit) ────────
const apiLimiter = rateLimit({
    windowMs: 60_000,       // 1-minute window
    max: 60,                // max requests per window per IP
    standardHeaders: true,  // return X-RateLimit-* headers
    legacyHeaders: false,
    handler(req, res) {
        logSecurityEvent('rate_limited', req);
        res.status(429).json({ error: 'Too many requests – slow down' });
    }
});

// Apply rate limiter to all /api routes
app.use('/api', apiLimiter);

// ── Security: brute-force lockout (per-IP, auth endpoints) ────
const bruteForceMap = new Map(); // ip → { failures, lockedUntil }
const BRUTE_MAX_FAILURES = 5;
const BRUTE_LOCKOUT_MS = 15 * 60_000; // 15 minutes

function checkBruteForce(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = bruteForceMap.get(ip) || { failures: 0, lockedUntil: 0 };
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
    const ip = req.socket.remoteAddress || 'unknown';
    bruteForceMap.delete(ip);
    logSecurityEvent('auth_success', req);
}

function recordAuthFailure(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    const entry = bruteForceMap.get(ip) || { failures: 0, lockedUntil: 0 };
    entry.failures++;
    if (entry.failures >= BRUTE_MAX_FAILURES) {
        entry.lockedUntil = Date.now() + BRUTE_LOCKOUT_MS;
        logSecurityEvent('lockout', req, `failures=${entry.failures}`);
    } else {
        logSecurityEvent('auth_failure', req, `failures=${entry.failures}/${BRUTE_MAX_FAILURES}`);
    }
    bruteForceMap.set(ip, entry);
}

// Periodically evict expired entries from the brute-force map to prevent
// unbounded memory growth in long-running deployments.
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of bruteForceMap) {
        // Remove entries that are no longer locked and have been idle long enough
        if (entry.lockedUntil < now - BRUTE_LOCKOUT_MS) bruteForceMap.delete(ip);
    }
}, 5 * 60_000); // run every 5 minutes

// ── Static files ───────────────────────────────────────────────
app.use(express.static(__dirname, {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
        if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
        if (filePath.endsWith('.flac')) res.setHeader('Content-Type', 'audio/flac');
        if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
        // Service worker must be served at root scope
        if (filePath.endsWith('sw.js')) {
            res.setHeader('Service-Worker-Allowed', '/');
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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'weathernow';

// ── Auth helper ────────────────────────────────────────────────
function checkAuth(req, res) {
    if (!checkBruteForce(req, res)) return false;
    const provided = req.headers['x-admin-password'] || req.body?.password;
    if (provided !== ADMIN_PASSWORD) {
        recordAuthFailure(req, res);
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
// Any request to this URL is logged as a suspicious probe.
// Legitimate users should never hit this path.
app.all('/api/admin-backdoor', (req, res) => {
    logSecurityEvent('honeypot', req, `method=${req.method}`);
    // Return a convincing-but-fake 403 to frustrate automated scanners
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

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WeatherNow running on http://0.0.0.0:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
    console.log(`VAPID public key: ${vapidKeys.publicKey.slice(0, 20)}…`);
});
