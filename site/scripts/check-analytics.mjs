#!/usr/bin/env node
// Asserts the GA4 tag's coverage and its host gate across all built output.
//
// Analytics reaches pages two different ways: brochure pages import
// Analytics.astro into their own <head>, while docs pages inherit it from the
// Starlight Head override. A new top-level page that forgets the import is
// invisible in review and ships a page that reports nothing, so coverage is
// checked here rather than trusted.
//
// The host gate is the other half. The build-time PROD gate does not cover
// `astro preview` or a fork of the public site repo, both of which serve this
// same output; the inline script's location.hostname check is what keeps their
// traffic out of the property. A static <script src> to Google would bypass it
// entirely, so that shape fails the build.
//
// Runs as postbuild because it reads dist/, which does not exist at prebuild time.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(SITE_DIR, "dist");

// Both hosts Google serves a tag loader from. gtag.js comes from the first;
// the second is Universal Analytics' analytics.js, retired upstream but still
// the shape a copy-pasted snippet can reintroduce.
const GA_LOADER_HOSTS = ["www.googletagmanager.com", "www.google-analytics.com"];

const LOADER_PATTERN = GA_LOADER_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|");

/**
 * The gate expression itself. Matching the whole expression rather than its
 * parts is what makes an inverted comparison (`!== -1`) or a dropped `return`
 * fail the build; either one silently turns the gate into an allow-all, which
 * is the failure this check exists to catch. Whitespace and an optional brace
 * are tolerated so that reformatting the guard — the shape a formatter or a
 * later edit would produce — does not fail a build over a working gate.
 */
const GATE_PATTERN =
  /analyticsHosts\s*\.\s*indexOf\s*\(\s*location\s*\.\s*hostname\s*\)\s*===\s*-1\s*\)\s*\{?\s*return\b/;

/** Every .html file under a directory, as paths relative to it. */
export function builtPages(distDir) {
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extname(entry) === ".html") pages.push(relative(distDir, full));
    }
  };
  walk(distDir);
  return pages;
}

/**
 * The `ga-disable-<id>` opt-out check. It is a stated promise in AGENTS.md and
 * the only way a visitor can turn measurement off, so its silent removal is
 * worth failing a build over.
 */
// Matched through the `return`, for the same reason as GATE_PATTERN: a lookup
// whose result is discarded, or whose comparison is inverted, reads like an
// opt-out and honors nothing.
const OPT_OUT_PATTERN =
  /document\s*\.\s*cookie\s*\.\s*indexOf\s*\(\s*optOut\s*\+\s*"=true"\s*\)\s*>\s*-1\s*\)\s*\{?\s*(?:window\s*\[\s*optOut\s*\]\s*=\s*true\s*;\s*)?return\b/;

/** True when the page carries the analytics snippet with its gate intact. */
export function hasGatedAnalytics(html) {
  return GATE_PATTERN.test(html);
}

/** True when the page honors the ga-disable-<id> opt-out cookie. */
export function hasOptOut(html) {
  return OPT_OUT_PATTERN.test(html);
}

/**
 * A <script src> pointing at a Google tag loader: fetched by the browser before
 * any of our code runs, so it defeats the host gate. `define:vars` emits the
 * URL as a string inside the inline script, which is not this shape.
 */
export function hasUngatedTag(html) {
  return new RegExp(`<script[^>]*\\ssrc=["'][^"']*(?:${LOADER_PATTERN})`).test(html);
}

function main() {
  if (!existsSync(DIST)) {
    console.error("check-analytics: dist/ not found. Run after astro build.");
    process.exit(1);
  }

  const pages = builtPages(DIST);
  const failures = [];

  for (const page of pages) {
    const html = readFileSync(join(DIST, page), "utf8");
    if (!hasGatedAnalytics(html)) {
      failures.push(
        `${page}: no host-gated analytics snippet ` +
          `(missing the Analytics.astro import, or the gate expression changed shape?)`,
      );
    }
    if (!hasOptOut(html)) {
      failures.push(`${page}: analytics snippet does not honor the ga-disable-<id> opt-out cookie`);
    }
    if (hasUngatedTag(html)) {
      failures.push(`${page}: <script src> to a Google tag loader bypasses the hostname gate`);
    }
  }

  if (failures.length) {
    console.error("check-analytics: analytics coverage/gating failures");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`check-analytics: ${pages.length} pages, all carry the host-gated GA4 tag`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
