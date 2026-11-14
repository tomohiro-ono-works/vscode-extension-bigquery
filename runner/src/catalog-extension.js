'use strict';

const path = require('node:path');
const {
  checkProject, checkId, listDatasets, listTables, parseTable, normalizeCatalog,
  upsertTable, tableKey, catalogToYaml, getSuggestions
} = require('./catalog');
const {runCli} = require('./cli');

const STORE_KEY = 'bigquerySqlRunner.catalog.v1'; // Preserve v0.2.0 registrations.
const PROJECTS_KEY = 'bigquerySqlRunner.projects.v1';
const VIEW_ID = 'bigquerySqlRunner.catalog';
const OUTPUT_LIMIT = 2 * 1024 * 1024;

const keyFor = (p,d,t) => `${p}.${d}.${t}`;
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();

function registerCatalog(context, vscode, dependencies = {}) {
  const run = dependencies.runCli || runCli;
  const {window, workspace, commands, languages, Uri} = vscode;
  let catalog = normalizeCatalog(context.workspaceState.get(STORE_KEY));
  const savedProjects = context.workspaceState.get(PROJECTS_KEY);
  let projects = [...new Set([
    ...(Array.isArray(savedProjects) ? savedProjects : []),
    ...catalog.tables.map(t => t.project)
  ].filter(p => {try {checkProject(p); return true;} catch {return false;}}))].sort();
  const datasetCache = new Map();
  const tableListCache = new Map();
  const metadataCache = new Map();
  const emitter = new vscode.EventEmitter();
  const state = vscode.TreeItemCheckboxState || {Unchecked:0, Checked:1};
  const treeState = vscode.TreeItemCollapsibleState;
  let view;

  const tableEntry = (p,d,t) => catalog.tables.find(x => same(x.project,p) && same(x.dataset,d) && same(x.name,t));
  const metaKey = (p,d,t) => keyFor(p,d,t).toLowerCase();
  const registeredColumn = (p,d,t,c) => tableEntry(p,d,t)?.columns.some(x => same(x.name,c)) || false;

  function node(kind,label,parts = {}) {
    return {kind,label,...parts};
  }
  function projectNode(project) {
    return node('project',project,{project,id:`project:${project}`,collapsible:true});
  }
  function datasetNode(project,dataset) {
    return node('dataset',dataset,{project,dataset,id:`dataset:${project}/${dataset}`,collapsible:true});
  }
  function tableNode(project,dataset,name) {
    return node('table',name,{project,dataset,name,id:`table:${project}/${dataset}/${name}`,collapsible:true});
  }
  function columnNode(project,dataset,name,column) {
    return node('column',column.name,{project,dataset,name,columnName:column.name,
      data:column,id:`column:${project}/${dataset}/${name}/${column.name}`,collapsible:false});
  }

  const provider = {
    onDidChangeTreeData: emitter.event,
    getTreeItem(entry) {
      const item = new vscode.TreeItem(entry.label,entry.collapsible ? treeState.Collapsed : treeState.None);
      item.id = entry.id; // Stable identity: expansion remains after registration/refresh.
      const selectedTable = entry.kind === 'table' && tableEntry(entry.project,entry.dataset,entry.name);
      const selectedColumn = entry.kind === 'column' && registeredColumn(entry.project,entry.dataset,entry.name,entry.columnName);
      item.contextValue = entry.kind === 'table' ? (selectedTable ? 'registeredTable' : 'table')
        : entry.kind === 'column' ? (selectedColumn ? 'registeredColumn' : 'column') : entry.kind;
      if (entry.kind === 'project') item.iconPath = new vscode.ThemeIcon('cloud');
      if (entry.kind === 'dataset') item.iconPath = new vscode.ThemeIcon('database');
      if (entry.kind === 'table') {
        item.iconPath = new vscode.ThemeIcon('table');
        item.checkboxState = selectedTable ? state.Checked : state.Unchecked;
        item.description = selectedTable ? `登録済 · ${selectedTable.columns.length}列` : '';
        item.tooltip = selectedTable?.description || `${entry.project}.${entry.dataset}.${entry.name}`;
      }
      if (entry.kind === 'column') {
        const stored = tableEntry(entry.project,entry.dataset,entry.name)?.columns
          .find(x => same(x.name,entry.columnName));
        item.iconPath = new vscode.ThemeIcon('symbol-field');
        item.checkboxState = selectedColumn ? state.Checked : state.Unchecked;
        item.description = stored?.type || entry.data?.type || '';
        item.tooltip = stored?.description || entry.data?.description || entry.columnName;
      }
      return item;
    },
    async getChildren(parent) {
      if (!parent) return projects.map(projectNode);
      try {
        if (parent.kind === 'project') {
          const datasets = await availableDatasets(parent.project);
          return datasets.map(d => datasetNode(parent.project,d));
        }
        if (parent.kind === 'dataset') {
          const names = await availableTables(parent.project,parent.dataset);
          return names.map(t => tableNode(parent.project,parent.dataset,t));
        }
        if (parent.kind === 'table') {
          const meta = await availableMetadata(parent.project,parent.dataset,parent.name);
          const stored = tableEntry(parent.project,parent.dataset,parent.name);
          const merged = new Map(meta.columns.map(c => [c.name.toLowerCase(),c]));
          for (const c of stored?.columns || []) {
            const k = c.name.toLowerCase();
            // Keep user-edited descriptions for previously registered fields.
            merged.set(k,{...(merged.get(k) || {}),...c});
          }
          return [...merged.values()].map(c => columnNode(parent.project,parent.dataset,parent.name,c));
        }
        return [];
      } catch (error) {
        // Cache no failures: the refresh button or next expand can retry.
        window.showErrorMessage(`BigQuery Completion (${parent.label}): ${error.message}`);
        if (parent.kind === 'project') {
          return [...new Set(catalog.tables.filter(t => same(t.project,parent.project)).map(t => t.dataset))]
            .sort().map(d => datasetNode(parent.project,d));
        }
        if (parent.kind === 'dataset') {
          return catalog.tables.filter(t => same(t.project,parent.project) && same(t.dataset,parent.dataset))
            .map(t => tableNode(parent.project,parent.dataset,t.name));
        }
        if (parent.kind === 'table') {
          return (tableEntry(parent.project,parent.dataset,parent.name)?.columns || [])
            .map(c => columnNode(parent.project,parent.dataset,parent.name,c));
        }
        return [];
      }
    }
  };

  async function persistCatalog() {
    catalog = normalizeCatalog(catalog);
    await context.workspaceState.update(STORE_KEY,catalog);
    emitter.fire();
  }
  async function persistProjects() {
    await context.workspaceState.update(PROJECTS_KEY,projects);
    emitter.fire();
  }
  function assertTrusted() {
    if (workspace.isTrusted === false) throw new Error('BigQueryの参照には信頼済みワークスペースが必要です。');
  }
  async function cliJson(args) {
    assertTrusted();
    const result = await run('bq',args,{timeoutMs:60000,maxOutputBytes:OUTPUT_LIMIT});
    return result.stdout;
  }
  function cached(cache,key,loader) {
    if (!cache.has(key)) {
      const request = Promise.resolve().then(loader).catch(error => {cache.delete(key);throw error;});
      cache.set(key,request);
    }
    return cache.get(key);
  }
  async function availableDatasets(project) {
    const discovered = await cached(datasetCache,project,async () =>
      listDatasets(await cliJson([`--project_id=${checkProject(project)}`,'ls','--format=json','--max_results=1000'])));
    const existing = catalog.tables.filter(t => same(t.project,project)).map(t => t.dataset);
    return [...new Set([...discovered,...existing])].sort();
  }
  async function availableTables(project,dataset) {
    checkProject(project);checkId(dataset,'dataset');
    const discovered = await cached(tableListCache,`${project}/${dataset}`,async () =>
      listTables(await cliJson([`--project_id=${project}`,'ls','--format=json','--max_results=1000',`${project}:${dataset}`])));
    const existing = catalog.tables.filter(t => same(t.project,project) && same(t.dataset,dataset)).map(t => t.name);
    return [...new Set([...discovered,...existing])].sort();
  }
  function availableMetadata(project,dataset,name) {
    checkProject(project);checkId(dataset,'dataset');checkId(name,'table');
    return cached(metadataCache,metaKey(project,dataset,name),async () =>
      parseTable(await cliJson([`--project_id=${project}`,'show','--format=prettyjson',`${project}:${dataset}.${name}`]),
        {project,dataset,name}));
  }

  async function addProject() {
    assertTrusted();
    const settings = workspace.getConfiguration('bigquerySqlRunner');
    let suggested = String(settings.get('projectId','') || '').trim();
    if (!suggested) {
      try {suggested = (await run('gcloud',['config','get-value','project'],{timeoutMs:20000})).stdout.trim();}
      catch {suggested = '';}
      if (suggested === '(unset)') suggested = '';
    }
    const project = await window.showInputBox({title:'BigQuery: プロジェクトを追加',
      prompt:'追加するGoogle CloudプロジェクトID',value:suggested,
      validateInput:v => {try {checkProject(v);return null;}catch(e){return e.message;}}});
    if (project === undefined) return;
    checkProject(project);
    if (!projects.includes(project)) {
      projects = [...projects,project].sort();
      await persistProjects();
    }
    if (view && typeof view.reveal === 'function') {
      try {await view.reveal(projectNode(project),{expand:true,focus:false,select:false});} catch { /* Users can expand manually. */ }
    }
  }

  async function changeCheckboxes(event) {
    for (const [entry,check] of event.items) {
      if (entry.kind !== 'table' && entry.kind !== 'column') continue;
      const {project,dataset,name} = entry;
      const wanted = check === state.Checked;
      const current = tableEntry(project,dataset,name);
      if (entry.kind === 'table') {
        if (wanted && !current) {
          const meta = await availableMetadata(project,dataset,name);
          catalog = upsertTable(catalog,{...meta,columns:[]});
          await persistCatalog();
        } else if (!wanted && current) {
          if (current.columns.length) {
            const answer = await window.showWarningMessage(
              `${name} の登録を解除すると、登録済みの ${current.columns.length} カラムも解除します。`,
              {modal:true},'解除');
            if (answer !== '解除') {emitter.fire();continue;}
          }
          catalog.tables = catalog.tables.filter(t => !same(tableKey(t),keyFor(project,dataset,name)));
          await persistCatalog();
        }
      } else {
        if (wanted) {
          const meta = await availableMetadata(project,dataset,name);
          const field = meta.columns.find(c => same(c.name,entry.columnName))
            || current?.columns.find(c => same(c.name,entry.columnName));
          if (!field) throw new Error(`カラム ${entry.columnName} が見つかりません。`);
          const existing = current || {...meta,columns:[]};
          const columns = existing.columns.some(c => same(c.name,entry.columnName))
            ? existing.columns : [...existing.columns,field];
          catalog = upsertTable(catalog,{...existing,columns});
          await persistCatalog();
        } else if (current) {
          catalog = upsertTable(catalog,{...current,columns:current.columns.filter(c => !same(c.name,entry.columnName))});
          await persistCatalog();
        }
      }
    }
  }
  async function editDescription(entry) {
    if (!entry || !['table','column'].includes(entry.kind)) return;
    const t = tableEntry(entry.project,entry.dataset,entry.name);
    const target = entry.kind === 'table' ? t : t?.columns.find(c => same(c.name,entry.columnName));
    if (!target) return;
    const input = await window.showInputBox({title:`${entry.label}: Descriptionを編集`,
      prompt:'登録情報の説明文（BigQueryの元データは変更しません）',value:target.description || '',
      validateInput:v => v.length > 2000 ? 'Description must be at most 2000 characters.' : null});
    if (input === undefined) return;
    target.description = input;
    await persistCatalog();
  }
  async function removeRegistration(entry) {
    if (!entry) return;
    if (entry.kind === 'project') {
      const answer = await window.showWarningMessage(`${entry.project} を一覧から削除しますか？登録済みテーブルも解除されます。`,
        {modal:true},'削除');
      if (answer !== '削除') return;
      projects = projects.filter(p => p !== entry.project);
      catalog.tables = catalog.tables.filter(t => t.project !== entry.project);
      datasetCache.delete(entry.project);
      for (const k of tableListCache.keys()) if (k.startsWith(entry.project+'/')) tableListCache.delete(k);
      for (const k of metadataCache.keys()) if (k.startsWith(entry.project.toLowerCase()+'.')) metadataCache.delete(k);
      await context.workspaceState.update(PROJECTS_KEY,projects);
      await persistCatalog();
    } else if (entry.kind === 'table' || entry.kind === 'column') {
      await changeCheckboxes({items:[[entry,state.Unchecked]]});
    }
  }
  async function refresh() {
    datasetCache.clear();tableListCache.clear();metadataCache.clear();
    emitter.fire();
  }
  async function exportCatalog() {
    const target = await window.showSaveDialog({title:'BigQuery登録情報をJSON/YAMLで保存',
      defaultUri:workspace.workspaceFolders?.[0]?.uri && Uri.joinPath(workspace.workspaceFolders[0].uri,'bigquery-catalog.json'),
      filters:{JSON:['json'],YAML:['yaml','yml']},saveLabel:'保存'});
    if (!target) return;
    const ext = path.extname(target.path).toLowerCase();
    if (!['.json','.yaml','.yml'].includes(ext)) throw new Error('.json、.yaml、.ymlを指定してください。');
    const data = ext === '.json' ? JSON.stringify(catalog,null,2)+'\n' : catalogToYaml(catalog);
    await workspace.fs.writeFile(target,Buffer.from(data,'utf8'));
    window.showInformationMessage('登録情報を保存しました。GitHubへの公開時はメタデータの機密性に注意してください。');
  }

  function showError(error) {
    window.showErrorMessage(`BigQuery Completion: ${error instanceof Error ? error.message : String(error)}`);
  }
  // This diagnostic distinguishes catalog/SQL-context issues from VSCode UI filtering.
  // It does not transmit SQL, read credentials, or invoke the Google Cloud CLI.
  async function diagnoseCompletion() {
    const editor = window.activeTextEditor;
    const language = editor?.document?.languageId || '(エディタなし)';
    const registeredTables = catalog.tables.length;
    const registeredColumns = catalog.tables.reduce((sum,table) => sum + table.columns.length,0);
    let candidates = [];
    let reason = '';
    if (!editor) {
      reason = 'SQLエディタを開いてください。';
    } else if (!['sql','googlesql'].includes(language)) {
      reason = `言語モード ${language} は対象外です。SQLまたはBigQuery GoogleSQLを選択してください。`;
    } else if (registeredTables === 0) {
      reason = '登録済みテーブルが0件です。BigQuery Completionでテーブルまたはカラムをチェックしてください。';
    } else {
      const source = editor.document.getText();
      candidates = getSuggestions(catalog,source,editor.document.offsetAt(editor.selection.active));
      if (candidates.length) {
        reason = '候補は生成されています。表示されなければCtrl+Spaceで補完を開き、VSCodeのeditor.quickSuggestions設定を確認してください。';
      } else {
        reason = 'このカーソル位置では候補がありません。FROM sなど登録済みテーブル名の先頭か、FROMで宣言した別名に続く「.」で試してください。';
      }
    }
    const names = candidates.slice(0,8).map(x => x.label).join(', ');
    // Invoke the real VSCode completion pipeline, not just our local candidate generator.
    // It checks whether this provider's candidates arrive at the editor extension host.
    let hostStatus = 'VSCode候補検査=未実行';
    if (editor?.document?.uri && editor?.selection?.active && typeof commands.executeCommand === 'function') {
      try {
        const response = await commands.executeCommand('vscode.executeCompletionItemProvider',
          editor.document.uri, editor.selection.active);
        const delivered = Array.isArray(response?.items) ? response.items : [];
        const runnerItems = delivered.filter(item =>
          typeof item.detail === 'string' && item.detail.startsWith('BigQuery Runner · '));
        hostStatus = `VSCode候補検査=受信${runnerItems.length}件（総数${delivered.length}件）`;
        if (candidates.length > 0 && runnerItems.length === 0) {
          reason += ' 候補生成は成功しましたが、VSCodeの補完処理に届いていません。Runnerの起動と拡張機能ホストのログを確認してください。';
        }
      } catch (error) {
        hostStatus = `VSCode候補検査=失敗（${error instanceof Error ? error.message : String(error)}）`;
      }
    }
    const summary = `BigQuery補完診断：言語=${language}、登録テーブル=${registeredTables}、登録カラム=${registeredColumns}、候補=${candidates.length}${names ? `（${names}）` : ''}、${hostStatus}。${reason}`;
    await window.showInformationMessage(summary);
    return {language,registeredTables,registeredColumns,candidates,reason,hostStatus};
  }
  function command(name,handler) {
    return commands.registerCommand(name,(...args) => Promise.resolve().then(() => handler(...args)).catch(showError));
  }
  // Manual checkbox handling prevents selecting a table from silently selecting every column.
  view = window.createTreeView(VIEW_ID,{treeDataProvider:provider,manageCheckboxStateManually:true,showCollapseAll:true});
  let checkboxQueue = Promise.resolve();
  const subscriptions = [
    view,
    view.onDidChangeCheckboxState(event => {
      checkboxQueue = checkboxQueue.then(() => changeCheckboxes(event)).catch(error => {
        showError(error);emitter.fire();
      });
    }),
    command('bigquerySqlRunner.catalog.addProject',addProject),
    command('bigquerySqlRunner.catalog.refresh',refresh),
    command('bigquerySqlRunner.catalog.editDescription',editDescription),
    command('bigquerySqlRunner.catalog.remove',removeRegistration),
    command('bigquerySqlRunner.catalog.export',exportCatalog),
    command('bigquerySqlRunner.catalog.diagnose',diagnoseCompletion),
    languages.registerCompletionItemProvider([{language:'googlesql'},{language:'sql'}],{
      provideCompletionItems(document,position) {
        const source = document.getText();
        const proposals = getSuggestions(catalog,source,document.offsetAt(position));
        const items = proposals.map(p => {
          const kind = p.kind === 'table' ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Field;
          const item = new vscode.CompletionItem(p.label,kind);
          item.insertText = p.insertText;
          item.detail = `BigQuery Runner · ${p.kind === 'table' ? 'Table' : 'Column'}: ${p.type}`;
          item.documentation = p.description || ''; // Treat remote metadata as plain text.
          item.range = new vscode.Range(new vscode.Position(position.line,position.character-p.replace),position);
          item.sortText = '0_'+p.label;
          return item;
        });
        // VSCode may call us after 'FROM ' (before any table was selected), or while
        // metadata registration changes. Never leave an empty/old result marked final:
        // request recomputation as the user continues typing the table/column name.
        return new vscode.CompletionList(items,true);
      }
    },'.',' '),
    emitter
  ];
  context.subscriptions.push(...subscriptions);
  return {getCatalog:() => catalog,getProjects:() => projects,provider,getView:() => view,whenIdle:() => checkboxQueue};
}

module.exports = {registerCatalog,STORE_KEY,PROJECTS_KEY};
