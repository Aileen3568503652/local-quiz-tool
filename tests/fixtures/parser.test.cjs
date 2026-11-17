const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.window = global;
require('../../src/parser.js');
const dir = __dirname;
const read = name => fs.readFileSync(path.join(dir,name),'utf8');
class TestFile extends Blob {
  constructor(parts,name) { super(parts); this.name=name; }
}
function file(name) { return new TestFile([fs.readFileSync(path.join(dir,name))],name); }

(async () => {
  const md=QuizParser.parseText(read('生态学练习.md'),{name:'生态学练习.md'});
  assert.equal(md.questions.length,7); assert.equal(Object.keys(md.knowledge).length,1);
  assert.deepEqual(md.questions.map(q=>q.answer),['A','AC','对','二氧化碳','A','','10']);
  assert(md.questions[4].issues.some(s=>s.includes('缺少图片')));
  const text=QuizParser.parseText(read('历史练习.txt'),{name:'历史练习.txt'});
  assert.deepEqual(text.questions.map(q=>q.answer),['A','ABD','对','B']);
  assert.notEqual(text.questions[0].topic,text.questions[3].topic);
  const bad=QuizParser.parseText(read('题型异常.txt'),{name:'题型异常.txt'});
  assert(bad.questions[0].issues.includes('待补答案'));
  assert(bad.questions[1].issues.some(s=>s.includes('不匹配')));
  assert(bad.questions[1].issues.some(s=>s.includes('重复题号')));
  assert.equal(bad.questions[3].type,'待确认');
  const combined=await QuizParser.parseFiles([file('历史练习.txt'),file('独立答案.txt')],{});
  assert.equal(combined.unmatchedAnswers.length,2);
  assert(combined.unmatchedAnswers.every(x=>Array.isArray(x.candidateIds)));
  const pictured=await QuizParser.parseFiles([file('生态学练习.md'),file('叶片.png')],{});
  assert.equal(pictured.questions.find(q=>q.originalId==='T1-005').images.length,1);
  const qfile=new TestFile(['第一章 算术\n1. （单选题）1+1=?\nA. 1\nB. 2\n'],'问题.txt');
  const afile=new TestFile(['第一章 算术\n答案汇总\n1. B\n'],'答案.txt');
  const pair=await QuizParser.parseFiles([qfile,afile],{});
  assert.equal(pair.questions[0].answer,'B'); assert.equal(pair.unmatchedAnswers.length,0);
  const dup=await QuizParser.parseFiles([qfile,new TestFile([await qfile.text()],'另一个问题.txt'),afile],{});
  assert.equal(dup.unmatchedAnswers.length,1); assert.equal(dup.unmatchedAnswers[0].candidateIds.length,2);
  const controller=new AbortController();
  const large=new TestFile([('1. （单选题）测试\nA. a\nB. b\n').repeat(1000)],'large.txt');
  await assert.rejects(QuizParser.parseFiles([large],{signal:controller.signal,onProgress:p=>{if(p.message.includes('正在解析'))controller.abort();}}), e=>e.name==='AbortError');
  const oversized=new TestFile([new Uint8Array(20*1024*1024+1)],'too-big.txt');
  await assert.rejects(QuizParser.parseFiles([oversized],{}),/20 MB/);
  console.log('parser text, answers, images, conflicts, cancellation and limits: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
