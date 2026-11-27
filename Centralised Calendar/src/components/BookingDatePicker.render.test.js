import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('booking date picker opens the selected month in either calendar', async () => {
  const server = await createServer({ configFile: false, root, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  try {
    const { default: Picker } = await server.ssrLoadModule('/src/components/BookingDatePicker.jsx');
    const render = basis => renderToStaticMarkup(React.createElement(Picker, { basis, selectedDate: '2026-11-23', overrides: [], onSelect: () => {} }));
    const gregorian = render('g'), hijri = render('h');
    assert.match(gregorian, /Choose a Gregorian date/);
    assert.match(gregorian, /November 2026/);
    assert.match(hijri, /Choose a Hijri date/);
    assert.match(hijri, /AH/);
    assert.match(gregorian, /aria-pressed="true"/);
    assert.match(hijri, /aria-pressed="true"/);
    assert.notEqual(gregorian.match(/<strong>[^<]+<\/strong>/)?.[0], hijri.match(/<strong>[^<]+<\/strong>/)?.[0]);
  } finally { await server.close(); }
});
