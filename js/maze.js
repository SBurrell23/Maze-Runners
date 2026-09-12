// Deterministic maze generation. Every peer builds the exact same maze from
// the same seed, so only the seed + settings travel over the wire.

export const N = 1, E = 2, S = 4, W = 8;
export const DIRS = [
  { bit: N, dx: 0, dy: -1, opp: S },
  { bit: E, dx: 1, dy: 0, opp: W },
  { bit: S, dx: 0, dy: 1, opp: N },
  { bit: W, dx: -1, dy: 0, opp: E },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * @param {{w:number,h:number,braid:number,seed:number}} opts
 *   braid: 0..1 fraction of dead ends that get an extra opening (loops).
 */
export function generateMaze({ w, h, braid = 0.1, seed = 1 }) {
  const rand = mulberry32(seed);
  const walls = new Uint8Array(w * h).fill(N | E | S | W);
  const idx = (x, y) => y * w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  // --- recursive backtracker (iterative) ---
  const visited = new Uint8Array(w * h);
  const start = { x: 0, y: h - 1 };
  const stack = [start];
  visited[idx(start.x, start.y)] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = [];
    for (const d of DIRS) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (inside(nx, ny) && !visited[idx(nx, ny)]) options.push(d);
    }
    if (!options.length) { stack.pop(); continue; }
    // Slight bias towards continuing straight makes longer corridors.
    const d = options[Math.floor(rand() * options.length)];
    const nx = cur.x + d.dx, ny = cur.y + d.dy;
    walls[idx(cur.x, cur.y)] &= ~d.bit;
    walls[idx(nx, ny)] &= ~d.opp;
    visited[idx(nx, ny)] = 1;
    stack.push({ x: nx, y: ny });
  }

  // --- braiding: open some dead ends to create loops ---
  if (braid > 0) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = walls[idx(x, y)];
      const openings = 4 - ((c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1) + ((c >> 3) & 1));
      if (openings !== 1 || rand() > braid) continue;
      const candidates = DIRS.filter(d => (c & d.bit) && inside(x + d.dx, y + d.dy));
      if (!candidates.length) continue;
      const d = candidates[Math.floor(rand() * candidates.length)];
      walls[idx(x, y)] &= ~d.bit;
      walls[idx(x + d.dx, y + d.dy)] &= ~d.opp;
    }
  }

  // --- BFS from start to find distances; pick farthest boundary cell as exit ---
  const bfs = (sx, sy) => {
    const dist = new Int32Array(w * h).fill(-1);
    const parent = new Int32Array(w * h).fill(-1);
    const q = [idx(sx, sy)]; dist[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi]; const x = i % w, y = (i / w) | 0; const c = walls[i];
      for (const d of DIRS) {
        if (c & d.bit) continue;
        const j = idx(x + d.dx, y + d.dy);
        if (dist[j] !== -1) continue;
        dist[j] = dist[i] + 1; parent[j] = i; q.push(j);
      }
    }
    return { dist, parent };
  };
  const fromStart = bfs(start.x, start.y);
  let best = -1, end = { x: w - 1, y: 0 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (!onEdge || (x === start.x && y === start.y)) continue;
    const d = fromStart.dist[idx(x, y)];
    if (d > best) { best = d; end = { x, y }; }
  }
  // Open the outer wall at the exit cell, preferring a side that is on the boundary.
  let exitDir = null;
  const edgeDirs = DIRS.filter(d => !inside(end.x + d.dx, end.y + d.dy));
  exitDir = edgeDirs[Math.floor(rand() * edgeDirs.length)];
  walls[idx(end.x, end.y)] &= ~exitDir.bit;

  // Solution path (start -> end) and distance-to-exit map (for signs).
  const solution = [];
  for (let i = idx(end.x, end.y); i !== -1; i = fromStart.parent[i]) solution.push(i);
  solution.reverse();
  const toExit = bfs(end.x, end.y).dist;

  return { w, h, walls, start, end, exitDir, solution, toExit, distFromStart: fromStart.dist, seed, idx };
}

/** Number of open sides of a cell. */
export function openings(c) {
  return 4 - ((c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1) + ((c >> 3) & 1));
}
