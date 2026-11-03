import {test} from "node:test";
import assert from "node:assert/strict";
import {historyConditions,historyConditionsChanged} from "../apps/web/src/lib/p1-shape.ts";
test("각 학년도의 캠퍼스·전형·군을 섞지 않고 그대로 표시한다",()=>{assert.equal(historyConditions({c:"가상 이전 캠퍼스",t:"가상 이전 전형",g:"나"}),"캠퍼스 가상 이전 캠퍼스 · 전형 가상 이전 전형 · 모집군 나");assert.equal(historyConditions({c:null,t:"수능 전형",g:"다"}),"전형 수능 전형 · 모집군 다")});
test("미확인 조건을 지어내지 않는다",()=>assert.equal(historyConditions({c:null,t:null,g:null}),""));

test("조건 차이는 확인된 바로 전 학년도와 비교한다",()=>{const a={c:"본교",t:"일반",g:"가"},b={...a,g:"나"},u={c:null,t:null,g:null};assert.equal(historyConditionsChanged(a,[]),false);assert.equal(historyConditionsChanged(a,[a]),false);assert.equal(historyConditionsChanged(b,[a]),true);assert.equal(historyConditionsChanged(b,[a,b]),false);assert.equal(historyConditionsChanged(b,[a,u]),false)});
