import {readFile,writeFile} from 'node:fs/promises';
import {certifications,loadQuestionBank} from '../certification.js';

// Classification is stored by stable ID; only this offline authoring tool uses cues.
// Runtime sampling never infers a category from keywords or adjusts it to fill quotas.
const rules={
 'cis-df':[
  ['identification','reconciliation','\\bire\\b','class manager','class hierarchy','class attributes','cmdb 360','multisource','multi.source','identifier','identification rule','reconciliation rule'],
  ['ingest','discovery','service graph connector','integrationhub','integration hub','\\betl\\b','import set','data source','sccm','asset.*ci','ci.*asset','populate','non.discoverable','integration','data collection'],
  ['govern','health','data manager','dedup','duplicate','stale','orphan','compliance','completeness','correctness','retire','archiv','attestation','data steward','principal class','workspace','life.?cycle','certification','ownership','raci','kpi','csf','policy','remediat'],
  ['query','report','unified map','dependency view','dependency map','playbook','insight','business value','benefit.*cmdb','cmdb.*benefit','dashboard','visualiz','natural language'],
  ['csdm','business capability','business application','service offering','service portfolio','sell.*consume','design domain','manage technical','technical service','application service','business service','conceptual','information object','foundation domain','life cycle stage']
 ],
 'cis-em':[
  ['itom','benefit','customer challenge','common service data model','csdm','single system of record','business.centric','guided setup','aiops','integration.*launchpad','express list','unified service map'],
  ['mid server','ecc queue','cmdb','configuration item','ci class','discovery','architecture','windows','linux','instrumentation','line of sight'],
  ['event rule','event filter','event process','message.?key','transform','compose','regex','additional.info','json','node','binding','em_event','event.*state','state.*event','event field','severity.*blank','missing.*severity','severity.*not set'],
  ['alert','incident','task','flap','correlation','grouping','priority','impact','cluster','workflow','remediation','business service','notification'],
  ['connector','polling','collect.*event','event.*collect','inbound','snmp','trap listener','agent client collector','sensu','push','pull','monitoring system','event source','monitoring source','powershell','retrieve event'],
  ['metric','anomal','operational intelligence','statistical','machine learning','insights explorer','promotion rule','baseline.*bound','bounds']
 ],
 'cis-cad':[
  ['data model','table','field type','extend','inherit','module','application menu','link type','good fit','business process','application scope','guided application','application design','create.*application','reference field','schema','dictionary'],
  ['form','client script','ui policy','ui action','g_form','g_user','glideajax','script debugger','debug','business rule','server.side','server side','gliderecord','glideaggregate','javascript','gs\\.','script include','record producer','service portal','widget','studio.*search'],
  ['access control','\\bacl','security','restrict','protect','role','cross.scope','caller','canread','canwrite','hasrole','application access','accessible from','scope.*access'],
  ['flow','workflow','email','notification','scheduled','event','system propert','application propert','utils','utilities script','automation','trigger','inbound'],
  ['\\brest\\b','\\bsoap\\b','web service','external','import set','transform map','csv','excel','spreadsheet','data source','integration','outbound'],
  ['update set','application repository','app repository','source control','\\bgit\\b','delegated','publish','application store','servicenow store','install.*application','application.*install','version','automated test','\\batf\\b','code search','manage.*application','application file','application picker']
 ],
 'cis-csm':[
  ['account','contact','consumer','partner','product','asset','install base','entitlement','contract','business model','b2b','b2c','household','relationship','sold product'],
  ['configur','plugin','activate','role','routing','assignment','advanced work','\\bawa\\b','channel','chat','email','virtual agent','case type','integration','record producer','omni','playbook','migrate','setup','install','demo data'],
  ['case','escalat','major issue','state','resolve','resolution','close','digest','task','service definition','proactive','action status','parent','child'],
  ['portal','catalog','report','analytics','workspace','targeted communication','special handling','\\bsla','performance analytic','dashboard','survey'],
  ['knowledge','article','kcs','aqi','translation','project','implementation','best practice','workshop','scope','stakeholder','now create','architecture','process guide','success','governance']
 ]
};
const normalize=s=>String(s||'').normalize('NFKD').toLowerCase();
const overrides=JSON.parse(await readFile(new URL('../data/domain-overrides.json',import.meta.url),'utf8'));
const priorities={
 'cis-df':[[3,'unified map|query builder|saved quer|natural language|foundation.*playbook|business value|value.*security operations'],[2,'principal class|health dashboard|data manager|dedup|duplicate.*remediat|retir|archiv|life cycle.*attribut'],[0,'identification|reconciliation|\\bire\\b|class manager|class hierarchy|cmdb 360|multi.source'],[1,'ingest|integrationhub|service graph connector|\\betl\\b|asset.*synchron|synchron.*asset|agent client collector'],[4,'csdm|business capability|sell.*consume|design.*domain']],
 'cis-em':[[0,'applications.*itom|itom.*applications|main benefits|customer.*extra value|csdm|common service data model|aiops|alops|express list|unified service map'],[5,'anomal|metric|operational intelligence insights|statistical'],[4,'connector|polling|snmp|agent client collector|sensu|inbound|collect.*event|event.*collect|push|pull'],[1,'mid server|ecc queue|architecture|cmdb health|configuration management database'],[3,'alert management rule|priority|impact|cluster|flap|alert.*state|state.*alert|correlation|grouping|incident'],[2,'message.?key|event rule|event filter|regex|json|em_event|event.*process|process.*event|binding|event.*error|severity.*blank']],
 'cis-cad':[[4,'\\brest\\b|\\bsoap\\b|coalesce|import.*data|import set|transform map|csv|excel|spreadsheet|external data'],[2,'access control|\\bacl|security|cross.scope|caller|hasrole|canread|canwrite|application access|protect.*application|scope.*protect'],[5,'source control|update set|app.*repository|application repository|\\bgit\\b|delegated|publish|code search|automated test|\\batf\\b|store|install.*application|application.*install'],[3,'notification|email|workflow|flow designer|subflow|scheduled|script action|application propert|system propert|utils|utilities script'],[1,'form|client.side|client side|ui policy|ui action|g_form|g_user|g_scratchpad|glideajax|script debugger|debug|business rule|gliderecord|glideaggregate|script include|javascript|glidedatetime|annotation|report|homepage'],[0,'data model|table|application scope|application scoping|application menu|link type|module|guided application|custom app|business requirement|business process']],
 'cis-csm':[[4,'knowledge|article|kcs|aqi|translation|implementation|best practice|pre.engagement|project scope|phased release|designing solutions|support desk structure|customization'],[1,'matching rule|matching criteria|resource matching|routing|assignment|predictive intelligence|categorization|prioritization|plugin|activat|which.*role|required.*role|role.*required|channels?|chat|social profile|twitter|nlu|whisper|interactions?|scoping'],[3,'portal|communities|community|forum|catalog|report|analytics|targeted|special handling|\\bsla|leading indicator|lagging indicator|conversation history'],[0,'entitlement|contract|install base|product model|business model|business.to|b2b|b2c|consumer|partner|account|contact|asset|sold product'],[2,'case|major issue|state|guided decision|escalat|work order|digest|service definition'],[1,'integration|out.of.the.box|customer service management']]
};
const hash=q=>{let h=2166136261;for(const ch of JSON.stringify([q.pergunta,q.contexto,q.alternativas.filter(a=>a.correta).map(a=>a.texto)]))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h.toString(16).padStart(8,'0');};
const manifest={version:'2026-11-16',method:'Contextual domain mapping maintained independently of question/answer data',courses:{}};
const review=[];
for(const c of certifications){
 const sets=await Promise.all(c.files.map(file=>readFile(new URL('../'+file,import.meta.url),'utf8').then(JSON.parse)));
 const questions=sets.flatMap((set,f)=>set.map((q,i)=>({...q,id:c.id==='cis-df'?`${f+1}-${i+1}`:q.id,certification:c.id})));
 const entries={};const counts=rules[c.id].map(()=>0);
 for(const q of questions){
  const prompt=normalize(q.pergunta),answers=normalize(q.alternativas.filter(a=>a.correta).map(a=>a.texto).join(' '));
  const context=normalize(JSON.stringify(q.contexto||{}));
  const scored=rules[c.id].map((patterns,domain)=>{
   const matched=patterns.filter(p=>new RegExp(p,'i').test(prompt));
   const score=matched.reduce((s,p)=>s+(p.length>14?8:5),0)+patterns.filter(p=>new RegExp(p,'i').test(answers)).length*2+patterns.filter(p=>new RegExp(p,'i').test(context)).length;
   return {domain,score,matched};
  }).sort((a,b)=>b.score-a.score||a.domain-b.domain);
  const first=scored[0],manual=overrides[c.id]?.[q.id];
  if(manual?.signature && manual.signature!==hash(q)) throw new Error(`Re-review the changed question before reusing its override: ${q.id}`);
  if(manual) manual.signature=hash(q);
  const priority=priorities[c.id].find(([,pattern])=>new RegExp(pattern,'i').test(prompt));
  const domain=manual?.domain ?? priority?.[0] ?? first.domain;
  entries[q.id]={domain,signature:hash(q),reason:manual?.reason || (priority?'Predominant question objective: '+priority[1]:first.matched.length?'Context: '+first.matched.join(', '):'Answer/context topic mapping')};
  counts[domain]++;
  if(!manual&&!priority&&(first.score<8||first.score-scored[1].score<3))review.push({certification:c.id,id:q.id,domain,score:first.score,next:scored[1],prompt:q.pergunta,answers:q.alternativas.filter(a=>a.correta).map(a=>a.texto)});
 }
 for(const id of Object.keys(overrides[c.id]||{})) if(!entries[id]) throw new Error(`Unknown override ID: ${id}`);
 manifest.courses[c.id]=entries;console.log(c.id,counts);
}
await writeFile(new URL('../data/question-domains.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('../data/domain-overrides.json',import.meta.url),JSON.stringify(overrides,null,2)+'\n');
const sourceKey='export function domainSourceKey(q){let h=2166136261;for(const ch of JSON.stringify([q.pergunta,q.contexto,q.alternativas.filter(a=>a.correta).map(a=>a.texto)]))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h.toString(16).padStart(8,\'0\');}';
await writeFile(new URL('../question-domains.js',import.meta.url),'export const domainManifest = '+JSON.stringify(manifest)+';\n'+sourceKey+'\n');
await writeFile(new URL('../test-results/domain-review.json',import.meta.url),JSON.stringify(review,null,2)+'\n');
console.log('Review candidates:',review.length);
