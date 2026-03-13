/* ════════════════════════════════════════════════════════════════
   music.js – Music player for local folder files
   Uses File System Access API + HTMLAudioElement
   ════════════════════════════════════════════════════════════════ */

const MusicPlayer = (() => {

    let tracks = [];
    let currentIdx = 0;
    let isPlaying = false;
    let isShuffle = true;
    let volume = 0.4;
    let isDucked = false;
    let normalVolume = 0.4;
    let weatherCondition = null;    // current weather category (string or null)
    let weatherMusicEnabled = true; // prefer weather-matched tracks when picking next

    // ── Weather category helpers ──────────────────────────────────
    // Map Open-Meteo WMO weather codes to music mood categories.
    const WEATHER_EMOJIS = {
        clear:   '☀️',
        cloudy:  '⛅',
        rainy:   '🌧',
        stormy:  '⛈',
        snowy:   '❄️',
        foggy:   '🌫',
        windy:   '💨',
    };

    function wmoToCategory(rawCode, windRaw) {
        if (rawCode === 0 || rawCode === 1)                          return 'clear';
        if (rawCode === 2 || rawCode === 3)                          return 'cloudy';
        if (rawCode === 45 || rawCode === 48)                        return 'foggy';
        if (rawCode >= 71 && rawCode <= 77)                          return 'snowy';
        if (rawCode === 95 || rawCode === 96 || rawCode === 99)      return 'stormy';
        if (rawCode >= 51 && rawCode <= 67)                          return 'rainy';
        if (rawCode >= 80 && rawCode <= 82)                          return 'rainy';
        if (rawCode === 85 || rawCode === 86)                        return 'snowy';
        if (windRaw != null && windRaw >= 25)                        return 'windy';
        return null;
    }

    // Auto-tag a track from its name when no explicit tag is set.
    function autoTag(name) {
        const s = name.toLowerCase();
        if (/thunder|storm|lightning|hurric|squall/.test(s))        return 'stormy';
        if (/rain|drizzle|shower|downpour|puddle|wet/.test(s))      return 'rainy';
        if (/snow|winter|frost|blizzard|ice|icy|frozen|sleet/.test(s)) return 'snowy';
        if (/fog|mist|haze|misty/.test(s))                          return 'foggy';
        if (/wind|breeze|breezy|gust|blustery|gale/.test(s))        return 'windy';
        if (/cloud|overcast|grey|gray|cumul|nimb|stratus/.test(s))  return 'cloudy';
        if (/sun|sunny|bright|clear|crisp|dawn|dusk|daylight|solar/.test(s)) return 'clear';
        return null;
    }

    // Return the weather category for a track (from playlist tag or auto-tag).
    function trackWeather(track) {
        return track.weather || autoTag(track.name || '');
    }

    const audio = document.getElementById('bg-audio');
    const playBtn = document.getElementById('mc-play');
    const prevBtn = document.getElementById('mc-prev');
    const nextBtn = document.getElementById('mc-next');
    const muteBtn = document.getElementById('mc-mute');
    const trackName = document.getElementById('mc-track-name');
    const progressFill = document.getElementById('mc-progress-fill');
    const trackList = document.getElementById('music-track-list');
    const folderBtn = document.getElementById('music-folder-btn');
    const folderInput = document.getElementById('music-folder-input');
    const volumeSlider = document.getElementById('volume-slider');
    const shuffleToggle = document.getElementById('shuffle-toggle');
    const autoplayToggle = document.getElementById('autoplay-toggle');

    // ── Load from server playlist.json (hosted mode) ──────────────
    async function loadServerPlaylist() {
        try {
            // Try path relative to the page (works when hosted on a server)
            const resp = await fetch('music/playlist.json', { cache: 'no-cache' });
            if (!resp.ok) return [];
            const data = await resp.json();
            if (!data.tracks?.length) return [];
            // Build tracks from server-relative URLs, preserving the weather tag
            const serverTracks = data.tracks
                .filter(t => t.file)
                .map(t => ({
                    name: t.title || t.file.replace(/.*\//, '').replace(/\\.[^.]+$/, ''),
                    url: t.file,   // relative URL, served by web server
                    isServer: true,
                    weather: t.weather || null
                }));
            return serverTracks;
        } catch { return []; }
    }

    // ── Load files from folder picker ─────────────────────────────
    function init() {
        // Auto-load server playlist when hosted
        loadServerPlaylist().then(serverTracks => {
            if (serverTracks.length) {
                tracks = serverTracks;
                currentIdx = 0;
                buildTrackList();
                if (trackName) trackName.textContent = tracks[0].name;
                console.log(`🎵 Loaded ${tracks.length} track(s) from server playlist`);
                if (autoplayToggle?.checked) {
                    // Attempt autoplay — may be blocked by browser policy until user interaction
                    loadTrack(0);
                    play();
                }
            } else {
                console.log('🎵 No server playlist found. Use "📁 Load Music Folder" to add music.');
                if (trackName) trackName.textContent = 'No music loaded — use folder picker';
            }
        });

        folderBtn.addEventListener('click', () => folderInput.click());
        folderInput.addEventListener('change', e => {
            const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
            if (!files.length) return;
            // Merge server tracks + local file-picker tracks
            const localTracks = files.map(f => ({ file: f, name: stripExt(f.name), url: URL.createObjectURL(f), isLocal: true }));
            // Keep server tracks if any, append local ones
            const serverExisting = tracks.filter(t => t.isServer);
            tracks = [...serverExisting, ...localTracks];
            currentIdx = 0;
            buildTrackList();
            if (autoplayToggle?.checked) { loadTrack(0); play(); }
        });

        prevBtn?.addEventListener('click', prev);
        nextBtn?.addEventListener('click', next);
        playBtn?.addEventListener('click', togglePlay);
        muteBtn?.addEventListener('click', toggleMute);

        volumeSlider?.addEventListener('input', e => {
            volume = e.target.value / 100;
            normalVolume = volume;
            if (!isDucked) audio.volume = volume;
        });

        shuffleToggle?.addEventListener('change', e => { isShuffle = e.target.checked; });

        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('ended', next);
        audio.addEventListener('error', next);

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'MediaPlayPause' || (e.key === ' ' && !e.shiftKey)) {
                e.preventDefault(); togglePlay();
            }
            if (e.key === 'MediaTrackNext' || e.key === 'ArrowRight' && e.ctrlKey) next();
            if (e.key === 'MediaTrackPrevious' || e.key === 'ArrowLeft' && e.ctrlKey) prev();
        });
    }

    function stripExt(name) {
        return name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    }

    function buildTrackList() {
        if (!trackList) return;
        trackList.innerHTML = '';
        tracks.forEach((t, i) => {
            const wCat = trackWeather(t);
            const emoji = wCat ? (WEATHER_EMOJIS[wCat] || '') : '';
            const isMatch = weatherMusicEnabled && wCat && wCat === weatherCondition;
            const div = document.createElement('div');
            div.className = 'track-item' + (i === currentIdx ? ' playing' : '') + (isMatch ? ' weather-match' : '');
            div.textContent = `${emoji ? emoji + ' ' : ''}${i + 1}. ${t.name}`;
            div.title = wCat ? `Weather: ${wCat}` : '';
            div.addEventListener('click', () => { loadTrack(i); play(); });
            trackList.appendChild(div);
        });
    }

    function updateTrackList() {
        const items = trackList?.querySelectorAll('.track-item');
        items?.forEach((item, i) => {
            const wCat = trackWeather(tracks[i]);
            const isMatch = weatherMusicEnabled && wCat && wCat === weatherCondition;
            item.classList.toggle('playing', i === currentIdx);
            item.classList.toggle('weather-match', !!isMatch);
        });
    }

    function loadTrack(idx) {
        if (!tracks.length) return;
        currentIdx = idx;
        audio.src = tracks[idx].url;
        audio.volume = isDucked ? volume * 0.2 : volume;
        if (trackName) trackName.textContent = tracks[idx].name;
        updateTrackList();
    }

    function play() {
        if (!tracks.length) return;
        if (!audio.src) loadTrack(currentIdx);
        const promise = audio.play();
        if (promise !== undefined) {
            promise.then(() => {
                isPlaying = true;
                playBtn?.classList.add('playing');
                if (playBtn) playBtn.textContent = '⏸';
                if (trackName) trackName.textContent = tracks[currentIdx].name;
            }).catch(err => {
                // Autoplay blocked by browser — reset state, user must click play manually
                isPlaying = false;
                playBtn?.classList.remove('playing');
                if (playBtn) playBtn.textContent = '▶';
                if (trackName) trackName.textContent = `🔇 Click ▶ to play: ${tracks[currentIdx].name}`;
                console.warn('🎵 Autoplay blocked. User must interact first.', err.name);
            });
        }
    }

    function pause() {
        audio.pause();
        isPlaying = false;
        playBtn?.classList.remove('playing');
        if (playBtn) playBtn.textContent = '▶';
    }

    function togglePlay() {
        if (isPlaying) pause(); else play();
    }

    function prev() {
        if (!tracks.length) return;
        currentIdx = (currentIdx - 1 + tracks.length) % tracks.length;
        loadTrack(currentIdx);
        play();
    }

    // Pick the next index, preferring a weather-matched track when possible.
    function pickNextIndex() {
        if (!tracks.length) return 0;
        if (isShuffle && tracks.length > 1) {
            // If weather-music is on and a condition is set, prefer matching tracks
            if (weatherMusicEnabled && weatherCondition) {
                const matchingIndices = tracks
                    .map((t, i) => ({ i, cat: trackWeather(t) }))
                    .filter(({ i, cat }) => i !== currentIdx && cat === weatherCondition)
                    .map(({ i }) => i);
                if (matchingIndices.length > 0) {
                    return matchingIndices[Math.floor(Math.random() * matchingIndices.length)];
                }
            }
            // Fall back to normal shuffle
            if (tracks.length === 1) return 0;
            let newIdx = currentIdx;
            while (newIdx === currentIdx) newIdx = Math.floor(Math.random() * tracks.length);
            return newIdx;
        }
        return (currentIdx + 1) % tracks.length;
    }

    function next() {
        if (!tracks.length) return;
        currentIdx = pickNextIndex();
        loadTrack(currentIdx);
        play();
    }

    function toggleMute() {
        audio.muted = !audio.muted;
        if (muteBtn) muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    }

    function updateProgress() {
        if (!audio.duration || !progressFill) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = `${pct}%`;
    }

    // ── Duck volume for alerts ─────────────────────────────────────
    function duck() {
        if (isDucked) return;
        isDucked = true;
        const target = audio.volume * 0.15;
        smoothVolume(audio.volume, target, 600);
    }

    function unduck() {
        if (!isDucked) return;
        isDucked = false;
        smoothVolume(audio.volume, normalVolume, 1000);
    }

    function smoothVolume(from, to, ms) {
        const steps = 20;
        const stepMs = ms / steps;
        const delta = (to - from) / steps;
        let step = 0;
        const timer = setInterval(() => {
            step++;
            audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
            if (step >= steps) clearInterval(timer);
        }, stepMs);
    }

    function setVolume(val) {
        volume = val;
        normalVolume = val;
        if (!isDucked) audio.volume = val;
        if (volumeSlider) volumeSlider.value = val * 100;
    }

    // ── Weather-aware music selection ─────────────────────────────
    // Called from app.js after every weather data fetch.
    function setWeatherCondition(conditions) {
        const prev = weatherCondition;
        weatherCondition = conditions ? wmoToCategory(conditions.rawCode, conditions.windRaw) : null;
        if (weatherCondition !== prev) {
            // Refresh track list highlights to reflect new condition
            buildTrackList();
            if (weatherCondition) {
                const emoji = WEATHER_EMOJIS[weatherCondition] || '';
                console.log(`🎵 Weather music: ${emoji} ${weatherCondition}`);
            }
        }
    }

    function setWeatherMusicEnabled(val) {
        weatherMusicEnabled = val;
        buildTrackList();
    }

    return {
        init, play, pause, next, prev, togglePlay, duck, unduck, setVolume,
        setWeatherCondition, setWeatherMusicEnabled,
        get isPlaying() { return isPlaying; }
    };
})();
