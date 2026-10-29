// Deterministic production-path preflight, no Host installation, network or real credentials.
const assert=require('node:assert/strict');const {GrantedUpload}=require('../src/artifacts.cjs');
let requests=0;const upload=new GrantedUpload(async()=>{requests++;throw Error('Unexpected HTTP');},()=>false);
try{upload.prepare({id:'proof',name:'proof.txt',bytes:4},{token:'synthetic-not-a-host-grant',file_count:1,total_bytes:4,rel_paths:['proof.txt']});assert.fail('must block');}
catch(e){assert.equal(e.code,'HOST_UPLOAD_AUTH_UNAVAILABLE');assert.equal(requests,0);console.log(JSON.stringify({code:e.code,httpRequests:requests,realHostTest:false,credentialBytesUsed:0}));}
