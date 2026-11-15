'use strict';

// Offline structural SQL analysis for completion. No SQL is executed and no
// credentials, network calls, or third-party parsers are involved. It keeps
// SELECT/CTE scopes separate, including forward references to a later FROM.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELATION_START = new Set(['FROM','JOIN','UPDATE','INTO']);
// SQL CREATE snippets remain exclusively within the independent Language extension.
const REFERENCE_HEAD = String.raw`(?:FROM|JOIN|UPDATE|INTO)\s+`;
const CREATE_HEAD = String.raw`CREATE\s+(?:(?:OR\s+REPLACE|TEMP(?:ORARY)?)\s+)*(?:(?:EXTERNAL|MATERIALIZED)\s+)?(TABLE\s+FUNCTION|TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?`;
const QUOTED_PATH = new RegExp(String.raw`(?:^|[^A-Za-z0-9_])(?:${REFERENCE_HEAD}|${CREATE_HEAD})\x60([A-Za-z0-9_.-]*)'use strict';

// Offline structural SQL analysis for completion. No SQL is executed and no
// credentials, network calls, or third-party parsers are involved. It keeps
// SELECT/CTE scopes separate, including forward references to a later FROM.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
,'i');
const UNQUOTED_PATH = new RegExp(String.raw`(?:^|[^A-Za-z0-9_])(?:${REFERENCE_HEAD}|${CREATE_HEAD})([A-Za-z_][A-Za-z0-9_.-]*\.)([A-Za-z0-9_]*)'use strict';

// Offline structural SQL analysis for completion. No SQL is executed and no
// credentials, network calls, or third-party parsers are involved. It keeps
// SELECT/CTE scopes separate, including forward references to a later FROM.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
,'i');
const ALIAS_STOP = new Set([
  'ON','USING','WHERE','JOIN','INNER','LEFT','RIGHT','FULL','CROSS','OUTER','NATURAL',
  'GROUP','ORDER','HAVING','QUALIFY','LIMIT','UNION','INTERSECT','EXCEPT','WINDOW',
  'TABLESAMPLE','FOR','PIVOT','UNPIVOT','AS','WITH','OFFSET','SELECT','FROM','AND',
  'OR','WHEN','THEN','ELSE','END','SET','RETURNING','OPTIONS'
]);
const SEGMENT_BREAK = new Set(['UNION','INTERSECT','EXCEPT',';']);
const COLUMN_CLAUSES = new Set(['SELECT','WHERE','ON','HAVING','QUALIFY','GROUP BY','ORDER BY']);
const CLAUSE_WORDS = new Set(['SELECT','FROM','JOIN','WHERE','ON','HAVING','QUALIFY','GROUP','ORDER','LIMIT','WINDOW','INTO','UPDATE']);

function lexSql(source) {
  const text=String(source ?? '');
  const tokens=[];
  const frames=[{id:0,parent:null,from:0,to:text.length}];
  const stack=[0];
  const excluded=[];
  const push=(kind,value,start,end)=>tokens.push({kind,value,start,end,frame:stack.at(-1)});
  let i=0;
  while (i<text.length) {
    const start=i;
    if (/\s/.test(text[i])) {i++;continue;}
    if (text.startsWith('--',i) || text[i]==='#') {
      const end=text.indexOf('\n',i);
      i=end<0?text.length:end;
      excluded.push([start,i]);continue;
    }
    if (text.startsWith('/*',i)) {
      i+=2;let nesting=1;
      while (i<text.length && nesting>0) {
        if (text.startsWith('/*',i)) {nesting++;i+=2;}
        else if (text.startsWith('*/',i)) {nesting--;i+=2;}
        else i++;
      }
      excluded.push([start,i]);continue;
    }
    if (text[i]==='`') {
      i++;
      let value='';
      while(i<text.length) {
        if(text[i]==='\\' && i+1<text.length) {value+=text[i+1];i+=2;}
        else if(text[i]==='`') {i++;break;}
        else {value+=text[i];i++;}
      }
      push('identifier',value,start,i);
      excluded.push([start,i]); // Never complete inside a quoted identifier.
      continue;
    }
    let prefix=0;
    if (/[rRbB]/.test(text[i])) {
      if (/[rRbB]/.test(text[i+1]||'') && /['"]/.test(text[i+2]||'')) prefix=2;
      else if (/['"]/.test(text[i+1]||'')) prefix=1;
    }
    if (text[i]==="'" || text[i]==='"' || prefix) {
      const quote=text[i+prefix];
      if (quote==="'" || quote==='"') {
        const mark=text.slice(i+prefix,i+prefix+3)===quote.repeat(3)?quote.repeat(3):quote;
        i+=prefix+mark.length;
        while(i<text.length) {
          if (text[i]==='\\') i=Math.min(i+2,text.length);
          else if(text.startsWith(mark,i)) {i+=mark.length;break;}
          else i++;
        }
        excluded.push([start,i]);continue;
      }
    }
    if (/[A-Za-z_]/.test(text[i])) {
      i++;
      while(i<text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      push('word',text.slice(start,i),start,i);continue;
    }
    if (text[i]==='(') {
      push('punct','(',i,i+1);
      const id=frames.length;
      frames.push({id,parent:stack.at(-1),from:i+1,to:text.length});
      stack.push(id);i++;continue;
    }
    if (text[i]===')') {
      push('punct',')',i,i+1);
      if(stack.length>1) frames[stack.pop()].to=i;
      i++;continue;
    }
    if ('.;,*'.includes(text[i])) push('punct',text[i],i,i+1);
    i++;
  }
  return {tokens,frames,excluded};
}

function frameAt(frames,pos) {
  let best=frames[0];
  for(const f of frames) {
    if(f.from<=pos && pos<=f.to && f.from>=best.from) best=f;
  }
  return best.id;
}
function ancestorOf(frames,ancestor,child) {
  for(let id=child;id!==null;id=frames[id].parent) if(id===ancestor) return true;
  return false;
}
function activeQueryTokens(parsed,position) {
  let id=frameAt(parsed.frames,position);
  while(id!==null) {
    const frameTokens=parsed.tokens.filter(t=>t.frame===id);
    const before=frameTokens.filter(t=>t.start<position);
    const selects=before.filter(t=>t.kind==='word' && t.value.toUpperCase()==='SELECT');
    const lastSelect=selects.at(-1);
    if(lastSelect) {
      let start=lastSelect.start;
      const breaks=before.filter(t=>SEGMENT_BREAK.has(t.value.toUpperCase()));
      if (breaks.at(-1)?.start>start) start=breaks.at(-1).end;
      const nextBreak=frameTokens.find(t=>t.start>=start && t.start>=position
        && SEGMENT_BREAK.has(t.value.toUpperCase()));
      const end=nextBreak?.start ?? parsed.frames[id].to;
      return frameTokens.filter(t=>t.start>=start && t.start<end);
    }
    const relation=before.find(t=>RELATION_START.has(t.value.toUpperCase()));
    if(relation && id===0) return frameTokens;
    id=parsed.frames[id].parent;
  }
  return [];
}

function readRelation(tokens,offset) {
  const first=tokens[offset];
  if(!first || !['word','identifier'].includes(first.kind)) return null;
  let name=first.value;
  let j=offset+1;
  while(tokens[j]?.value==='.' && ['word','identifier'].includes(tokens[j+1]?.kind)) {
    name+='.'+tokens[j+1].value;
    j+=2;
  }
  let alias='';
  if(tokens[j]?.value.toUpperCase()==='AS') j++;
  if(tokens[j]?.kind==='word' && IDENT.test(tokens[j].value)
      && !ALIAS_STOP.has(tokens[j].value.toUpperCase())) {
    alias=tokens[j].value;j++;
  }
  return {name,alias,nextIndex:j};
}

// Parse WITH cte AS (...), cte2 AS (...) into explicit CTE definitions.
// Child body parentheses are tracked as frames, not text-search delimiters.
function collectCtes(parsed) {
  const children=new Map();
  for(const f of parsed.frames.slice(1)) children.set(`${f.parent}:${f.from-1}`,f.id);
  const result=[];
  for(const frame of parsed.frames) {
    const ts=parsed.tokens.filter(t=>t.frame===frame.id);
    for(let i=0;i<ts.length;i++) {
      if(ts[i].kind!=='word' || ts[i].value.toUpperCase()!=='WITH') continue;
      let j=i+1;
      const recursive=ts[j]?.value.toUpperCase()==='RECURSIVE';
      if(recursive) j++;
      let count=0;
      while(count++<100) {
        const n=ts[j];
        if(!n || !['word','identifier'].includes(n.kind) || !IDENT.test(n.value)) break;
        const name=n.value;
        j++;
        let declared=[];
        if(ts[j]?.value==='(') {
          const cols=children.get(`${frame.id}:${ts[j].start}`);
          if(cols!==undefined) {
            declared=parsed.tokens.filter(t=>t.frame===cols && t.kind==='word').map(t=>t.value);
          }
          j++;
        }
        if(ts[j]?.value.toUpperCase()!=='AS') break;
        j++;
        if(ts[j]?.value!=='(') break;
        const bodyFrame=children.get(`${frame.id}:${ts[j].start}`);
        if(bodyFrame===undefined) break;
        result.push({name,parentFrame:frame.id,bodyFrame,start:n.start,recursive,declared});
        j++;
        if(ts[j]?.value!==',') break;
        j++;
      }
    }
  }
  return result;
}

function visibleCtes(parsed,definitions,frameId,position) {
  const visible=new Map();
  const chain=[];
  for(let id=frameId;id!==null;id=parsed.frames[id].parent) chain.unshift(id);
  for(const scope of chain) {
    for(const def of definitions) {
      if(def.parentFrame!==scope || def.start>position) continue;
      const within=ancestorOf(parsed.frames,def.bodyFrame,frameId);
      if(within && !def.recursive) continue; // Non-recursive CTE cannot see itself.
      visible.set(def.name.toLowerCase(),def);
    }
  }
  return visible;
}
function resolveCatalogTable(name,tables) {
  const lower=name.toLowerCase();
  const matches=tables.filter(t=>
    `${t.project}.${t.dataset}.${t.name}`.toLowerCase()===lower ||
    `${t.dataset}.${t.name}`.toLowerCase()===lower ||
    t.name.toLowerCase()===lower);
  return matches.length===1 ? matches[0] : null;
}

function queryBindings(tokens,tables,ctes=new Map(),getCte=()=>null) {
  const aliases=new Map();
  for (let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if(token.kind!=='word' || !RELATION_START.has(token.value.toUpperCase())) continue;
    const ref=readRelation(tokens,i+1);
    if(!ref) continue;
    const lower=ref.name.toLowerCase();
    const cteDef=ctes.get(lower);
    const table=cteDef ? getCte(cteDef) : resolveCatalogTable(ref.name,tables);
    const alias=(ref.alias || ref.name.split('.').at(-1)).toLowerCase();
    aliases.set(alias,aliases.has(alias)?null:table);
    i=ref.nextIndex-1;
  }
  return aliases;
}
function relationBindings(tokens,tables) {return queryBindings(tokens,tables);}

function dedupeColumns(columns) {
  const seen=new Set();
  return columns.filter(c=>{
    const k=c.name.toLowerCase();
    if(!IDENT.test(c.name) || seen.has(k)) return false;
    seen.add(k);return true;
  }).slice(0,500);
}
function getProjection(parsed,def,tables,definitions,memo,computing) {
  const frame=parsed.frames[def.bodyFrame];
  const tokens=parsed.tokens.filter(t=>t.frame===def.bodyFrame);
  const select=tokens.findIndex(t=>t.value.toUpperCase()==='SELECT');
  if(select<0) return [];
  const from=tokens.findIndex((t,i)=>i>select && t.value.toUpperCase()==='FROM');
  const stop=from<0 ? tokens.findIndex((t,i)=>i>select && ['WHERE','UNION','INTERSECT','EXCEPT',';'].includes(t.value.toUpperCase())) : from;
  const end=stop<0 ? tokens.length : stop;
  const portions=[];
  let current=[];
  for(const token of tokens.slice(select+1,end)) {
    if(token.value===',') {if(current.length) portions.push(current);current=[];}
    else current.push(token);
  }
  if(current.length) portions.push(current);
  const vis=visibleCtes(parsed,definitions,def.bodyFrame,frame.to);
  const b=queryBindings(activeQueryTokens(parsed,frame.to),tables,vis,other=>getCteModel(parsed,other,tables,definitions,memo,computing));
  const columns=[];
  for(const part of portions) {
    const as=part.findIndex(t=>t.value.toUpperCase()==='AS');
    const explicit=as>=0 ? part[as+1]?.value : null;
    const first=part[0];
    const last=part.at(-1);
    // SELECT *, alias.* - expand only registered or inferred source columns.
    if(first?.value==='*' && part.length===1) {
      for(const table of b.values()) if(table) columns.push(...table.columns);
      continue;
    }
    if(part.length===3 && part[1].value==='.' && part[2].value==='*') {
      const table=b.get(first.value.toLowerCase());
      if(table) columns.push(...table.columns);
      continue;
    }
    const sourceName=part.length===3 && part[1].value==='.' ? part[2].value
      : part.length===1 && first.kind==='word' ? first.value : null;
    const sources=sourceName ? [...b.values()].filter(x=>x?.columns.some(c=>c.name.toLowerCase()===sourceName.toLowerCase())) : [];
    const srcField=sources.length===1 ? sources[0].columns.find(c=>c.name.toLowerCase()===sourceName.toLowerCase()) : null;
    const name=explicit || sourceName;
    if(name && IDENT.test(name)) columns.push({name,type:srcField?.type || '',description:srcField?.description || ''});
    // Expression without an AS alias is intentionally not guessed.
    void last;
  }
  if(def.declared.length) {
    const inferred=dedupeColumns(columns);
    return dedupeColumns(def.declared.map((name,i)=>({name,type:inferred[i]?.type || '',description:inferred[i]?.description || ''})));
  }
  return dedupeColumns(columns);
}
function getCteModel(parsed,def,tables,definitions,memo,computing) {
  if(memo.has(def)) return memo.get(def);
  if(computing.has(def)) return null;
  computing.add(def);
  const model={name:def.name,project:'',dataset:'',description:'CTE',columns:getProjection(parsed,def,tables,definitions,memo,computing)};
  computing.delete(def);
  memo.set(def,model);
  return model;
}

function activeClause(tokens,position) {
  let clause=null;
  const before=tokens.filter(t=>t.start<position);
  for(let i=0;i<before.length;i++) {
    const word=before[i].value.toUpperCase();
    if(CLAUSE_WORDS.has(word)) {
      if((word==='GROUP'||word==='ORDER') && before[i+1]?.value.toUpperCase()==='BY') {
        clause=word+' BY';i++;
      } else clause=word;
    }
  }
  return clause;
}
function sqlCompletionContext(source,position,tables) {
  const src=String(source??'');
  const before=src.slice(0,position);
  const parsed=lexSql(src);
  // Quoted table references are intentional SQL identifiers, not string literals.
  // Validate the quote's tokenizer position so lookalikes in comments or strings
  // cannot trigger completion. VSCode may have already inserted a closing `.
  const quoted=QUOTED_PATH.exec(before);
  if(quoted) {
    const path=quoted[2];
    const quoteAt=position-path.length-1;
    const token=parsed.tokens.find(t=>t.kind==='identifier' && t.start===quoteAt && t.end>=position);
    if(token) return {kind:'quoted-relation',path,typed:path.split('.').at(-1),
      createKind:quoted[1]?.replace(/\s+/g,' ').toUpperCase()||null,
      nextChar:src[position]||'',closeQuote:src[position]!=='`'};
  }
  if(parsed.excluded.some(([from,to])=>from<position && position<=to)) return null;
  // Multi-part unquoted references (e.g. FROM project.dataset.) are treated as
  // table paths, never mistaken for a column alias such as SELECT t1.
  const plain=UNQUOTED_PATH.exec(before);
  if(plain) return {kind:'relation-path',path:plain[2]+plain[3],typed:plain[3],
    createKind:plain[1]?.replace(/\s+/g,' ').toUpperCase()||null,
    nextChar:src[position]||'',closeQuote:false};
  const definitions=collectCtes(parsed);
  const memo=new Map();
  const computing=new Set();
  const scope=activeQueryTokens(parsed,position);
  const frame=frameAt(parsed.frames,position);
  const ctes=visibleCtes(parsed,definitions,frame,position);
  const bindings=()=>queryBindings(scope,tables,ctes,d=>getCteModel(parsed,d,tables,definitions,memo,computing));
  const qualified=/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/.exec(before);
  if(qualified) {
    const table=bindings().get(qualified[1].toLowerCase());
    return {kind:'column',typed:qualified[2],table:table||null};
  }
  const typedMatch=/([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  const typed=typedMatch?.[1]||'';
  const prefixEnd=position-typed.length;
  const prefixTokens=parsed.tokens.filter(t=>t.end<=prefixEnd);
  const last=prefixTokens.at(-1);
  const following=before.slice(last?.end||0,prefixEnd);
  if(last?.kind==='word' && RELATION_START.has(last.value.toUpperCase())
    && /^\s*$/.test(following) && (typed.length>0 || following.length>0)) {
    return {kind:'table',typed,ctes:[...ctes.values()].map(d=>({name:d.name,description:'CTE'}))};
  }
  const clause=activeClause(scope,prefixEnd);
  if(!COLUMN_CLAUSES.has(clause)) return null;
  // Only offer unqualified names in column-expression contexts; never propose
  // columns while typing keywords, table aliases or outside a SELECT block.
  if(!scope.some(t=>t.value.toUpperCase()==='SELECT')) return null;
  const sources=[...bindings().entries()].filter(([,table])=>table?.columns?.length);
  return {kind:'unqualified-column',typed,sources};
}

module.exports={lexSql,activeQueryTokens,relationBindings,sqlCompletionContext,collectCtes,visibleCtes};
