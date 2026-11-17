// Only launches a fresh, isolated browser profile owned by this test.
// It never connects to an existing user browser session.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

class CDP {
 constructor(ws){this.ws=ws;this.counter=0;this.waiting=new Map();this.events=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(String(event.data));if(msg.id){const job=this.waiting.get(msg.id);if(job){this.waiting.delete(msg.id);clearTimeout(job.timer);msg.error?job.reject(Error(JSON.stringify(msg.error))):job.resolve(msg.result);}}else{for(const fn of this.events.get(msg.method)||[])fn(msg.params);}});}
 static async connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});return new CDP(ws);}
 call(method,params={}){const id=++this.counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiting.delete(id);reject(Error('CDP timeout: '+method));},30000);this.waiting.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 on(event,fn){if(!this.events.has(event))this.events.set(event,[]);this.events.get(event).push(fn);}
 async evaluate(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
 async until(expression,timeout=12000){const start=Date.now();while(Date.now()-start<timeout){try{const r=await this.evaluate(expression);if(r)return r;}catch(e){}await new Promise(r=>setTimeout(r,80));}throw Error('Condition timeout: '+expression);}
 async loadCommand(method,params={}){let handler;const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Page load timeout')),15000);handler=()=>{clearTimeout(timer);const callbacks=this.events.get('Page.loadEventFired');callbacks.splice(callbacks.indexOf(handler),1);resolve();};this.on('Page.loadEventFired',handler);});await this.call(method,params);await loaded;await this.until('document.readyState === "complete"');}
 async navigate(url){await this.loadCommand('Page.navigate',{url});}
 async reload(){await this.loadCommand('Page.reload');}
 async fileInput(selector,files){const {root}=await this.call('DOM.getDocument');const {nodeId}=await this.call('DOM.querySelector',{nodeId:root.nodeId,selector});if(!nodeId)throw Error('Missing file input: '+selector);await this.call('DOM.setFileInputFiles',{nodeId,files});}
 async screenshot(target){const r=await this.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(target,Buffer.from(r.data,'base64'));}
 close(){this.ws.close();}
}

async function launch(root,engine='chrome'){
 const exe=engine==='edge'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe';
 if(!fs.existsSync(exe))throw Error('Browser not installed: '+exe);
 const profile=path.join(root,'.qa',`profile-${engine}-${Date.now()}`);fs.mkdirSync(profile,{recursive:true});
 const child=spawn(exe,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());child.stdout.resume();
 const address=await new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearInterval(timer);resolve(m[1]);}else if(child.exitCode!==null||Date.now()-start>15000){clearInterval(timer);reject(Error('Isolated browser failed: '+stderr.slice(-1800)));}},80);});
 const browser=await CDP.connect(address);
 const port=new URL(address).port;
 const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const page=await CDP.connect(list.find(x=>x.type==='page').webSocketDebuggerUrl);
 await page.call('Page.enable');await page.call('Runtime.enable');
 const errors=[];page.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
 return {page,browser,errors,profile,async close(){try{await browser.call('Browser.close');}catch(e){}page.close();browser.close();}};
}
module.exports={CDP,launch};
