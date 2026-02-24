#!/usr/bin/env node
/**
 * generate-playlist.js
 * Run this with Node.js to scan the music/ folder and generate playlist.json
 * Usage: node generate-playlist.js
 *        (run from the weatherclient/ directory)
 */

const fs = require('fs');
const path = require('path');

const MUSIC_DIR = path.join(__dirname, 'music');
const PLAYLIST_OUT = path.join(MUSIC_DIR, 'playlist.json');
const AUDIO_EXTS = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac', '.opus', '.weba'];

function stripExt(name) {
    return path.basename(name, path.extname(name)).replace(/[-_]/g, ' ');
}

const files = fs.readdirSync(MUSIC_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return AUDIO_EXTS.includes(ext);
});

const tracks = files.map(f => ({
    title: stripExt(f),
    file: 'music/' + f
}));

const playlist = {
    name: 'WeatherNow BGM',
    description: `Auto-generated on ${new Date().toISOString()} — ${tracks.length} track(s) found.`,
    tracks
};

fs.writeFileSync(PLAYLIST_OUT, JSON.stringify(playlist, null, 2));
console.log(`✅ playlist.json updated with ${tracks.length} track(s):`);
tracks.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}`));
