/* ════════════════════════════════════════════════════════════════
   server.js – WeatherNow Express backend
   Serves static files + admin announcement API + Web Push
   ════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const webPush = require('web-push');

const app = express();
app.use(express.json());

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
