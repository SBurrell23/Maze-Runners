// Local first-person controller + remote player interpolation.
import * as THREE from 'three';
import { EYE_HEIGHT } from './eyeball.js';

const RADIUS = 0.7;
const WALK = 7.5, SPRINT = 12;
const INTERP_DELAY = 0.12; // seconds behind "now" that remote players are rendered

export class LocalPlayer {
  constructor(camera, canvas) {
    this.camera = camera; this.canvas = canvas;
    this.pos = new THREE.Vector3(0, EYE_HEIGHT, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this.enabled = false;
    this.frozen = false;
    this.bobT = 0; this.stepAcc = 0;
    this.onStep = null;
    this.speedFactor = 0;

    this._onKey = (e) => {
      if (e.type === 'keydown') { if (e.repeat) return; this.keys.add(e.code); }
      else this.keys.delete(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && this.enabled) e.preventDefault();
    };
    this._onMouse = (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    this._onLock = () => { const was = this.locked; this.locked = document.pointerLockElement === this.canvas; if (!this.locked) { this.keys.clear(); if (was) this.onUnlock?.(); } };
    this._onBlur = () => this.keys.clear();
    this._onClick = () => this.requestLock();
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKey);
    document.addEventListener('mousemove', this._onMouse);
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('click', this._onClick);
  }

  requestLock() {
    if (!this.enabled || this.locked) return;
    try { const p = this.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => { /* embedded browsers may refuse pointer lock; arrows/Q/E still turn */ }); } catch (e) { /* same */ }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.keys.clear(); if (document.pointerLockElement === this.canvas) document.exitPointerLock?.(); }
  }

  place(x, z, yaw) { this.pos.set(x, EYE_HEIGHT, z); this.yaw = yaw; this.pitch = 0; this.vel.set(0, 0, 0); this.syncCamera(0); }

  update(dt, world) {
    const k = this.keys;
    let f = 0, s = 0;
    if (this.enabled && !this.frozen) {
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD')) s += 1;
      if (k.has('KeyA')) s -= 1;
      // arrows turn when the mouse isn't captured (handy without pointer lock)
      if (k.has('ArrowLeft')) { if (this.locked) s -= 1; else this.yaw += 2.2 * dt; }
      if (k.has('ArrowRight')) { if (this.locked) s += 1; else this.yaw -= 2.2 * dt; }
      if (k.has('KeyQ')) this.yaw += 2.2 * dt;
      if (k.has('KeyE')) this.yaw -= 2.2 * dt;
    }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = sprint ? SPRINT : WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is -Z at yaw 0
    const dirX = (-sin * f) + (cos * s), dirZ = (-cos * f) + (-sin * s);
    const len = Math.hypot(dirX, dirZ) || 1;
    const target = new THREE.Vector3(dirX / len * speed * (f || s ? 1 : 0), 0, dirZ / len * speed * (f || s ? 1 : 0));
    // acceleration for a bit of weight
    const accel = (f || s) ? 18 : 22;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (world) world.collide(this.pos, RADIUS);

    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.speedFactor = spd / SPRINT;
    if (spd > 0.5) {
      this.bobT += dt * spd * 1.6;
      this.stepAcc += dt * spd;
      const stride = sprint ? 3.2 : 2.6;
      if (this.stepAcc > stride) { this.stepAcc = 0; this.onStep?.(sprint); }
    } else { this.bobT *= 0.9; this.stepAcc = 0; }
    this.syncCamera(spd);
  }

  syncCamera(spd) {
    const bob = Math.sin(this.bobT) * 0.045 * Math.min(1, spd / WALK);
    this.camera.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = Math.sin(this.bobT * 0.5) * 0.004 * Math.min(1, spd / WALK);
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('keyup', this._onKey);
    document.removeEventListener('mousemove', this._onMouse);
    document.removeEventListener('pointerlockchange', this._onLock);
    window.removeEventListener('blur', this._onBlur);
    this.canvas.removeEventListener('click', this._onClick);
  }
}

/** Snapshot buffer: renders remote players slightly in the past for smooth motion. */
export class RemotePlayer {
  constructor(eyeball) {
    this.eyeball = eyeball;
    this.snaps = []; // {t, x, y, z, yaw, pitch}
    this.cur = null;
  }

  push(x, y, z, yaw, pitch, now) {
    const last = this.snaps[this.snaps.length - 1];
    // guard against clock weirdness: keep strictly increasing timestamps
    const t = last && now <= last.t ? last.t + 0.001 : now;
    this.snaps.push({ t, x, y, z, yaw, pitch });
    if (this.snaps.length > 40) this.snaps.shift();
  }

  update(dt, now, time) {
    const s = this.snaps;
    if (!s.length) return;
    const rt = now - INTERP_DELAY;
    let a = null, b = null;
    for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || null; break; } }
    let x, y, z, yaw, pitch;
    if (!a) { ({ x, y, z, yaw, pitch } = s[0]); }
    else if (!b) {
      // extrapolate a little from the last two snapshots, then hold
      const p = s.length >= 2 ? s[s.length - 2] : null;
      const last = s[s.length - 1];
      const ahead = Math.min(0.15, rt - last.t);
      if (p && ahead > 0) {
        const span = Math.max(0.001, last.t - p.t);
        x = last.x + (last.x - p.x) / span * ahead; z = last.z + (last.z - p.z) / span * ahead; y = last.y;
      } else { x = last.x; y = last.y; z = last.z; }
      yaw = last.yaw; pitch = last.pitch;
    } else {
      const k = Math.min(1, Math.max(0, (rt - a.t) / Math.max(0.001, b.t - a.t)));
      x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k; z = a.z + (b.z - a.z) * k;
      yaw = lerpAngle(a.yaw, b.yaw, k); pitch = a.pitch + (b.pitch - a.pitch) * k;
    }
    // final smoothing pass to hide snapshot jitter
    if (!this.cur) this.cur = { x, y, z, yaw, pitch };
    else {
      const f = 1 - Math.exp(-dt * 20);
      this.cur.x += (x - this.cur.x) * f; this.cur.y += (y - this.cur.y) * f; this.cur.z += (z - this.cur.z) * f;
      this.cur.yaw = lerpAngle(this.cur.yaw, yaw, f); this.cur.pitch += (pitch - this.cur.pitch) * f;
    }
    this.eyeball.setPose(this.cur.x, this.cur.y, this.cur.z, this.cur.yaw, this.cur.pitch);
    this.eyeball.update(dt, time);
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
