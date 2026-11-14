'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getSuggestions}=require('../src/catalog');
const registered={tables:[
  {project:'demo-project',dataset:'mart',name:'sales',description:'売上',columns:[
    {name:'customer_id',type:'STRING',description:'顧客ID'},
    {name:'sales_amount',type:'NUMERIC',description:'売上'}]},
  {project:'demo-project',dataset:'mart',name:'customers',description:'顧客',columns:[
    {name:'customer_id',type:'STRING',description:'顧客ID'},
    {name:'customer_name',type:'STRING',description:'氏名'}]}
]};
function completions(sql) {
  const pos=sql.indexOf('|');
  assert.ok(pos>=0);
  return getSuggestions(registered,sql.replace('|',''),pos);
}
function names(sql){return completions(sql).map(x=>x.label).sort();}

test('unqualified SELECT completes from a later FROM including multiline FROM and alias',()=>{
  assert.deepEqual(names('SELECT sales_|\nFROM\n  `demo-project.mart.sales` AS t1'),['sales_amount']);
  assert.deepEqual(names('SELECT customer_|\nFROM `demo-project.mart.sales` AS t1'),['customer_id']);
});
test('WHERE, HAVING, GROUP BY, ORDER BY, QUALIFY, ON and nested AND use in-scope columns',()=>{
  const from='FROM `demo-project.mart.sales` AS t1';
  for(const sql of [
    `SELECT * ${from} WHERE sales_|`,
    `SELECT * ${from} WHERE status = 1 AND sales_|`,
    `SELECT sales_amount ${from} GROUP BY sales_|`,
    `SELECT sales_amount ${from} GROUP BY sales_amount HAVING sales_|`,
    `SELECT sales_amount ${from} ORDER BY sales_|`,
    `SELECT sales_amount ${from} QUALIFY sales_|`,
    `SELECT * ${from} JOIN \`demo-project.mart.customers\` AS t2 ON sales_|`
  ]) assert.deepEqual(names(sql),['sales_amount'],sql);
});
test('separate CTE bodies keep unqualified columns inside each body',()=>{
  const cte=`WITH first_cte AS (
    SELECT sales_|
    FROM \`demo-project.mart.sales\` AS t1
  ), second_cte AS (
    SELECT customer_name
    FROM \`demo-project.mart.customers\` AS t1
  ) SELECT * FROM first_cte`;
  assert.deepEqual(names(cte),['sales_amount']);
  const other=cte.replace('sales_|','sales_amount').replace('customer_name\n','customer_|\n');
  assert.deepEqual(names(other),['customer_id','customer_name']);
  const outer=cte.replace('sales_|','sales_amount').replace('SELECT * FROM first_cte','SELECT customer_name| FROM first_cte');
  assert.deepEqual(names(outer),[]);
});
test('CTE names are completed in FROM, and its projected columns in SELECT, WHERE, HAVING',()=>{
  const cte='WITH sales_cte AS (SELECT s.customer_id, s.sales_amount AS amount FROM `demo-project.mart.sales` s)';
  assert.deepEqual(names(`${cte} SELECT * FROM sales_|`),['sales_cte']);
  assert.deepEqual(names(`${cte} SELECT amount| FROM sales_cte`),['amount']);
  assert.deepEqual(names(`${cte} SELECT * FROM sales_cte WHERE am|`),['amount']);
  assert.deepEqual(names(`${cte} SELECT * FROM sales_cte GROUP BY amount HAVING am|`),['amount']);
  assert.deepEqual(names(`${cte} SELECT x.am| FROM sales_cte x`),['amount']);
});
test('chained CTEs preserve selected column names and do not leak other CTE columns',()=>{
  const ctes=`WITH first_cte AS (SELECT * FROM \`demo-project.mart.sales\` s),
     second_cte AS (SELECT sales_amount AS amount FROM first_cte),
     third_cte AS (SELECT customer_name FROM \`demo-project.mart.customers\` c)`;
  assert.deepEqual(names(`${ctes} SELECT am| FROM second_cte`),['amount']);
  assert.deepEqual(names(`${ctes} SELECT customer_| FROM second_cte`),[]);
  assert.deepEqual(names(`${ctes} SELECT customer_| FROM third_cte`),['customer_name']);
});
test('ambiguous unqualified columns are emitted as qualified suggestions, with matching filterText',()=>{
  const found=completions('SELECT customer_| FROM `demo-project.mart.sales` s JOIN `demo-project.mart.customers` c ON s.customer_id=c.customer_id');
  assert.deepEqual(found.map(x=>x.label).sort(),['c.customer_id','customer_name','s.customer_id']);
  assert.deepEqual(found.filter(x=>x.label.endsWith('customer_id')).map(x=>x.filterText),['customer_id','customer_id']);
});
test('unrelated scopes, literals, comments and invalid alias do not give unsafe columns',()=>{
  assert.deepEqual(names('SELECT sales_| FROM unknown_table t1'),[]);
  assert.deepEqual(names('SELECT sales_| FROM `demo-project.mart.sales` s; SELECT * FROM `demo-project.mart.customers` c'),['sales_amount']); // Later statement cannot override earlier scope
});
