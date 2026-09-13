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
 * Growing-tree maze: from a frontier of carved cells, pick the newest cell some of the
 * time (long corridors) and a random one otherwise (lots of forks and side passages).
 * Everyone starts in a 3x3 plaza in the dead centre; the exit is the boundary cell
 * farthest from it by path length.
 *
 * @param {{w:number,h:number,braid:number,seed:number}} opts
 *   braid: 0..1 fraction of dead ends that get an extra opening (loops).
 */
export function generateMaze({ w, h, braid = 0.1, seed = 1 }) {
  const rand = mulberry32(seed);
  const walls = new Uint8Array(w * h).fill(N | E | S | W);
  const idx = (x, y) => y * w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const carve = (x, y, d) => { walls[idx(x, y)] &= ~d.bit; walls[idx(x + d.dx, y + d.dy)] &= ~d.opp; };

  const start = { x: w >> 1, y: h >> 1 };
  const visited = new Uint8Array(w * h);

  // --- central plaza (3x3) where everyone spawns; it has several ways out
  const plaza = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = start.x + dx, y = start.y + dy;
    if (!inside(x, y)) continue;
    plaza.push({ x, y }); visited[idx(x, y)] = 1;
  }
  for (const c of plaza) for (const d of [DIRS[1], DIRS[2]]) {
    const nx = c.x + d.dx, ny = c.y + d.dy;
    if (inside(nx, ny) && Math.abs(nx - start.x) <= 1 && Math.abs(ny - start.y) <= 1) carve(c.x, c.y, d);
  }

  // --- growing tree, seeded from the whole plaza edge
  const frontier = plaza.slice();
  const NEWEST = 0.45; // lower = more branching
  while (frontier.length) {
    const i = rand() < NEWEST ? frontier.length - 1 : (rand() * frontier.length) | 0;
    const cur = frontier[i];
    const options = [];
    for (const d of DIRS) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (inside(nx, ny) && !visited[idx(nx, ny)]) options.push(d);
    }
    if (!options.length) { frontier.splice(i, 1); continue; }
    const d = options[(rand() * options.length) | 0];
    carve(cur.x, cur.y, d);
    const nx = cur.x + d.dx, ny = cur.y + d.dy;
    visited[idx(nx, ny)] = 1;
    frontier.push({ x: nx, y: ny });
  }

  // --- braiding: open some dead ends to create loops
  if (braid > 0) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (openings(walls[idx(x, y)]) !== 1 || rand() > braid) continue;
      const candidates = DIRS.filter(d => (walls[idx(x, y)] & d.bit) && inside(x + d.dx, y + d.dy));
      if (!candidates.length) continue;
      carve(x, y, candidates[(rand() * candidates.length) | 0]);
    }
  }

  // --- BFS from start; exit = farthest boundary cell
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
    if (!onEdge) continue;
    const d = fromStart.dist[idx(x, y)];
    if (d > best) { best = d; end = { x, y }; }
  }
  const edgeDirs = DIRS.filter(d => !inside(end.x + d.dx, end.y + d.dy));
  const exitDir = edgeDirs[(rand() * edgeDirs.length) | 0];
  walls[idx(end.x, end.y)] &= ~exitDir.bit;

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
