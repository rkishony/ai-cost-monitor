"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const REQUIRED_MODELS = ["grok-4.6", "composer-2.5", "gpt-5.6-sol"];
const MIN_MODELS = 20;

function stripMarkdown(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function money(value) {
  const text = stripMarkdown(value);
  if (!text || /^[-—–]|n\/a$/i.test(text)) return 0;
  const match = text.replace(/[$,]/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\(fast(?:\s+mode)?\)/g, "fast")
    .replace(/fast mode/g, "fast")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slug(value) {
  return normalizeName(value).replace(/ /g, "-");
}

function modelIdentity(value) {
  const normalized = normalizeName(value);
  if (!/\bclaude\b/.test(normalized)) return normalized;
  const family = normalized.match(/\b(opus|sonnet|haiku)\b/)?.[1];
  const version = normalized.match(/\b\d+(?:[ .]\d+)*\b/)?.[0]?.replace(/\s+/g, ".");
  if (!family || !version) return normalized;
  return `claude ${family} ${version}${/\bfast\b/.test(normalized) ? " fast" : ""}`;
}

function contextSuffix(value) {
  const text = String(value || "").toLowerCase().replace(/,/g, "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(k|m)?/);
  if (!match) return "";
  const number = Number(match[1]) * (match[2] === "m" ? 1000000 : match[2] === "k" ? 1000 : 1);
  return number >= 1000000 ? `context-${number / 1000000}m`
    : number >= 1000 ? `context-${number / 1000}k`
      : `context-${number}`;
}

function findModel(models, wanted, options = {}) {
  if (!wanted || /^(auto|default)$/i.test(String(wanted))) return null;
  const fast = Boolean(options.fast);
  const context = contextSuffix(options.context);
  const raw = String(wanted);
  const normalized = raw.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+$/, "");
  const hasFast = /\bfast\b/.test(normalizeName(raw));
  const base = normalized.replace(/-fast$/, "");
  const ids = [];
  const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  if (context) {
    if (fast && !hasFast) add(`${base}-fast-${context}`);
    add(`${base}-${context}`);
  }
  if (fast && !hasFast) add(`${base}-fast`);
  if (!fast && !context || hasFast || normalized.includes("-context-")) add(normalized);
  for (const id of ids) {
    if (models[id]) return models[id];
  }
  const direct = Object.entries(models).find(([key, model]) => {
    const display = String(model.displayName || "").toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    return ids.includes(key) || ids.includes(display) ||
      (context && contextSuffix(model.context) === context &&
        Boolean(model.mode === "fast") === (fast || hasFast) &&
        (model.baseModel === base || key.startsWith(`${base}-`)));
  });
  if (direct) return direct[1];
  const identity = modelIdentity(fast && !hasFast ? `${wanted} fast` : wanted);
  return Object.entries(models).find(([key, model]) =>
    (!context || contextSuffix(model.context) === context) &&
    (!fast || model.mode === "fast" || /\bfast\b/.test(normalizeName(key))) &&
    (modelIdentity(key) === identity || modelIdentity(model.displayName) === identity)
  )?.[1] || null;
}

function estimateModel(models) {
  const candidates = Object.values(models || {})
    .filter((model) => Number(model.input) > 0 && Number(model.output) > 0)
    .sort((a, b) => Number(a.input) + Number(a.output) - Number(b.input) - Number(b.output))
    .slice(0, 3);
  if (!candidates.length) return null;
  const average = (key) => candidates.reduce(
    (sum, model) => sum + (Number(model[key]) || 0), 0
  ) / candidates.length;
  return {
    input: average("input"),
    output: average("output"),
    cacheRead: average("cacheRead"),
    cacheWrite: average("cacheWrite"),
  };
}

function costForTurn(turn, models, estimatedModel = estimateModel(models)) {
  const model = turn.pricingSnapshot || findModel(
    models,
    turn.routed || turn._ccRouted || turn.model,
    { fast: Boolean(turn.fast), context: turn.context }
  ) || (/^(auto|default)$/i.test(String(turn.model || "")) ? estimatedModel : null);
  if (!model) return Number(turn.cost) || 0;
  return (
    (Number(turn.inn) || 0) * (Number(model.input) || 0) +
    (Number(turn.out) || 0) * (Number(model.output) || 0) +
    (Number(turn.cacheR) || 0) * (Number(model.cacheRead) || 0) +
    (Number(turn.cacheW) || 0) * (Number(model.cacheWrite) || 0)
  ) / 1e6;
}

function displayName(value) {
  return String(value || "")
    .replace(/\s*\(fast(?:\s+mode)?\)\s*/gi, " Fast")
    .replace(/\s+fast mode\s*/gi, " Fast")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRow(line) {
  const text = line.trim();
  if (!text.startsWith("|")) return null;
  const cells = text
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length < 6 || /^:?-+:?$/.test(cells[0])) return null;
  if (/^(model|plan)$/i.test(cells[0])) return null;
  if (/^model$/i.test(cells[0]) && /input/i.test(cells[2])) return null;
  return cells;
}

function parsePricingMarkdown(markdown) {
  const models = {};
  const warnings = [];
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells) continue;
    const [name, , input, cacheWrite, cacheRead, output] = cells.slice(0, 7).map(stripMarkdown);
    if (!/[a-z]/i.test(name) || !/[\d$]/.test(input)) {
      warnings.push(`skip row (no input price): ${name}`);
      continue;
    }
    const model = {
      displayName: displayName(name),
      input: money(input),
      output: money(output),
      cacheRead: money(cacheRead),
      cacheWrite: money(cacheWrite),
    };
    models[slug(name)] = model;
  }
  return { models, warnings };
}

function keepOldIds(next, old) {
  if (!old || !Object.keys(old).length) return next;
  const byName = new Map(
    Object.entries(next).map(([id, model]) => [normalizeName(model.displayName), [id, model]])
  );
  const result = {};
  const used = new Set();
  for (const [oldId, oldModel] of Object.entries(old)) {
    const hit = byName.get(normalizeName(oldModel.displayName || oldId.replace(/-/g, " ")));
    if (hit) {
      result[oldId] = hit[1];
      used.add(hit[0]);
    } else if (next[oldId]) {
      result[oldId] = next[oldId];
      used.add(oldId);
    }
  }
  for (const [id, model] of Object.entries(next)) {
    if (!used.has(id)) result[id] = model;
  }
  return result;
}

function validatePricing(models) {
  const errors = [];
  const warnings = [];
  const entries = Object.entries(models || {});
  if (entries.length < MIN_MODELS) {
    errors.push(`only ${entries.length} models (need ${MIN_MODELS})`);
  }
  for (const required of REQUIRED_MODELS) {
    if (!models[required]) errors.push(`missing ${required}`);
  }
  for (const [id, model] of entries) {
    const input = Number(model.input) || 0;
    const output = Number(model.output) || 0;
    const cacheWrite = Number(model.cacheWrite) || 0;
    const cacheRead = Number(model.cacheRead) || 0;
    if (input <= 0) errors.push(`${id} has input <= 0`);
    if (output <= 0) errors.push(`${id} has output <= 0`);
    if (cacheWrite < 0 || !Number.isFinite(cacheWrite)) {
      errors.push(`${id} has invalid cacheWrite`);
    }
    if (cacheRead < 0 || !Number.isFinite(cacheRead)) {
      errors.push(`${id} has invalid cacheRead`);
    }
    if (cacheWrite < 0 || cacheWrite > input * 3) {
      warnings.push(`${id} cacheWrite=${cacheWrite} looks off`);
    }
    if (cacheRead < 0 || cacheRead > input) {
      warnings.push(`${id} cacheRead=${cacheRead} looks off`);
    }
  }
  return { errors, warnings };
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function pricingTimestamp(table) {
  const stamp = table?._generatedAt || table?._fetchedAt || "";
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : 0;
}

function fetchJson(url, timeoutMs = 10000) {
  if (!/^https:\/\//i.test(String(url || ""))) {
    return Promise.reject(new Error("pricing URL must use HTTPS"));
  }
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "cursor-cost-extension/1.0" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchJson(new URL(response.headers.location, url).toString(), timeoutMs).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`pricing URL returned HTTP ${response.statusCode}`));
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("public pricing table is not valid JSON"));
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("public pricing request timed out")));
    request.on("error", reject);
  });
}

async function refreshPricing(bundledPath, jsonPath, statusPath, mirrorPath, options = {}) {
  const existing = readJson(jsonPath, {});
  const oldModels = existing && existing.models && typeof existing.models === "object"
    ? existing.models
    : {};
  const bundled = readJson(bundledPath, null);
  const refreshedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const status = {
    ok: false,
    partial: false,
    failed: false,
    fetchedAt: refreshedAt,
    source: "bundled",
    models: Object.keys(oldModels).length,
    errors: [],
    warnings: [],
    message: "",
  };
  const candidates = [];
  if (options.publicUrl) {
    try {
      const publicTable = await (options.fetchJson || fetchJson)(options.publicUrl, options.timeoutMs);
      candidates.push({ table: publicTable, source: "public" });
    } catch (error) {
      status.warnings.push(`public pricing unavailable: ${error.message}`);
    }
  }
  if (bundled && typeof bundled === "object" && bundled.models && typeof bundled.models === "object") {
    candidates.push({ table: bundled, source: "bundled" });
  }
  if (!candidates.length) {
    status.failed = true;
    status.errors = ["no valid pricing source available"];
    status.message = `pricing refresh FAILED: no valid pricing source; using last good (${status.models} models)`;
    writeJsonAtomic(statusPath, status);
    return { code: 1, status };
  }
  const candidate = candidates.find(({ table }) => {
    const validation = validatePricing(table.models);
    return !validation.errors.length &&
      (options.force || pricingTimestamp(table) > pricingTimestamp(existing));
  });
  if (!candidate) {
    status.ok = true;
    status.models = Object.keys(oldModels).length;
    status.message = `pricing table is current (${status.models} models)`;
    writeJsonAtomic(statusPath, status);
    return { code: 0, status };
  }
  const models = candidate.table.models;
  const validation = validatePricing(models);
  status.models = Object.keys(models).length;
  status.warnings = [...status.warnings, ...validation.warnings];
  if (validation.errors.length) {
    status.failed = true;
    status.errors = validation.errors;
    status.models = Object.keys(oldModels).length;
    status.message = `pricing refresh FAILED: ${validation.errors.join("; ")}; using last good (${status.models} models)`;
    writeJsonAtomic(statusPath, status);
    return { code: 1, status };
  }
  const table = {
    _comment: candidate.table._comment || `Prices per 1M tokens. Source: ${candidate.source} pricing (${refreshedAt.slice(0, 10)})`,
    _fetchedAt: refreshedAt,
    _generatedAt: candidate.table._generatedAt || refreshedAt,
    _status: status.warnings.length ? "partial" : "ok",
    _source: candidate.table._source || candidate.source,
    models,
  };
  writeJsonAtomic(jsonPath, table);
  if (mirrorPath && path.resolve(mirrorPath) !== path.resolve(jsonPath)) {
    writeJsonAtomic(mirrorPath, table);
  }
  status.ok = true;
  status.partial = status.warnings.length > 0;
  status.source = candidate.source;
  status.message = `pricing table refreshed from ${candidate.source}${status.partial ? " PARTIAL" : ""} (${status.models} models, ${refreshedAt.slice(0, 10)})`;
  writeJsonAtomic(statusPath, status);
  return { code: status.partial ? 2 : 0, status };
}

module.exports = {
  MIN_MODELS,
  REQUIRED_MODELS,
  contextSuffix,
  displayName,
  estimateModel,
  findModel,
  keepOldIds,
  money,
  modelIdentity,
  normalizeName,
  parsePricingMarkdown,
  costForTurn,
  fetchJson,
  pricingTimestamp,
  readJson,
  refreshPricing,
  slug,
  validatePricing,
  writeJsonAtomic,
};
