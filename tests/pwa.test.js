// Guards against shipping an app file the service worker forgets to cache
// (which would break offline use) or a manifest icon that doesn't exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const swAssets = () => {
  const m = read('sw.js').match(/const ASSETS = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].replace(/^\.\//, ''));
};

test('service worker precaches every app file', () => {
  const assets = swAssets();
  const expected = [
    'index.html', 'styles.css', 'design/tokens.css', 'manifest.webmanifest',
    ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('icons/', root)).map((f) => `icons/${f}`),
  ];
  for (const f of expected) assert.ok(assets.includes(f), `sw.js ASSETS is missing ${f}`);
});

test('every precached file exists', () => {
  for (const f of swAssets()) {
    if (f === '') continue;
    assert.ok(existsSync(new URL(f, root)), `${f} is listed in sw.js but does not exist`);
  }
});

test('manifest icons exist and paths are relative (GitHub Pages subfolder)', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(!manifest.start_url.startsWith('/'));
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} must be relative`);
    assert.ok(existsSync(new URL(icon.src, root)), `${icon.src} missing`);
  }
});

test('every splash image is linked from index.html', () => {
  const html = read('index.html');
  for (const f of readdirSync(new URL('icons/', root)).filter((n) => n.startsWith('splash-'))) {
    assert.ok(html.includes(`href="icons/${f}"`), `${f} is not linked as an apple-touch-startup-image`);
  }
});

test('index.html loads nothing from other hosts', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
});
