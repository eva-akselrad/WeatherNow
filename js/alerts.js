/* ════════════════════════════════════════════════════════════════
   alerts.js – Severe weather alerts + Text-to-Speech
   ════════════════════════════════════════════════════════════════ */

const AlertsManager = (() => {

    let ttsEnabled = true;
    let duckEnabled = true;
    let lastAlertIds = new Set();
    let isSpeaking = false;
    const synth = window.speechSynthesis;

    // ── Preferred voice ────────────────────────────────────────────
    function getBestVoice() {
        const voices = synth.getVoices();
        // Prefer deep/authoritative US English voices
        const preferred = ['Google US English', 'Microsoft David', 'Alex', 'Daniel', 'en-US'];
        for (const pref of preferred) {
            const v = voices.find(v => v.name.includes(pref) || v.lang === pref);
            if (v) return v;
        }
        return voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
    }

    // ── Speak alert ────────────────────────────────────────────────
    function speak(text, onStart, onEnd) {
        if (!synth || !text) { onEnd?.(); return; }
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = getBestVoice();
        utterance.rate = 0.88;
        utterance.pitch = 0.9;
        utterance.volume = 1.0;
        utterance.onstart = () => { isSpeaking = true; onStart?.(); };
        utterance.onend = () => { isSpeaking = false; onEnd?.(); };
        utterance.onerror = () => { isSpeaking = false; onEnd?.(); };
        synth.speak(utterance);
    }

    // ── Build TTS script for alert ─────────────────────────────────
    function buildScript(alert) {
        const title = alert.event || 'Severe Weather Alert';
        const area = alert.areaDesc || 'your area';
        const desc = (alert.description || '').split('\n')[0].slice(0, 200);
        return `Attention! The National Weather Service has issued a ${title} for ${area}. ${desc}`;
    }

    // ── Show alert banner ──────────────────────────────────────────
    function showBanner(alerts) {
        const banner = document.getElementById('alert-banner');
        const ticker = document.getElementById('alert-ticker');
        if (!banner || !ticker) return;

        if (!alerts || !alerts.length) {
            banner.classList.add('hidden');
            return;
        }

        const texts = alerts.map(a => `⚠ ${a.event} – ${a.areaDesc}`).join('   ·   ');
        ticker.textContent = texts;
        banner.classList.remove('hidden');
    }

    // ── Announce new alerts via TTS ────────────────────────────────
    function announceNew(alerts, onDuck, onUnduck) {
        if (!ttsEnabled || !alerts.length) return;

        // Filter to truly new alerts
        const newAlerts = alerts.filter(a => {
            const id = a.id || a.event + (a.onset || '');
            return !lastAlertIds.has(id);
        });

        if (!newAlerts.length) return;

        // Record IDs
        newAlerts.forEach(a => {
            const id = a.id || a.event + (a.onset || '');
            lastAlertIds.add(id);
        });

        // Queue TTS announcements
        const queue = newAlerts.slice(0, 3); // max 3 at once
        let qIdx = 0;

        function announceNext() {
            if (qIdx >= queue.length) {
                if (duckEnabled) onUnduck?.();
                return;
            }
            const script = buildScript(queue[qIdx++]);
            speak(script, null, announceNext);
        }

        if (duckEnabled) onDuck?.();
        // Small delay so duck can take effect
        setTimeout(announceNext, 800);
    }

    // ── Manual TTS for one alert ───────────────────────────────────
    function announceOne(alert, onDuck, onUnduck) {
        if (!synth) { alert('Text-to-speech not supported in this browser.'); return; }
        const script = buildScript(alert);
        if (duckEnabled) onDuck?.();
        speak(script, null, () => { if (duckEnabled) onUnduck?.(); });
    }

    function stopSpeaking() {
        synth?.cancel();
        isSpeaking = false;
    }

    // ── TTS Test functions ─────────────────────────────────────────
    function testAlert(onDuck, onUnduck) {
        const fakeAlert = {
            event: 'Tornado Warning',
            areaDesc: 'test area — this is only a test',
            description: 'This is a test of the WeatherNow text-to-speech alert system. This is only a test. In an actual emergency, you would receive important weather information here.'
        };
        if (duckEnabled) onDuck?.();
        const script = buildScript(fakeAlert);
        speak(script, null, () => { if (duckEnabled) onUnduck?.(); });
    }

    function testConditions(conditionsText, onDuck, onUnduck) {
        if (!synth) return;
        const text = conditionsText || 'Current conditions are not available.';
        if (duckEnabled) onDuck?.();
        speak(text, null, () => { if (duckEnabled) onUnduck?.(); });
    }

    function setTTS(enabled) { ttsEnabled = enabled; }
    function setDuck(enabled) { duckEnabled = enabled; }

    return { announceNew, announceOne, showBanner, stopSpeaking, setTTS, setDuck, testAlert, testConditions, get isSpeaking() { return isSpeaking; } };
})();
