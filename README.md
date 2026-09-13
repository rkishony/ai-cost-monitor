# Cursor Cost Pricing

Public, reviewed pricing data for the private Cursor Cost VS Code extension.

## Update

```bash
npm run refresh-pricing
# Review pricing.csv and the generated data
npm run compile-pricing
```

Publish `extension/pricing.json` to the `main` branch. The extension fetches
that file over HTTPS and keeps its bundled copy as an offline fallback.
