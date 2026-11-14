'use strict';

// A structural scanner for table/column completion. It never executes SQL.
// Unlike single-line regex matching, it tracks parentheses, statement boundaries,
// and SELECT blocks so an alias in one CTE cannot leak into a sibling CTE.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELATION_START = new Set(['FROM','JOIN','UPDATE','INTO']);
const ALIAS_STOP = new Set([
  'ON','USING','WHERE','JOIN','INNER','LEFT','RIGHT','FULL','CROSS','OUTER','NATURAL',
  'GROUP','ORDER','HAVING','QUALIFY','LIMIT','UNION','INTERSECT','EXCEPT','WINDOW',
  'TABLESAMPLE','FOR','PIVOT','UNPIVOT','AS','WITH','OFFSET','SELECT','FROM','AND',
  'OR','WHEN','THEN','ELSE','END','SET','RETURNING','OPTIONS'
]);
const SEGMENT_BREAK = new Set(['UNION','INTERSECT','EXCEPT',';']);

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
      continue;
    }
    // Ignore single, double, triple and raw/bytes-prefixed string literals.
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
    if ('.;,'.includes(text[i])) push('punct',text[i],i,i+1);
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

function activeQueryTokens(parsed,position) {
  let id=frameAt(parsed.frames,position);
  while(id!==null) {
    const frameTokens=parsed.tokens.filter(t=>t.frame===id);
    const before=frameTokens.filter(t=>t.start<position);
    const selects=before.filter(t=>t.kind==='word' && t.value.toUpperCase()==='SELECT');
    const lastSelect=selects.at(-1);
    if(lastSelect) {
      let start=lastSelect.start;
      // Start after last set operator or semicolon preceding the current SELECT.
      const breaks=before.filter(t=>SEGMENT_BREAK.has(t.value.toUpperCase()));
      if (breaks.at(-1)?.start>start) start=breaks.at(-1).end;
      const nextBreak=frameTokens.find(t=>t.start>=start && t.start>=position
        && SEGMENT_BREAK.has(t.value.toUpperCase()));
      const end=nextBreak?.start ?? parsed.frames[id].to;
      return frameTokens.filter(t=>t.start>=start && t.start<end);
    }
    // UPDATE or INSERT INTO may have no SELECT. Do not mix parent CTE aliases
    // when we're inside a child SELECT query with a different frame.
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
  // Dotted unquoted references: project.dataset.table (hyphenated projects
  // should be backtick-quoted to avoid treating subtraction as identifier).
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

function relationBindings(tokens,tables) {
  const aliases=new Map();
  const registered=Array.isArray(tables)?tables:[];
  for (let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if(token.kind!=='word' || !RELATION_START.has(token.value.toUpperCase())) continue;
    const ref=readRelation(tokens,i+1);
    if(!ref) continue;
    const name=ref.name.toLowerCase();
    const matches=registered.filter(t=>
      `${t.project}.${t.dataset}.${t.name}`.toLowerCase()===name ||
      `${t.dataset}.${t.name}`.toLowerCase()===name ||
      t.name.toLowerCase()===name);
    // Ambiguous short names should never resolve to an arbitrary table.
    if(matches.length===1) {
      const resolved=ref.alias || matches[0].name;
      const key=resolved.toLowerCase();
      aliases.set(key,aliases.has(key)?null:matches[0]);
    } else {
      // Explicitly shadow a catalog alias with a CTE or unregistered table.
      const shadow=(ref.alias || ref.name.split('.').at(-1)).toLowerCase();
      aliases.set(shadow,null);
    }
    i=ref.nextIndex-1;
  }
  return aliases;
}

function sqlCompletionContext(source,position,tables) {
  const src=String(source??'');
  const before=src.slice(0,position);
  const parsed=lexSql(src);
  if(parsed.excluded.some(([from,to])=>from<position && position<=to)) return null;
  const qualified=/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/.exec(before);
  if(qualified) {
    const scope=activeQueryTokens(parsed,position);
    const target=relationBindings(scope,tables).get(qualified[1].toLowerCase());
    return {kind:'column',typed:qualified[2],table:target||null};
  }
  // Recognize FROM/JOIN followed by any whitespace, including newlines/tabs.
  const typedMatch=/([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  const typed=typedMatch?.[1]||'';
  const prefixEnd=position-typed.length;
  const prefixTokens=parsed.tokens.filter(t=>t.end<=prefixEnd);
  const last=prefixTokens.at(-1);
  const following=before.slice(last?.end||0,prefixEnd);
  if(last?.kind==='word' && RELATION_START.has(last.value.toUpperCase())
    && /^\s*$/.test(following) && (typed.length>0 || following.length>0)) {
    return {kind:'table',typed};
  }
  return null;
}

module.exports={lexSql,activeQueryTokens,relationBindings,sqlCompletionContext};
