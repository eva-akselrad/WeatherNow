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
const KV_RELEASE_NOTES_KEY = 'release_notes';
const KV_CUSTOM_FORECAST_KEY = 'custom_forecast';
const KV_ARMAGEDDON_KEY = 'armageddon';
const KV_MSG_SEQ_KEY = 'msg_next_id'; // persistent counter — never resets on message delete
const KV_ACKS_KEY = 'msg_acks'; // { [msgId]: [visitorId, ...] }

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
async function getReleaseNotes(env) {
    return (await env.WEATHERNOW_KV.get(KV_RELEASE_NOTES_KEY, 'json')) ?? [];
}
async function saveReleaseNotes(env, notes) {
    await env.WEATHERNOW_KV.put(KV_RELEASE_NOTES_KEY, JSON.stringify(notes));
}
async function getCustomForecasts(env) {
    const stored = await env.WEATHERNOW_KV.get(KV_CUSTOM_FORECAST_KEY, 'json');
    // Migrate legacy single-object storage to array format
    if (stored && !Array.isArray(stored)) {
        return stored.periods?.length ? [{ id: 1, label: '', ...stored }] : [];
    }
    return stored ?? [];
}
async function saveCustomForecasts(env, forecasts) {
    await env.WEATHERNOW_KV.put(KV_CUSTOM_FORECAST_KEY, JSON.stringify(forecasts));
}

async function getAcks(env) {
    return (await env.WEATHERNOW_KV.get(KV_ACKS_KEY, 'json')) ?? {};
}
async function saveAcks(env, acks) {
    await env.WEATHERNOW_KV.put(KV_ACKS_KEY, JSON.stringify(acks));
}

async function getArmageddonState(env) {
    return (await env.WEATHERNOW_KV.get(KV_ARMAGEDDON_KEY, 'json')) ?? null;
}
async function saveArmageddonState(env, state) {
    if (state === null) {
        await env.WEATHERNOW_KV.delete(KV_ARMAGEDDON_KEY);
    } else {
        await env.WEATHERNOW_KV.put(KV_ARMAGEDDON_KEY, JSON.stringify(state));
    }
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
        const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
        return json(msgs.filter(m => m.id > since).map(m => ({
            ...m,
            ackCount: (acks[m.id] ?? []).length,
        })));
    }

    // ── Poll (combined messages + armageddon in one request) ────
    if (path === '/api/poll' && method === 'GET') {
        const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
        const [msgs, armageddon] = await Promise.all([getMessages(env), getArmageddonState(env)]);
        let armState = armageddon;
        if (armState?.expiresAt && Date.now() > armState.expiresAt) {
            await saveArmageddonState(env, null);
            armState = null;
        }
        return json({
            messages: msgs.filter(m => m.id > since),
            armageddon: armState ? { active: true, ...armState } : { active: false },
        });
    }

    if (path === '/api/verify' && method === 'GET') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        return json({ ok: true });
    }

    if (path === '/api/announce' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { text = '', title = '', type = 'info', display = 'banner',
            duration = 0, tts = false, push = false, targeting = { mode: 'all' } } = await request.json();
        if (!text.trim()) return json({ error: 'text is required' }, 400);

        const msgs = await getMessages(env);
        // Use a persistent KV counter so IDs never recycle when messages are deleted.
        // Fall back to max(existing)+1 for legacy deployments where the counter is absent.
        const stored = parseInt(await env.WEATHERNOW_KV.get(KV_MSG_SEQ_KEY) || '0', 10);
        const maxExisting = msgs.length ? Math.max(...msgs.map(m => m.id)) : 0;
        const nextId = Math.max(stored, maxExisting) + 1;
        await env.WEATHERNOW_KV.put(KV_MSG_SEQ_KEY, String(nextId));
        const msg = { id: nextId, text: text.trim(), title: title.trim(), type, display, duration, tts: !!tts, push: !!push, targeting, created: Date.now() };
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
        const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
        await saveMessages(env, msgs.filter(m => m.id !== id));
        delete acks[id];
        await saveAcks(env, acks);
        return json({ ok: true });
    }

    if (path === '/api/messages' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await Promise.all([saveMessages(env, []), saveAcks(env, {})]);
        return json({ ok: true });
    }

    // ── Acknowledge ──────────────────────────────────────────────
    // Public – no admin auth required. Body: { visitorId: string }
    const ackMatch = path.match(/^\/api\/messages\/(\d+)\/acknowledge$/);
    if (ackMatch && method === 'POST') {
        const id = parseInt(ackMatch[1]);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
        const { visitorId } = body;
        if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 128 || !/^[\w\-]+$/.test(visitorId)) {
            return json({ error: 'visitorId must be alphanumeric with optional hyphens, max 128 characters' }, 400);
        }
        const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
        if (!msgs.find(m => m.id === id)) return json({ error: 'not found' }, 404);
        if (!Array.isArray(acks[id])) acks[id] = [];
        if (!acks[id].includes(visitorId)) acks[id].push(visitorId);
        await saveAcks(env, acks);
        return json({ ok: true, ackCount: acks[id].length });
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

    // ── Release Notes ────────────────────────────────────────────
    if (path === '/api/release-notes' && method === 'GET') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        return json(await getReleaseNotes(env));
    }

    if (path === '/api/release-notes' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { version = '', notes = '' } = await request.json();
        if (!notes.trim()) return json({ error: 'notes is required' }, 400);
        const existing = await getReleaseNotes(env);
        const nextId = existing.length ? Math.max(...existing.map(n => n.id)) + 1 : 1;
        const note = { id: nextId, version: version.trim(), notes: notes.trim(), created: Date.now() };
        await saveReleaseNotes(env, [note, ...existing]);
        return json(note, 201);
    }

    const releaseNoteMatch = path.match(/^\/api\/release-notes\/(\d+)$/);
    if (releaseNoteMatch && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(releaseNoteMatch[1]);
        const existing = await getReleaseNotes(env);
        await saveReleaseNotes(env, existing.filter(n => n.id !== id));
        return json({ ok: true });
    }

    if (path === '/api/release-notes' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveReleaseNotes(env, []);
        return json({ ok: true });
    }

    // ── Custom Forecast ──────────────────────────────────────────
    if (path === '/api/custom-forecast' && method === 'GET') {
        return json(await getCustomForecasts(env));
    }

    if (path === '/api/custom-forecast' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { periods = [], targeting = { mode: 'all' }, label: rawLabel = '' } = await request.json();
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        if (!periods.length) return json({ error: 'periods required' }, 400);
        const forecasts = await getCustomForecasts(env);
        // Replace in-place if a non-empty label already exists, otherwise append
        const existing = label ? forecasts.findIndex(c => c.label === label) : -1;
        const nextId = forecasts.length ? Math.max(...forecasts.map(c => c.id ?? 0)) + 1 : 1;
        const entry = { id: existing >= 0 ? forecasts[existing].id : nextId, label, periods, targeting, updatedAt: Date.now() };
        if (existing >= 0) {
            forecasts[existing] = entry;
        } else {
            forecasts.push(entry);
        }
        await saveCustomForecasts(env, forecasts);
        return json(entry, 201);
    }

    const customFcMatch = path.match(/^\/api\/custom-forecast\/(\d+)$/);
    if (customFcMatch && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(customFcMatch[1], 10);
        const forecasts = await getCustomForecasts(env);
        const updated = forecasts.filter(c => c.id !== id);
        if (updated.length === forecasts.length) return json({ error: 'not found' }, 404);
        await saveCustomForecasts(env, updated);
        return json({ ok: true });
    }

    if (path === '/api/custom-forecast' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveCustomForecasts(env, []);
        return json({ ok: true });
    }

    // ── Armageddon ───────────────────────────────────────────────
    // GET is public; POST/DELETE require auth.
    if (path === '/api/armageddon' && method === 'GET') {
        let state = await getArmageddonState(env);
        if (state?.expiresAt && Date.now() > state.expiresAt) {
            await saveArmageddonState(env, null);
            state = null;
        }
        return json(state ? { active: true, ...state } : { active: false });
    }

    if (path === '/api/armageddon' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
        const { title = '', text, type = 'emergency', duration = 0 } = body;
        if (!text?.trim()) return json({ error: 'text is required' }, 400);
        const durationMs = Math.max(0, parseInt(duration) || 0) * 60 * 1000;
        const state = {
            title: title.trim(), text: text.trim(), type,
            activatedAt: Date.now(),
            expiresAt: durationMs > 0 ? Date.now() + durationMs : null,
        };
        await saveArmageddonState(env, state);
        return json({ ok: true, ...state });
    }

    if (path === '/api/armageddon' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveArmageddonState(env, null);
        return json({ ok: true });
    }

    // ── SPC Outlook Proxy ────────────────────────────────────────
    // Proxies NOAA SPC categorical outlook GeoJSON to avoid browser CORS restrictions.
    if (path === '/api/spc-outlook' && method === 'GET') {
        const day = url.searchParams.get('day') || '1';
        const validFiles = {
            '1': 'day1otlk_cat.nolyr.geojson',
            '2': 'day2otlk_cat.nolyr.geojson',
            '3': 'day3otlk_cat.nolyr.geojson',
        };
        const file = validFiles[day];
        if (!file) return json({ error: 'Invalid day parameter. Use 1, 2, or 3.' }, 400);

        const spcUrl = `https://www.spc.noaa.gov/products/outlook/${file}`;
        try {
            const upstream = await fetch(spcUrl, {
                headers: { 'User-Agent': 'S.H.E.L.L.Y.-WeatherClient/1.0 (weather display)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!upstream.ok) {
                return json({ error: `SPC returned ${upstream.status}` }, 502);
            }
            const data = await upstream.json();
            return new Response(JSON.stringify(data), {
                status: 200,
                headers: {
                    ...CORS,
                    'Cache-Control': 'public, max-age=900',
                },
            });
        } catch (err) {
            return json({ error: 'Failed to fetch SPC outlook data' }, 502);
        }
    }

    return json({ error: 'Not found' }, 404);
}
