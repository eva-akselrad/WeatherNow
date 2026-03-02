/**
 * Cloudflare Pages Function — handles all /api/* routes
 * Storage: Cloudflare KV (WEATHERNOW_KV binding)
 *
 * Deploy via: npx wrangler pages deploy  (or push to GitHub → Cloudflare Pages)
 *
 * KV Bindings required (Pages dashboard → Settings → Functions → KV namespace bindings):
 *   Variable name: WEATHERNOW_KV  →  your KV namespace
 *
 * Environment variables (Pages dashboard → Settings → Environment variables):
 *   ADMIN_PASSWORD        — admin panel password
 *   VAPID_PUBLIC_KEY      — generate with: npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY     — (same command)
 *   VAPID_EMAIL           — mailto:you@example.com
 */

const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
};

const KV_MESSAGES_KEY = 'messages';
const KV_SUBSCRIPTIONS_KEY = 'push_subscriptions';

// ── Helpers ────────────────────────────────────────────────────────
async function getMessages(env) {
    return (await env.WEATHERNOW_KV.get(KV_MESSAGES_KEY, 'json')) ?? [];
}
async function saveMessages(env, msgs) {
    await env.WEATHERNOW_KV.put(KV_MESSAGES_KEY, JSON.stringify(msgs));
}
async function getSubscriptions(env) {
    return (await env.WEATHERNOW_KV.get(KV_SUBSCRIPTIONS_KEY, 'json')) ?? [];
}
async function saveSubscriptions(env, subs) {
    await env.WEATHERNOW_KV.put(KV_SUBSCRIPTIONS_KEY, JSON.stringify(subs));
}

function checkAuth(request, env) {
    const pw = request.headers.get('x-admin-password') ?? '';
    return pw === (env.ADMIN_PASSWORD ?? 'weathernow');
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ── VAPID / Web Push (Web Crypto — no npm needed) ──────────────────

function base64UrlToUint8Array(base64Url) {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function uint8ArrayToBase64Url(uint8Array) {
    let binary = '';
    uint8Array.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signVapidJwt(audience, privateKeyB64Url, email) {
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'ES256' };
    const payload = { aud: audience, exp: now + 12 * 3600, sub: email };

    const encode = obj => uint8ArrayToBase64Url(
        new TextEncoder().encode(JSON.stringify(obj))
    );
    const headerPayload = `${encode(header)}.${encode(payload)}`;

    const keyBytes = base64UrlToUint8Array(privateKeyB64Url);
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8', keyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['sign']
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        new TextEncoder().encode(headerPayload)
    );
    return `${headerPayload}.${uint8ArrayToBase64Url(new Uint8Array(sig))}`;
}

async function sendPushMessage(sub, payload, env) {
    const vapidPublic = env.VAPID_PUBLIC_KEY;
    const vapidPrivate = env.VAPID_PRIVATE_KEY;
    const vapidEmail = env.VAPID_EMAIL || 'mailto:admin@shelly.local';

    if (!vapidPublic || !vapidPrivate) throw new Error('VAPID keys not configured');

    const endpoint = new URL(sub.endpoint);
    const audience = `${endpoint.protocol}//${endpoint.host}`;
    const jwt = await signVapidJwt(audience, vapidPrivate, vapidEmail);

    const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Authorization': `vapid t=${jwt},k=${vapidPublic}`,
            'TTL': '86400',
        },
        body: typeof payload === 'string' ? new TextEncoder().encode(payload) : payload,
    });
    return response;
}

async function fanOutPush(subs, payload, env) {
    let sent = 0, failed = 0;
    const stale = [];
    await Promise.all(subs.map(async sub => {
        try {
            const res = await sendPushMessage(sub, payload, env);
            if (res.status === 410 || res.status === 404) {
                stale.push(sub.endpoint);
                failed++;
            } else {
                sent++;
            }
        } catch { failed++; }
    }));
    const alive = subs.filter(s => !stale.includes(s.endpoint));
    if (stale.length) await saveSubscriptions(env, alive);
    return { sent, failed, total: alive.length };
}

// ── Main handler ───────────────────────────────────────────────────
export async function onRequest({ request, env }) {
    const url = new URL(request.url);
    const path = url.pathname;
    const { method } = request;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ── Health ──────────────────────────────────────────────────
    if (path === '/api/health' && method === 'GET') {
        const subs = await getSubscriptions(env);
        return json({ ok: true, pushSubscribers: subs.length });
    }

    // ── Messages ────────────────────────────────────────────────
    if (path === '/api/messages' && method === 'GET') {
        const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
        const msgs = await getMessages(env);
        return json(msgs.filter(m => m.id > since));
    }

    if (path === '/api/verify' && method === 'GET') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        return json({ ok: true });
    }

    if (path === '/api/announce' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { text = '', title = '', type = 'info', display = 'banner',
            duration = 0, tts = false, push = false } = await request.json();
        if (!text.trim()) return json({ error: 'text is required' }, 400);

        const msgs = await getMessages(env);
        const nextId = msgs.length ? Math.max(...msgs.map(m => m.id)) + 1 : 1;
        const msg = { id: nextId, text: text.trim(), title: title.trim(), type, display, duration, tts: !!tts, push: !!push, created: Date.now() };
        msgs.push(msg);
        await saveMessages(env, msgs);

        // Fan-out push if requested
        if (push) {
            const subs = await getSubscriptions(env);
            if (subs.length > 0) {
                const payload = JSON.stringify({
                    title: title.trim() || `S.H.E.L.L.Y. ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                    body: text.trim(), type, tag: `announce-${nextId}`, url: '/'
                });
                await fanOutPush(subs, payload, env);
            }
        }

        return json(msg, 201);
    }

    const oneMatch = path.match(/^\/api\/messages\/(\d+)$/);
    if (oneMatch && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(oneMatch[1]);
        const msgs = await getMessages(env);
        await saveMessages(env, msgs.filter(m => m.id !== id));
        return json({ ok: true });
    }

    if (path === '/api/messages' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveMessages(env, []);
        return json({ ok: true });
    }

    // ── Push ────────────────────────────────────────────────────
    if (path === '/api/push/vapid-key' && method === 'GET') {
        const key = env.VAPID_PUBLIC_KEY;
        if (!key) return json({ error: 'VAPID keys not configured. See README.' }, 503);
        return json({ publicKey: key });
    }

    if (path === '/api/push/count' && method === 'GET') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const subs = await getSubscriptions(env);
        return json({ count: subs.length });
    }

    if (path === '/api/push/subscribe' && method === 'POST') {
        const sub = await request.json();
        if (!sub?.endpoint) return json({ error: 'invalid subscription' }, 400);
        const subs = await getSubscriptions(env);
        const idx = subs.findIndex(s => s.endpoint === sub.endpoint);
        if (idx >= 0) subs[idx] = sub; else subs.push(sub);
        await saveSubscriptions(env, subs);
        return json({ ok: true, total: subs.length });
    }

    if (path === '/api/push/subscribe' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { endpoint } = await request.json();
        if (!endpoint) return json({ error: 'endpoint required' }, 400);
        const subs = await getSubscriptions(env);
        await saveSubscriptions(env, subs.filter(s => s.endpoint !== endpoint));
        return json({ ok: true });
    }

    if (path === '/api/push/send' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { title = 'S.H.E.L.L.Y. Test', body = 'Push notifications are working! 🌤', type = 'info' } = await request.json();
        const subs = await getSubscriptions(env);
        const payload = JSON.stringify({ title, body, type, tag: 'test-push', url: '/' });
        const results = await fanOutPush(subs, payload, env);
        return json(results);
    }

    return json({ error: 'Not found' }, 404);
}
