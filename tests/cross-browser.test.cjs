const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{launch}=require('./browser-driver.cjs');
(async()=>{const root=path.resolve(__dirname,'..'),file=path.join(root,'.qa','chrome-snapshot.json'),expected=JSON.parse(fs.readFileSync(file,'utf8'));
 const session=await launch(root,'edge'),p=session.page;try{
 await p.navigate(pathToFileURL(path.join(root,'刷题神器.html')).href);await p.until('document.getElementById("library").children.length>0');
 await p.evaluate('document.querySelector(".topbar [data-nav=settings]").click()');await p.fileInput('#backupFile',[file]);await p.until('document.getElementById("applyRestore")');await p.evaluate('document.getElementById("applyRestore").click()');
 await p.until('new QuizCore.Store().load().then(s=>s.banks.length>0)');
 const actual=await p.evaluate('new QuizCore.Store().load()');assert.deepEqual(actual,expected.state);assert.equal(actual.timer.status,'paused');assert.equal(await p.evaluate('!!document.fullscreenElement'),false);
 assert.deepEqual(session.errors,[]);console.log('PASS Chrome 完整备份在独立 Edge 恢复：全部题目、图片、轮次、草稿、错题、收藏、历史及暂停计时逐字段一致');
 fs.writeFileSync(path.join(root,'.qa','cross-browser-report.json'),JSON.stringify({passed:true,banks:actual.banks.length,questions:actual.banks[0].questions.length,timer:actual.timer.status}));
 }finally{await session.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
