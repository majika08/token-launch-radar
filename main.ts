// Token launch radar, model radar-2 (Node 22, standard library only, no build step).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits
// its value model on the snapshot's launched protocols, ranks every launch candidate the
// snapshot records no token for, and writes the run's outputs:
//   board.json    the ranked board (lib/model.ts builds it, and refuses a board the gate refuses)
//   data.js       the same board as a script the dashboard reads, written beside dashboard/
//   dashboard/    a copy of this repository's static page (index.html, app.css, app.js)
//   screenshots/  a copy of this repository's three dashboard screenshots
//   dossier.json  written last, with the vendored make.fun library, from the outputs above:
//                 the scorer rebuilds it from the same /output and compares bytes, so it is
//                 generated here, never hand-written.
//
// The run is deterministic: no clock, no randomness, no network. Two runs over the same
// snapshot write the same bytes, which the grader's double run requires.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const BOARD_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> (or --name=<value>) out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, excluded } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardBytes = `${JSON.stringify({ rows: board })}\n`;
if (Buffer.byteLength(boardBytes) > BOARD_MAX_BYTES) {
  process.stderr.write(`token radar: board.json would be ${Buffer.byteLength(boardBytes)} bytes, over the gate's 8 MiB\n`);
  process.exit(1);
}
writeFileSync(join(out, 'board.json'), boardBytes);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const size = statSync(join(out, 'screenshots', name)).size;
  if (size > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes, over the gate's ${SCREENSHOT_CAPS.max_bytes}\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

const cal = radar.calibration;
process.stdout.write(
  `token radar ${radar.model_version}: ${snapshot.protocols.length} protocols, calibrated on ${cal.sample_size} launched ` +
    `(global multiple ${cal.global_multiple}, size curve log(mcap) = ${cal.fit_intercept} + ${cal.fit_slope} x log(tvl))\n` +
    `token radar: ${board.length} candidates ranked (${snapshot.watchlist.length} watchlist, ${excluded.length} set aside by the product test), ` +
    `${radar.live.length} launched shown for reference\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);
