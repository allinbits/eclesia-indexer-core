---
"@eclesia/core-modules-pg": patch
---

Bank: mints and burns are no longer counted twice. The SDK's bank keeper emits `coin_received` for a mint and `coin_spent` for a burn, and then emits `coinbase` / `burn` in addition; the module applied both, so a minting module account gained the minted amount every block (the AtomOne mint account showed 5,500 ATONE after 1,700 blocks where the chain shows 0) and burned deposits were subtracted twice. Only `coin_spent` and `coin_received` move balances now. On CometBFT 0.38 chains this was hidden until 2.16.0 because begin-block events were dropped entirely before the `mode` attribute fix; on 0.37 chains it affected every mint and burn.
