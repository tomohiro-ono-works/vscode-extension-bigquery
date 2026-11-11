'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {activate} = require('../src/extension');

function harness({selected = 'SELECT 2', document = 'SELECT 1', confirm = 'Execute', project = ''} = {}) {
  const commands = new Map();
  const calls = [];
  const messages = [];
  const outputLines = [];
  let terminalText = '';
  let outputShown = false;
  const vscode = {
    workspace: {getConfiguration: () => ({get: (key, fallback) => ({
      projectId: project, location: 'asia-northeast1', maxRows: 100,
      maximumBytesBilled: '1000000000'
    }[key] ?? fallback)})},
    window: {
      activeTextEditor: {
        document: {languageId: 'googlesql', getText: sel => sel ? selected : document},
        selection: {isEmpty: !selected}
      },
      showWarningMessage: async () => confirm,
      showErrorMessage: text => messages.push(text),
      showInformationMessage: text => messages.push(text),
      createTerminal: () => ({show() {}, sendText: text => {terminalText = text;}}),
      createOutputChannel: () => ({appendLine: line => outputLines.push(line), show: () => {outputShown = true;}, dispose() {}})
    },
    commands: {registerCommand: (id, fn) => {commands.set(id, fn); return {dispose() {}};}}
  };
  const dependencies = {runCli: async (program, args, options) => {
    calls.push({program,args,options});
    return {stdout: program === 'gcloud' ? 'my-project\n' : 'Query complete\n', stderr: ''};
  }};
  const context = {subscriptions: []};
  activate(context, vscode, dependencies);
  return {commands, calls, messages, outputLines, vscode, context,
    get terminalText() {return terminalText;}, get outputShown() {return outputShown;}};
}

test('login opens existing gcloud CLI flow in a terminal without embedding credentials', async () => {
  const h = harness();
  await h.commands.get('bigquerySqlRunner.login')();
  assert.equal(h.terminalText, 'gcloud auth login');
  assert.equal(h.calls.length, 0);
});

test('dry run uses current gcloud project and sends selection to bq stdin', async () => {
  const h = harness();
  await h.commands.get('bigquerySqlRunner.dryRun')();
  assert.deepEqual(h.calls.map(c => c.program), ['gcloud', 'bq']);
  assert.deepEqual(h.calls[0].args, ['config','get-value','project']);
  assert.equal(h.calls[1].options.stdin, 'SELECT 2');
  assert.equal(h.calls[1].args.includes('--dry_run=true'), true);
  assert.equal(h.calls[1].args.includes('--project_id=my-project'), true);
  assert.equal(h.outputShown, true);
  assert.equal(h.outputLines.some(line => line.includes('Query complete')), true);
});

test('execute never launches a query when confirmation is declined', async () => {
  const h = harness({confirm: null, project: 'my-project'});
  await h.commands.get('bigquerySqlRunner.execute')();
  assert.equal(h.calls.length, 0);
});

test('execute requires confirmation and enforces billed bytes without echoing SQL', async () => {
  const h = harness({project: 'my-project', selected: "SELECT 'secret-string'"});
  await h.commands.get('bigquerySqlRunner.execute')();
  assert.deepEqual(h.calls.map(c => c.program), ['bq']);
  assert.equal(h.calls[0].args.includes('--maximum_bytes_billed=1000000000'), true);
  assert.equal(h.calls[0].options.stdin, "SELECT 'secret-string'");
  assert.equal(h.outputLines.join('\n').includes('secret-string'), false);
});

test('missing SQL and missing gcloud project stop before any BigQuery operation', async () => {
  const blank = harness({selected:'', document:'   ', project:'my-project'});
  await blank.commands.get('bigquerySqlRunner.dryRun')();
  assert.equal(blank.calls.length, 0);
  assert.match(blank.messages.join(' '), /empty/i);

  const h = harness({project:''});
  h.vscode.window.activeTextEditor.document.getText = () => 'SELECT 1';
  // Simulate a successful CLI call but no configured active project.
  const failing = {runCli: async program => ({stdout: program === 'gcloud' ? '(unset)\n' : 'Unexpected query', stderr:''})};
  activate({subscriptions:[]}, h.vscode, failing);
  // The second registration overwrites the callbacks in the test harness command registry.
  await h.commands.get('bigquerySqlRunner.dryRun')();
  assert.match(h.messages.join(' '), /project/i);
});
