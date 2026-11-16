'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createDictionaryController}=require('../src/dictionary-controller');
const core=require('../src/completion');

function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'bq-dict-'));
  let configured='',onConfig=null;
  const warnings=[],commands=new Map(),watches=[];
  const vscode={
    workspace:{
      getConfiguration:()=>({get:(name,fallback)=>name==='dictionaryDirectory'?configured:fallback}),
      onDidChangeConfiguration:fn=>{onConfig=fn;return {dispose(){}};}
    },
    commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
    window:{showWarningMessage:msg=>warnings.push(msg),showInformationMessage:msg=>warnings.push(msg)}
  };
  const watch=(directory,options,callback)=>{
    const watcher={directory,options,callback,closed:false,close(){this.closed=true;},on(){return this;}};
    watches.push(watcher);return watcher;
  };
  const controller=createDictionaryController({globalStorageUri:{fsPath:base}},vscode,{watch,debounceMs:5});
  return {
    base,controller,watches,commands,warnings,
    configure(dir){configured=dir;onConfig({affectsConfiguration:x=>x==='bigquerySqlLanguage.dictionaryDirectory'});},
    change(name){watches.at(-1).callback('change',name);},
    cleanup(){controller.dispose();core.reloadDictionaries();fs.rmSync(base,{recursive:true,force:true});}
  };
}
const files=['keywords.txt','functions.txt','snippets.json'];

test('default global storage seeds the three dictionaries without changing bundled files',()=>{
  const f=fixture();
  try{
    const dir=path.join(f.base,'dictionaries');
    assert.equal(f.controller.getDirectory(),dir);
    for(const file of files)assert.equal(fs.readFileSync(path.join(dir,file),'utf8'),
      fs.readFileSync(path.join(core.BUNDLED_DIRECTORY,file),'utf8'));
    assert.ok(core.getCatalog().keywords.includes('SELECT'));
    assert.equal(f.warnings.length,0);
  }finally{f.cleanup();}
});

test('file-save event reloads external keywords and templates without reinstalling',async()=>{
  const f=fixture();
  try{
    const folder=f.controller.getDirectory();
    fs.appendFileSync(path.join(folder,'keywords.txt'),'CUSTOM_BIGQUERY_KEYWORD\n');
    f.change('keywords.txt');
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.ok(core.findCompletions('CUSTOM_BIGQUERY_KEY').some(x=>x.label==='CUSTOM_BIGQUERY_KEYWORD'));
    const snippets=JSON.parse(fs.readFileSync(path.join(folder,'snippets.json'),'utf8'));
    const insert='CUSTOM $'+'{1:parameter}';
    snippets.push({label:'CUSTOM SQL TEMPLATE',insertText:insert});
    fs.writeFileSync(path.join(folder,'snippets.json'),JSON.stringify(snippets));
    f.change('snippets.json');
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.ok(core.findCompletions('CUSTOM SQL TEMPLATE').some(x=>x.insertText===insert));
  }finally{f.cleanup();}
});

test('re-initialization preserves edited files, and manual reload command works',()=>{
  const f=fixture();
  try{
    const folder=f.controller.getDirectory();
    fs.appendFileSync(path.join(folder,'functions.txt'),'CUSTOMFUNC\n');
    const old=fs.readFileSync(path.join(folder,'functions.txt'),'utf8');
    f.configure('');
    assert.equal(fs.readFileSync(path.join(folder,'functions.txt'),'utf8'),old);
    f.commands.get('bigquerySqlLanguage.reloadDictionaries')();
    assert.ok(core.findCompletions('CUSTOMFUNC').some(x=>x.kind==='function'));
  }finally{f.cleanup();}
});

test('configured absolute path is used; existing files are not overwritten',()=>{
  const f=fixture();
  try{
    const custom=path.join(f.base,'custom');
    fs.mkdirSync(custom);
    fs.writeFileSync(path.join(custom,'keywords.txt'),'CUSTOM_KEYWORD\n');
    f.configure(custom);
    assert.equal(f.controller.getDirectory(),custom);
    assert.ok(core.getCatalog().keywords.includes('CUSTOM_KEYWORD'));
    assert.equal(core.getCatalog().keywords.includes('SELECT'),false);
    assert.equal(fs.readFileSync(path.join(custom,'keywords.txt'),'utf8'),'CUSTOM_KEYWORD\n');
    assert.ok(fs.existsSync(path.join(custom,'functions.txt')));
    assert.ok(fs.existsSync(path.join(custom,'snippets.json')));
    assert.equal(f.watches[0].closed,true);
  }finally{f.cleanup();}
});

test('invalid JSON edit retains last good snapshot and reloads after correction',async()=>{
  const f=fixture();
  try{
    const folder=f.controller.getDirectory(),before=core.getCatalog();
    fs.writeFileSync(path.join(folder,'snippets.json'),'{invalid');
    f.change('snippets.json');
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.strictEqual(core.getCatalog(),before);
    assert.ok(f.warnings.some(x=>x.includes('読込エラー')));
    fs.copyFileSync(path.join(core.BUNDLED_DIRECTORY,'snippets.json'),path.join(folder,'snippets.json'));
    f.change('snippets.json');
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.notStrictEqual(core.getCatalog(),before);
  }finally{f.cleanup();}
});

test('dispose stops watchers and unregisters the reload command',()=>{
  const f=fixture();
  try{
    f.controller.dispose();
    assert.equal(f.watches.at(-1).closed,true);
    assert.equal(f.commands.size,0);
  }finally{f.cleanup();}
});
