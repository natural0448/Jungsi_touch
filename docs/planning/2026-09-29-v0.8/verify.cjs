"use strict";
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const base=__dirname;
const html=fs.readFileSync(path.join(base,'preview/index.html'),'utf8');
const data=JSON.parse(fs.readFileSync(path.join(base,'handoff/candidate.mock.json'),'utf8'));
const contract=JSON.parse(fs.readFileSync(path.join(base,'handoff/candidate-contract.json'),'utf8'));
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const checks=[];
function check(name,fn){fn();checks.push({name,status:'passed'});}
const context=vm.createContext({});
vm.runInContext(scripts.find(s=>s[1].includes('model-script'))[2],context);
const M=context.CandidateModel;
const model=M.create(data);
const roles=[...html.matchAll(/data-role="([^"]+)"/g)].map(m=>m[1]);
const nodes=new Map(roles.map(role=>[role,{textContent:'',innerHTML:'',hidden:false,value:role==='tier'?'paid':'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(name,fn){this.events[name]=fn;}}]));
nodes.get('mock-data').textContent=scripts.find(s=>s[1].includes('application/json'))[2];
const events={};
const root={querySelector(selector){const role=/^\[data-role="([^"]+)"\]$/.exec(selector);if(role){assert.ok(nodes.has(role[1]));return nodes.get(role[1]);}return null;},addEventListener(name,fn){events[name]=fn;},contains(){return true;}};
context.document={getElementById(id){assert.equal(id,'jt-candidates-v08');return root;}};
vm.runInContext(scripts.find(s=>s[1].includes('ui-script'))[2],context);
function click(action,id,filter){events.click({target:{closest(){return {dataset:{action,id,filter}};}}});}
const content=role=>nodes.get(role).innerHTML;
const ids=()=>[...content('school-list').matchAll(/data-offering-id="([^"]+)"/g)].map(m=>m[1]);
function tier(value){nodes.get('tier').value=value;nodes.get('tier').events.change();}
check('학교 탐색 분류를 학과에 상속하지 않는다',()=>{
 for(const [bucket,id] of [['challenge','b'],['core','a'],['room','c']]){
  const school=model.schoolsFor(bucket)[0];assert.equal(school.id,id);
  const categories=new Set(model.rows(school).map(M.category));
  for(const expected of ['challenge','core','room'])assert.ok(categories.has(expected));
 }
});
check('지원 조건과 비교 자료 미확인은 여유 후보로 계산하지 않는다',()=>{
 const a=model.counts(model.schools.get('a'));assert.deepEqual(JSON.parse(JSON.stringify(a)),{challenge:1,core:1,room:1,pending:1});
 for(const id of ['a04','c04','e01']){assert.equal(M.category(model.offerings.get(id)),'pending');assert.equal(model.selectable(id),false);}
 const good=model.offerings.get('a02');
 assert.equal(M.category({...good,eligibility:'ineligible'}),'pending');
 assert.equal(M.category({...good,comparability:'unverified'}),'pending');
 assert.equal(M.category({...good,forecast:{topPercent:null}}),'pending');
 assert.equal(M.category({...good,convertedTopPercent:null}),'pending');
});
check('세 학교 묶음에서 모두 펼침과 학과별 필터가 동작한다',()=>{
 for(const [bucket,id] of [['challenge','b'],['core','a'],['room','c']]){
  click('bucket',bucket);assert.ok(content('school-list').includes('data-school-id="'+id+'"'));
  click('expand',id);assert.ok(content('school-list').includes('id="detail-'+id+'" >'));
  for(const category of ['challenge','core','room','pending']){
   click('filter',id,category);
   const expected=model.rows(model.schools.get(id)).filter(o=>M.category(o)===category).map(o=>o.id);
   assert.deepEqual(ids(),Array.from(expected));
  }
  click('filter',id,'all');assert.equal(ids().length,4);
 }
});
check('대학별 단일 환산점수 대신 모집단위별 반영식과 점수를 표시한다',()=>{
 click('bucket','challenge');click('filter','b','all');
 assert.ok(content('school-list').includes('930.50'));
 assert.ok(content('school-list').includes('919.70'));
 assert.ok(content('school-list').includes('자연계열 반영식'));
 assert.ok(content('school-list').includes('인문사회 반영식'));
 assert.notEqual(model.offerings.get('b01').ruleId,model.offerings.get('b04').ruleId);
});
check('기본 학과와 와일드카드의 동일 모집행 선택은 한 건으로 동기화된다',()=>{
 click('select','b04');assert.equal(nodes.get('selected-count').textContent,'1');
 for(const role of ['school-list','wildcard-list'])assert.ok(new RegExp('data-action="select" data-id="b04" aria-pressed="true"').test(content(role)));
 click('shortlist');assert.equal(nodes.get('shortlist').hidden,false);
 assert.equal((content('selected-list').match(/data-selected-id="b04"/g)||[]).length,1);
 click('bucket','core');click('select','a02');assert.equal(nodes.get('selected-count').textContent,'2');
 click('select','b04');assert.equal(nodes.get('selected-count').textContent,'1');
 assert.ok(!content('selected-list').includes('data-selected-id="b04"'));
});
check('확인 필요 또는 존재하지 않는 모집단위는 핵심 목록에 담지 않는다',()=>{
 for(const id of ['a04','e01','missing'])click('select',id);
 assert.equal(nodes.get('selected-count').textContent,'1');
 const normalized=model.normalizeSelection(['a02','a02','missing','e01']);
 assert.deepEqual(Array.from(normalized),['a02']);
});
check('무료 화면 전환 시 대학·학과·와일드카드·선택 정보를 숨긴다',()=>{
 tier('standard');
 for(const role of ['school-list','wildcard-list','selected-list','tabs'])assert.equal(content(role),'');
 assert.equal(nodes.get('gate').hidden,false);assert.equal(nodes.get('layout').hidden,true);
 assert.equal(nodes.get('shortlist').hidden,true);assert.equal(nodes.get('selected-count').textContent,'0');
 click('select','a03');click('bucket','challenge');assert.equal(content('school-list'),'');
 tier('paid');assert.equal(nodes.get('selected-count').textContent,'1');
 assert.ok(content('selected-list').includes('data-selected-id="a02"'));
});
check('가상 데이터·HTML·서버 계약의 범위와 정책이 일치한다',()=>{
 assert.deepEqual(JSON.parse(nodes.get('mock-data').textContent),data);
 assert.equal(data.synthetic,true);assert.equal(data.offerings.length,14);
 assert.equal(contract.schema_version,'0.8');assert.equal(contract.version,'0.8');
 assert.equal(contract.school_department_hierarchy.inherit_parent_bucket,false);
 assert.equal(contract.department_decision.thresholds_status,'not_agreed_do_not_derive_from_demo');
 assert.equal(contract.three_tier_extension.prototype_client_tier_toggle_is_authorization,false);
 assert.ok(!html.includes('진학사 등록용'));
 assert.ok(html.includes('grid-template-columns:minmax(0,2fr) minmax(0,1fr)'));
 assert.ok(html.includes('@media(max-width:760px)'));
 assert.ok(html.includes('aria-controls="detail-'));
 assert.ok(!/fetch\s*\(|XMLHttpRequest|WebSocket/.test(html));
 for(const school of data.schools){for(const id of school.offeringIds)assert.equal(model.offerings.get(id).schoolId,school.id);}
});
check('중복 PK와 깨진 모집단위 연결을 거부한다',()=>{
 const copy=()=>JSON.parse(JSON.stringify(data));
 let broken=copy();broken.offerings.push(broken.offerings[0]);assert.throws(()=>M.create(broken),/모집단위/);
 broken=copy();broken.schools[0].offeringIds.push('b01');assert.throws(()=>M.create(broken),/연결/);
 broken=copy();broken.synthetic=false;assert.throws(()=>M.create(broken),/가상/);
});
const results={verifiedAt:new Date().toISOString(),scope:'v0.8 synthetic data and Node VM UI event checks',passed:checks.length,checks,browserVisualQa:'unavailable: CUA browser creation and inventory timed out',productionAuthorizationVerified:false,productionAdmissionsJudgmentVerified:false};
const firstTarget=path.join(base,'verification.json');
const target=fs.existsSync(firstTarget)?path.join(base,'verification-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'):firstTarget;
fs.writeFileSync(target,JSON.stringify(results,null,2)+'\n',{encoding:'utf8',flag:'wx'});
process.stdout.write(JSON.stringify(results,null,2)+'\n');
