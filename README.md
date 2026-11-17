# token-radar

<!-- GitHubリポジトリ作成済み（majika08/token-launch-radar）のため、バッジURLのプレースホルダは実値に置換済み。
     この3つのバッジ行と make.fun へのリンクは repo_readme チェックで必須（requirements の readme_template が正）。 -->

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/majika08/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/majika08/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty, model **radar-2**.
It reads the sealed DefiLlama snapshot (`/input/snapshot.json`) and ranks the protocols that
record no token yet by an implied launch value, each with a concrete farm plan (steps, cost,
time). No protocol is priced by name: the model is fitted on the snapshot itself, on every run,
so the same program would score a future snapshot it has never seen.

## Who gets ranked

A protocol is a candidate when the snapshot records no token for it (no CoinGecko id, no
symbol). Wrapped, staked, bridged and exchange products of tokens that already trade are not
launches that have not happened yet, so they are set aside: at or above the snapshot's
$50M watchlist floor the snapshot's own watchlist is the authority (the full house test uses a
parent-protocol field the snapshot does not carry), and below the floor the same documented
product test is re-run on the recorded fields (excluded categories, a version marker or a
wrapped / staked / staking word in the name, an exchange's name at its start). On this snapshot
that ranks 178 candidates — all 40 watchlist protocols among them — and sets 164 products aside.

## How a value is made

Two independent reads of the launched market, both fitted on the snapshot's launched protocols
(a recorded market cap above zero; 128 of them here), blended in log space:

- **Category comps** — TVL × the protocol category's own median market-cap/TVL among launched
  protocols, shrunk toward the global median (a prior worth 4 observations) so thin categories
  borrow the market's centre.
- **Size curve** — a least-squares fit of log(market cap) on log(TVL) over the same launched
  set; its slope (about 0.52 here) prices size itself, since value grows slower than TVL.

The blend (0.4 comps / 0.6 curve) is the weighting that best reproduced the launched set the
reads were fitted on. Two stated adjustments follow from the candidate's own record: its 7-day
TVL change, clamped to [−60%, +150%], and a maturity factor for time tracked without a token
(up to ×1.2 over four years; an unknown listing date takes the candidates' median age). Every
row of `board.json` carries its full breakdown (multiple, both reads, blended base, both
adjustments), and the dashboard's detail view shows the same numbers.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node.js 22.18 or later, standard library only, no build step. The program writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory,
deterministically: two runs over the same snapshot produce identical bytes. The dashboard is a
static page (`dashboard/index.html`) that reads the generated `data.js`: sortable, filterable,
with a per-protocol detail view and the model's own workings. It needs no network.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
