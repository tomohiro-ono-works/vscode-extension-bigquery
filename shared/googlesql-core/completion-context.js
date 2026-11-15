'use strict';

const {tokenize} = require('./tokenize');

const clauseWords = new Set(['SELECT','FROM','JOIN','ON','WHERE','HAVING','QUALIFY','LIMIT','WINDOW']);

/** Return the nearest active SQL clause using the current line and up to 20 previous lines. */
function getSqlCompletionContext(source,offset,maxPriorLines=20) {
  const text=String(source ?? '').slice(0,offset);
  let start=0;
  let cursor=text.length;
  for (let lines=0;lines<=maxPriorLines && cursor>0;lines++) {
    const previous=text.lastIndexOf('\n',cursor-1);
    if (previous<0) {start=0;break;}
    start=previous+1;
    cursor=previous;
  }

  const window=text.slice(start);
  const excluded=new Uint8Array(window.length);
  // Scan from the beginning for correctly paired multiline comments/strings,
  // even when their opening delimiters are above the bounded context window.
  for (const token of tokenize(text)) {
    const hidden=token.kind==='comment' || token.kind==='string' || token.kind==='parameter'
      || (token.kind==='relation' && text[token.start]==='`');
    if (!hidden || token.end<=start) continue;
    excluded.fill(1,Math.max(0,token.start-start),Math.min(window.length,token.end-start));
  }

  let frames=[{clause:null,partial:null}];
  const parts=/[A-Za-z_][A-Za-z0-9_]*|[();]/g;
  for (const match of window.matchAll(parts)) {
    if (excluded[match.index]) continue;
    const word=match[0].toUpperCase();
    if (word===';') {
      frames=[{clause:null,partial:null}];
      continue;
    }
    if (word==='(') {
      frames.push({clause:null,partial:null});
      continue;
    }
    if (word===')') {
      if (frames.length>1) frames.pop();
      else frames[0]={clause:null,partial:null};
      continue;
    }
    const frame=frames.at(-1);
    if (word==='BY' && frame.partial==='GROUP') {
      frame.clause='GROUP BY';
      frame.partial='GROUP BY';
    } else if (word==='ALL' && frame.partial==='GROUP BY') {
      frame.clause='GROUP BY ALL';
      frame.partial=null;
    } else if (word==='BY' && frame.partial==='ORDER') {
      frame.clause='ORDER BY';
      frame.partial=null;
    } else if (word==='GROUP' || word==='ORDER') {
      frame.partial=word;
    } else {
      frame.partial=null;
      if (clauseWords.has(word)) frame.clause=word;
    }
  }
  return frames.at(-1).clause;
}

module.exports = {getSqlCompletionContext};
