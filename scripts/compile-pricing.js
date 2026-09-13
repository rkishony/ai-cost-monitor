#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CSV_INPUT = path.join(__dirname, "..", "pricing.csv");
const JSON_OUTPUT = path.join(__dirname, "..", "extension", "pricing.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (const character of String(text)) {
    if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) throw new Error("pricing.csv is empty");
  const headers = rows.shift();
  return rows.filter((values) => values.some(Boolean)).map((values) => (
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
  ));
}

function numberOrNull(value) {
  if (value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid number: ${value}`);
  return number;
}

function csvToModels(rows) {
  const models = {};
  for (const row of rows) {
    if (!row.id || models[row.id]) throw new Error(`duplicate or missing model id: ${row.id}`);
    models[row.id] = {
      displayName: row.displayName,
      baseModel: row.baseModel,
      isBase: row.isBase.toLowerCase() === "true",
      mode: row.mode,
      context: row.context,
      contextMinTokens: numberOrNull(row.contextMinTokens),
      contextLimit: numberOrNull(row.contextLimit),
      detailRateSource: row.detailRateSource,
      detailInput: numberOrNull(row.detailInput),
      detailCacheRead: numberOrNull(row.detailCacheRead),
      detailCacheWrite: numberOrNull(row.detailCacheWrite),
      detailOutput: numberOrNull(row.detailOutput),
      inputMultiplier: numberOrNull(row.inputMultiplier),
      cacheReadMultiplier: numberOrNull(row.cacheReadMultiplier),
      cacheWriteMultiplier: numberOrNull(row.cacheWriteMultiplier),
      outputMultiplier: numberOrNull(row.outputMultiplier),
      input: numberOrNull(row.input),
      cacheRead: numberOrNull(row.cacheRead),
      cacheWrite: numberOrNull(row.cacheWrite),
      output: numberOrNull(row.output),
    };
  }
  return models;
}

const rows = parseCsv(fs.readFileSync(CSV_INPUT, "utf8"));
const models = csvToModels(rows);
const table = {
  schemaVersion: 2,
  _source: "pricing.csv",
  _generatedAt: new Date().toISOString(),
  _review: "Compiled from the reviewed pricing.csv.",
  models,
};
fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(table, null, 2)}\n`);
console.log(`Compiled ${Object.keys(models).length} models to ${JSON_OUTPUT}`);
