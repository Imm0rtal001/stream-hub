'use strict';
// A tiny, dependency-free stand-in for the sliver of the real "crypto-js"
// npm package that a provider might use (Base64/Utf8/Hex WordArray-style
// encoding, MD5, HmacMD5, AES-CBC decrypt). Byte-for-byte compatible with crypto-js for that
// slice: both ultimately run the same MD5/HMAC-MD5 algorithms over the same
// bytes, and every encoder here is a standard, unambiguous text encoding.
// sandbox.js reaches for this only if the real "crypto-js" package (listed
// in package.json) isn't installed — a provider's require("crypto-js")
// can't tell the two apart.
const crypto = require('crypto');

class WordArray {
  constructor(buf) { this.buf = buf || Buffer.alloc(0); }
  get sigBytes() { return this.buf.length; }
  /** Big-endian 32-bit words, like crypto-js's `.words`. */
  get words() {
    const padded = Buffer.concat([this.buf, Buffer.alloc((4 - (this.buf.length % 4)) % 4)]);
    const out = [];
    for (let i = 0; i < padded.length; i += 4) out.push(padded.readInt32BE(i));
    return out;
  }
  /** Appends in place (as crypto-js does) and returns this. */
  concat(other) { this.buf = Buffer.concat([this.buf, toBuffer(other)]); return this; }
  toString(encoder) { return this.buf.toString((encoder && encoder.name) || 'hex'); }
  static create(words, sigBytes) {
    if (Buffer.isBuffer(words)) return new WordArray(Buffer.from(words));
    const list = Array.isArray(words) ? words : [];
    const buf = Buffer.alloc(list.length * 4);
    list.forEach((w, i) => buf.writeInt32BE(w | 0, i * 4));
    return new WordArray(typeof sigBytes === 'number' ? buf.subarray(0, sigBytes) : buf);
  }
}
const toBuffer = (x) => (Buffer.isBuffer(x) ? x : x instanceof WordArray ? x.buf : Buffer.from(String(x), 'utf8'));

const Utf8 = { name: 'utf8', parse: (s) => new WordArray(Buffer.from(String(s), 'utf8')) };
const Base64 = { name: 'base64', parse: (s) => new WordArray(Buffer.from(String(s), 'base64')) };
const Hex = { name: 'hex', parse: (s) => new WordArray(Buffer.from(String(s), 'hex')) };

const MD5 = (input) => new WordArray(crypto.createHash('md5').update(toBuffer(input)).digest());
const HmacMD5 = (data, key) => new WordArray(crypto.createHmac('md5', toBuffer(key)).update(toBuffer(data)).digest());
const SHA256 = (input) => new WordArray(crypto.createHash('sha256').update(toBuffer(input)).digest());
const HmacSHA256 = (data, key) => new WordArray(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(data)).digest());


// AES-CBC/PKCS7 decrypt (what the Castle provider needs). Like crypto-js, a wrong
// key or corrupt input yields an empty result instead of throwing.
const AES = {
  decrypt(cipher, key, cfg = {}) {
    const k = toBuffer(key);
    const bits = { 16: 128, 24: 192, 32: 256 }[k.length];
    if (!bits) return new WordArray(Buffer.alloc(0));
    try {
      const iv = cfg.iv ? toBuffer(cfg.iv).subarray(0, 16) : Buffer.alloc(16);
      const d = crypto.createDecipheriv(`aes-${bits}-cbc`, k, iv);
      const data = Buffer.isBuffer(cipher) ? cipher : cipher instanceof WordArray ? cipher.buf : Buffer.from(String(cipher), 'base64');
      return new WordArray(Buffer.concat([d.update(data), d.final()]));
    } catch { return new WordArray(Buffer.alloc(0)); }
  },
};
const mode = { CBC: 'cbc' };
const pad = { Pkcs7: 'pkcs7' };
const lib = { WordArray };

module.exports = { enc: { Utf8, Base64, Hex }, MD5, HmacMD5, SHA256, HmacSHA256, AES, mode, pad, lib, WordArray };
