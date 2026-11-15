'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../googlesql-core');
const lang=require('../../src/completion');
const tokens=require('../../src/tokenize');
const localClause=require('../../src/completion-context');
const runner=require('../../runner/src/sql-scope');

test('both extension adapters reuse one Core implementation',()=>{
  assert.strictEqual(lang.findCompletions,core.findCompletions);
  assert.strictEqual(tokens.tokenize,core.tokenize);
  assert.strictEqual(localClause.getSqlCompletionContext,core.getSqlCompletionContext);
  assert.strictEqual(runner.sqlCompletionContext,core.sqlCompletionContext);
});
test('CREATE syntax remains in the Language catalog',()=>{
  assert.ok(core.findCompletions('CRE').some(x=>x.label==='CREATE OR REPLACE TABLE'));
  assert.ok(core.findCompletions('CO').some(x=>x.label==='COUNT'));
  assert.ok(!core.findCompletions('CRE').some(x=>x.label==='CREATE'));
});
test('CTE parser remains available from common Core',()=>{
  const sql='WITH a AS (SELECT customer_id FROM mart.sales) SELECT * FROM a';
  const parsed=core.lexSql(sql);
  assert.ok(parsed.frames.length>1);
  assert.ok(core.collectCtes(parsed).some(c=>c.name==='a'));
});
