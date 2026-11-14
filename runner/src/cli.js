'use strict';
const {spawn}=require('node:child_process');
function resolveCliInvocation(program,args,platform=process.platform){
 if(program!=='bq'&&program!=='gcloud')throw new Error('CLI program not allowed.');
 if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'|| !/^[A-Za-z0-9_=:./-]+$/.test(arg)))throw new Error('Unsafe CLI argument.');
 return platform==='win32'?{file:'cmd.exe',args:['/d','/s','/c',`${program}.cmd`,...args]}:{file:program,args:[...args]};
}
function runSpawnedCommand(file,args,{stdin='',timeoutMs=180000,maxOutputBytes=1024*1024}={}){
 return new Promise((resolve,reject)=>{
 let child;try{child=spawn(file,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){reject(error);return;}
 let stdout='',stderr='',totalBytes=0,settled=false;
 const timer=setTimeout(()=>fail(new Error(`CLI timed out after ${timeoutMs} ms.`)),timeoutMs);
 if(typeof timer.unref==='function')timer.unref();
 function fail(error){if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(error);}
 function append(type,chunk){totalBytes+=chunk.length;if(totalBytes>maxOutputBytes){fail(new Error(`CLI output exceeded the ${maxOutputBytes}-byte limit.`));return;}
 if(type==='stdout')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');}
 child.stdout.on('data',chunk=>append('stdout',chunk));child.stderr.on('data',chunk=>append('stderr',chunk));
 child.on('error',fail);child.stdin.on('error',error=>{if(!settled&&error.code!=='EPIPE')fail(error);});
 child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);if(code!==0)reject(new Error(`CLI exit code ${code}: ${stderr.slice(0,2000).trim()||'Unknown error'}`));else resolve({stdout,stderr});});
 child.stdin.end(stdin);
 });
}
function runCli(program,args,options={}){const invocation=resolveCliInvocation(program,args);return runSpawnedCommand(invocation.file,invocation.args,options);}
module.exports={resolveCliInvocation,runSpawnedCommand,runCli};
