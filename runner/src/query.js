'use strict';
const DEFAULT_MAXIMUM_BYTES_BILLED='1000000000';
function getSqlFromEditor(editor){if(!editor||!editor.document||typeof editor.document.getText!=='function')throw new Error('A SQL editor must be active.');
 const sql=editor.selection&&!editor.selection.isEmpty?editor.document.getText(editor.selection):editor.document.getText();
 if(typeof sql!=='string'||!sql.trim())throw new Error('SQL is empty.');if(sql.length>2_000_000)throw new Error('SQL exceeds the 2,000,000-character safety limit.');return sql;}
function buildBqInvocation({sql,projectId,location='',dryRun=false,maxRows=100,maximumBytesBilled=DEFAULT_MAXIMUM_BYTES_BILLED}){
 if(typeof sql!=='string'||!sql.trim())throw new Error('SQL is empty.');if(sql.length>2_000_000)throw new Error('SQL exceeds the 2,000,000-character safety limit.');
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId))throw new Error('Invalid projectId (expected a Google Cloud project ID).');
 if(typeof location!=='string'||(location&&!/^[a-z][a-z0-9-]{0,32}$/i.test(location)))throw new Error('Invalid location.');
 if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>1000)throw new Error('maxRows must be an integer between 1 and 1000.');
 if(!/^[1-9][0-9]*$/.test(String(maximumBytesBilled)))throw new Error('maximumBytesBilled must be a positive integer.');
 const args=[`--project_id=${projectId}`];if(location)args.push(`--location=${location}`);args.push('--format=pretty','query','--use_legacy_sql=false');
 if(dryRun)args.push('--dry_run=true');args.push(`--max_rows=${maxRows}`);if(!dryRun)args.push(`--maximum_bytes_billed=${maximumBytesBilled}`);
 return {program:'bq',args,stdin:sql};}
module.exports={getSqlFromEditor,buildBqInvocation,DEFAULT_MAXIMUM_BYTES_BILLED};
