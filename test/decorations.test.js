'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {tokenize,PALETTE} = require('../src/tokenize');

function values(source,kind) {
  return tokenize(source).filter((token) => token.kind === kind)
    .map((token) => source.slice(token.start, token.end));
}

test('reproduces sampled screenshot foreground and background colors', () => {
  assert.deepEqual(PALETTE.keyword,{color:'#7B30D0',fontStyle:'italic'});
  assert.deepEqual(PALETTE.comment,{color:'#7B30D0',backgroundColor:'#EDDEFF',fontStyle:'italic'});
  assert.deepEqual(PALETTE.string,{color:'#D33E82',backgroundColor:'#FCF5F8'});
  assert.deepEqual(PALETTE.parameter,{color:'#D33E82',backgroundColor:'#FCF5F8'});
  assert.deepEqual(PALETTE.relation,{color:'#3E8FF1',backgroundColor:'#F4F8FC',fontStyle:'italic',textDecoration:'underline'});
});

test('recognizes screenshot tokens with different styles', () => {
  const sql = [
    '-- BigQuery example',
    'WITH customer_sales AS (',
    '  SELECT o.customer_id, SUM(o.amount) AS total_sales, COUNT(*) AS order_count',
    '  FROM `sample-project.analytics.orders` AS o',
    "  WHERE o.status = 'active' AND o.amount >= 100",
    '    AND o.customer_id = @customer_id',
    ')',
    'SELECT * FROM customer_sales WHERE total_sales BETWEEN 100 AND 10000'
  ].join('\n');

  assert.deepEqual(values(sql,'comment'),['-- BigQuery example']);
  assert.deepEqual(values(sql,'relation'),['customer_sales','`sample-project.analytics.orders`','customer_sales']);
  assert.deepEqual(values(sql,'string'),["'active'"]);
  assert.deepEqual(values(sql,'parameter'),['@customer_id']);
  assert.deepEqual(values(sql,'function'),['SUM','COUNT']);
  assert.deepEqual(values(sql,'number'),['100','100','10000']);
  for (const keyword of ['WITH','AS','SELECT','FROM','WHERE','AND','BETWEEN']) {
    assert.ok(values(sql,'keyword').includes(keyword),keyword);
  }
});

test('skips keyword, function and comment markers inside quoted literals', () => {
  const sql = "SELECT 'WHERE -- not a comment', r'''SELECT /* FROM */''' AS x; -- real comment";
  assert.deepEqual(values(sql,'string'),["'WHERE -- not a comment'","r'''SELECT /* FROM */'''"]);
  assert.deepEqual(values(sql,'comment'),['-- real comment']);
  assert.deepEqual(values(sql,'keyword'),['SELECT','AS']);
});

test('handles multiline comments, escaped quotes, named functions and mixed-case clauses', () => {
  const sql = "/* SELECT SUM(1)\n FROM any */\nselect my_udf('it\\'s fine'), net.ip_from_string('127.0.0.1') from customer_sales";
  assert.deepEqual(values(sql,'comment'),['/* SELECT SUM(1)\n FROM any */']);
  assert.deepEqual(values(sql,'function'),['my_udf','ip_from_string']);
  assert.deepEqual(values(sql,'string'),["'it\\'s fine'","'127.0.0.1'"]);
  assert.deepEqual(values(sql,'relation'),['customer_sales']);
  assert.ok(values(sql,'keyword').includes('select'));
});

test('does not create overlapping decorations and ignores identifiers containing numbers', () => {
  const sql = 'SELECT a1, 23.5, 0xFF, @p, `with.from`, "SELECT"';
  const tokens = tokenize(sql);
  for (let i=1; i<tokens.length; i++) {
    assert.ok(tokens[i-1].end <= tokens[i].start,JSON.stringify(tokens.slice(i-1,i+1)));
  }
  assert.deepEqual(values(sql,'number'),['23.5','0xFF']);
  assert.ok(!values(sql,'number').includes('1'));
});

test('recognizes inline comments immediately after a table reference', () => {
  const sql = 'SELECT * FROM orders-- trailing comment\nSELECT 1';
  assert.deepEqual(values(sql,'relation'),['orders']);
  assert.deepEqual(values(sql,'comment'),['-- trailing comment']);
});
