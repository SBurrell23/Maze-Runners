import * as THREE from 'three';
import { generateMaze } from './maze.js';
import { World, CELL } from './world.js';
import { Sky } from './sky.js';
import { LocalPlayer, RemotePlayer } from './player.js';
import { Eyeball, EYE_HEIGHT } from './eyeball.js';
import { Net } from './net.js';
import { AudioSys } from './audio.js';

const COLORS = ['#3a9f62', '#3b7dd8', '#d8443b', '#e0a52a', '#9b4fd8', '#e56aa8'];
const MAX_PLAYERS = 6;
const SEND_RATE = 20; // position updates per second
const DEFAULT_SETTINGS = { width: 20, height: 20, hedge: 35, braid: 10, signs: 8, honest: 80, torches: 50, time: 'dusk' };
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1500);
function resize() { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ app state
const app = {
  state: 'menu',            // menu | lobby | loading | countdown | playing
  net: null, solo: false, isHost: false,
  me: { id: 'local', name: 'Eyeball', color: COLORS[0] },
  players: [],              // {id, name, color, ready, host}
  settings: { ...DEFAULT_SETTINGS },
  local: { shadows: true, volume: 0.7 },
  audio: new AudioSys(),
  world: null, sky: null, player: null, remotes: new Map(),
  demo: null,
  race: null,
  posCache: new Map(),      // host: latest position per client
  loaded: new Set(),
  elapsed: 0,
};
window.MR = app; app.renderer = renderer; app.scene = scene; app.camera = camera;

// ------------------------------------------------------------------ UI helpers
const screens = ['menu', 'lobby', 'loading'];
function showScreen(name) { for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name); }
let toastTimer;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
function fmtTime(s) { const m = Math.floor(s / 60), r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`; }
function myName() { const v = $('name-input').value.trim().slice(0, 14); return v || 'Eyeball'; }
function findPlayer(id) { return app.players.find(p => p.id === id); }

// ------------------------------------------------------------------ menu background
function buildDemo() {
  if (app.demo) return;
  const maze = generateMaze({ w: 11, h: 11, braid: 0.1, seed: (Math.random() * 1e9) | 0 });
  const world = new World(scene, maze, { hedge: 26, torches: 40, signs: 3, honest: 100 });
  const sky = new Sky(scene, renderer, { mode: 'dusk', shadows: app.local.shadows, seed: maze.seed });
  app.demo = { world, sky, maze, t: 0 };
}
function disposeDemo() { if (!app.demo) return; app.demo.world.dispose(); app.demo.sky.dispose(); app.demo = null; }

// ------------------------------------------------------------------ lobby
function renderLobby() {
  const list = $('player-list'); list.innerHTML = '';
  for (const p of app.players) {
    const li = document.createElement('li'); if (p.id === app.me.id) li.classList.add('me');
    li.innerHTML = `<span class="dot" style="--c:${p.color}"></span><span class="pname"></span>${p.host ? '<span class="crown" title="Host">♛</span>' : ''}<span class="ready">${p.ready ? '✓ ready' : ''}</span>`;
    li.querySelector('.pname').textContent = p.name;
    list.appendChild(li);
  }
  $('player-count').textContent = `${app.players.length}/${MAX_PLAYERS}`;
  $('room-code').textContent = app.solo ? 'SOLO' : (app.net?.code || '----');
  $('settings').classList.toggle('locked', !app.isHost);
  $('settings-lock').classList.toggle('hidden', app.isHost);
  for (const el of document.querySelectorAll('[data-setting]')) {
    const k = el.dataset.setting; el.value = app.settings[k];
    const out = $('o-' + k); if (out) out.textContent = app.settings[k];
  }
  $('btn-start').classList.toggle('hidden', !app.isHost);
  $('btn-start').textContent = app.players.length > 1 ? 'Start race' : 'Start solo run';
  const me = findPlayer(app.me.id);
  $('btn-ready').textContent = me?.ready ? 'Not ready' : "I'm ready";
  $('lobby-solo-hint').textContent = app.solo ? 'Solo run: no network needed. Tweak the maze and press start.' : 'Share the room code, or start alone for a solo run.';
  const readyCount = app.players.filter(p => p.ready).length;
  $('lobby-status').textContent = app.isHost ? `${readyCount}/${app.players.length} ready — you decide when to start.` : 'Waiting for the host to start…';
}

function broadcastLobby() { if (app.isHost && app.net) app.net.broadcast('lobby', { players: app.players, settings: app.settings }); }

function enterLobby() {
  app.state = 'lobby';
  showScreen('lobby');
  $('hud').classList.add('hidden');
  renderLobby();
  buildDemo();
  app.audio.startMusic('lobby');
}

function leaveToMenu(msg) {
  if (app.net) { app.net.close(); app.net = null; }
  endRace(true);
  app.players = []; app.isHost = false; app.solo = false; app.state = 'menu';
  showScreen('menu'); $('hud').classList.add('hidden');
  buildDemo();
  if (msg) toast(msg);
}

// ------------------------------------------------------------------ hosting / joining
async function hostGame(solo = false) {
  app.audio.ensure();
  app.me.name = myName(); localStorage.setItem('mr-name', app.me.name);
  app.solo = solo; app.isHost = true;
  if (solo) {
    app.me.id = 'local';
    app.players = [{ id: 'local', name: app.me.name, color: COLORS[0], ready: true, host: true }];
    enterLobby(); return;
  }
  $('menu-status').textContent = 'Creating room…';
  const net = new Net(); app.net = net;
  wireHost(net);
  try {
    const code = await net.host();
    app.me.id = net.id;
    app.players = [{ id: net.id, name: app.me.name, color: COLORS[0], ready: true, host: true }];
    $('menu-status').textContent = '';
    enterLobby();
    toast(`Room ${code} created — share the code!`);
  } catch (e) {
    console.error(e); app.net = null;
    $('menu-status').textContent = 'Could not reach the signalling server. Check your connection (or try a solo run).';
  }
}

async function joinGame() {
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length < 4) { toast('Enter the room code first.'); return; }
  app.audio.ensure();
  app.me.name = myName(); localStorage.setItem('mr-name', app.me.name);
  $('menu-status').textContent = 'Connecting…';
  $('btn-join').disabled = true;
  const net = new Net(); app.net = net; app.isHost = false; app.solo = false;
  wireClient(net);
  try {
    await net.join(code);
    app.me.id = net.id;
    net.send('hello', { name: app.me.name });
    $('menu-status').textContent = 'Joining lobby…';
  } catch (e) {
    console.error(e); app.net = null;
    $('menu-status').textContent = e.message || 'Could not join.';
  } finally { $('btn-join').disabled = false; }
}

function wireHost(net) {
  net.on('hello', (d, from) => {
    if (app.state !== 'lobby') { net.sendTo(from, 'busy'); setTimeout(() => net.kick(from), 300); return; }
    if (app.players.length >= MAX_PLAYERS) { net.sendTo(from, 'full'); setTimeout(() => net.kick(from), 300); return; }
    const used = new Set(app.players.map(p => p.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[0];
    const name = String(d?.name || 'Eyeball').slice(0, 14);
    app.players.push({ id: from, name, color, ready: false, host: false });
    renderLobby(); broadcastLobby();
    app.audio.join(); toast(`${name} joined`);
  });
  net.on('peer-close', (_, from) => {
    const p = findPlayer(from); if (!p) return;
    app.players = app.players.filter(x => x.id !== from);
    app.posCache.delete(from);
    removeRemote(from);
    renderLobby(); broadcastLobby();
    app.audio.leave(); toast(`${p.name} left`);
  });
  net.on('ready', (d, from) => { const p = findPlayer(from); if (p) { p.ready = !!d; renderLobby(); broadcastLobby(); } });
  net.on('p', (d, from) => { if (Array.isArray(d) && d.length === 5) app.posCache.set(from, d); });
  net.on('loaded', (_, from) => { app.loaded.add(from); checkAllLoaded(); });
  net.on('finished', (d, from) => hostFinish(from, Number(d?.time) || 0));
  net.on('error', (e) => console.warn('peer error', e));
}

function wireClient(net) {
  net.on('lobby', (d) => {
    app.players = d.players || []; app.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    if (app.state === 'menu') enterLobby(); else renderLobby();
  });
  net.on('full', () => leaveToMenu('That room is full (6 players max).'));
  net.on('busy', () => leaveToMenu('That race has already started — try again after it ends.'));
  net.on('start', (d) => startRace(d.seed, d.settings));
  net.on('go', () => beginCountdown());
  net.on('s', (d) => {
    if (!d || !Array.isArray(d.p)) return;
    const now = performance.now() / 1000;
    for (const e of d.p) { if (e[0] === app.me.id) continue; const r = app.remotes.get(e[0]); if (r) r.push(e[1], e[2], e[3], e[4], e[5], now); }
  });
  net.on('finish', (d) => onFinishEvent(d));
  net.on('lobby-return', () => { endRace(); enterLobby(); toast('Back to the lobby'); });
  net.on('host-lost', () => leaveToMenu('Lost connection to the host.'));
  net.on('error', (e) => console.warn('peer error', e));
}

// ------------------------------------------------------------------ race flow
function hostStart() {
  if (!app.isHost || app.state !== 'lobby') return;
  const seed = (Math.random() * 2147483647) | 0;
  app.loaded = new Set([app.me.id]);
  if (app.net) app.net.broadcast('start', { seed, settings: app.settings });
  startRace(seed, app.settings);
}

function startRace(seed, settings) {
  app.settings = { ...DEFAULT_SETTINGS, ...settings };
  app.state = 'loading';
  showScreen('loading'); $('loading-text').textContent = 'Growing hedges…';
  disposeDemo();
  app.audio.stopMusic();
  // yield a frame so the loading panel paints before the (synchronous) build
  setTimeout(() => {
    const s = app.settings;
    const maze = generateMaze({ w: +s.width, h: +s.height, braid: (+s.braid) / 100, seed });
    app.world = new World(scene, maze, { hedge: +s.hedge, torches: +s.torches, signs: +s.signs, honest: +s.honest });
    app.sky = new Sky(scene, renderer, { mode: s.time, shadows: app.local.shadows, seed });
    if (!app.player) app.player = new LocalPlayer(camera, canvas);
    app.player.onStep = (sprint) => app.audio.step(sprint);
    const myIndex = Math.max(0, app.players.findIndex(p => p.id === app.me.id));
    const sp = app.world.spawnPoint(myIndex, app.players.length);
    app.player.place(sp.x, sp.z, sp.yaw);
    app.player.frozen = true; app.player.setEnabled(true);
    // remote eyeballs
    for (const r of app.remotes.values()) { scene.remove(r.eyeball.group); r.eyeball.dispose(); }
    app.remotes.clear();
    app.players.forEach((p, i) => {
      if (p.id === app.me.id) return;
      const eye = new Eyeball(p.name, p.color, i + 1);
      const psp = app.world.spawnPoint(i, app.players.length);
      eye.setPose(psp.x, EYE_HEIGHT, psp.z, psp.yaw, 0);
      scene.add(eye.group);
      const rp = new RemotePlayer(eye);
      rp.push(psp.x, EYE_HEIGHT, psp.z, psp.yaw, 0, performance.now() / 1000);
      app.remotes.set(p.id, rp);
    });
    app.race = { seed, startTime: null, finished: [], myFinished: false };
    $('hud-escaped').innerHTML = ''; $('finish-card').classList.add('hidden'); $('banner').classList.add('hidden');
    $('btn-end-race').classList.toggle('hidden', !app.isHost);
    showScreen(null); $('hud').classList.remove('hidden');
    app.audio.startAmbience();
    app.state = 'countdown';
    $('countdown').classList.remove('hidden'); $('countdown').textContent = 'Waiting…'; $('countdown').classList.remove('pop');
    if (app.isHost) checkAllLoaded(); else app.net?.send('loaded');
    // safety: if the host never sends 'go' (shouldn't happen) start anyway
    if (!app.isHost) app.race.goTimeout = setTimeout(() => { if (app.state === 'countdown' && !app.race.counting) beginCountdown(); }, 15000);
  }, 60);
}

function checkAllLoaded() {
  if (!app.isHost || app.state !== 'countdown' || app.race?.counting) return;
  const all = app.players.every(p => app.loaded.has(p.id));
  const waited = app.race && (performance.now() - (app.race.loadT || (app.race.loadT = performance.now()))) > 12000;
  if (all || waited) { app.net?.broadcast('go'); beginCountdown(); }
  else setTimeout(checkAllLoaded, 500);
}

function beginCountdown() {
  if (!app.race || app.race.counting) return;
  app.race.counting = true; clearTimeout(app.race.goTimeout);
  const el = $('countdown');
  let n = 3;
  const tick = () => {
    if (app.state !== 'countdown') return;
    el.classList.remove('hidden'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (n > 0) { el.textContent = String(n); app.audio.countdown(n); n--; setTimeout(tick, 1000); }
    else {
      el.textContent = 'GO!'; app.audio.countdown(0);
      app.state = 'playing'; app.player.frozen = false;
      app.race.startTime = app.elapsed;
      app.audio.startMusic('game');
      setTimeout(() => el.classList.add('hidden'), 900);
      if (!app.player.locked) toast('Click the screen to capture the mouse', 3000);
    }
  };
  tick();
}

function hostFinish(id, time) {
  if (!app.race || app.race.finished.some(f => f.id === id)) return;
  const rank = app.race.finished.length + 1;
  const p = findPlayer(id);
  const ev = { id, rank, time, name: p?.name || '???' };
  app.race.finished.push(ev);
  app.net?.broadcast('finish', ev);
  onFinishEvent(ev);
}

function onFinishEvent(ev) {
  if (!app.race) return;
  if (!app.race.finished.some(f => f.id === ev.id)) app.race.finished.push(ev);
  app.race.finished.sort((a, b) => a.rank - b.rank);
  $('hud-escaped').innerHTML = app.race.finished.map(f => `<div>${f.rank}. <b></b> ${fmtTime(f.time)}</div>`).join('');
  [...$('hud-escaped').querySelectorAll('b')].forEach((b, i) => b.textContent = app.race.finished[i].name);
  const mine = ev.id === app.me.id;
  if (ev.rank === 1) { showBanner(mine ? 'You escaped first!' : `${ev.name} escaped first!`); if (!mine) app.audio.chime(); }
  else if (!mine) { showBanner(`${ev.name} escaped (#${ev.rank})`); app.audio.chime(); }
  if (mine) {
    app.race.myFinished = true;
    app.player.frozen = true;
    if (ev.rank === 1) app.audio.win(); else app.audio.chime();
    $('finish-title').textContent = ev.rank === 1 ? 'You escaped first!' : `You escaped #${ev.rank}`;
    $('finish-sub').textContent = `Time ${fmtTime(ev.time)}`;
    $('finish-card').classList.remove('hidden');
    $('btn-back-lobby').classList.toggle('hidden', !app.isHost);
    $('finish-wait').classList.toggle('hidden', app.isHost);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  const ol = $('finish-ranks'); ol.innerHTML = '';
  for (const f of app.race.finished) { const li = document.createElement('li'); li.textContent = f.name; const b = document.createElement('b'); b.textContent = fmtTime(f.time); li.appendChild(b); ol.appendChild(li); }
}

let bannerTimer;
function showBanner(text, ms = 3500) { const b = $('banner'); b.textContent = text; b.classList.remove('hidden'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.add('hidden'), ms); }

function removeRemote(id) { const r = app.remotes.get(id); if (!r) return; scene.remove(r.eyeball.group); r.eyeball.dispose(); app.remotes.delete(id); }

function endRace(silent = false) {
  if (app.world) { app.world.dispose(); app.world = null; }
  if (app.sky) { app.sky.dispose(); app.sky = null; }
  for (const id of [...app.remotes.keys()]) removeRemote(id);
  if (app.player) app.player.setEnabled(false);
  app.race = null; app.posCache.clear();
  app.audio.stopAmbience();
  if (!silent) app.audio.stopMusic();
  $('hud').classList.add('hidden'); $('finish-card').classList.add('hidden'); $('countdown').classList.add('hidden');
}

function hostReturnToLobby() {
  if (!app.isHost) return;
  app.net?.broadcast('lobby-return');
  endRace(); enterLobby();
}

// ------------------------------------------------------------------ HUD
const compassStrip = $('compass-strip');
{
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let html = '';
  for (let r = 0; r < 3; r++) for (const l of labels) html += `<span class="${l.length === 1 ? 'major' : ''}">${l}</span>`;
  compassStrip.innerHTML = html;
}
function updateHUD() {
  if (!app.race) return;
  const t = app.race.startTime == null ? 0 : (app.race.myFinished ? app.race.finished.find(f => f.id === app.me.id)?.time ?? 0 : app.elapsed - app.race.startTime);
  $('hud-timer').textContent = fmtTime(t);
  const heading = ((-app.player.yaw * 180 / Math.PI) % 360 + 360) % 360; // 0 = north (-Z), 90 = east (+X)
  compassStrip.style.transform = `translateX(${130 - 480 - heading / 45 * 60}px)`;
}


// Network tick runs on a timer (not rAF) so a backgrounded host keeps relaying state.
function netTick() {
  if (!app.race || !app.net || !app.player || !app.world) return;
  const p = app.player, me = [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3)];
  if (app.isHost) {
    const list = [[app.me.id, ...me]];
    for (const [id, d] of app.posCache) list.push([id, ...d]);
    app.net.broadcast('s', { p: list });
    const nowS = performance.now() / 1000;
    for (const [id, d] of app.posCache) { const r = app.remotes.get(id); if (r && r._lastSeen !== d) { r._lastSeen = d; r.push(d[0], d[1], d[2], d[3], d[4], nowS); } }
  } else app.net.send('p', me);
}
setInterval(netTick, 1000 / SEND_RATE);

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  app.elapsed += dt;
  const nowS = now / 1000;

  if (app.demo && !app.world) {
    const d = app.demo; d.t += dt;
    const cx = d.maze.w * CELL / 2, cz = d.maze.h * CELL / 2;
    camera.position.set(cx + Math.cos(d.t * 0.08) * 62, 34 + Math.sin(d.t * 0.2) * 4, cz + Math.sin(d.t * 0.08) * 62);
    camera.lookAt(cx, 6, cz);
    d.world.setCameraQuaternion(camera.quaternion);
    d.world.update(dt, camera.position);
    d.sky.apply(app.elapsed, camera.position);
  }

  if (app.world && app.player) {
    app.player.update(dt, app.world);
    app.world.setCameraQuaternion(camera.quaternion);
    app.world.update(dt, app.player.pos);
    app.sky.apply(app.elapsed, app.player.pos);
    for (const r of app.remotes.values()) r.update(dt, nowS, app.elapsed);

    // finish detection
    if (app.state === 'playing' && app.race && !app.race.myFinished && app.world.isOutside(app.player.pos.x, app.player.pos.z)) {
      app.race.myFinished = true;
      const time = app.elapsed - app.race.startTime;
      if (app.isHost) hostFinish(app.me.id, time); else app.net.send('finished', { time });
    }
    // audio ambience
    const st = app.sky.state;
    const torchD = app.world.nearestTorchDist ?? 99;
    app.audio.tick(dt, { night: st.night, day: st.dayF, torch: Math.max(0, 1 - torchD / 14) });
    updateHUD();
  }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ wiring
$('name-input').value = localStorage.getItem('mr-name') || '';
$('btn-host').addEventListener('click', () => { app.audio.ensure(); app.audio.click(); hostGame(false); });
$('btn-solo').addEventListener('click', () => { app.audio.ensure(); app.audio.click(); hostGame(true); });
$('btn-join').addEventListener('click', () => { app.audio.ensure(); app.audio.click(); joinGame(); });
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
$('btn-leave').addEventListener('click', () => { app.audio.click(); leaveToMenu(); });
$('btn-ready').addEventListener('click', () => {
  app.audio.click();
  const me = findPlayer(app.me.id); if (!me) return;
  me.ready = !me.ready; renderLobby();
  if (app.isHost) broadcastLobby(); else app.net?.send('ready', me.ready);
});
$('btn-start').addEventListener('click', () => { app.audio.click(); hostStart(); });
$('btn-back-lobby').addEventListener('click', () => { app.audio.click(); hostReturnToLobby(); });
$('room-code').addEventListener('click', () => { if (app.net?.code) navigator.clipboard?.writeText(app.net.code).then(() => toast('Room code copied')); });
for (const el of document.querySelectorAll('[data-setting]')) {
  el.addEventListener('input', () => {
    if (!app.isHost) return;
    const k = el.dataset.setting;
    app.settings[k] = el.tagName === 'SELECT' ? el.value : +el.value;
    const out = $('o-' + k); if (out) out.textContent = app.settings[k];
    broadcastLobby();
  });
}
$('l-shadows').addEventListener('change', (e) => { app.local.shadows = e.target.checked; app.sky?.setShadows(app.local.shadows); app.demo?.sky.setShadows(app.local.shadows); });
$('l-volume').addEventListener('input', (e) => { app.local.volume = e.target.value / 100; app.audio.setVolume(app.local.volume); });
// host-only "end race" button lives in the HUD
{
  const b = document.createElement('button'); b.id = 'btn-end-race'; b.textContent = 'End race'; b.className = 'hidden';
  b.style.cssText = 'position:absolute;top:14px;right:16px;pointer-events:auto;font-size:13px;padding:6px 12px;';
  $('hud').appendChild(b);
  b.addEventListener('click', () => { app.audio.click(); hostReturnToLobby(); });
}
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (e.code === 'KeyM') { const m = app.audio.toggleMute(); toast(m ? 'Muted' : 'Sound on', 1200); }
});
window.addEventListener('beforeunload', () => { app.net?.close(); });

buildDemo();
showScreen('menu');
requestAnimationFrame(loop);
