'use strict';

const {findCompletions} = require('./completion');
const {getSqlCompletionContext} = require('./completion-context');
const {tokenize} = require('./tokenize');

const nextClauses = Object.freeze({
  SELECT:['FROM'],
  FROM:['WHERE','JOIN','GROUP BY ALL','ORDER BY'],
  JOIN:['WHERE','JOIN','GROUP BY ALL','ORDER BY'],
  ON:['WHERE','JOIN','GROUP BY ALL','ORDER BY'],
  WHERE:['AND','OR','GROUP BY ALL','ORDER BY'],
  'GROUP BY':['HAVING','QUALIFY','ORDER BY','LIMIT'],
  'GROUP BY ALL':['HAVING','QUALIFY','ORDER BY','LIMIT'],
  HAVING:['QUALIFY','ORDER BY','LIMIT'],
  QUALIFY:['WINDOW','ORDER BY','LIMIT'],
  'ORDER BY':['ASC','DESC','LIMIT']
});

/** Use the existing lightweight SQL tokenizer to avoid suggestions in SQL literals and comments. */
function isNonCodeContext(source,offset) {
  for (const token of tokenize(source.slice(0,offset))) {
    if (token.end === offset && token.start < offset
      && (token.kind === 'comment' || token.kind === 'string' || token.kind === 'parameter'
        || (token.kind === 'relation' && source[token.start] === '`'))) return true;
  }
  return false;
}

function registerGoogleSqlCompletion(vscode) {
  return vscode.languages.registerCompletionItemProvider('googlesql',{
    provideCompletionItems(document,position) {
      const empty = {items:[],isIncomplete:true};
      if (document.languageId !== 'googlesql') return empty;

      const priorText = document.lineAt(position.line).text.slice(0,position.character);
      const matched = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(priorText);
      if (!matched) return empty;
      const typed = matched[0];
      const startCharacter = position.character - typed.length;
      if (priorText[startCharacter-1] === '@') return empty;
      const offset = document.offsetAt(position);
      const source = document.getText();
      if (isNonCodeContext(source,offset)) return empty;

      const clause=getSqlCompletionContext(source,offset-typed.length);
      const promoted=new Set(nextClauses[clause] || []);

      const range = new vscode.Range({line:position.line,character:startCharacter},position);
      let preselected=false;
      const items = findCompletions(typed)
        .filter(({label})=> !(label==='USING' && (clause==='JOIN' || clause==='ON')))
        .map(({label,kind,matchKind,insertText}) => {
        const isFunction = kind === 'function';
        const isSnippet = kind === 'snippet';
        const item = new vscode.CompletionItem(label,
          isFunction ? vscode.CompletionItemKind.Function
            : isSnippet ? vscode.CompletionItemKind.Snippet : vscode.CompletionItemKind.Keyword);
        item.range = range;
        item.insertText = isFunction ? new vscode.SnippetString(`${label}($1)`)
          : isSnippet ? new vscode.SnippetString(insertText) : label;
        item.sortText = `${promoted.has(label) ? '0' : '1'}_${matchKind === 'prefix' ? '0' : '1'}_${label}`;
        if (promoted.has(label) && !preselected) {
          item.preselect=true;
          preselected=true;
        }
        item.filterText = matchKind === 'substring' ? typed : label;
        item.detail = isFunction ? 'GoogleSQL function'
          : isSnippet ? 'GoogleSQL syntax snippet' : 'GoogleSQL keyword';
        return item;
        });
      // Recompute as the user types; substring candidates use filterText to survive VSCode filtering.
      return {items,isIncomplete:true};
    }
  });
}

module.exports = {registerGoogleSqlCompletion,isNonCodeContext};
