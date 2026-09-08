"use strict";
/**
 * A minimal, dependency-free stand-in for the `crypto-js` npm package,
 * covering only the single call site this repo actually uses:
 * CryptoJS.HmacSHA256(msg, key).toString(CryptoJS.enc.Base64).
 *
 * IMPORTANT: this is pure JS (a hand-rolled SHA-256 + HMAC), not backed by
 * Node's built-in `crypto` module. Nuvio's provider sandbox is a
 * browser-like JS runtime (it already relies on `fetch`/`atob`/`btoa`
 * elsewhere in this repo) — it is NOT Node.js, so `require("crypto")`
 * fails there even though it works fine in this addon's own Node server.
 * Base64 output uses `btoa`, matching what the rest of the codebase already
 * assumes is available; Node 18+ also provides a global `btoa`.
 *
 * Verified byte-for-byte against Node's `crypto.createHmac('sha256', ...)`
 * across ASCII, empty-string, unicode, and >64-byte-key inputs.
 */

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256(bytes) {
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
    h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  var l = bytes.length;
  var bitLen = l * 8;
  var padLen = l + 1;
  while (padLen % 64 !== 56) padLen++;
  padLen += 8;

  var padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[l] = 0x80;
  for (var i = 0; i < 8; i++) {
    padded[padLen - 1 - i] = i < 6 ? Math.floor(bitLen / Math.pow(2, 8 * i)) & 0xff : 0;
  }

  var w = new Uint32Array(64);
  for (var offset = 0; offset < padLen; offset += 64) {
    for (var j = 0; j < 16; j++) {
      var p = offset + j * 4;
      w[j] = ((padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3]) >>> 0;
    }
    for (var k = 16; k < 64; k++) {
      var s0 = rotr(w[k - 15], 7) ^ rotr(w[k - 15], 18) ^ (w[k - 15] >>> 3);
      var s1 = rotr(w[k - 2], 17) ^ rotr(w[k - 2], 19) ^ (w[k - 2] >>> 10);
      w[k] = (w[k - 16] + s0 + w[k - 7] + s1) >>> 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (var t = 0; t < 64; t++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  var out = new Uint8Array(32);
  var words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (var wi = 0; wi < 8; wi++) {
    out[wi * 4] = (words[wi] >>> 24) & 0xff;
    out[wi * 4 + 1] = (words[wi] >>> 16) & 0xff;
    out[wi * 4 + 2] = (words[wi] >>> 8) & 0xff;
    out[wi * 4 + 3] = words[wi] & 0xff;
  }
  return out;
}

function utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code > 0xffff) i++;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function concatBytes(a, b) {
  var out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function hmacSha256Bytes(keyBytes, msgBytes) {
  var blockSize = 64;
  var key = keyBytes;
  if (key.length > blockSize) key = sha256(key);
  if (key.length < blockSize) {
    var padded = new Uint8Array(blockSize);
    padded.set(key);
    key = padded;
  }
  var oKeyPad = new Uint8Array(blockSize);
  var iKeyPad = new Uint8Array(blockSize);
  for (var i = 0; i < blockSize; i++) {
    oKeyPad[i] = key[i] ^ 0x5c;
    iKeyPad[i] = key[i] ^ 0x36;
  }
  var inner = sha256(concatBytes(iKeyPad, msgBytes));
  return sha256(concatBytes(oKeyPad, inner));
}

function bytesToBase64(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesToHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    hex += h.length === 1 ? "0" + h : h;
  }
  return hex;
}

var enc = { Base64: "base64", Hex: "hex", Utf8: "utf8" };

function HmacSHA256(message, key) {
  var digestBytes = hmacSha256Bytes(utf8Bytes(String(key)), utf8Bytes(String(message)));
  return {
    toString: function (encoder) {
      return encoder === enc.Base64 ? bytesToBase64(digestBytes) : bytesToHex(digestBytes);
    },
  };
}

module.exports = { HmacSHA256: HmacSHA256, enc: enc };
