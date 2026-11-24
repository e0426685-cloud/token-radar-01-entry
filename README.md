# Launch Radar — token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/e0426685-cloud/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/e0426685-cloud/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/node-22-green.svg)](https://nodejs.org)

A token launch radar for the make.fun bounty [token-radar-01](https://make.fun/bounty/token-radar-01):
it reads the sealed DefiLlama snapshot, finds the protocols that record no token yet, ranks them by
implied launch value, and hands each one a concrete farm plan on a static dashboard.

## The model

A protocol with no token has no market price, so the radar prices it from its neighbours — the
protocols in the same snapshot whose tokens already trade:

- for each category, take the median market-cap/TVL ratio of that category's traded protocols;
- implied value = TVL x category multiple, adjusted for seven-day TVL momentum, for how long the
  protocol has run with no token (seasoning), and for how many chains it serves (breadth);
- wrapped, staked, bridged and exchange-house products of traded tokens are set aside: their
  launch already happened under another name.

No protocol name is special-cased: the same function scores every row, so the program ranks a
future snapshot's protocols exactly the same way. The board covers the snapshot's whole watchlist
(40 protocols) and adds the strongest early protocols below the floor — 198 rows on this snapshot.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18 or later, standard library only. It writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` (built with the vendored `vendor/makefun-board.ts`) to the output
directory, deterministically: two runs write the same bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, outputs out.
- `lib/model.ts` — the peer value model, the farm-plan generator and the board builder.
- `dashboard/` — the static page (board, filters, per-protocol detail, no network).
- `screenshots/` — the board, a protocol detail view and a filtered view.
