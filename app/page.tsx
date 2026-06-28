import { getSockData } from "@/lib/socks";
import SockGrid from "@/components/SockGrid";

// Re-read the JSON on each deploy. The data file is updated by the scheduled
// fetcher, which triggers a redeploy, so static rendering is exactly right.
export const dynamic = "force-static";

export default function Home() {
  const data = getSockData();
  const updated = new Date(data.updatedAt);

  return (
    <main className="wrap">
      <header className="hero">
        <h1>🧦 Fun Sock Finder</h1>
        <p className="subtitle">
          The newest fun socks at <strong>{data.store.name}</strong>, freshest
          first.
        </p>
        <p className="meta">
          Last checked{" "}
          {updated.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · {data.count} socks tracked
        </p>
      </header>

      {data.lastFetchStatus === "sample" && (
        <div className="banner">
          Showing <strong>sample socks</strong> — these will be replaced with
          real Target finds after the first successful fetch.
        </div>
      )}

      <SockGrid socks={data.socks} newWithinDays={data.newWithinDays} />

      <footer className="footer">
        <p>
          Made with 🧦 &amp; ❤️. Prices and availability can change — tap a sock
          to see it on Target.
        </p>
      </footer>
    </main>
  );
}
