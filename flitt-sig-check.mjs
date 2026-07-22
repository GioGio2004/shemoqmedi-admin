// Flitt signature self-test — validates the algorithm implemented in
// convex/flitt.ts (flittSignature) against two independent references:
//
//  1. The documented joined-string example from
//     https://docs.flitt.com/api/building-signature/
//  2. The official Flitt node-js-sdk `genSignature`
//     (https://github.com/flittpayments/node-js-sdk/blob/main/lib/util.js),
//     reproduced verbatim below, over the create-order docs request.
//
// NOTE: the literal signature value shown in the create-order docs example
// ("7f52380c...") is NOT reproducible from its own params with key "test" —
// it is a docs artifact. The authoritative references are the ones above.
//
// Run: node flitt-sig-check.mjs
import { createHash } from "node:crypto";

// ── Mirror of convex/flitt.ts flittSignature (node:crypto instead of subtle) ──
function flittSignature(secretKey, params) {
  const parts = [secretKey];
  for (const key of Object.keys(params).sort()) {
    if (key === "signature" || key === "response_signature_string") continue;
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(String(value));
  }
  const joined = parts.join("|");
  return { joined, signature: createHash("sha1").update(joined, "utf8").digest("hex") };
}

// ── Verbatim official Flitt node-js-sdk genSignature (lib/util.js) ──────────
function sdkGenSignature(data, secret) {
  const ordered = {};
  Object.keys(data).sort().forEach(function (key) {
    if (data[key] !== "" && key !== "signature" && key !== "response_signature_string") {
      ordered[key] = data[key];
    }
  });
  const signString = secret + "|" + Object.values(ordered).join("|");
  return createHash("sha1").update(signString).digest("hex");
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
  if (detail) console.log(detail);
  if (!ok) failures++;
}

// ── Test 1: building-signature docs example (documented joined string) ──────
{
  const params = {
    order_id: "TestOrder2",
    order_desc: "Test payment",
    currency: "GEL",
    amount: "1000",
    merchant_id: "1549901",
    server_callback_url: "http://myshop/callback/",
    lang: "", // empty values must be dropped (no empty "|" slot)
    signature: "must-be-ignored",
  };
  const expectedJoined =
    "test|1000|GEL|1549901|Test payment|TestOrder2|http://myshop/callback/";
  const { joined, signature } = flittSignature("test", params);
  check(
    "docs building-signature joined-string example",
    joined === expectedJoined,
    `  joined:   ${joined}\n  expected: ${expectedJoined}\n  sha1:     ${signature}`,
  );
}

// ── Test 2: parity with the official SDK over the create-order docs request ──
{
  const params = {
    version: "1.0.1",
    order_id: "test_order_id_132412412",
    currency: "GEL",
    merchant_id: 1549901,
    order_desc: "Test order",
    amount: 10025,
    response_url: "https://example.com/thankyoupage",
    server_callback_url: "https://example.com/api/callback",
  };
  const ours = flittSignature("test", params).signature;
  const sdk = sdkGenSignature(params, "test");
  check("parity with official node-js-sdk (create-order request)", ours === sdk,
    `  ours: ${ours}\n  sdk:  ${sdk}`);
}

// ── Test 3: parity with the SDK over a callback-shaped payload ──────────────
{
  const payload = {
    order_id: "bag_jd7abc123",
    merchant_id: 1549901,
    payment_id: 805243692,
    order_status: "approved",
    response_status: "success",
    amount: "200",
    actual_amount: "200",
    currency: "GEL",
    actual_currency: "GEL",
    masked_card: "444455XXXXXX1111",
    tran_type: "purchase",
    rectoken: "", // empty → dropped
    signature: "deadbeef",
    response_signature_string: "**********|200|...",
  };
  const ours = flittSignature("test", payload).signature;
  const sdk = sdkGenSignature(payload, "test");
  check("parity with official node-js-sdk (callback payload)", ours === sdk,
    `  ours: ${ours}\n  sdk:  ${sdk}`);
}

process.exit(failures === 0 ? 0 : 1);
