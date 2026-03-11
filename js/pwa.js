/* ════════════════════════════════════════════════════════════════
   pwa.js – S.H.E.L.L.Y. PWA Install + Push Subscription
   • Registers service worker
   • Manages install prompt for all browsers
   • Handles push subscription lifecycle
   ════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    let swRegistration = null;
    let deferredInstallPrompt = null;
    let guideShown = false;
    const PUSH_KEY_URL = '/api/push/vapid-key';
    const PUSH_SUB_URL = '/api/push/subscribe';

    // ── Cookie helpers (install prompt throttle) ─────────────────
    const PROMPT_COOKIE = 'pwa-prompt-dismissed';

    function setPromptCookie() {
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
        document.cookie = `${PROMPT_COOKIE}=1; expires=${expires}; path=/; SameSite=Lax`;
    }

    function hasPromptCookie() {
        return document.cookie.split(';').some(c => c.trim().startsWith(`${PROMPT_COOKIE}=`));
    }

    // ── 1. Register Service Worker ──────────────────────────────
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => {
                    swRegistration = reg;
                    console.log('[PWA] Service Worker registered:', reg.scope);
                    initPush(reg);
                })
                .catch(err => console.warn('[PWA] SW registration failed:', err));
        });
    }

    // ── 2. Install Prompt ────────────────────────────────────────

    // Already running as standalone? Hide all install UI.
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;

    if (!isStandalone) {
        // Chromium: capture the prompt (skip if already dismissed today)
        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredInstallPrompt = e;
            if (!hasPromptCookie()) showInstallBanner();
        });

        // If no prompt fires after 3 s, show a manual guide (skip if dismissed today)
        window.addEventListener('load', () => {
            setTimeout(() => {
                if (!deferredInstallPrompt && !guideShown && !hasPromptCookie()) {
                    showBrowserGuide();
                }
            }, 3000);
        });
    }

    function showInstallBanner() {
        if (document.body.classList.contains('kiosk-mode')) return;
        const banner = getOrCreateBanner();
        banner.classList.remove('pwa-hidden');
    }

    function hideBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.add('pwa-hidden');
    }

    function getOrCreateBanner() {
        let banner = document.getElementById('pwa-install-banner');
        if (banner) return banner;

        banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner pwa-hidden';
        banner.innerHTML = `
            <span class="pwa-banner-icon">📲</span>
            <div class="pwa-banner-text">
                <strong>Install S.H.E.L.L.Y.</strong>
                <small>Add to home screen for the best experience</small>
            </div>
            <button id="pwa-install-btn" class="pwa-banner-btn">Install</button>
            <button id="pwa-dismiss-btn" class="pwa-banner-dismiss">✕</button>
        `;
        document.body.appendChild(banner);

        document.getElementById('pwa-install-btn').addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            console.log('[PWA] Install outcome:', outcome);
            deferredInstallPrompt = null;
            setPromptCookie();
            hideBanner();
        });

        document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
            setPromptCookie();
            hideBanner();
        });

        return banner;
    }

    // ── 3. Browser-specific manual guide ────────────────────────
    const UA = navigator.userAgent;
    const isIOS = /iP(hone|ad|od)/.test(UA);
    const isMacSafari = /Macintosh.*Safari/.test(UA) && !/Chrome/.test(UA);
    const isFirefox = /Firefox/.test(UA);
    const isSamsung = /SamsungBrowser/.test(UA);
    const isBrave = navigator.brave != null;

    function showBrowserGuide() {
        if (guideShown || isStandalone) return;
        if (document.body.classList.contains('kiosk-mode')) return;
        guideShown = true;

        let instructions = '';
        if (isIOS) {
            instructions = `<p>Tap the <strong>Share</strong> button <span style="font-size:1.3em">⎋</span> in Safari's toolbar, then choose <strong>"Add to Home Screen"</strong>.</p>`;
        } else if (isMacSafari) {
            instructions = `<p>In the menu bar, click <strong>File → Add to Dock…</strong> to install S.H.E.L.L.Y.</p>`;
        } else if (isFirefox) {
            instructions = `<p>Click the <strong>address bar menu (⋯)</strong> and select <strong>"Install"</strong> or <strong>"Add to Home Screen"</strong>.</p>`;
        } else if (isSamsung) {
            instructions = `<p>Tap the <strong>⋮ menu</strong> in Samsung Internet and choose <strong>"Add page to" → "Home screen"</strong>.</p>`;
        } else if (isBrave) {
            instructions = `<p>If Brave Shields are blocking the prompt, tap <strong>⋮ → Install app</strong> from the browser menu.</p>`;
        } else {
            return; // Desktop chrome/edge etc will auto-prompt; no guide needed
        }

        const modal = document.createElement('div');
        modal.id = 'pwa-guide-modal';
        modal.className = 'pwa-guide-modal';
        modal.innerHTML = `
            <div class="pwa-guide-inner">
                <div class="pwa-guide-header">
                    <span class="pwa-guide-icon">📲</span>
                    <span class="pwa-guide-title">Install S.H.E.L.L.Y.</span>
                    <button id="pwa-guide-close" class="pwa-guide-close">✕</button>
                </div>
                <div class="pwa-guide-body">${instructions}</div>
                <button id="pwa-guide-ok" class="pwa-guide-ok">Got it</button>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => { setPromptCookie(); modal.remove(); };
        document.getElementById('pwa-guide-close').addEventListener('click', close);
        document.getElementById('pwa-guide-ok').addEventListener('click', close);

        // Auto-dismiss after 12 s
        setTimeout(close, 12000);
    }

    // ── 4. Push Notifications ─────────────────────────────────────

    async function initPush(reg) {
        // Expose to push toggle in settings
        window.PWA = window.PWA || {};
        window.PWA.subscribeToNotifications = () => requestPushPermission(reg);
        window.PWA.unsubscribeFromNotifications = () => unsubscribePush(reg);
        window.PWA.getPushState = () => getPushState(reg);

        // Restore previous state badge
        const state = await getPushState(reg);
        updatePushUI(state);
    }

    async function getPushState(reg) {
        if (!('PushManager' in window)) return 'unsupported';
        const perm = Notification.permission;
        if (perm === 'denied') return 'denied';
        if (perm === 'default') return 'prompt';
        // Granted — check if actually subscribed
        const sub = await reg.pushManager.getSubscription();
        return sub ? 'subscribed' : 'granted-not-subscribed';
    }

    async function requestPushPermission(reg) {
        if (!('PushManager' in window)) {
            alert('Push notifications are not supported in this browser.');
            return;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            updatePushUI('denied');
            return;
        }
        await subscribePush(reg);
    }

    async function subscribePush(reg) {
        try {
            // Get server's VAPID public key
            const keyRes = await fetch(PUSH_KEY_URL);
            const { publicKey } = await keyRes.json();

            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });

            // Send subscription to server
            await fetch(PUSH_SUB_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sub)
            });

            console.log('[PWA] Push subscribed:', sub.endpoint);
            updatePushUI('subscribed');
        } catch (err) {
            console.error('[PWA] Push subscription failed:', err);
            updatePushUI('error');
        }
    }

    async function unsubscribePush(reg) {
        try {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await fetch(PUSH_SUB_URL, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint })
                });
                await sub.unsubscribe();
            }
            updatePushUI('prompt');
        } catch (err) {
            console.error('[PWA] Unsubscribe failed:', err);
        }
    }

    function updatePushUI(state) {
        const btn = document.getElementById('push-subscribe-btn');
        const status = document.getElementById('push-status-text');
        if (!btn || !status) return;

        const states = {
            unsupported: { label: '🔕 Not Supported', text: 'Push not available in this browser', disabled: true },
            denied: { label: '🚫 Blocked', text: 'Notifications blocked — enable in browser settings', disabled: true },
            prompt: { label: '🔔 Enable Notifications', text: 'Tap to subscribe to push alerts', disabled: false },
            'granted-not-subscribed': { label: '🔔 Enable Notifications', text: 'Tap to subscribe to push alerts', disabled: false },
            subscribed: { label: '🔕 Disable Notifications', text: '✓ Subscribed to push alerts', disabled: false },
            error: { label: '⚠ Retry', text: 'Subscription failed — try again', disabled: false },
        };
        const s = states[state] || states.prompt;
        btn.textContent = s.label;
        btn.disabled = s.disabled;
        status.textContent = s.text;

        // Store state for the button's click handler
        btn.dataset.pushState = state;
    }

    // ── 5. Wire push button in settings (called from settings.js init) ──
    window.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('push-subscribe-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const state = btn.dataset.pushState;
            if (!swRegistration) return;
            if (state === 'subscribed') {
                await unsubscribePush(swRegistration);
            } else {
                await requestPushPermission(swRegistration);
            }
        });
    });

    // ── Utility ──────────────────────────────────────────────────
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    }
})();
