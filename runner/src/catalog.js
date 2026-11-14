'use strict';

const PROJECT = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const ID = /^[A-Za-z_][A-Za-z0-9_-]{0,1023}$/;
const MAX_TABLES = 200;
const MAX_COLUMNS = 500;
const MAX_DESCRIPTION = 2000;

function cleanText(v) { return typeof v === 'string' ? v.slice(0, MAX_DESCRIPTION) : ''; }
function checkProject(value) {
  if (typeof value !== 'string' || !PROJECT.test(value)) throw new Error('Invalid Google Cloud project ID.');
  return value;
}
function checkId(value, kind) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Unsupported ${kind} identifier.`);
  return value;
}
function readArray(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error('Expected a list from BigQuery CLI.');
  return parsed;
}
function listDatasets(output) {
  return [...new Set(readArray(output).map(x=>x?.datasetReference?.datasetId)
    .filter(x=>typeof x==='string' && ID.test(x)))].sort();
}
function listTables(output) {
  return [...new Set(readArray(output).map(x=>x?.tableReference?.tableId)
    .filter(x=>typeof x==='string' && ID.test(x)))].sort();
}
function parseTable(output, {project,dataset,name}) {
  checkProject(project); checkId(dataset,'dataset'); checkId(name,'table');
  const info = JSON.parse(output);
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid BigQuery table metadata.');
  // Check the CLI response matches the requested resource: do not trust arbitrary metadata.
  const ref = info.tableReference || {};
  if (ref.projectId !== project || ref.datasetId !== dataset || ref.tableId !== name) {
    throw new Error('BigQuery metadata did not match the selected table.');
  }
  const fields = Array.isArray(info.schema?.fields) ? info.schema.fields : [];
  const seen = new Set();
  const columns = fields.filter(f=>f && typeof f.name === 'string' && ID.test(f.name))
    .filter(f=>!seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase()))
    .slice(0,MAX_COLUMNS)
    .map(f=>({name:f.name,type:cleanText(f.type).slice(0,64),description:cleanText(f.description)}));
  return {project,dataset,name,description:cleanText(info.description),columns};
}
function normalizeCatalog(input) {
  if (!input || !Array.isArray(input.tables)) return {version:1,tables:[]};
  const keys = new Set();
  const tables = [];
  for (const entry of input.tables.slice(0,MAX_TABLES)) {
    try {
      const project=checkProject(entry.project), dataset=checkId(entry.dataset,'dataset'),name=checkId(entry.name,'table');
      const key=`${project}.${dataset}.${name}`.toLowerCase();
      if (keys.has(key)) continue;
      keys.add(key);
      const names = new Set();
      const columns=[];
      for (const field of (Array.isArray(entry.columns)?entry.columns:[]).slice(0,MAX_COLUMNS)) {
        if (!field || typeof field.name !== 'string' || !ID.test(field.name)) continue;
        if (names.has(field.name.toLowerCase())) continue;
        names.add(field.name.toLowerCase());
        columns.push({name:field.name,type:cleanText(field.type).slice(0,64),description:cleanText(field.description)});
      }
      tables.push({project,dataset,name,description:cleanText(entry.description),columns});
    } catch (_) { /* Ignore corrupt persisted entries; do not interpret as executable data. */ }
  }
  return {version:1,tables};
}
function upsertTable(catalog,table) {
  const model=normalizeCatalog({tables:[table]});
  if (model.tables.length!==1) throw new Error('Invalid table registration.');
  const t=model.tables[0];
  const rest=normalizeCatalog(catalog).tables.filter(x=>![x.project,x.dataset,x.name]
    .every((value,i)=>value.toLowerCase()===[t.project,t.dataset,t.name][i].toLowerCase()));
  if (rest.length>=MAX_TABLES) throw new Error(`Catalog limit: ${MAX_TABLES} tables.`);
  return {version:1,tables:[...rest,t].sort((a,b)=>tableKey(a).localeCompare(tableKey(b)))};
}
function tableKey(t) { return `${t.project}.${t.dataset}.${t.name}`; }
function catalogToYaml(catalog) {
  const quote=x=>JSON.stringify(String(x));
  const rows=['version: 1','tables:'];
  for (const t of normalizeCatalog(catalog).tables) {
    rows.push(`  - project: ${quote(t.project)}`,`    dataset: ${quote(t.dataset)}`,`    name: ${quote(t.name)}`,`    description: ${quote(t.description)}`,`    columns:`);
    for (const c of t.columns) rows.push(`      - name: ${quote(c.name)}`,`        type: ${quote(c.type)}`,`        description: ${quote(c.description)}`);
    if (t.columns.length===0) rows[rows.length-1]='    columns: []';
  }
  if (normalizeCatalog(catalog).tables.length===0) rows[1]='tables: []';
  return rows.join('\n')+'\n';
}
const {sqlCompletionContext} = require('./sql-scope');
const {getPathSuggestions}=require('./catalog-paths');
const {getCreateSuggestions}=require('./syntax-templates');
function getSuggestions(catalog,source,position,options={}) {
  const tables=Array.isArray(catalog?.tables) ? catalog.tables : [];
  const syntax=getCreateSuggestions(source,position);
  if(syntax.length)return syntax;
  const context=sqlCompletionContext(source,position,tables);
  if(context?.kind==='quoted-relation' || context?.kind==='relation-path')return getPathSuggestions(catalog,context,options);
  if (!context) return [];
  if (context.kind==='table') {
    const physical=tables.filter(t=>t.name.toLowerCase().startsWith(context.typed.toLowerCase()))
      .map(t=>({label:t.name,kind:'table',insertText:'`'+tableKey(t)+'`',
        description:t.description,type:tableKey(t),replace:context.typed.length}));
    const ctes=(context.ctes || []).filter(t=>t.name.toLowerCase().startsWith(context.typed.toLowerCase()))
      .map(t=>({label:t.name,kind:'cte',insertText:t.name,description:'',type:'CTE',replace:context.typed.length}));
    return [...ctes,...physical];
  }
  if (context.kind==='unqualified-column') {
    const byName=new Map();
    for (const [alias,table] of context.sources) {
      for(const c of table.columns) {
        if(!c.name.toLowerCase().startsWith(context.typed.toLowerCase())) continue;
        const key=c.name.toLowerCase();
        if(!byName.has(key)) byName.set(key,[]);
        byName.get(key).push({alias,table,column:c});
      }
    }
    return [...byName.values()].flatMap(matches => {
      // Ambiguous unqualified columns would produce invalid SQL: suggest
      // explicit alias.column instead, once for each source.
      if(matches.length>1) return matches.map(({alias,column:c})=>({
        label:`${alias}.${c.name}`,kind:'column',insertText:`${alias}.${c.name}`,filterText:c.name,
        description:c.description,type:c.type,replace:context.typed.length
      }));
      const c=matches[0].column;
      return [{label:c.name,kind:'column',insertText:c.name,
        description:c.description,type:c.type,replace:context.typed.length}];
    }).slice(0,250);
  }
  if (!context.table) return [];
  return context.table.columns.filter(c=>c.name.toLowerCase().startsWith(context.typed.toLowerCase()))
    .map(c=>({label:c.name,kind:'column',insertText:c.name,
      description:c.description,type:c.type,replace:context.typed.length}));
}

module.exports={checkProject,checkId,listDatasets,listTables,parseTable,normalizeCatalog,upsertTable,tableKey,catalogToYaml,getSuggestions};
