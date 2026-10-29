'use strict';
// Read only the selected application's shipped code/docs, never its user data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
function archive(file){
 const fd=fs.openSync(file,'r'),header=Buffer.alloc(16);fs.readSync(fd,header,0,16,0);
 const headerSize=header.readUInt32LE(4),jsonSize=header.readUInt32LE(12);
 if(jsonSize>32*1024*1024||headerSize<jsonSize)throw Error('ASAR_HEADER_INVALID');
 const json=Buffer.alloc(jsonSize);fs.readSync(fd,json,0,jsonSize,16);const tree=JSON.parse(json);
 return {names:Object.keys(tree.files['.vite'].files.build.files),read(name){
  let entry=tree;for(const part of name.split('/'))entry=entry.files?.[part];
  if(!entry||entry.unpacked||entry.link||!Number.isSafeInteger(entry.size))throw Error('ASAR_ENTRY_UNSUPPORTED');
  const bytes=Buffer.alloc(entry.size);if(fs.readSync(fd,bytes,0,bytes.length,8+headerSize+Number(entry.offset))!==bytes.length)throw Error('ASAR_READ_SHORT');return bytes;
 },close(){fs.closeSync(fd)}};
}
function inspectPreload(source){
 let exposed;
 vm.runInNewContext(source,{require(name){if(name!=='electron')throw Error('UNEXPECTED_MODULE');return{ipcRenderer:{on(){},invoke(){throw Error('LIVE_IPC_FORBIDDEN')}},contextBridge:{exposeInMainWorld(key,value){if(key!=='cindy')throw Error('UNEXPECTED_EXPOSURE');exposed=value;}}};}},{timeout:2000});
 return {targets:Object.keys(exposed.targets),tasks:Object.keys(exposed.tasks),fetch:typeof exposed.fetch==='function',fs:typeof exposed.fs==='function',node:typeof exposed.node?.request==='function'};
}
function inspectWorker(source){
 const parent=new EventEmitter();parent.postMessage=()=>{};let entered=false;
 const context={process:{parentPort:parent,argv:['node','bootstrap','/synthetic/probe.cjs']},Buffer,URL,Intl,setTimeout,clearTimeout,__filename:'/synthetic/bootstrap.cjs',require(name){
  if(name==='node:module')return{createRequire:()=>entry=>{if(entry!=='/synthetic/probe.cjs')throw Error('UNEXPECTED_ENTRY');entered=true;}};
  if(!['node:events','node:path','node:stream','node:async_hooks'].includes(name))throw Error('UNEXPECTED_MODULE');return require(name);
 }};
 vm.runInNewContext(source,context,{timeout:2000});if(!entered)throw Error('WORKER_ENTRY_NOT_REACHED');
 return Object.keys(context.__CINDY_NODE__);
}
async function probeWorker(source,workerPath){
 const parent=new EventEmitter(),output=[];parent.postMessage=()=>{};
 const processMock={parentPort:parent,argv:['node','bootstrap',workerPath],env:{},stdout:{write:line=>output.push(JSON.parse(line))},on(){}};
 const workerRequire=require('node:module').createRequire(workerPath);
 const context=vm.createContext({process:processMock,Buffer,URL,Intl,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,__filename:'/synthetic/bootstrap.cjs',fetch(){throw Error('NETWORK_FORBIDDEN')},require(name){
  if(name==='node:module')return{createRequire:()=>entry=>{
   if(entry!==workerPath)throw Error('UNEXPECTED_ENTRY');
   context.require=workerRequire;context.__filename=workerPath;context.__dirname=path.dirname(workerPath);
   vm.runInContext(fs.readFileSync(workerPath,'utf8'),context,{timeout:2000});
  }};
  if(!['node:events','node:path','node:stream','node:async_hooks'].includes(name))throw Error('UNEXPECTED_MODULE');return require(name);
 }});
 vm.runInContext(source,context,{timeout:2000});
 parent.emit('message',{data:{type:'stdin',chunk:JSON.stringify({jsonrpc:'2.0',id:'1',method:'runtime/capabilities',params:{}})+String.fromCharCode(10)}});
 await new Promise(resolve=>setImmediate(resolve));
 parent.emit('message',{data:{type:'stdin-end'}});
 if(output.length!==1||output[0].id!=='1'||!output[0].result)throw Error('CAPABILITY_PROBE_FAILED');
 return output[0].result;
}
async function audit(resources){
 const a=archive(path.join(resources,'app.asar'));
 try{
  const pkg=JSON.parse(a.read('package.json')),source=JSON.parse(fs.readFileSync(path.join(resources,'cindy-source.json'),'utf8'));
  const entries=['.vite/build/ghostPreload.js','.vite/build/nodeRuntimeWorkerProcess.js'];
  const bootstrap=a.names.filter(n=>/^bootstrap-electron-.*\.js$/.test(n));if(bootstrap.length!==1)throw Error('BOOTSTRAP_NOT_UNIQUE');entries.push('.vite/build/'+bootstrap[0]);
  const bytes=entries.map(n=>a.read(n)),main=bytes[2].toString();
  const docs=path.join(resources,'system-skills/cindy-plugin-creator/references');
  const references=['plugin-manifest.md','plugin-node-worker.md','plugin-network.md','plugin-files-and-library.md','plugin-agent-tasks.md'];
  const fingerprints=Object.fromEntries([...entries.map((n,i)=>[n,bytes[i]]),...references.map(n=>['references/'+n,fs.readFileSync(path.join(docs,n))])].map(([n,b])=>[n,{bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}]));
  return{version:pkg.version,source,scope:'Installed code and plugin worker in isolated VM + static shipped documentation; no live IPC, credentials, network or real tasks',pluginWorkerProbe:await probeWorker(bytes[1].toString(),path.resolve(__dirname,'../plugin/node/worker.cjs')),publicPreload:inspectPreload(bytes[0].toString()),nodeBootstrap:inspectWorker(bytes[1].toString()),staticIndicators:{saveMethods:main.includes('saveMethods'),settingsMethod:main.includes('settingsMethod'),bindHostServices:main.includes('bindHostServices'),nodeAuthorizationRoute:main.includes('/node-authorization/'),uploadDir:main.includes('uploadDir'),secretBindings:main.includes('secretBindings'),cancelWarning:main.includes('runningWorkMayHaveStarted')},fingerprints};
 }finally{a.close();}
}
module.exports={audit,inspectPreload,inspectWorker};
if(require.main===module)audit(process.argv[2]||'/Applications/Cindy.app/Contents/Resources').then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
