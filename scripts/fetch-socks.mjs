#!/usr/bin/env node
/**
 * Fetches "fun socks" for a specific Target store from Target's internal
 * RedSky API, diffs the result against the previously stored catalog to flag
 * genuinely new arrivals, and writes data/socks.json.
 *
 * Designed to run on GitHub Actions on a schedule. Because Target captcha-
 * blocks some datacenter IPs, this script is written to FAIL SAFE: if Target
 * blocks the request (or anything else goes wrong), it leaves the existing
 * data file untouched and exits 0, so the site keeps showing the last good
 * data and the next scheduled run (with a fresh runner IP) tries again.
 *
 * No external dependencies — uses Node 18+ global fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../lib/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "socks.json");
const PAGE_SIZE = 24;

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) =>
  Math.round((new Date(a) - new Date(b)) / 86_400_000);

function randomVisitorId() {
  // 32 hex chars, uppercase — matches the shape of Target's visitor_id.
  return randomUUID().replace(/-/g, "").toUpperCase();
}

function loadExisting() {
  if (!existsSync(DATA_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Wrap a Target URL so the request is made from a residential IP that Target
 * trusts. Target captcha-blocks datacenter IPs (Vercel, GitHub Actions, etc.),
 * so for unattended cloud runs we route through ScraperAPI's free tier
 * (https://www.scraperapi.com — 1,000 requests/month free). Set SCRAPER_API_KEY
 * as a GitHub Actions secret to enable it. Without a key, we hit Target directly
 * (which works from a residential connection, e.g. running `npm run fetch` at
 * home, but gets captcha'd from the cloud).
 */
function viaProxy(targetUrl) {
  const key = process.env.SCRAPER_API_KEY;
  // Direct: send our own browser-like headers (works from a residential IP).
  if (!key) return { url: targetUrl, forwardHeaders: true };

  const params = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    // Residential pool — required to get past Target. Costs more credits, but
    // a low-frequency fetch stays well within the free monthly allowance.
    premium: process.env.SCRAPER_PREMIUM === "false" ? "false" : "true",
    // Target is US-only and rejects/penalizes foreign exit IPs, so pin US
    // residential addresses — this is what makes the proxy reliable here.
    country_code: process.env.SCRAPER_COUNTRY || "us",
  });
  // Through ScraperAPI we let IT manage request headers — forwarding our own
  // (keep_headers) conflicts with its anti-bot handling and returns HTTP 500.
  return { url: `https://api.scraperapi.com/?${params}`, forwardHeaders: false };
}

async function fetchPage(offset, visitorId) {
  const params = new URLSearchParams({
    key: config.apiKey,
    channel: "WEB",
    count: String(PAGE_SIZE),
    default_purchasability_filter: "true",
    include_sponsored: "false",
    offset: String(offset),
    page: `/s/${config.keyword}`,
    platform: "desktop",
    keyword: config.keyword,
    pricing_store_id: config.storeId,
    store_ids: config.storeId,
    visitor_id: visitorId,
    sort_by: "newest",
  });

  const targetUrl = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;
  const { url, forwardHeaders } = viaProxy(targetUrl);

  // Browser-like headers only when hitting Target directly. Through ScraperAPI
  // we send none and let the proxy handle anti-bot headers itself.
  const headers = forwardHeaders
    ? {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://www.target.com",
        referer: "https://www.target.com/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      }
    : { accept: "application/json" };

  // The residential proxy intermittently returns 500 (it couldn't land a good
  // exit IP on that try). Retrying usually succeeds with a different IP, so we
  // attempt a few times with backoff before giving up.
  const maxTries = forwardHeaders ? 2 : 7;
  let lastErr;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response (HTTP ${res.status})`);
      }

      if (json.captchaRelativeURL || json.captchaAbsoluteURL) {
        const err = new Error("Target served a captcha (IP likely flagged)");
        err.blocked = true;
        throw err; // not retryable from the same IP context
      }
      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      }
      return json;
    } catch (err) {
      if (err.blocked) throw err;
      lastErr = err;
      if (attempt < maxTries) {
        const wait = 1500 * attempt;
        console.log(`  …retry ${attempt}/${maxTries - 1} after ${err.message}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/** Decode the HTML entities Target embeds in product titles (&#39; &#8482; …). */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Pull a product object out of RedSky's response shape, defensively. */
function normalize(p) {
  const item = p.item || {};
  const desc = item.product_description || {};
  const enrichment = item.enrichment || {};
  const imageInfo = enrichment.image_info || {};
  const price = p.price || {};
  const brand = item.primary_brand || {};

  const tcin = p.tcin || item.tcin;
  if (!tcin) return null;

  const title = decodeEntities(desc.title || "").trim();
  const image =
    imageInfo.primary_image?.url ||
    imageInfo.alternate_images?.[0]?.url ||
    null;
  const url =
    enrichment.buy_url || `https://www.target.com/p/-/A-${tcin}`;
  const priceText =
    price.formatted_current_price ||
    (price.current_retail != null ? `$${Number(price.current_retail).toFixed(2)}` : null);

  if (!title || !image) return null;

  return {
    tcin: String(tcin),
    title,
    brand: brand.name || null,
    price: priceText,
    image,
    url,
  };
}

// --- "Low + fun" filtering -------------------------------------------------
// She only wants socks that don't go above the ankle, and only the fun ones.
// Target's data has no clean length field, but the title almost always states
// it, so we filter on the title (set SOCKS_LOW_ONLY=false to disable).

// Must look low-cut…
const LOW_RE =
  /\b(no[\s-]?shows?|low[\s-]?cut|liner|footie|foot[\s-]?cover|invisible|secret|ankle)\b/i;
// …and must NOT mention anything that rises above the ankle.
const HIGH_RE =
  /\b(crew|knee[\s-]?high|knee|over[\s-]?the[\s-]?knee|otk|boot|tube|calf|thigh|mid[\s-]?crew|quarter)\b/i;
// Drop athletic / medical / plain basics — "fun" socks aren't these.
const BORING_RE =
  /\b(diabetic|yoga|pilates|compression|grippers?|grip|no[\s-]?slip|non[\s-]?slip|athletic|sports?|running|cushioned|bamboo|thermal|merino|wool|hiking|hiker|seamless|non[\s-]?binding|dress|business|trouser|nylon|microfiber|casual|solid|textured|\brib\b|sheer|nude|heel[\s-]?protection|microfibre)\b/i;
const BORING_BRANDS =
  /(all in motion|hanes|gold toe|jockey|hugh ugoli|anna-?kaci|debra weitzner|wigwam|sock panda|fruit of the loom|\bpeds\b|dr\.?\s*scholl|smartwool|bombas|\bctm\b|alilang|muk luks)/i;

function isLowFun(sock) {
  if (process.env.SOCKS_LOW_ONLY === "false") return true;
  const t = sock.title || "";
  const b = sock.brand || "";
  if (HIGH_RE.test(t)) return false; // explicitly rises above the ankle
  if (!LOW_RE.test(t)) return false; // not clearly low-cut
  if (BORING_RE.test(t)) return false; // athletic/medical basics
  if (BORING_BRANDS.test(t) || BORING_BRANDS.test(b)) return false;
  return true;
}

async function fetchAll() {
  const visitorId = randomVisitorId();
  const seen = new Map();
  for (let offset = 0; offset < config.maxProducts; offset += PAGE_SIZE) {
    const json = await fetchPage(offset, visitorId);
    const products = json?.data?.search?.products || [];
    if (products.length === 0) break;
    for (const raw of products) {
      const sock = normalize(raw);
      if (sock && isLowFun(sock) && !seen.has(sock.tcin)) seen.set(sock.tcin, sock);
    }
    // Be gentle: small pause between pages.
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
  }

  // The same design is often listed once per size (Medium, Large, …). Collapse
  // those to a single card by keying on the title with size words stripped.
  const byDesign = new Map();
  for (const sock of seen.values()) {
    const key = designKey(sock);
    if (!byDesign.has(key)) byDesign.set(key, sock);
  }
  return [...byDesign.values()];
}

/** A stable key for a sock "design", ignoring size so sizes don't duplicate. */
function designKey(sock) {
  let t = (sock.title || "").toLowerCase();
  t = t.replace(/,?\s*(x{0,2}-?(small|large)|medium|xs|sm?|md?|lg?|xl|xxl)\s*$/i, "");
  t = t.replace(/\b\d+(\.\d+)?\s*[-–]\s*\d+(\.\d+)?\b/g, " "); // shoe-size ranges
  t = t.replace(/\b\d+\s*pairs?\b/gi, " "); // "4 Pairs"
  t = t.replace(/[^a-z0-9]+/g, " ").trim();
  return `${(sock.brand || "").toLowerCase()}|${t}` || sock.image || sock.tcin;
}

function merge(existing, fetched) {
  const now = today();
  const prev = new Map((existing?.socks || []).map((s) => [s.tcin, s]));
  const result = [];

  // Update / add everything we saw this run.
  for (const sock of fetched) {
    const before = prev.get(sock.tcin);
    result.push({
      ...sock,
      firstSeen: before?.firstSeen || now,
      lastSeen: now,
    });
    prev.delete(sock.tcin);
  }

  // Keep recently-seen items we didn't see this run (likely just paged out),
  // but drop ones gone longer than dropAfterDays.
  for (const sock of prev.values()) {
    if (daysBetween(now, sock.lastSeen) <= config.dropAfterDays) {
      result.push(sock);
    }
  }

  // Newest first by firstSeen, then by lastSeen.
  result.sort(
    (a, b) =>
      b.firstSeen.localeCompare(a.firstSeen) ||
      b.lastSeen.localeCompare(a.lastSeen)
  );

  return {
    store: { id: config.storeId, name: config.storeName },
    updatedAt: new Date().toISOString(),
    lastFetchStatus: "ok",
    newWithinDays: config.newWithinDays,
    count: result.length,
    socks: result,
  };
}

async function main() {
  const existing = loadExisting();
  console.log(
    `Fetching "${config.keyword}" for store ${config.storeId} (${config.storeName})...`
  );

  let fetched;
  try {
    fetched = await fetchAll();
  } catch (err) {
    if (err.blocked) {
      console.warn("⚠️  Target blocked this runner's IP (captcha). " +
        "Leaving existing data untouched; next scheduled run will retry.");
    } else {
      console.warn(`⚠️  Fetch failed: ${err.message}. Leaving data untouched.`);
    }
    // Fail safe: don't clobber good data. Exit 0 so the workflow stays green.
    process.exit(0);
  }

  if (!fetched || fetched.length === 0) {
    console.warn("⚠️  Fetched 0 socks (unexpected). Leaving data untouched.");
    process.exit(0);
  }

  const merged = merge(existing, fetched);
  const prevCount = existing?.socks?.length || 0;
  const newArrivals = merged.socks.filter((s) => s.firstSeen === today()).length;

  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2) + "\n");

  console.log(
    `✅ Wrote ${merged.count} socks (was ${prevCount}). ` +
    `${newArrivals} new arrival(s) today.`
  );
}

// Export pure helpers for testing; only run the fetcher when executed directly.
export { normalize, merge };

// Robust "is this the entrypoint?" check that survives paths with spaces.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
