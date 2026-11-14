'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerCatalog,STORE_KEY,PROJECTS_KEY,panelHtml}=require('../src/catalog-extension');

const SALES={projectId:'demo-project',datasetId:'mart',tableId:'sales'};
const CLIENTS={projectId:'demo-project',datasetId:'mart',tableId:'clients'};
const schema=ref=>JSON.stringify({tableReference:ref,description:'remote table',schema:{fields:[
  {name:'customer_id',type:'STRING',description:'Customer'},
  {name:'sales_amount',type:'NUMERIC',description:'Amount'},
  {name:'hidden',type:'STRING',description:'Hidden'}
]}});
function harness(initial={},options={}) {
  const saved=new Map(Object.entries(initial));
  const callbacks=new Map(),calls=[],messages=[],sent=[],writes=[];
  let webviewProvider,completion,webviewView;
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Range{constructor(a,b){this.start=a;this.end=b;}}
  class CompletionItem{constructor(label,kind){this.label=label;this.kind=kind;}}
  class CompletionList{constructor(items,isIncomplete){this.items=items;this.isIncomplete=isIncomplete;}}
  const vscode={Position,Range,CompletionItem,CompletionList,CompletionItemKind:{Reference:1,Field:2},
    Uri:{joinPath:(base,...segments)=>({path:base.path+'/'+segments.join('/')})},
    workspace:{isTrusted:options.trusted??true,workspaceFolders:[{uri:{path:'/workspace'}}],
      getConfiguration:()=>({get:(key,fallback)=>key==='projectId'?'demo-project':fallback}),
      fs:{writeFile:async(uri,data)=>writes.push({uri,data})}},
    window:{registerWebviewViewProvider:(id,p)=>{assert.equal(id,'bigquerySqlRunner.catalog');webviewProvider=p;return {dispose(){}};},
      showInputBox:async opts=>opts.title.includes('Description')?'changed description':'demo-project',
      showSaveDialog:async()=>({path:'/workspace/registered.yaml'}),
      showWarningMessage:async()=>options.confirm||'解除',
      showInformationMessage:msg=>messages.push(msg),
      showErrorMessage:msg=>messages.push('ERROR: '+msg)},
    commands:{registerCommand:(name,fn)=>{callbacks.set(name,fn);return {dispose(){}};}},
    languages:{registerCompletionItemProvider:(selector,provider)=>{completion=provider;return {dispose(){}};}}
  };
  const runCli=async(program,args,opts={})=>{
    calls.push({program,args,opts});
    if(program==='gcloud')return {stdout:'demo-project\n'};
    if(args.includes('show'))return {stdout:schema(args.join(' ').includes('.clients')?CLIENTS:SALES)};
    if(args.includes('ls'))return {stdout:JSON.stringify(['mart','market','marine','archive'].map(datasetId=>({datasetReference:{datasetId}})))};
    if(args.includes('query')) {
      const word=/STRPOS\(LOWER\(table_name\), '([^']+)'\)/.exec(opts.stdin)?.[1];
      if(!word)throw Error('Missing query predicate');
      return {stdout:JSON.stringify(['sales','customers','clients','salers'].filter(name=>name.includes(word)).map(table_name=>({table_name})))};
    }
    throw Error('Unexpected bq command');
  };
  const context={extensionUri:{path:'/extension'},subscriptions:[],workspaceState:{
    get:key=>saved.get(key),update:async(key,data)=>saved.set(key,structuredClone(data))}};
  const api=registerCatalog(context,vscode,{runCli});
  function open(){
    const webview={cspSource:'vscode-webview:',asWebviewUri:uri=>uri.path,postMessage:msg=>{sent.push(msg);return Promise.resolve(true);},
      onDidReceiveMessage:fn=>{webview.receive=fn;return {dispose(){}};}};
    webviewView={webview,onDidDispose:()=>({dispose(){}})};
    webviewProvider.resolveWebviewView(webviewView);
    return webview;
  }
  const send=async message=>{await api.receiveMessage(message);};
  const state=()=>api.snapshot();
  return {api,context,callbacks,calls,messages,sent,writes,saved,vscode,open,send,state,
    get completion(){return completion;},get webviewProvider(){return webviewProvider;}};
}

test('project expansion and dataset expansion never make BigQuery requests',async()=>{
  const h=harness();
  const webview=h.open();
  assert.match(webview.html,/Content-Security-Policy/);
  assert.match(webview.html,/media\/catalog.js/);
  assert.equal(h.calls.length,0);
  await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  assert.equal(h.calls.length,0);
  assert.deepEqual(h.state().projects.map(p=>p.name),['demo-project']);
  assert.deepEqual(h.state().projects[0].datasets,[]);
  assert.ok(h.saved.get(PROJECTS_KEY));
});

test('dataset search must be explicitly submitted and requires three characters',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  await assert.rejects(h.send({command:'searchDatasets',project:'demo-project',term:'ma'}),/3文字/);
  assert.equal(h.calls.length,0);
  await h.send({command:'searchDatasets',project:'demo-project',term:'mar'});
  assert.equal(h.calls.filter(x=>x.program==='bq').length,1);
  assert.deepEqual(h.state().projects[0].datasets.map(x=>x.name),['marine','market','mart']);
  assert.deepEqual(h.state().projects[0].search.names,['marine','market','mart']);
});

test('table search must be explicitly submitted and pushes filter down to BigQuery query stdin',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  await h.send({command:'searchDatasets',project:'demo-project',term:'mar'});
  const before=h.calls.length;
  await assert.rejects(h.send({command:'searchTables',project:'demo-project',dataset:'mart',term:'sa'}),/3文字/);
  assert.equal(h.calls.length,before);
  await h.send({command:'searchTables',project:'demo-project',dataset:'mart',term:'sal'});
  assert.equal(h.calls.length,before+1);
  const call=h.calls.at(-1);
  assert.equal(call.program,'bq');assert.ok(call.args.includes('query'));
  assert.ok(call.opts.stdin.includes('INFORMATION_SCHEMA.TABLES'));
  assert.ok(call.opts.stdin.includes("STRPOS(LOWER(table_name), 'sal')"));
  assert.ok(call.args.every(arg=>!arg.includes('sal')));
  assert.deepEqual(h.state().projects[0].datasets.find(d=>d.name==='mart').tables.map(t=>t.name),['salers','sales']);
});

test('explicit loadColumns fetches only chosen table and supports checked registration',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  await h.send({command:'searchDatasets',project:'demo-project',term:'mar'});
  await h.send({command:'searchTables',project:'demo-project',dataset:'mart',term:'sal'});
  assert.equal(h.calls.filter(c=>c.args.includes('show')).length,0);
  await h.send({command:'loadColumns',project:'demo-project',dataset:'mart',table:'sales'});
  assert.equal(h.calls.filter(c=>c.args.includes('show')).length,1);
  let table=h.state().projects[0].datasets.find(d=>d.name==='mart').tables.find(t=>t.name==='sales');
  assert.equal(table.loaded,true);assert.equal(table.columns.length,3);
  await h.send({command:'toggleTable',project:'demo-project',dataset:'mart',table:'sales',checked:true});
  assert.equal(h.api.getCatalog().tables[0].columns.length,0);
  await h.send({command:'toggleColumn',project:'demo-project',dataset:'mart',table:'sales',column:'customer_id',checked:true});
  table=h.state().projects[0].datasets.find(d=>d.name==='mart').tables.find(t=>t.name==='sales');
  assert.equal(table.columns.find(c=>c.name==='customer_id').registered,true);
  assert.equal(table.columns.find(c=>c.name==='hidden').registered,false);
  assert.equal(h.saved.get(STORE_KEY).tables[0].description,'remote table');
  const src='SELECT c\nFROM `demo-project.mart.sales`';
  const list=h.completion.provideCompletionItems({getText:()=>src,offsetAt:()=>8},new h.vscode.Position(0,8));
  assert.ok(list instanceof h.vscode.CompletionList);
  assert.ok(list.items.some(x=>x.label==='customer_id'));
});

test('existing registered tables and descriptions remain visible offline with no CLI calls',async()=>{
  const prior={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',description:'old desc',columns:[{name:'customer_id',description:'old field'}]}]};
  const h=harness({[STORE_KEY]:prior},{trusted:false});h.open();
  assert.deepEqual(h.state().projects[0].datasets.map(d=>d.name),['mart']);
  const t=h.state().projects[0].datasets[0].tables[0];
  assert.equal(t.registered,true);assert.equal(t.columns[0].description,'old field');
  assert.equal(h.calls.length,0);
  await assert.rejects(h.send({command:'searchDatasets',project:'demo-project',term:'mar'}),/信頼済み/);
  assert.equal(h.calls.length,0);
});

test('description edit persists and export remains explicit, refresh does not refetch',async()=>{
  const prior={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',description:'',columns:[]}]};
  const h=harness({[STORE_KEY]:prior});h.open();
  await h.send({command:'editDescription',project:'demo-project',dataset:'mart',table:'sales'});
  assert.equal(h.api.getCatalog().tables[0].description,'changed description');
  await h.callbacks.get('bigquerySqlRunner.catalog.export')();
  assert.equal(h.writes.length,1);
  assert.match(h.writes[0].data.toString('utf8'),/changed description/);
  await h.callbacks.get('bigquerySqlRunner.catalog.refresh')();
  assert.equal(h.calls.length,0);
  assert.equal(h.api.getCatalog().tables.length,1);
});

test('project deletion removes registrations after confirmation',async()=>{
  const prior={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[]}]};
  const h=harness({[STORE_KEY]:prior},{confirm:'削除'});
  await h.send({command:'removeProject',project:'demo-project'});
  assert.equal(h.state().projects.length,0);assert.equal(h.api.getCatalog().tables.length,0);
});

test('invalid UI message does not execute arbitrary CLI or shell strings',async()=>{
  const h=harness();
  await assert.rejects(h.send({command:'runCli',args:['rm','-rf']}),/未対応/);
  await assert.rejects(h.send({command:'searchDatasets',project:'demo-project',term:"a';DROP TABLE x;--"}),/検索語/);
  await assert.rejects(h.send({command:'searchTables',project:'demo-project',dataset:'mart',term:'s\nSELECT'}),/検索語/);
  assert.equal(h.calls.length,0);
});

test('diagnostic still checks registered candidates via the actual CompletionList',async()=>{
  const prior={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[]}]};
  const h=harness({[STORE_KEY]:prior});
  const sql='SELECT * FROM s';const position=new h.vscode.Position(0,sql.length);
  const document={languageId:'googlesql',uri:{path:'/workspace/a.sql'},getText:()=>sql,offsetAt:()=>sql.length};
  h.vscode.window.activeTextEditor={document,selection:{active:position}};
  h.vscode.commands.executeCommand=async()=>h.completion.provideCompletionItems(document,position);
  await h.callbacks.get('bigquerySqlRunner.catalog.diagnose')();
  assert.match(h.messages.at(-1),/VSCode候補検査=受信1件/);
});

test('inline project-add action is supported, and existing project remains a single registered node',async()=>{
  const h=harness();h.open();
  await h.send({command:'addProject'});
  await h.send({command:'addProject'});
  assert.deepEqual(h.state().projects.map(p=>p.name),['demo-project']);
  assert.equal(h.calls.length,0); // configured ID; no gcloud and no bq calls
  assert.deepEqual(h.saved.get(PROJECTS_KEY),['demo-project']);
});

test('project registration works offline in untrusted workspace without using the CLI',async()=>{
  const h=harness({}, {trusted:false});h.open();
  await h.send({command:'addProject'});
  assert.deepEqual(h.state().projects.map(p=>p.name),['demo-project']);
  assert.equal(h.calls.length,0);
});

test('inline refresh clears search results but not registered catalog or project',async()=>{
  const h=harness();h.open();
  await h.send({command:'addProject'});
  await h.send({command:'searchDatasets',project:'demo-project',term:'mar'});
  const calls=h.calls.length;
  await h.send({command:'refresh'});
  assert.equal(h.calls.length,calls);
  assert.deepEqual(h.state().projects[0].datasets,[]);
  assert.deepEqual(h.state().projects.map(p=>p.name),['demo-project']);
});
