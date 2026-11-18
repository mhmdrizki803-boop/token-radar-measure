# token-radar-measure

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mhmdrizki803-boop/token-radar-measure/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mhmdrizki803-boop/token-radar-measure/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Reads the sealed DefiLlama snapshot, keeps every protocol that records no token and is not a wrapped,
staked, bridged or versioned product, and ranks them by what their launch would be worth: TVL times
the launch multiple the live protocols in the same category trade at, widened for chain breadth,
7-day momentum and maturity. Each row carries an airdrop estimate and a farm plan, and the dashboard
shows the board, a filterable table, a per-protocol detail view and two charts — with no network at
all.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=hyy9rcmd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
