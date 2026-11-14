'use strict';

const {checkProject,checkId,listDatasets} = require('./catalog');
const MIN_CHARS=3;
const MAX_SEARCH_RESULTS=200;

/** Names are ASCII identifiers in this extension; validate before building GoogleSQL. */
function validateSearchWord(value) {
  const term=String(value ?? '').trim();
  if (term.length<MIN_CHARS) throw new Error('検索語は3文字以上必要です。');
  if (term.length>80 || !/^[A-Za-z0-9_-]+$/.test(term)) {
    throw new Error('検索語は英数字・アンダースコア・ハイフンのみ、80文字以内で入力してください。');
  }
  return term;
}
function filterDatasets(raw,term) {
  const phrase=validateSearchWord(term).toLowerCase();
  const names=listDatasets(raw);
  return {names:names.filter(x=>x.toLowerCase().includes(phrase)).slice(0,MAX_SEARCH_RESULTS),
    truncated:names.length>=1000};
}
function makeTableSearch({project,dataset,term,location=''}) {
  checkProject(project);checkId(dataset,'dataset');
  const word=validateSearchWord(term).toLowerCase();
  if(location && !/^[a-z][a-z0-9-]{0,32}$/i.test(location)) throw new Error('Invalid BigQuery location.');
  const args=[`--project_id=${project}`];
  if(location)args.push(`--location=${location}`);
  args.push('--format=json','query','--use_legacy_sql=false',`--max_rows=${MAX_SEARCH_RESULTS}`);
  // Query text goes through stdin, never through cmd.exe arguments.
  // Whitelisted `word`, project and dataset exclude GoogleSQL or shell injection.
  const sql=`SELECT table_name FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`\n`+
    `WHERE STRPOS(LOWER(table_name), '${word}') > 0\nORDER BY table_name LIMIT ${MAX_SEARCH_RESULTS}`;
  return {args,stdin:sql};
}
function parseTableSearch(raw,term) {
  const phrase=validateSearchWord(term).toLowerCase();
  const data=JSON.parse(raw);
  if(!Array.isArray(data))throw new Error('Invalid table search response.');
  return [...new Set(data.map(x=>x?.table_name)
    .filter(x=>typeof x==='string' && x.toLowerCase().includes(phrase))
    .filter(x=>{try {checkId(x,'table');return true;}catch{return false;}}))].sort().slice(0,MAX_SEARCH_RESULTS);
}
module.exports={validateSearchWord,filterDatasets,makeTableSearch,parseTableSearch,MIN_CHARS,MAX_SEARCH_RESULTS};
