'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {getSuggestions}=require('../src/catalog');
const catalog={tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[]}]};
const opts={projects:['demo-project'],datasetSearches:new Map([['demo-project',{names:['mart','marketing']} ]])};
function names(sql){return getSuggestions(catalog,sql,sql.length,opts).map(x=>x.label);}
test('backtick project, dataset and table metadata suggestions',()=>{
  assert.ok(names('FROM `').includes('demo-project'));
  assert.ok(names('FROM `demo-project.').includes('mart'));
  assert.deepEqual(names('FROM `demo-project.mart.'),['sales']);
});
test('no metadata completion inside comments and string literals',()=>{
  assert.deepEqual(names('-- FROM `'),[]);
  assert.deepEqual(names("SELECT 'FROM `"),[]);
});
test('Runner never provides SQL CREATE syntax snippets',()=>{
  assert.deepEqual(names('CREATE'),[]);
  assert.deepEqual(names('CREATE OR RE'),[]);
});

test('CREATE declaration target resolves registered project, dataset and table metadata',()=>{
  const it=s=>getSuggestions(catalog,s,s.length,opts);
  assert.ok(it('CREATE OR REPLACE TABLE `').some(x=>x.label==='demo-project'));
  assert.ok(it('CREATE OR REPLACE TABLE `demo-project.').some(x=>x.label==='mart'));
  assert.ok(it('CREATE OR REPLACE TABLE `demo-project.mart.').some(x=>x.label==='sales'));
  assert.equal(it('CREATE OR REPLACE PROCEDURE `demo-project.mart.').length,0);
  assert.deepEqual(it('CREATE OR REPLACE'),[]);
});
