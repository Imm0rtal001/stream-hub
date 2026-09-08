"use strict";
/**
 * Entry point for any host that runs a normal, persistent Node process
 * (Render, Railway, Fly.io, a VPS, or `npm start` locally).
 *
 * Deploying to Vercel instead? Use api/index.js — Vercel runs this as a
 * serverless function per request rather than a long-lived process, so it
 * doesn't call .listen() and has different filesystem constraints. See the
 * "Deploying" section in README.md for the tradeoffs between the two.
 */
const app = require("./app");
const config = require("./src/config");

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Knox Streams listening on port ${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`  Configure page:  http://localhost:${PORT}/configure`);
  // eslint-disable-next-line no-console
  console.log(`  Control centre:  http://localhost:${PORT}/admin`);
  if (config.getAdminToken() === "changeme") {
    // eslint-disable-next-line no-console
    console.warn("  WARNING: ADMIN_TOKEN is unset — using the default 'changeme'. Set it before deploying publicly.");
  }
});
