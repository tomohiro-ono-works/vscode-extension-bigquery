'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const {getSuggestions} = require('../src/catalog');

test('extension activates on both SQL language modes without needing to open the sidebar', () => {
  assert.equal(packageJson.activationEvents.includes('onLanguage:sql'),true);
  assert.equal(packageJson.activationEvents.includes('onLanguage:googlesql'),true);
  assert.equal(packageJson.activationEvents.includes('onView:bigquerySqlRunner.catalog'),true);
  assert.equal(packageJson.version,'0.4.4');
});

test('registered FROM tables are available without the Language extension', () => {
  const cat={tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[]}]};
  assert.deepEqual(getSuggestions(cat,'SELECT *\nFROM s',15).map(x=>x.label),['sales']);
});
