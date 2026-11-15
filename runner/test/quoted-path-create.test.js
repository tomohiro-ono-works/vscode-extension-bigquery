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

test('unquoted CREATE FUNCTION selected project and dataset use only the current segment',()=>{
  const c={tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[]}]};
  const o={projects:['demo-project']};
  const full='CREATE OR REPLACE FUNCTION demo-project.mart.function_name(args) AS (expression);';
  for(const [part,kind] of [['demo-project','project'],['mart','dataset']]) {
    const at=full.indexOf(part),without=full.slice(0,at)+full.slice(at+part.length);
    const item=getSuggestions(c,without,at,o).find(x=>x.kind===kind&&x.label===part);
    assert.ok(item,part);assert.equal(item.insertText,part);
  }
});
test('unquoted CREATE PROCEDURE and TABLE FUNCTION project/dataset candidates',()=>{
  for(const kind of ['PROCEDURE','TABLE FUNCTION']){
    const prefix=`CREATE OR REPLACE ${kind} `;
    assert.ok(names(prefix+'`').length>=0);
    assert.ok(getSuggestions(catalog,prefix,prefix.length,opts).some(x=>x.label==='demo-project'));
    assert.ok(getSuggestions(catalog,prefix+'demo-project.',(prefix+'demo-project.').length,opts).some(x=>x.label==='mart'));
  }
});
test('CREATE TEMP FUNCTION has no qualified project target',()=>{
  assert.deepEqual(names('CREATE TEMP FUNCTION '),[]);
});
