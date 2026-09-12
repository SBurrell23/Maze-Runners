// Player avatar: a giant floating eyeball that looks where its owner looks.
import * as THREE from 'three';
import { makeEyeTexture, makeNameTexture } from './textures.js';

export const EYE_RADIUS = 1.15;
export const EYE_HEIGHT = 2.6;

export class Eyeball {
  constructor(name, color, seed = 1) {
    this.group = new THREE.Group();
    this.tex = makeEyeTexture(color, seed);
    const mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.18, metalness: 0.05 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_RADIUS, 40, 28), mat);
    // SphereGeometry puts u=0.5 (iris centre) on +X; turn it to face -Z (forward).
    this.pivot = new THREE.Group();
    this.ball.rotation.y = Math.PI / 2;
    this.ball.castShadow = true;
    this.pivot.add(this.ball);
    this.group.add(this.pivot);

    // soft glow / rim so it reads at night
    const glowMat = new THREE.SpriteMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(EYE_RADIUS * 4.2, EYE_RADIUS * 4.2, 1);
    this.group.add(this.glow);
    const glowTex = makeGlowTexture(); glowMat.map = glowTex; glowMat.needsUpdate = true;
    this.glowTex = glowTex;

    // name tag
    this.nameTex = makeNameTexture(name, color);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, transparent: true, depthWrite: false }));
    this.tag.scale.set(3.2, 0.8, 1);
    this.tag.position.y = EYE_RADIUS + 0.9;
    this.group.add(this.tag);

    this.light = new THREE.PointLight(color, 6, 9, 1.8);
    this.group.add(this.light);

    this.phase = Math.random() * 10;
    this.blink = 0; this.nextBlink = 2 + Math.random() * 4;
    this.yaw = 0; this.pitch = 0;
    this.group.position.y = EYE_HEIGHT;
  }

  setPose(x, y, z, yaw, pitch) {
    this.group.position.set(x, y, z);
    this.yaw = yaw; this.pitch = pitch;
  }

  update(dt, t) {
    // bob and look
    this.group.position.y += Math.sin(t * 1.7 + this.phase) * 0.0025;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.rotation.y = this.yaw;
    this.pivot.rotateX(this.pitch);
    // blink = squash vertically for a few frames
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 0.22; this.nextBlink = 2.5 + Math.random() * 5; }
    if (this.blink > 0) {
      this.blink -= dt;
      const k = Math.sin(Math.min(1, 1 - this.blink / 0.22) * Math.PI);
      this.ball.scale.set(1, 1 - k * 0.85, 1);
    } else this.ball.scale.set(1, 1, 1);
  }

  dispose() {
    this.ball.geometry.dispose(); this.ball.material.dispose(); this.tex.dispose();
    this.glow.material.dispose(); this.glowTex.dispose();
    this.tag.material.dispose(); this.nameTex.dispose();
    this.light.dispose();
  }
}

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
