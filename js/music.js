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
            // Build tracks from server-relative URLs
            const serverTracks = data.tracks
                .filter(t => t.file)
                .map(t => ({
                    name: t.title || t.file.replace(/.*\//, '').replace(/\\.[^.]+$/, ''),
                    url: t.file,   // relative URL, served by web server
                    isServer: true
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
            const div = document.createElement('div');
            div.className = 'track-item' + (i === currentIdx ? ' playing' : '');
            div.textContent = `${i + 1}. ${t.name}`;
            div.addEventListener('click', () => { loadTrack(i); play(); });
            trackList.appendChild(div);
        });
    }

    function updateTrackList() {
        const items = trackList?.querySelectorAll('.track-item');
        items?.forEach((item, i) => {
            item.classList.toggle('playing', i === currentIdx);
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

    function next() {
        if (!tracks.length) return;
        if (isShuffle && tracks.length > 1) {
            let newIdx = currentIdx;
            while (newIdx === currentIdx) newIdx = Math.floor(Math.random() * tracks.length);
            currentIdx = newIdx;
        } else {
            currentIdx = (currentIdx + 1) % tracks.length;
        }
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

    return { init, play, pause, next, prev, togglePlay, duck, unduck, setVolume, get isPlaying() { return isPlaying; } };
})();
