"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=__dirname,data=JSON.parse(fs.readFileSync(path.join(base,'handoff/candidate.mock.json'),'utf8')),contract=JSON.parse(fs.readFileSync(path.join(base,'handoff/candidate-contract.json'),'utf8'));
function makeStorage(){const entries=new Map();return {entries,getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)};}
function boot(filename='index.html',storage=makeStorage()){
 const html=fs.readFileSync(path.join(base,'preview',filename),'utf8');
 const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
 const roles=[...html.matchAll(/data-role="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(roles.map(r=>[r,{textContent:'',innerHTML:'',hidden:false,value:'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(n,f){this.events[n]=f;}}]));
 nodes.get('mock-data').textContent=scripts.find(s=>s[1].includes('application/json'))[2];assert.deepEqual(JSON.parse(nodes.get('mock-data').textContent),data);
 const events={},root={querySelector(s){const match=/^\[data-role="([^"]+)"\]$/.exec(s);if(match){assert.ok(nodes.has(match[1]),filename+' role missing: '+match[1]);return nodes.get(match[1]);}return null;},contains(){return true;},addEventListener(n,f){events[n]=f;}};
 const context=vm.createContext({sessionStorage:storage,document:{getElementById(id){assert.equal(id,'jt-candidates-v012');return root;}}});
 for(const role of ['model-script','ui-script'])vm.runInContext(scripts.find(s=>s[1].includes(role))[2],context);
 const M=context.CandidateModel;
 return {html,nodes,storage,M,model:M.create(data),content:role=>nodes.get(role).innerHTML,
 click(action,id,filter){events.click({target:{closest(){return {dataset:{action,id,filter}};}}});},
 change(role,value,eventName='change'){nodes.get(role).value=value;nodes.get(role).events[eventName]();},
 submit(){nodes.get('search-form').events.submit({preventDefault(){}});}};
}
const checks=[];function check(name,fn){fn();checks.push({name,status:'passed'});}
const ids=p=>[...p.content('catalog-results').matchAll(/data-offering-id="([^"]+)"/g)].map(m=>m[1]);
const allIds=data.offerings.map(o=>o.id);
check('1페이지와 같은 대학명·학과명 분리 검색이며 추천 단계 필터는 없다',()=>{
 const p=boot();assert.ok(p.nodes.has('university-search'));assert.ok(p.nodes.has('department-search'));assert.ok(p.nodes.has('search-form'));assert.ok(!p.nodes.has('catalog-judgment'));assert.ok(!p.content('catalog-results').includes('핵심 검토 학과'));
});
check('대학명만 검색하면 해당 대학의 모든 서비스 모집단위가 나온다',()=>{
 const p=boot();p.change('university-search','가온','input');assert.deepEqual(ids(p),['a01','a02','a03','a04']);
 p.change('university-search','예시 가온 대학교','input');assert.deepEqual(ids(p),['a01','a02','a03','a04']);
 p.click('detail','a04');assert.ok(p.content('catalog-results').includes('data-public-detail="a04"'));
});
check('학과명 단독 검색과 대학·학과 조합 검색을 지원한다',()=>{
 const p=boot();p.change('department-search','경영','input');assert.deepEqual(ids(p),['a01','f01']);
 p.change('university-search','새빛','input');assert.deepEqual(ids(p),['f01']);
 p.nodes.get('department-search').value='교육';p.submit();assert.deepEqual(ids(p),['f02']);
});
check('유료가입자는 성적 유무와 관계없이 원하는 학교를 검색하고 상세를 연다',()=>{
 const p=boot();for(const score of ['present','missing']){
  p.change('score-state',score);assert.deepEqual(ids(p),allIds);assert.equal(p.nodes.get('catalog').hidden,false);assert.equal(p.nodes.get('paid-gate').hidden,true);
  for(const id of ['f01','f02','f03']){p.click('detail',id);assert.ok(p.content('catalog-results').includes('data-public-detail="'+id+'"'));p.click('detail',id);}
 }
});
check('일반가입자는 성적 유무와 관계없이 검색·건수·상세·목록을 볼 수 없다',()=>{
 const p=boot();p.click('detail','a02');p.click('select','a02');p.click('shortlist');
 p.change('tier','standard');
 for(const score of ['present','missing']){
  p.change('score-state',score);
  for(const role of ['catalog-results','catalog-meta','selected-list'])assert.equal(p.content(role),'');
  for(const role of ['search-form','search-options','search-note','catalog','shortlist','shortlist-open','access-summary'])assert.equal(p.nodes.get(role).hidden,true);
  assert.equal(p.nodes.get('paid-gate').hidden,false);assert.equal(p.nodes.get('selected-count').textContent,'0');assert.equal(p.nodes.get('university-search').disabled,true);
  p.change('university-search','새빛','input');p.submit();p.click('detail','f01');p.click('browse-school','f');p.click('reset-catalog');p.click('select','a03');p.click('shortlist');
  assert.equal(p.content('catalog-results'),'');assert.equal(p.content('catalog-meta'),'');assert.equal(p.content('selected-list'),'');
 }
 p.change('tier','paid');p.change('score-state','present');assert.equal(p.nodes.get('selected-count').textContent,'1');assert.deepEqual(ids(p),allIds);
});
check('일반가입자의 URL 직접 진입과 새로고침에서도 3페이지가 잠긴다',()=>{
 const storage=makeStorage(),first=boot('index.html',storage);first.change('tier','standard');
 const direct=boot('index.html',storage);assert.equal(direct.nodes.get('paid-gate').hidden,false);assert.equal(direct.nodes.get('catalog').hidden,true);assert.equal(direct.content('catalog-results'),'');assert.equal(direct.content('catalog-meta'),'');
 const page4=boot('favorable.html',storage);assert.equal(page4.content('school-list'),'');assert.ok(page4.content('gate').includes('1페이지'));assert.ok(!page4.content('gate').includes('3페이지 대학·학과 검색</a>에서 확인'));
});
check('추천 밖·지원 조건 미충족·자료 부족은 검색 및 상세 열기를 막지 않는다',()=>{
 const p=boot();p.change('university-search','새빛','input');assert.deepEqual(ids(p),['f01','f02','f03']);
 for(const [id,category] of [['f01','outside'],['f02','ineligible'],['f03','pending']]){p.click('detail',id);assert.ok(p.content('catalog-results').includes('data-public-detail="'+id+'"'));assert.ok(p.content('catalog-results').includes('data-category="'+category+'"'));}
});
check('기본 검색은 개인 판정 조건을 전달해도 추천 결과로 축소되지 않는다',()=>{
 const p=boot();for(const category of ['core','outside','ineligible']){const rows=p.model.catalogBrowse({judgment:category});assert.equal(rows.reduce((n,e)=>n+e.offerings.length,0),17);}
 const altered=JSON.parse(JSON.stringify(data));for(const o of altered.offerings){o.score=null;o.convertedTopPercent=null;o.eligibility='needs_confirmation';o.forecast.topPercent=null;}
 assert.equal(p.M.create(altered).catalogBrowse().reduce((n,e)=>n+e.offerings.length,0),17);
});
check('유료 성적 미입력은 분석 안내, 일반가입자는 전체 상세 미노출로 구분한다',()=>{
 const p=boot();p.click('detail','a02');assert.ok(p.content('catalog-results').includes('915.20'));
 p.change('score-state','missing');assert.ok(p.content('catalog-results').includes('data-assessment="score-required"'));assert.ok(!p.content('catalog-results').includes('915.20'));assert.ok(p.content('catalog-results').includes('2026 합격권'));
 p.change('tier','standard');p.change('score-state','present');assert.equal(p.content('catalog-results'),'');assert.equal(p.nodes.get('paid-gate').hidden,false);
 p.click('select','a02');assert.equal(p.nodes.get('selected-count').textContent,'0');
});
check('사용자가 지정한 지역·모집군만 적용하고 검색 없음은 합격 불가로 표현하지 않는다',()=>{
 const p=boot();p.change('university-search','가온','input');p.change('department-search','경제','input');p.change('catalog-group','나군');assert.equal(ids(p).length,0);assert.ok(p.content('catalog-results').includes('검색 조건에 맞는 모집단위가 없습니다'));assert.ok(!p.content('catalog-results').includes('합격 불가'));
 p.click('reset-catalog');assert.deepEqual(ids(p),allIds);
 p.change('catalog-region','경기');assert.equal(ids(p).length,5);
});
check('검색 학과에서 해당 대학 전체 학과로 되돌아간다',()=>{
 const p=boot();p.change('department-search','간호','input');assert.deepEqual(ids(p),['b04']);p.click('browse-school','b');assert.deepEqual(ids(p),['b01','b02','b03','b04']);assert.equal(p.nodes.get('department-search').value,'');
});
check('기존 실기 제외 범위를 유지하고 미공개 인원을 0으로 표시하지 않는다',()=>{
 const p=boot(),changed=JSON.parse(JSON.stringify(data));changed.offerings[0].serviceScope.practicalExam=true;assert.equal(p.M.create(changed).catalogBrowse().reduce((n,e)=>n+e.offerings.length,0),16);
 p.click('detail','a02');assert.ok(p.content('catalog-results').includes('미공개'));assert.ok(!p.content('catalog-results').includes('>0명<'));
});
check('4페이지 추천과 와일드카드는 분리되어 있으며 선택을 3페이지와 공유한다',()=>{
 const storage=makeStorage(),p3=boot('index.html',storage);p3.click('detail','b04');p3.click('select','b04');
 const p4=boot('favorable.html',storage);assert.equal(p4.nodes.get('selected-count').textContent,'1');assert.ok(p4.nodes.has('school-list'));assert.ok(!p4.nodes.has('university-search'));
 for(const [bucket,id] of [['challenge','b'],['core','a'],['room','c']]){p4.click('bucket',bucket);p4.click('filter',id,'all');assert.ok(p4.content('school-list').includes('data-school-id="'+id+'"'));}
 assert.ok(p4.content('wildcard-list').includes('data-action="select" data-id="b04" aria-pressed="true"'));
 p4.click('select','b04');const back=boot('index.html',storage);assert.equal(back.nodes.get('selected-count').textContent,'0');
 const saved=JSON.parse([...storage.entries.values()][0]);assert.deepEqual(Object.keys(saved).sort(),['hasScore','selected','synthetic','tier']);
});
check('4페이지에서 성적이 없어도 3페이지 검색 경로를 제공한다',()=>{
 const storage=makeStorage(),p3=boot('index.html',storage);p3.change('score-state','missing');const p4=boot('favorable.html',storage);assert.equal(p4.content('school-list'),'');assert.ok(p4.content('gate').includes('3페이지 대학·학과 검색'));assert.equal(p4.nodes.get('score-summary').hidden,true);
});
check('임시 저장 차단 및 손상된 상태가 검색을 막지 않는다',()=>{
 const blocked={getItem(){throw new Error('Blocked');},setItem(){throw new Error('Blocked');}};
 const p=boot('index.html',blocked);assert.deepEqual(ids(p),allIds);p.change('university-search','새빛','input');assert.deepEqual(ids(p),['f01','f02','f03']);
});
check('3페이지 전체 API의 유료 검사와 비노출 응답을 명세한다',()=>{
 assert.equal(contract.version,'0.12');assert.equal(contract.all_offerings_catalog.expected_api.requires_paid,true);assert.ok(contract.all_offerings_catalog.expected_api.requires.includes('server_verified_active_paid_entitlement'));
 assert.equal(contract.all_offerings_catalog.expected_api.on_no_paid_access.status,403);assert.equal(contract.all_offerings_catalog.expected_api.on_no_paid_access.return_counts,false);assert.equal(contract.all_offerings_catalog.expected_api.on_no_paid_access.return_details,false);
 assert.equal(contract.page3_search_principle.active_paid_required_to_browse,true);assert.equal(contract.page3_search_principle.recommendation_required_to_browse,false);
 assert.equal(contract.entitlements.standard.catalog_search_and_basic_detail,false);assert.equal(contract.entitlements.standard.page3_access,false);assert.equal(contract.entitlements.standard.page1_history_lookup,true);
 assert.equal(contract.entitlements.paid.catalog_search_and_basic_detail,true);assert.equal(contract.all_offerings_catalog.expected_api.shared_page1_public_endpoint,false);
 for(const file of ['index.html','favorable.html']){const html=fs.readFileSync(path.join(base,'preview',file),'utf8');assert.ok(!html.includes('진학사 등록용'));assert.ok(html.includes('href="./index.html"'));assert.ok(html.includes('href="./favorable.html"'));}
});
function bootHistory(storage=makeStorage()){
 const html=fs.readFileSync(path.join(base,'preview/history.html'),'utf8'),record=JSON.parse(fs.readFileSync(path.join(base,'handoff/history.mock.json'),'utf8'));
 const roles=[...html.matchAll(/data-role="([^"]+)"/g)].map(m=>m[1]);const nodes=new Map(roles.map(r=>[r,{innerHTML:'',textContent:'',value:'',events:{},addEventListener(n,f){this.events[n]=f;}}]));
 const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];nodes.get('history-data').textContent=scripts.find(s=>s[1].includes('application/json'))[2];assert.deepEqual(JSON.parse(nodes.get('history-data').textContent),record);
 const root={querySelector(selector){const role=/^\[data-role="([^"]+)"\]$/.exec(selector);assert.ok(role);assert.ok(nodes.has(role[1]));return nodes.get(role[1]);}};
 const context=vm.createContext({sessionStorage:storage,document:{getElementById(id){assert.equal(id,'jt-history-v012');return root;}}});vm.runInContext(scripts.find(s=>s[1].includes('history-script'))[2],context);
 return {html,record,nodes,storage,content:()=>nodes.get('history-results').innerHTML,change(role,value,event='input'){nodes.get(role).value=value;nodes.get(role).events[event]();}};
}
check('3페이지 결과 표와 상세에 환산점수·지원가능성·유불리를 함께 표시한다',()=>{
 const p=boot();assert.ok(p.content('catalog-results').includes('내 환산점수'));assert.ok(p.content('catalog-results').includes('지원가능성'));assert.ok(p.content('catalog-results').includes('환산 유불리'));assert.ok(p.content('catalog-results').includes('915.20'));
 p.click('detail','a02');assert.ok(p.content('catalog-results').includes('내 성적을 이 모집단위에 적용한 결과'));assert.ok(p.content('catalog-results').includes('+0.53%p'));
});
check('같은 환산점수·같은 유불리라도 학과별 지원가능성은 다르다',()=>{
 const p=boot(),a=p.model.offerings.get('a01'),b=p.model.offerings.get('a02');assert.equal(a.score,b.score);assert.equal(p.M.advantage(a).direction,'favorable');assert.equal(p.M.advantage(b).direction,'favorable');assert.equal(p.M.category(a),'challenge');assert.equal(p.M.category(b),'core');
});
check('환산 불리여도 입결 대비 여유 후보일 수 있다',()=>{
 const p=boot(),o=p.model.offerings.get('d01');assert.equal(p.M.advantage(o).direction,'unfavorable');assert.ok(Math.abs(p.M.advantage(o).deltaPp+0.13)<1e-9);assert.equal(p.M.category(o),'room');
 p.change('department-search','임상병리','input');assert.ok(p.content('catalog-results').includes('불리 · -0.13%p'));assert.ok(p.content('catalog-results').includes('여유 후보'));
});
check('유불리는 같은 모집단·학년도·동점 기준에서 비교하며 %p를 중복 환산하지 않는다',()=>{
 const p=boot(),o=p.model.offerings.get('a02');assert.equal(p.M.advantage(o).deltaPp,0.53);
 for(const patch of [{baselinePopulationId:'another_population'},{baselineAcademicYear:2026},{baselineTiePolicy:'strictly_greater'},{ruleId:'another_rule'},{deltaPp:53}])assert.equal(p.M.advantage({...o,advantage:{...o.advantage,...patch}}).status,'unavailable');
 assert.equal(p.M.advantage(p.model.offerings.get('f03')).status,'unavailable');assert.equal(p.M.category(o),'core');
});
check('1페이지는 발표 원래 지표·값·단위와 미공개 상태만 표시한다',()=>{
 const p=bootHistory();assert.equal(p.record.synthetic,true);assert.ok(p.content().includes('최종등록자 70% 기준 대학 환산점수'));assert.ok(p.content().includes('908.40 점'));assert.ok(p.content().includes('미공개'));assert.ok(p.content().includes('입학처 (가상)'));
 for(const prohibited of ['내 환산점수','환산 유불리','자체 누적','지원가능성','data-advantage'])assert.ok(!p.content().includes(prohibited));
 for(const row of p.record.records)for(const value of row.results){assert.equal(value.source.verifiedOfficial,false);assert.equal(value.source.kind,'synthetic_university_publication_format');assert.ok(!('convertedTopPercent' in value));assert.ok(!('forecast' in value));}
 p.change('department-search','경제');assert.ok(p.content().includes('예시가온대학교'));assert.ok(!p.content().includes('예시새빛대학교'));
});
check('일반가입자는 1페이지 발표 결과를 보고 3페이지에는 잠금 안내를 받는다',()=>{
 const storage=makeStorage(),history=bootHistory(storage);history.change('tier','standard','change');assert.ok(history.content().includes('908.40 점'));
 const p3=boot('index.html',storage);assert.equal(p3.nodes.get('paid-gate').hidden,false);assert.equal(p3.content('catalog-results'),'');
});
check('공식 발표값과 개인 분석의 데이터·권한 계약을 분리한다',()=>{
 assert.ok(contract.page1_published_results_only.excluded.includes('our_estimated_cumulative_percentile'));assert.ok(contract.page1_published_results_only.excluded.includes('student_conversion_score'));assert.equal(contract.page3_student_assessment.application_and_advantage_are_independent,true);assert.equal(contract.page3_student_assessment.required_paid,true);
 assert.equal(contract.entitlements.standard.page1_history_lookup,true);assert.equal(contract.entitlements.standard.page3_access,false);
});

const result={verifiedAt:new Date().toISOString(),scope:'v0.12 university-published results versus paid student score, application assessment and advantage; Node VM DOM event harness',passed:checks.length,checks,browserVisualQa:'not_completed',productionAuthorizationVerified:false,productionAdmissionsEngineConnected:false};
const first=path.join(base,'verification.json');const target=fs.existsSync(first)?path.join(base,'verification-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'):first;fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});process.stdout.write(JSON.stringify(result,null,2)+'\n');
