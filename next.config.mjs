/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Product thumbnails are rendered with a plain <img> tag, so there's no
  // next/image host allowlist to maintain as Target shuffles image domains.
};

export default nextConfig;
