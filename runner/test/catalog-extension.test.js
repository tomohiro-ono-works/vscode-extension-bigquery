'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerCatalog,STORE_KEY,PROJECTS_KEY}=require('../src/catalog-extension');

const ref={projectId:'demo-project',datasetId:'mart',tableId:'sales'};
const metadata=JSON.stringify({tableReference:ref,description:'売上テーブル',schema:{fields:[
  {name:'customer_id',type:'STRING',description:'顧客ID'},
  {name:'amount',type:'NUMERIC',description:'売上金額'},
  {name:'hidden',type:'BOOL',description:'補完しないカラム'}
]}});
const secondRef={projectId:'demo-project',datasetId:'mart',tableId:'customers'};
const secondMetadata=JSON.stringify({tableReference:secondRef,description:'顧客テーブル',schema:{fields:[{name:'name',type:'STRING',description:'顧客名'}]}});

function harness(initial={},options={}) {
  const callbacks=new Map(),calls=[],writes=[],messages=[],boxChanges=[];
  const saved=new Map(Object.entries(initial));
  let checkboxHandler,provider,completion,view;
  class EventEmitter{event=()=>{};fire(){};dispose(){}}
  class TreeItem{constructor(label,s){this.label=label;this.collapsibleState=s;}}
  class ThemeIcon{constructor(id){this.id=id;}}
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Range{constructor(a,b){this.start=a;this.end=b;}}
  class CompletionItem{constructor(label,kind){this.label=label;this.kind=kind;}}
  class CompletionList{constructor(items=[],isIncomplete=false){this.items=items;this.isIncomplete=isIncomplete;}}
  const vscode={EventEmitter,TreeItem,ThemeIcon,Position,Range,CompletionItem,CompletionList,
    TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
    TreeItemCheckboxState:{Unchecked:0,Checked:1},
    CompletionItemKind:{Reference:1,Field:2},
    Uri:{joinPath:(base,leaf)=>({path:base.path+'/'+leaf})},
    workspace:{isTrusted:options.trusted??true,workspaceFolders:[{uri:{path:'/workspace'}}],
      getConfiguration:()=>({get:(key,fallback)=>key==='projectId'?'demo-project':fallback}),
      fs:{writeFile:async(uri,bytes)=>writes.push({uri,bytes})}},
    window:{createTreeView:(id,opts)=>{
      assert.equal(id,'bigquerySqlRunner.catalog');
      assert.equal(opts.manageCheckboxStateManually,true);
      provider=opts.treeDataProvider;
      view={dispose(){},onDidChangeCheckboxState(fn){checkboxHandler=fn;return {dispose(){}};},
        reveal:async(entry,opts)=>{boxChanges.push({entry,opts});}};
      return view;
    },
      showInputBox:async(opts)=> opts.title.includes('Description')?'変更した説明': 'demo-project',
      showQuickPick:async()=>{throw Error('Previous modal QuickPick flow must not be used.');},
      showSaveDialog:async()=>({path:'/workspace/catalog.yaml'}),
      showWarningMessage:async()=>Object.hasOwn(options,'confirm')?options.confirm:'解除',
      showInformationMessage:s=>messages.push(s),
      showErrorMessage:s=>messages.push('ERROR: '+s)
    },
    commands:{registerCommand:(name,fn)=>{callbacks.set(name,fn);return {dispose(){}};}},
    languages:{registerCompletionItemProvider:(_language,handler)=>{completion=handler;return {dispose(){}};}}
  };
  const context={workspaceState:{get:(key)=>saved.get(key),update:async(key,value)=>saved.set(key,structuredClone(value))},subscriptions:[]};
  const runCli=async(program,args)=>{
    calls.push({program,args});
    if(program==='gcloud')return {stdout:'demo-project\n'};
    if(args.includes('show'))return {stdout:args.some(x=>x.includes(':mart.customers'))?secondMetadata:metadata};
    if(args.includes('ls')&&args.some(x=>x.includes(':mart')))return {stdout:JSON.stringify([
      {tableReference:ref},{tableReference:secondRef}
    ])};
    if(args.includes('ls'))return {stdout:JSON.stringify([{datasetReference:{datasetId:'mart'}},{datasetReference:{datasetId:'archive'}}])};
    throw Error('Unexpected CLI command');
  };
  const api=registerCatalog(context,vscode,{runCli});
  return {api,vscode,provider,callbacks,calls,writes,messages,boxChanges,saved,get completion(){return completion;},
    async checkbox(entry,checked){checkboxHandler({items:[[entry,checked?1:0]]});await api.whenIdle();}
  };
}
async function navigate(h) {
  const projects=await h.provider.getChildren();
  const datasets=await h.provider.getChildren(projects[0]);
  const mart=datasets.find(d=>d.label==='mart');
  const tables=await h.provider.getChildren(mart);
  const sales=tables.find(t=>t.label==='sales');
  const columns=await h.provider.getChildren(sales);
  return {projects,datasets,mart,tables,sales,columns};
}

test('single Explorer hierarchy is project > dataset > table > column, with persistent project root',async()=>{
  const h=harness();
  assert.deepEqual(await h.provider.getChildren(),[]);
  assert.equal(h.callbacks.has('bigquerySqlRunner.catalog.import'),false);
  await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  const {projects,datasets,tables,columns}=await navigate(h);
  assert.equal(projects[0].kind,'project');
  assert.deepEqual(datasets.map(x=>x.label),['archive','mart']);
  assert.deepEqual(tables.map(x=>x.label),['customers','sales']);
  assert.deepEqual(columns.map(x=>x.label),['customer_id','amount','hidden']);
  assert.equal(h.provider.getTreeItem(projects[0]).id,'project:demo-project');
  assert.equal(h.provider.getTreeItem(columns[0]).checkboxState,0);
  assert.deepEqual(h.saved.get(PROJECTS_KEY),['demo-project']);
  assert.equal(h.boxChanges.length,1);
});

test('checkbox registration persists chosen tables and columns without auto-selecting all fields',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  const {sales,columns}=await navigate(h);
  await h.checkbox(sales,true);
  assert.equal(h.saved.get(STORE_KEY).tables.length,1);
  assert.deepEqual(h.saved.get(STORE_KEY).tables[0].columns,[]);
  assert.equal(h.provider.getTreeItem(sales).checkboxState,1);
  assert.equal(h.provider.getTreeItem(columns[0]).checkboxState,0);
  await h.checkbox(columns[0],true);
  assert.deepEqual(h.saved.get(STORE_KEY).tables[0].columns.map(c=>c.name),['customer_id']);
  assert.equal(h.saved.get(STORE_KEY).tables[0].description,'売上テーブル');
  assert.equal(h.provider.getTreeItem(columns[0]).tooltip,'顧客ID');
  const source='SELECT s.\nFROM `demo-project.mart.sales` AS s\nWHERE s.c';
  const completionResult=h.completion.provideCompletionItems({getText:()=>source,offsetAt:()=>source.length},new h.vscode.Position(2,9));
  const found=completionResult.items;
  assert.ok(completionResult instanceof h.vscode.CompletionList);
  assert.equal(completionResult.isIncomplete,true);
  assert.deepEqual(found.map(x=>x.label),['customer_id']);
  assert.equal(found[0].documentation,'顧客ID');
  assert.equal(h.writes.length,0);
  await h.checkbox(columns[0],false);
  assert.equal(h.saved.get(STORE_KEY).tables[0].columns.length,0);
  assert.equal(h.saved.get(STORE_KEY).tables.length,1);
});

test('column selection also registers parent table and does not register siblings',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  const {columns}=await navigate(h);
  await h.checkbox(columns[1],true);
  const result=h.saved.get(STORE_KEY).tables;
  assert.equal(result.length,1);
  assert.deepEqual(result[0].columns.map(c=>c.name),['amount']);
});

test('registered state survives extension reload and v0.2.0 table registrations migrate into project root',async()=>{
  const legacy={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',
    description:'ユーザー変更済',columns:[{name:'customer_id',type:'STRING',description:'修正説明'}]}]};
  const h=harness({[STORE_KEY]:legacy});
  const {projects,columns,sales}=await navigate(h);
  assert.equal(projects.length,1);
  assert.equal(h.provider.getTreeItem(sales).checkboxState,1);
  assert.equal(h.provider.getTreeItem(columns[0]).checkboxState,1);
  assert.equal(h.provider.getTreeItem(columns[0]).tooltip,'修正説明');
  assert.deepEqual(h.api.getProjects(),['demo-project']);
});

test('table unchecked with registered columns needs confirmation and cancellation keeps registration',async()=>{
  const pre={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',description:'',columns:[{name:'amount',type:'NUMERIC',description:'売上金額'}]}]};
  const h=harness({[STORE_KEY]:pre},{confirm:undefined});
  const {sales}=await navigate(h);
  await h.checkbox(sales,false);
  assert.equal(h.api.getCatalog().tables.length,1); // Confirmation response was undefined; not "解除".
  assert.equal(h.provider.getTreeItem(sales).checkboxState,1);
});

test('cache prevents repeated API calls on expand and refresh reloads lists without losing selection',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  await navigate(h);await navigate(h);
  assert.equal(h.calls.filter(c=>c.program==='bq').length,3);
  await h.callbacks.get('bigquerySqlRunner.catalog.refresh')();
  await navigate(h);
  assert.equal(h.calls.filter(c=>c.program==='bq').length,6);
});

test('description editing and JSON/YAML export remain available',async()=>{
  const h=harness();await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  const {sales,columns}=await navigate(h);
  await h.checkbox(columns[0],true);
  await h.callbacks.get('bigquerySqlRunner.catalog.editDescription')(sales);
  assert.equal(h.api.getCatalog().tables[0].description,'変更した説明');
  await h.callbacks.get('bigquerySqlRunner.catalog.export')();
  assert.equal(h.writes.length,1);
  assert.match(h.writes[0].bytes.toString('utf8'),/description: "変更した説明"/);
});

test('project removal clears its registrations, but other projects remain',async()=>{
  const initial={version:1,tables:[
    {project:'demo-project',dataset:'mart',name:'sales',columns:[]},
    {project:'other-project',dataset:'mart',name:'customers',columns:[]}
  ]};
  const h=harness({[STORE_KEY]:initial},{confirm:'削除'});
  const projects=await h.provider.getChildren();
  await h.callbacks.get('bigquerySqlRunner.catalog.remove')(projects.find(p=>p.project==='demo-project'));
  assert.deepEqual(h.api.getProjects(),['other-project']);
  assert.deepEqual(h.api.getCatalog().tables.map(t=>t.project),['other-project']);
});

test('untrusted workspace does not call bq to fetch metadata and can still see saved registrations',async()=>{
  const legacy={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',columns:[{name:'customer_id'}]}]};
  const h=harness({[STORE_KEY]:legacy},{trusted:false});
  const {projects,datasets,tables,columns}=await navigate(h);
  assert.equal(projects.length,1);
  assert.deepEqual(datasets.map(d=>d.label),['mart']);
  assert.deepEqual(tables.map(t=>t.label),['sales']);
  assert.deepEqual(columns.map(c=>c.label),['customer_id']);
  assert.equal(h.calls.length,0);
  assert.ok(h.messages.some(x=>x.includes('信頼済み')));
});

test('diagnostic distinguishes missing registrations and generated suggestions',async()=>{
  const h=harness();
  const sql='SELECT * FROM s';
  h.vscode.window.activeTextEditor={
    document:{languageId:'googlesql',getText:()=>sql,offsetAt:()=>sql.length},
    selection:{active:new h.vscode.Position(0,sql.length)}
  };
  await h.callbacks.get('bigquerySqlRunner.catalog.diagnose')();
  assert.match(h.messages.at(-1),/登録テーブル=0/);
  assert.match(h.messages.at(-1),/登録済みテーブルが0件/);
  await h.callbacks.get('bigquerySqlRunner.catalog.addProject')();
  const {sales}=await navigate(h);
  await h.checkbox(sales,true);
  await h.callbacks.get('bigquerySqlRunner.catalog.diagnose')();
  assert.match(h.messages.at(-1),/候補=1/);
  assert.match(h.messages.at(-1),/sales/);
  assert.match(h.messages.at(-1),/Ctrl\+Space/);
  assert.equal(h.calls.some(c=>c.program==='bq'&&c.args.includes('query')),false);
});

test('host-facing diagnostic receives actual VSCode CompletionList with registered table label',async()=>{
  const savedCatalog={version:1,tables:[{project:'demo-project',dataset:'mart',name:'sales',description:'売上',columns:[]}]};
  const h=harness({[STORE_KEY]:savedCatalog});
  const sql='SELECT * FROM s';
  const position=new h.vscode.Position(0,sql.length);
  const document={uri:{scheme:'file',path:'/workspace/query.sql'},languageId:'googlesql',
    getText:()=>sql,offsetAt:()=>sql.length};
  h.vscode.window.activeTextEditor={document,selection:{active:position}};
  h.vscode.commands.executeCommand=async(command,uri,pos)=>{
    assert.equal(command,'vscode.executeCompletionItemProvider');
    assert.equal(uri,document.uri);
    assert.equal(pos,position);
    const result=h.completion.provideCompletionItems(document,position);
    // Mimic the real extension-host contract: a plain {items,isIncomplete}
    // return value is not accepted in place of a VSCode CompletionList instance.
    assert.ok(result instanceof h.vscode.CompletionList);
    return result;
  };
  await h.callbacks.get('bigquerySqlRunner.catalog.diagnose')();
  assert.match(h.messages.at(-1),/候補=1/);
  assert.match(h.messages.at(-1),/VSCode候補検査=受信1件/);
  assert.match(h.messages.at(-1),/sales/);
});
