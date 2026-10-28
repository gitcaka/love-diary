import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const css = read('app/globals.css');
const compact = read('app/compact-ui.css');

test('all web routes share the responsive frame width instead of a home-only override', () => {
  assert.match(css, /--app-width:\s*480px/);
  assert.match(css, /@media\s*\(min-width:\s*800px\)\s*\{\s*:root\s*\{\s*--app-width:\s*720px/);
  assert.match(css, /\.phone-frame\s*\{[^}]*max-width:\s*var\(--app-width\)/);
  assert.doesNotMatch(css, /\.phone-frame\.page-\w+\s*\{[^}]*max-width/);
  assert.doesNotMatch(css, /\.app-shell:has\(\.page-\w+\)\s*\{[^}]*padding-inline/);
});

test('navigation and welcome use the same width token; content shares gutters', () => {
  assert.match(compact, /\.bottom-nav\s*\{\s*width:min\(100%,var\(--app-width\)\)/);
  assert.match(compact, /\.page-content\s*\{\s*padding-inline:var\(--page-gutter\)/);
  assert.match(css, /\.private-welcome\s*\{[^}]*max-width:\s*var\(--app-width\)/);
  assert.match(read('app/journal-heading.css'), /\.private-welcome>\.journal-heading\{grid-column:1\/-1;width:100%/);
});
