/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function verifyLoginPassword(password) {
  if (typeof password !== "string" || password.length < 1 || password.length > 64) return null;
  let matchedIdentity = null;
  const actual = crypto.createHash("sha256").update(password, "utf8").digest();
  const credentials = [
    { identity: "person1", password: process.env.DIARY_PERSON1_PASSWORD },
    { identity: "person2", password: process.env.DIARY_PERSON2_PASSWORD },
  ];
  for (const credential of credentials) {
    if (typeof credential.password !== "string" || !credential.password) continue;
    const expected = crypto.createHash("sha256").update(credential.password, "utf8").digest();
    if (safeEqual(actual, expected)) matchedIdentity = credential.identity;
  }
  return matchedIdentity;
}

function createWriterToken(identity, secret, now = Date.now()) {
  if ((identity !== "person1" && identity !== "person2") || !secret) throw new Error("Writer token configuration is unavailable");
  const payload = Buffer.from(JSON.stringify({ version: 1, identity, issuedAt: now, expiresAt: now + TOKEN_TTL_MS })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyWriterToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest("base64url");
  if (!safeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload?.version !== 1 || (payload.identity !== "person1" && payload.identity !== "person2")) return null;
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) return null;
    return { identity: payload.identity, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

module.exports = { createWriterToken, verifyLoginPassword, verifyWriterToken };
