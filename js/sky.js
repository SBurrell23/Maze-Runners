// Sky dome (shader), sun / moon / stars, drifting clouds and the lighting rig.
import * as THREE from 'three';
import { makeCloudTexture } from './textures.js';
import { mulberry32 } from './maze.js';

const TIME_PRESETS = { dawn: 0.285, day: 0.5, dusk: 0.715, night: 0.02 };
const CYCLE_SECONDS = 480; // one full day when "cycle" is selected

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFrag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
  uniform float uStars, uTime, uMoon;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
    if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.55, clamp(-d.y * 3.0, 0.0, 1.0));
    // sun disc + halo
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 1200.0) * 6.0 + pow(sd, 16.0) * 0.28 + pow(sd, 3.0) * 0.06);
    // moon
    float md = max(dot(d, uMoonDir), 0.0);
    float moonDisc = smoothstep(0.9993, 0.9996, md);
    // crude crater shading
    vec3 mp = floor((d - uMoonDir) * 900.0);
    float craters = 0.75 + 0.25 * hash(mp);
    col += vec3(0.85, 0.88, 0.95) * moonDisc * craters * uMoon * 1.6;
    col += vec3(0.5, 0.6, 0.9) * pow(md, 300.0) * 0.25 * uMoon;
    // stars
    vec3 cell = floor(d * 220.0);
    float hs = hash(cell);
    vec3 f = fract(d * 220.0) - 0.5;
    float star = step(0.9965, hs) * smoothstep(0.32, 0.02, length(f));
    star *= 0.55 + 0.45 * sin(uTime * (2.0 + hs * 4.0) + hs * 100.0);
    col += vec3(star) * uStars * smoothstep(0.0, 0.25, d.y) * (0.6 + hash(cell + 1.0) * 0.8);
    gl_FragColor = vec4(col, 1.0);
  }`;

function lerp3(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** Everything that depends on the time of day, t in [0,1), 0 = midnight, 0.5 = noon. */
export function computeSky(t) {
  const ang = (t - 0.25) * Math.PI * 2;
  const sun = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.38).normalize();
  const e = sun.y;
  const dayF = smooth(-0.08, 0.28, e);
  const duskF = Math.exp(-Math.pow(e / 0.16, 2));
  const night = 1 - smooth(-0.22, 0.02, e);

  let zenith = lerp3([0.012, 0.016, 0.05], [0.2, 0.42, 0.9], dayF);
  zenith = zenith.map((v, i) => v + [0.22, 0.1, 0.18][i] * duskF * 0.45);
  let horizon = lerp3([0.05, 0.06, 0.11], [0.68, 0.8, 0.94], dayF);
  horizon = horizon.map((v, i) => v + [1.0, 0.42, 0.12][i] * duskF * 0.85);

  const sunColor = lerp3([1.0, 0.45, 0.18], [1.0, 0.96, 0.88], smooth(0, 0.35, e)).map(v => v * (e > -0.06 ? 1 : 0));
  const moon = new THREE.Vector3(-sun.x, -sun.y, sun.z * 0.6).normalize();

  let keyDir, keyColor, keyIntensity;
  if (e > -0.04) { keyDir = sun; keyColor = sunColor; keyIntensity = smooth(-0.04, 0.3, e) * 2.6; }
  else { keyDir = moon; keyColor = [0.55, 0.65, 1.0]; keyIntensity = 0.45 * smooth(-0.04, -0.15, e); }

  const hemiSky = lerp3([0.08, 0.1, 0.2], [0.55, 0.7, 1.0], dayF).map((v, i) => v + [0.4, 0.15, 0.05][i] * duskF * 0.5);
  const hemiGround = lerp3([0.03, 0.03, 0.04], [0.28, 0.24, 0.16], dayF);
  const hemiIntensity = 0.45 + dayF * 1.1;
  const fog = horizon.map((v, i) => v * (0.55 + 0.35 * dayF) + [0.02, 0.03, 0.02][i]);
  const cloudTint = lerp3([0.10, 0.12, 0.2], [1, 1, 1], dayF).map((v, i) => v + [0.9, 0.35, 0.1][i] * duskF * 0.55);
  return { sun, moon, e, dayF, duskF, night, zenith, horizon, sunColor, keyDir, keyColor, keyIntensity, hemiSky, hemiGround, hemiIntensity, fog, cloudTint };
}

export class Sky {
  constructor(scene, renderer, { mode = 'dusk', shadows = true, seed = 1 } = {}) {
    this.scene = scene;
    this.mode = mode;
    this.time = TIME_PRESETS[mode] ?? 0.715;
    if (mode === 'cycle') this.time = 0.3;
    this.group = new THREE.Group();
    scene.add(this.group);

    // dome
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunColor: { value: new THREE.Color() }, uStars: { value: 0 }, uTime: { value: 0 }, uMoon: { value: 0 },
    };
    const domeMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 24), domeMat);
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // clouds
    const rand = mulberry32(seed + 99);
    this.cloudTex = [makeCloudTexture(seed + 1), makeCloudTexture(seed + 2), makeCloudTexture(seed + 3)];
    this.clouds = new THREE.Group();
    this.cloudSprites = [];
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.cloudTex[i % 3], transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
      const s = new THREE.Sprite(mat);
      const a = rand() * Math.PI * 2, r = 180 + rand() * 420;
      s.position.set(Math.cos(a) * r, 110 + rand() * 120 + r * 0.12, Math.sin(a) * r);
      const sc = 90 + rand() * 170;
      s.scale.set(sc, sc * (0.45 + rand() * 0.25), 1);
      s.userData.drift = 0.6 + rand() * 1.2;
      this.clouds.add(s); this.cloudSprites.push(s);
    }
    this.group.add(this.clouds);

    // lights
    this.key = new THREE.DirectionalLight(0xffffff, 1);
    this.key.castShadow = shadows;
    const sc = this.key.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 400;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.05;
    this.keyTarget = new THREE.Object3D();
    this.key.target = this.keyTarget;
    this.group.add(this.key, this.keyTarget);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.group.add(this.hemi);
    scene.fog = new THREE.Fog(0x000000, 24, 190);
    this.apply(0, new THREE.Vector3());
  }

  setShadows(on) { this.key.castShadow = on; }

  /** Switch preset (dawn/day/dusk/night/cycle) at runtime, e.g. from the lobby. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'cycle') this.time = 0.3; else this.time = TIME_PRESETS[mode] ?? 0.715;
  }

  apply(elapsed, playerPos) {
    if (this.mode === 'cycle') this.time = (0.3 + elapsed / CYCLE_SECONDS) % 1;
    const s = computeSky(this.time);
    this.state = s;
    const u = this.uniforms;
    u.uZenith.value.setRGB(...s.zenith); u.uHorizon.value.setRGB(...s.horizon);
    u.uSunDir.value.copy(s.sun); u.uMoonDir.value.copy(s.moon);
    u.uSunColor.value.setRGB(...s.sunColor);
    u.uStars.value = s.night; u.uMoon.value = s.night; u.uTime.value = elapsed;

    this.key.color.setRGB(...s.keyColor); this.key.intensity = s.keyIntensity;
    this.key.position.copy(playerPos).addScaledVector(s.keyDir, 160);
    this.keyTarget.position.copy(playerPos);
    this.hemi.color.setRGB(...s.hemiSky); this.hemi.groundColor.setRGB(...s.hemiGround); this.hemi.intensity = s.hemiIntensity;
    this.scene.fog.color.setRGB(...s.fog);
    this.scene.background = null;

    this.dome.position.copy(playerPos);
    this.clouds.position.set(playerPos.x, 0, playerPos.z);
    const tint = new THREE.Color(...s.cloudTint);
    for (const c of this.cloudSprites) {
      c.material.color.copy(tint);
      c.position.x += c.userData.drift * 0.016; // slow drift
      if (c.position.x > 650) c.position.x -= 1300;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.dome.geometry.dispose(); this.dome.material.dispose();
    for (const c of this.cloudSprites) c.material.dispose();
    for (const t of this.cloudTex) t.dispose();
    this.key.dispose(); this.hemi.dispose();
    this.scene.fog = null;
  }
}
