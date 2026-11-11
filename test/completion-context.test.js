'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {getSqlCompletionContext} = require('../src/completion-context');

const context = (sql) => getSqlCompletionContext(sql,sql.length);

test('identifies the last active SQL clause in the current query block', () => {
  assert.equal(context('SELECT aaaaaaaaa\n'),'SELECT');
  assert.equal(context('SELECT a FROM project.dataset.table\n'),'FROM');
  assert.equal(context('SELECT a FROM t WHERE a = 1\n'),'WHERE');
  assert.equal(context('SELECT a, COUNT(*) FROM t GROUP BY ALL\n'),'GROUP BY ALL');
  assert.equal(context('SELECT a FROM t ORDER BY a\n'),'ORDER BY');
});

test('ignores SQL words inside comments, literals, parameters and quoted identifiers', () => {
  assert.equal(context('SELECT a -- FROM disguised\n'),'SELECT');
  assert.equal(context("SELECT 'FROM WHERE' AS text\n"),'SELECT');
  assert.equal(context('SELECT `fake.FROM` AS value\n'),'SELECT');
  assert.equal(context('SELECT @FROM AS value\n'),'SELECT');
  assert.equal(context('SELECT a /* FROM\nWHERE */ FROM t\n'),'FROM');
});

test('respects statement separators and nested CTE/subquery scopes', () => {
  assert.equal(context('SELECT a FROM old;\nSELECT b\n'),'SELECT');
  assert.equal(context('WITH c AS (SELECT a FROM internal) SELECT b\n'),'SELECT');
  assert.equal(context('SELECT a FROM (SELECT b FROM internal) x\n'),'FROM');
  assert.equal(context('SELECT a FROM (SELECT b FROM internal WHERE b) x\n'),'FROM');
  assert.equal(context('SELECT a FROM (SELECT b\n'),'SELECT');
});

test('never scans more than 20 preceding lines and falls back when context is absent', () => {
  assert.equal(context('SELECT a\n'+'a,\n'.repeat(20)),null);
  assert.equal(context('SELECT a\n'+'a,\n'.repeat(19)),'SELECT');
  assert.equal(context('a\n'.repeat(30)),null);
});
