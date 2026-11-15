'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {getCatalog,findCompletions} = require('../src/completion');

test('uses the existing GoogleSQL grammar catalog for keywords, functions and qualified functions', () => {
  const catalog=getCatalog();
  assert.ok(catalog.keywords.includes('SELECT'));
  assert.ok(catalog.keywords.includes('WHERE'));
  assert.ok(catalog.keywords.includes('JOIN'));
  assert.ok(catalog.functions.includes('COUNT'));
  assert.ok(catalog.functions.includes('NET.IP_FROM_STRING'));
  assert.equal(new Set(catalog.keywords).size,catalog.keywords.length);
  assert.equal(new Set(catalog.functions).size,catalog.functions.length);
});

test('one-letter matches return only prefix-matched syntax keywords', () => {
  const candidates=findCompletions('s');
  assert.ok(candidates.some((item)=>item.label==='SELECT' && item.kind==='keyword'));
  assert.ok(candidates.every((item)=>item.kind==='keyword'));
  assert.ok(candidates.every((item)=>item.label.startsWith('S') && item.matchKind==='prefix'));
  assert.deepEqual(findCompletions(''),[]);
});

test('two-letter matches return both prefix-matched keywords and functions', () => {
  const candidates=findCompletions('co');
  assert.ok(candidates.some((item)=>item.label==='COMMIT' && item.kind==='keyword'));
  assert.ok(candidates.some((item)=>item.label==='COUNT' && item.kind==='function'));
  assert.ok(candidates.every((item)=>item.label.startsWith('CO') && item.matchKind==='prefix'));
  assert.deepEqual(findCompletions('Co'),candidates);
});

test('three or more letters return prefix results before substring results', () => {
  const candidates=findCompletions('cou');
  const firstContains=candidates.findIndex((item)=>item.matchKind==='substring');
  assert.ok(firstContains>0);
  assert.ok(candidates.slice(0,firstContains).every((item)=>item.label.startsWith('COU')));
  assert.ok(candidates.slice(firstContains).every((item)=>!item.label.startsWith('COU') && item.label.includes('COU')));
  assert.ok(candidates.some((item)=>item.label==='APPROX_COUNT_DISTINCT' && item.matchKind==='substring'));
  assert.equal(new Set(candidates.map((item)=>item.label)).size,candidates.length);
});

test('qualified function names retain the namespace during prefix and substring searches', () => {
  assert.ok(findCompletions('NET.IP').some((item)=>item.label==='NET.IP_FROM_STRING' && item.kind==='function'));
  assert.ok(findCompletions('FROM_STRING').some((item)=>item.label==='NET.IP_FROM_STRING' && item.matchKind==='substring'));
});

test('offers complete SQL phrases and removes standalone partial clauses from suggestions', () => {
  const completions=['c','g','o','p','j','on','gro','cre'].flatMap(findCompletions);
  const labels=new Set(completions.map(({label})=>label));
  for (const forbidden of ['CREATE','GROUP','GROUP BY','ORDER','ON','PARTITION','CLUSTER']) {
    assert.equal(labels.has(forbidden),false,forbidden);
  }
  for (const expected of [
    'CREATE TEMP TABLE','CREATE TEMP FUNCTION','CREATE OR REPLACE TABLE',
    'CREATE OR REPLACE FUNCTION','CREATE OR REPLACE PROCEDURE',
    'CREATE OR REPLACE TABLE FUNCTION','CREATE OR REPLACE VIEW',
    'GROUP BY ALL','ORDER BY','PARTITION BY','CLUSTER BY','JOIN'
  ]) assert.ok(findCompletions(expected[0]).some((item)=>item.label===expected),expected);
  assert.equal(findCompletions('GR').some(({label})=>label==='GROUP BY ALL'),true);
  assert.equal(findCompletions('GROUP BY').some(({label})=>label==='GROUP BY ALL'),true);
});

test('syntax snippets contain the requested whole statements with numbered input placeholders', () => {
  const join=findCompletions('j').find((item)=>item.label==='JOIN');
  assert.equal(join.kind,'snippet');
  assert.equal(join.insertText,'JOIN ${1:table_name}\n  ON ${2:left_column} = ${3:right_column}');

  const temporary=findCompletions('create').find(({label})=>label==='CREATE TEMP TABLE');
  assert.equal(temporary.insertText,'CREATE TEMP TABLE ${1:table_name} AS\n${2:SELECT * FROM source_table};');
  assert.ok(!temporary.insertText.includes('project'));

  const functionSnippet=findCompletions('create').find(({label})=>label==='CREATE TEMP FUNCTION');
  assert.match(functionSnippet.insertText,/FUNCTION \$\{1:function_name\}\(\$\{2:arguments\}\) AS \(\$\{3:expression\}\);/);

  const procedure=findCompletions('create').find(({label})=>label==='CREATE OR REPLACE PROCEDURE');
  assert.match(procedure.insertText,/PROCEDURE \$\{1:project\}\.\$\{2:dataset\}\.\$\{3:procedure_name\}/);
  assert.ok(findCompletions('clu').some((item)=>item.label==='CLUSTER BY'));
});


test('CREATE table snippets include a SQL body and tab-stop placeholders', () => {
  const temp=findCompletions('CREATE').find(x=>x.label==='CREATE TEMP TABLE');
  assert.match(temp.insertText,/CREATE TEMP TABLE .+ AS\n/);
  const replace=findCompletions('CREATE OR').find(x=>x.label==='CREATE OR REPLACE TABLE');
  assert.match(replace.insertText,/CREATE OR REPLACE TABLE .+ AS\n/);
  assert.equal(findCompletions('CREATE').some(x=>x.label==='CREATE'),false);
});
