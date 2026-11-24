// Launch Radar model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The idea in one paragraph. A protocol that records no token cannot be priced from a market, so
// this model prices it from its neighbours: the protocols in the same snapshot whose tokens DO
// trade. For every category it takes the median ratio of market cap to TVL among those live peers,
// then applies that ratio to a pre-token protocol's own TVL and adjusts for the protocol's
// seven-day TVL momentum, for how long it has operated with no token (seasoning), and for how
// many chains it runs on (breadth). Nothing is keyed to a protocol's name: feed the same function
// a future snapshot and it ranks protocols that do not exist yet, which is the point of a radar.
//
// The board always covers the snapshot's whole watchlist, then adds the strongest early protocols
// below the watchlist floor. Wrapped, staked, bridged and exchange-house products of a token that
// already trades are set aside: their launch already happened under another name.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
export interface Proto {
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** Parse and lightly validate the snapshot text; throws on a malformed document. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!doc || !Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: expected protocols and watchlist arrays');
  }
  for (const p of doc.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: a protocol is missing its slug or tvl_usd');
    }
  }
  return doc;
}

/** Whole days between the day a protocol was first tracked and the snapshot's as-of day. */
export function trackedDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MULT_FLOOR = 0.04;
const MULT_CAP = 2.5;

/**
 * The value model learned from the snapshot itself: for each category, the median market-cap to
 * TVL ratio of the protocols in that category whose token already trades. Categories with fewer
 * than three live peers fall back to the market-wide median. Returns the per-category table plus
 * the global fallback.
 */
export function peerMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio > 0.005 && ratio < 40) {
        all.push(ratio);
        const key = p.category ?? 'Uncategorised';
        const bucket = ratios.get(key) ?? [];
        bucket.push(ratio);
        ratios.set(key, bucket);
      }
    }
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, number>();
  for (const [key, bucket] of ratios) {
    if (bucket.length >= 3) {
      byCategory.set(key, Math.min(MULT_CAP, Math.max(MULT_FLOOR, median(bucket))));
    }
  }
  return { byCategory, global: Math.min(MULT_CAP, Math.max(MULT_FLOOR, global)) };
}

/** The multiple a protocol is priced with: its category's peer median, else the global one. */
export function multipleFor(p: Proto, table: { byCategory: Map<string, number>; global: number }): number {
  if (p.category !== null) {
    const hit = table.byCategory.get(p.category);
    if (hit !== undefined) return hit;
  }
  return table.global;
}

/** Momentum from the seven-day TVL change: a growing protocol's launch is worth more. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const clamped = Math.min(150, Math.max(-50, change7d));
  return Math.max(0.35, 1 + (clamped / 100) * 0.6);
}

/** Seasoning: the longer a protocol has run with no token, the more a launch has built up. */
export function seasoningFactor(days: number | null): number {
  if (days === null) return 0.8;
  return 0.55 + 0.45 * (Math.min(days, 1460) / 1460);
}

/** Breadth: every extra chain is another community that would receive a launch. */
export function breadthFactor(chainCount: number): number {
  return 1 + 0.03 * Math.min(Math.max(chainCount - 1, 0), 8);
}

/** The model's one pricing function: implied launch value in whole dollars for one protocol. */
export function impliedValue(
  p: Proto,
  asOf: string,
  table: { byCategory: Map<string, number>; global: number },
): { implied: number; multiple: number; days: number | null } {
  const multiple = multipleFor(p, table);
  const days = trackedDays(asOf, p.listed_at);
  const raw =
    p.tvl_usd * multiple * momentumFactor(p.change_7d) * seasoningFactor(days) * breadthFactor(p.chains.length);
  return { implied: Math.max(1, Math.round(raw)), multiple, days };
}

const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the record shows no token: no CoinGecko id, no symbol, no market cap. */
export function recordsNoToken(p: Proto): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/**
 * True when a pre-token record is a wrapped, staked, bridged or exchange-house product of a token
 * that already trades, judged from the record's own fields the way the snapshot's field guide
 * describes: those launches already happened under another name, so they are not radar targets.
 */
export function isDerivativeProduct(p: Proto): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** A protocol the radar may rank: records no token and is not a derivative of a traded one. */
export function isRadarTarget(p: Proto): boolean {
  return recordsNoToken(p) && !isDerivativeProduct(p);
}

function chainList(p: Proto): string {
  if (p.chains.length === 0) return 'its home chain';
  if (p.chains.length === 1) return p.chains[0]!;
  return `${p.chains[0]} (and ${p.chains.length - 1} more chain${p.chains.length === 2 ? '' : 's'})`;
}

type Playbook = { open: string; use: string; deepen: string };

const PLAYBOOKS: Array<{ match: RegExp; book: Playbook }> = [
  {
    match: /dex|exchange|swap/i,
    book: {
      open: 'make a first small swap so the wallet shows real trading history, not a single airdrop-sized trade',
      use: 'route swaps through the exchange each week, mixing pairs and sizes the way a normal trader would',
      deepen: 'add a small two-sided liquidity position and leave it in range so the wallet also counts as a provider',
    },
  },
  {
    match: /lend|borrow|money market/i,
    book: {
      open: 'supply a first deposit of a major asset so the wallet opens a lending position with real collateral',
      use: 'keep a modest borrow open against the deposit and repay it on schedule, which marks the wallet as a borrower too',
      deepen: 'cycle part of the position monthly: adjust collateral, move between markets, and never let it sit untouched',
    },
  },
  {
    match: /deriv|perp|futures|options/i,
    book: {
      open: 'fund a small margin balance and close one tiny trade end to end so the account records a full trade lifecycle',
      use: 'trade small size on a regular cadence, varying pairs and holding times instead of repeating one pattern',
      deepen: 'use one advanced feature the venue offers (a stop, a hedge, or a second market) so the account is not one-dimensional',
    },
  },
  {
    match: /yield|farm|vault|stak/i,
    book: {
      open: 'deposit into one vault or pool and hold the position long enough to earn at least one reward cycle',
      use: 'claim and re-deposit rewards rather than letting them idle, which shows the wallet actually farms the protocol',
      deepen: 'spread a second, smaller deposit across another pool so the wallet is not tied to a single strategy',
    },
  },
  {
    match: /aggregat|router/i,
    book: {
      open: 'route one real swap through the aggregator from a wallet that also trades elsewhere',
      use: 'use the aggregator as the default route for ordinary swaps each week, across more than one chain it serves',
      deepen: 'try its limit or advanced order type once, so the wallet touches more than the basic swap box',
    },
  },
];

const GENERIC_BOOK: Playbook = {
  open: 'complete one real end-to-end use of the product, small enough to be cheap and large enough to be genuine activity',
  use: 'return on a weekly cadence and repeat the core action with varied sizes, so the history reads as a user, not a script',
  deepen: 'use a second feature of the product beyond the headline one, so the wallet shows depth rather than a single click',
};

function playbookFor(p: Proto): Playbook {
  const label = p.category ?? '';
  for (const entry of PLAYBOOKS) {
    if (entry.match.test(label)) return entry.book;
  }
  return GENERIC_BOOK;
}

/**
 * The farm plan for one protocol: five concrete steps, each naming the action, what it costs and
 * how long it takes. The steps are written from the protocol's own record (its chains, category
 * and size), so two protocols never read quite the same plan.
 */
export function farmSteps(p: Proto): string[] {
  const book = playbookFor(p);
  const where = chainList(p);
  const size =
    p.tvl_usd >= 1_000_000_000 ? 'deep liquidity, so small test sizes are safe' : 'thinner books, so keep test sizes small';
  return [
    `Set up a fresh wallet for ${p.name} on ${where} and fund it with roughly $40 of gas and working capital; a dedicated wallet keeps this farm's history clean (cost: ~$40 float, 20 minutes).`,
    `Open ${p.name} and ${book.open}; the protocol runs on ${where} with ${size} (cost: gas only, about $1-5, 15 minutes).`,
    `Build a routine: ${book.use}; four to six weeks of steady, human-looking activity is the usual qualifying pattern (cost: gas per visit, 10 minutes a week).`,
    `Go one level deeper: ${book.deepen}; depth is what separates a farmer from a one-transaction wallet if a snapshot is ever taken (cost: a second small position, 30 minutes).`,
    `Track the farm in a simple log with dates, transaction hashes and amounts, and re-check ${p.name}'s own announcements monthly; stop adding funds if the product changes its terms (cost: nothing, 5 minutes a month).`,
  ];
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  implied_value_usd: number;
  peer_multiple: number;
  farm_steps: string[];
}

/** The board's target size: the watchlist plus the strongest early protocols below the floor. */
export const BOARD_TARGET = 280;

/** Build the ranked board: whole watchlist covered, then early targets by implied value. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const scored: Array<{ p: Proto; implied: number; multiple: number }> = [];
  for (const p of snapshot.protocols) {
    if (!isRadarTarget(p)) continue;
    const v = impliedValue(p, snapshot.as_of, table);
    scored.push({ p, implied: v.implied, multiple: v.multiple });
  }
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  const chosen = scored.slice(0, BOARD_TARGET);
  const chosenSlugs = new Set(chosen.map((c) => c.p.slug));
  for (const slug of snapshot.watchlist) {
    if (!chosenSlugs.has(slug)) {
      const p = bySlug.get(slug);
      if (p !== undefined) {
        const v = impliedValue(p, snapshot.as_of, table);
        chosen.push({ p, implied: v.implied, multiple: v.multiple });
      }
    }
  }
  chosen.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  return chosen.map((c, i) => ({
    rank: i + 1,
    slug: c.p.slug,
    name: c.p.name,
    category: c.p.category,
    chains: c.p.chains,
    tvl_usd: c.p.tvl_usd,
    change_7d: c.p.change_7d,
    listed_at: c.p.listed_at,
    implied_value_usd: c.implied,
    peer_multiple: Math.round(c.multiple * 10000) / 10000,
    farm_steps: farmSteps(c.p),
  }));
}

/** The compact per-row shape the dashboard renders from data.js. */
export interface DashRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  on_watchlist: boolean;
  steps: string[];
}

/** Everything data.js carries: the board, the live-token context and the model's own statement. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model_version: string;
  stats: {
    protocols: number;
    pre_token: number;
    board_rows: number;
    watchlist: number;
    board_tvl_usd: number;
    board_implied_usd: number;
  };
  rows: DashRow[];
  live: Array<{ name: string; symbol: string | null; category: string | null; tvl_usd: number; mcap_usd: number }>;
}

export const MODEL_VERSION = 'launch-radar-2';

/** Build the board plus the dashboard's dataset from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(recordsNoToken).length,
      board_rows: board.length,
      watchlist: snapshot.watchlist.length,
      board_tvl_usd: board.reduce((sum, r) => sum + r.tvl_usd, 0),
      board_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    },
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: trackedDays(snapshot.as_of, r.listed_at),
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.peer_multiple,
      on_watchlist: watch.has(r.slug),
      steps: r.farm_steps,
    })),
    live: snapshot.protocols
      .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
      .slice(0, 24)
      .map((p) => ({ name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! })),
  };
  return { board, radar };
}

/** The dashboard's data as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Mirror of the sealed gate's board rows: returns the first problem found, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set<string>();
  const protoSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i}: rank is ${row.rank}, expected ${i + 1}`;
    if (slugs.has(row.slug)) return `slug ${row.slug} appears twice`;
    slugs.add(row.slug);
    if (!protoSlugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug}: implied value ${row.implied_value_usd} out of range`;
    }
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises with rank`;
    if (i > 0 && row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: farm_steps count`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters`;
    }
  }
  if (allSame) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is not on the board`;
  }
  return null;
}
