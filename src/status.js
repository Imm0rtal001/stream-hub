"use strict";
/** Tracks per-provider run/test outcomes so the Control Centre can show
 * "last checked", latency, stream counts and last error without needing a
 * database. Best-effort: a failure to persist never breaks a request. */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATUS_PATH = path.join(DATA_DIR, "status.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch (_e) {
    cache = {};
  }
  return cache;
}

function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(cache, null, 2));
  } catch (_e) {
    // best-effort only
  }
}

function record(providerId, result) {
  const state = load();
  state[providerId] = Object.assign(
    { lastRunAt: new Date().toISOString() },
    result
  );
  persist();
  return state[providerId];
}

function getAll() {
  return load();
}

function get(providerId) {
  return load()[providerId] || null;
}

module.exports = { record, getAll, get };
