const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{launch}=require('./browser-driver.cjs');
const root=path.resolve(__dirname,'..'),checks=[],perf={};
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name);};
(async()=>{const session=await launch(root),p=session.page;let bankName='千题性能样本';
 p.on('Page.javascriptDialogOpening',()=>p.call('Page.handleJavaScriptDialog',{accept:true,promptText:bankName}));
 const click=s=>p.evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
 const change=(s,v,type='change')=>p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));})()`);
 const state=()=>p.evaluate('new QuizCore.Store().load()');
 const saved=e=>p.until('new QuizCore.Store().load().then(s=>'+e+')');
 const nav=n=>click(`.topbar [data-nav="${n}"]`);
 const reload=async()=>{await p.reload();await p.until('document.getElementById("library")?.children.length>0');};
 try {
  await p.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await p.navigate(pathToFileURL(path.join(root,'刷题神器.html')).href);await p.until('document.getElementById("library")?.children.length>0');
  await p.evaluate('localStorage.setItem("cg_all_review_33topics_v1",JSON.stringify({records:{"Q1":{result:"wrong"}}}))');await reload();
  check('首次使用不会读取旧学科进度',(await state()).banks.length===0);
  const malicious=await p.evaluate(`(()=>{const text='<img src="https://invalid.example/a.png"><script>window.__bad=true<'+ '/script><script id="questionData" type="application/json">'+JSON.stringify([{id:'1',type:'单选题',stem:'<img src=x onerror="window.__bad=true">',options:[{label:'A',text:'a'},{label:'B',text:'b'}],answer:'A'}])+'<'+ '/script>';const x=QuizParser.parseLegacyHtml(text,'test.html');return {count:x.questions.length,executed:!!window.__bad,stem:x.questions[0].stem};})()`);
  check('旧网页仅抽取数据，不执行脚本',malicious.count===1&&!malicious.executed&&malicious.stem.includes('<img'));
  const fixture=path.join(root,'.qa','performance.txt');
  fs.writeFileSync(fixture,Array.from({length:1000},(_,i)=>`${i%100===0?'\n第'+(Math.floor(i/100)+1)+'章 综合知识\n':''}${i+1}. （单选题）这是第 ${i+1} 道通用学科题目。 Which answer is correct?\nA. 正确选项\nB. 其他选项\n答案：A\n解析：测试中英文内容、检索和分页。\n`).join('\n'));
  await click('[data-open-import]');await p.fileInput('#importFiles',[fixture]);let t=performance.now();await click('#parseFiles');await p.until('!document.getElementById("parseFiles").disabled');perf.parse1000Ms=Math.round(performance.now()-t);
  await click('#confirmImport');await saved('s.banks[0]?.questions.length===1000');
  check('1000题仅渲染当前页',await p.evaluate('document.querySelectorAll("#questionList .question").length===10'));
  t=performance.now();await change('#search','第 987 道','input');perf.filterMs=Math.round(performance.now()-t);check('1000题搜索结果正确',await p.evaluate('document.querySelectorAll("#questionList .question").length===1&&document.getElementById("questionList").textContent.includes("987")'));
  await change('#search','','input');t=performance.now();await click('#pagerTop [data-page="next"]');perf.pageMs=Math.round(performance.now()-t);
  await p.screenshot(path.join(root,'.qa','chrome-practice.png'));
  t=performance.now();await reload();perf.reload1000Ms=Math.round(performance.now()-t);
  perf.environment=await p.evaluate('({ua:navigator.userAgent,logicalProcessors:navigator.hardwareConcurrency,deviceMemoryGiB:navigator.deviceMemory})');
  check('千题样本启动和筛选达到目标',perf.reload1000Ms<2000&&perf.filterMs<300&&perf.pageMs<300);
  await nav('practice');const b=(await state()).banks[0],id=b.questions[0].id;
  await nav('home');await click('[data-bank-act="append"]');await p.fileInput('#importFiles',[fixture]);await click('#parseFiles');await p.until('!document.getElementById("parseFiles").disabled');await click('#confirmImport');
  check('同文件重复追加跳过且题库不变',(await state()).banks[0].questions.length===1000);
  const invalid=path.join(root,'.qa','invalid-backup.json');fs.writeFileSync(invalid,JSON.stringify({state:{banks:[]}}));await nav('settings');await p.fileInput('#backupFile',[invalid]);await p.until('document.getElementById("restorePreview").textContent.includes("无效")');check('损坏备份不改动数据',(await state()).banks[0].questions.length===1000);
  // Read an explicitly supplied legacy file only inside this private test profile.
  if(process.argv[2]){
   const legacy=path.resolve(process.argv[2]);bankName='显式导入兼容样本';await click('[data-open-import]');
   await p.fileInput('#importFiles',[legacy]);await click('#parseFiles');await p.until('!document.getElementById("parseFiles").disabled',30000);
   const preview=await p.evaluate('({status:document.getElementById("parseStatus").textContent,summary:document.getElementById("previewSummary").textContent,hidden:document.getElementById("preview").hidden})');
   console.log('Legacy preview ready: '+preview.status);assert.ok(!preview.hidden,'Legacy parser should produce a preview');
   await click('#confirmImport');console.log('Legacy confirmed');await saved('s.banks.length===2');
   const old=await p.evaluate('new QuizCore.Store().load().then(s=>{const b=s.banks[1];return {count:b.questions.length,topics:new Set(b.questions.map(q=>q.topic)).size,images:b.questions.flatMap(q=>q.images).length,knowledge:Object.keys(b.knowledge).length}})');
   check('显式旧HTML完整导入967题/33类/4图',old.count===967&&old.topics===33&&old.images===4&&old.knowledge===33);
  }
  // A rejected storage transaction must leave prior data intact and expose export.
  await nav('practice');await change('#bankSelect',b.id);
  await p.evaluate('window.__savedSave=QuizCore.Store.prototype.save;QuizCore.Store.prototype.save=async()=>{throw Error("simulated quota failure")};');
  await click(`#questionList [data-act="bookmark"][data-id="${id}"]`);await p.until('!document.getElementById("saveAlert").hidden');check('保存失败明确告警且旧数据不被覆盖',await p.evaluate(`new QuizCore.Store().load().then(s=>!s.banks[0].records[${JSON.stringify(id)}]?.bookmark)`));
  const downloads=path.join(root,'.qa','downloads-'+Date.now());fs.mkdirSync(downloads,{recursive:true});await session.browser.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await click('#emergencyExport');
  const file=await new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{const f=fs.readdirSync(downloads).find(x=>x.endsWith('.json'));if(f)return resolve(path.join(downloads,f));if(Date.now()-start>7000)return reject(Error('Backup download missing'));setTimeout(poll,100)};poll();});
  const recovered=JSON.parse(fs.readFileSync(file,'utf8'));check('应急导出包含尚未保存的最新记录',recovered.state.banks[0].records[id].bookmark===true);
  await p.evaluate('QuizCore.Store.prototype.save=window.__savedSave');
  check('高级流程无未处理页面异常',session.errors.length===0);
  fs.writeFileSync(path.join(root,'.qa','advanced-report.json'),JSON.stringify({checks,perf,errors:session.errors},null,2));console.log(JSON.stringify(perf));
 }finally{await session.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
