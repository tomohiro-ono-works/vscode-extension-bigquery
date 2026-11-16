'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../googlesql-core/dictionaries');
const grammar=require('../../syntaxes/googlesql.tmLanguage.json');
const {getCatalog,findCompletions}=require('../googlesql-core/completion');

function read(file){
  return fs.readFileSync(path.join(dir,file),'utf8').split(/\r?\n/)
    .map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
}
function grammarTerms(scope){
  const match=grammar.patterns.find(x=>x.name===scope)?.match;
  assert.ok(match,'missing '+scope);
  const at=match.indexOf('(?:')+3,end=match.indexOf(')',at);
  return match.slice(at,end).split('|').map(x=>x.replace(/\\\./g,'.'));
}

test('keyword/function lists match completion results and all TextMate categories',()=>{
  const keywords=read('keywords.txt'),functions=read('functions.txt');
  assert.ok(keywords.length>100&&functions.length>200);
  assert.deepEqual([...new Set(keywords)].sort(),[...getCatalog().keywords]);
  assert.deepEqual([...new Set(functions)].sort(),[...getCatalog().functions]);
  assert.deepEqual(keywords,grammarTerms('keyword.control.googlesql'));
  assert.deepEqual(functions.filter(x=>!x.includes('.')),grammarTerms('support.function.builtin.googlesql'));
  assert.deepEqual(functions.filter(x=>x.includes('.')),grammarTerms('support.function.namespace.googlesql'));
});
test('external snippet dictionary preserves twelve CREATE/JOIN syntax templates',()=>{
  const snippets=require('../googlesql-core/dictionaries/snippets.json');
  assert.equal(snippets.length,12);
  for(const snippet of snippets){
    assert.equal(findCompletions(snippet.label).find(x=>x.label===snippet.label)?.insertText,snippet.insertText);
  }
  assert.ok(snippets.some(s=>s.label==='JOIN'&&s.insertText.includes(' ON ')));
  assert.ok(snippets.some(s=>s.label==='CREATE OR REPLACE TABLE'&&s.insertText.includes('project')));
});
