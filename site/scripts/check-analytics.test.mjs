import { test } from "node:test";
import assert from "node:assert/strict";

import { hasGatedAnalytics, hasOptOut, hasUngatedTag } from "./check-analytics.mjs";

const gate = 'if (analyticsHosts.indexOf(location.hostname) === -1) return;';
const optOut = 'if (document.cookie.indexOf(optOut + "=true") > -1) { return; }';
const page = (body) => `<script>const analyticsHosts = ["varroa.dev"];\n${body}</script>`;

test("a page carrying the gated snippet passes", () => {
  assert.equal(hasGatedAnalytics(page(gate)), true);
  assert.equal(hasUngatedTag(page(gate)), false);
});

test("the opt-out cookie check is detected, and its removal is caught", () => {
  assert.equal(hasOptOut(page(gate + optOut)), true);
  assert.equal(hasOptOut(page(gate)), false);
});

test("the opt-out passes with or without the window flag and the brace", () => {
  const withFlag =
    'if (document.cookie.indexOf(optOut + "=true") > -1) { window[optOut] = true; return; }';
  const bare = 'if (document.cookie.indexOf(optOut + "=true") > -1) return;';
  assert.equal(hasOptOut(page(withFlag)), true);
  assert.equal(hasOptOut(page(bare)), true);
});

test("an opt-out whose result is discarded is caught", () => {
  const discarded = 'var opted = document.cookie.indexOf(optOut + "=true") > -1;\nsendHit();';
  assert.equal(hasOptOut(page(discarded)), false);
});

test("an inverted opt-out comparison is caught", () => {
  const inverted = 'if (document.cookie.indexOf(optOut + "=true") < 0) { return; }';
  assert.equal(hasOptOut(page(inverted)), false);
});

test("a page with no analytics at all is caught", () => {
  assert.equal(hasGatedAnalytics("<head><title>x</title></head>"), false);
});

test("the host list alone is not enough — the gate has to run", () => {
  assert.equal(hasGatedAnalytics('<script>const analyticsHosts = ["varroa.dev"];</script>'), false);
});

test("an inverted comparison is caught: it turns the gate into an allow-all", () => {
  assert.equal(hasGatedAnalytics(page(gate.replace("===", "!=="))), false);
});

test("a dropped return is caught: the gate would fall through", () => {
  assert.equal(hasGatedAnalytics(page(gate.replace(" return;", " ;"))), false);
});

test("reformatting the gate does not fail the check", () => {
  const wrapped = "if (\n  analyticsHosts.indexOf( location.hostname ) === -1\n)\n  return;";
  assert.equal(hasGatedAnalytics(page(wrapped)), true);
});

test("the braced guard form passes: it is the same gate", () => {
  const braced = "if (analyticsHosts.indexOf(location.hostname) === -1) { return; }";
  assert.equal(hasGatedAnalytics(page(braced)), true);
});

test("a braced guard with the comparison inverted is still caught", () => {
  const braced = "if (analyticsHosts.indexOf(location.hostname) !== -1) { return; }";
  assert.equal(hasGatedAnalytics(page(braced)), false);
});

test("a braced guard whose body is not a return is still caught", () => {
  const braced = "if (analyticsHosts.indexOf(location.hostname) === -1) { log(); }";
  assert.equal(hasGatedAnalytics(page(braced)), false);
});

test("Google's stock snippet is rejected: a <script src> outruns the gate", () => {
  const stock = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>';
  assert.equal(hasUngatedTag(stock), true);
  assert.equal(hasUngatedTag(stock.replace(/"/g, "'")), true);
});

test("the retired analytics.js loader is rejected too", () => {
  assert.equal(
    hasUngatedTag('<script src="https://www.google-analytics.com/analytics.js"></script>'),
    true,
  );
});

test("the tag URL as a string inside the inline script is not a <script src>", () => {
  const inline = '<script>tag.src = "https://www.googletagmanager.com/gtag/js?id=" + id;</script>';
  assert.equal(hasUngatedTag(inline), false);
});
