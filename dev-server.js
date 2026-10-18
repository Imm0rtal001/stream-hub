'use strict';
// Local development only: `npm run dev` -> http://localhost:3000
// Deliberately NOT named app.js/index.js/server.js (or src/ equivalents) —
// those filenames make Vercel's zero-config "backend framework" detector
// (Express/Hono/NestJS/generic Node) try to claim this project instead of
// respecting vercel.json's "framework": null + api/ function below.
const fs = require('fs');
const http = require('http');
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*)/.exec(line);
    const val = m && m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (m && val && !(m[1] in process.env)) process.env[m[1]] = val;
  }
}
// No Redis? Save profiles to ./data/profiles.json so the same link keeps working locally.
const hasRedis = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);
if (!hasRedis && !process.env.DATA_DIR) process.env.DATA_DIR = require('path').join(__dirname, 'data');
const { handler } = require('./lib/router');
const port = process.env.PORT || 3000;
http.createServer(handler).listen(port, () => console.log(`StreamHub running at http://localhost:${port}`));
