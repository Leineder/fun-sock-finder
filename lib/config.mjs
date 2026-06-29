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

  // What we search for. She only wants LOW socks (no-show / ankle), so we search
  // "no show socks" and then filter to the fun, low-cut ones (see isLowFun in
  // the fetcher). Novelty/"fun socks" searches return almost entirely crew.
  keyword: process.env.TARGET_KEYWORD || "no show socks",

  // How many products to pull per run (paginated 24 at a time under the hood).
  // We pull more here then filter hard to low+fun, since most "no show socks"
  // results are athletic basics. Each proxied page costs ~10 ScraperAPI
  // credits; 120 (5 pages = 50 credits) once daily ≈ 1,500 credits/month —
  // comfortably within the free tier.
  maxProducts: Number(process.env.TARGET_MAX_PRODUCTS || 120),

  // Items first seen within this many days are badged "NEW" on the site.
  newWithinDays: Number(process.env.SOCKS_NEW_WITHIN_DAYS || 14),

  // Drop items we haven't seen in a fetch for this many days (assumed gone).
  dropAfterDays: Number(process.env.SOCKS_DROP_AFTER_DAYS || 30),
};
