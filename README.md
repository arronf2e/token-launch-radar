# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arronf2e/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arronf2e/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks the protocols in a sealed DefiLlama snapshot that still record no token by an
implied launch value, and gives each one a concrete farm plan. The value model is a peer-multiple
model: a protocol's TVL is multiplied by the median market-cap/TVL of live protocols in its own
category (shrunk toward the global median), then adjusted for 7-day TVL momentum, for how long it
has run with no token, and for chain breadth. Every multiple names the live peers behind it and
grades its own evidence (deep, fair or thin), so a claim carried by one loud peer reads differently
from one carried by a whole category. Wrapped, staked and bridged products of tokens that already
trade are set aside, never ranked. The dashboard is a static page — a sortable, filterable board,
a detail page per protocol with the model's arithmetic in full, and the live-token market shown
for scale.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Locally, point `--input` at the `snapshot.json` from the competition kit
(`--input ../token-radar-01-kit/input/snapshot.json`). The program writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` into the output directory; two runs on the same
snapshot write the same bytes. Node.js 22.18 or later, standard library only.

---
<sub>Entered on [make.fun](https://make.fun/?ref=g0z5v85z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
