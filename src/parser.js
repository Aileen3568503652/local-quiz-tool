/* Offline import of user-provided question banks. No imported script is executed. */
(function (global) {
  'use strict';
  const MAX_FILE = 20 * 1024 * 1024;
  const MAX_EXPANDED = 100 * 1024 * 1024;
  let sequence = 0;
  const uid = () => 'import-' + Date.now().toString(36) + '-' + (++sequence).toString(36);
  const cancel = signal => { if (signal && signal.aborted) throw new DOMException('导入已取消', 'AbortError'); };
  const clean = s => String(s || '').replace(/\r\n?/g, '\n').replace(/\\([_*])/g, '$1').trim();
  const bare = s => clean(s).replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
  const typeNames = ['单选题','多选题','判断题','填空题','简答题','计算题','待确认'];
  function normalizeType(t) {
    t = String(t || '');
    if (/分录|计算|综合填空/.test(t)) return '计算题';
    if (/单选/.test(t)) return '单选题';
    if (/多选|不定项/.test(t)) return '多选题';
    if (/判断|是非/.test(t)) return '判断题';
    if (/填空/.test(t)) return '填空题';
    if (/简答|问答|论述/.test(t)) return '简答题';
    return '待确认';
  }
  function qheading(line) {
    const s = bare(line);
    let m = s.match(/^(T\d+-\d{1,5})(?:\s*[|｜]\s*([^\n]+))?\s*$/i);
    if (m) return { id:m[1].toUpperCase(), type:normalizeType(m[2]), body:'' };
    m = s.match(/^(T\d+-\d{1,5})\s*[.、:：)）\-]?\s+(.+)$/i);
    if (m) return { id:m[1].toUpperCase(), type:normalizeType(m[2]), body:m[2] };
    m = s.match(/^第\s*(\d+)\s*题(?:\s*[（(]([^）)]+)[）)])?\s*[:：.、]?\s*(.*)$/);
    if (m) return { id:m[1], type:normalizeType(m[2]), body:m[3] };
    m = s.match(/^(\d{1,4})\s*[.、)）]\s*(?!\d)(\S.*)$/);
    if (m) return { id:m[1], type:normalizeType(m[2]), body:m[2].replace(/^\s*[（(](单选题?|多选题?|判断题?|填空题?|简答题?|计算题?)[)）]\s*/, '') };
    return null;
  }
  function option(line) {
    const m = clean(line).match(/^\s*(?:[-*+]\s+)?(?:([A-H])\s*[.、:：)）]|[（(]([A-H])[）)])\s*(.*)$/i);
    return m ? { label:(m[1] || m[2]).toUpperCase(), text:m[3] } : null;
  }
  function answerMarker(line) {
    const s = bare(line);
    const m = s.match(/^(?:平台标准答案与原有说明|参考答案|标准答案|正确答案|答案|answer)\s*[:：]\s*(.*)$/i);
    return m ? m[1] : null;
  }
  function analysisMarker(line) {
    const s = bare(line);
    const m = s.match(/^(?:中英文解析|原库解析|答案解析|参考解析|解析|说明|explanation|analysis)\s*[:：]\s*(.*)$/i);
    return m ? m[1] : null;
  }
  function isAnswerSection(line) {
    const s = bare(line);
    return /^(?:\d{1,2}\s*)?(?:本类答案与说明|本章答案与说明|本章答案|本类答案|参考答案|标准答案|答案汇总|答案与解析|全文答案|答案区|答案)(?:\s*[:：])?$/i.test(s);
  }
  function isKnowledge(line) { return /^(?:本类)?知识点(?:讲解|总结)?\s*[:：]?$/i.test(bare(line)); }
  function isPractice(line) { return /^(?:本类练习|逐题练习与解析|练习题|章节练习|练习|习题|questions)\s*[:：]?$/i.test(bare(line)); }
  function topicHeading(line) {
    let m = line.match(/^\s*#{1,2}\s+(.+)$/);
    if (m && !qheading(line) && !isAnswerSection(line) && !isKnowledge(line)) return clean(m[1]);
    m = bare(line).match(/^(第[一二三四五六七八九十百\d]+[章节单元篇].*|(?:chapter|unit)\s+\d+\b.*)$/i);
    return m ? clean(m[1]) : '';
  }
  function answerEntry(line) {
    const s = bare(line);
    let m = s.match(/^(T\d+-\d{1,5})\s*(?:[|｜.、:：]|\s)\s*(.+)$/i);
    if (m) return { id:m[1].toUpperCase(), value:clean(m[2]) };
    m = s.match(/^第\s*(\d+)\s*题\s*[:：.、]?\s*(.+)$/);
    if (m) return { id:m[1], value:clean(m[2]) };
    m = s.match(/^(\d{1,4})\s*[.、:：)）]\s*(.+)$/);
    if (m) return { id:m[1], value:clean(m[2]) };
    return null;
  }
  function normalizedAnswer(raw, q) {
    let v = clean(raw).replace(/\*\*/g, '');
    if (!v) return '';
    if (q.type === '判断题') {
      const m = v.match(/^(对|错|正确|错误|true|false|√|×|✔|✘)(?:\s|$|[.、:：])/i);
      if (m) return /^(对|正确|true|√|✔)$/i.test(m[1]) ? '对' : '错';
      const letter = v.match(/^([A-H])(?:[.、:：\s]|$)/i);
      if (letter) {
        const opt = q.options.find(o => o.label === letter[1].toUpperCase());
        if (opt && /^(?:对|正确|true|√|✔)$/i.test(opt.text.trim())) return '对';
        if (opt && /^(?:错|错误|false|×|✘)$/i.test(opt.text.trim())) return '错';
      }
      return v;
    }
    if (q.type === '单选题' || q.type === '多选题') {
      const lines = v.split('\n').map(x => x.trim()).filter(Boolean);
      // An option's explanatory text may wrap across lines in PDF-derived
      // sources; collect all labelled answer lines, not just the first one.
      if (lines.length && /^[A-H][.、:：]\s*/i.test(lines[0])) {
        const labels=lines.filter(x => /^[A-H][.、:：]\s*/i.test(x)).map(x => x[0].toUpperCase());
        return labels.join('');
      }
      const m = v.match(/^([A-H](?:\s*[,，、/\s]\s*[A-H]){0,7}|[A-H]{1,8})(?:[.、:：\s]|$)/i);
      if (m) return m[1].toUpperCase().replace(/[^A-H]/g, '');
    }
    return v;
  }
  function validate(q) {
    q.issues = Array.from(new Set(q.issues || []));
    if (!q.stem) q.issues.push('缺少题干');
    if (!q.answer) q.issues.push('待补答案');
    if (q.type === '待确认') q.issues.push('题型待确认');
    if (['单选题','多选题'].includes(q.type)) {
      if (q.options.length < 2) q.issues.push('选项不足');
      if (q.answer && (!/^[A-H]+$/.test(q.answer) || [...q.answer].some(c => !q.options.some(o => o.label === c)) || (q.type === '单选题' && q.answer.length !== 1))) q.issues.push('答案与选项不匹配，需人工校对');
    }
    if (q.type === '判断题' && q.answer && !['对','错'].includes(q.answer)) q.issues.push('判断题答案无法确认');
    return q;
  }
  function* parseTextSteps(text, meta) {
    meta = meta || {};
    const source = String(meta.source || meta.name || '未命名资料');
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const result = { name:meta.name || source, questions:[], knowledge:{}, warnings:[], unmatchedAnswers:[] };
    const imageMap = meta.images || {};
    let topic = '未分类', mode = 'questions', current = null, pending = null, field = 'stem', fenced = false;
    const knowledge = [];
    function flushKnowledge() {
      if (!knowledge.length) return;
      const value = clean(knowledge.join('\n'));
      if (value) (result.knowledge[topic] ||= []).push(value);
      knowledge.length = 0;
    }
    function finishQuestion() {
      if (!current) return;
      const rawAnswer = current._answer.join('\n').trim();
      current.stem = clean(current.stem);
      current.options = current.options.map(o => ({ label:o.label, text:clean(o.text) }));
      current.analysis = clean(current.analysis);
      current.note = clean(current.note);
      if (current.type === '待确认') {
        if (current.options.length === 2 && current.options.every(o => /^(对|错|正确|错误|true|false|√|×)$/i.test(o.text))) current.type = '判断题';
        else if (/多选|select (?:all|two|three)|choose (?:all|two|three)/i.test(current.stem)) current.type = '多选题';
        else if (/单选|choose one|select one/i.test(current.stem)) current.type = '单选题';
      }
      current.answer = normalizedAnswer(rawAnswer, current);
      current.answerText = rawAnswer;
      current.raw = clean(current._raw.join('\n'));
      delete current._raw; delete current._answer;
      result.questions.push(current); current = null; field = 'stem';
    }
    function finishPending() {
      if (!pending) return;
      const possible = result.questions.filter(q => q.originalId === pending.originalId && q.topic === pending.topic && q.source === source);
      if (possible.length === 1 && !possible[0].answer) {
        possible[0].answer = normalizedAnswer(pending.answer, possible[0]);
        possible[0].answerText = pending.answer;
        if (pending.analysis) possible[0].analysis = clean([possible[0].analysis,pending.analysis].filter(Boolean).join('\n'));
      } else {
        pending.candidateIds = possible.map(q => q.id);
        pending.issues.push(possible.length > 1 ? '同一分类内题号重复，无法自动匹配' : possible.length === 1 ? '题目已有答案，需人工核对' : '未找到同来源同分类的题目，需人工匹配');
        result.unmatchedAnswers.push(pending);
      }
      pending = null;
    }
    for (let i = 0; i < lines.length; i++) {
      if (i && i % 500 === 0) yield i / lines.length;
      let line = lines[i];
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        if (current) {
          current._raw.push(line);
          if (field === 'answer') current._answer.push(line);
          else if (field === 'analysis' || field === 'note') current[field] += '\n' + line;
          else if (field === 'option' && current.options.length) current.options[current.options.length-1].text += '\n' + line;
          else current.stem += '\n' + line;
        } else if (mode === 'knowledge') knowledge.push(line);
        else if (mode === 'answers' && pending) pending.answer += '\n' + line;
        continue;
      }
      if (!fenced) {
        // The PDF-derived TXT uses an unmarked numbered title followed by a
        // "本类 N 题" line rather than Markdown headings.
        const next = lines.slice(i+1, i+5).find(x => x.trim()) || '';
        const plainTopic = /^\s*\d{2}\s+\S/.test(line) && /^本类\s*\d+\s*题/.test(next) ? clean(line) : '';
        const newTopic = topicHeading(line) || plainTopic;
        if (newTopic) { finishPending(); finishQuestion(); flushKnowledge(); topic = newTopic; mode = 'questions'; continue; }
        if (isKnowledge(line)) { finishPending(); finishQuestion(); flushKnowledge(); mode = 'knowledge'; continue; }
        if (isPractice(line)) { flushKnowledge(); mode = 'questions'; continue; }
        if (isAnswerSection(line)) { flushKnowledge(); finishQuestion(); finishPending(); mode = 'answers'; continue; }
        if (mode === 'answers') {
          const entry = answerEntry(line);
          if (entry) { finishPending(); pending = {originalId:entry.id, answer:entry.value, analysis:'', topic, source, location:`${source}:${i+1}`, raw:line, issues:[], candidateIds:[]}; field='answer'; continue; }
          if (pending && line.trim()) {
            const a=analysisMarker(line);
            if (a !== null) { field='analysis'; pending.analysis += (pending.analysis ? '\n' : '') + a; }
            else if (field === 'analysis') pending.analysis += '\n' + clean(line);
            else pending.answer += '\n' + clean(line);
            pending.raw += '\n' + line;
          }
          continue;
        }
        const head = qheading(line);
        if (head && mode !== 'knowledge') {
          finishQuestion();
          current = {id:uid(), originalId:head.id, type:head.type, stem:head.body, options:[], answer:'', analysis:'', note:'', topic, source, images:[], raw:'', location:`${source}:${i+1}`, issues:[], _raw:[line], _answer:[]};
          field = 'stem'; continue;
        }
        if (mode === 'knowledge') { if (!line.trim()) flushKnowledge(); else knowledge.push(line); continue; }
        if (!current) continue;
        const a = answerMarker(line);
        if (a !== null) { current._raw.push(line); field = 'answer'; if (a) current._answer.push(a); continue; }
        const e = analysisMarker(line);
        if (e !== null) { current._raw.push(line); field = 'analysis'; if (e) current.analysis += (current.analysis ? '\n' : '') + e; continue; }
        if (/^(?:核对说明|计算推导)\s*[:：]/.test(bare(line))) { current._raw.push(line); field = 'note'; current.note += (current.note ? '\n' : '') + bare(line); continue; }
        if (field === 'stem' || field === 'option') {
          const o = option(line);
          if (o) { current.options.push(o); current._raw.push(line); field = 'option'; continue; }
        }
      }
      if (!current) continue;
      current._raw.push(line);
      const refs = [...line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)|\[\[IMAGE:([^\]]+)\]\]/g)];
      for (const ref of refs) {
        const target = (ref[2] || ref[3] || '').trim(), found = imageMap[target] || imageMap[decodeURIComponentSafe(target)] || imageMap[target.split(/[\\/]/).pop()];
        if (found) { if (!current.images.some(x => x.dataUrl === found.dataUrl)) current.images.push(found); }
        else current.issues.push(/^(?:https?:)?\/\//i.test(target) ? `网络图片未下载：${target}` : `缺少图片：${target}`);
      }
      if (field === 'answer') { if (line.trim()) current._answer.push(clean(line)); }
      else if (field === 'analysis') current.analysis += '\n' + line;
      else if (field === 'note') current.note += '\n' + line;
      else if (field === 'option' && current.options.length && line.trim()) current.options[current.options.length-1].text += '\n' + line;
      else if (field === 'stem') current.stem += '\n' + line;
    }
    finishQuestion(); finishPending(); flushKnowledge();
    const duplicate = new Map();
    result.questions.forEach(q => { const key = q.topic + '\0' + q.originalId; duplicate.set(key, (duplicate.get(key) || 0) + 1); });
    result.questions.forEach(q => { if (duplicate.get(q.topic + '\0' + q.originalId) > 1) q.issues.push('同一分类存在重复题号'); validate(q); });
    if (/\uFFFD/.test(text)) result.warnings.push('检测到替换字符，可能存在乱码，请切换编码并校对原文');
    if (!result.questions.length && !result.unmatchedAnswers.length) result.warnings.push('未识别到题目；请检查题号和格式。');
    return result;
  }
  function parseText(text, meta) {
    const steps=parseTextSteps(text,meta); let step=steps.next();
    while (!step.done) step=steps.next();
    return step.value;
  }
  async function parseTextAsync(text,meta,signal,onStep) {
    const steps=parseTextSteps(text,meta); let step=steps.next();
    while (!step.done) {
      cancel(signal); if (onStep) onStep(step.value);
      await new Promise(resolve => setTimeout(resolve,0));
      step=steps.next();
    }
    cancel(signal); return step.value;
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }
  function convertLegacy(q, source) {
    const t = normalizeType(q.type);
    let out = {id:uid(), originalId:String(q.id || q.originalId || q.number || ''), type:t, stem:clean(q.stem),
      options:Array.isArray(q.options) ? q.options.map(o => ({label:String(o.label || ''),text:clean(o.text)})) : [],
      answer:'', analysis:clean(q.analysis), note:clean(q.note), topic:clean(q.topic) || '未分类',
      source:clean(q.source) || source, images:[], raw:clean(q.stem), location:`${source} / ${q.id || q.number || '未知题号'}`, issues:[]};
    out.answer = normalizedAnswer(q.answer || q.answerText || '', out);
    out.answerText = clean(q.answerText || q.answer || '');
    for (const img of Array.isArray(q.images) ? q.images : []) {
      if (img && /^data:image\//i.test(img.dataUrl || '')) out.images.push({dataUrl:img.dataUrl, name:img.name || img.file || '题图'});
      else out.issues.push('旧题目含无法读取的图片引用');
    }
    if (out.type === '待确认') out.issues.push(`原题型：${q.type || '未提供'}`);
    return validate(out);
  }
  function parseLegacyHtml(text, name) {
    const doc = new DOMParser().parseFromString(String(text), 'text/html');
    const data = doc.querySelector('script#questionData[type="application/json"],script#questionData');
    if (!data) throw new Error('此 HTML 不包含受支持的内嵌题库数据，不支持导入任意网页。');
    let items;
    try { items = JSON.parse(data.textContent); } catch (_) { throw new Error('HTML 中的题库数据不是有效 JSON。'); }
    if (!Array.isArray(items)) throw new Error('HTML 中的题库数据格式不正确。');
    const source = name || '旧版 HTML';
    const result = {name:source, questions:items.map(x => convertLegacy(x, source)), knowledge:{}, warnings:[], unmatchedAnswers:[]};
    const topics = doc.querySelector('script#topicData,script#topicsData,script#knowledgeData');
    if (topics) {
      try {
        const data = JSON.parse(topics.textContent);
        if (Array.isArray(data)) data.forEach(t => { if (t && t.name) result.knowledge[t.name] = Array.isArray(t.knowledge) ? t.knowledge : t.knowledge ? [String(t.knowledge)] : []; });
        else if (data && typeof data === 'object') result.knowledge = data;
      } catch (_) { result.warnings.push('知识点数据读取失败，请校对。'); }
    }
    if (!topics) result.warnings.push('旧版 HTML 未提供可读取的知识点数据。');
    return result;
  }
  function extension(name) { return (name.match(/\.([^.]*)$/) || [,''])[1].toLowerCase(); }
  function bytesToDataUrl(bytes, mime) {
    let binary = ''; const a = new Uint8Array(bytes);
    for (let i = 0; i < a.length; i += 32768) binary += String.fromCharCode(...a.subarray(i, i+32768));
    return `data:${mime};base64,${btoa(binary)}`;
  }
  function mimeFor(name) { return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml'})[extension(name)] || 'application/octet-stream'; }
  async function unzip(buffer, signal) {
    const view = new DataView(buffer); const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i,true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('DOCX 文件损坏或不是有效的 ZIP。');
    const count = view.getUint16(eocd+10,true), offset = view.getUint32(eocd+16,true);
    if (count === 65535 || offset === 0xffffffff) throw new Error('暂不支持 ZIP64 格式的 DOCX。');
    let p = offset, expanded = 0; const entries = new Map();
    for (let i=0; i<count; i++) {
      cancel(signal);
      if (p + 46 > bytes.length || view.getUint32(p,true) !== 0x02014b50) throw new Error('DOCX 目录损坏。');
      const flags=view.getUint16(p+8,true), method=view.getUint16(p+10,true), size=view.getUint32(p+20,true), plain=view.getUint32(p+24,true);
      const nl=view.getUint16(p+28,true), el=view.getUint16(p+30,true), cl=view.getUint16(p+32,true), local=view.getUint32(p+42,true);
      if (flags & 1) throw new Error('不支持加密 DOCX，请解除保护后重试。');
      const name=new TextDecoder('utf-8').decode(bytes.subarray(p+46,p+46+nl));
      expanded += plain; if (expanded > MAX_EXPANDED) throw new Error('DOCX 解压后体积过大，已停止导入。');
      if (local + 30 > bytes.length || view.getUint32(local,true) !== 0x04034b50) throw new Error('DOCX 文件条目损坏。');
      const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
      if (start+size > bytes.length) throw new Error('DOCX 文件条目不完整。');
      entries.set(name,{method, data:bytes.slice(start,start+size), plain});
      p+=46+nl+el+cl;
    }
    async function read(name) {
      cancel(signal); const e=entries.get(name); if (!e) return null;
      if (e.method === 0) return e.data;
      if (e.method !== 8) throw new Error(`DOCX 使用了不支持的压缩方法：${e.method}`);
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DOCX 解压，请更新 Chrome 或 Edge。');
      let stream;
      try { stream = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
      catch (_) { throw new Error('当前浏览器不支持 DOCX 解压，请更新 Chrome 或 Edge。'); }
      const reader=stream.getReader(), chunks=[]; let produced=0;
      while (true) {
        cancel(signal);
        const item=await reader.read(); if (item.done) break;
        produced+=item.value.length;
        if (produced > e.plain || produced > MAX_EXPANDED) { await reader.cancel(); throw new Error('DOCX 解压后体积异常，已停止导入。'); }
        chunks.push(item.value);
      }
      const result = new Uint8Array(produced); let at=0;
      for (const chunk of chunks) { result.set(chunk,at); at+=chunk.length; }
      if (result.length !== e.plain) throw new Error('DOCX 解压长度不符，文件可能损坏。');
      return result;
    }
    return {entries,read};
  }
  function xml(bytes) {
    const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('DOCX 内部 XML 损坏。');
    return doc;
  }
  function descendants(el, local) { return Array.from(el.getElementsByTagNameNS('*',local)); }
  function attr(el, local) { for (const a of Array.from(el.attributes || [])) if (a.localName === local) return a.value; return ''; }
  async function parseDocx(buffer, name, signal, onStep) {
    const zip=await unzip(buffer,signal), documentBytes=await zip.read('word/document.xml');
    if (!documentBytes) throw new Error('DOCX 缺少正文；可能是损坏或加密文档。');
    const doc=xml(documentBytes), relBytes=await zip.read('word/_rels/document.xml.rels'), images={}, rels=new Map();
    if (relBytes) for (const e of descendants(xml(relBytes),'Relationship')) if (!/external/i.test(attr(e,'TargetMode'))) rels.set(attr(e,'Id'),attr(e,'Target'));
    for (const [id,target] of rels) {
      cancel(signal);
      if (!/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(target)) continue;
      const path = ('word/' + target).replace(/\\/g,'/').split('/').reduce((a,x) => { if (x === '..') a.pop(); else if (x && x !== '.') a.push(x); return a; }, []).join('/');
      const data=await zip.read(path);
      if (data) images[id]={dataUrl:bytesToDataUrl(data,mimeFor(path)),name:path.split('/').pop()};
    }
    const warnings=[], paragraphs=[], body=descendants(doc,'body')[0];
    if (!body) throw new Error('DOCX 中未找到正文。');
    let complexity=false, formulas=false, numbered=false;
    function textNode(node) {
      let result='';
      for (const child of Array.from(node.childNodes || [])) {
        if (child.nodeType !== 1) continue;
        const n=child.localName;
        if (n === 't') result += child.textContent;
        else if (n === 'tab') result += '\t';
        else if (n === 'br' || n === 'cr') result += '\n';
        else if (n === 'blip') { const id=attr(child,'embed'); if (id) result += `[[IMAGE:${id}]]`; }
        else if (n === 'oMath' || n === 'oMathPara') { formulas=true; result += textNode(child); }
        else result += textNode(child);
      }
      return result;
    }
    function process(node) {
      const n=node.localName;
      if (n === 'p') {
        let s=textNode(node); const style=descendants(node,'pStyle')[0], val=style && attr(style,'val');
        if (descendants(node,'numPr').length) numbered=true;
        if (/^(heading|标题)\s*[12]$/i.test(val || '')) s='## '+s;
        paragraphs.push(s);
      } else if (n === 'tbl') {
        if (descendants(node,'gridSpan').length || descendants(node,'vMerge').length || descendants(node,'hMerge').length) complexity=true;
        for (const tr of Array.from(node.children).filter(c => c.localName === 'tr')) for (const tc of Array.from(tr.children).filter(c => c.localName === 'tc')) for (const item of Array.from(tc.children)) process(item);
      }
    }
    for (const item of Array.from(body.children)) { cancel(signal); process(item); }
    if (descendants(doc,'txbxContent').length || descendants(doc,'anchor').length || complexity) warnings.push('Word 含文本框、浮动对象或合并单元格，阅读顺序或排版需要人工校对。');
    if (formulas) warnings.push('Word 包含公式，已保留可提取的公式文本；上下标与分式排版需要人工校对。');
    if (numbered) warnings.push('Word 使用自动编号，编号可能无法识别；请核对题目数量，必要时将编号改为正文中的显式题号后重新导入。');
    const parsed=await parseTextAsync(paragraphs.join('\n'),{name,source:name,images},signal,onStep);
    parsed.warnings.push(...warnings);
    if (formulas || complexity) parsed.questions.forEach(q => { if (formulas && /[=+\-⁰-⁹]/.test(q.raw)) q.issues.push('公式排版需人工校对'); if (complexity) q.issues.push('表格阅读顺序需人工校对'); });
    return parsed;
  }
  async function parseFiles(files, opts) {
    opts=opts || {}; const signal=opts.signal, list=Array.from(files || []), name=list.length === 1 ? list[0].name : '导入资料';
    if (!list.length) throw new Error('请选择要导入的文件。');
    const result={name,questions:[],knowledge:{},warnings:[],unmatchedAnswers:[]}, imageMap={};
    const report=(done,message) => { if (opts.onProgress) opts.onProgress({done,total:list.length,message}); };
    for (const file of list) if (file.size > MAX_FILE) throw new Error(`${file.name} 超过单文件 20 MB 上限。`);
    for (const file of list) {
      cancel(signal); const ext=extension(file.name);
      if (['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) {
        const image={name:file.name,dataUrl:bytesToDataUrl(await file.arrayBuffer(),mimeFor(file.name))}; imageMap[file.name]=image;
        if (file.webkitRelativePath) imageMap[file.webkitRelativePath]=image;
      }
    }
    let done=0;
    for (const file of list) {
      cancel(signal); report(done,`正在读取 ${file.name}`); const ext=extension(file.name);
      if (['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) { report(++done,`已读取 ${file.name}`); continue; }
      let parsed;
      const onStep=fraction => report(done,`正在解析 ${file.name}（${Math.round(fraction*100)}%）`);
      if (ext === 'docx') parsed=await parseDocx(await file.arrayBuffer(),file.name,signal,onStep);
      else if (['txt','md','markdown','html','htm'].includes(ext)) {
        let decoder; try { decoder=new TextDecoder(opts.encoding || 'utf-8'); } catch (_) { throw new Error(`不支持编码 ${opts.encoding}。`); }
        const content=decoder.decode(await file.arrayBuffer());
        parsed = ['html','htm'].includes(ext) ? parseLegacyHtml(content,file.name) : await parseTextAsync(content,{name:file.name,source:file.name,images:imageMap},signal,onStep);
      } else { result.warnings.push(`不支持 ${file.name}；请选择 DOCX、TXT、MD 或受支持的旧版 HTML。`); report(++done,`已跳过 ${file.name}`); continue; }
      cancel(signal); result.questions.push(...parsed.questions); result.warnings.push(...parsed.warnings.map(x => `${file.name}：${x}`)); result.unmatchedAnswers.push(...parsed.unmatchedAnswers);
      Object.entries(parsed.knowledge).forEach(([key,value]) => { (result.knowledge[key] ||= []).push(...value); });
      report(++done,`已解析 ${file.name}`);
      // Allow the browser to repaint and dispatch a cancellation between files.
      await new Promise(resolve => setTimeout(resolve,0));
    }
    // Independent answer files can be paired only when both explicit topic and
    // original number identify exactly one question across all source files.
    // With missing topic, duplicate candidates, or an existing answer, retain
    // the entry for the user's review and expose possible question IDs.
    let matched=0;
    result.unmatchedAnswers=result.unmatchedAnswers.filter(entry => {
      const sameNumber=result.questions.filter(q => q.originalId === entry.originalId);
      const scoped=entry.topic && entry.topic !== '未分类' ? sameNumber.filter(q => q.topic === entry.topic) : [];
      entry.candidateIds=(scoped.length ? scoped : sameNumber).map(q => q.id);
      if (scoped.length === 1 && !scoped[0].answer && scoped[0].source !== entry.source) {
        const q=scoped[0]; q.answer=normalizedAnswer(entry.answer,q); q.answerText=entry.answer;
        if (entry.analysis) q.analysis=clean([q.analysis,entry.analysis].filter(Boolean).join('\n'));
        q.issues=q.issues.filter(issue => issue !== '待补答案'); validate(q); matched++; return false;
      }
      return true;
    });
    if (matched) result.warnings.push(`已根据唯一的章节和原题号跨文件匹配 ${matched} 条答案，请在导入前校对。`);
    if (!result.questions.length && !result.unmatchedAnswers.length) result.warnings.push('没有可导入的题目。');
    return result;
  }
  global.QuizParser={parseText,parseFiles,parseLegacyHtml};
})(window);
