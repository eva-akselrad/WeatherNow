/**
 * Cloudflare Pages Function — handles all /api/* routes
 * Storage: Cloudflare KV (WEATHERNOW_KV binding)
 *
 * Deploy via: npx wrangler pages deploy  (or push to GitHub → Cloudflare Pages)
 * Bindings required:  KV namespace  →  WEATHERNOW_KV
 * Environment vars:   ADMIN_PASSWORD  (set in Pages dashboard)
 */

const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
};

const KV_KEY = 'messages';

// ── Helpers ────────────────────────────────────────────────────────
async function getMessages(env) {
    return (await env.WEATHERNOW_KV.get(KV_KEY, 'json')) ?? [];
}

async function saveMessages(env, msgs) {
    await env.WEATHERNOW_KV.put(KV_KEY, JSON.stringify(msgs));
}

function checkAuth(request, env) {
    const pw = request.headers.get('x-admin-password') ?? '';
    return pw === (env.ADMIN_PASSWORD ?? 'weathernow');
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ── Main handler ───────────────────────────────────────────────────
export async function onRequest({ request, env }) {
    const url = new URL(request.url);
    const path = url.pathname;
    const { method } = request;

    // CORS preflight
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // GET /api/health
    if (path === '/api/health' && method === 'GET') {
        return json({ ok: true });
    }

    // GET /api/messages?since=ID
    if (path === '/api/messages' && method === 'GET') {
        const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
        const msgs = await getMessages(env);
        return json(msgs.filter(m => m.id > since));
    }

    // GET /api/verify
    if (path === '/api/verify' && method === 'GET') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        return json({ ok: true });
    }

    // GET /privacy
    if (path === '/privacy' && method === 'GET') {
        const url = new URL(request.url);
        url.pathname = '/privacy.html';
        return fetch(url);
    }

    // POST /api/announce
    if (path === '/api/announce' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { text = '', title = '', type = 'info', display = 'banner', duration = 0, tts = false } = await request.json();
        if (!text.trim()) return json({ error: 'text is required' }, 400);

        const msgs = await getMessages(env);
        const nextId = msgs.length ? Math.max(...msgs.map(m => m.id)) + 1 : 1;
        const msg = { id: nextId, text: text.trim(), title: title.trim(), type, display, duration, tts: !!tts, created: Date.now() };
        msgs.push(msg);
        await saveMessages(env, msgs);
        return json(msg, 201);
    }

    // DELETE /api/messages/:id
    const oneMatch = path.match(/^\/api\/messages\/(\d+)$/);
    if (oneMatch && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(oneMatch[1]);
        const msgs = await getMessages(env);
        await saveMessages(env, msgs.filter(m => m.id !== id));
        return json({ ok: true });
    }

    // DELETE /api/messages  (clear all)
    if (path === '/api/messages' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveMessages(env, []);
        return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
}
