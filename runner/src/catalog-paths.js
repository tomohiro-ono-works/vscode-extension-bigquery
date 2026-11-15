'use strict';

// All entries are obtained from the local opt-in catalog or previously
// explicitly requested dataset search. Never perform BigQuery I/O on typing.
function getPathSuggestions(catalog,context,{projects=[],datasetSearches=new Map()}={}) {
  const tables=Array.isArray(catalog?.tables)?catalog.tables:[];
  const path=context.path||'';
  const pieces=path.split('.');
  if(pieces.length>3) return [];
  const quoted=context.kind==='quoted-relation';
  const prefix=quoted?'':'`';
  const quoteSuffix=!quoted || context.nextChar!=='`'?'`':'';
  const followedByDot=context.nextChar==='.';
  const isCreate=!!context.createKind;
  const tableTarget=!isCreate || ['TABLE','VIEW'].includes(context.createKind);
  const match=(word,part)=>word.toLowerCase().startsWith(part.toLowerCase());
  const compare=(a,b)=>a.localeCompare(b,'en');
  const unique=items=>[...new Set(items.filter(Boolean))].sort(compare);
  const result=[];
  const complete=(label,kind,insertText,detail,filterText,priority=1)=>{
    const replace=quoted?(pieces.at(-1)||'').length:path.length;
    const part=quoted?insertText.slice(path.length-(pieces.at(-1)||'').length):insertText;
    result.push({label,kind,insertText:prefix+part,replace,description:'',
      type:detail,filterText:quoted && context.typed ? context.typed : filterText,priority});
  };
  if(pieces.length===1) {
    const typed=pieces[0];
    const availableProjects=unique([...projects,...tables.map(t=>t.project)]);
    for(const project of availableProjects.filter(p=>match(p,typed))) {
      complete(project,'project',project+(followedByDot?'':'.'),'Project',project,0);
    }
    // A single choice can insert the whole table after the opening backtick.
    for(const table of tables.filter(t=>tableTarget && !followedByDot && (match(t.project,typed) || match(t.name,typed)))) {
      const full=`${table.project}.${table.dataset}.${table.name}`;
      complete(`${table.name} · ${full}`,'table',full+quoteSuffix,full,
        `${table.project}.${table.dataset}.${table.name}`,1);
    }
  } else if(pieces.length===2) {
    const [project,typed]=pieces;
    const exact=t=>t.project.toLowerCase()===project.toLowerCase();
    const saved=datasetSearches instanceof Map?datasetSearches.get(project)?.names||[]:[];
    const datasets=unique([...saved,...tables.filter(exact).map(t=>t.dataset)]);
    for(const dataset of datasets.filter(n=>match(n,typed))) {
      complete(dataset,'dataset',`${project}.${dataset}${followedByDot?'':'.'}`,'Dataset',`${project}.${dataset}`,0);
    }
    for(const table of tables.filter(t=>tableTarget && !followedByDot && exact(t) && match(t.dataset,typed))) {
      const full=`${table.project}.${table.dataset}.${table.name}`;
      complete(`${table.dataset}.${table.name}`,'table',full+quoteSuffix,full,full,1);
    }
  } else if(pieces.length===3) {
    const [project,dataset,typed]=pieces;
    for(const table of tables.filter(t=>tableTarget && t.project.toLowerCase()===project.toLowerCase()
      && t.dataset.toLowerCase()===dataset.toLowerCase() && match(t.name,typed))) {
      const full=`${table.project}.${table.dataset}.${table.name}`;
      complete(table.name,'table',full+quoteSuffix,full,table.name,0);
    }
  }
  return result.sort((a,b)=>a.priority-b.priority||compare(a.label,b.label)).slice(0,200);
}
module.exports={getPathSuggestions};
