// Shared configuration for the fetcher and (indirectly) the site.
// Anything here can be overridden with environment variables so you never
// have to edit code to point at a different store or search.

export const config = {
  // Target's internal "RedSky" web API key (the same one target.com uses in
  // the browser). It is not a secret; it ships in Target's own page source.
  apiKey: process.env.TARGET_API_KEY || "9f36aeafbe60771e321a7cc95a78140772ab3e96",

  // The store whose inventory we care about. Find the ID by going to
  // target.com, picking the store, and copying the number in the URL
  // (e.g. /sl/.../2570). Set TARGET_STORE_ID in GitHub repo secrets/variables.
  // Default: Target Marlborough East (605 Boston Post Rd E, Marlborough MA),
  // the closest store to Stow, MA.
  storeId: process.env.TARGET_STORE_ID || "2570",
  storeName: process.env.TARGET_STORE_NAME || "Target Marlborough East",

  // What we search for. "novelty socks" is Target's taxonomy term for the fun
  // ones and returns far less athletic-sock noise than "fun socks".
  keyword: process.env.TARGET_KEYWORD || "novelty socks",

  // How many products to pull per run (paginated 24 at a time under the hood).
  // Sorted newest-first, so the top ~72 reliably contains any new arrivals.
  // Kept modest because each proxied page costs ~10 ScraperAPI credits; 72
  // (3 pages = 30 credits) run once daily ≈ 900 credits/month — within the
  // free tier. Bump it if you want deeper coverage and have credits to spare.
  maxProducts: Number(process.env.TARGET_MAX_PRODUCTS || 72),

  // Items first seen within this many days are badged "NEW" on the site.
  newWithinDays: Number(process.env.SOCKS_NEW_WITHIN_DAYS || 14),

  // Drop items we haven't seen in a fetch for this many days (assumed gone).
  dropAfterDays: Number(process.env.SOCKS_DROP_AFTER_DAYS || 30),
};
