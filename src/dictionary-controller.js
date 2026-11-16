'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {reloadDictionaries,BUNDLED_DIRECTORY,DICTIONARY_FILES}=require('./completion');
const RELOAD_COMMAND='bigquerySqlLanguage.reloadDictionaries';

function getDictionaryDirectory(context,vscode) {
  const configured=vscode.workspace.getConfiguration('bigquerySqlLanguage')
    .get('dictionaryDirectory','');
  if(typeof configured!=='string')throw new Error('Dictionary directory must be a string');
  const dir=configured.trim();
  if(dir)return path.resolve(dir.replace(/^~(?=[\\/]|$)/,os.homedir()));
  return context.globalStorageUri?.fsPath
    ? path.join(context.globalStorageUri.fsPath,'dictionaries'):null;
}

function createDictionaryController(context,vscode,{watch=fs.watch,debounceMs=150}={}) {
  let directory=null,watcher=null,timer=null,disposed=false;
  const disposables=[];
  function warn(error) {
    void vscode.window?.showWarningMessage?.('BigQuery辞書の読込エラー。前回の正常な辞書を維持します: '+error.message);
  }
  function close() {
    if(timer!==null){clearTimeout(timer);timer=null;}
    if(watcher){watcher.close();watcher=null;}
  }
  function reload(){return reloadDictionaries(directory||BUNDLED_DIRECTORY);}
  function configure() {
    if(disposed)return;
    try {
      const target=getDictionaryDirectory(context,vscode);
      if(!target)return;
      fs.mkdirSync(target,{recursive:true});
      for(const filename of DICTIONARY_FILES) {
        try {
          fs.copyFileSync(path.join(BUNDLED_DIRECTORY,filename),
            path.join(target,filename),fs.constants.COPYFILE_EXCL);
        }catch(error){if(error.code!=='EEXIST')throw error;}
      }
      let failure=null;
      try{reloadDictionaries(target);}catch(error){failure=error;}
      // Keep watching a directory even when a temporarily invalid file is present.
      close();
      directory=target;
      watcher=watch(target,{persistent:false},(_type,filename)=>{
        if(disposed||(filename&&!DICTIONARY_FILES.includes(String(filename))))return;
        if(timer!==null)clearTimeout(timer);
        timer=setTimeout(()=>{
          timer=null;
          try{reload();}catch(error){warn(error);}
        },debounceMs);
      });
      watcher.on?.('error',warn);
      if(failure)warn(failure);
    }catch(error){warn(error);}
  }
  configure();
  if(vscode.commands?.registerCommand)disposables.push(
    vscode.commands.registerCommand(RELOAD_COMMAND,()=>{
      try {
        reload();
        void vscode.window?.showInformationMessage?.('BigQuery辞書を再読み込みしました。');
      }catch(error){warn(error);}
    }));
  if(vscode.workspace?.onDidChangeConfiguration)disposables.push(
    vscode.workspace.onDidChangeConfiguration(event=>{
      if(event.affectsConfiguration?.('bigquerySqlLanguage.dictionaryDirectory'))configure();
    }));
  return {
    getDirectory:()=>directory,reload,
    dispose() {
      disposed=true;close();
      for(const disposable of disposables)disposable.dispose();
    }
  };
}
module.exports={createDictionaryController,getDictionaryDirectory,RELOAD_COMMAND};
