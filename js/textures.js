// All textures are painted procedurally onto canvases at load time.
// Nothing here is loaded from disk.
import * as THREE from 'three';
import { mulberry32 } from './maze.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// Draw `fn(ctx)` at (x,y) and also at wrapped positions so the tile is seamless.
function wrapped(ctx, size, x, y, margin, fn) {
  const xs = [0]; const ys = [0];
  if (x < margin) xs.push(size); else if (x > size - margin) xs.push(-size);
  if (y < margin) ys.push(size); else if (y > size - margin) ys.push(-size);
  for (const ox of xs) for (const oy of ys) {
    ctx.save(); ctx.translate(x + ox, y + oy); fn(ctx); ctx.restore();
  }
}

function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

// ---------------------------------------------------------------- HEDGE
export async function makeHedgeTextures(seed = 7, size = 1024, onChunk = null) {
  const rand = mulberry32(seed);
  const c = canvas(size), ctx = c.getContext('2d');
  const b = canvas(size), bctx = b.getContext('2d');

  ctx.fillStyle = '#1b3418'; ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#404040'; bctx.fillRect(0, 0, size, size);

  // Large soft variation blobs (depth / shading).
  for (let i = 0; i < 40; i++) {
    const x = rand() * size, y = rand() * size, r = 120 + rand() * 300;
    const dark = rand() < 0.55;
    wrapped(ctx, size, x, y, r, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, dark ? 'rgba(8,20,8,0.35)' : 'rgba(90,140,60,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    });
  }

  // Twigs underneath.
  ctx.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    const x = rand() * size, y = rand() * size, len = 30 + rand() * 90, a = rand() * Math.PI * 2;
    wrapped(ctx, size, x, y, 120, (g) => {
      g.strokeStyle = hsl(28 + rand() * 12, 30 + rand() * 20, 14 + rand() * 12);
      g.lineWidth = 1.5 + rand() * 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
    });
  }

  // Leaves — thousands, drawn back to front (darker first).
  const leafCount = 19000;
  for (let i = 0; i < leafCount; i++) {
    if (i % 2500 === 0 && i) { if (onChunk) onChunk(i / leafCount); await yieldFrame(); }
    const t = i / leafCount;
    const x = rand() * size, y = rand() * size;
    const rx = 3.5 + rand() * 7.5, ry = rx * (0.45 + rand() * 0.35);
    const rot = rand() * Math.PI * 2;
    const hue = 82 + rand() * 50;
    const light = 14 + t * 22 + rand() * 12;
    const sat = 32 + rand() * 30;
    const fill = hsl(hue, sat, light);
    const edge = hsl(hue, sat, Math.max(6, light - 12));
    const vein = hsl(hue, sat - 10, Math.min(60, light + 14), 0.6);
    wrapped(ctx, size, x, y, 24, (g) => {
      g.rotate(rot);
      g.fillStyle = fill; g.strokeStyle = edge; g.lineWidth = 1;
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = vein; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(-rx * 0.8, 0); g.lineTo(rx * 0.8, 0); g.stroke();
    });
    const bl = 60 + t * 130 + rand() * 40;
    wrapped(bctx, size, x, y, 24, (g) => {
      g.rotate(rot);
      g.fillStyle = `rgb(${bl | 0},${bl | 0},${bl | 0})`;
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5; g.stroke();
    });
  }

  // Occasional dry / yellowing leaves and dark cavities.
  for (let i = 0; i < 260; i++) {
    const x = rand() * size, y = rand() * size, r = 4 + rand() * 6;
    const dry = rand() < 0.6;
    wrapped(ctx, size, x, y, 16, (g) => {
      g.rotate(rand() * 6.28);
      g.fillStyle = dry ? hsl(40 + rand() * 20, 55, 40 + rand() * 15) : 'rgba(0,0,0,0.5)';
      g.beginPath(); g.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2); g.fill();
    });
  }

  return { map: tex(c), bump: tex(b, { srgb: false }) };
}

// ---------------------------------------------------------------- GROUND
export function makeGroundTexture(seed = 11, size = 1024) {
  const rand = mulberry32(seed);
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#5a4733'; ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 60; i++) {
    const x = rand() * size, y = rand() * size, r = 80 + rand() * 260;
    const k = rand();
    wrapped(ctx, size, x, y, r, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      const col = k < 0.4 ? 'rgba(30,20,12,0.35)' : k < 0.7 ? 'rgba(120,100,70,0.25)' : 'rgba(70,90,40,0.25)';
      grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    });
  }
  // Fine grit
  for (let i = 0; i < 26000; i++) {
    const x = rand() * size, y = rand() * size;
    const l = 15 + rand() * 40;
    ctx.fillStyle = hsl(28 + rand() * 14, 20 + rand() * 25, l, 0.6);
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Pebbles
  for (let i = 0; i < 900; i++) {
    const x = rand() * size, y = rand() * size, r = 2 + rand() * 5;
    wrapped(ctx, size, x, y, 12, (g) => {
      g.rotate(rand() * 6.28);
      g.fillStyle = hsl(25 + rand() * 20, 8 + rand() * 15, 30 + rand() * 30);
      g.beginPath(); g.ellipse(0, 0, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.ellipse(-r * 0.3, -r * 0.3, r * 0.4, r * 0.25, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.ellipse(r * 0.2, r * 0.45, r * 0.8, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    });
  }
  // Grass tufts & roots
  ctx.lineCap = 'round';
  for (let i = 0; i < 350; i++) {
    const x = rand() * size, y = rand() * size;
    wrapped(ctx, size, x, y, 30, (g) => {
      const n = 4 + (rand() * 6) | 0;
      for (let k = 0; k < n; k++) {
        g.strokeStyle = hsl(80 + rand() * 40, 35 + rand() * 25, 22 + rand() * 20);
        g.lineWidth = 1 + rand();
        const a = -Math.PI / 2 + (rand() - 0.5) * 1.6, len = 8 + rand() * 16;
        g.beginPath(); g.moveTo(0, 0);
        g.quadraticCurveTo(Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.5, Math.cos(a) * len + (rand() - .5) * 6, Math.sin(a) * len);
        g.stroke();
      }
    });
  }
  // Cracks
  for (let i = 0; i < 40; i++) {
    let x = rand() * size, y = rand() * size;
    ctx.strokeStyle = 'rgba(20,12,6,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (rand() - .5) * 30; y += (rand() - .5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return tex(c);
}

// ---------------------------------------------------------------- BARK / WOOD
export function makeBarkTexture(seed = 3) {
  const rand = mulberry32(seed);
  const w = 256, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#3d2a1a'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) {
    const x = rand() * w, len = 40 + rand() * 200, y = rand() * h;
    ctx.strokeStyle = hsl(22 + rand() * 14, 25 + rand() * 20, 10 + rand() * 25, 0.7);
    ctx.lineWidth = 1 + rand() * 4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - .5) * 8, y + len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + (rand() - .5) * 8, y + len - h); ctx.stroke();
  }
  return tex(c);
}

export function makeWoodTexture(seed = 5) {
  const rand = mulberry32(seed);
  const w = 512, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#7a5330'); g.addColorStop(0.5, '#8f6238'); g.addColorStop(1, '#6d4828');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = rand() * h;
    ctx.strokeStyle = hsl(26 + rand() * 10, 40, 18 + rand() * 20, 0.35 + rand() * 0.4);
    ctx.lineWidth = 0.6 + rand() * 2.2;
    ctx.beginPath(); ctx.moveTo(-10, y);
    for (let x = 0; x <= w + 10; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 + (rand() - .5) * 3);
    ctx.stroke();
  }
  // knots
  for (let i = 0; i < 4; i++) {
    const x = rand() * w, y = rand() * h, r = 6 + rand() * 10;
    ctx.strokeStyle = 'rgba(40,20,8,0.7)'; ctx.lineWidth = 1.5;
    for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.ellipse(x, y, r * k * 0.5, r * k * 0.3, 0.3, 0, 6.28); ctx.stroke(); }
  }
  return tex(c);
}

// ---------------------------------------------------------------- SIGN
export function makeSignTexture(text, { glow = false, size = 512 } = {}) {
  const w = size, h = size / 2, c = canvas(w, h), ctx = c.getContext('2d');
  // plank background
  ctx.drawImage(makeWoodTexture(hashCode(text)).image, 0, 0, w, h);
  ctx.strokeStyle = 'rgba(30,15,5,0.9)'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, w - 10, h - 10);
  // nails
  ctx.fillStyle = '#2a2a2a';
  for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]]) { ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.28); ctx.fill(); }
  ctx.font = `bold ${text.length > 10 ? 44 : 78}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = '#7dff9a'; ctx.shadowBlur = 24; ctx.fillStyle = '#c8ffd4'; }
  else { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.fillStyle = '#2b1a0c'; }
  ctx.fillText(text, w / 2, h / 2 + 4);
  if (!glow) { ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,230,180,0.25)'; ctx.fillText(text, w / 2 - 2, h / 2 + 2); }
  return tex(c, { repeat: false });
}

function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }

// ---------------------------------------------------------------- VINES (alpha)
export function makeVineTexture(seed = 21) {
  const rand = mulberry32(seed);
  const w = 256, h = 1024, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  const leaf = (x, y, a, s) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = hsl(95 + rand() * 40, 40 + rand() * 25, 20 + rand() * 22);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.6, -s * 0.5, s * 1.4, 0);
    ctx.quadraticCurveTo(s * 0.6, s * 0.5, 0, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(200,255,180,0.35)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 1.2, 0); ctx.stroke();
    ctx.restore();
  };
  const stem = (x, y, dirY, len, width) => {
    let px = x, py = y;
    for (let k = 0; k < len; k++) {
      const nx = px + (rand() - .5) * 18, ny = py + dirY * (10 + rand() * 12);
      if (nx < 10 || nx > w - 10 || ny < 0 || ny > h) break;
      ctx.strokeStyle = hsl(70 + rand() * 30, 30, 14 + rand() * 12);
      ctx.lineWidth = width * (1 - k / len) + 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      if (rand() < 0.75) leaf(nx, ny, rand() * Math.PI * 2, 10 + rand() * 16);
      if (rand() < 0.08 && width > 3) stem(nx, ny, dirY, len * 0.4, width * 0.6);
      px = nx; py = ny;
    }
  };
  const nStems = 2 + (rand() * 2) | 0;
  for (let i = 0; i < nStems; i++) stem(60 + rand() * (w - 120), rand() < 0.5 ? 0 : h, rand() < 0.5 ? 1 : -1, 60 + rand() * 40, 5 + rand() * 3);
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- MOSS / DIRT PATCH (alpha)
export function makeBlobTexture(seed, { hue, sat, light, speckle = true } = {}) {
  const rand = mulberry32(seed);
  const s = 256, c = canvas(s), ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, hsl(hue, sat, light, 0.9));
  grad.addColorStop(0.55, hsl(hue, sat, light - 5, 0.55));
  grad.addColorStop(1, hsl(hue, sat, light, 0));
  ctx.fillStyle = grad;
  // irregular outline
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const r = s * 0.5 * (0.7 + 0.3 * Math.sin(a * 3 + seed) * rand());
    const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  if (speckle) {
    for (let i = 0; i < 700; i++) {
      const a = rand() * 6.28, r = rand() * s * 0.42;
      ctx.fillStyle = hsl(hue + (rand() - .5) * 20, sat, light + (rand() - .5) * 30, 0.6);
      ctx.fillRect(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 2, 2);
    }
  }
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- GRASS TUFT (alpha)
export function makeTuftTexture(seed = 31) {
  const rand = mulberry32(seed);
  const s = 256, c = canvas(s), ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x0 = s / 2 + (rand() - .5) * 60;
    const a = -Math.PI / 2 + (rand() - .5) * 1.4, len = 90 + rand() * 120;
    ctx.strokeStyle = hsl(75 + rand() * 45, 40 + rand() * 25, 22 + rand() * 25);
    ctx.lineWidth = 3 + rand() * 4;
    ctx.beginPath(); ctx.moveTo(x0, s);
    ctx.quadraticCurveTo(x0 + Math.cos(a) * len * 0.4, s + Math.sin(a) * len * 0.6, x0 + Math.cos(a) * len * 1.2, s + Math.sin(a) * len);
    ctx.stroke();
  }
  // a few flowers
  for (let i = 0; i < 3; i++) {
    const x = s / 2 + (rand() - .5) * 100, y = 80 + rand() * 90;
    ctx.fillStyle = ['#f2d05a', '#f28ab0', '#f5f5f5', '#c99cff'][(rand() * 4) | 0];
    for (let p = 0; p < 5; p++) { ctx.beginPath(); ctx.arc(x + Math.cos(p * 1.256) * 6, y + Math.sin(p * 1.256) * 6, 5, 0, 6.28); ctx.fill(); }
    ctx.fillStyle = '#ffb14a'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.28); ctx.fill();
  }
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- LEAF (white, tinted per instance)
export function makeLeafTexture() {
  const s = 64, c = canvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(4, s / 2);
  ctx.quadraticCurveTo(s / 2, 2, s - 4, s / 2);
  ctx.quadraticCurveTo(s / 2, s - 2, 4, s / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, s / 2); ctx.lineTo(s - 8, s / 2); ctx.stroke();
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- CLOUD (alpha)
export function makeCloudTexture(seed = 41) {
  const rand = mulberry32(seed);
  const s = 512, c = canvas(s), ctx = c.getContext('2d');
  const puffs = 22 + (rand() * 14) | 0;
  for (let i = 0; i < puffs; i++) {
    const x = s * 0.5 + (rand() - .5) * s * 0.6, y = s * 0.55 + (rand() - .5) * s * 0.3;
    const r = 40 + rand() * 90;
    const grad = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  }
  // flatter, darker base
  const grad = ctx.createLinearGradient(0, s * 0.45, 0, s * 0.9);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(120,130,150,0.35)');
  ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- EYEBALL (equirectangular)
export function makeEyeTexture(irisColor = '#3a8f5c', seed = 1) {
  const rand = mulberry32(seed);
  const w = 1024, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#f3efe6'; ctx.fillRect(0, 0, w, h);
  // subtle sclera shading + veins
  const sg = ctx.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, 520);
  sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(200,120,110,0.35)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const a = rand() * 6.28; let r = 460 + rand() * 80;
    let x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.5;
    ctx.strokeStyle = `rgba(200,40,40,${0.25 + rand() * 0.4})`; ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = 6 + (rand() * 8) | 0;
    for (let k = 0; k < steps; k++) {
      r -= 22 + rand() * 30; if (r < 190) break;
      x = w / 2 + Math.cos(a + (rand() - .5) * 0.5) * r; y = h / 2 + Math.sin(a + (rand() - .5) * 0.5) * r * 0.5;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // iris
  const cx = w / 2, cy = h / 2, R = 128;
  const base = new THREE.Color(irisColor);
  const hslc = {}; base.getHSL(hslc);
  const H = hslc.h * 360, S = hslc.s * 100, L = hslc.l * 100;
  const ig = ctx.createRadialGradient(cx, cy, 30, cx, cy, R);
  ig.addColorStop(0, hsl(H, S, Math.min(70, L + 18)));
  ig.addColorStop(0.7, hsl(H, S, L));
  ig.addColorStop(1, hsl(H, Math.min(100, S + 10), Math.max(5, L - 25)));
  ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.28); ctx.fill();
  // iris fibres
  for (let i = 0; i < 260; i++) {
    const a = rand() * 6.28;
    ctx.strokeStyle = hsl(H + (rand() - .5) * 30, S, L + (rand() - .5) * 50, 0.5);
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42);
    ctx.lineTo(cx + Math.cos(a + (rand() - .5) * 0.1) * (R - 4), cy + Math.sin(a + (rand() - .5) * 0.1) * (R - 4)); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, 6.28); ctx.stroke();
  // pupil
  const pg = ctx.createRadialGradient(cx, cy, 30, cx, cy, 52);
  pg.addColorStop(0, '#000'); pg.addColorStop(0.85, '#050505'); pg.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, 52, 0, 6.28); ctx.fill();
  const t = tex(c, { repeat: false });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- NAME TAG
export function makeNameTexture(name, color = '#fff') {
  const w = 512, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.font = 'bold 60px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = Math.min(w - 20, ctx.measureText(name).width + 50);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, w / 2 - tw / 2, 14, tw, 100, 22); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.fillText(name, w / 2, h / 2 + 2);
  return tex(c, { repeat: false });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ---------------------------------------------------------------- STONE (torch bowl / rocks)
export function makeStoneTexture(seed = 9) {
  const rand = mulberry32(seed);
  const s = 256, c = canvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#6b6560'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = hsl(30, 5 + rand() * 10, 25 + rand() * 40, 0.5);
    ctx.fillRect(rand() * s, rand() * s, 1 + rand() * 3, 1 + rand() * 3);
  }
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1 + rand();
    let x = rand() * s, y = rand() * s; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rand() - .5) * 40; y += (rand() - .5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return tex(c);
}

export const yieldFrame = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------- WHEAT (alpha, tinted per instance)
export function makeWheatTexture(seed = 51) {
  const rand = mulberry32(seed);
  const w = 128, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const x0 = 40 + k * 24 + (rand() - .5) * 10;
    const lean = (rand() - .5) * 26;
    // stalk
    ctx.strokeStyle = hsl(46 + rand() * 10, 55, 40 + rand() * 12); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, h); ctx.quadraticCurveTo(x0 + lean * 0.3, h * 0.55, x0 + lean, 70); ctx.stroke();
    // leaf blade
    ctx.lineWidth = 2; ctx.strokeStyle = hsl(50, 45, 50, 0.9);
    ctx.beginPath(); ctx.moveTo(x0, h * 0.8); ctx.quadraticCurveTo(x0 + 18, h * 0.62, x0 + 30 + rand() * 10, h * 0.66); ctx.stroke();
    // head of grain: stacked kernels with awns
    const hx = x0 + lean, hy = 70;
    for (let i = 0; i < 9; i++) {
      const y = hy + i * 5.5, side = i % 2 ? 1 : -1;
      ctx.strokeStyle = hsl(46, 60, 62, 0.8); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx + side * 3, y); ctx.lineTo(hx + side * 12, y - 34 - rand() * 12); ctx.stroke();
      ctx.fillStyle = hsl(44 + rand() * 8, 62, 52 + rand() * 14);
      ctx.beginPath(); ctx.ellipse(hx + side * 3.5, y, 3.2, 5, side * 0.5, 0, 6.28); ctx.fill();
      ctx.strokeStyle = 'rgba(90,60,10,0.5)'; ctx.stroke();
    }
  }
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- SHARED TEXTURE SET
// Textures don't depend on the maze, so they are painted once and reused by every world.
let sharedPromise = null;
export function getSharedTextures(onProgress) {
  if (!sharedPromise) sharedPromise = buildShared(onProgress);
  return sharedPromise;
}
async function buildShared(onProgress) {
  const rep = (f, l) => onProgress && onProgress(f, l);
  rep(0.02, 'Painting hedge leaves…');
  const hedge = await makeHedgeTextures(7, 1024, (f) => rep(0.02 + f * 0.5, 'Painting hedge leaves…'));
  rep(0.55, 'Raking the dirt…'); await yieldFrame();
  const ground = makeGroundTexture(11);
  rep(0.7, 'Carving wood…'); await yieldFrame();
  const bark = makeBarkTexture(3), wood = makeWoodTexture(5), stone = makeStoneTexture(9);
  rep(0.8, 'Growing vines…'); await yieldFrame();
  const vines = [makeVineTexture(21), makeVineTexture(22), makeVineTexture(23), makeVineTexture(24)];
  const moss = makeBlobTexture(31, { hue: 95, sat: 45, light: 30 });
  const dirt = makeBlobTexture(32, { hue: 28, sat: 35, light: 18, speckle: true });
  rep(0.9, 'Sowing wheat…'); await yieldFrame();
  const tuft = makeTuftTexture(33), leaf = makeLeafTexture(), wheat = makeWheatTexture(51);
  rep(1, 'Ready');
  return { hedge, ground, bark, wood, stone, vines, moss, dirt, tuft, leaf, wheat };
}

const signCache = new Map();
export function getSignTexture(text, opts = {}) {
  const key = text + '|' + (opts.glow ? 'g' : '');
  if (!signCache.has(key)) signCache.set(key, makeSignTexture(text, opts));
  return signCache.get(key);
}
