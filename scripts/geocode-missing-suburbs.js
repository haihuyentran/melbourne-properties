#!/usr/bin/env node
/**
 * Geocode suburbs that have coords: null using Nominatim (OpenStreetMap).
 * Respects rate limit (1 req/sec). Caches results in data/geocode-cache.json.
 * Usage: node scripts/geocode-missing-suburbs.js [--limit N]
 * Without --limit, processes all missing suburbs (can take 30+ min for 2000+).
 */

const fs = require('fs');
const path = require('path');

const suburbsPath = path.join(__dirname, '..', 'data', 'suburbs.json');
const cachePath = path.join(__dirname, '..', 'data', 'geocode-cache.json');
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAY_MS = 1100; // Nominatim policy: max 1 request per second

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadJson(p, defaultValue) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return defaultValue;
  }
}

async function geocode(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: 1,
    countrycodes: 'au'
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': 'MelbournePropertyFinder/1.0 (geocoding Victorian suburbs)' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

async function main() {
  const args = process.argv.slice(2);
  let limit = null;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
    if (isNaN(limit) || limit < 1) limit = null;
  }

  const suburbs = loadJson(suburbsPath, null);
  if (!suburbs || !suburbs.suburbs) {
    console.error('Could not load data/suburbs.json');
    process.exit(1);
  }

  const cache = loadJson(cachePath, {});
  const missing = Object.entries(suburbs.suburbs)
    .filter(([, s]) => !s.coords || s.coords.length !== 2)
    .map(([name]) => name);

  const toProcess = missing.filter(name => !cache[name]);
  const total = limit != null ? Math.min(limit, toProcess.length) : toProcess.length;

  console.log(`Suburbs missing coords: ${missing.length}`);
  console.log(`Already in cache: ${missing.length - toProcess.length}`);
  console.log(`To geocode this run: ${total}`);
  if (total === 0) {
    console.log('Nothing to do. Merging cache into suburbs.json...');
    mergeCacheIntoSuburbs(suburbs, cache);
    fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
    console.log('Done.');
    return;
  }

  let done = 0;
  for (let i = 0; i < total; i++) {
    const name = toProcess[i];
    const query = `${name}, Victoria, Australia`;
    try {
      const result = await geocode(query);
      if (result) {
        cache[name] = result;
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf8');
        done++;
        console.log(`[${done}/${total}] ${name} -> ${result.lat}, ${result.lon}`);
      } else {
        console.log(`[${done}/${total}] ${name} -> no result`);
      }
    } catch (e) {
      console.error(`[${name}] Error:`, e.message);
    }
    if (i < total - 1) await sleep(DELAY_MS);
  }

  console.log(`Geocoded ${done} suburbs. Merging into suburbs.json...`);
  mergeCacheIntoSuburbs(suburbs, cache);
  fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
  console.log('Done. Suburbs with coords:', countWithCoords(suburbs));
}

function mergeCacheIntoSuburbs(suburbs, cache) {
  let merged = 0;
  for (const name of Object.keys(cache)) {
    const sub = suburbs.suburbs[name];
    if (sub && (!sub.coords || sub.coords.length !== 2)) {
      const c = cache[name];
      sub.coords = [c.lat, c.lon];
      merged++;
    }
  }
  console.log(`Updated coords for ${merged} suburbs.`);
}

function countWithCoords(suburbs) {
  return Object.values(suburbs.suburbs).filter(s => s.coords && s.coords.length === 2).length;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
