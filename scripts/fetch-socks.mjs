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
  if (!key) return { url: targetUrl, forwardHeaders: true };

  const params = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    keep_headers: "true",
    // Residential pool — needed to get past Target. Costs more credits, but a
    // once-a-day fetch stays well within the free monthly allowance.
    premium: process.env.SCRAPER_PREMIUM === "false" ? "false" : "true",
  });
  // ScraperAPI forwards our headers when keep_headers=true.
  return { url: `https://api.scraperapi.com/?${params}`, forwardHeaders: true };
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
  const { url } = viaProxy(targetUrl);
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      origin: "https://www.target.com",
      referer: "https://www.target.com/",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
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
    throw err;
  }
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

/** Pull a product object out of RedSky's response shape, defensively. */
function normalize(p) {
  const item = p.item || {};
  const desc = item.product_description || {};
  const enrichment = item.enrichment || {};
  const images = enrichment.images || {};
  const price = p.price || {};
  const brand = item.primary_brand || {};

  const tcin = p.tcin || item.tcin;
  if (!tcin) return null;

  const title = (desc.title || "").replace(/&#38;/g, "&").trim();
  const image =
    images.primary_image_url ||
    (Array.isArray(images.alternate_image_urls) && images.alternate_image_urls[0]) ||
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

async function fetchAll() {
  const visitorId = randomVisitorId();
  const seen = new Map();
  for (let offset = 0; offset < config.maxProducts; offset += PAGE_SIZE) {
    const json = await fetchPage(offset, visitorId);
    const products = json?.data?.search?.products || [];
    if (products.length === 0) break;
    for (const raw of products) {
      const sock = normalize(raw);
      if (sock && !seen.has(sock.tcin)) seen.set(sock.tcin, sock);
    }
    // Be gentle: small pause between pages.
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
  }
  return [...seen.values()];
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
