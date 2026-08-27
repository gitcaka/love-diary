import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createWriterToken, verifyLoginPassword, verifyWriterToken } = require("../tencent/functions/love-diary-api/auth.js");

test("each identity password maps to the intended writer", () => {
  const previous1 = process.env.DIARY_PERSON1_PASSWORD;
  const previous2 = process.env.DIARY_PERSON2_PASSWORD;
  process.env.DIARY_PERSON1_PASSWORD = "test-writer-one";
  process.env.DIARY_PERSON2_PASSWORD = "test-writer-two";
  try {
    assert.equal(verifyLoginPassword("test-writer-one"), "person1");
    assert.equal(verifyLoginPassword("test-writer-two"), "person2");
    assert.equal(verifyLoginPassword("wrong-password"), null);
  } finally {
    if (previous1 === undefined) delete process.env.DIARY_PERSON1_PASSWORD;
    else process.env.DIARY_PERSON1_PASSWORD = previous1;
    if (previous2 === undefined) delete process.env.DIARY_PERSON2_PASSWORD;
    else process.env.DIARY_PERSON2_PASSWORD = previous2;
  }
});

test("writer tokens are signed, identity-bound and expire", () => {
  const secret = "test-only-signing-secret";
  const issuedAt = Date.UTC(2025, 0, 1);
  const token = createWriterToken("person1", secret, issuedAt);
  assert.deepEqual(verifyWriterToken(token, secret, issuedAt + 1), {
    identity: "person1",
    expiresAt: issuedAt + 365 * 24 * 60 * 60 * 1000,
  });
  assert.equal(verifyWriterToken(`${token}x`, secret, issuedAt + 1), null);
  assert.equal(verifyWriterToken(token, "another-secret", issuedAt + 1), null);
  assert.equal(verifyWriterToken(token, secret, issuedAt + 366 * 24 * 60 * 60 * 1000), null);
});

test("a raw legacy writer key is not a valid signed session token", () => {
  assert.equal(verifyWriterToken("legacy-writer-key", "legacy-writer-key"), null);
});
