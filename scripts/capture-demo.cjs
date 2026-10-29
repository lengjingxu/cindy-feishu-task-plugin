const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
 const output=path.resolve('output/demo');await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const errors=[],requests=[];let checks=0;
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:2,colorScheme:'light',acceptDownloads:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
 const url=pathToFileURL(path.resolve('docs/demo/feishu-task.html')).href;
 await page.goto(url);await page.waitForSelector('.task');assert.equal(await page.locator('.task').count(),12);checks++;
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1100});
  for(const group of ['status','list','partner','creator']){
   await page.locator('#group').selectOption(group);assert.equal(await page.locator('.task').count(),12);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks+=2;
  }
  await page.locator('[data-task="t9"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('.detail-card').isVisible());checks+=2;
  await page.locator('[data-file="output"][data-op="open"]').click();assert(await page.locator('#preview-body').textContent().then(x=>x.includes('演示文件')));checks++;
  await page.keyboard.press('Escape');assert(await page.locator('#modal').isHidden());checks++;
  await page.locator('#back').click();
 }
 await page.locator('#group').selectOption('status');await page.locator('#search').fill('工程伙伴');assert.equal(await page.locator('.task').count(),3);checks++;
 await page.locator('#search').fill('不存在的任务');assert.equal(await page.locator('.task').count(),0);assert(await page.locator('.empty').isVisible());checks+=2;
 await page.locator('#search').fill('');
 await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
 await page.screenshot({path:path.join(output,'介绍页.png'),fullPage:true});
 await page.goto(url+'?view=board');await page.waitForSelector('.task');
 await page.screenshot({path:path.join(output,'任务看板.png'),fullPage:true});
 await page.locator('#group').selectOption('partner');await page.screenshot({path:path.join(output,'按伙伴分组.png'),fullPage:true});
 await page.locator('#group').selectOption('status');await page.locator('[data-task="t9"]').click();await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
 await page.screenshot({path:path.join(output,'任务详情与回报.png'),fullPage:true});
 const downloaded=page.waitForEvent('download');await page.locator('[data-file="output"][data-op="download"]').click();const download=await downloaded;assert.equal(download.suggestedFilename(),'新品发布内容包.md');await download.saveAs(path.join(output,'演示下载.md'));const content=await fs.readFile(path.join(output,'演示下载.md'),'utf8');assert(content.includes('演示文件'));assert(content.includes('\n'));checks+=3;
 await page.locator('#back').click();await page.locator('#theme').click();assert.equal(await page.locator('body').getAttribute('data-theme'),'dark');checks++;
 await page.screenshot({path:path.join(output,'任务看板-深色.png'),fullPage:true});
 await page.setViewportSize({width:320,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks+=2;
 await fs.writeFile(path.join(output,'验证记录.json'),JSON.stringify({checks,errors,externalRequests:requests,fixtureOnly:true,widths:[320,390,768,1440],themes:['light','dark'],downloadVerified:true},null,2));
 console.log(JSON.stringify({checks,errors,externalRequests:requests,downloadVerified:true,output}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
