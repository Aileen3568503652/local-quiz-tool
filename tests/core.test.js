const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../src/core.js');
const sample = () => Q.createBank('bank', { questions: [
  {id:'one', type:'单选题', stem:'A?', options:[{label:'A',text:'yes'},{label:'B',text:'no'}], answer:'A'},
  {id:'many', type:'多选题', stem:'multiple?', options:['a','b','c'], answer:'AC'},
  {id:'bool', type:'判断题', stem:'true?', options:[{label:'A',text:'对'},{label:'B',text:'错'}], answer:'对'},
  {id:'essay', type:'填空题', stem:'fill?', answer:'hello'},
  {id:'missing', type:'单选题', stem:'missing?', options:['a','b'], answer:''}
], knowledge:{'topic':'theory'}});

test('grading compares choices as sets and evaluates judgment using option meaning', () => {
  const b=sample();
  assert.equal(Q.grade(b.questions[0],'A').result, 'correct');
  assert.equal(Q.grade(b.questions[1],['C','A']).result, 'correct');
  assert.equal(Q.grade(b.questions[1],['A']).result, 'wrong');
  assert.equal(Q.grade(b.questions[2],'A').result, 'correct');
  assert.equal(Q.grade(b.questions[2],'false').result, 'wrong');
  assert.equal(Q.grade(b.questions[3],'hello').result, 'review');
  assert.equal(Q.grade(b.questions[4],'A').result, 'missing');
  assert.equal(Q.grade({...b.questions[0],answer:'Z'},'A').result, 'missing');
});

test('retry retains wrong history, uses separate clean round and result without changing current input', () => {
  const b=sample();
  Q.setDraft(b,'one','B'); Q.submit(b,'one','B');
  assert.equal(Q.getRecord(b,'one').currentWrong,true);
  const firstRound=Q.currentRound(b);
  const retry=Q.startWrongRound(b);
  assert.deepEqual(retry.questionIds,['one']);
  assert.equal(Q.getDraft(b,'one'),null); assert.equal(Q.getResult(b,'one'),null);
  Q.setDraft(b,'one','A'); assert.equal(firstRound.answers.one,'B');
  Q.submit(b,'one','A');
  assert.equal(Q.getRecord(b,'one').currentWrong,false);
  assert.deepEqual(Q.getRecord(b,'one').attempts.map(a=>a.result),['wrong','correct']);
  assert.equal(Q.stats(b).accuracy,1);
  Q.setDraft(b,'one','B'); assert.equal(Q.getResult(b,'one'),'correct');
});

test('self-assessment updates pending attempt once, absent key stores draft but not a grade', () => {
  const b=sample();
  assert.equal(Q.submit(b,'essay','abc').result,'review');
  assert.equal(Q.submit(b,'essay','abc',{manualResult:'wrong'}).result,'wrong');
  assert.equal(Q.getRecord(b,'essay').attempts.length,1);
  assert.equal(Q.getRecord(b,'essay').currentWrong,true);
  assert.equal(Q.submit(b,'missing','A').result,'missing');
  assert.equal(Q.getRecord(b,'missing'),null); assert.equal(Q.getDraft(b,'missing'),'A');
  assert.equal(Q.stats(b).graded,1);
});

test('deadline uses elapsed time; pause and backup snapshot preserve remaining time', () => {
  const timer=Q.createTimer('bank','round',1,1000);
  assert.equal(Q.getTimerRemaining(timer,16000),45000);
  Q.pauseTimer(timer,16000); assert.equal(timer.status,'paused');
  assert.equal(Q.getTimerRemaining(timer,90000),45000);
  Q.resumeTimer(timer,90000); assert.equal(timer.deadline,135000);
  const state=Q.createState(); state.timer=timer;
  const exported=Q.backup(state,100000);
  assert.equal(exported.state.timer.status,'paused'); assert.equal(exported.state.timer.remainingMs,35000);
  assert.equal(timer.status,'running'); assert.equal(Q.getTimerRemaining(timer,200000),0);
  Q.pauseTimer(timer,200000); assert.equal(timer.status,'expired');
});

test('backup merging previews conflicts without mutating either source and deduplicates attempt IDs', () => {
  const a=Q.createState(), b=sample(); a.banks.push(b); a.activeBankId=b.id;
  Q.submit(b,'one','B');
  const saved=Q.backup(a,1000); assert.equal(Q.validateBackup(saved).valid,true);
  const incoming=structuredClone(saved); incoming.state.banks[0].name='other';
  incoming.state.banks[0].records.one.bookmark=true;
  incoming.state.banks[0].records.one.attempts.push({id:'new',at:null,answer:'A',result:'correct',roundId:b.activeRoundId});
  const merged=Q.mergeBackup(a,incoming,'current');
  assert.equal(merged.state.banks[0].name,'bank');
  assert.equal(merged.state.banks[0].records.one.bookmark,false);
  assert.equal(merged.state.banks[0].records.one.attempts.length,2);
  assert.equal(a.banks[0].records.one.attempts.length,1);
  assert.equal(merged.report.conflictedBanks,1);
  assert.equal(Q.mergeBackup(a,incoming,'backup').state.banks[0].records.one.bookmark,true);
  const independent=Q.mergeBackup(a,incoming,'copy').state;
  assert.equal(independent.banks.length,2); assert.notEqual(independent.banks[0].id,independent.banks[1].id);
  assert.equal(Q.mergeBackup(merged.state,incoming,'current').state.banks[0].records.one.attempts.length,2);
});

test('invalid backup rejected and legacy import only maps selected bank with idempotent attempts', () => {
  const s=Q.createState(), a=sample(), b=sample(); s.banks.push(a,b);
  assert.throws(()=>Q.mergeBackup(s,{format:'other'}),/格式/);
  const progress={format:'computer-graphics-progress',records:{one:{result:'wrong',answer:'B',bookmark:true},unknown:{result:'wrong'}},drafts:{one:'A'}};
  const report=Q.parseLegacyProgress(s,progress,a.id);
  assert.equal(report.matched,1);assert.deepEqual(report.unknown,['unknown']);
  assert.equal(a.records.one.currentWrong,true);assert.equal(Q.getDraft(a,'one'),'A');
  assert.equal(Q.getRecord(b,'one'),null);
  Q.parseLegacyProgress(s,progress,a.id);assert.equal(a.records.one.attempts.length,1);
});

test('conflicting same-attempt edits and per-question round data follow selected side without dropping independent drafts', () => {
  const state=Q.createState(), bank=sample();state.banks.push(bank);state.activeBankId=bank.id;
  Q.submit(bank,'essay','abc');Q.submit(bank,'essay','abc',{manualResult:'wrong'});
  Q.setDraft(bank,'one','A');
  const saved=Q.backup(state,1000), external=structuredClone(saved), other=external.state.banks[0];
  other.records.essay.attempts[0].result='correct'; other.records.essay.currentWrong=false;
  other.rounds[0].answers.one='B';other.rounds[0].answers.many=['A'];other.rounds[0].results.essay='correct';
  bank.rounds[0].answers.bool='对';
  const kept=Q.mergeBackup(state,external,'current');
  const taken=Q.mergeBackup(state,external,'backup');
  assert.equal(kept.state.banks[0].records.essay.attempts[0].result,'wrong');
  assert.equal(taken.state.banks[0].records.essay.attempts[0].result,'correct');
  assert.equal(kept.report.conflicts[0].attempts,1);
  assert.equal(kept.state.banks[0].rounds[0].answers.one,'A');
  assert.equal(taken.state.banks[0].rounds[0].answers.one,'B');
  for (const result of [kept,taken]) {assert.equal(result.state.banks[0].rounds[0].answers.bool,'对');assert.deepEqual(result.state.banks[0].rounds[0].answers.many,['A']);}
  assert.equal(bank.rounds[0].answers.one,'A');
});

test('timer restore pauses at exported remaining time and reports competing active timer', () => {
  const source=Q.createState(), bank=sample();source.banks.push(bank);source.activeBankId=bank.id;
  source.timer=Q.createTimer(bank.id,bank.activeRoundId,1,1000);
  const exported=Q.backup(source,16000);
  const target=Q.createState();
  const restored=Q.mergeBackup(target,exported,'current').state;
  assert.equal(restored.timer.status,'paused');assert.equal(restored.timer.remainingMs,45000);
  assert.equal(Q.getTimerRemaining(restored.timer,2000000000),45000);
  const earlier=Q.backup(source,11000); const same=Q.mergeBackup(restored,earlier,'current');
  assert.equal(same.state.timer.remainingMs,45000);assert.equal(same.report.timerConflict.backup.remainingMs,50000);
  assert.equal(Q.mergeBackup(restored,earlier,'backup').state.timer.remainingMs,50000);
  const copy=Q.mergeBackup(restored,earlier,'copy');
  assert.notEqual(copy.report.timerConflict.backup.bankId, bank.id);
  assert.equal(copy.state.timer.bankId,bank.id);
  const imported=copy.state.banks.find(x=>x.id===copy.report.timerConflict.backup.bankId);
  assert.equal(imported.restoredTimer.remainingMs,50000); assert.equal(imported.restoredTimer.status,'paused');
});

test('legacy import counts attempts separately from existing bookmark and reports changed legacy records', () => {
  const s=Q.createState(), b=sample();s.banks.push(b);
  Q.toggleBookmark(b,'one');
  const legacy={records:{one:{result:'wrong',answer:'B'}}};
  Q.parseLegacyProgress(s,legacy,b.id);
  assert.equal(b.records.one.currentWrong,true);assert.equal(b.records.one.bookmark,true);
  const revised={records:{one:{result:'correct',answer:'A'}}};
  const result=Q.parseLegacyProgress(s,revised,b.id);
  assert.equal(result.conflicts.length,1);assert.equal(b.records.one.attempts.length,1);
  assert.equal(b.records.one.attempts[0].result,'wrong');
});

test('untimed session and independent-bank stored timer survive complete backup restoration', () => {
  const s=Q.createState(), b=sample();s.banks.push(b);s.activeBankId=b.id;
  s.timer=Q.createTimer(b.id,b.activeRoundId,1,1000);s.timer.questionIds=['one','many'];s.timer.index=1;
  Q.pauseTimer(s.timer,61000);s.timer.status='untimed';
  const exported=Q.backup(s,62000);
  assert.equal(Q.validateBackup(exported).valid,true);
  const restored=Q.mergeBackup(Q.createState(),exported).state;
  assert.equal(restored.timer.status,'untimed');assert.deepEqual(restored.timer.questionIds,['one','many']);
  const independent=Q.mergeBackup(s,exported,'copy').state;
  const exportedAgain=Q.backup(independent,63000);
  assert.equal(Q.validateBackup(exportedAgain).valid,true);
  assert.equal(independent.banks[1].restoredTimer.status,'untimed');
});

test('malformed questions, settings, records, rounds, and timer references are rejected transactionally', () => {
  const s=Q.createState(), b=sample();s.banks.push(b);s.activeBankId=b.id;
  Q.submit(b,'one','A');s.timer=Q.createTimer(b.id,b.activeRoundId,1,1000);s.timer.questionIds=['one'];s.timer.index=0;
  const original=JSON.stringify(s), base=Q.backup(s,2000);
  const corruptions=[
    v=>delete v.state.banks[0].questions[0].stem,
    v=>delete v.state.banks[0].questions[0].options,
    v=>v.state.banks[0].questions[0].options=[null],
    v=>v.state.settings.minutes='25',
    v=>v.state.settings.sound='false',
    v=>v.state.banks[0].records.one.attempts[0].result='invented',
    v=>v.state.banks[0].records.one.attempts[0].roundId='not-a-round',
    v=>v.state.banks[0].rounds[0].results.one='invented',
    v=>v.state.banks[0].rounds[0].questionIds.push('not-a-question'),
    v=>v.state.timer.questionIds=['not-a-question'],
    v=>v.state.timer.roundId='not-a-round',
    v=>v.state.banks[0].restoredTimer={...v.state.timer,bankId:'not-a-bank'}
  ];
  for(const corrupt of corruptions){
    const input=structuredClone(base);corrupt(input);
    const check=Q.validateBackup(input);assert.equal(check.valid,false,JSON.stringify(input));
    assert.throws(()=>Q.mergeBackup(s,input),/无效|不存在|未知|不属于/);
    assert.equal(JSON.stringify(s),original);
  }
});

test('legitimate legacy null timestamps and round answers outside current subset remain acceptable', () => {
  const s=Q.createState(),b=sample();s.banks.push(b);s.activeBankId=b.id;
  Q.startRound(b,['one'],'subset');
  Q.parseLegacyProgress(s,{records:{many:{result:'wrong',answer:['A']}},drafts:{}},b.id);
  const snapshot=Q.backup(s,1000);
  assert.equal(b.records.many.attempts[0].at,null);
  assert.equal(Q.validateBackup(snapshot).valid,true);
});
