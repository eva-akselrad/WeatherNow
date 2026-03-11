/* ════════════════════════════════════════════════════════════════
   announcements.js – Polls /api/messages and shows banners/popups
   Also polls /api/armageddon for system-wide override state
   ════════════════════════════════════════════════════════════════ */

const Announcements = (() => {

    let lastId = 0;
    let pollTimer = null;
    const POLL_MS = 5000;
    let armageddonActive = false;

    // ── TTS helper ────────────────────────────────────────────────
    function speakMessage(msg) {
        if (!msg.tts) return;
        if (!('speechSynthesis' in window)) return;

        // Cancel any in-progress speech
        window.speechSynthesis.cancel();

        // Duck music while speaking
        if (typeof MusicPlayer !== 'undefined') MusicPlayer.duck();

        const text = (msg.title ? `${msg.title}. ` : '') + msg.text;
        const utt = new SpeechSynthesisUtterance(text);

        // Reuse AlertsManager voice settings if available
        if (typeof AlertsManager !== 'undefined') {
            const voices = window.speechSynthesis.getVoices();
            const saved = localStorage.getItem('ttsVoice');
            if (saved) utt.voice = voices.find(v => v.name === saved) || null;
        }

        // Urgency-based rate/pitch
        utt.rate = msg.type === 'emergency' ? 1.1 : 1.0;
        utt.pitch = msg.type === 'emergency' ? 1.1 : 1.0;

        utt.onend = () => { if (typeof MusicPlayer !== 'undefined') MusicPlayer.unduck(); };
        utt.onerror = () => { if (typeof MusicPlayer !== 'undefined') MusicPlayer.unduck(); };

        window.speechSynthesis.speak(utt);
    }
    // ── Alert chime (Web Audio API, no files needed) ───────────────
    function playAlertSound(type) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Note sequence: [{freq Hz, durSec, delaySec, wave}]
            const patterns = {
                info: [
                    { f: 880, d: 0.12, t: 0, w: 'sine' },
                    { f: 1047, d: 0.18, t: 0.14, w: 'sine' }
                ],
                warning: [
                    { f: 440, d: 0.15, t: 0, w: 'triangle' },
                    { f: 554, d: 0.15, t: 0.18, w: 'triangle' },
                    { f: 440, d: 0.25, t: 0.36, w: 'triangle' }
                ],
                emergency: [
                    { f: 900, d: 0.09, t: 0, w: 'sawtooth' },
                    { f: 1350, d: 0.09, t: 0.11, w: 'sawtooth' },
                    { f: 900, d: 0.09, t: 0.22, w: 'sawtooth' },
                    { f: 1350, d: 0.09, t: 0.33, w: 'sawtooth' },
                    { f: 900, d: 0.09, t: 0.44, w: 'sawtooth' },
                    { f: 1350, d: 0.22, t: 0.55, w: 'sawtooth' }
                ]
            };

            (patterns[type] || patterns.info).forEach(({ f, d, t, w }) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = w;
                osc.frequency.value = f;
                const s = ctx.currentTime + t;
                gain.gain.setValueAtTime(0, s);
                gain.gain.linearRampToValueAtTime(0.25, s + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, s + d);
                osc.start(s);
                osc.stop(s + d + 0.05);
            });
        } catch { /* AudioContext not supported */ }
    }


    async function poll() {
        try {
            const resp = await fetch(`/api/messages?since=${lastId}`, { cache: 'no-store' });
            if (!resp.ok) return;
            const msgs = await resp.json();
            msgs.forEach(msg => {
                lastId = Math.max(lastId, msg.id);
                playAlertSound(msg.type);   // chime on receive
                show(msg);
                speakMessage(msg);
            });
        } catch {
            if (window.location.protocol === 'file:') clearInterval(pollTimer);
        }
    }

    // ── Display a message ─────────────────────────────────────────
    function show(msg) {
        if (msg.display === 'popup') {
            showPopup(msg);
        } else {
            showAdminBanner(msg);
        }
    }

    // ── Scroll helper (seamless marquee loop) ─────────────────────
    function setBannerScroll(el) {
        const orig = el.dataset.orig || el.innerHTML;
        el.dataset.orig = orig;
        el.innerHTML = orig + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + orig;
        const container = el.parentElement;
        if (container && el.scrollWidth / 2 <= container.clientWidth) {
            el.classList.add('no-scroll');
            el.innerHTML = orig;
        } else {
            el.classList.remove('no-scroll');
            // Scale duration with text width so long messages don't whip by too fast (~80 px/s)
            // el.scrollWidth covers the duplicated text, so divide by 2 for one copy's length
            const textPx = el.scrollWidth / 2;
            const duration = Math.max(10, Math.round(textPx / 80));
            el.style.animationDuration = `${duration}s`;
        }
    }

    // ── Admin banner (below the weather alert banner) ─────────────
    function showAdminBanner(msg) {
        const banner = document.getElementById('admin-announce-banner');
        const text = document.getElementById('admin-announce-text');
        const icon = document.getElementById('admin-announce-icon');
        if (!banner || !text) return;

        const icons = { info: 'ℹ', warning: '⚠', emergency: '🚨' };
        banner.dataset.type = msg.type;
        if (icon) icon.textContent = icons[msg.type] || 'ℹ';

        let parsedText = escHtml(msg.text);
        if (typeof marked !== 'undefined') {
            parsedText = marked.parseInline(msg.text, { breaks: true });
        }
        text.innerHTML = (msg.title ? `<strong>${escHtml(msg.title)}:</strong> ` : '') + parsedText;

        banner.classList.remove('hidden');
        requestAnimationFrame(() => setBannerScroll(text));

        if (msg.duration > 0) {
            setTimeout(() => dismissBanner(banner, msg.id), msg.duration * 1000);
        }

        // Dismiss button
        const dismissBtn = banner.querySelector('.admin-dismiss');
        if (dismissBtn) {
            dismissBtn.onclick = () => dismissBanner(banner, msg.id);
        }
    }

    function dismissBanner(banner, id) {
        banner.classList.add('hidden');
        dismissOnServer(id);
    }

    // ── Full-screen popup overlay ─────────────────────────────────
    function showPopup(msg) {
        // Create a popup element
        const overlay = document.createElement('div');
        overlay.className = `announce-popup announce-popup-${msg.type}`;
        let parsedBody = escHtml(msg.text);
        if (typeof marked !== 'undefined') {
            parsedBody = marked.parse(msg.text, { breaks: true });
        }

        overlay.innerHTML = `
            <div class="announce-popup-inner">
                <div class="announce-popup-header">
                    <span class="announce-popup-icon">${iconFor(msg.type)}</span>
                    <span class="announce-popup-title">${escHtml(msg.title || typeLabelFor(msg.type))}</span>
                    <button class="announce-popup-close" title="Dismiss">✕</button>
                </div>
                <div class="announce-popup-body markdown-body">${parsedBody}</div>
                ${msg.duration > 0 ? `<div class="announce-popup-timer"><div class="announce-popup-timer-bar"></div></div>` : ''}
            </div>
        `;

        const closeBtn = overlay.querySelector('.announce-popup-close');
        const doClose = () => {
            overlay.classList.add('popup-exit');
            setTimeout(() => overlay.remove(), 400);
            dismissOnServer(msg.id);
        };
        closeBtn.addEventListener('click', doClose);

        if (msg.type !== 'emergency') {
            overlay.addEventListener('click', e => { if (e.target === overlay) doClose(); });
        }

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('popup-visible'));

        // Autoscroll the body if content overflows (starts after 1.5 s pause)
        const bodyEl = overlay.querySelector('.announce-popup-body');
        let scrollTimer = null;
        if (bodyEl) {
            scrollTimer = setTimeout(() => {
                if (bodyEl.scrollHeight > bodyEl.clientHeight) {
                    const scrollDuration = (bodyEl.scrollHeight - bodyEl.clientHeight) * 30; // ~30 ms/px
                    bodyEl.style.scrollBehavior = 'smooth';
                    const step = () => {
                        if (!overlay.isConnected) return;
                        bodyEl.scrollTop += 1;
                        if (bodyEl.scrollTop < bodyEl.scrollHeight - bodyEl.clientHeight) {
                            requestAnimationFrame(step);
                        }
                    };
                    requestAnimationFrame(step);
                }
            }, 1500);
        }

        if (msg.duration > 0) {
            const bar = overlay.querySelector('.announce-popup-timer-bar');
            if (bar) bar.style.transitionDuration = `${msg.duration}s`;
            setTimeout(() => { if (bar) bar.style.width = '0%'; }, 50);
            setTimeout(() => { clearTimeout(scrollTimer); doClose(); }, msg.duration * 1000);
        }
    }

    function iconFor(type) {
        return { info: 'ℹ️', warning: '⚠️', emergency: '🚨' }[type] || 'ℹ️';
    }
    function typeLabelFor(type) {
        return { info: 'Information', warning: 'Weather Notice', emergency: 'EMERGENCY ALERT' }[type] || 'Notice';
    }
    function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Tell server a message was dismissed ────────────────────────
    async function dismissOnServer(id) {
        try {
            await fetch(`/api/messages/${id}`, { method: 'DELETE', headers: { 'x-admin-password': '' } });
        } catch { /* ok */ }
    }

    // ── Armageddon mode (system-wide override) ────────────────────
    async function pollArmageddon() {
        try {
            const resp = await fetch('/api/armageddon', { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.active && !armageddonActive) {
                showArmageddonOverlay(data);
                armageddonActive = true;
            } else if (!data.active && armageddonActive) {
                removeArmageddonOverlay();
                armageddonActive = false;
            }
        } catch { /* ok */ }
    }

    function showArmageddonOverlay(data) {
        removeArmageddonOverlay(); // ensure no duplicate
        const overlay = document.createElement('div');
        overlay.id = 'armageddon-overlay';
        overlay.className = 'armageddon-overlay';

        let parsedBody = escHtml(data.text);
        if (typeof marked !== 'undefined') {
            parsedBody = marked.parse(data.text, { breaks: true });
        }

        overlay.innerHTML = `
            <div class="armageddon-inner">
                <div class="armageddon-icon">☢️</div>
                ${data.title ? `<div class="armageddon-title">${escHtml(data.title)}</div>` : ''}
                <div class="armageddon-body markdown-body">${parsedBody}</div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('armageddon-visible'));
    }

    function removeArmageddonOverlay() {
        const overlay = document.getElementById('armageddon-overlay');
        if (overlay) overlay.remove();
    }

    // ── Init ──────────────────────────────────────────────────────
    function init() {
        // Don't poll if opened as a local file — admin API won't be there
        if (window.location.protocol === 'file:') return;
        poll();
        pollArmageddon();
        pollTimer = setInterval(poll, POLL_MS);
        setInterval(pollArmageddon, POLL_MS);
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', Announcements.init);
