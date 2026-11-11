'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {registerGoogleSqlCompletion} = require('../src/completion-provider');

function createFixture(source) {
  let selector;
  let provider;
  let disposed = false;
  const vscode = {
    CompletionItemKind:{Keyword:14,Function:2,Snippet:15},
    CompletionItem:class {
      constructor(label,kind) {this.label=label;this.kind=kind;}
    },
    SnippetString:class {
      constructor(value) {this.value=value;}
    },
    Range:class {
      constructor(start,end) {this.start=start;this.end=end;}
    },
    languages: {
      registerCompletionItemProvider(language,handler,...triggerCharacters) {
        selector=language;
        provider=handler;
        assert.deepEqual(triggerCharacters,[]);
        return {dispose(){disposed=true;}};
      }
    }
  };
  const document = {
    languageId:'googlesql',
    getText:()=>source,
    lineAt(line) {return {text:source.split('\n')[line]};},
    offsetAt(position) {
      return source.split('\n').slice(0,position.line).join('\n').length
        + (position.line > 0 ? 1 : 0) + position.character;
    }
  };
  function completeAt(line,character) {
    return provider.provideCompletionItems(document,{line,character});
  }
  function completeEnd() {
    const lines=source.split('\n');
    return completeAt(lines.length-1,lines.at(-1).length);
  }
  return {
    vscode,document,completeAt,completeEnd,
    get selector(){return selector;},
    get disposed(){return disposed;},
    register(){return registerGoogleSqlCompletion(vscode);}
  };
}

test('registers only for GoogleSQL, preserves incomplete typing refresh and can dispose', () => {
  const f=createFixture('s');
  const subscription=f.register();
  assert.equal(f.selector,'googlesql');
  assert.equal(f.completeEnd().isIncomplete,true);
  subscription.dispose();
  assert.equal(f.disposed,true);
});

test('one character suggests prefix keywords only, and zero characters suggests nothing', () => {
  const f=createFixture('s');f.register();
  const result=f.completeEnd();
  assert.ok(result.items.some((item)=>item.label==='SELECT'));
  assert.ok(result.items.every((item)=>item.kind===f.vscode.CompletionItemKind.Keyword));
  const empty=createFixture('');empty.register();
  assert.deepEqual(empty.completeEnd().items,[]);
});

test('two characters suggest keywords and functions; functions insert parentheses with tab stop', () => {
  const f=createFixture('SELECT co');f.register();
  const result=f.completeEnd();
  const keyword=result.items.find((item)=>item.label==='COMMIT');
  const fn=result.items.find((item)=>item.label==='COUNT');
  assert.equal(keyword.kind,f.vscode.CompletionItemKind.Keyword);
  assert.equal(keyword.insertText,'COMMIT');
  assert.equal(fn.kind,f.vscode.CompletionItemKind.Function);
  assert.ok(fn.insertText instanceof f.vscode.SnippetString);
  assert.equal(fn.insertText.value,'COUNT($1)');
  assert.deepEqual(fn.range.start,{line:0,character:7});
  assert.deepEqual(fn.range.end,{line:0,character:9});
});

test('three characters include substring matches after prefix matches and retain them in filtering', () => {
  const f=createFixture('cou');f.register();
  const result=f.completeEnd();
  const fn=result.items.find((item)=>item.label==='COUNT');
  const contains=result.items.find((item)=>item.label==='APPROX_COUNT_DISTINCT');
  assert.ok(fn);
  assert.ok(contains);
  assert.equal(contains.filterText,'cou');
  assert.ok(fn.sortText < contains.sortText);
  assert.equal(new Set(result.items.map((item)=>item.label)).size,result.items.length);
});

test('qualified functions are inserted with the original namespace intact', () => {
  const f=createFixture('SELECT NET.IP');f.register();
  const result=f.completeEnd();
  const fn=result.items.find((item)=>item.label==='NET.IP_FROM_STRING');
  assert.ok(fn);
  assert.equal(fn.insertText.value,'NET.IP_FROM_STRING($1)');
  assert.deepEqual(fn.range.start,{line:0,character:7});
});

test('never suggests code inside comments, quoted strings or SQL parameters', () => {
  for (const source of ['-- co','SELECT 1 -- co','/* co','/* start\nco','\'co','"co','SELECT @co']) {
    const f=createFixture(source);f.register();
    assert.deepEqual(f.completeEnd().items,[],source);
  }
  const f=createFixture('SELECT "co"');f.register();
  assert.deepEqual(f.completeAt(0,10).items,[]);
});

test('does not interfere with normal editors or whitespace and punctuation', () => {
  const f=createFixture('SELECT ');f.register();
  assert.deepEqual(f.completeEnd().items,[]);
  const wrong=createFixture('co');wrong.document.languageId='javascript';wrong.register();
  assert.deepEqual(wrong.completeEnd().items,[]);
});

test('prioritizes FROM after SELECT and WHERE after FROM using up to 20 previous lines', () => {
  const select=createFixture('SELECT aaaaaaaaa\nF');select.register();
  const from=select.completeEnd().items.find((item)=>item.label==='FROM');
  assert.ok(from);
  assert.equal(from.sortText,'0_0_FROM');

  const table=createFixture('SELECT a\nFROM my_table\nW');table.register();
  const items=table.completeEnd().items;
  assert.equal(items.find((item)=>item.label==='WHERE').sortText,'0_0_WHERE');
  assert.ok(items.find((item)=>item.label==='WINDOW').sortText > items.find((item)=>item.label==='WHERE').sortText);
});

test('JOIN is a three-field snippet, and separate ON and GROUP BY candidates are absent', () => {
  const f=createFixture('SELECT a FROM t\nJ');f.register();
  const join=f.completeEnd().items.find((item)=>item.label==='JOIN');
  assert.equal(join.kind,f.vscode.CompletionItemKind.Snippet);
  assert.ok(join.insertText instanceof f.vscode.SnippetString);
  assert.equal(join.insertText.value,'JOIN ${1:table_name}\n  ON ${2:left_column} = ${3:right_column}');
  for (const typed of ['O','G','ON']) {
    const sample=createFixture(typed);sample.register();
    const labels=sample.completeEnd().items.map((item)=>item.label);
    assert.equal(labels.includes('ON'),false);
    assert.equal(labels.includes('GROUP BY'),false);
  }
});

test('does not prioritize a FROM inside a previous CTE as if it were the current query', () => {
  const f=createFixture('WITH c AS (SELECT a FROM t)\nSELECT b\nW');f.register();
  const items=f.completeEnd().items;
  const where=items.find((item)=>item.label==='WHERE');
  assert.ok(where);
  assert.notEqual(where.sortText,'0_0_WHERE');
});

test('prioritizes only one candidate when multiple next clauses match the prefix', () => {
  const f=createFixture('SELECT a FROM t WHERE a=1\nO');f.register();
  const items=f.completeEnd().items;
  assert.equal(items.filter((item)=>item.preselect===true).length,1);
  assert.ok(items.some((item)=>item.label==='OR' && item.sortText.startsWith('0_')));
  assert.ok(items.some((item)=>item.label==='ORDER BY' && item.sortText.startsWith('0_')));
});

test('does not offer USING when the local query is in a JOIN clause', () => {
  const f=createFixture('SELECT a FROM t JOIN other_table\nU');f.register();
  assert.equal(f.completeEnd().items.some((item)=>item.label==='USING'),false);
});

test('offers GROUP BY ALL rather than a partial GROUP BY and promotes ORDER BY afterwards', () => {
  const f=createFixture('SELECT a FROM t\nG');f.register();
  assert.equal(f.completeEnd().items.find((item)=>item.label==='GROUP BY ALL').sortText,'0_0_GROUP BY ALL');
  const ordered=createFixture('SELECT a FROM t GROUP BY ALL\nO');ordered.register();
  assert.equal(ordered.completeEnd().items.find((item)=>item.label==='ORDER BY').sortText,'0_0_ORDER BY');
});
