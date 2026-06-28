import data from "@/data/socks.json";

export type Sock = {
  tcin: string;
  title: string;
  brand: string | null;
  price: string | null;
  image: string;
  url: string;
  firstSeen: string; // YYYY-MM-DD
  lastSeen: string; // YYYY-MM-DD
};

export type SockData = {
  store: { id: string; name: string };
  updatedAt: string;
  lastFetchStatus: "ok" | "blocked" | "sample";
  newWithinDays: number;
  count: number;
  socks: Sock[];
};

export function getSockData(): SockData {
  return data as SockData;
}

/** Days since a YYYY-MM-DD date, relative to now. */
export function daysAgo(dateStr: string): number {
  const then = new Date(dateStr + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.floor((now - then) / 86_400_000);
}

export function isNew(sock: Sock, newWithinDays: number): boolean {
  return daysAgo(sock.firstSeen) <= newWithinDays;
}
