#!/usr/bin/env node
/*
 * WiFi to MIDI
 * Creates a virtual MIDI output device (visible to Ableton, Logic, etc.)
 * and serves a web app on the local network to control it from any phone,
 * tablet or computer on the same WiFi.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const DEVICE_NAME = process.env.MIDI_NAME || 'WiFi MIDI';
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, 'controls.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- MIDI ----

function createMidiOut() {
  try {
    const midi = require('@julusian/midi');
    const out = new midi.Output();
    out.openVirtualPort(DEVICE_NAME);
    console.log(`🎹 Virtual MIDI device "${DEVICE_NAME}" created.`);
    return {
      live: true,
      send: (bytes) => out.sendMessage(bytes),
      close: () => out.closePort(),
    };
  } catch (err) {
    console.warn(`⚠️  Could not create virtual MIDI device (${err.message}).`);
    console.warn('   Running in log-only mode: MIDI messages are printed instead of sent.');
    return {
      live: false,
      send: (bytes) => console.log('MIDI', bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')),
      close: () => {},
    };
  }
}

const midiOut = createMidiOut();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

function noteOn(channel, note, velocity) {
  midiOut.send([0x90 | (clamp(channel, 1, 16) - 1), clamp(note, 0, 127), clamp(velocity, 1, 127)]);
}
function noteOff(channel, note) {
  midiOut.send([0x80 | (clamp(channel, 1, 16) - 1), clamp(note, 0, 127), 0]);
}
function controlChange(channel, cc, value) {
  midiOut.send([0xb0 | (clamp(channel, 1, 16) - 1), clamp(cc, 0, 127), clamp(value, 0, 127)]);
}

// ------------------------------------------------------------- Config ----

function loadControls() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let controls = loadControls();
// Last known value of each CC control and on/off state of toggles, so every
// connected device shows the same state.
const state = {};

function saveControls() {
  fs.writeFile(CONFIG_FILE, JSON.stringify(controls, null, 2), (err) => {
    if (err) console.error('Could not save controls:', err.message);
  });
}

function sanitizeControl(c) {
  const type = ['note', 'cc'].includes(c.type) ? c.type : 'note';
  return {
    id: String(c.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).slice(0, 40),
    name: String(c.name || '').slice(0, 40),
    type,
    channel: clamp(c.channel ?? 1, 1, 16),
    number: clamp(c.number ?? (type === 'note' ? 60 : 1), 0, 127),
    velocity: clamp(c.velocity ?? 127, 1, 127),
    mode: c.mode === 'toggle' ? 'toggle' : 'momentary', // notes only
    orientation: c.orientation === 'horizontal' ? 'horizontal' : 'vertical', // CC only
    color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#4f8cff',
  };
}

// --------------------------------------------------------- HTTP server ----

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ----------------------------------------------------------- WebSocket ----

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg, except) {
  const json = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === 1) client.send(json);
  }
}

// Notes held by each client, so we can release them if the client drops.
wss.on('connection', (ws) => {
  const held = new Map(); // key "ch:note" -> [ch, note]

  ws.send(JSON.stringify({ type: 'init', controls, state, device: DEVICE_NAME, live: midiOut.live }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // ---- performance messages ----
      case 'noteOn': {
        noteOn(msg.channel, msg.note, msg.velocity);
        held.set(`${msg.channel}:${msg.note}`, [msg.channel, msg.note]);
        if (msg.id) {
          state[msg.id] = 1;
          broadcast({ type: 'state', id: msg.id, value: 1 }, ws);
        }
        break;
      }
      case 'noteOff': {
        noteOff(msg.channel, msg.note);
        held.delete(`${msg.channel}:${msg.note}`);
        if (msg.id) {
          state[msg.id] = 0;
          broadcast({ type: 'state', id: msg.id, value: 0 }, ws);
        }
        break;
      }
      case 'cc': {
        controlChange(msg.channel, msg.cc, msg.value);
        if (msg.id) {
          state[msg.id] = clamp(msg.value, 0, 127);
          broadcast({ type: 'state', id: msg.id, value: state[msg.id] }, ws);
        }
        break;
      }

      // ---- configuration messages ----
      case 'saveControl': {
        const c = sanitizeControl(msg.control || {});
        const i = controls.findIndex((x) => x.id === c.id);
        if (i >= 0) controls[i] = c;
        else controls.push(c);
        saveControls();
        broadcast({ type: 'controls', controls });
        break;
      }
      case 'deleteControl': {
        controls = controls.filter((x) => x.id !== msg.id);
        delete state[msg.id];
        saveControls();
        broadcast({ type: 'controls', controls });
        break;
      }
      case 'reorder': {
        if (Array.isArray(msg.ids)) {
          const byId = new Map(controls.map((c) => [c.id, c]));
          const ordered = msg.ids.map((id) => byId.get(id)).filter(Boolean);
          controls = ordered.concat(controls.filter((c) => !msg.ids.includes(c.id)));
          saveControls();
          broadcast({ type: 'controls', controls });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Avoid stuck notes when a phone locks or loses WiFi mid-press.
    for (const [ch, note] of held.values()) noteOff(ch, note);
  });
});

// --------------------------------------------------------------- Start ----

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n📡 WiFi to MIDI is running. Open on your phone (same WiFi):');
  for (const ip of lanAddresses()) console.log(`   http://${ip}:${PORT}`);
  console.log(`   http://${os.hostname()}${os.hostname().endsWith('.local') ? '' : '.local'}:${PORT}`);
  console.log(`   http://localhost:${PORT}  (this computer)\n`);
});

function shutdown() {
  console.log('\nShutting down…');
  midiOut.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
