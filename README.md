# 🧦 Fun Sock Finder

A little website that shows the **newest fun socks at a specific Target store**,
freshest first, with pictures — so you can spot new arrivals without scrolling
past the hundred pairs you already own.

- **Website:** Next.js, hosted free on **Vercel**.
- **Data:** Target's internal "RedSky" API (the same one target.com calls).
- **"Newest":** a scheduled job snapshots the sock catalog and **diffs** it, so
  anything that wasn't there last time gets a **NEW** badge — even when Target
  itself doesn't label it new.
- **No LLM** anywhere, and nothing runs on your laptop.

## How it works (and the one important catch)

```
GitHub Actions (every 3h, free)         Vercel (free)
  └─ scripts/fetch-socks.mjs              └─ Next.js site reads data/socks.json
       ├─ asks Target for "fun socks"          (auto-redeploys on each commit)
       ├─ diffs vs. data/socks.json
       └─ commits the updated JSON  ──────────────▲
```

**The catch:** Target captcha-blocks **datacenter IP addresses** — and that
includes GitHub Actions runners (Azure) and Vercel's serverless functions
(tested: blocked every time). So the cloud fetcher routes its request through a
**residential-proxy / scraping API** that fetches Target from a home-grade IP
Target trusts. The free tier of [ScraperAPI](https://www.scraperapi.com)
(1,000 requests/month) is plenty for a once-a-day sock check. You add the key as
a repo secret (see setup). Every run still **fails safe** — if a fetch is
blocked or errors, it keeps the last good data and the next run retries.

> Running `npm run fetch` from your own home internet needs **no proxy key** at
> all (your residential IP is already trusted) — handy for seeding real data on
> demand.

## One-time setup

### 1. Put it on GitHub

```bash
git remote add origin https://github.com/<you>/fun-sock-finder.git
git push -u origin main
```

Make the repo **public** so GitHub Actions minutes are unlimited (private repos
have a monthly cap that this would slowly eat into).

### 2. Tell it which store + what to search

In the repo: **Settings → Secrets and variables → Actions → Variables tab →
New repository variable**. Add:

| Variable            | Example          | What it is                                              |
| ------------------- | ---------------- | ------------------------------------------------------- |
| `TARGET_STORE_ID`   | `3991`           | Her local store's ID (see below)                        |
| `TARGET_STORE_NAME` | `Target on Main` | Just for the page header                                |
| `TARGET_KEYWORD`    | `fun socks`      | Optional — what to search (e.g. `women's novelty socks`)|

**Finding the store ID:** go to target.com, click the store picker, choose her
store, and look at the URL — it ends in the number, e.g.
`target.com/sl/store-name/**3991**`.

### 3. Add a free proxy key (so the cloud fetcher isn't blocked)

1. Sign up free at [scraperapi.com](https://www.scraperapi.com) and copy your
   **API key**.
2. In the repo: **Settings → Secrets and variables → Actions → Secrets tab →
   New repository secret**. Name it `SCRAPER_API_KEY`, paste the key.

(Skip this only if you'll just run `npm run fetch` from home yourself.)

### 4. Deploy the site to Vercel

- Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the
  GitHub repo. Framework auto-detects as **Next.js**. Click **Deploy**. Done —
  you get a free `*.vercel.app` URL.
- Every time the fetcher commits new socks, Vercel redeploys automatically.

### 5. Kick off the first real fetch

In the repo: **Actions → Fetch fun socks → Run workflow**. (Re-run it a couple
times if the first attempt hits a captcha — different IP each time.) Once it
succeeds, the sample socks are replaced with real Target finds.

## Running locally

```bash
npm install
npm run dev      # open http://localhost:3000
npm run fetch    # try a fetch from YOUR home IP (which Target usually trusts)
```

Running `npm run fetch` from your home internet is actually the *most* reliable
way to populate real data on demand, since residential IPs rarely get the
captcha. (It just won't be automatic — that's what GitHub Actions is for.)

## Configuration reference

All of these are environment variables (set as repo Variables for the Action, or
in a local `.env`). Defaults live in `lib/config.mjs`.

| Variable                 | Default                  | Meaning                                  |
| ------------------------ | ------------------------ | ---------------------------------------- |
| `TARGET_STORE_ID`        | `3991`                   | Store to check inventory for             |
| `TARGET_STORE_NAME`      | `your Target`            | Display name in the header               |
| `TARGET_KEYWORD`         | `fun socks`              | Search term                              |
| `TARGET_MAX_PRODUCTS`    | `240`                    | How many products to pull per run        |
| `SOCKS_NEW_WITHIN_DAYS`  | `14`                     | How long an item shows the **NEW** badge |
| `SOCKS_DROP_AFTER_DAYS`  | `30`                     | Drop items not seen in a fetch this long |
| `TARGET_API_KEY`         | (public web key)         | Override if Target rotates their key     |

## Project layout

```
app/                 Next.js site (page, layout, styles)
components/SockGrid   The interactive grid (tabs, search, NEW badges)
lib/socks.ts          Site-side types + "is this new?" helpers
lib/config.mjs        Shared, env-overridable settings
scripts/fetch-socks.mjs   The fetcher + differ (run by GitHub Actions)
data/socks.json       The catalog (committed; updated by the fetcher)
.github/workflows/    The schedule
```

The design is intentionally plain — it's a clean starting point to restyle.
