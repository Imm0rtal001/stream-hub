'use strict';
// A tiny, dependency-free stand-in for the sliver of the real "crypto-js"
// npm package that a provider might use (Base64/Utf8/Hex WordArray-style
// encoding, MD5, HmacMD5). Byte-for-byte compatible with crypto-js for that
// slice: both ultimately run the same MD5/HMAC-MD5 algorithms over the same
// bytes, and every encoder here is a standard, unambiguous text encoding.
// sandbox.js reaches for this only if the real "crypto-js" package (listed
// in package.json) isn't installed — a provider's require("crypto-js")
// can't tell the two apart.
const crypto = require('crypto');

class WordArray {
  constructor(buf) { this.buf = buf; }
  get sigBytes() { return this.buf.length; }
  toString(encoder) { return this.buf.toString((encoder && encoder.name) || 'hex'); }
}
const toBuffer = (x) => (Buffer.isBuffer(x) ? x : x instanceof WordArray ? x.buf : Buffer.from(String(x), 'utf8'));

const Utf8 = { name: 'utf8', parse: (s) => new WordArray(Buffer.from(String(s), 'utf8')) };
const Base64 = { name: 'base64', parse: (s) => new WordArray(Buffer.from(String(s), 'base64')) };
const Hex = { name: 'hex', parse: (s) => new WordArray(Buffer.from(String(s), 'hex')) };

const MD5 = (input) => new WordArray(crypto.createHash('md5').update(toBuffer(input)).digest());
const HmacMD5 = (data, key) => new WordArray(crypto.createHmac('md5', toBuffer(key)).update(toBuffer(data)).digest());
const SHA256 = (input) => new WordArray(crypto.createHash('sha256').update(toBuffer(input)).digest());
const HmacSHA256 = (data, key) => new WordArray(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(data)).digest());

module.exports = { enc: { Utf8, Base64, Hex }, MD5, HmacMD5, SHA256, HmacSHA256, WordArray };
