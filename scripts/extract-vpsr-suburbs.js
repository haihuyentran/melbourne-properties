#!/usr/bin/env node
/**
 * Extract all suburb/locality entries from the VPSR June 2025 PDF and update
 * data/vpsr-june-2025.json. Also ensures data/suburbs.json has an entry for
 * each (stub if missing) so merge-vpsr-data and geocode can fill them.
 *
 * Usage: node scripts/extract-vpsr-suburbs.js
 */

const fs = require('fs');
const path = require('path');

const pdfPath = path.join(__dirname, '..', 'vpsr-june-2025-data-released-dec-2025.pdf');
const vpsrOutPath = path.join(__dirname, '..', 'data', 'vpsr-june-2025.json');
const suburbsPath = path.join(__dirname, '..', 'data', 'suburbs.json');

function titleCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi)\b/gi, (m) => m.toUpperCase());
}

function parseLine(line) {
  // Match: LOCALITY NAME (all caps, may contain spaces, parentheses, hyphen) then space/tab then 5-7 digit number (median price)
  const match = line.match(/^([A-Z][A-Z0-9 ()\-]+?)\s+(\d{5,7})(?=[\s\t]|$)/);
  if (!match) return null;
  const rawName = match[1].trim();
  const medianPrice = parseInt(match[2], 10);
  if (isNaN(medianPrice) || medianPrice < 50000 || medianPrice > 99999999) return null;

  // Skip header/legend lines
  if (/^Locality|^MEDIAN|^Change|^Apr-Jun|^No\. of Sales|^Legend|^Vacant|^Q1 |^Q2 /i.test(rawName)) return null;
  if (/^\d|^%|^\$/.test(rawName)) return null;

  const name = titleCase(rawName);
  const rest = line.slice(match[0].length);
  let annualChange = null;
  let salesCount = null;
  const numParts = rest.split(/[\s\t]+/).filter((s) => /^-?\d+\.?\d*$/.test(s) || /^\d+$/.test(s));
  const pct = numParts.find((p) => p.includes('.') && Math.abs(parseFloat(p)) < 100);
  if (pct) annualChange = parseFloat(pct);
  const lastInts = numParts.filter((p) => /^\d+$/.test(p) && p.length <= 4).map((p) => parseInt(p, 10));
  if (lastInts.length > 0) salesCount = lastInts[lastInts.length - 1];

  return { name, medianPrice, annualChange, salesCount };
}

async function main() {
  let PDFParse;
  try {
    ({ PDFParse } = require('pdf-parse'));
  } catch (e) {
    console.error('pdf-parse is required. Run: npm install pdf-parse');
    process.exit(1);
  }

  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const { text } = await parser.getText();
  await parser.destroy();
  const lines = text.split(/\r?\n/);

  const byName = new Map();
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const existing = byName.get(parsed.name);
    if (!existing || parsed.salesCount != null) {
      byName.set(parsed.name, {
        medianPrice: parsed.medianPrice,
        annualChange: parsed.annualChange ?? existing?.annualChange ?? null,
        salesCount: parsed.salesCount ?? existing?.salesCount ?? null
      });
    }
  }

  const vpsr = {
    _comment: 'VPSR June 2025 quarter (Apr-Jun 2025). Keys match suburbs.json suburb names. Extracted from PDF.',
    ...Object.fromEntries(
      [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [
        k,
        {
          medianPrice: v.medianPrice,
          ...(v.annualChange != null && { annualChange: v.annualChange }),
          ...(v.salesCount != null && { salesCount: v.salesCount })
        }
      ])
    )
  };

  fs.writeFileSync(vpsrOutPath, JSON.stringify(vpsr, null, 2) + '\n', 'utf8');
  console.log('Wrote', byName.size, 'localities to data/vpsr-june-2025.json');

  const suburbs = JSON.parse(fs.readFileSync(suburbsPath, 'utf8'));
  if (!suburbs.suburbs) {
    console.log('suburbs.json has no suburbs key, skipping stub adds.');
    return;
  }

  const stub = {
    postcode: '',
    municipality: '',
    coords: null,
    medianPrice: null,
    medianPriceUnit: null,
    annualChange: null,
    salesCount: null,
    priceHistory: {},
    demographics: { population: 0, medianAge: null, familyHouseholds: '-', ownerOccupied: '-', bornOverseas: '-' },
    schools: [],
    transport: {},
    amenities: [],
    reivSlug: ''
  };

  let added = 0;
  for (const [name, row] of byName) {
    if (suburbs.suburbs[name]) continue;
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '');
    suburbs.suburbs[name] = {
      ...stub,
      medianPrice: row.medianPrice,
      annualChange: row.annualChange ?? null,
      salesCount: row.salesCount ?? null,
      reivSlug: slug
    };
    added++;
  }
  if (added > 0) {
    fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
    console.log('Added', added, 'stub suburbs to data/suburbs.json. Run merge-vpsr-data.js then geocode-missing-suburbs.js.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
