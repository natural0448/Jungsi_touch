"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=__dirname;
const data=JSON.parse(fs.readFileSync(path.join(base,'handoff/candidate.mock.json'),'utf8'));
const contract=JSON.parse(fs.readFileSync(path.join(base,'handoff/candidate-contract.json'),'utf8'));
const store=new Map();
const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
const checks=[];
function check(name,fn){fn();checks.push({name,status:'passed'});}
function boot(file,session=storage){
 const html=fs.readFileSync(path.join(base,'preview',file),'utf8');
 const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
 const roles=[...html.matchAll(/data-role="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(roles.map(role=>[role,{textContent:'',innerHTML:'',hidden:false,value:role==='tier'?'paid':'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(name,fn){this.events[name]=fn;}}]));
 nodes.get('mock-data').textContent=scripts.find(s=>s[1].includes('application/json'))[2];
 assert.deepEqual(JSON.parse(nodes.get('mock-data').textContent),data);
 const events={};
 const root={querySelector(selector){const role=/^\[data-role="([^"]+)"\]$/.exec(selector);if(role){assert.ok(nodes.has(role[1]),'Missing DOM role '+role[1]+' in '+file);return nodes.get(role[1]);}return null;},addEventListener(name,fn){events[name]=fn;},contains(){return true;}};
 const context=vm.createContext({sessionStorage:session,document:{getElementById(id){assert.equal(id,'jt-candidates-v09');return root;}}});
 vm.runInContext(scripts.find(s=>s[1].includes('model-script'))[2],context);
 vm.runInContext(scripts.find(s=>s[1].includes('ui-script'))[2],context);
 const M=context.CandidateModel,model=M.create(data);
 return {html,nodes,M,model,content:role=>nodes.get(role).innerHTML,
 click(action,id,filter){events.click({target:{closest(){return {dataset:{action,id,filter}};}}});},
 change(role,value,eventName='change'){nodes.get(role).value=value;nodes.get(role).events[eventName]();}};
}
const catalog=boot('index.html'),fav=boot('favorable.html');
const M=catalog.M,model=catalog.model;
const rowIds=(page,role)=>[...page.content(role).matchAll(/data-offering-id="([^"]+)"/g)].map(m=>m[1]);
check('3페이지 전체 보기와 4페이지 추천이 독립 HTML로 분리된다',()=>{
 assert.ok(catalog.html.includes('<h1>전체 대학·학과 가능성 보기</h1>'));
 assert.ok(fav.html.includes('<h1>내 성적에 유리한 대학 찾기</h1>'));
 assert.ok(catalog.nodes.has('catalog-results'));assert.ok(!catalog.nodes.has('school-list'));
 assert.ok(fav.nodes.has('school-list'));assert.ok(!fav.nodes.has('catalog-results'));
 for(const p of [catalog,fav]){assert.ok(!p.nodes.has('views'));assert.ok(p.html.includes('href="./index.html"'));assert.ok(p.html.includes('href="./favorable.html"'));}
 assert.equal(contract.page_routing.combined_page_tabs,false);
});
check('전체 조회는 추천 밖 대학을 포함한 가상 6개 대학 17개 모집단위를 표시한다',()=>{
 assert.equal(model.browse().length,6);assert.equal(model.browse().reduce((n,e)=>n+e.offerings.length,0),17);
 assert.ok(model.browse().some(e=>e.school.id==='f'));
 assert.ok(!M.positive.flatMap(b=>Array.from(model.schoolsFor(b))).some(s=>s.id==='f'));
 assert.ok(catalog.content('catalog-meta').includes('6개 대학 · 17개 모집단위'));
});
check('학교·학과 검색과 모집군·지역 필터는 같은 모집행에 적용된다',()=>{
 assert.deepEqual(Array.from(model.browse({query:'  가온   경제  '})[0].offerings,o=>o.id),['a02']);
 assert.equal(model.browse({query:'가온 경제',group:'나군'}).length,0);
 assert.deepEqual(Array.from(model.browse({query:'경영학과',group:'나군'}).flatMap(e=>e.offerings),o=>o.id),['f01']);
 assert.equal(model.browse({query:'경영학과',group:'나군',region:'경기'}).length,0);
 catalog.change('catalog-search','가온 경제','input');
 assert.deepEqual(rowIds(catalog,'catalog-results'),['a02']);
 assert.ok(catalog.content('catalog-results').includes('id="detail-catalog-a" >'));
 catalog.change('catalog-group','나군');assert.ok(catalog.content('catalog-results').includes('검색 조건에 맞는 모집단위가 없습니다.'));
 assert.ok(!catalog.content('catalog-results').includes('지원 불가'));
 catalog.click('reset-catalog');assert.equal(rowIds(catalog,'catalog-results').length,17);
});
check('학과 검색에서 같은 대학 전체 모집단위로 확장할 수 있다',()=>{
 catalog.change('catalog-search','가온 경제','input');catalog.click('browse-school','a');
 assert.deepEqual(rowIds(catalog,'catalog-results'),['a01','a02','a03','a04']);
 assert.equal(catalog.nodes.get('catalog-search').value,'예시가온대학교');
 catalog.click('reset-catalog');
});
check('추천 범위 밖·미확인·지원 조건 미충족을 구분하며 양성 추천으로 계산하지 않는다',()=>{
 assert.equal(M.category(model.offerings.get('f01')),'outside');assert.equal(M.category(model.offerings.get('f02')),'ineligible');assert.equal(M.category(model.offerings.get('f03')),'pending');
 for(const id of ['f01','f02','f03','a04','e01'])assert.equal(model.selectable(id),false);
 catalog.change('catalog-judgment','outside');assert.deepEqual(rowIds(catalog,'catalog-results'),['f01']);
 catalog.change('catalog-judgment','ineligible');assert.deepEqual(rowIds(catalog,'catalog-results'),['f02']);
 catalog.click('reset-catalog');
});
check('실기 반영 또는 서비스 제외 행은 전체 보기·선택에서도 제외된다',()=>{
 const copy=JSON.parse(JSON.stringify(data));copy.offerings[0].serviceScope.practicalExam=true;copy.offerings[1].serviceScope.included=false;
 const scoped=M.create(copy);assert.equal(scoped.browse().reduce((n,e)=>n+e.offerings.length,0),15);
 assert.equal(scoped.selectable('a01'),false);assert.equal(scoped.selectable('a02'),false);
});
check('4페이지 세 학교 묶음 모두 학과별로 서로 다른 추천 결과를 유지한다',()=>{
 for(const [bucket,id] of [['challenge','b'],['core','a'],['room','c']]){
  fav.click('bucket',bucket);fav.click('expand',id);
  assert.ok(fav.content('school-list').includes('id="detail-recommended-'+id+'" >'));
  for(const category of ['challenge','core','room','pending']){
   fav.click('filter',id,category);
   const expected=Array.from(model.rows(model.schools.get(id)).filter(o=>M.category(o)===category),o=>o.id);
   assert.deepEqual(rowIds(fav,'school-list'),expected);
  }
  fav.click('filter',id,'all');assert.equal(rowIds(fav,'school-list').length,4);
 }
 assert.ok(fav.html.includes('grid-template-columns:minmax(0,2fr) minmax(0,1fr)'));
});
check('4페이지 학과별 환산점수와 와일드카드 선택 동기화를 유지한다',()=>{
 fav.click('bucket','challenge');fav.click('filter','b','all');
 assert.ok(fav.content('school-list').includes('930.50'));assert.ok(fav.content('school-list').includes('919.70'));
 fav.click('select','b04');assert.equal(fav.nodes.get('selected-count').textContent,'1');
 for(const role of ['school-list','wildcard-list'])assert.ok(fav.content(role).includes('data-action="select" data-id="b04" aria-pressed="true"'));
});
check('3·4페이지 이동 시 선택 ID를 공유하고 중복 저장하지 않는다',()=>{
 const next3=boot('index.html');assert.equal(next3.nodes.get('selected-count').textContent,'1');
 next3.click('select','a02');assert.equal(next3.nodes.get('selected-count').textContent,'2');
 const next4=boot('favorable.html');assert.equal(next4.nodes.get('selected-count').textContent,'2');
 next4.click('select','b04');assert.equal(next4.nodes.get('selected-count').textContent,'1');
 const back3=boot('index.html');back3.click('shortlist');
 assert.ok(back3.content('selected-list').includes('data-selected-id="a02"'));
 assert.ok(!back3.content('selected-list').includes('data-selected-id="b04"'));
 const saved=JSON.parse([...store.values()][0]);assert.deepEqual(Object.keys(saved).sort(),['selected','synthetic','tier']);assert.deepEqual(saved.selected,['a02']);
});
check('무료 표시 상태도 3·4페이지에 이어지며 개인별 결과·선택을 숨긴다',()=>{
 const p3=boot('index.html');p3.change('tier','standard');
 assert.equal(p3.content('catalog-results'),'');assert.equal(p3.content('catalog-meta'),'');assert.equal(p3.content('selected-list'),'');
 const p4=boot('favorable.html');assert.equal(p4.nodes.get('tier').value,'standard');
 for(const role of ['school-list','wildcard-list','selected-list'])assert.equal(p4.content(role),'');
 p4.click('select','a03');assert.equal(p4.nodes.get('selected-count').textContent,'0');
 p4.change('tier','paid');assert.equal(p4.nodes.get('selected-count').textContent,'1');
});
check('임시 저장 차단·깨진 저장 상태에서도 화면을 표시한다',()=>{
 const blocked={getItem(){throw new Error('Blocked');},setItem(){throw new Error('Blocked');}};
 const p3=boot('index.html',blocked);p3.click('select','a02');assert.equal(p3.nodes.get('selected-count').textContent,'1');assert.ok(p3.nodes.get('selection-note').textContent.includes('현재 화면에서만'));
 const bad={getItem(){return JSON.stringify({synthetic:true,tier:'paid',selected:['a02','a02','f02','unknown']});},setItem(){}};
 const p4=boot('favorable.html',bad);assert.equal(p4.nodes.get('selected-count').textContent,'1');
});
check('계약·가상 자료·범위·유료 정책을 일치시킨다',()=>{
 assert.equal(contract.version,'0.9');assert.equal(contract.schema_version,'0.9');assert.equal(data.synthetic,true);
 assert.equal(contract.entitlements.standard.all_offerings_personal_assessment,false);
 assert.equal(contract.all_offerings_catalog.viewing_or_searching_emits_recommendation_event,false);
 assert.equal(contract.all_offerings_catalog.demo_scope.national_coverage_verified,false);
 assert.equal(contract.page_routing.pages[2].page,3);assert.equal(contract.page_routing.pages[3].page,4);
 for(const p of [catalog,fav]){assert.ok(!p.html.includes('진학사 등록용'));assert.ok(!/fetch\s*\(|XMLHttpRequest|WebSocket/.test(p.html));}
});
const results={verifiedAt:new Date().toISOString(),scope:'separate page 3 catalog and page 4 recommendations; Node VM DOM event harness',passed:checks.length,checks,browserVisualQa:'not_completed',productionAuthorizationVerified:false,productionAdmissionsJudgmentVerified:false,realPage2ReportConnected:false};
const first=path.join(base,'verification.json');const target=fs.existsSync(first)?path.join(base,'verification-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'):first;
fs.writeFileSync(target,JSON.stringify(results,null,2)+'\n',{encoding:'utf8',flag:'wx'});
process.stdout.write(JSON.stringify(results,null,2)+'\n');
