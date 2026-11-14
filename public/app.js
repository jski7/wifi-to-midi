'use strict';

const COLORS = ['#4f8cff', '#9b6bff', '#ff5ab4', '#ff5a5f', '#ff9f43', '#ffd23f', '#3ad07a', '#2ec4c4'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Middle C (60) = C3, as in Ableton Live and Logic Pro.
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2}`;

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');

let controls = [];
const state = {}; // id -> value (0/1 for notes, 0..127 for CC)
let editing = false;
let ws;

// ------------------------------------------------------------ socket --

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.onopen = () => {
    $('#status').classList.add('on');
    $('#status').title = 'Connected';
  };

  ws.onclose = () => {
    $('#status').classList.remove('on');
    $('#status').title = 'Disconnected — reconnecting…';
    setTimeout(connect, 1000);
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init') {
      $('#device').textContent = msg.device;
      document.title = msg.device;
      $('#mode-badge').hidden = msg.live;
      Object.assign(state, msg.state);
      controls = msg.controls;
      render();
    } else if (msg.type === 'controls') {
      controls = msg.controls;
      render();
    } else if (msg.type === 'state') {
      state[msg.id] = msg.value;
      updateView(msg.id);
    }
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ------------------------------------------------------------ render --

function describe(c) {
  return c.type === 'note'
    ? `Ch ${c.channel} · ${noteName(c.number)} (${c.number})`
    : `Ch ${c.channel} · CC ${c.number}`;
}

function render() {
  grid.innerHTML = '';
  $('#empty').hidden = controls.length > 0;

  controls.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = `ctl ${c.type}`;
    el.dataset.id = c.id;
    el.style.setProperty('--c', c.color);

    if (c.type === 'cc') {
      el.innerHTML = '<div class="fill"></div><div class="value"></div>';
    } else {
      el.innerHTML = `<span class="mode-icon">${c.mode === 'toggle' ? 'toggle' : ''}</span>`;
    }

    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = '<div class="name"></div><div class="meta"></div>';
    label.querySelector('.name').textContent = c.name || (c.type === 'note' ? noteName(c.number) : `CC ${c.number}`);
    label.querySelector('.meta').textContent = describe(c);
    el.appendChild(label);

    // reorder buttons (edit mode)
    for (const [cls, dir, txt] of [['left', -1, '◀'], ['right', 1, '▶']]) {
      const b = document.createElement('button');
      b.className = `move ${cls}`;
      b.textContent = txt;
      b.disabled = (dir < 0 && i === 0) || (dir > 0 && i === controls.length - 1);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        move(c.id, dir);
      });
      el.appendChild(b);
    }

    if (c.type === 'note') bindNote(el, c);
    else bindCC(el, c);

    grid.appendChild(el);
    updateView(c.id);
  });
}

function updateView(id) {
  const el = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const c = controls.find((x) => x.id === id);
  if (!el || !c) return;
  if (c.type === 'note') {
    el.classList.toggle('on', !!state[id]);
  } else {
    const v = state[id] ?? 0;
    el.querySelector('.fill').style.height = `${(v / 127) * 100}%`;
    el.querySelector('.value').textContent = v;
  }
}

function move(id, dir) {
  const i = controls.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= controls.length) return;
  [controls[i], controls[j]] = [controls[j], controls[i]];
  render();
  send({ type: 'reorder', ids: controls.map((c) => c.id) });
}

// ---------------------------------------------------------- controls --

function bindNote(el, c) {
  const on = () => {
    state[c.id] = 1;
    updateView(c.id);
    send({ type: 'noteOn', id: c.id, channel: c.channel, note: c.number, velocity: c.velocity });
  };
  const off = () => {
    state[c.id] = 0;
    updateView(c.id);
    send({ type: 'noteOff', id: c.id, channel: c.channel, note: c.number });
  };

  let pressed = false;

  el.addEventListener('pointerdown', (e) => {
    if (editing) return openEditor(c);
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    if (c.mode === 'toggle') {
      state[c.id] ? off() : on();
    } else {
      pressed = true;
      on();
    }
  });

  const release = () => {
    if (pressed) {
      pressed = false;
      off();
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
}

function bindCC(el, c) {
  let active = false;

  const setFromY = (clientY) => {
    const r = el.getBoundingClientRect();
    const v = Math.round((1 - (clientY - r.top) / r.height) * 127);
    const value = Math.max(0, Math.min(127, v));
    if (value === state[c.id]) return;
    state[c.id] = value;
    updateView(c.id);
    send({ type: 'cc', id: c.id, channel: c.channel, cc: c.number, value });
  };

  el.addEventListener('pointerdown', (e) => {
    if (editing) return openEditor(c);
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    active = true;
    setFromY(e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (active) setFromY(e.clientY);
  });
  const end = () => (active = false);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

// ------------------------------------------------------------ editor --

const dialog = $('#editor');
const form = $('#editor-form');
let editingId = null;
let selectedColor = COLORS[0];

for (let ch = 1; ch <= 16; ch++) form.channel.add(new Option(ch, ch));

const swatches = $('#swatches');
for (const col of COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.background = col;
  b.dataset.color = col;
  b.addEventListener('click', () => selectColor(col));
  swatches.appendChild(b);
}

function selectColor(col) {
  selectedColor = col;
  for (const b of swatches.children) b.classList.toggle('sel', b.dataset.color === col);
}

function syncForm() {
  const isCC = form.type.value === 'cc';
  form.classList.toggle('is-cc', isCC);
  $('#number-label').textContent = isCC ? 'CC number' : 'Note';
  const n = Math.max(0, Math.min(127, Number(form.number.value) || 0));
  $('#number-hint').textContent = isCC ? ccHint(n) : noteName(n);
  $('#vel-out').textContent = form.velocity.value;
}

const CC_NAMES = {
  1: 'Mod wheel', 2: 'Breath', 7: 'Volume', 10: 'Pan', 11: 'Expression',
  64: 'Sustain', 71: 'Resonance', 74: 'Cutoff', 91: 'Reverb', 93: 'Chorus',
};
const ccHint = (n) => CC_NAMES[n] || '';

form.addEventListener('input', syncForm);
form.addEventListener('change', syncForm);

function openEditor(c) {
  editingId = c ? c.id : null;
  $('#editor-title').textContent = c ? 'Edit control' : 'Add control';
  $('#delete-btn').hidden = !c;

  const lastCh = controls.length ? controls[controls.length - 1].channel : 1;
  const d = c || { name: '', type: 'note', channel: lastCh, number: 60, velocity: 127, mode: 'momentary', color: COLORS[controls.length % COLORS.length] };

  form.name.value = d.name;
  form.type.value = d.type;
  form.channel.value = d.channel;
  form.number.value = d.number;
  form.velocity.value = d.velocity;
  form.mode.value = d.mode;
  selectColor(d.color);
  syncForm();
  dialog.showModal();
}

// When switching type in a fresh control, pick a sensible default number.
for (const r of form.querySelectorAll('input[name=type]')) {
  r.addEventListener('change', () => {
    if (!editingId) form.number.value = r.value === 'cc' ? 1 : 60;
    syncForm();
  });
}

form.addEventListener('submit', () => {
  send({
    type: 'saveControl',
    control: {
      id: editingId || undefined,
      name: form.name.value.trim(),
      type: form.type.value,
      channel: Number(form.channel.value),
      number: Number(form.number.value),
      velocity: Number(form.velocity.value),
      mode: form.mode.value,
      color: selectedColor,
    },
  });
});

$('#cancel-btn').addEventListener('click', () => dialog.close());
$('#delete-btn').addEventListener('click', () => {
  const c = controls.find((x) => x.id === editingId);
  if (c && confirm(`Delete "${c.name || describe(c)}"?`)) {
    send({ type: 'deleteControl', id: editingId });
    dialog.close();
  }
});

// ------------------------------------------------------------ header --

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('#edit-btn').textContent = on ? 'Done' : 'Edit';
  $('#edit-btn').classList.toggle('active', on);
  $('#add-btn').hidden = !on;
}

$('#edit-btn').addEventListener('click', () => setEditing(!editing));
$('#add-btn').addEventListener('click', () => openEditor(null));
$('#empty-add').addEventListener('click', () => {
  setEditing(true);
  openEditor(null);
});

connect();
