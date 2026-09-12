// Builds the 3D hedge maze: walls, ground, clutter, torches, signs, exit.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';
import { mulberry32, N, E, S, W, DIRS, openings } from './maze.js';

export const CELL = 7;      // cell pitch
export const THICK = 1.8;   // hedge thickness
const TILE = 4;             // world units per hedge texture repeat
const LIGHT_POOL = 8;       // point lights shared between the nearest torches

const flameVert = /* glsl */`
  varying vec2 vUv; varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = fract(sin(dot(vec2(modelMatrix[3][0], modelMatrix[3][2]), vec2(12.9898, 78.233))) * 43758.5453);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const flameFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv; varying float vSeed; uniform float uTime;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float t = uTime * 2.4 + vSeed * 40.0;
    float n = noise(vec2(vUv.x * 3.0 + vSeed * 9.0, vUv.y * 3.5 - t)) * 0.7 + noise(vec2(vUv.x * 7.0, vUv.y * 8.0 - t * 1.7)) * 0.3;
    float w = 0.42 * (1.0 - vUv.y) + 0.04;
    float x = vUv.x - 0.5 + (n - 0.5) * 0.35 * vUv.y;
    float body = 1.0 - smoothstep(w * 0.45, w, abs(x));
    float tip = 1.0 - smoothstep(0.55, 1.0, vUv.y + (n - 0.5) * 0.35);
    float base = smoothstep(0.0, 0.12, vUv.y);
    float a = body * tip * base;
    vec3 col = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.35), pow(a, 1.5));
    col = mix(col, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, a) * (1.0 - vUv.y));
    gl_FragColor = vec4(col * 2.2 * a, a);
  }`;

const emberVert = /* glsl */`
  attribute vec3 seed; varying float vLife; uniform float uTime;
  void main() {
    float life = fract(uTime * (0.25 + seed.z * 0.35) + seed.x);
    vLife = life;
    vec3 p = position;
    p.y += life * (2.5 + seed.y * 3.0);
    p.x += sin(life * 9.0 + seed.x * 30.0) * 0.25 * life;
    p.z += cos(life * 7.0 + seed.y * 30.0) * 0.25 * life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (1.0 - life) * 90.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const emberFrag = /* glsl */`
  precision highp float; varying float vLife;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = (1.0 - vLife) * (1.0 - d * 2.0);
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 2.0, a);
  }`;

function valueNoiseFactory(seed) {
  const r = mulberry32(seed);
  const table = new Float32Array(512 * 512 / 64); // coarse hash table
  for (let i = 0; i < table.length; i++) table[i] = r();
  const h = (x, y) => table[((x * 73856093) ^ (y * 19349663)) & (table.length - 1) >>> 0];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {ReturnType<import('./maze.js').generateMaze>} maze
   * @param {{hedge:number, torches:number, signs:number, honest:number}} settings
   */
  constructor(scene, maze, settings) {
    this.scene = scene; this.maze = maze; this.settings = settings;
    this.rand = mulberry32(maze.seed ^ 0x9e3779b9);
    this.root = new THREE.Group();
    this.hedgeH = settings.hedge;
    this.torches = [];
    this.flames = [];
    this.lights = [];
    this.disposables = [];
    this.time = 0;
    this._lightTimer = 0;
    this.build();
    scene.add(this.root);
  }

  // ------------------------------------------------------------ helpers
  cellCenter(cx, cy) { return new THREE.Vector3(cx * CELL + CELL / 2, 0, cy * CELL + CELL / 2); }
  cellAt(x, z) { return { cx: Math.floor(x / CELL), cy: Math.floor(z / CELL) }; }
  isInside(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.maze.w && cy < this.maze.h; }
  isOutside(x, z) { const c = this.cellAt(x, z); return !this.isInside(c.cx, c.cy); }
  wall(cx, cy) { return this.maze.walls[cy * this.maze.w + cx]; }

  /** Inner surface of the wall on side `dir` of cell (cx,cy). */
  face(cx, cy, dir) {
    const c = this.cellCenter(cx, cy);
    const half = CELL / 2 - THICK / 2;
    const len = CELL - THICK;
    switch (dir.bit) {
      case N: return { x: c.x, z: c.z - half, nx: 0, nz: 1, tx: 1, tz: 0, len };
      case S: return { x: c.x, z: c.z + half, nx: 0, nz: -1, tx: 1, tz: 0, len };
      case E: return { x: c.x + half, z: c.z, nx: -1, nz: 0, tx: 0, tz: 1, len };
      default: return { x: c.x - half, z: c.z, nx: 1, nz: 0, tx: 0, tz: 1, len };
    }
  }

  spawnPoint(index, count) {
    const s = this.maze.start;
    const c = this.cellCenter(s.x, s.y);
    const a = (index / Math.max(1, count)) * Math.PI * 2;
    const r = count > 1 ? 1.3 : 0;
    // face towards the open side of the start cell
    const w = this.wall(s.x, s.y);
    const open = DIRS.find(d => !(w & d.bit)) || DIRS[0];
    const yaw = Math.atan2(-open.dx, -open.dy); // camera looks down -Z at yaw 0
    return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, yaw };
  }

  // ------------------------------------------------------------ build
  build() {
    const { w, h } = this.maze;
    this.tex = {
      hedge: T.makeHedgeTextures(this.maze.seed),
      ground: T.makeGroundTexture(this.maze.seed + 1),
      bark: T.makeBarkTexture(this.maze.seed + 2),
      wood: T.makeWoodTexture(this.maze.seed + 3),
      stone: T.makeStoneTexture(this.maze.seed + 4),
      vines: [T.makeVineTexture(this.maze.seed + 10), T.makeVineTexture(this.maze.seed + 11), T.makeVineTexture(this.maze.seed + 12)],
      moss: T.makeBlobTexture(this.maze.seed + 20, { hue: 95, sat: 45, light: 30 }),
      dirt: T.makeBlobTexture(this.maze.seed + 21, { hue: 28, sat: 35, light: 18, speckle: true }),
      tuft: T.makeTuftTexture(this.maze.seed + 22),
      leaf: T.makeLeafTexture(),
    };
    for (const k in this.tex) { const v = this.tex[k]; if (Array.isArray(v)) v.forEach(t => this.disposables.push(t)); else if (v.map) { this.disposables.push(v.map, v.bump); } else this.disposables.push(v); }

    this.collectFaces();
    this.buildHedges();
    this.buildGround();
    this.buildClutter();
    this.buildTorches();
    this.buildSigns();
    this.buildExit();
  }

  collectFaces() {
    const { w, h } = this.maze;
    this.faces = [];
    this.junctions = []; this.deadEnds = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = this.wall(x, y);
      for (const d of DIRS) if (c & d.bit) this.faces.push({ cx: x, cy: y, dir: d, ...this.face(x, y, d) });
      const o = openings(c);
      if (o >= 3) this.junctions.push({ x, y });
      if (o === 1) this.deadEnds.push({ x, y });
    }
  }

  buildHedges() {
    const { w, h, walls } = this.maze;
    const rand = this.rand;
    const runs = [];
    // horizontal lines z = j*CELL
    for (let j = 0; j <= h; j++) {
      let x = 0;
      while (x < w) {
        const has = j < h ? (walls[j * w + x] & N) : (walls[(h - 1) * w + x] & S);
        if (!has) { x++; continue; }
        let x2 = x;
        while (x2 < w && (j < h ? (walls[j * w + x2] & N) : (walls[(h - 1) * w + x2] & S))) x2++;
        runs.push({ horizontal: true, a: x * CELL, b: x2 * CELL, line: j * CELL });
        x = x2;
      }
    }
    for (let i = 0; i <= w; i++) {
      let y = 0;
      while (y < h) {
        const has = i < w ? (walls[y * w + i] & W) : (walls[y * w + w - 1] & E);
        if (!has) { y++; continue; }
        let y2 = y;
        while (y2 < h && (i < w ? (walls[y2 * w + i] & W) : (walls[y2 * w + w - 1] & E))) y2++;
        runs.push({ horizontal: false, a: y * CELL, b: y2 * CELL, line: i * CELL });
        y = y2;
      }
    }
    this.runs = runs;

    const geos = [];
    const col = new THREE.Color();
    const tmp = new THREE.Vector3();
    for (const r of runs) {
      const len = r.b - r.a + THICK - 0.02;
      const H = this.hedgeH * (0.93 + rand() * 0.1);
      const g = r.horizontal ? new THREE.BoxGeometry(len, H, THICK) : new THREE.BoxGeometry(THICK, H, len);
      if (r.horizontal) g.translate((r.a + r.b) / 2, H / 2, r.line); else g.translate(r.line, H / 2, (r.a + r.b) / 2);
      // world-space UVs (triplanar-ish) + random offset so every run starts at a different spot
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      const ou = rand() * 10, ov = rand() * 10;
      const colors = new Float32Array(pos.count * 3);
      const tint = [0.86 + rand() * 0.28, 0.86 + rand() * 0.28, 0.86 + rand() * 0.28];
      // correlate a bit so it's a green shift, not rainbow
      const m = (tint[0] + tint[1] + tint[2]) / 3; for (let k = 0; k < 3; k++) tint[k] = m * 0.6 + tint[k] * 0.4;
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i);
        const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
        if (nx > 0.5) uv.setXY(i, tmp.z / TILE + ou, tmp.y / TILE + ov);
        else if (ny > 0.5) uv.setXY(i, tmp.x / TILE + ou, tmp.z / TILE + ov);
        else uv.setXY(i, tmp.x / TILE + ou, tmp.y / TILE + ov);
        // darker + browner near the ground, lighter at the top
        const f = Math.min(1, tmp.y / 7);
        const top = Math.min(1, Math.max(0, (tmp.y - H * 0.75) / (H * 0.25)));
        col.setRGB(tint[0] * (0.62 + 0.38 * f) * (1 + 0.12 * top) * (f < 1 ? 1.05 : 1),
          tint[1] * (0.55 + 0.45 * f) * (1 + 0.12 * top),
          tint[2] * (0.45 + 0.55 * f) * (1 + 0.10 * top));
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex.hedge.map, bumpMap: this.tex.hedge.bump, bumpScale: 0.6,
      vertexColors: true, roughness: 0.95, metalness: 0,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    this.hedgeMesh = mesh;
    this.disposables.push(merged, mat);
  }

  buildGround() {
    const { w, h } = this.maze;
    const margin = 90;
    const W = w * CELL + margin * 2, H = h * CELL + margin * 2;
    const segX = Math.min(200, Math.ceil(W / 3)), segY = Math.min(200, Math.ceil(H / 3));
    const g = new THREE.PlaneGeometry(W, H, segX, segY);
    g.rotateX(-Math.PI / 2);
    g.translate(w * CELL / 2, 0, h * CELL / 2);
    const noise = valueNoiseFactory(this.maze.seed + 77);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n1 = noise(x * 0.06, z * 0.06), n2 = noise(x * 0.2 + 50, z * 0.2 + 50);
      const inside = x > -2 && z > -2 && x < w * CELL + 2 && z < h * CELL + 2;
      // outside the maze becomes a greener meadow
      const grass = inside ? 0 : Math.min(1, (Math.max(-x, -z, x - w * CELL, z - h * CELL)) / 12);
      let r = 0.75 + n1 * 0.5, gg = 0.72 + n1 * 0.45 + n2 * 0.15, b = 0.7 + n1 * 0.4;
      r = r * (1 - grass) + 0.55 * grass; gg = gg * (1 - grass) + 1.05 * grass; b = b * (1 - grass) + 0.45 * grass;
      colors[i * 3] = r; colors[i * 3 + 1] = gg; colors[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 9, pos.getZ(i) / 9);
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.ground, vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.disposables.push(g, mat);
  }

  /** Generic instanced helper. */
  instanced(geometry, material, count, placer, { shadows = false } = {}) {
    if (count <= 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
    const c = new THREE.Color();
    let useColor = false;
    for (let i = 0; i < count; i++) {
      s.set(1, 1, 1); e.set(0, 0, 0); c.set(0xffffff);
      const r = placer(i, p, e, s, c);
      if (r === false) { s.set(0, 0, 0); }
      q.setFromEuler(e);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (r && r.color) { mesh.setColorAt(i, c); useColor = true; }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (useColor) mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
    this.disposables.push(geometry, material);
    return mesh;
  }

  buildClutter() {
    const rand = this.rand;
    const { w, h } = this.maze;
    const faces = this.faces;
    const pick = () => faces[(rand() * faces.length) | 0];
    const plane = new THREE.PlaneGeometry(1, 1);
    const yawOf = (f) => Math.atan2(f.nx, f.nz);

    // --- vines climbing the hedges
    for (let v = 0; v < 3; v++) {
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.vines[v], transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
      const count = Math.round(faces.length * 0.14);
      this.instanced(plane.clone(), mat, count, (i, p, e, s) => {
        const f = pick();
        const along = (rand() - 0.5) * (f.len - 3);
        const hgt = 5 + rand() * 7;
        const base = rand() < 0.6 ? 0 : rand() * Math.min(this.hedgeH - hgt - 1, 14);
        p.set(f.x + f.tx * along + f.nx * 0.07, base + hgt / 2, f.z + f.tz * along + f.nz * 0.07);
        e.set(0, yawOf(f), 0);
        s.set((rand() < 0.5 ? -1 : 1) * hgt * 0.26, hgt, 1);
      });
    }
    // --- moss patches low on walls
    {
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.moss, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
      this.instanced(plane.clone(), mat, Math.round(faces.length * 0.5), (i, p, e, s) => {
        const f = pick();
        const along = (rand() - 0.5) * (f.len - 2), sz = 1.2 + rand() * 2.4;
        p.set(f.x + f.tx * along + f.nx * 0.05, 0.2 + rand() * 1.8 + sz * 0.3, f.z + f.tz * along + f.nz * 0.05);
        e.set(0, yawOf(f), rand() * 6.28);
        s.set(sz, sz * (0.6 + rand() * 0.5), 1);
      });
    }
    // --- dirt patches on the ground
    {
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.dirt, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
      this.instanced(plane.clone(), mat, Math.round(w * h * 1.6), (i, p, e, s) => {
        const sz = 2 + rand() * 4;
        p.set(rand() * w * CELL, 0.03, rand() * h * CELL);
        e.set(-Math.PI / 2, 0, rand() * 6.28);
        s.set(sz, sz * (0.6 + rand() * 0.6), 1);
      });
    }
    // --- grass tufts near the base of walls (two crossed planes)
    {
      const a = new THREE.PlaneGeometry(1, 1); const b = a.clone().rotateY(Math.PI / 2);
      const cross = mergeGeometries([a, b]); cross.translate(0, 0.5, 0);
      a.dispose(); b.dispose();
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.tuft, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
      this.instanced(cross, mat, Math.round(faces.length * 0.7), (i, p, e, s, c) => {
        const f = pick();
        const along = (rand() - 0.5) * (f.len - 1), out = 0.35 + rand() * 1.2;
        const sz = 0.7 + rand() * 0.9;
        p.set(f.x + f.tx * along + f.nx * out, 0, f.z + f.tz * along + f.nz * out);
        e.set(0, rand() * 6.28, 0); s.set(sz, sz, sz);
        c.setHSL(0.22 + rand() * 0.08, 0.5, 0.35 + rand() * 0.3);
        return { color: true };
      });
    }
    // --- fallen leaves
    {
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.leaf, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
      const palette = [[0.08, 0.8, 0.4], [0.05, 0.8, 0.35], [0.12, 0.7, 0.45], [0.02, 0.6, 0.3], [0.25, 0.4, 0.3]];
      this.instanced(plane.clone(), mat, Math.round(w * h * 14), (i, p, e, s, c) => {
        const near = rand() < 0.7;
        if (near) { const f = pick(); const along = (rand() - 0.5) * f.len, out = 0.1 + rand() * 2.2; p.set(f.x + f.tx * along + f.nx * out, 0.02 + rand() * 0.03, f.z + f.tz * along + f.nz * out); }
        else p.set(rand() * w * CELL, 0.02, rand() * h * CELL);
        e.set(-Math.PI / 2 + (rand() - .5) * 0.3, 0, rand() * 6.28);
        const sz = 0.22 + rand() * 0.22; s.set(sz, sz, 1);
        const pl = palette[(rand() * palette.length) | 0]; c.setHSL(pl[0] + (rand() - .5) * 0.04, pl[1], pl[2] + (rand() - .5) * 0.15);
        return { color: true };
      });
    }
    // --- rocks
    {
      const geo = new THREE.DodecahedronGeometry(1, 0);
      const mat = new THREE.MeshStandardMaterial({ map: this.tex.stone, roughness: 0.95 });
      this.instanced(geo, mat, Math.round(faces.length * 0.22), (i, p, e, s, c) => {
        const f = pick();
        const along = (rand() - 0.5) * (f.len - 1), out = 0.5 + rand() * 1.4;
        const sz = 0.15 + rand() * 0.4;
        p.set(f.x + f.tx * along + f.nx * out, sz * 0.5, f.z + f.tz * along + f.nz * out);
        e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28); s.set(sz * (0.7 + rand() * 0.8), sz * 0.7, sz * (0.7 + rand() * 0.8));
        c.setHSL(0.08, 0.05 + rand() * 0.1, 0.35 + rand() * 0.3);
        return { color: true };
      }, { shadows: true });
    }
    // --- mushrooms (stems + caps)
    {
      const count = Math.round(w * h * 0.7);
      const positions = [];
      for (let i = 0; i < count; i++) {
        const f = pick(); const along = (rand() - 0.5) * (f.len - 1), out = 0.4 + rand() * 0.8;
        positions.push({ x: f.x + f.tx * along + f.nx * out, z: f.z + f.tz * along + f.nz * out, sz: 0.07 + rand() * 0.14, hue: rand() < 0.5 ? 0.0 : 0.08, l: 0.3 + rand() * 0.3 });
      }
      const stem = new THREE.CylinderGeometry(0.35, 0.45, 1, 7); stem.translate(0, 0.5, 0);
      const cap = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.55, 1); cap.translate(0, 1, 0);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
      const capMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
      this.instanced(stem, stemMat, count, (i, p, e, s) => { const m = positions[i]; p.set(m.x, 0, m.z); s.set(m.sz, m.sz * 1.6, m.sz); });
      this.instanced(cap, capMat, count, (i, p, e, s, c) => { const m = positions[i]; p.set(m.x, 0, m.z); s.set(m.sz, m.sz * 1.6, m.sz); c.setHSL(m.hue, 0.7, m.l); return { color: true }; });
    }
    plane.dispose();
  }

  buildTorches() {
    const rand = this.rand;
    const { w, h } = this.maze;
    const pct = this.settings.torches / 100;
    const count = Math.round(w * h * 0.28 * pct);
    if (!count) return;
    const faces = this.faces.slice();
    // shuffle & take
    for (let i = faces.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [faces[i], faces[j]] = [faces[j], faces[i]]; }
    const chosen = faces.slice(0, Math.min(count, faces.length));
    const Y = 3.4;
    this.torches = chosen.map(f => ({ x: f.x + f.nx * 0.55, y: Y, z: f.z + f.nz * 0.55, nx: f.nx, nz: f.nz, phase: rand() * 100 }));

    // holder: angled wooden stick + iron ring + stone bowl (instanced)
    const stick = new THREE.CylinderGeometry(0.07, 0.1, 1.5, 6);
    const stickMat = new THREE.MeshStandardMaterial({ map: this.tex.bark, roughness: 0.9 });
    this.instanced(stick, stickMat, this.torches.length, (i, p, e, s) => {
      const t = this.torches[i];
      p.set(t.x - t.nx * 0.25, t.y - 0.55, t.z - t.nz * 0.25);
      // tilt outwards from the wall
      e.set(0.35 * t.nz, 0, -0.35 * t.nx);
    }, { shadows: true });
    const bowl = new THREE.CylinderGeometry(0.28, 0.14, 0.32, 8, 1, true);
    const bowlMat = new THREE.MeshStandardMaterial({ map: this.tex.stone, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide, color: 0x555555 });
    this.instanced(bowl, bowlMat, this.torches.length, (i, p) => { const t = this.torches[i]; p.set(t.x, t.y + 0.1, t.z); });
    const bracket = new THREE.BoxGeometry(0.5, 0.12, 0.12);
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.6 });
    this.instanced(bracket, bracketMat, this.torches.length, (i, p, e) => { const t = this.torches[i]; p.set(t.x - t.nx * 0.42, t.y - 1.05, t.z - t.nz * 0.42); e.set(0, Math.atan2(t.nx, t.nz) + Math.PI / 2, 0); });

    // flames
    this.flameMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: flameVert, fragmentShader: flameFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const flameGeo = new THREE.PlaneGeometry(1.1, 1.9); flameGeo.translate(0, 0.95, 0);
    this.disposables.push(this.flameMat, flameGeo);
    for (const t of this.torches) {
      const m = new THREE.Mesh(flameGeo, this.flameMat);
      m.position.set(t.x, t.y + 0.15, t.z);
      m.frustumCulled = false;
      this.root.add(m); this.flames.push(m);
    }
    // embers (one Points for all torches)
    const per = 10, n = this.torches.length * per;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
    for (let i = 0; i < this.torches.length; i++) for (let k = 0; k < per; k++) {
      const j = (i * per + k) * 3; const t = this.torches[i];
      pos[j] = t.x; pos[j + 1] = t.y + 0.4; pos[j + 2] = t.z; seed[j] = rand(); seed[j + 1] = rand(); seed[j + 2] = rand();
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); eg.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    this.emberMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: emberVert, fragmentShader: emberFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const embers = new THREE.Points(eg, this.emberMat); embers.frustumCulled = false;
    this.root.add(embers); this.disposables.push(eg, this.emberMat);

    // shared point light pool
    for (let i = 0; i < Math.min(LIGHT_POOL, this.torches.length); i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 22, 1.6);
      this.root.add(l); this.lights.push(l);
    }
  }

  makeSignGroup(text, { arrow = null, glow = false } = {}) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.8, 7), new THREE.MeshStandardMaterial({ map: this.tex.bark, roughness: 0.9 }));
    post.position.y = 1.4; post.castShadow = true; g.add(post);
    const texT = T.makeSignTexture(text, { glow });
    this.disposables.push(texT);
    const boardMat = new THREE.MeshStandardMaterial({ map: texT, roughness: 0.8, emissive: glow ? 0x4cff80 : 0x000000, emissiveMap: glow ? texT : null, emissiveIntensity: glow ? 1.2 : 0 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), boardMat);
    const boardBack = board.clone(); boardBack.rotation.y = Math.PI;
    board.position.set(0, 1.75, 0.06); boardBack.position.set(0, 1.75, -0.06);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.9, 0.1), new THREE.MeshStandardMaterial({ map: this.tex.wood }));
    backing.position.y = 1.75; backing.castShadow = true;
    g.add(board, boardBack, backing);
    if (arrow) {
      // pointing plank: rectangle + tip, lying in the plane that contains the arrow direction
      const shape = new THREE.Shape();
      shape.moveTo(-0.9, -0.2); shape.lineTo(0.8, -0.2); shape.lineTo(1.3, 0); shape.lineTo(0.8, 0.2); shape.lineTo(-0.9, 0.2); shape.closePath();
      const pg = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      pg.translate(0.2, 0, -0.04);
      const plank = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: this.tex.wood, roughness: 0.85 }));
      plank.castShadow = true;
      // rotate about Y so local +X points along (dx,dz)
      plank.rotation.y = Math.atan2(-arrow.dy, arrow.dx);
      plank.position.y = 2.45;
      g.add(plank);
      this.disposables.push(pg);
    }
    return g;
  }

  buildSigns() {
    const rand = this.rand;
    const { w, h, toExit, start, end } = this.maze;
    const idx = (x, y) => y * w + x;
    // --- hint signs at junctions
    const cand = this.junctions.filter(j => !(j.x === start.x && j.y === start.y) && !(j.x === end.x && j.y === end.y));
    for (let i = cand.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
    const nSigns = Math.min(this.settings.signs, cand.length);
    const usedCells = new Set();
    for (let i = 0; i < nSigns; i++) {
      const c = cand[i]; usedCells.add(idx(c.x, c.y));
      const wl = this.wall(c.x, c.y);
      const open = DIRS.filter(d => !(wl & d.bit));
      let best = open[0], bd = Infinity;
      for (const d of open) { const dd = toExit[idx(c.x + d.dx, c.y + d.dy)]; if (dd >= 0 && dd < bd) { bd = dd; best = d; } }
      let dir = best;
      if (rand() * 100 > this.settings.honest) { const others = open.filter(d => d !== best); if (others.length) dir = others[(rand() * others.length) | 0]; }
      this.placeSign(c, this.makeSignGroup('EXIT', { arrow: dir }));
    }
    // --- flavour signs
    const phrases = ['LOST?', 'TURN BACK', 'NOT THIS WAY', 'GOOD LUCK', 'KEEP GOING', 'ALMOST THERE?', 'NO REFUNDS', 'MIND THE HEDGE', 'BLINK TWICE', 'WHY?'];
    const nFlavour = Math.min(8, Math.round(w * h * 0.02));
    for (let i = 0; i < nFlavour; i++) {
      const isDead = rand() < 0.5 && this.deadEnds.length;
      const c = isDead ? this.deadEnds[(rand() * this.deadEnds.length) | 0] : { x: (rand() * w) | 0, y: (rand() * h) | 0 };
      if (usedCells.has(idx(c.x, c.y)) || (c.x === start.x && c.y === start.y)) continue;
      usedCells.add(idx(c.x, c.y));
      const text = isDead && rand() < 0.7 ? 'DEAD END' : phrases[(rand() * phrases.length) | 0];
      this.placeSign(c, this.makeSignGroup(text));
    }
    // --- START sign
    this.placeSign(start, this.makeSignGroup('START'), true);
  }

  /** Put a sign inside a cell, tucked against a wall if there is one. */
  placeSign(cell, group, corner = false) {
    const rand = this.rand;
    const wl = this.wall(cell.x, cell.y);
    const c = this.cellCenter(cell.x, cell.y);
    const walled = DIRS.filter(d => wl & d.bit);
    let x = c.x, z = c.z, yaw = rand() * Math.PI * 2;
    if (walled.length) {
      const d = walled[(rand() * walled.length) | 0];
      const f = this.face(cell.x, cell.y, d);
      x = f.x + f.nx * 0.9 + f.tx * (rand() - .5) * 2.5; z = f.z + f.nz * 0.9 + f.tz * (rand() - .5) * 2.5;
      yaw = Math.atan2(f.nx, f.nz) + (rand() - .5) * 0.8; // board faces away from the wall
    } else if (corner) { x += 2; z += 2; }
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    // the arrow plank must keep its world direction: undo the group yaw on it
    for (const ch of group.children) if (ch.geometry && ch.geometry.type === 'ExtrudeGeometry') ch.rotation.y -= yaw;
    this.root.add(group);
    this.disposables.push(...group.children.map(m => m.geometry), ...group.children.map(m => m.material));
  }

  buildExit() {
    const { end, exitDir } = this.maze;
    const c = this.cellCenter(end.x, end.y);
    const gx = c.x + exitDir.dx * CELL / 2, gz = c.z + exitDir.dy * CELL / 2;
    const yaw = Math.atan2(exitDir.dx, exitDir.dy);
    const g = new THREE.Group();
    g.position.set(gx, 0, gz); g.rotation.y = yaw;
    const stone = new THREE.MeshStandardMaterial({ map: this.tex.stone, roughness: 0.9, color: 0x9a9a9a });
    const pw = 0.7, ph = 6.5, gap = CELL - THICK;
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), stone);
      p.position.set(sx * (gap / 2 - pw / 2 + 0.05), ph / 2, 0); p.castShadow = true; g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(gap + 0.2, 0.8, 1.0), stone);
    beam.position.y = ph + 0.3; beam.castShadow = true; g.add(beam);
    const texT = T.makeSignTexture('EXIT', { glow: true });
    const signMat = new THREE.MeshStandardMaterial({ map: texT, emissive: 0x66ff99, emissiveMap: texT, emissiveIntensity: 1.6, roughness: 0.6 });
    for (const side of [1, -1]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), signMat);
      s.position.set(0, ph + 0.3, side * 0.52); s.rotation.y = side > 0 ? 0 : Math.PI; g.add(s);
    }
    const light = new THREE.PointLight(0x66ff99, 30, 30, 1.5); light.position.set(0, 4, 0); g.add(light);
    // lanterns on the pillars
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xffd070, emissiveIntensity: 2 });
    for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampMat); l.position.set(sx * (gap / 2 - pw / 2 + 0.05), ph + 0.9, 0); g.add(l); }
    this.root.add(g);
    this.exitGroup = g;
    this.exitPos = new THREE.Vector3(gx, 0, gz);
    this.disposables.push(stone, signMat, lampMat, texT);
    // finish banner outside
    const banner = this.makeSignGroup('FINISH', { glow: true });
    banner.position.set(gx + exitDir.dx * 7, 0, gz + exitDir.dy * 7); banner.rotation.y = yaw + Math.PI;
    this.root.add(banner);
  }

  // ------------------------------------------------------------ runtime
  update(dt, playerPos) {
    this.time += dt;
    if (this.flameMat) this.flameMat.uniforms.uTime.value = this.time;
    if (this.emberMat) this.emberMat.uniforms.uTime.value = this.time;
    // billboard flames (cheap: only ones within ~60 units matter, but all is fine)
    if (this._camQuat) for (const f of this.flames) f.quaternion.copy(this._camQuat);
    // point-light pool: re-assign to nearest torches every 0.25s
    this._lightTimer -= dt;
    if (this._lightTimer <= 0 && this.lights.length) {
      this._lightTimer = 0.25;
      const px = playerPos.x, pz = playerPos.z;
      const sorted = this.torches.map(t => ({ t, d: (t.x - px) ** 2 + (t.z - pz) ** 2 })).sort((a, b) => a.d - b.d);
      for (let i = 0; i < this.lights.length; i++) {
        const t = sorted[i].t; const l = this.lights[i];
        l.position.set(t.x + t.nx * 0.3, t.y + 0.9, t.z + t.nz * 0.3); l.userData.t = t;
      }
      this.nearestTorchDist = Math.sqrt(sorted[0].d);
    }
    for (const l of this.lights) {
      const t = l.userData.t; if (!t) continue;
      const fl = Math.sin(this.time * 11 + t.phase) * 0.5 + Math.sin(this.time * 23.7 + t.phase * 2) * 0.3 + Math.sin(this.time * 3.1 + t.phase) * 0.2;
      l.intensity = 26 + fl * 6;
    }
    if (this.exitGroup) { const l = this.exitGroup.children.find(o => o.isPointLight); if (l) l.intensity = 26 + Math.sin(this.time * 2) * 6; }
  }

  setCameraQuaternion(q) { this._camQuat = q; }

  /** Resolve a circle (x,z,r) against nearby hedge boxes. Mutates pos. */
  collide(pos, r) {
    const { w, h } = this.maze;
    const T2 = THICK / 2;
    for (let iter = 0; iter < 3; iter++) {
      const cx = Math.floor(pos.x / CELL), cy = Math.floor(pos.z / CELL);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!this.isInside(x, y)) continue;
        const c = this.wall(x, y);
        const x0 = x * CELL, x1 = (x + 1) * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
        if (c & N) this.pushOut(pos, r, x0 - T2, z0 - T2, x1 + T2, z0 + T2);
        if (c & S) this.pushOut(pos, r, x0 - T2, z1 - T2, x1 + T2, z1 + T2);
        if (c & W) this.pushOut(pos, r, x0 - T2, z0 - T2, x0 + T2, z1 + T2);
        if (c & E) this.pushOut(pos, r, x1 - T2, z0 - T2, x1 + T2, z1 + T2);
      }
    }
  }

  pushOut(p, r, minX, minZ, maxX, maxZ) {
    const qx = Math.max(minX, Math.min(p.x, maxX)), qz = Math.max(minZ, Math.min(p.z, maxZ));
    let dx = p.x - qx, dz = p.z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 < 1e-8) {
      // inside the box: eject along the smallest penetration axis
      const l = p.x - minX, rr = maxX - p.x, t = p.z - minZ, b = maxZ - p.z;
      const m = Math.min(l, rr, t, b);
      if (m === l) p.x = minX - r; else if (m === rr) p.x = maxX + r; else if (m === t) p.z = minZ - r; else p.z = maxZ + r;
      return;
    }
    const d = Math.sqrt(d2), push = (r - d) / d;
    p.x += dx * push; p.z += dz * push;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); }
    });
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
  }
}
