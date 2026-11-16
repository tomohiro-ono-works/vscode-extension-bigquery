'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {activate,createDecorationController} = require('../src/extension');

function createFixture(source = "-- hi\nSELECT 'active' FROM customer_sales",enabled = true) {
  const created = [];
  const updates = [];
  const events = {};
  const document = {
    languageId:'googlesql',uri:'test.bqsql',
    getText:() => source,
    positionAt(offset) {
      const before = source.slice(0,offset);
      const split = before.split('\n');
      return {line:split.length-1,character:split.at(-1).length};
    }
  };
  const editor = {
    document,
    setDecorations(type,ranges) {updates.push({type,ranges});}
  };
  const vscode = {
    window: {
      visibleTextEditors:[editor],
      createTextEditorDecorationType(options) {
        const type = {options,dispose(){}};
        created.push(type);
        return type;
      },
      onDidChangeActiveTextEditor:(fn) => {events.editor=fn;return {dispose(){}};},
      onDidChangeVisibleTextEditors:(fn) => {events.visible=fn;return {dispose(){}};}
    },
    workspace: {
      getConfiguration:() => ({get:() => enabled}),
      onDidChangeTextDocument:(fn) => {events.text=fn;return {dispose(){}};},
      onDidChangeConfiguration:(fn) => {events.config=fn;return {dispose(){}};}
    },
    Range:class {constructor(start,end){this.start=start;this.end=end;}}
  };
  return {vscode,editor,document,events,created,updates};
}

test('uses editor decorations only for GoogleSQL and refreshes text ranges', () => {
  const f=createFixture();
  const controller=createDecorationController(f.vscode,{debounceMs:0});
  controller.refresh(f.editor);
  assert.equal(f.created.length,8);
  const comment=f.created.find((t) => t.options.backgroundColor === '#EDDEFF');
  const relation=f.created.find((t) => t.options.color === '#3E8FF1');
  assert.ok(f.updates.some((update) => update.type === comment && update.ranges.length === 1));
  assert.ok(f.updates.some((update) => update.type === relation && update.ranges.length === 1));
  assert.deepEqual(f.updates.find((update) => update.type===comment && update.ranges.length).ranges[0].start,{line:0,character:0});

  const before=f.updates.length;
  const other={...f.editor,document:{...f.document,languageId:'javascript'}};
  controller.refresh(other);
  assert.equal(f.updates.length,before);
  controller.dispose();
});

test('respects a switch that disables custom colors without changing grammar', () => {
  const f=createFixture('SELECT 123',false);
  const controller=createDecorationController(f.vscode,{debounceMs:0});
  controller.refresh(f.editor);
  assert.ok(f.updates.every((u) => u.ranges.length===0));
  controller.dispose();
});

test('updates decorated ranges on text changes with debounce', async () => {
  const f=createFixture('SELECT 1');
  const controller=createDecorationController(f.vscode,{debounceMs:1});
  f.events.text({document:f.document});
  await new Promise((resolve)=>setTimeout(resolve,20));
  assert.ok(f.updates.some(({ranges}) => ranges.some(({start}) => start.line === 0)));
  controller.dispose();
});

test('activation retains existing decorators and registers GoogleSQL completion as a third feature', () => {
  const f=createFixture('SELECT 1');
  let completionLanguage;
  f.vscode.window.activeTextEditor=f.editor;
  f.editor.selections=[];
  f.vscode.window.onDidChangeTextEditorSelection=() => ({dispose(){}});
  f.vscode.languages={
    registerCompletionItemProvider(language) {
      completionLanguage=language;
      return {dispose(){}};
    }
  };
  const context={subscriptions:[]};
  activate(context,f.vscode);
  assert.equal(completionLanguage,'googlesql');
  assert.equal(context.subscriptions.length,4);
  assert.equal(f.created.length,9);
  for (const subscription of context.subscriptions) subscription.dispose();
});
