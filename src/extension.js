'use strict';

const {PALETTE,tokenize} = require('./tokenize');
const {registerGoogleSqlCompletion} = require('./completion-provider');
const {createDictionaryController} = require('./dictionary-controller');

/** Add reference-screenshot colors without replacing the TextMate grammar. */
function createDecorationController(vscode,{debounceMs=120,maxCharacters=500000}={}) {
  const entries = Object.entries(PALETTE);
  const types = new Map(entries.map(([kind,style]) => [kind,
    vscode.window.createTextEditorDecorationType({...style,borderRadius:'0px'})]));
  const subscriptions = [];
  let pending = null;
  let disposed = false;

  function refresh(editor) {
    if (disposed || !editor || editor.document.languageId !== 'googlesql') return;
    const enabled = vscode.workspace.getConfiguration('bigquerySqlLanguage',editor.document.uri)
      .get('referencePalette.enabled',true);
    const text = enabled ? editor.document.getText() : '';
    // Built-in TextMate highlighting remains active for very large files.
    const tokens = text.length <= maxCharacters ? tokenize(text) : [];
    const groups = Object.fromEntries(entries.map(([kind])=>[kind,[]]));

    for (const token of tokens) {
      groups[token.kind].push(new vscode.Range(
        editor.document.positionAt(token.start),editor.document.positionAt(token.end)));
    }
    for (const [kind,type] of types) editor.setDecorations(type,groups[kind]);
  }

  function refreshVisibleEditors() {
    for (const editor of vscode.window.visibleTextEditors) refresh(editor);
  }

  function scheduleRefresh() {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      refreshVisibleEditors();
    },debounceMs);
  }

  const watch = (register,handler) => {
    if (typeof register === 'function') subscriptions.push(register(handler));
  };
  watch(vscode.window.onDidChangeActiveTextEditor?.bind(vscode.window),scheduleRefresh);
  watch(vscode.window.onDidChangeVisibleTextEditors?.bind(vscode.window),scheduleRefresh);
  watch(vscode.workspace.onDidChangeTextDocument?.bind(vscode.workspace),event => {
    if (vscode.window.visibleTextEditors.some(({document}) => document === event.document)) scheduleRefresh();
  });
  watch(vscode.workspace.onDidChangeConfiguration?.bind(vscode.workspace),event => {
    if (!event.affectsConfiguration || event.affectsConfiguration('bigquerySqlLanguage.referencePalette')) scheduleRefresh();
  });
  refreshVisibleEditors();

  return {
    refresh,
    dispose() {
      disposed = true;
      if (pending !== null) clearTimeout(pending);
      for (const subscription of subscriptions) subscription.dispose();
      for (const type of types.values()) type.dispose();
    }
  };
}

/** Highlight non-empty selections without changing selection colors in other languages. */
function createSelectionHighlightController(vscode) {
  const type = vscode.window.createTextEditorDecorationType({
    backgroundColor:'#FFF176',borderRadius:'0px'
  });
  const subscriptions = [];
  let disposed = false;

  function refresh() {
    if (disposed) return;
    const active = vscode.window.activeTextEditor;
    for (const editor of vscode.window.visibleTextEditors) {
      const ranges = editor === active
        && editor.document.languageId === 'googlesql'
        ? editor.selections.filter((selection) => !selection.isEmpty) : [];
      editor.setDecorations(type,ranges);
    }
  }

  subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.window.onDidChangeVisibleTextEditors(refresh)
  );
  refresh();

  return {
    refresh,
    dispose() {
      disposed = true;
      for (const subscription of subscriptions) subscription.dispose();
      type.dispose();
    }
  };
}

function activate(context,vscode = require('vscode')) {
  context.subscriptions.push(createDictionaryController(context,vscode));
  context.subscriptions.push(createDecorationController(vscode));
  context.subscriptions.push(createSelectionHighlightController(vscode));
  context.subscriptions.push(registerGoogleSqlCompletion(vscode));
}

function deactivate() {}

module.exports = {activate,deactivate,createDecorationController,createSelectionHighlightController};
