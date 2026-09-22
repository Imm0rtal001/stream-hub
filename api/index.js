'use strict';
// The single Vercel Function every request is rewritten to (see vercel.json).
// lib/router.js does all real path routing from req.url, which Vercel
// preserves as the original incoming path for rewrites under the classic
// ("framework": null) build — not the rewrite destination.
const { handler } = require('../lib/router');
module.exports = handler;
