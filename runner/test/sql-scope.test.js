'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getSuggestions}=require('../src/catalog');
const registered={tables:[
  {project:'demo-project',dataset:'mart',name:'sales',description:'売上表',columns:[
    {name:'customer_id',type:'STRING',description:'顧客ID'},
    {name:'sales_amount',type:'NUMERIC',description:'売上金額'}]},
  {project:'demo-project',dataset:'mart',name:'customers',description:'顧客表',columns:[
    {name:'customer_name',type:'STRING',description:'氏名'},
    {name:'customer_id',type:'STRING',description:'顧客ID'}]}
]};
function candidates(sql,marker='|') {
  const pos=sql.indexOf(marker);
  assert.ok(pos>=0,'marker missing');
  const source=sql.slice(0,pos)+sql.slice(pos+marker.length);
  return getSuggestions(registered,source,pos);
}
function labels(sql) {return candidates(sql).map(x=>x.label).sort();}

test('table suggestions span line breaks, CRLF, tabs and spaces',()=>{
  assert.deepEqual(labels('SELECT * FROM\n\t sa|'),['sales']);
  assert.deepEqual(labels('SELECT * FROM\r\n\t s|'),['sales']);
  assert.deepEqual(labels('SELECT *\nFROM\n\t |'),['customers','sales']);
  assert.deepEqual(labels('SELECT * FROM `demo-project.mart.sales` s\nJOIN\n\t c|'),['customers']);
});
test('SELECT aliases resolve FROM later in the same SELECT block',()=>{
  assert.deepEqual(labels('SELECT t1.|\nFROM `demo-project.mart.sales` AS t1'),['customer_id','sales_amount']);
  assert.deepEqual(labels('SELECT t1.sales_|\nFROM `demo-project.mart.sales` t1'),['sales_amount']);
  assert.deepEqual(labels('SELECT t1.|\nFROM `demo-project.mart.sales` AS t1\nJOIN `demo-project.mart.customers` AS t2 ON t1.customer_id=t2.customer_id'),['customer_id','sales_amount']);
  assert.deepEqual(labels('SELECT t2.|\nFROM `demo-project.mart.sales` AS t1\nJOIN `demo-project.mart.customers` AS t2 ON t1.customer_id=t2.customer_id'),['customer_id','customer_name']);
});
test('aliases do not cross separate CTE parentheses and outer query',()=>{
  const sql=`WITH
  a AS (
    SELECT t1.| 
    FROM \`demo-project.mart.sales\` AS t1
  ),
  b AS (
    SELECT t1.customer_name
    FROM \`demo-project.mart.customers\` AS t1
  )
SELECT * FROM a`;
  assert.deepEqual(labels(sql),['customer_id','sales_amount']);
  assert.deepEqual(labels(sql.replace('SELECT t1.|','SELECT t1.customer_id').replace('SELECT t1.customer_name','SELECT t1.|')),['customer_id','customer_name']);
  const outer=sql.replace('SELECT t1.|','SELECT t1.customer_id').replace('SELECT * FROM a','SELECT t1.| FROM a');
  assert.deepEqual(labels(outer),[]);
});
test('nested subquery aliases cannot leak into parent or sibling queries',()=>{
  assert.deepEqual(labels('SELECT t1.| FROM (SELECT * FROM `demo-project.mart.sales` AS t1) AS nested'),[]);
  assert.deepEqual(labels('SELECT * FROM `demo-project.mart.sales` AS t1 WHERE EXISTS (SELECT t1.| FROM `demo-project.mart.customers` AS t1)'),['customer_id','customer_name']);
  assert.deepEqual(labels('SELECT t1.| FROM `demo-project.mart.customers` AS t1 WHERE EXISTS (SELECT * FROM `demo-project.mart.sales` AS t1)'),['customer_id','customer_name']);
});
test('dataset-qualified tables resolve uniquely',()=>{
  assert.deepEqual(labels('SELECT t1.| FROM mart.sales AS t1'),['customer_id','sales_amount']);
});
test('comments, string literals and other statement scopes do not leak aliases',()=>{
  assert.deepEqual(labels('SELECT t1.| -- FROM `demo-project.mart.sales` AS t1'),[]);
  assert.deepEqual(labels('SELECT t1.|\n/* FROM `demo-project.mart.sales` AS t1 */\nFROM `demo-project.mart.customers` AS t1'),['customer_id','customer_name']);
  assert.deepEqual(labels('SELECT t1.|\nFROM `demo-project.mart.customers` AS t1; SELECT * FROM `demo-project.mart.sales` AS t1'),['customer_id','customer_name']);
  assert.deepEqual(labels('SELECT 1; SELECT t1.| FROM `demo-project.mart.sales` AS t1'),['customer_id','sales_amount']);
  assert.deepEqual(labels('SELECT t1.| FROM unknown_table AS t1'),[]);
});
test('explicit alias hides implicit table name and ambiguity fails closed',()=>{
  assert.deepEqual(labels('SELECT sales.| FROM `demo-project.mart.sales` AS t1'),[]);
  assert.deepEqual(labels('SELECT sales.| FROM `demo-project.mart.sales`'),['customer_id','sales_amount']);
  assert.deepEqual(labels('SELECT t1.| FROM `demo-project.mart.sales` AS t1 JOIN `demo-project.mart.customers` AS t1 ON TRUE'),[]);
});
