"use client";

import { useMemo, useState } from "react";
import type { Sock } from "@/lib/socks";
import { daysAgo } from "@/lib/socks";

type Props = {
  socks: Sock[];
  newWithinDays: number;
};

type Filter = "new" | "all";

export default function SockGrid({ socks, newWithinDays }: Props) {
  const [filter, setFilter] = useState<Filter>("new");
  const [query, setQuery] = useState("");

  const newCount = useMemo(
    () => socks.filter((s) => daysAgo(s.firstSeen) <= newWithinDays).length,
    [socks, newWithinDays]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return socks.filter((s) => {
      if (filter === "new" && daysAgo(s.firstSeen) > newWithinDays) return false;
      if (q && !`${s.title} ${s.brand ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [socks, filter, query, newWithinDays]);

  return (
    <>
      <div className="controls">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={filter === "new"}
            className={filter === "new" ? "tab active" : "tab"}
            onClick={() => setFilter("new")}
          >
            New this week <span className="pill">{newCount}</span>
          </button>
          <button
            role="tab"
            aria-selected={filter === "all"}
            className={filter === "all" ? "tab active" : "tab"}
            onClick={() => setFilter("all")}
          >
            All socks <span className="pill">{socks.length}</span>
          </button>
        </div>
        <input
          type="search"
          className="search"
          placeholder="Search socks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search socks"
        />
      </div>

      {visible.length === 0 ? (
        <p className="empty">
          {filter === "new"
            ? "No new socks right now — check back soon! 🧦"
            : "No socks match your search."}
        </p>
      ) : (
        <ul className="grid">
          {visible.map((sock) => {
            const age = daysAgo(sock.firstSeen);
            const fresh = age <= newWithinDays;
            return (
              <li key={sock.tcin} className="card">
                <a href={sock.url} target="_blank" rel="noopener noreferrer">
                  <div className="thumb">
                    {fresh && <span className="badge">NEW</span>}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sock.image} alt={sock.title} loading="lazy" />
                  </div>
                  <div className="info">
                    <h3 className="title">{sock.title}</h3>
                    <div className="row">
                      {sock.brand && <span className="brand">{sock.brand}</span>}
                      {sock.price && <span className="price">{sock.price}</span>}
                    </div>
                    <span className="added">
                      {age === 0
                        ? "Added today"
                        : age === 1
                        ? "Added yesterday"
                        : `Added ${age} days ago`}
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
