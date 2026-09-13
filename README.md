# Maze Runners

A peer-to-peer multiplayer 3D hedge-maze race for up to six players. Everyone is a giant
floating eyeball, the hedges are absurdly tall, and the first one out of the exit wins.

**Play it:** https://sburrell23.github.io/Maze-Runners/

## How it works

- **No server.** One player hosts; the others join with a five-letter room code. Connections are
  WebRTC data channels brokered by [PeerJS](https://peerjs.com/) (star topology, host relays state at 20 Hz).
- **Same maze everywhere.** The host picks the settings and a seed; every peer generates the identical
  maze locally. Only the seed and settings travel over the wire.
- **Everything is generated.** Hedge, ground, bark, vine, moss, sign, eyeball and cloud textures are painted
  onto canvases at load time. All sound and music is synthesised with the Web Audio API. There are no assets.
- **Solo mode.** "Solo run" skips the network entirely so you can test-drive mazes and settings alone.
- **Fog-of-war minimap** (a host setting). Only corridors you have walked or seen are drawn. Other eyeballs show up only inside explored cells.
- **Central start.** Everyone spawns in a 3x3 plaza in the dead centre; a growing-tree generator with a low "newest cell" bias gives the maze plenty of forks, and the exit is the boundary cell farthest away by path length.
- **Wheat fields forever.** One instanced, wind-swayed mesh of 16k wheat quads plus a golden ground and fog make the world outside the hedges look endless at almost no GPU cost.

## Lobby settings

| Setting        | What it does                                                     |
| -------------- | ---------------------------------------------------------------- |
| Width / Height | Maze size in cells (6 – 45)                                      |
| Hedge height   | How absurd the hedges are (10 – 90 units; you are 2.6 tall)      |
| Extra openings | Percentage of dead ends that get a second opening (loops)        |
| Hint signs     | Number of "EXIT →" signposts placed at junctions                 |
| Honest signs   | Chance a hint sign points the right way                          |
| Torches        | Wall-torch density                                               |
| Time of day    | Dawn, day, dusk, night, or a cycling sky (previewed live)        |
| Explorer minimap | Fog-of-war minimap on or off for every player                  |

## Controls

`WASD` / arrows move · mouse looks (click to capture) · `Shift` sprints · `Q`/`E` or arrows turn without
mouse capture · `M` mutes · `Esc` opens the in-race menu (sound, shadows, abandon or, for the host, end the race).

## Running locally

It is a static site with ES modules, so it needs to be served over HTTP:

```bash
python -m http.server 8765
```

Then open http://localhost:8765/. Two tabs in one browser are enough to test multiplayer.

## Deployment

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

## Layout

```
index.html        UI shell (menu, lobby, HUD)
css/style.css
js/main.js        state machine, lobby, race flow, render loop
js/net.js         PeerJS host / client wrapper
js/maze.js        seeded maze generation (recursive backtracker + braiding)
js/world.js       hedges, ground, clutter, torches, signs, exit, collisions
js/sky.js         sky shader, sun/moon/stars, clouds, lighting rig
js/textures.js    procedural canvas textures
js/eyeball.js     player avatar
js/player.js      first-person controller + remote interpolation
js/audio.js       Web Audio synthesis: ambience, SFX, generative music
```
