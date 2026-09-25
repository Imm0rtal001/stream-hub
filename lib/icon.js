'use strict';
// StreamHub's own icon (the double-arrow "signal" mark used in the control
// centre's favicon), as a self-contained data: URI. Used as the Stremio
// manifest's `logo`, so the addon shows its own identity instead of a
// generic placeholder, with no external image host to depend on.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#3147e8"/>
<path d="M14 22h18m0 0 8-8m-8 8 8 8M50 42H32m0 0 8-8m-8 8 8 8"
  stroke="#ffffff" stroke-width="4.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const ICON_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;

module.exports = { ICON_DATA_URI };
