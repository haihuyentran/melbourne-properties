#!/usr/bin/env node
/**
 * Merge REIV suburb list into data/suburbs.json.
 * For each REIV suburb not already in suburbs.json, add a minimal stub (coords: null so it won't show on map until geocoded).
 * Existing suburbs are left unchanged.
 */

const fs = require('fs');
const path = require('path');

const suburbsPath = path.join(__dirname, '..', 'data', 'suburbs.json');
const reivListPath = path.join(__dirname, '..', 'data', 'reiv-suburb-list.json');

const suburbs = JSON.parse(fs.readFileSync(suburbsPath, 'utf8'));
let reivList;
try {
  reivList = JSON.parse(fs.readFileSync(reivListPath, 'utf8'));
} catch (e) {
  console.error('Run scripts/fetch-reiv-suburbs.js first to create data/reiv-suburb-list.json');
  process.exit(1);
}

const minimalStub = () => ({
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
  reivSlug: null
});

let added = 0;
let updatedSlug = 0;
for (let i = 0; i < reivList.names.length; i++) {
  const name = reivList.names[i];
  const slug = reivList.slugs[i];
  const existing = suburbs.suburbs[name];
  if (existing) {
    if (!existing.reivSlug) {
      existing.reivSlug = slug;
      updatedSlug++;
    }
    continue;
  }
  const stub = minimalStub();
  stub.reivSlug = slug;
  suburbs.suburbs[name] = stub;
  added++;
}

suburbs.metadata.notes = (suburbs.metadata.notes || '') +
  ' All REIV Victorian suburbs included; those without coords do not appear on map.';

fs.writeFileSync(suburbsPath, JSON.stringify(suburbs, null, 2) + '\n', 'utf8');
console.log(`Added ${added} new REIV suburbs; set reivSlug on ${updatedSlug} existing. Total: ${Object.keys(suburbs.suburbs).length}`);
console.log('Suburbs without coords will not show on the map until geocoded.');
