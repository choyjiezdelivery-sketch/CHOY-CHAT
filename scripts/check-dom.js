#!/usr/bin/env node
/**
 * Static DOM contract check.
 *
 * public/app.js reaches into the page with $('#id') selectors. Every id it
 * looks up must exist somewhere: either in the static shell (public/index.html)
 * or in a template string that app.js injects at runtime.
 *
 * If an id exists in neither, the handler throws at runtime and the UI silently
 * stops working — this is exactly how the login button broke once: app.js
 * referenced #auth-error, but the old index.html had no such element, so the
 * submit handler threw before it could call the API.
 *
 *   node scripts/check-dom.js
 *
 * Exit code 1 when something is missing, so it can gate a build.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

// Every id app.js looks up: $('#foo') / $("#foo")
const looked = [...js.matchAll(/\$\(['"]#([A-Za-z0-9_-]+)['"]/g)].map((m) => m[1]);
const unique = [...new Set(looked)];

// Every id app.js *creates* in a template: id="foo" / id='foo'
const created = new Set(
  [...js.matchAll(/\bid=["']([A-Za-z0-9_-]+)["']/g)].map((m) => m[1])
);

const inShell = (id) => html.indexOf('id="' + id + '"') !== -1;
const inTemplate = (id) => created.has(id);

const missing = unique.filter((id) => !inShell(id) && !inTemplate(id));

console.log('app.js looks up ' + unique.length + ' element ids');
console.log(
  '  ' +
    unique.filter(inShell).length +
    ' in the static shell, ' +
    unique.filter((id) => !inShell(id) && inTemplate(id)).length +
    ' created by templates'
);

if (missing.length === 0) {
  console.log('OK — every id is defined somewhere');
  process.exit(0);
}

console.error('MISSING — defined in neither index.html nor an app.js template:');
for (const id of missing) console.error('  #' + id);
process.exit(1);
