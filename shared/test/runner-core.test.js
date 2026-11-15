'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../../shared/googlesql-core/sql-scope');
const runner=require('../../runner/src/sql-scope');
const {getSuggestions}=require('../src/catalog');
test('Runner SQL scope functions are direct Core exports',()=>{
  assert.strictEqual(runner.lexSql,core.lexSql);
  assert.strictEqual(runner.sqlCompletionContext,core.sqlCompletionContext);
});
test('Runner keeps BigQuery catalog completion without CREATE templates',()=>{
  const catalog={tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[]}]};
  const opts={projects:['demo-project'],datasetSearches:new Map()};
  const sql='CREATE OR REPLACE TABLE \x60demo-project.mart.';
  assert.ok(getSuggestions(catalog,sql,sql.length,opts).some(x=>x.label==='sales'));
  assert.deepEqual(getSuggestions(catalog,'CREATE',6,opts),[]);
});
