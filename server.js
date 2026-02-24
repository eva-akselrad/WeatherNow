/* ════════════════════════════════════════════════════════════════
   server.js – WeatherNow Express backend
   Serves static files + admin announcement API
   ════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// ── Static files ───────────────────────────────────────────────
app.use(express.static(__dirname, {
    setHeaders(res, filePath) {
        // Proper MIME for audio so browser can stream music
        if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
        if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
        if (filePath.endsWith('.flac')) res.setHeader('Content-Type', 'audio/flac');
        if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
        // Accept-Ranges so audio seeking works
        res.setHeader('Accept-Ranges', 'bytes');
    }
}));

// ── In-memory message store ────────────────────────────────────
let messages = [];
let nextId = 1;

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
// Returns messages with id > since (long-poll friendly)
app.get('/api/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    res.json(messages.filter(m => m.id > since));
});

// ── POST /api/announce  (admin only) ──────────────────────────
// Body: { password, text, type, display, duration, title }
//   type:    'info' | 'warning' | 'emergency'
//   display: 'banner' | 'popup'
//   duration: seconds (0 = manual dismiss)
app.post('/api/announce', (req, res) => {
    if (!checkAuth(req, res)) return;
    const { text, type = 'info', display = 'banner', duration = 0, title = '', tts = false } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    const msg = {
        id: nextId++,
        text: text.trim(),
        title: title.trim(),
        type,
        display,
        duration,
        tts: !!tts,
        created: Date.now()
    };
    messages.push(msg);
    console.log(`[Admin] New ${type} ${display}: ${text.slice(0, 80)}`);
    res.json(msg);
});

// ── DELETE /api/messages/:id  (dismiss one) ───────────────────
app.delete('/api/messages/:id', (req, res) => {
    if (!checkAuth(req, res)) return;
    const id = parseInt(req.params.id);
    messages = messages.filter(m => m.id !== id);
    res.json({ ok: true });
});

// ── DELETE /api/messages  (clear all) ────────────────────────
app.delete('/api/messages', (req, res) => {
    if (!checkAuth(req, res)) return;
    messages = [];
    res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WeatherNow running on http://0.0.0.0:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
