'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createSelectionHighlightController} = require('../src/extension');

const range = (line,from,to) => ({
  start:{line,character:from},end:{line,character:to},isEmpty:from===to
});

function fixture() {
  const events = {};
  const created = [];
  const records = [];
  const disposed = [];
  const editor = (languageId,selections=[]) => ({
    document:{languageId},selections,
    setDecorations(type,ranges) {records.push({editor:this,type,ranges:[...ranges]});}
  });
  const sql = editor('googlesql',[range(0,7,14)]);
  const js = editor('javascript',[range(0,1,5)]);
  const vscode = {
    window:{
      activeTextEditor:sql,visibleTextEditors:[sql,js],
      createTextEditorDecorationType(options) {
        const type={options,dispose(){disposed.push(type);}};
        created.push(type);
        return type;
      },
      onDidChangeTextEditorSelection(fn) {events.selection=fn;return {dispose(){disposed.push('selection');}};},
      onDidChangeActiveTextEditor(fn) {events.active=fn;return {dispose(){disposed.push('active');}};},
      onDidChangeVisibleTextEditors(fn) {events.visible=fn;return {dispose(){disposed.push('visible');}};}
    }
  };
  const last = (target) => records.filter((x)=>x.editor===target).at(-1);
  return {vscode,sql,js,events,created,records,disposed,last};
}

test('highlights only the exact selection in the active GoogleSQL editor and clears it immediately', () => {
  const f=fixture();
  const controller=createSelectionHighlightController(f.vscode);
  assert.equal(f.created.length,1);
  assert.equal(f.created[0].options.backgroundColor,'#FFF176');
  assert.deepEqual(f.last(f.sql).ranges,[range(0,7,14)]);
  assert.deepEqual(f.last(f.js).ranges,[]);

  f.sql.selections=[range(1,2,8)];
  f.events.selection({textEditor:f.sql,selections:f.sql.selections});
  assert.deepEqual(f.last(f.sql).ranges,[range(1,2,8)]);

  f.sql.selections=[range(1,8,8)];
  f.events.selection({textEditor:f.sql,selections:f.sql.selections});
  assert.deepEqual(f.last(f.sql).ranges,[]);
  controller.dispose();
});

test('switching editors clears stale highlights and never highlights other languages', () => {
  const f=fixture();
  const controller=createSelectionHighlightController(f.vscode);
  f.vscode.window.activeTextEditor=f.js;
  f.events.active(f.js);
  assert.deepEqual(f.last(f.sql).ranges,[]);
  assert.deepEqual(f.last(f.js).ranges,[]);

  f.vscode.window.activeTextEditor=f.sql;
  f.events.active(f.sql);
  assert.deepEqual(f.last(f.sql).ranges,[range(0,7,14)]);
  controller.dispose();
});

test('multiple selections are supported, and hidden editors are never accessed after closing', () => {
  const f=fixture();
  const controller=createSelectionHighlightController(f.vscode);
  f.sql.selections=[range(0,1,3),range(1,4,4),range(2,5,9)];
  f.events.selection({textEditor:f.sql,selections:f.sql.selections});
  assert.deepEqual(f.last(f.sql).ranges,[range(0,1,3),range(2,5,9)]);

  const sqlRecords=f.records.filter((r)=>r.editor===f.sql).length;
  f.sql.setDecorations=()=>{throw new Error('TextEditor disposed after closing');};
  f.vscode.window.visibleTextEditors=[f.js];
  f.events.visible([f.js]);
  assert.equal(f.records.filter((r)=>r.editor===f.sql).length,sqlRecords);
  controller.dispose();
});

test('disposing removes all event listeners and the selection decoration type', () => {
  const f=fixture();
  const controller=createSelectionHighlightController(f.vscode);
  const count=f.records.length;
  controller.dispose();
  assert.ok(f.disposed.includes('selection'));
  assert.ok(f.disposed.includes('active'));
  assert.ok(f.disposed.includes('visible'));
  assert.ok(f.disposed.includes(f.created[0]));
  f.events.selection({textEditor:f.sql,selections:f.sql.selections});
  assert.equal(f.records.length,count);
});
