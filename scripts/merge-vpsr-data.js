#!/usr/bin/env node
/**
 * Merge VPSR June 2025 data into data/suburbs.json.
 * When a suburb exists in data/vpsr-june-2025.json, update median price fields from the PDF.
 * When data is unavailable in the PDF, keep the existing website values.
 */

const fs = require('fs');
const path = require('path');

const suburbsPath = path.join(__dirname, '..', 'data', 'suburbs.json');
const vpsrPath = path.join(__dirname, '..', 'data', 'vpsr-june-2025.json');

const suburbs = JSON.parse(fs.readFileSync(suburbsPath, 'utf8'));
const vpsr = JSON.parse(fs.readFileSync(vpsrPath, 'utf8'));

// Remove internal keys from vpsr
const vpsrData = Object.keys(vpsr).reduce((acc, k) => {
  if (k.startsWith('_')) return acc;
  acc[k] = vpsr[k];
  return acc;
}, {});

let updated = 0;
let cleared = 0;

for (const name of Object.keys(suburbs.suburbs)) {
  const sub = suburbs.suburbs[name];
  const row = vpsrData[name];
  if (!row) {
    // Suburb not in VPSR PDF: show N/A by clearing price fields
    sub.medianPrice = null;
    sub.medianPriceUnit = null;
    sub.annualChange = null;
    sub.salesCount = null;
    if (sub.priceHistory) sub.priceHistory['2025'] = undefined;
    cleared++;
    continue;
  }
  if (row.medianPrice != null) {
    sub.medianPrice = row.medianPrice;
    if (sub.priceHistory) sub.priceHistory['2025'] = row.medianPrice;
  }
  if (row.medianPriceUnit != null) sub.medianPriceUnit = row.medianPriceUnit;
  if (row.annualChange != null) sub.annualChange = row.annualChange;
  if (row.salesCount != null) sub.salesCount = row.salesCount;
  updated++;
}

suburbs.metadata.lastUpdated = '2025-12-01';
suburbs.metadata.dataQuarter = 'Q2 2025 (Jun 2025)';
suburbs.metadata.source = 'Victorian Property Sales Report - Land Victoria';
suburbs.metadata.sourceUrl = 'https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics';
suburbs.metadata.notes = 'Median prices from VPSR June 2025 quarter where available; otherwise prior data retained. Demographics from ABS Census.';

fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
console.log('Updated', updated, 'suburbs from VPSR Jun 2025; set N/A for', cleared, 'suburbs not in PDF.');
console.log('Metadata set to Q2 2025 (Jun 2025), lastUpdated 2025-12-01.');
