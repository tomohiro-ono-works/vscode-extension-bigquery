'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateSearchWord,filterDatasets,makeTableSearch,parseTableSearch}=require('../src/catalog-search');
test('search needs three or more characters, rejects SQL injection and shell metacharacters',()=>{
  for(const term of ['','a','ab','  ab  '])assert.throws(()=>validateSearchWord(term),/3文字/);
  for(const term of ["foo' OR 1=1",'cat;cmd','te st','foo$'])assert.throws(()=>validateSearchWord(term),/検索語/);
  assert.equal(validateSearchWord(' AbC '),'AbC');
});
test('dataset search performs case-insensitive substring matching',()=>{
  const data=JSON.stringify(['test_dataset','REPORTTEST','other'].map(datasetId=>({datasetReference:{datasetId}})));
  assert.deepEqual(filterDatasets(data,'test').names,['REPORTTEST','test_dataset']);
});
test('table search uses server-side subset query with no user input in CLI arguments',()=>{
  const q=makeTableSearch({project:'demo-project',dataset:'mart',term:'Sale',location:'asia-northeast1'});
  assert.match(q.stdin,/FROM `demo-project.mart.INFORMATION_SCHEMA.TABLES`/);
  assert.match(q.stdin,/STRPOS\(LOWER\(table_name\), 'sale'\) > 0/);
  assert.equal(q.args.some(x=>x.includes('sale')),false);
  assert.ok(q.args.includes('--location=asia-northeast1'));
});
test('table search results honor returned names and validated query',()=>{
  const data=JSON.stringify([{table_name:'Sales'}, {table_name:'resales'}, {table_name:'danger'}, {table_name:'Sales'}]);
  assert.deepEqual(parseTableSearch(data,'sal'),['Sales','resales']);
});
