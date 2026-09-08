"use strict";
const path = require("path");
const express = require("express");
const cors = require("cors");

const addonRouter = require("./routes/addon");
const adminRouter = require("./routes/admin");

const app = express();
app.use(cors());
app.disable("x-powered-by");

// -- Stremio addon protocol (manifest.json + stream/:type/:id.json, with an
//    optional leading base64-config path segment) -------------------------
app.use("/", addonRouter);

// -- Owner Control Centre API ----------------------------------------------
app.use("/api/admin", adminRouter);

// -- Static UI: /configure (public, per-install provider picker + install
//    link generator) and /admin (token-gated owner dashboard) -------------
app.use(express.static(path.join(__dirname, "public")));
app.get(["/", "/configure"], (req, res) => res.sendFile(path.join(__dirname, "public", "configure.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin", "index.html")));

module.exports = app;
