'use strict';

const path = require('node:path');
const {
  checkProject,checkId,parseTable,normalizeCatalog,upsertTable,tableKey,
  catalogToYaml,getSuggestions
} = require('./catalog');
const {validateSearchWord,filterDatasets,makeTableSearch,parseTableSearch} = require('./catalog-search');
const {runCli} = require('./cli');

const STORE_KEY = 'bigquerySqlRunner.catalog.v1'; // Backward-compatible registration state.
const PROJECTS_KEY = 'bigquerySqlRunner.projects.v1';
const VIEW_ID = 'bigquerySqlRunner.catalog';
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const norm = s => String(s).toLowerCase();
const match = (a,b) => norm(a)===norm(b);
const datasetKey=(p,d)=>`${p}/${d}`.toLowerCase();
const metadataKey=(p,d,t)=>`${p}/${d}/${t}`.toLowerCase();

/** Escape only fixed HTML attributes. No remote table/column/description text is embedded in HTML. */
function panelHtml(webview,extensionUri,Uri) {
  const script=webview.asWebviewUri(Uri.joinPath(extensionUri,'media','catalog.js'));
  const css=webview.asWebviewUri(Uri.joinPath(extensionUri,'media','catalog.css'));
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${css}"></head><body><main id="tree" aria-label="BigQuery Completion"></main>
<script src="${script}" defer></script></body></html>`;
}

function registerCatalog(context,vscode,dependencies={}) {
  const run=dependencies.runCli||runCli;
  const {window,workspace,commands,languages,Uri}=vscode;
  let catalog=normalizeCatalog(context.workspaceState.get(STORE_KEY));
  const savedProjects=context.workspaceState.get(PROJECTS_KEY);
  let projects=[...new Set([
    ...(Array.isArray(savedProjects)?savedProjects:[]),
    ...catalog.tables.map(t=>t.project)
  ].filter(p=>{try{checkProject(p);return true;}catch{return false;}}))].sort();
  const datasetSearches=new Map(); // Updated ONLY by explicit Enter search.
  const tableSearches=new Map();   // Updated ONLY by explicit Enter search.
  const metadataCache=new Map();
  const columnsLoaded=new Map();
  let view=null;
  let opQueue=Promise.resolve();

  const registeredTable=(p,d,t)=>catalog.tables.find(x=>match(x.project,p)&&match(x.dataset,d)&&match(x.name,t));
  function unique(items){return [...new Set(items)].sort((a,b)=>a.localeCompare(b));}
  function snapshot() {
    return {type:'state',projects:projects.map(project=>{
      const existing=catalog.tables.filter(x=>match(x.project,project));
      const datasets=unique([
        ...existing.map(x=>x.dataset),...(datasetSearches.get(project)?.names||[])
      ]).map(dataset=>{
        const registered=existing.filter(x=>match(x.dataset,dataset));
        const tables=unique([
          ...registered.map(x=>x.name),...(tableSearches.get(datasetKey(project,dataset))?.names||[])
        ]).map(name=>{
          const saved=registeredTable(project,dataset,name);
          const meta=columnsLoaded.get(metadataKey(project,dataset,name));
          const available=meta?.columns||[];
          const fields=new Map(available.map(c=>[norm(c.name),c]));
          for(const c of saved?.columns||[])fields.set(norm(c.name),{...(fields.get(norm(c.name))||{}),...c});
          return {name,registered:Boolean(saved),description:saved?.description||meta?.description||'',
            registeredCount:saved?.columns.length||0,loaded:Boolean(meta),
            columns:[...fields.values()].map(c=>({name:c.name,type:c.type||'',description:c.description||'',
              registered:Boolean(saved?.columns.some(x=>match(x.name,c.name)))}))};
        });
        return {name:dataset,search:tableSearches.get(datasetKey(project,dataset))||null,tables};
      });
      return {name:project,search:datasetSearches.get(project)||null,datasets};
    })};
  }
  function emit(){if(view)view.webview.postMessage(snapshot());}
  async function persistCatalog(){catalog=normalizeCatalog(catalog);await context.workspaceState.update(STORE_KEY,catalog);emit();}
  async function persistProjects(){await context.workspaceState.update(PROJECTS_KEY,projects);emit();}
  function assertTrusted(){if(workspace.isTrusted===false)throw new Error('BigQueryの参照には信頼済みワークスペースが必要です。');}
  async function cliJson(args,options={}) {
    assertTrusted();
    const result=await run('bq',args,{timeoutMs:60000,maxOutputBytes:OUTPUT_LIMIT,...options});
    return result.stdout;
  }
  async function availableMetadata(project,dataset,name) {
    checkProject(project);checkId(dataset,'dataset');checkId(name,'table');
    const key=metadataKey(project,dataset,name);
    if(!metadataCache.has(key)) {
      const task=cliJson([`--project_id=${project}`,'show','--format=prettyjson',`${project}:${dataset}.${name}`])
        .then(raw=>parseTable(raw,{project,dataset,name})).then(meta=>{columnsLoaded.set(key,meta);return meta;})
        .catch(error=>{metadataCache.delete(key);throw error;});
      metadataCache.set(key,task);
    }
    return metadataCache.get(key);
  }
  async function addProject(){
    const settings=workspace.getConfiguration('bigquerySqlRunner');
    let suggested=String(settings.get('projectId','')||'').trim();
    if(!suggested && workspace.isTrusted !== false) {
      try {suggested=(await run('gcloud',['config','get-value','project'],{timeoutMs:20000})).stdout.trim();}
      catch {suggested='';}
      if(suggested==='(unset)')suggested='';
    }
    const project=await window.showInputBox({title:'BigQuery: プロジェクトを追加',
      prompt:'追加するGoogle CloudプロジェクトID',value:suggested,
      validateInput:v=>{try{checkProject(v);return null;}catch(e){return e.message;}}});
    if(project===undefined)return;
    checkProject(project);
    if(!projects.includes(project)) {projects=unique([...projects,project]);await persistProjects();}
    else emit();
  }
  async function searchDatasets(project,term){
    checkProject(project);const word=validateSearchWord(term);
    const raw=await cliJson([`--project_id=${project}`,'ls','--format=json','--max_results=1000']);
    const result=filterDatasets(raw,word);
    datasetSearches.set(project,{word,names:result.names,truncated:result.truncated});
    emit();
  }
  async function searchTables(project,dataset,term){
    checkProject(project);checkId(dataset,'dataset');const word=validateSearchWord(term);
    const cfg=workspace.getConfiguration('bigquerySqlRunner');
    const invocation=makeTableSearch({project,dataset,term:word,location:cfg.get('location','')});
    const raw=await cliJson(invocation.args,{stdin:invocation.stdin});
    tableSearches.set(datasetKey(project,dataset),{word,names:parseTableSearch(raw,word),truncated:false});
    emit();
  }
  async function toggleTable(project,dataset,name,checked) {
    checkProject(project);checkId(dataset,'dataset');checkId(name,'table');
    const original=registeredTable(project,dataset,name);
    if(checked) {
      if(original)return;
      const meta=await availableMetadata(project,dataset,name);
      catalog=upsertTable(catalog,{...meta,columns:[]});
      await persistCatalog();
    } else if(original) {
      if(original.columns.length) {
        const answer=await window.showWarningMessage(`${name} の登録を解除すると、${original.columns.length}個のカラム登録も解除します。`,
          {modal:true},'解除');
        if(answer!=='解除'){emit();return;}
      }
      catalog.tables=catalog.tables.filter(x=>!match(tableKey(x),`${project}.${dataset}.${name}`));
      await persistCatalog();
    }
  }
  async function toggleColumn(project,dataset,name,columnName,checked) {
    checkProject(project);checkId(dataset,'dataset');checkId(name,'table');checkId(columnName,'column');
    const old=registeredTable(project,dataset,name);
    if(checked) {
      const meta=await availableMetadata(project,dataset,name);
      const field=meta.columns.find(c=>match(c.name,columnName))||old?.columns.find(c=>match(c.name,columnName));
      if(!field)throw new Error(`カラム ${columnName} が見つかりません。`);
      const table=old||{...meta,columns:[]};
      const columns=table.columns.some(c=>match(c.name,columnName))?table.columns:[...table.columns,field];
      catalog=upsertTable(catalog,{...table,columns});
      await persistCatalog();
    } else if(old) {
      catalog=upsertTable(catalog,{...old,columns:old.columns.filter(c=>!match(c.name,columnName))});
      await persistCatalog();
    }
  }
  async function editDescription(project,dataset,name,columnName){
    const table=registeredTable(project,dataset,name);
    const target=columnName?table?.columns.find(c=>match(c.name,columnName)):table;
    if(!target)return;
    const value=await window.showInputBox({title:`${columnName||name}: Descriptionを編集`,
      prompt:'BigQueryの元データは変更しません',value:target.description||'',
      validateInput:v=>v.length>2000?'Description must be at most 2000 characters.':null});
    if(value===undefined)return;
    target.description=value;await persistCatalog();
  }
  async function removeProject(project){
    const answer=await window.showWarningMessage(`${project} を一覧から削除しますか？登録済みテーブルも解除されます。`,
      {modal:true},'削除');
    if(answer!=='削除')return;
    projects=projects.filter(p=>p!==project);
    catalog.tables=catalog.tables.filter(t=>t.project!==project);
    datasetSearches.delete(project);
    for(const k of tableSearches.keys())if(k.startsWith(norm(project)+'/'))tableSearches.delete(k);
    for(const k of metadataCache.keys())if(k.startsWith(norm(project)+'/'))metadataCache.delete(k);
    for(const k of columnsLoaded.keys())if(k.startsWith(norm(project)+'/'))columnsLoaded.delete(k);
    await context.workspaceState.update(PROJECTS_KEY,projects);
    await persistCatalog();
  }
  async function refresh(){datasetSearches.clear();tableSearches.clear();metadataCache.clear();columnsLoaded.clear();emit();}
  async function exportCatalog(){
    const target=await window.showSaveDialog({title:'BigQuery登録情報をJSON/YAMLで保存',
      defaultUri:workspace.workspaceFolders?.[0]?.uri&&Uri.joinPath(workspace.workspaceFolders[0].uri,'bigquery-catalog.json'),
      filters:{JSON:['json'],YAML:['yaml','yml']},saveLabel:'保存'});
    if(!target)return;
    const ext=path.extname(target.path).toLowerCase();
    if(!['.json','.yaml','.yml'].includes(ext))throw new Error('.json、.yaml、.ymlを指定してください。');
    const value=ext==='.json'?JSON.stringify(catalog,null,2)+'\n':catalogToYaml(catalog);
    await workspace.fs.writeFile(target,Buffer.from(value,'utf8'));
    window.showInformationMessage('登録情報を保存しました。GitHubへの公開時はメタデータの機密性に注意してください。');
  }
  async function diagnoseCompletion() {
    const editor=window.activeTextEditor;
    const language=editor?.document?.languageId||'(エディタなし)';
    const registeredTables=catalog.tables.length;
    const registeredColumns=catalog.tables.reduce((sum,t)=>sum+t.columns.length,0);
    let candidates=[];let reason='';
    if(!editor)reason='SQLエディタを開いてください。';
    else if(!['sql','googlesql'].includes(language))reason=`言語モード ${language} は対象外です。`;
    else if(!registeredTables)reason='登録済みテーブルが0件です。BigQuery Completionでテーブルまたはカラムをチェックしてください。';
    else {
      const source=editor.document.getText();
      candidates=getSuggestions(catalog,source,editor.document.offsetAt(editor.selection.active),{projects,datasetSearches});
      reason=candidates.length?'候補は生成されています。表示されなければCtrl+Spaceで補完を開いてください。':'このカーソル位置では候補がありません。';
    }
    let hostStatus='VSCode候補検査=未実行';
    if(editor?.document?.uri&&editor?.selection?.active&&typeof commands.executeCommand==='function') {
      try {
        const response=await commands.executeCommand('vscode.executeCompletionItemProvider',editor.document.uri,editor.selection.active);
        const delivered=Array.isArray(response?.items)?response.items:[];
        const runnerItems=delivered.filter(item=>typeof item.detail==='string'&&item.detail.startsWith('BigQuery Runner · '));
        hostStatus=`VSCode候補検査=受信${runnerItems.length}件（総数${delivered.length}件）`;
      }catch(error){hostStatus=`VSCode候補検査=失敗（${error.message}）`;}
    }
    const names=candidates.slice(0,8).map(x=>x.label).join(', ');
    const summary=`BigQuery補完診断：言語=${language}、登録テーブル=${registeredTables}、登録カラム=${registeredColumns}、候補=${candidates.length}${names?`（${names}）`:''}、${hostStatus}。${reason}`;
    await window.showInformationMessage(summary);
    return {language,registeredTables,registeredColumns,candidates,reason,hostStatus};
  }
  function showError(error){window.showErrorMessage(`BigQuery Completion: ${error instanceof Error?error.message:String(error)}`);}
  function safeCommand(name,handler){return commands.registerCommand(name,(...args)=>Promise.resolve().then(()=>handler(...args)).catch(showError));}
  async function receiveMessage(message){
    if(!message||typeof message!=='object')return;
    const {command:action,project,dataset,table,column,term,checked}=message;
    if(action==='ready'){emit();return;}
    // Never accept arbitrary commands, CLI paths, paths on disk, or shell arguments from the webview.
    switch(action) {
      case 'addProject':await addProject();break;
      case 'refresh':await refresh();break;
      case 'searchDatasets':await searchDatasets(project,term);break;
      case 'searchTables':await searchTables(project,dataset,term);break;
      case 'loadColumns':await availableMetadata(project,dataset,table);emit();break;
      case 'toggleTable':await toggleTable(project,dataset,table,checked===true);break;
      case 'toggleColumn':await toggleColumn(project,dataset,table,column,checked===true);break;
      case 'editDescription':await editDescription(project,dataset,table,column);break;
      case 'removeProject':await removeProject(project);break;
      default:throw new Error('未対応の操作です。');
    }
  }
  const provider={resolveWebviewView(webviewView){
    view=webviewView;
    const webview=view.webview;
    webview.options={enableScripts:true,localResourceRoots:[Uri.joinPath(context.extensionUri,'media')]};
    webview.html=panelHtml(webview,context.extensionUri,Uri);
    webview.onDidReceiveMessage(message=>{
      opQueue=opQueue.then(()=>receiveMessage(message)).catch(error=>{
        showError(error);if(view)view.webview.postMessage({type:'error',message:error.message||String(error)});
      });
    });
    if(typeof view.onDidDispose==='function')view.onDidDispose(()=>{if(view===webviewView)view=null;});
    emit();
  }};
  const subscriptions=[
    window.registerWebviewViewProvider(VIEW_ID,provider),
    safeCommand('bigquerySqlRunner.catalog.addProject',addProject),
    safeCommand('bigquerySqlRunner.catalog.refresh',refresh),
    safeCommand('bigquerySqlRunner.catalog.export',exportCatalog),
    safeCommand('bigquerySqlRunner.catalog.diagnose',diagnoseCompletion),
    languages.registerCompletionItemProvider([{language:'googlesql'},{language:'sql'}],{
      provideCompletionItems(document,position){
        const source=document.getText();
        const proposals=getSuggestions(catalog,source,document.offsetAt(position),{projects,datasetSearches});
        const items=proposals.map(p=>{
          const kind=p.kind==='snippet'?vscode.CompletionItemKind.Snippet
            :p.kind==='project'?vscode.CompletionItemKind.Module
            :p.kind==='dataset'?vscode.CompletionItemKind.Folder
            :p.kind==='table'||p.kind==='cte'?vscode.CompletionItemKind.Reference:vscode.CompletionItemKind.Field;
          const item=new vscode.CompletionItem(p.label,kind);
          item.insertText=p.kind==='snippet'?new vscode.SnippetString(p.insertText):p.insertText;
          if(p.filterText)item.filterText=p.filterText;
          item.detail=`BigQuery Runner · ${p.kind}: ${p.type}`;
          item.documentation=p.description||'';
          item.range=new vscode.Range(new vscode.Position(position.line,position.character-p.replace),position);
          item.sortText=p.kind==='snippet'?'!0_'+p.label:`0_${p.priority||0}_`+p.label;
          if(p.kind==='snippet')item.preselect=true;
          return item;
        });
        return new vscode.CompletionList(items,true);
      }
    },'.',' ','`')
  ];
  context.subscriptions.push(...subscriptions);
  return {getCatalog:()=>catalog,getProjects:()=>projects,provider,whenIdle:()=>opQueue,
    snapshot,receiveMessage};
}
module.exports={registerCatalog,STORE_KEY,PROJECTS_KEY,panelHtml};
