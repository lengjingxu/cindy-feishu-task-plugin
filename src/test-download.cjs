'use strict';
const {createHash}=require('node:crypto');
const {fail}=require('./core.cjs');
async function verifyDownload(fetcher,url,marker){
 const expected=Buffer.from(marker+'\n','utf8');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)fail('TEST_DOWNLOAD_FAILED');
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>expected.length)fail('TEST_DOWNLOAD_CONTENT_MISMATCH');chunks.push(Buffer.from(chunk));}
 const content=Buffer.concat(chunks);
 if(!content.equals(expected))fail('TEST_DOWNLOAD_CONTENT_MISMATCH');
 return {verified:true,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex'),content:content.toString('utf8')};
}
module.exports={verifyDownload};
