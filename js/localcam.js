/* ════════════════════════════════════════════════════════════════
   localcam.js – Live Local Cams slide
   Displays a nearby webcam feed (refreshing still image) with
   camera location title overlaid at the bottom.
   Webcam data is supplied by weather.js via setCam(); image
   refresh is managed internally while the slide is visible.
   ════════════════════════════════════════════════════════════════ */

const LocalCam = (() => {
    'use strict';

    const REFRESH_MS = 60000; // refresh image every 60 seconds

    let refreshTimer = null;
    let currentCam = null;

    function el(id) { return document.getElementById(id); }

    // Build a cache-busted image URL from the webcam object
    function buildImageUrl(cam) {
        const base = cam?.images?.current?.preview
            || cam?.images?.current?.thumbnail
            || cam?.images?.current?.toenail
            || '';
        return base ? `${base}?t=${Date.now()}` : '';
    }

    // Build a human-readable location title
    function buildTitle(cam) {
        const parts = [];
        if (cam?.title) parts.push(cam.title);
        const loc = cam?.location || {};
        const city = loc.city;
        const region = loc.region || loc.country;
        if (city && city !== cam?.title) parts.push(city);
        if (region && region !== cam?.title && region !== city) parts.push(region);
        return parts.join(' — ');
    }

    function refreshImage() {
        if (!currentCam) return;
        const imgUrl = buildImageUrl(currentCam);
        if (!imgUrl) return;
        const img = el('cam-image');
        if (!img) return;
        // Preload into a temp image to avoid blank flicker on load
        const tmp = new Image();
        tmp.onload = () => { img.src = imgUrl; };
        tmp.onerror = () => { /* keep current frame on error */ };
        tmp.src = imgUrl;
    }

    function stopRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    // ── Public API ────────────────────────────────────────────────

    /** Called from displays.js renderAll() with the nearest webcam object
     *  (or null/undefined when none found). */
    function setCam(cam) {
        currentCam = cam || null;
    }

    /** Returns true when a webcam was found for the current location. */
    function hasCam() {
        return !!currentCam;
    }

    /** Called from app.js when the slide becomes visible.
     *  Populates the slide and starts the periodic image refresh. */
    function onSlideVisible() {
        stopRefresh();
        if (!currentCam) return;

        const img = el('cam-image');
        const titleEl = el('cam-title');
        const overlay = el('cam-overlay');

        const url = buildImageUrl(currentCam);
        if (img && url) img.src = url;
        if (titleEl) titleEl.textContent = buildTitle(currentCam);
        if (overlay) overlay.classList.remove('hidden');

        refreshTimer = setInterval(refreshImage, REFRESH_MS);
    }

    return { setCam, hasCam, onSlideVisible, stopRefresh };
})();
