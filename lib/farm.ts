// Farm plans: one plan per board row, generated from the protocol's own record.
//
// A plan is six steps. The shape never changes (set up, take the core position, deepen it, keep a
// weekly routine, hold through the qualifying window, stay ready to claim or exit) but the words
// do: the core actions come from the protocol's category group, the amounts from its TVL band,
// the gas figures from its first chain, and the holding window from its age. Every step states
// what it costs and how long it takes, in the step itself, because a plan without a price and a
// clock is not a plan. No protocol name is special-cased: two protocols with the same category,
// chain, size and age get the same plan, and that is the point.

import type { SnapshotProtocol } from './model.ts';

/** The category groups the templates are written for, resolved from the snapshot's category. */
type Group =
  | 'dex'
  | 'lending'
  | 'cdp'
  | 'derivatives'
  | 'yield'
  | 'allocator'
  | 'staking'
  | 'rwa'
  | 'chain'
  | 'payments'
  | 'prediction'
  | 'insurance'
  | 'indexes'
  | 'generic';

const GROUP_BY_CATEGORY: Record<string, Group> = {
  Dexs: 'dex',
  Lending: 'lending',
  'Uncollateralized Lending': 'lending',
  'Collateral Markets': 'lending',
  CDP: 'cdp',
  'CDP Manager': 'cdp',
  Derivatives: 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  'Basis Trading': 'derivatives',
  'Leveraged Farming': 'derivatives',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  Farm: 'yield',
  'Liquidity Manager': 'yield',
  'Risk Curators': 'allocator',
  'Onchain Capital Allocator': 'allocator',
  'Staking Pool': 'staking',
  Restaking: 'staking',
  RWA: 'rwa',
  'Dual-Token Stablecoin': 'rwa',
  'Stablecoin Wrapper': 'rwa',
  Chain: 'chain',
  Payments: 'payments',
  'Crypto Card Issuer': 'payments',
  'Prediction Market': 'prediction',
  Insurance: 'insurance',
  Indexes: 'indexes',
};

function groupOf(p: SnapshotProtocol): Group {
  if (p.category !== null && GROUP_BY_CATEGORY[p.category] !== undefined) return GROUP_BY_CATEGORY[p.category]!;
  return 'generic';
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain to spread activity over, when the protocol runs on more than one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Gas for one transaction on the protocol's first chain: mainnet is dear, the rest is not. */
function gasFor(chain: string): { one: string; weekly: string } {
  if (chain === 'Ethereum') return { one: 'about $10-15 of ETH gas', weekly: 'about $10 of ETH gas a week' };
  if (chain === 'Solana') return { one: 'under $1 of SOL fees', weekly: 'under $1 of SOL fees a week' };
  if (chain === 'Bitcoin') return { one: 'about $3 of BTC fees', weekly: 'about $3 of BTC fees a week' };
  return { one: 'about $2 of gas', weekly: 'about $2 of gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A small deterministic pick between two phrasings, from the slug, so plans are not one stencil. */
function variant(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 997;
  return h % 2;
}

/** The two middle steps of a plan: the core position for the category group, then deepening it. */
function coreSteps(group: Group, name: string, chain: string, second: string | null, capital: number, gas: { one: string; weekly: string }): [string, string] {
  const spread = second !== null ? `, and repeat a smaller version on ${second}` : '';
  switch (group) {
    case 'dex':
      return [
        `Swap about $${capital} of volume through ${name} on ${chain}, split across at least three pairs, so the wallet shows real trading rather than one wash trade. Cost: ${gas.one} plus normal swap fees. Time: 20 minutes.`,
        `Provide $${capital} of two-sided liquidity to ${name}'s most active pool on ${chain}${spread}. Cost: the $${capital} stays in the pool, plus ${gas.one} to enter. Time: 15 minutes to set up.`,
      ];
    case 'lending':
      return [
        `Supply $${capital} of USDC (or the chain's main stable) to ${name} on ${chain} and leave the deposit untouched. Cost: the $${capital} stays supplied, plus ${gas.one}. Time: 10 minutes.`,
        `Borrow about 30% against that deposit and repay it once, so the wallet has a full supply-borrow-repay cycle on ${name}'s record${spread}. Cost: ${gas.one} per leg and a few cents of interest. Time: 15 minutes.`,
      ];
    case 'cdp':
      return [
        `Deposit $${capital} of collateral into a ${name} vault on ${chain} and mint about half of it as the protocol's stablecoin. Cost: the $${capital} stays locked, plus ${gas.one}. Time: 15 minutes.`,
        `Hold the minted stablecoin (or place it in ${name}'s own stability pool) and top the vault up once so its health factor stays comfortable${spread}. Cost: ${gas.one} for the top-up. Time: 10 minutes.`,
      ];
    case 'derivatives':
      return [
        `Deposit $${capital} of USDC as margin on ${name} (${chain}) and open one small hedged position, long and short legs of similar size. Cost: the $${capital} stays as margin, plus ${gas.one}. Time: 20 minutes.`,
        `Trade to a steady weekly volume on ${name} with small orders rather than one large one, and keep the hedge on${spread}. Cost: trading fees of roughly 0.05% per fill, plus ${gas.weekly}. Time: 20 minutes a week.`,
      ];
    case 'yield':
      return [
        `Deposit $${capital} into ${name}'s main vault or pool on ${chain} and keep the receipt shares in the same wallet. Cost: the $${capital} stays deposited, plus ${gas.one}. Time: 10 minutes.`,
        `Harvest the vault's rewards once and restake them into the same ${name} position, so the record shows compounding rather than a single deposit${spread}. Cost: ${gas.one}. Time: 10 minutes.`,
      ];
    case 'allocator':
      return [
        `Allocate $${capital} into one of ${name}'s curated vaults on ${chain}, choosing the vault with the longest track record rather than the highest headline yield. Cost: the $${capital} stays allocated, plus ${gas.one}. Time: 15 minutes.`,
        `Keep the vault shares through at least one curator rebalance on ${name} and add a small second deposit${spread}. Cost: ${gas.one} for the second deposit. Time: 10 minutes.`,
      ];
    case 'staking':
      return [
        `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet. Cost: the $${capital} stays staked, plus ${gas.one}. Time: 10 minutes.`,
        `Use the receipt token once inside ${name}'s own app (as collateral or in its paired pool) so the wallet shows the full staking loop${spread}. Cost: ${gas.one}. Time: 15 minutes.`,
      ];
    case 'rwa':
      return [
        `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} through its own app and hold it in the farming wallet. Cost: the $${capital} stays in the asset, plus ${gas.one}. Time: 15 minutes.`,
        `Let one full yield cycle accrue on the ${name} position and claim the yield once, so the record shows a completed hold-and-claim cycle${spread}. Cost: ${gas.one} to claim. Time: 10 minutes.`,
      ];
    case 'chain':
      return [
        `Bridge $${capital} onto ${name}'s network and make it the wallet's home chain for this farm: fund the wallet with the chain's gas token first. Cost: the $${capital} moves chains, plus ${gas.one} in bridge and gas fees. Time: 20 minutes.`,
        `Use two of the network's native apps (a swap and a lending market) from the same wallet, so the chain record shows a resident, not a passer-by. Cost: ${gas.one} per app. Time: 20 minutes.`,
      ];
    case 'payments':
      return [
        `Fund a ${name} account or wallet with $${capital} on ${chain} and make it the wallet you pay from for this farm. Cost: the $${capital} sits as balance, plus ${gas.one} to fund. Time: 10 minutes.`,
        `Route real small payments through ${name} each week (top-ups, transfers, card spend where offered) instead of one large transfer${spread}. Cost: normal payment fees only. Time: 5 minutes a week.`,
      ];
    case 'prediction':
      return [
        `Fund $${capital} on ${name} (${chain}) and take small positions in its three most liquid markets, sized so no single market holds more than a third. Cost: the $${capital} is the position budget, plus ${gas.one}. Time: 20 minutes.`,
        `Roll each settled position's proceeds into the next liquid market on ${name} rather than withdrawing, so the account shows continuous participation${spread}. Cost: market spreads only. Time: 15 minutes a week.`,
      ];
    case 'insurance':
      return [
        `Commit $${capital} to ${name}'s underwriting pool on ${chain} (or buy a matching amount of cover, if the pool side is closed) and keep the position open. Cost: the $${capital} stays committed, plus ${gas.one}. Time: 15 minutes.`,
        `Renew or extend the ${name} position once before it lapses, so the record spans two cover periods${spread}. Cost: ${gas.one} plus the second period's premium share. Time: 10 minutes.`,
      ];
    case 'indexes':
      return [
        `Mint $${capital} of ${name}'s index token on ${chain} through its own app and hold the token in the farming wallet. Cost: the $${capital} stays in the index, plus ${gas.one}. Time: 10 minutes.`,
        `Hold through one index rebalance on ${name} and add a small second mint afterwards, so the record shows a holder, not a flipper${spread}. Cost: ${gas.one}. Time: 10 minutes.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open. Cost: the $${capital} stays deposited, plus ${gas.one}. Time: 10 minutes.`,
        `Use ${name}'s second core feature once (a vote, a second pool, a borrow, whichever the app leads with) so the wallet's record is more than a single deposit${spread}. Cost: ${gas.one}. Time: 15 minutes.`,
      ];
  }
}

/** The weekly routine step for the group: what to repeat, what it costs, how long it takes. */
function routineStep(group: Group, name: string, gas: { one: string; weekly: string }, v: number): string {
  const weekly: Record<Group, [string, string]> = {
    dex: [
      `Repeat a small swap on ${name} every week and leave the LP position untouched between visits.`,
      `Repeat a small swap on ${name} every week and rebalance the LP position only if it drifts out of range.`,
    ],
    lending: [
      `Check the ${name} position weekly: confirm the deposit is intact and the borrow (if any) is well collateralised.`,
      `Add a small top-up deposit to ${name} every second week so the account shows continuing use, not a parked lump.`,
    ],
    cdp: [
      `Check the ${name} vault's health factor weekly and top up collateral before it ever becomes urgent.`,
      `Review the ${name} vault weekly and repay a slice of the minted debt once, then mint again, to keep the cycle active.`,
    ],
    derivatives: [
      `Keep the hedged position on ${name} balanced weekly: resize the lagging leg instead of closing both.`,
      `Log one small trade on ${name} every week, win or lose, so the volume record is a steady line rather than a spike.`,
    ],
    yield: [
      `Harvest and restake ${name}'s rewards weekly, even when the amount is small, so every week carries a transaction.`,
      `Check the ${name} vault weekly and move the position only if a clearly better vault in the same app appears.`,
    ],
    allocator: [
      `Review the ${name} vault allocation weekly and follow the curator's rebalances without withdrawing.`,
      `Add a small deposit to the ${name} vault every second week so the allocation grows like a saver's, not a tourist's.`,
    ],
    staking: [
      `Confirm weekly that the ${name} receipt token is still in the wallet and claim any staking rewards into the same position.`,
      `Restake ${name}'s rewards weekly, even small ones, so the staked balance compounds on the record.`,
    ],
    rwa: [
      `Check the ${name} position weekly and let the yield accrue; claim only when a full cycle has passed.`,
      `Add a small second purchase of the ${name} asset every second week to build the position gradually.`,
    ],
    chain: [
      `Make two or three ordinary transactions on the network every week (a swap, a transfer, a vote) from the same wallet.`,
      `Use one new native app on the network each week, always from the same wallet, to widen the activity record.`,
    ],
    payments: [
      `Route at least two real payments through ${name} every week; regularity is the record being built.`,
      `Keep the ${name} balance topped up weekly and pay one recurring bill or top-up from it.`,
    ],
    prediction: [
      `Take at least one new position on ${name} every week in a liquid market and let settled ones roll forward.`,
      `Review open ${name} positions weekly and close only the settled or clearly dead ones.`,
    ],
    insurance: [
      `Check the ${name} pool's capacity and your share weekly; extend cover before any gap opens.`,
      `Claim any pool rewards on ${name} weekly into the same underwriting position.`,
    ],
    indexes: [
      `Check the ${name} index composition weekly and hold through rebalances without trading around them.`,
      `Add a small mint to the ${name} index every second week so the holding grows steadily.`,
    ],
    generic: [
      `Make one qualifying action on ${name} every week (a deposit, a swap, a vote, whichever the app counts).`,
      `Return to ${name} weekly and repeat its core action once, so the record shows a regular user.`,
    ],
  };
  const text = weekly[group][v]!;
  return `${text} Cost: ${gas.weekly}. Time: 10 minutes a week.`;
}

/**
 * One protocol's farm plan: six steps, each an action with its cost and its time, derived from the
 * protocol's own record (category group, chains, TVL band, age) and nothing else.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const group = groupOf(p);
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core1, core2] = coreSteps(group, p.name, chain, second, capital, gas);
  return [
    `Set up one fresh wallet for ${p.name} only, back its seed phrase up offline, and fund it with the position capital plus gas money for ${chain}. Cost: ${gas.one} for the first funding transaction. Time: 10 minutes.`,
    core1,
    core2,
    routineStep(group, p.name, gas, variant(p.slug)),
    `Hold the ${p.name} position for at least ${hold} days without withdrawing, so the activity appears in more than one weekly snapshot of the protocol's records. Cost: the capital stays in the position for the full ${hold} days. Time: ${hold} days, checked weekly.`,
    `Before withdrawing anything, open ${p.name}'s own points or rewards page from its official app and screenshot the wallet's standing; claim only from links the protocol itself publishes, and never pay a fee to claim. Cost: nothing to check. Time: 10 minutes.`,
  ];
}
