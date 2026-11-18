// Solmar Heist v3 — a complete open-world crime game for make.fun's gta6-01 bounty.
// The game is this directory's game/ folder: plain static files a desktop browser loads
// offline (game/index.html and its ES modules, three.js vendored under game/vendor/three/,
// no network request at all). The program hands it in: it copies game/ and screenshots/
// from beside this file to /output and writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// What the player gets: an 8x8-block seeded city (Solmar Bay) at golden hour, on foot and
// by car, across fourteen named districts. Steal any parked or traffic car (E), drive with
// arcade physics plus NOS boost (Shift, with an overheat lockout if you hold it flat) and
// drift handling (Space), traffic that follows the road grid, pedestrians who stroll and
// flee gunfire, a 5-star wanted system with police cars that ram, on-foot cops that chase,
// shoot and bust you, and a police helicopter that orbits overhead with a sweeping
// spotlight at 4-5 stars, blocks heat decay while it watches, and calls in fresh ground
// units at 5 stars, ten story jobs from fixer Delia Voss (steal wheels, a timed courier
// run, a shakedown, a hot pursuit, a bank-vault heist ending at the marina, a Harbor
// Lights smuggle run, the Bayfront Grand Prix street race, the Delia Gambit finale
// against the SBPD evidence vault, a Harbor Heist crate run on the North Docks, and
// The Solmar Crown — the casino counting-room finale), three repeatable street-race
// circuits with two AI rivals each (beat both for a 1.5x prize), a repeatable taxi side
// job, a safehouse (heal + repair + NOS refill + save), a shop (armor, SMG ammo, NOS,
// shotgun, rifle), health and SMG pickups, four weapons (pistol, SMG, shotgun, rifle),
// a four-station synth car radio (Q cycles), a HUD with cash, health, armor, NOS,
// wanted stars, district, race status, a live clock and a minimap, synthesized WebAudio
// (engine, gunshots, sirens, radio, rotor, jingles — no audio files), and a save in
// localStorage that keeps cash, jobs and position between visits. Everything — city,
// characters, vehicles, names, story, art, sound — is original; nothing is from Rockstar.
// v3: +2 missions (10 total), street races with rivals, rifle, 4th radio station,
// +2 districts (14 total), casino landmark, reworked helicopter AI + NOS heat.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Screenshots: `node shots.mjs` (headless Chromium, see shots.json for the four scenes).
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others
// refuse an entry the scorer would refuse (more than 4 screenshots or one over 256 KiB; more
// than 993 files in game/ or 48 MiB of game files, in all, or a path under game/ over 1000
// bytes: game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
