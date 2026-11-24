// Launch Radar: the token-radar-01 entry program (Node 22, standard library only).
//
// Reads the sealed snapshot (default /input/snapshot.json, or --input <file|dir>), prices every
// pre-token protocol with the peer model in lib/model.ts, and writes the run's outputs:
//   board.json    the ranked board the gate checks
//   data.js       the dashboard's dataset, written beside the page it renders
//   dashboard/    a copy of this repository's static page (no network)
//   screenshots/  a copy of this repository's three dashboard screenshots
//   dossier.json  the judge's summary, built with the vendored make.fun library
//
// Both grader runs must produce the same bytes, so nothing here reads a clock, a random source
// or the network. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, MODEL_VERSION, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX = 65_536;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && args[at + 1] !== undefined) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function die(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>`);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) die(`the model produced a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyTree(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
if (!pageFiles.includes('index.html')) die('dashboard/ holds no index.html');

const shots = copyTree(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
if (shots.length < 3 || shots.length > 4) die(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) die(`screenshots/${name}: names are letters, digits and . _ -`);
  const bytes = statSync(join(outDir, 'screenshots', name)).size;
  if (bytes > 524_288) die(`screenshots/${name}: ${bytes} bytes, over the 512 KiB cap`);
}

// Written last on purpose: the scorer rebuilds the dossier from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_MAX,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `launch radar: model ${MODEL_VERSION}; ${snapshot.protocols.length} protocols scanned, ${radar.stats.pre_token} record no token, ` +
    `${board.length} ranked (watchlist ${radar.stats.watchlist}/${radar.stats.watchlist} covered)\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json under ${outDir}\n`,
);
