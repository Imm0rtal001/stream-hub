"use strict";
/**
 * Vercel entry point. Combined with the rewrite rule in vercel.json (every
 * path -> this function), this lets the one Express app in ../app.js serve
 * the whole addon: /manifest.json, /stream/:type/:id.json, /configure,
 * /admin, and /api/admin/* all arrive here and are routed internally by
 * Express exactly as they are on a traditional Node host.
 *
 * Vercel's Node runtime supports handing it an Express app directly (it
 * wraps the (req, res) => app(req, res) call for you), so no .listen() and
 * no manual req/res adaptation is needed here.
 */
module.exports = require("../app");
