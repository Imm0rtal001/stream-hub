"use strict";
const config = require("./config");

function requireAdminToken(req, res, next) {
  const provided = req.get("x-admin-token") || req.query.token || (req.body && req.body.token);
  if (provided && provided === config.getAdminToken()) return next();
  res.status(401).json({ error: "Invalid or missing admin token." });
}

module.exports = { requireAdminToken };
