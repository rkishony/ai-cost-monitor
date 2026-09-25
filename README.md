# AI Cost Monitor

**Local cost estimates for Cursor** — see what each chat and model likely costs, without sending your prompts to a third party.

[Install on Cursor (Open VSX)](https://open-vsx.org/extension/rkishony/ai-cost) · [Pricing table](https://rkishony.github.io/ai-cost-monitor/) · [Issues](https://github.com/roykishony/cursor-addon/issues)

## What you get

- **Status bar** total and per-chat breakdown in the editor
- **Token-level estimates** (input, output, cache read/write) using reviewed model rates
- **Optional badges** in chat and the model picker (experimental)
- **Plan / usage** view when Cursor’s usage API is enabled

Everything runs **on your machine**. The extension author does not receive your chats or usage.

## Pricing data

This repository holds the **published** pricing table the extension downloads:

| File | Purpose |
|------|---------|
| [`extension/pricing.json`](extension/pricing.json) | Machine-readable rates (default `cursorCost.pricingUrl`) |
| [`pricing.csv`](pricing.csv) | Human-reviewed source |
| [`docs/index.html`](https://rkishony.github.io/ai-cost-monitor/) | Browseable rate table (GitHub Pages) |

Rates are **estimates** based on [Cursor’s public model docs](https://cursor.com/docs/models-and-pricing). Real billing can differ (routing, caching, plan limits, hidden context). Always verify with Cursor.

## Install

1. Open Cursor → Extensions
2. Search **AI Cost Monitor** or install from [Open VSX](https://open-vsx.org/extension/rkishony/ai-cost)
3. Click the **$** in the status bar to open details

On first run the extension fetches `pricing.json` from this repo and caches it locally.

## Privacy

- Request metadata and token counts stay in local extension storage
- Optional usage API uses your existing Cursor sign-in to read dashboard data — cached locally only
- **No analytics or telemetry** from the extension

## Updating this table

Maintainers regenerate files from the private [`cursor-addon`](https://github.com/roykishony/cursor-addon) repo (`npm run publish-pricing`), review the diff here, then push. Users pick up new rates when the extension refreshes pricing (automatically on upgrade or via **AI Cost: Refresh Pricing**).

## License

Pricing data is maintained for the MIT-licensed AI Cost Monitor extension. See the extension repository for license terms.
