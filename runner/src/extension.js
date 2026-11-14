'use strict';
const {getSqlFromEditor,buildBqInvocation}=require('./query');
const {runCli}=require('./cli');
const {registerCatalog}=require('./catalog-extension');
function activate(context,vscodeApi=require('vscode'),dependencies={}){
 const cli=dependencies.runCli||runCli;
 const {window,workspace,commands}=vscodeApi;
 const output=window.createOutputChannel('BigQuery SQL Runner');
 async function resolveProjectId(configured){if(typeof configured==='string'&&configured.trim())return configured.trim();
 const result=await cli('gcloud',['config','get-value','project'],{timeoutMs:20000});const projectId=result.stdout.trim();
 if(!projectId||projectId==='(unset)')throw new Error('No Google Cloud project selected. Set bigquerySqlRunner.projectId or run gcloud config set project PROJECT_ID.');return projectId;}
 async function runQuery(dryRun){try{
 const editor=window.activeTextEditor;
 if(!editor||!editor.document||!['sql','googlesql'].includes(editor.document.languageId))throw new Error('Open a SQL or BigQuery GoogleSQL editor first.');
 const sql=getSqlFromEditor(editor);const settings=workspace.getConfiguration('bigquerySqlRunner');
 const projectId=await resolveProjectId(settings.get('projectId',''));
 const invocation=buildBqInvocation({sql,projectId,location:settings.get('location',''),maxRows:settings.get('maxRows',100),maximumBytesBilled:settings.get('maximumBytesBilled','1000000000'),dryRun});
 if(!dryRun){const approved=await window.showWarningMessage(`Execute BigQuery SQL in project "${projectId}"?`,{modal:true,detail:'The SQL may change or delete BigQuery data and can incur charges. Review the selected SQL and project first.'},'Execute');if(approved!=='Execute')return;}
 output.appendLine(`[${new Date().toISOString()}] ${dryRun?'Dry run':'Execute'}: project=${projectId}`);output.show(true);
 const result=await cli(invocation.program,invocation.args,{stdin:invocation.stdin,timeoutMs:dryRun?60000:300000,maxOutputBytes:1024*1024});
 const detail=[result.stdout,result.stderr].filter(Boolean).join('\n').trim();output.appendLine(detail||'Completed (no output).');
 await window.showInformationMessage(`BigQuery ${dryRun?'dry run':'execution'} completed.`);
 }catch(error){const detail=error instanceof Error?error.message:String(error);output.appendLine(`Error: ${detail}`);window.showErrorMessage(`BigQuery SQL Runner: ${detail}`);}}
 const subscriptions=[commands.registerCommand('bigquerySqlRunner.login',()=>{const terminal=window.createTerminal({name:'Google Cloud Login'});terminal.show();terminal.sendText('gcloud auth login');}),
 commands.registerCommand('bigquerySqlRunner.dryRun',()=>runQuery(true)),commands.registerCommand('bigquerySqlRunner.execute',()=>runQuery(false)),output];
 context.subscriptions.push(...subscriptions);
 // Register completion on every activation. A missing API or initialization error must
 // be visible instead of silently disabling all table/column suggestions.
 try {
   registerCatalog(context,vscodeApi,dependencies);
 } catch (error) {
   const message=error instanceof Error?error.message:String(error);
   output.appendLine(`BigQuery catalog initialization error: ${message}`);
   window.showErrorMessage(`BigQuery補完の初期化に失敗しました: ${message}`);
 }
}
function deactivate(){}
module.exports={activate,deactivate};
