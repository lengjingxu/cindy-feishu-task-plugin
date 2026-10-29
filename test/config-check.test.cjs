const {test}=require('node:test'),assert=require('node:assert/strict');const {scopes,versions,required}=require('../src/config-check.cjs');const {action}=require('../src/feishu.cjs');
test('scopes完整当前回执才通过，缺失或未授权准确列出',async()=>{const all=required.map(scope_name=>({scope_name,scope_type:'tenant',grant_status:1}));assert.equal((await scopes(async()=>({data:{scopes:all}}))).state,'verified');const r=await scopes(async()=>({data:{scopes:[{scope_name:required[0],scope_type:'tenant',grant_status:2},...all.slice(2)]}}));assert.deepEqual(r.missing,required.slice(0,2));});
test('scopes无分页契约：未完整分页、非法状态、重复项拒绝而非截断通过',async()=>{for(const data of [{scopes:[],has_more:true},{scopes:[],page_token:'next'},{scopes:[{scope_name:'x',scope_type:'tenant',grant_status:3}]},{scopes:[{scope_name:'x',scope_type:'tenant',grant_status:1},{scope_name:'x',scope_type:'tenant',grant_status:2}]}])await assert.rejects(scopes(async()=>({data})));});
test('版本列表分页检查身份，保留审核中及发布状态，不假定已通过',async()=>{const urls=[];const r=await versions(async url=>{urls.push(url);return{data:{items:[{app_id:'app',version_id:String(urls.length),status:urls.length===1?3:1}],has_more:urls.length===1,page_token:'a b'}}},'app');assert.equal(r.configuration.versions.length,2);assert(urls[1].includes('page_token=a%20b'));assert.equal(r.state,'observed');});
test('版本分页缺游标、循环、跨应用、权限错误不当成功',async()=>{await assert.rejects(versions(async()=>({data:{items:[],has_more:true}}),'app'));await assert.rejects(versions(async()=>({data:{items:[],has_more:true,page_token:'same'}}),'app'));await assert.rejects(versions(async()=>({data:{items:[{app_id:'other',version_id:'v',status:1}],has_more:false}}),'app'));await assert.rejects(versions(async()=>{throw Object.assign(Error(),{code:'FEISHU_API_99991672'})},'app'),{code:'FEISHU_API_99991672'});});
test('scopes采用tenant token、无旧账号数据，未安装与权限错误保留API码',async()=>{let calls=0;const r=await action({appId:'cli_0000000000000000',action:'scopes'},'fixture',async(url,init)=>{calls++;if(calls===1)return{ok:true,json:async()=>({code:0,tenant_access_token:'tenant-fixture'})};assert(url.endsWith('/application/v6/scopes'));assert.equal(init.headers.Authorization,'Bearer tenant-fixture');return{ok:true,json:async()=>({code:0,data:{scopes:[]}})};});assert.deepEqual(r.missing,required);calls=0;await assert.rejects(action({appId:'cli_0000000000000000',action:'scopes'},'fixture',async()=>++calls===1?{ok:true,json:async()=>({code:0,tenant_access_token:'fixture'})}:{ok:false,status:400,json:async()=>({code:212100})}),{code:'FEISHU_API_212100'});});

test('同名用户与应用权限分别核验，用户权限不能替代应用权限',async()=>{
 const tenant=required.map(scope_name=>({scope_name,scope_type:'tenant',grant_status:1}));
 const user=required.map(scope_name=>({scope_name,scope_type:'user',grant_status:1}));
 assert.equal((await scopes(async()=>({data:{scopes:[...user,...tenant]}}))).state,'verified');
 assert.deepEqual((await scopes(async()=>({data:{scopes:user}}))).missing,required);
 await assert.rejects(scopes(async()=>({data:{scopes:[{scope_name:required[0],grant_status:1}]}})));
});
test('版本分页读取全程使用同一真实认证，异步结束后再清空token',async()=>{
 let pages=0;
 const result=await action({appId:'cli_0000000000000000',action:'versions'},'fixture',async(url,init)=>{
  if(url.includes('/auth/'))return{ok:true,json:async()=>({code:0,tenant_access_token:'fixture-token'})};
  assert.equal(init.headers.Authorization,'Bearer fixture-token');pages++;
  return{ok:true,json:async()=>({code:0,data:{items:[],has_more:pages===1,page_token:'next'}})};
 });assert.equal(pages,2);assert.equal(result.state,'observed');
});
