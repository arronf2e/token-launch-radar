// Token launch radar: the model. One sealed DefiLlama snapshot in, one ranked board out.
//
// The question this board answers: if a protocol that still records no token issued one today,
// what would the market plausibly say it is worth, and what should a reader do to be farming it
// before that day? The snapshot carries no ranking and no values, so every number below is built
// from the snapshot's own figures alone, by one function applied to every protocol alike. No
// protocol name is ever special-cased.
//
// Classification first. A protocol is "live" when its record carries a token (a CoinGecko id, a
// symbol or a market cap). It is a "derivative" when it records no token but is a wrapped, staked
// or bridged product of one that already trades, judged by the house watchlist's own rule: its
// category is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX,
// its name carries a whole word wrapped, staked or staking, ends in a version marker, or begins
// with an exchange's name. Everything else that records no token is a candidate, and candidates
// are the board.
//
// The value model is a peer-multiple model, not a flat guess:
//
//   peer multiple  the median market-cap / TVL ratio of the snapshot's live protocols, per
//                  category, shrunk toward the global median by sample size (a category with
//                  few live peers borrows strength from the whole market), capped to [0.03, 2.5]
//   base           tvl_usd x peer multiple of the protocol's category
//   momentum       1 + 0.35 x clamp(change_7d, -50, +100) / 100: a week of TVL growth raises the
//                  claim, a week of bleeding lowers it, and one wild week cannot dominate
//   maturity       0.75 + 0.5 x min(age_days, 1095) / 1095: three years of running with no token
//                  is the strongest seasoning the model credits; an unknown listing day counts
//                  as one year
//   breadth        1 + 0.04 x min(chains - 1, 5): every extra chain is distribution a launch
//                  would inherit, worth a little, capped at five
//   implied value  max(1, round(base x momentum x maturity x breadth)), whole US dollars
//
// The board ranks candidates by implied value, states every factor beside the result, and keeps
// the live set apart with the market's own market caps, so a reader can see what the model would
// have to believe for a pre-token protocol to outrank a trading one.

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

/** The model's version label, stated in the dashboard and in every data file it writes. */
export const MODEL_VERSION = 'peer-multiple radar-2';

/** How many ranked candidates the board carries before the watchlist force-in pass. */
export const BOARD_ROWS = 240;

/** How many live-token protocols the dashboard's comparison strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories the house rule treats as products of a token that already trades. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a derivative product's name may begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** True when the record carries a token: a CoinGecko id, a symbol or a market cap. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

/** True when a pre-token record is a wrapped, staked or bridged product of a trading token. */
export function isDerivative(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (/(^|\s)(wrapped|staked|staking)(\s|$)/i.test(p.name)) return true;
  if (/\s(V2|v2|2\.0)$/.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** Whole days between the day DefiLlama began tracking the protocol and the snapshot's day. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = Math.floor((Date.parse(asOf) - Date.parse(p.listed_at)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The peer multiples: per-category medians of live mcap/TVL, shrunk toward the global median. */
export interface PeerMultiples {
  global: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
}

export function peerMultiples(snapshot: Snapshot): PeerMultiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd < 1_000_000) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = ratios.length > 0 ? clamp(median(ratios), 0.03, 2.5) : 0.25;
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of perCategory) {
    // Shrinkage weight 8: a category with one loud peer (a prediction market whose market cap is
    // many times its TVL) must not drag every pre-token protocol in it to that multiple.
    const shrunk = (list.length * median(list) + 8 * global) / (list.length + 8);
    byCategory.set(key, { multiple: clamp(shrunk, 0.03, 2.5), peers: list.length });
  }
  return { global, byCategory };
}

/** The multiple a candidate is valued with, and how many live peers stand behind it. */
export function multipleFor(peers: PeerMultiples, category: string | null): { multiple: number; peers: number } {
  const hit = peers.byCategory.get(category ?? '(uncategorised)');
  return hit ?? { multiple: peers.global, peers: 0 };
}

/** One scored candidate: the board row plus the model's working, stated in full. */
export interface ScoredCandidate {
  protocol: SnapshotProtocol;
  age_days: number | null;
  multiple: number;
  peers: number;
  momentum: number;
  maturity: number;
  breadth: number;
  implied_value_usd: number;
}

export function scoreCandidate(p: SnapshotProtocol, peers: PeerMultiples, asOf: string): ScoredCandidate {
  const { multiple, peers: peerCount } = multipleFor(peers, p.category);
  const age = ageDays(p, asOf);
  const growth = clamp(p.change_7d ?? 0, -50, 100);
  const momentum = 1 + 0.35 * (growth / 100);
  const maturity = 0.75 + 0.5 * (Math.min(age ?? 365, 1095) / 1095);
  const breadth = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
  return { protocol: p, age_days: age, multiple, peers: peerCount, momentum, maturity, breadth, implied_value_usd: implied };
}

/** Compact dollars for prose: $1.2B, $340M, $25K. */
export function fmtUsd(x: number): string {
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${Math.round(x)}`;
}

/** The working-capital band a farm plan suggests, scaled to the protocol's TVL. */
function sizeBand(tvl: number): string {
  if (tvl >= 200_000_000) return '$2,000-10,000';
  if (tvl >= 50_000_000) return '$1,000-5,000';
  if (tvl >= 10_000_000) return '$500-2,000';
  return '$200-1,000';
}

/** What one transaction roughly costs on a chain, in the plan's plain words. */
function gasProfile(chain: string): string {
  if (chain === 'Ethereum') return 'about $8-40 in gas per transaction at ordinary fees';
  if (chain === 'Solana') return 'fees of well under $0.10 per transaction';
  if (chain === 'Bitcoin') return 'network fees of $1-10 per transaction';
  return 'gas of $0.10-2 per transaction';
}

/** The two middle steps of a farm plan: the protocol's core action, by what it is. */
function coreSteps(p: SnapshotProtocol, size: string, gas: string): [string, string] {
  const name = p.name;
  const cat = p.category ?? '';
  const on = p.chains[0] ?? 'its main chain';
  if (cat === 'Lending' || cat === 'Uncollateralized Lending') {
    return [
      `Supply ${size} of a blue-chip asset (ETH or a major stablecoin) as collateral in ${name} on ${on}; lending is its core product and suppliers are the users a launch rewards first. Cost: ${gas}. Time: 10 minutes.`,
      `Borrow a small stablecoin amount, at most 30% of what the collateral allows, hold it a few days and repay in full; a clean borrow-and-repay history marks a real user, not a deposit tourist. Cost: two transactions (${gas} each), plus cents of interest. Time: 15 minutes.`,
    ];
  }
  if (cat === 'Dexs') {
    return [
      `Trade through ${name} on ${on} every week: swap ${size} across its deepest pairs in a few natural-sized trades rather than one round trip. Cost: ${gas}, plus the pool fee on each swap. Time: 10 minutes a week.`,
      `Add ${size} of two-sided liquidity to a top-three pool by TVL and leave it in place; liquidity that stays through weekly snapshots is worth more than volume that flashes. Cost: ${gas} to add, and the same to remove. Time: 15 minutes to set up.`,
    ];
  }
  if (cat === 'Derivatives' || cat === 'Options' || cat === 'Options Vault' || cat === 'Interest Rate Derivatives') {
    return [
      `Open small, hedged positions on ${name}: trade ${size} of notional a week in its most liquid market, sized so a 10% move cannot liquidate you. Cost: ${gas}, plus trading fees. Time: 20 minutes a week.`,
      `Use a second product surface if it offers one (a vault, an options chain, a different expiry) at least twice a month; breadth of real use is what separates a user from a volume script. Cost: ${gas}. Time: 15 minutes.`,
    ];
  }
  if (cat === 'CDP' || cat === 'CDP Manager' || cat === 'Dual-Token Stablecoin' || cat === 'Algo-Stables' || cat === 'Stablecoin Issuer') {
    return [
      `Mint ${name}'s stablecoin against ${size} of collateral on ${on} and hold part of the position open; issuers remember the wallets that carried their supply before any token existed. Cost: ${gas}. Time: 15 minutes.`,
      `Put the minted stablecoin to work inside the same ecosystem (a lending market or a pool the protocol links to) so the position reads as use, not a mint-and-dump. Cost: ${gas} a transaction. Time: 10 minutes.`,
    ];
  }
  if (cat === 'RWA') {
    return [
      `Complete ${name}'s onboarding on ${on} early, including any KYC it asks for, and buy ${size} of its shortest-duration real-world asset; onboarding queues are where late farmers lose weeks. Cost: ${gas}, plus any onboarding fee shown in its app. Time: 30-45 minutes.`,
      `Hold the position to maturity or roll it once rather than exiting in days; duration held is the behaviour real-world-asset protocols can actually verify. Cost: ${gas} per roll. Time: 10 minutes a month.`,
    ];
  }
  if (cat === 'Chain') {
    return [
      `Bridge ${size} onto ${name} and keep a working balance there for a full quarter; a chain's own token, if one comes, goes to the wallets that were transacting before it existed. Cost: bridge fees of $1-15, plus ${gas}. Time: 20 minutes.`,
      `Use three or more native applications on ${name} (a DEX, a lending market, a bridge out) a few times each; breadth across the chain's own ecosystem is the signal a snapshot can see. Cost: ${gas} a transaction. Time: 30 minutes a month.`,
    ];
  }
  if (cat === 'Launchpad') {
    return [
      `Join ${name}'s allowlist or staking tier on ${on} with ${size} and complete its identity steps before any sale opens; launchpad allocations are decided before the crowd arrives. Cost: ${gas}. Time: 20 minutes.`,
      `Take part in one sale at a size you can hold for months, and keep the position rather than flipping day one; launchpads track who held. Cost: the sale amount itself. Time: 15 minutes a sale.`,
    ];
  }
  if (cat === 'Prediction Market') {
    return [
      `Trade ${size} across ${name}'s most liquid markets on ${on}, taking real positions you have a view on rather than washing both sides. Cost: ${gas}. Time: 20 minutes a week.`,
      `Let some positions settle instead of closing everything early; a history of held-to-settlement trades is the usage pattern prediction markets can verify. Cost: none beyond the position. Time: none.`,
    ];
  }
  if (cat === 'Payments' || cat === 'Crypto Card Issuer') {
    return [
      `Route real spending through ${name}: load ${size} and use it for purchases you would make anyway, weekly, so the account shows a genuine payment history. Cost: any load fee its app shows. Time: 5 minutes a purchase.`,
      `Keep a standing balance rather than emptying the account after each use; balances held between payments are what a payments launch can snapshot. Cost: none. Time: none.`,
    ];
  }
  if (cat === 'Privacy') {
    return [
      `Make modest private transfers through ${name} on ${on}: deposit ${size}, move it privately, and withdraw to a fresh address, a few times a month. Cost: ${gas} a transaction, plus any pool fee. Time: 15 minutes a round.`,
      `Vary amounts and timing instead of repeating one fixed pattern; privacy tools reward ordinary-looking use and flag metronome behaviour. Cost: none extra. Time: none.`,
    ];
  }
  if (cat === 'Insurance') {
    return [
      `Buy a small cover on ${name} for a position you actually hold elsewhere, ${size} of cover for a quarter; real policyholders are the users an insurance launch knows by name. Cost: the premium its app quotes. Time: 15 minutes.`,
      `Or underwrite: deposit ${size} into its underwriting pool and leave it a full quarter; underwriting capital that stays is verifiable in a way a single purchase is not. Cost: ${gas}. Time: 10 minutes.`,
    ];
  }
  if (cat === 'AI Agents' || cat === 'Decentralized AI') {
    return [
      `Use ${name} for real work: spend ${size} over a quarter on its agents or compute instead of testing once and leaving; paying users are the cohort any launch can identify. Cost: the usage itself. Time: your normal work.`,
      `Keep the same account and wallet across that usage and complete any builder or feedback profile it offers; continuity is the only history it can reward. Cost: none. Time: 10 minutes.`,
    ];
  }
  if (cat === 'Restaking') {
    return [
      `Restake ${size} of ETH or a liquid staking token through ${name} on ${on} and hold the position; restaking protocols snapshot the wallets that carried their TVL early. Cost: ${gas}. Time: 15 minutes.`,
      `Spread a second, smaller deposit across another operator or strategy it offers, so your history shows deliberate use rather than one parked deposit. Cost: ${gas}. Time: 10 minutes.`,
    ];
  }
  return [
    `Deposit ${size} into ${name}'s main vault or strategy on ${on} and leave it in place; for a ${cat || 'yield'} protocol the deposit history is the product, and it is what a launch can snapshot. Cost: ${gas}. Time: 10 minutes.`,
    `Use a second surface it offers (another vault, a boost, a lock or a longer duration) at least once a month, so the wallet reads as a user of the protocol and not a single parked deposit. Cost: ${gas}. Time: 10 minutes a month.`,
  ];
}

/**
 * A concrete farm plan for one protocol: five steps, each with what it costs and how long it
 * takes, built from the protocol's own category, chains and scale. Deterministic: the same
 * snapshot figures always write the same plan.
 */
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const size = sizeBand(p.tvl_usd);
  const primary = p.chains[0] ?? 'its main chain';
  const gas = gasProfile(primary);
  const age = ageDays(p, asOf);
  const seasoning = age !== null && age >= 730 ? ` It has run ${Math.floor(age / 365)} years with no token, so the farm is a patience trade, not a sprint.` : '';
  const [core1, core2] = coreSteps(p, size, gas);
  return [
    `Set up one wallet for ${p.name} and fund it on ${primary} with ${size} of working capital; use this same wallet for every step so the protocol sees one consistent user.${seasoning} Cost: one funding transaction (${gas}). Time: 15 minutes.`,
    core1,
    core2,
    `Stay consistent for at least 8 weeks: repeat the core action weekly and keep a balance in place across weekly snapshots, since one-day spikes are the first thing points and season systems discount. Cost: ${gas} each week. Time: 20 minutes a week.`,
    `Cap ${p.name} at 10% of your total farm budget and re-check it monthly. It records no token today, so nothing is owed to you; if a token is announced, claim only inside its own app and never sign a claim link from social media. Cost: none. Time: 10 minutes a month.`,
  ];
}

/** One row of the board: the gate's fields, plus the model's working for the dashboard. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  peers: number;
  momentum: number;
  maturity: number;
  breadth: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol, kept apart from the board with the market's own value for it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the dashboard renders, written by main.ts as data.js. */
export interface RadarData {
  version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  global_multiple: number;
  stats: { protocols: number; candidates: number; live: number; derivatives: number; watchlist: number; rows: number };
  rows: BoardRow[];
  live: LiveRow[];
}

/** Parse and lightly validate the sealed snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  const parsed = JSON.parse(text) as Snapshot;
  if (!Array.isArray(parsed.protocols) || !Array.isArray(parsed.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return parsed;
}

/**
 * Build the board and the dashboard's data from one snapshot. Pure and deterministic: the same
 * snapshot always builds the same bytes, which the grader's two runs rely on.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = peerMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const candidates: SnapshotProtocol[] = [];
  const live: LiveRow[] = [];
  let derivatives = 0;
  let liveCount = 0;
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) {
      liveCount += 1;
      if (p.mcap_usd !== null && p.mcap_usd > 0) {
        live.push({
          slug: p.slug,
          name: p.name,
          category: p.category,
          tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd,
          multiple: p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : 0,
        });
      }
      continue;
    }
    if (isDerivative(p)) {
      derivatives += 1;
      continue;
    }
    candidates.push(p);
  }
  live.sort((a, b) => b.mcap_usd - a.mcap_usd || a.slug.localeCompare(b.slug));

  const scored = candidates.map((p) => scoreCandidate(p, peers, snapshot.as_of));
  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.protocol.tvl_usd - a.protocol.tvl_usd ||
      a.protocol.slug.localeCompare(b.protocol.slug),
  );
  const chosen = scored.slice(0, BOARD_ROWS);
  const chosenSlugs = new Set(chosen.map((s) => s.protocol.slug));
  for (const s of scored) {
    if (watchlist.has(s.protocol.slug) && !chosenSlugs.has(s.protocol.slug)) chosen.push(s);
  }
  chosen.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.protocol.tvl_usd - a.protocol.tvl_usd ||
      a.protocol.slug.localeCompare(b.protocol.slug),
  );

  const board: BoardRow[] = chosen.map((s, i) => ({
    rank: i + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    listed_at: s.protocol.listed_at,
    age_days: s.age_days,
    implied_value_usd: s.implied_value_usd,
    multiple: Math.round(s.multiple * 1000) / 1000,
    peers: s.peers,
    momentum: Math.round(s.momentum * 1000) / 1000,
    maturity: Math.round(s.maturity * 1000) / 1000,
    breadth: Math.round(s.breadth * 1000) / 1000,
    watchlist: watchlist.has(s.protocol.slug),
    farm_steps: farmSteps(s.protocol, snapshot.as_of),
  }));

  const radar: RadarData = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    global_multiple: Math.round(peers.global * 1000) / 1000,
    stats: {
      protocols: snapshot.protocols.length,
      candidates: candidates.length,
      live: liveCount,
      derivatives,
      watchlist: snapshot.watchlist.length,
      rows: board.length,
    },
    rows: board,
    live: live.slice(0, LIVE_ROWS),
  };
  return { board, radar };
}

/** The gate's board rules, checked before anything is written: a refusal here fails the run. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const [i, row] of board.entries()) {
    if (row.rank !== i + 1) return `row ${row.slug}: rank ${row.rank}, expected ${i + 1}`;
    if (!slugs.has(row.slug)) return `row ${row.slug}: not a protocol in the snapshot`;
    if (seen.has(row.slug)) return `row ${row.slug}: slug appears twice`;
    seen.add(row.slug);
    if (!row.name) return `row ${row.slug}: empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug}: implied value not a positive whole number`;
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises as rank ascends`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: ${row.farm_steps.length} farm steps, outside 3-12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters, outside 20-600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every implied value is the same: not a ranking';
  return null;
}

/** The dashboard's data as a script: window.RADAR, with no character that can close the tag. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar).replaceAll('<', '\\u003c')};\n`;
}
