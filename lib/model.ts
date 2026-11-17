// The token radar's model, second generation: one sealed snapshot in, one ranked board out.
//
// Everything on the board is derived from the snapshot's own figures. Nothing is keyed to a
// protocol's name: the same code path scores every row, and the calibration below is recomputed
// from the snapshot on every run, so the program would score a future snapshot it has never seen.
//
// Population. A protocol is a launch candidate when the snapshot records no token for it (both
// gecko_id and symbol are null; in this snapshot those rows also all record no market cap). The
// board then applies the watchlist's own product test, because a wrapped, staked or bridged
// product of a token that already trades is not a launch that has not happened yet:
//   - at or above the watchlist floor, the snapshot's watchlist is the authority. The house drew
//     it with DefiLlama's parent-protocol field, which the snapshot does not carry, so above the
//     floor the board takes the watchlist itself (40 rows) and nothing else;
//   - below the floor, the board re-implements the documented part of the same test on the ten
//     fields the snapshot does carry: the excluded categories, a version marker at the end of
//     the name, a whole word wrapped / staked / staking in the name, or an exchange's name at
//     the start of it. That keeps 138 of the 210 below-floor candidates.
//
// Value. Two independent reads of the launched market, both fitted on the snapshot's launched
// protocols (a recorded market cap above zero and a TVL above zero; 128 of them in this
// snapshot), then blended in log space:
//   comps:  tvl x the protocol category's own median mcap/TVL among launched protocols, shrunk
//           toward the global median with a prior worth 4 observations, so a thin category
//           borrows the market's centre instead of swinging on two prints;
//   curve:  exp(a + b x log(tvl)) from a least-squares fit of log(mcap) on log(tvl) over the
//           same launched set, which prices size itself (the fit's slope is well under 1: value
//           grows slower than TVL).
// The blend weights (0.4 comps / 0.6 curve) are the pair that minimised the median absolute log
// error when both reads were scored against the launched set they were fitted on. Two stated
// adjustments follow, both from the candidate's own record:
//   growth:   1 + clamp(change_7d, -60, +150) / 100 x 0.35 (a missing change reads as 0);
//   maturity: 0.8 + 0.4 x min(age_days, 1460) / 1460, age measured from listed_at to the
//             snapshot's as_of; a missing listed_at takes the candidate set's median age.
// implied_value_usd = max(1, round(base x growth x maturity)). Rows are ordered by that value,
// ties by TVL then slug, so two runs of this program write the same bytes.

import { farmSteps } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The model's stated structural constants. The calibration itself is fitted per run, below. */
export const MODEL = {
  /** Log-space weight on the category-comps read; the curve read takes the rest. */
  blend_comps_weight: 0.4,
  /** Prior strength, in observations, shrinking a category median toward the global median. */
  shrink_prior: 4,
  /** A category needs at least this many launched protocols before its own median is used. */
  min_category_sample: 3,
  /** change_7d is clamped to this window before it moves a value. */
  growth_floor_pct: -60,
  growth_cap_pct: 150,
  /** Each clamped growth point is worth this much multiplier. */
  growth_weight: 0.35,
  /** Maturity runs from maturity_base (brand new) to maturity_base + maturity_span (4+ years). */
  maturity_base: 0.8,
  maturity_span: 0.4,
  maturity_days: 1460,
} as const;

/** The model's version label: the dashboard names it and the README quotes it. */
export const MODEL_VERSION = 'radar-2';

/** How many launched protocols the dashboard's reference view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted reads of the launched market, recomputed from the snapshot on every run. */
export interface Calibration {
  sample_size: number;
  global_multiple: number;
  fit_intercept: number;
  fit_slope: number;
  blend_comps_weight: number;
  category_multiples: Record<string, { multiple: number; sample: number }>;
}

/** The per-row model breakdown the board and the dashboard both show. */
export interface ModelBreakdown {
  category_multiple: number;
  comps_value_usd: number;
  curve_value_usd: number;
  blended_base_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'records-no-token';
  watchlist: boolean;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** A launched protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the launched reference set, and the fitted model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_constants: typeof MODEL;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  excluded_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

/** The median of a non-empty list, on a sorted copy so the caller's order is untouched. */
function median(values: number[]): number {
  const x = [...values].sort((a, b) => a - b);
  const mid = Math.floor(x.length / 2);
  return x.length % 2 === 1 ? x[mid]! : (x[mid - 1]! + x[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token for a protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The categories the watchlist's product test excludes, as the snapshot's field guide names them. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name marks a product of another token. */
const PRODUCT_WORD = /\b(?:wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a name marks an exchange product. */
const EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Why a below-floor candidate fails the product test, or null when it passes. Above the floor the
 * snapshot's watchlist is used instead: the full test needs the parent-protocol field, which the
 * snapshot does not carry (its field guide says so), and the list is what that test produced.
 */
export function productTestFailure(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `category ${p.category} is a product of another token`;
  if (VERSIONED.test(p.name)) return 'the name ends in a version marker: a pool of another protocol';
  if (PRODUCT_WORD.test(p.name)) return 'the name carries wrapped, staked or staking: a product of another token';
  if (EXCHANGE_PREFIX.test(p.name)) return 'the name begins with an exchange: an exchange product';
  return null;
}

/** The board's population and the rows it set aside, with the reason for each. */
export interface Population {
  included: SnapshotProtocol[];
  excluded: { slug: string; reason: string }[];
}

/** Who the board ranks: every watchlist row, plus below-floor candidates that pass the product test. */
export function selectPopulation(snapshot: Snapshot): Population {
  const watchlist = new Set(snapshot.watchlist);
  const included: SnapshotProtocol[] = [];
  const excluded: { slug: string; reason: string }[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) {
      if (watchlist.has(p.slug)) included.push(p);
      else excluded.push({ slug: p.slug, reason: 'at or above the floor but not on the watchlist: the house product test set it aside' });
      continue;
    }
    const failure = productTestFailure(p);
    if (failure === null) included.push(p);
    else excluded.push({ slug: p.slug, reason: failure });
  }
  return { included, excluded };
}

/** The launched set both reads are fitted on: a recorded market cap and TVL, both above zero. */
function launchedSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Fit the comps and the size curve on the snapshot's launched protocols. */
export function calibrate(snapshot: Snapshot): Calibration {
  const launched = launchedSet(snapshot);
  if (launched.length < 10) throw new SnapshotError(`only ${launched.length} launched protocols to calibrate on`);
  const globalMultiple = median(launched.map((p) => p.mcap_usd! / p.tvl_usd));

  const ratiosByCategory = new Map<string, number[]>();
  for (const p of launched) {
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const categoryMultiples: Calibration['category_multiples'] = {};
  for (const key of [...ratiosByCategory.keys()].sort()) {
    const ratios = ratiosByCategory.get(key)!;
    if (ratios.length < MODEL.min_category_sample) continue;
    const catMedian = median(ratios);
    const shrunk = Math.exp(
      (ratios.length * Math.log(catMedian) + MODEL.shrink_prior * Math.log(globalMultiple)) / (ratios.length + MODEL.shrink_prior),
    );
    categoryMultiples[key] = { multiple: round4(shrunk), sample: ratios.length };
  }

  // Least squares on log(mcap) against log(tvl): value as a power of size.
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of launched) {
    const x = Math.log(p.tvl_usd);
    const y = Math.log(p.mcap_usd!);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const n = launched.length;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;

  return {
    sample_size: n,
    global_multiple: round4(globalMultiple),
    fit_intercept: round4(intercept),
    fit_slope: round4(slope),
    blend_comps_weight: MODEL.blend_comps_weight,
    category_multiples: categoryMultiples,
  };
}

/** The multiple one candidate is priced with: its category's shrunk median, or the market's. */
function multipleFor(p: SnapshotProtocol, calibration: Calibration): number {
  if (p.category !== null) {
    const entry = calibration.category_multiples[p.category];
    if (entry !== undefined) return entry.multiple;
  }
  return calibration.global_multiple;
}

/** The three multipliers and the implied value one protocol gets, with the whole breakdown. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  neutralAgeDays: number,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = multipleFor(p, calibration);
  const comps = p.tvl_usd * multiple;
  const curve = Math.exp(calibration.fit_intercept + calibration.fit_slope * Math.log(Math.max(1, p.tvl_usd)));
  const w = calibration.blend_comps_weight;
  const base = Math.exp(w * Math.log(Math.max(1, comps)) + (1 - w) * Math.log(Math.max(1, curve)));

  const growthPct = Math.min(MODEL.growth_cap_pct, Math.max(MODEL.growth_floor_pct, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForModel = age ?? neutralAgeDays;
  const maturityMult = MODEL.maturity_base + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_span;

  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return {
    implied,
    breakdown: {
      category_multiple: multiple,
      comps_value_usd: Math.round(comps),
      curve_value_usd: Math.round(curve),
      blended_base_usd: Math.round(base),
      growth_pct: round2(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      age_days: age,
    },
  };
}

/** The ranked board, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; calibration: Calibration; excluded: Population['excluded'] } {
  const calibration = calibrate(snapshot);
  const { included, excluded } = selectPopulation(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const knownAges = included.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const neutralAge = knownAges.length > 0 ? Math.round(median(knownAges)) : 365;

  const scored = included.map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, calibration, neutralAge);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'records-no-token' as const,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
  return { board, calibration, excluded };
}

/** The launched protocols, by market cap, for the dashboard's reference view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; excluded: Population['excluded'] } {
  const { board, calibration, excluded } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_constants: MODEL,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    excluded_size: excluded.length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar, excluded };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: size, slugs, coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const inSnapshot = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!inSnapshot.has(r.slug)) return `${r.slug} is not a protocol in the snapshot`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (/\s/.test(r.slug) || r.slug.length < 1 || r.slug.length > 128) return `${r.slug} is not a gate-shaped slug`;
    if (r.name.length === 0) return `${r.slug} has an empty name`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} trimmed characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
