#!/usr/bin/env node
"use strict";

/*
 * Generate the reviewed pricing candidate from Cursor's documentation.
 *
 * The extension never runs this script and never requests Cursor docs.
 * Review the generated extension/pricing.json before publishing it.
 */

const fs = require("node:fs");
const path = require("node:path");
const { money, displayName, slug } = require("../extension/lib/pricing");

const CATALOG_URL = "https://cursor.com/docs/models-and-pricing.md";
const CSV_OUTPUT = path.join(__dirname, "..", "pricing.csv");
const JSON_OUTPUT = path.join(__dirname, "..", "extension", "pricing.json");

const CSV_COLUMNS = [
  "id", "displayName", "baseModel", "isBase", "mode", "context",
  "contextMinTokens", "contextLimit", "input", "cacheRead",
  "cacheWrite", "output",
  "detailRateSource", "detailInput", "detailCacheRead",
  "detailCacheWrite", "detailOutput", "inputMultiplier",
  "cacheReadMultiplier", "cacheWriteMultiplier", "outputMultiplier",
];

function strip(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\\`/g, "`")
    .trim();
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function modelsToCsv(models) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const [id, model] of Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(column === "id" ? id : model[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function rows(markdown) {
  return String(markdown).split(/\r?\n/).flatMap((line) => {
    const text = line.trim();
    if (!text.startsWith("|")) return [];
    const cells = text.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (cells.length < 6 || /^:?-+:?$/.test(cells[0]) || /^model$/i.test(cells[0])) return [];
    return [cells];
  });
}

function linkSlug(value) {
  const match = String(value || "").match(/\]\(https:\/\/cursor\.com\/docs\/models\/([^)?#]+)\)/);
  return match ? match[1].replace(/\.md$/, "") : slug(strip(value));
}

function pageSlug(id) {
  const normalized = String(id).replace(/(\d)\.(\d)/g, "$1-$2");
  return normalized.startsWith("composer-") ? `cursor-${normalized}` : normalized;
}

function catalogModels(markdown) {
  const result = {};
  for (const cells of rows(markdown)) {
    const [rawName, , input, cacheWrite, cacheRead, output, notes] = cells;
    if (!/[a-z]/i.test(rawName) || !/[\d$]/.test(input)) continue;
    const name = displayName(strip(rawName));
    const id = linkSlug(rawName);
    const fast = /\bfast\b/i.test(name);
    const baseModel = id.replace(/-fast$/, "");
    result[id] = {
      displayName: name,
      baseModel,
      isBase: !fast,
      mode: fast ? "fast" : "standard",
      context: "default",
      detailRateSource: "none",
      detailInput: null,
      detailCacheRead: null,
      detailCacheWrite: null,
      detailOutput: null,
      inputMultiplier: null,
      cacheReadMultiplier: null,
      cacheWriteMultiplier: null,
      outputMultiplier: null,
      input: money(input),
      output: money(output),
      cacheRead: money(cacheRead),
      cacheWrite: money(cacheWrite),
      contextLimit: maxContext(strip(notes)),
    };
  }
  const identity = (value) => String(value)
    .toLowerCase()
    .replace(/\bfast\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join("-");
  const standardIds = Object.entries(result)
    .filter(([, model]) => model.mode === "standard" && model.context === "default")
    .map(([id, model]) => [identity(model.displayName), id]);
  for (const model of Object.values(result).filter((entry) => entry.mode === "fast")) {
    const standardId = standardIds.find(([key]) => key === identity(model.displayName))?.[1];
    if (standardId) model.baseModel = standardId;
  }
  return result;
}

function explicitRatesFromText(text, phrase = "bills at") {
  const line = String(text).match(new RegExp(`${phrase}[^.\\n]*`, "i"))?.[0] || "";
  if (!line) return null;
  const rate = (label) => {
    const match = line.match(new RegExp(`\\$(\\d+(?:\\.\\d+)?)\\/M\\s+${label}`, "i"));
    return match ? Number(match[1]) : null;
  };
  const rates = {
    input: rate("input"),
    cacheRead: rate("cache\\s+read"),
    cacheWrite: rate("cache\\s+write"),
    output: rate("output"),
  };
  if (!Object.values(rates).some((value) => value != null)) return null;
  return Object.fromEntries(Object.entries(rates).filter(([, value]) => value != null));
}

function fastRatesFromText(text, base) {
  const explicit = explicitRatesFromText(text);
  if (explicit) return explicit;
  const match = String(text).match(/(?:at|with)\s+(\d+(?:\.\d+)?)x\s+(?:the\s+)?(?:standard|base)\s+(?:rates?|pricing)/i)
    || String(text).match(/fast mode is available at (\d+(?:\.\d+)?)x pricing/i);
  if (!match) return null;
  const factor = Number(match[1]);
  const scale = (value) => Math.round(value * factor * 1000000) / 1000000;
  return {
    input: scale(base.input),
    output: scale(base.output),
    cacheRead: scale(base.cacheRead),
    cacheWrite: scale(base.cacheWrite),
  };
}

function fastFactor(text) {
  const match = String(text).match(/(?:at|with)\s+(\d+(?:\.\d+)?)x\s+(?:the\s+)?(?:standard|base)\s+(?:rates?|pricing)/i)
    || String(text).match(/fast mode is available at (\d+(?:\.\d+)?)x pricing/i);
  return match ? Number(match[1]) : null;
}

function multiplier(text, kind) {
  const patterns = {
    input: [
      /input pricing doubles/i,
      /input pricing is (\d+(?:\.\d+)?)x/i,
      /at (\d+(?:\.\d+)?)x the (?:fast )?input/i,
    ],
    output: [
      /output pricing is (\d+(?:\.\d+)?)x/i,
      /at (\d+(?:\.\d+)?)x the (?:fast )?output/i,
    ],
    cache: [
      /cache (?:write|read)[^\.\n]*?at (\d+(?:\.\d+)?)x/i,
      /2x the Fast input, cache write, and cache read/i,
    ],
  };
  const pattern = patterns[kind].find((candidate) => candidate.test(text));
  if (!pattern) return 0;
  const match = String(text).match(pattern);
  if (!match) return /doubles/i.test(text) && kind === "input" ? 2 : 0;
  return match[1] ? Number(match[1]) : 2;
}

function maxContext(text) {
  const match = String(text).match(/up to (\d+(?:\.\d+)?)\s*(k|m) tokens/i);
  if (!match) return null;
  return Number(match[1]) * (match[2].toLowerCase() === "m" ? 1000000 : 1000);
}

function addModelDetails(models, markdown, sourceUrl, baseId, warnings) {
  const fastId = String(markdown).match(/`([^`]+-fast)`/)?.[1];
  const base = models[baseId] || Object.values(models).find((model) => slug(model.displayName) === baseId);
  if (!base) return [];

  const added = [];
  if (fastId && !models[fastId]) {
    const rate = fastRatesFromText(markdown, base);
    if (!rate) {
      warnings.push(`${fastId}: Fast mode is documented but has no published rate`);
    } else {
      const factor = fastFactor(markdown);
      const explicit = explicitRatesFromText(markdown);
      const fast = {
        ...base,
        displayName: `${base.displayName.replace(/\s+Fast$/i, "")} Fast`,
        baseModel: base.baseModel || baseId,
        isBase: false,
        mode: "fast",
        context: "default",
        detailRateSource: factor ? "multiplier" : "explicit",
        detailInput: explicit?.input ?? null,
        detailCacheRead: explicit?.cacheRead ?? null,
        detailCacheWrite: explicit?.cacheWrite ?? null,
        detailOutput: explicit?.output ?? null,
        inputMultiplier: factor,
        cacheReadMultiplier: factor,
        cacheWriteMultiplier: factor,
        outputMultiplier: factor,
      };
      Object.assign(fast, rate);
      models[fastId] = fast;
      added.push(fastId);
    }
  }

  const limit = maxContext(markdown) || base.contextLimit;
  if (!limit) return added;
  const threshold = String(markdown).match(/(?:input|context) exceeds (\d+(?:\.\d+)?)\s*(k|m)/i);
  const inputMultiplier = multiplier(markdown, "input");
  const outputMultiplier = multiplier(markdown, "output");
  const cacheMultiplier = multiplier(markdown, "cache");
  const hasSameRates = /same (?:per-token )?rates|no separate long-context multiplier/i.test(markdown);
  if (!hasSameRates && !inputMultiplier && !outputMultiplier && !cacheMultiplier) return added;
  const factors = [
    inputMultiplier && `input × ${inputMultiplier}`,
    outputMultiplier && `output × ${outputMultiplier}`,
    cacheMultiplier && `cache × ${cacheMultiplier}`,
  ].filter(Boolean);
  const family = base.baseModel || baseId;

  for (const [id, model] of Object.entries({ ...models })) {
    if ((id !== baseId && model.baseModel !== family) || model.context !== "default") continue;
    const variant = {
      ...model,
      displayName: `${model.displayName} · ${limit / 1000000}M context`,
      baseModel: id,
      isBase: false,
      context: `${limit / 1000000}M`,
      contextMinTokens: threshold
        ? Number(threshold[1]) * (threshold[2].toLowerCase() === "m" ? 1000000 : 1000) + 1
        : null,
      detailRateSource: hasSameRates ? "same-rates" : "multiplier",
      detailInput: null,
      detailCacheRead: null,
      detailCacheWrite: null,
      detailOutput: null,
      inputMultiplier: inputMultiplier || null,
      cacheReadMultiplier: cacheMultiplier || null,
      cacheWriteMultiplier: cacheMultiplier || null,
      outputMultiplier: outputMultiplier || null,
    };
    if (!hasSameRates) {
      if (inputMultiplier) variant.input = Math.round(variant.input * inputMultiplier * 1000000) / 1000000;
      if (outputMultiplier) variant.output = Math.round(variant.output * outputMultiplier * 1000000) / 1000000;
      if (cacheMultiplier) {
        variant.cacheRead = Math.round(variant.cacheRead * cacheMultiplier * 1000000) / 1000000;
        variant.cacheWrite = Math.round(variant.cacheWrite * cacheMultiplier * 1000000) / 1000000;
      }
    }
    const variantId = `${id}-context-${limit / 1000000}m`;
    models[variantId] = variant;
  }
  return added;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "cursor-cost-pricing-refresh/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const catalog = await fetchText(CATALOG_URL);
  const models = catalogModels(catalog);
  const pages = [...new Set(Object.entries(models)
    .filter(([, model]) => model.mode === "standard" && model.context === "default")
    .map(([id]) => [id, `https://cursor.com/docs/models/${pageSlug(id)}.md`]))];
  const warnings = [];
  for (const [modelId, url] of pages) {
    try {
      addModelDetails(models, await fetchText(url), url, modelId, warnings);
    } catch (error) {
      warnings.push(error.message);
    }
  }
  const table = {
    schemaVersion: 2,
    _source: CATALOG_URL,
    _generatedAt: new Date().toISOString(),
    _review: "Generated candidate. Review uncertain or incomplete entries before publishing.",
    _warnings: warnings,
    models,
  };
  fs.writeFileSync(CSV_OUTPUT, modelsToCsv(models));
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(models).length} models to ${CSV_OUTPUT}`);
  console.log(`Wrote generated runtime JSON to ${JSON_OUTPUT}`);
  if (warnings.length) {
    console.warn(`${warnings.length} model pages could not be fetched.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
