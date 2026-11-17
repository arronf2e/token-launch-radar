// Token launch radar: the entrypoint (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot (/input/snapshot.json in the grader's container, or
// --input <file|dir> anywhere else), builds the ranked board with the peer-multiple model in
// lib/model.ts, and writes the hand-in into /output (or MAKEFUN_OUTPUT_DIR, or --output):
//
//   board.json    the ranked board the gate checks
//   data.js       the same board as window.RADAR, which the dashboard renders
//   dashboard/    this repository's dashboard, copied across
//   screenshots/  this repository's three screenshots, copied across
//   dossier.json  the judge's summary, written last with the vendored make.fun library,
//                 byte for byte what the scorer rebuilds from the files above
//
// Run it locally the way the kit suggests:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps, mirrored so a bad hand-in fails here first with a plainer message. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (no dotfiles, no nesting) into the output, returning names. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const pageFiles = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!pageFiles.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no stylesheet');
if (!pageFiles.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no script');

const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = statSync(join(out, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name}: ${bytes} bytes, over the 512 KiB cap`);
}

// Written last, from the finished output, exactly as the scorer rebuilds it.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${radar.stats.candidates} pre-token candidates, ` +
    `${radar.stats.live} live set aside, ${radar.stats.derivatives} derivatives excluded\n` +
    `token radar: board of ${board.length} rows, all ${snapshot.watchlist.length} watchlist protocols covered; ` +
    `wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images) and dossier.json in ${out}\n`,
);
