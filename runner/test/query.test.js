'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getSqlFromEditor, buildBqInvocation } = require('../src/query');

function editor(full, selected = '') {
  return {
    selection: { isEmpty: selected === '' },
    document: { getText: (selection) => selection ? selected : full }
  };
}

test('uses selected SQL when present and otherwise the full editor text', () => {
  assert.equal(getSqlFromEditor(editor('SELECT 1;\nSELECT 2;', 'SELECT 2;')), 'SELECT 2;');
  assert.equal(getSqlFromEditor(editor('SELECT 1;')), 'SELECT 1;');
  assert.throws(() => getSqlFromEditor(editor('  \n')), /empty/i);
  assert.throws(() => getSqlFromEditor(null), /editor/i);
});

test('passes unmodified multiline SQL through stdin, never in command arguments', () => {
  const sql = 'SELECT "a; b", \'hello\'\nFROM `demo-project.data.events`;';
  const invocation = buildBqInvocation({sql, projectId: 'demo-project', location:'asia-northeast1', dryRun:true});
  assert.equal(invocation.program, 'bq');
  assert.equal(invocation.stdin, sql);
  assert.deepEqual(invocation.args, [
    '--project_id=demo-project', '--location=asia-northeast1', '--format=pretty',
    'query', '--use_legacy_sql=false', '--dry_run=true', '--max_rows=100'
  ]);
  assert.equal(invocation.args.join(' ').includes('SELECT'), false);
});

test('execution applies billed-byte limit and result row cap', () => {
  const invocation = buildBqInvocation({sql:'SELECT 1', projectId:'demo-project', dryRun:false,
    maximumBytesBilled:'1000000000', maxRows:25});
  assert.deepEqual(invocation.args, [
    '--project_id=demo-project', '--format=pretty', 'query', '--use_legacy_sql=false',
    '--max_rows=25', '--maximum_bytes_billed=1000000000'
  ]);
});

test('rejects invalid project/location, limits and missing SQL before CLI launch', () => {
  const base = {sql:'SELECT 1', projectId:'demo-project', dryRun:false};
  assert.throws(() => buildBqInvocation({...base,projectId:'demo; rm file'}), /project/i);
  assert.throws(() => buildBqInvocation({...base,location:'asia-northeast1 && echo stolen'}), /location/i);
  assert.throws(() => buildBqInvocation({...base,maxRows:0}), /maxRows/i);
  assert.throws(() => buildBqInvocation({...base,maxRows:1001}), /maxRows/i);
  assert.throws(() => buildBqInvocation({...base,maximumBytesBilled:'0'}), /maximumBytesBilled/i);
  assert.throws(() => buildBqInvocation({...base,sql:'  '}), /empty/i);
  assert.throws(() => buildBqInvocation({...base,projectId:''}), /project/i);
});
