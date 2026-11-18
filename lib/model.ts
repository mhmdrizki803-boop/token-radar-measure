// Token Radar's model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// What the board answers: which protocol that records no token yet would be worth the most at
// launch, and what it would cost a farmer to be early. Nothing outside the snapshot is used.
//
//   comps     = the live-token protocols in the same category; their median market cap over TVL is
//               the category's own launch multiple (the whole market's median when the category is
//               thin, and 0.18 when nothing has one)
//   base      = tvl_usd * comps
//   breadth   = 1 + 0.04 * min(chains, 6) + 0.05 when the protocol is on Ethereum, 0.04 on Solana,
//               0.03 on Base; capped at 1.35
//   momentum  = 1 + clamp(change_7d, -50, 100) / 100 * 0.30
//   maturity  = 0.72 + min(age_days, 1095) / 1095 * 0.28  (no listed_at: 0.86)
//   implied   = max(1000, round(base * breadth * momentum * maturity))
//
// The airdrop column is a judgement, stated as one: a launch of that size is assumed to put about
// AIRDROP_SHARE of the implied value into the hands of early users, spread over an assumed
// AIRDROP_WALLETS wallets, so a single well-farmed wallet is a fraction of it. The score blends
// that estimate with how cheap the chain is to farm and how long the protocol has been live.
//
// No name is special-cased anywhere: the same function scores every row.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FarmStep {
  step: string;
  detail: string;
  cost: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_breakdown: {
    category_multiple: number;
    comparables: number;
    base_usd: number;
    breadth: number;
    momentum: number;
    maturity: number;
  };
  airdrop: {
    share: number;
    wallets: number;
    per_wallet_usd: number;
    farm_cost_usd: number;
    score: number;
    band: string;
  };
  why: string;
  farm_steps: FarmStep[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_statement: string;
  counts: { protocols: number; pre_token: number; watchlist: number; rows: number };
  summary: {
    top_value: { name: string; implied_value_usd: number; category: string }[];
    top_score: { name: string; score: number; per_wallet_usd: number; cost: number; chain: string }[];
    movers: { name: string; change_7d: number; tvl_usd: number }[];
    categories: { category: string; rows: number; tvl_usd: number; implied_usd: number; multiple: number }[];
  };
  rows: BoardRow[];
}

/** How much of an implied launch value is assumed to reach early users, over how many wallets. */
export const AIRDROP_SHARE = 0.06;
export const AIRDROP_WALLETS = 60_000;
export const DEFAULT_MULTIPLE = 0.18;
export const MIN_ROWS = 100;

const BASE_CHAINS = [
  ["Ethereum", 0.05],
  ["Solana", 0.04],
  ["Base", 0.03],
] as const;

const CHEAP_CHAINS = new Set(["Solana", "Base", "Arbitrum", "Optimism", "Polygon", "Avalanche", "BSC", "Sui", "Aptos", "Ton", "Linea", "Scroll", "Unichain", "Monad", "Berachain"]);

export class SnapshotError extends Error {}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not JSON');
  }
  const doc = raw as Snapshot;
  if (typeof doc !== 'object' || doc === null) throw new SnapshotError('the snapshot is not an object');
  if (typeof doc.as_of !== 'string') throw new SnapshotError('the snapshot has no as_of');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('the snapshot has no protocols');
  if (!Array.isArray(doc.watchlist)) throw new SnapshotError('the snapshot has no watchlist');
  for (const p of doc.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError('a protocol entry is missing slug, name or tvl_usd');
    }
    if (!Array.isArray(p.chains)) throw new SnapshotError(`${p.slug}: chains is not an array`);
  }
  return doc;
}

/** The whole UTC days between the snapshot's date and the protocol's listing day, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** A protocol is pre-token when the snapshot records no coin for it at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const DERIVATIVE_WORD = /\b(wrapped|staked|staking|bridged)\b/i;

/** A protocol the radar will rank: no token, and not a wrapped, staked, bridged or versioned product. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (DERIVATIVE_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

export function isLiveToken(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** The median market-cap-over-TVL multiple of the live-token protocols, per category and in all. */
export function fitMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; overall: number; comparables: number } {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  let comparables = 0;
  for (const p of snapshot.protocols) {
    if (!isLiveToken(p)) continue;
    const m = (p.mcap_usd as number) / p.tvl_usd;
    if (!Number.isFinite(m) || m <= 0) continue;
    all.push(m);
    comparables += 1;
    const key = p.category ?? 'Other';
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  const median = (xs: number[]): number => {
    if (xs.length === 0) return DEFAULT_MULTIPLE;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const overall = median(all);
  const PRIOR = 6;
  const byCategory = new Map<string, number>();
  for (const [k, v] of groups) {
    const own = median(v);
    const blended = (v.length * own + PRIOR * overall) / (v.length + PRIOR);
    byCategory.set(k, clamp(blended, 0.05, 1.5));
  }
  return { byCategory, overall: clamp(overall, 0.05, 1.5), comparables };
}

function default0(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : DEFAULT_MULTIPLE;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function categoryMultiple(fit: { byCategory: Map<string, number>; overall: number }, category: string | null): { multiple: number; comparables: number } {
  const key = category ?? 'Other';
  const hit = fit.byCategory.get(key);
  if (hit !== undefined) return { multiple: clamp(hit, 0.05, 3), comparables: 1 };
  return { multiple: clamp(fit.overall, 0.05, 3), comparables: 0 };
}

export function chainBreadth(chains: string[]): number {
  let factor = 1 + 0.04 * Math.min(chains.length, 6);
  for (const [name, bonus] of BASE_CHAINS) if (chains.includes(name)) factor += bonus;
  return Math.min(1.35, Number(factor.toFixed(4)));
}

export function momentumFactor(change: number | null): number {
  const c = change === null ? 0 : clamp(change, -50, 100);
  return Number((1 + (c / 100) * 0.3).toFixed(4));
}

export function maturityFactor(age: number | null): number {
  if (age === null) return 0.86;
  return Number((0.72 + (Math.min(age, 1095) / 1095) * 0.28).toFixed(4));
}

export function impliedValue(p: SnapshotProtocol, age: number | null, fit: { byCategory: Map<string, number>; overall: number }): BoardRow['implied_breakdown'] & { implied: number } {
  const { multiple, comparables } = categoryMultiple(fit, p.category);
  const base = p.tvl_usd * multiple;
  const breadth = chainBreadth(p.chains);
  const momentum = momentumFactor(p.change_7d);
  const maturity = maturityFactor(age);
  const implied = Math.max(1000, Math.round(base * breadth * momentum * maturity));
  return { category_multiple: multiple, comparables, base_usd: Math.round(base), breadth, momentum, maturity, implied };
}

/** What a chain costs to farm on, as a single word the plan can print. */
function cheapChain(chains: string[]): boolean {
  return chains.some((c) => CHEAP_CHAINS.has(c));
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.includes('Solana') ? 'Solana' : p.chains.includes('Base') ? 'Base' : p.chains.includes('Ethereum') ? 'Ethereum' : p.chains[0] ?? 'its own chain';
  const steps: FarmStep[] = [
    { step: 'Open a wallet', detail: `Use a fresh wallet; if you already farm, keep it separate so one claim cannot link your whole book.`, cost: '$0' },
    { step: 'Bridge in', detail: `Bridge a working balance onto ${chain}; on ${cheapChain(p.chains) ? 'this chain fees are cents' : 'Ethereum fees are the real cost, so batch your moves'}.`, cost: cheapChain(p.chains) ? '$2-5' : '$15-40' },
  ];
  const cat = (p.category ?? '').toLowerCase();
  if (cat.includes('dex') || cat.includes('amm') || cat.includes('liquidity')) {
    steps.push({ step: 'Provide liquidity', detail: `Deposit into the protocol's main pair and leave it in range; volume, not size, is what points usually count.`, cost: '$500-2,000' });
    steps.push({ step: 'Trade a little', detail: 'Do a handful of small swaps a week through the protocol itself so your address shows up as a user, not just a depositor.', cost: '$20-60 in fees' });
  } else if (cat.includes('lend') || cat.includes('cdp') || cat.includes('rwa')) {
    steps.push({ step: 'Supply and borrow', detail: 'Supply the base asset, borrow a stable against it, supply that back; a loop or two is usually enough to look like a real user.', cost: '$1,000-3,000' });
    steps.push({ step: 'Keep the position open', detail: 'Points usually accrue per day, so leave the loop running and top up collateral if the market moves.', cost: 'gas only' });
  } else if (cat.includes('yield') || cat.includes('vault') || cat.includes('staking') || cat.includes('restak')) {
    steps.push({ step: 'Deposit into the vault', detail: 'Put a balance in the vault the protocol is best known for and hold it; share of the vault is what most of these count.', cost: '$500-5,000' });
    steps.push({ step: 'Re-deposit the receipt', detail: 'If a second protocol accepts the receipt token, deposit it there too: two protocols, one position.', cost: 'gas only' });
  } else if (cat.includes('bridge')) {
    steps.push({ step: 'Move value across', detail: 'Bridge both ways on a few separate days, and vary the amount: one-way dust often does not count.', cost: '$30-120 in fees' });
  } else if (cat.includes('perp') || cat.includes('deriv')) {
    steps.push({ step: 'Open a small perpetual', detail: 'Open a small long, hold it for a day, close it, repeat weekly; volume and days active are the usual weights.', cost: '$300-1,000 margin' });
  } else if (cat.includes('game') || cat.includes('social') || cat.includes('nft')) {
    steps.push({ step: 'Use the product weekly', detail: 'Sign in, mint or play each week and keep the wallet warm; streaks are what most of these reward.', cost: '$5-20' });
  } else {
    steps.push({ step: 'Use the protocol', detail: 'Make one real transaction a week through the protocol itself and keep the position visible.', cost: '$100-500' });
  }
  steps.push({
    step: 'Keep the address alive',
    detail: age !== null && age < 365
      ? 'The protocol is young: a launch within a year is plausible, so farm now and hold the position.'
      : 'The protocol has been live a while: keep a small position rather than a large one until a token is announced.',
    cost: 'small',
  });
  steps.push({ step: 'Watch for the announcement', detail: 'When the token is announced, claim from the protocol\u2019s own domain, never from a link in a chat.', cost: '$0' });
  return steps;
}

function whyText(p: SnapshotProtocol, age: number | null, b: BoardRow['implied_breakdown']): string {
  const cat = p.category ?? 'uncategorised';
  const ageText = age === null ? 'an unknown age' : age < 365 ? `${age} days old` : `${(age / 365).toFixed(1)} years old`;
  const growth = p.change_7d === null ? 'no 7-day figure' : `${p.change_7d.toFixed(2)}% over 7 days`;
  return `${p.name} holds ${p.tvl_usd.toLocaleString('en-US')} USD of TVL across ${p.chains.length} chain(s) in ${cat}, ${ageText}, with ${growth}. Live ${cat} protocols trade at ${b.category_multiple.toFixed(2)}x their TVL, so a launch at that multiple, widened for breadth (${b.breadth.toFixed(2)}x), momentum (${b.momentum.toFixed(2)}x) and maturity (${b.maturity.toFixed(2)}x), is worth about ${Math.round(b.implied_value).toLocaleString('en-US')} USD.`;
}

export function bandFor(score: number): string {
  if (score >= 80) return 'prime';
  if (score >= 60) return 'good';
  if (score >= 40) return 'workable';
  return 'thin';
}

export function buildBoard(snapshot: Snapshot, fit = fitMultiples(snapshot)): BoardRow[] {
  const rows: BoardRow[] = [];
  const watch = new Set(snapshot.watchlist);
  for (const p of snapshot.protocols) {
    if (!isLaunchCandidate(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const b = impliedValue(p, age, fit);
    const perWallet = Math.round((b.implied * AIRDROP_SHARE) / AIRDROP_WALLETS);
    const cost = cheapChain(p.chains) ? 120 : 600;
    const cheap = cheapChain(p.chains) ? 1 : 0.6;
    const youth = age === null ? 0.7 : age < 365 ? 1 : age < 1095 ? 0.8 : 0.55;
    const valueScore = clamp(Math.log10(Math.max(10, perWallet)) * 22, 0, 70);
    const score = Math.round(clamp(valueScore * cheap * youth + (watch.has(p.slug) ? 4 : 0), 0, 100));
    const row: BoardRow = {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      chain_count: p.chains.length,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      on_watchlist: watch.has(p.slug),
      implied_value_usd: b.implied,
      implied_breakdown: {
        category_multiple: b.category_multiple,
        comparables: b.comparables,
        base_usd: b.base_usd,
        breadth: b.breadth,
        momentum: b.momentum,
        maturity: b.maturity,
      },
      airdrop: {
        share: AIRDROP_SHARE,
        wallets: AIRDROP_WALLETS,
        per_wallet_usd: perWallet,
        farm_cost_usd: cost,
        score,
        band: bandFor(score),
      },
      why: whyText(p, age, { ...b, implied_value: b.implied } as never),
      farm_steps: farmSteps(p, age),
    };
    rows.push(row);
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < MIN_ROWS) return `only ${rows.length} rows: the gate wants at least ${MIN_ROWS}`;
  const have = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  if (missing.length > 0) return `the watchlist is not covered: missing ${missing.slice(0, 3).join(', ')}`;
  for (const r of rows) {
    if (!(r.implied_value_usd >= 1000)) return `${r.slug}: implied value is not positive`;
    if (r.farm_steps.length < 3) return `${r.slug}: fewer than three farm steps`;
    if (!Number.isFinite(r.airdrop.per_wallet_usd)) return `${r.slug}: no airdrop estimate`;
  }
  return null;
}

export function modelStatement(): string {
  return `Implied value = TVL x the category's own launch multiple (the median market cap over TVL of the live-token protocols in that category) x chain breadth x 7-day momentum x maturity. The airdrop column assumes ${(AIRDROP_SHARE * 100).toFixed(0)}% of an implied launch reaches early users across ${AIRDROP_WALLETS.toLocaleString('en-US')} wallets, and scores the estimate against what farming it costs.`;
}

export function radarData(snapshot: Snapshot, rows: BoardRow[], fit = fitMultiples(snapshot)): RadarData {
  const byCat = new Map<string, { rows: number; tvl: number; implied: number; multiple: number }>();
  for (const r of rows) {
    const cur = byCat.get(r.category) ?? { rows: 0, tvl: 0, implied: 0, multiple: r.implied_breakdown.category_multiple };
    cur.rows += 1;
    cur.tvl += r.tvl_usd;
    cur.implied += r.implied_value_usd;
    byCat.set(r.category, cur);
  }
  const movers = rows
    .filter((r) => r.change_7d !== null && r.tvl_usd > 50_000_000)
    .sort((a, b) => Math.abs((b.change_7d as number)) - Math.abs((a.change_7d as number)))
    .slice(0, 8)
    .map((r) => ({ name: r.name, change_7d: r.change_7d as number, tvl_usd: r.tvl_usd }));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_statement: modelStatement(),
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: rows.length,
      watchlist: snapshot.watchlist.length,
      rows: rows.length,
    },
    summary: {
      top_value: rows.slice(0, 10).map((r) => ({ name: r.name, implied_value_usd: r.implied_value_usd, category: r.category })),
      top_score: [...rows].sort((a, b) => b.airdrop.score - a.airdrop.score || a.airdrop.farm_cost_usd - b.airdrop.farm_cost_usd).slice(0, 8)
        .map((r) => ({ name: r.name, score: r.airdrop.score, per_wallet_usd: r.airdrop.per_wallet_usd, cost: r.airdrop.farm_cost_usd, chain: r.chains[0] ?? '' })),
      movers,
      categories: [...byCat.entries()]
        .map(([category, v]) => ({ category, rows: v.rows, tvl_usd: Math.round(v.tvl), implied_usd: Math.round(v.implied), multiple: Number(v.multiple.toFixed(3)) }))
        .sort((a, b) => b.implied_usd - a.implied_usd)
        .slice(0, 12),
    },
    rows,
  };
}

/** data.js: the page's whole input, written beside it so the page needs no network. */
export function dataScript(data: RadarData): string {
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}