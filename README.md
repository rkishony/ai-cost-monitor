# AI Cost Monitor

**See, track, and control Cursor AI spend.**

[Install on Cursor (Open VSX)](https://open-vsx.org/extension/rkishony/ai-cost) · [Pricing table](https://rkishony.github.io/ai-cost-monitor/) · [Issues](https://github.com/roykishony/ai-cost-monitor/issues)

## What you get

- **Real-time usage cost** while you code — live spend from your Cursor account, always visible
- **Model costs in context** — per-turn spend in chat and rates in the picker before you choose
- **Graphical spend analytics** — trends, billing periods, and breakdowns by model, project, and provider

**Your data stays local.** Cached locally. No data is sent outside. No author servers. No telemetry.

## Pricing data

This repository holds the Cursor's pricing table the extension downloads:

| File | Purpose |
|------|---------|
| [`extension/pricing.json`](extension/pricing.json) | Machine-readable rates (default `cursorCost.pricingUrl`) |
| [`pricing.csv`](pricing.csv) | Human-reviewed source |
| [`docs/index.html`](https://rkishony.github.io/ai-cost-monitor/) | Browseable rate table (GitHub Pages) |

Not official rates. Rates are scrapped from [Cursor’s public model docs](https://cursor.com/docs/models-and-pricing).

## Install

1. Open Cursor → Extensions
2. Search **AI Cost Monitor** or install from [Open VSX](https://open-vsx.org/extension/rkishony/ai-cost)
3. Click the **$** in the status bar to open details

## Privacy

- Only pulls usage from Cursor and public pricing from GitHub ([Pricing table](https://rkishony.github.io/ai-cost-monitor/)). 
- Request metadata and token counts stay in local extension storage.
- Cursor usage API uses your existing Cursor sign-in to read dashboard data — cached locally only.
- **No analytics or telemetry** is sent from the extension.

## License

MIT — [LICENSE](LICENSE).
