#!/usr/bin/env node
/**
 * Fetch REIV all-suburbs page and extract suburb list.
 * Writes data/reiv-suburb-list.json: { slugs: string[], names: string[] }
 * Slug is the URL segment (e.g. "geelong", "avondale%20heights"); name is title-case for display.
 */

const fs = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'data', 'reiv-suburb-list.json');
const REIV_URL = 'https://reiv.com.au/market-insights/all-suburbs';

function slugToName(slug) {
  const decoded = decodeURIComponent(slug.replace(/\+/g, ' '));
  return decoded.replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  const res = await fetch(REIV_URL, {
    headers: { 'User-Agent': 'MelbournePropertyFinder/1.0 (data sync)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Match href="/market-insights/suburb/..." or href="https://reiv.com.au/market-insights/suburb/..."
  const re = /market-insights\/suburb\/([^"?#>\s]+)/gi;
  const slugs = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1].trim();
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }

  const names = slugs.map(slugToName);
  const data = { slugs, names, fetchedAt: new Date().toISOString() };
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${slugs.length} suburbs to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
