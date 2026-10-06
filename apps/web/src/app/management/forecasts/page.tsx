import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionNotice } from "@/components/connection-notice";
import { LockIcon } from "@/components/icons";
import { PageHead } from "@/components/page-head";
import { AccessDenied, ConnectionError, getCaller, source } from "@/lib/api";
import type { ForecastCapabilitiesDto, ForecastDraftDto, ForecastListDto, ForecastReplacement, ForecastResultDto, ForecastStatus, ForecastTarget } from "@/lib/dto";
import { seoulDateTime } from "@/lib/format";
import { loginHref } from "@/lib/links";
import { MANAGEMENT_FORECASTS } from "@/lib/routes";
import { ActionForm } from "./action-form";
import "./forecasts.css";

export const metadata: Metadata = { title: MANAGEMENT_FORECASTS.label };

const STATUS: Record<ForecastStatus, string> = { draft: "작성 중", validated: "검증됨", approved: "승인됨", published: "발행됨" };
const FLOW: ForecastStatus[] = ["draft", "validated", "approved", "published"];

/**
 * 학과별 예상 기준 관리(1.7.0 ADMIN-FORECAST, DEV-007). 소비자 4개 탭과 분리된 화면이다.
 * 서버의 관리 권한(editor·approver)과 허용 학교로만 열린다. 유료 회원이라는 이유로 열리지 않는다.
 * 숫자를 화면에서 계산하지 않는다. 생성·조정·검증·승인·발행은 모두 서버가 처리하고 거절은 그대로 보인다.
 */
export default async function Page({ searchParams }: PageProps<"/management/forecasts">) {
  const route = MANAGEMENT_FORECASTS;
  const head = <PageHead kicker="관리" title={route.label} desc="모집행마다 올해 예상 70% 기준선과 판단용 합격권을 만들고, 검증·승인을 거쳐 발행합니다. 발행된 값만 3·4페이지 근거로 보입니다." />;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 128) || undefined;
  const uni = one(sp.university);
  const draftId = one(sp.draft);

  const caller = await getCaller();
  const src = source();
  let caps: ForecastCapabilitiesDto | null = null;
  let list: ForecastListDto = { format: "jungsi.forecast-list/v1", items: [] };
  let draft: ForecastDraftDto | null = null;
  let blocked: "login" | "denied" | ConnectionError | null = null;
  try {
    if (!(await src.getSession(caller))) blocked = "login";
    else {
      caps = await src.readForecastCapabilities(caller);
      if (caps.capabilities.length === 0) blocked = "denied";
      else {
        const filter = uni && caps.university_ids.includes(uni) ? uni : undefined;
        [list, draft] = await Promise.all([src.listForecastDrafts(caller, filter), draftId ? src.readForecastDraft(caller, draftId) : null]);
      }
    }
  } catch (e) {
    if (e instanceof ConnectionError) blocked = e;
    else if (e instanceof AccessDenied) blocked = e.status === 401 ? "login" : "denied";
    else throw e;
  }
  if (blocked instanceof ConnectionError) return <>{head}<ConnectionNotice e={blocked} /></>;
  if (blocked || !caps) return <>{head}<Gate login={blocked === "login"} /></>;

  const editor = caps.capabilities.includes("editor");
  const approver = caps.capabilities.includes("approver");
  const key = () => crypto.randomUUID();

  return (
    <>
      {head}
      <div className="wrap pg-body mg">
        <section className="mg-caps" aria-label="내 관리 권한">
          <span className="lab">내 권한</span>
          {caps.capabilities.map((c) => <span key={c} className="cap">{c === "editor" ? "작성·조정·검증" : "승인·발행"}</span>)}
          <span className="lab">허용 학교</span>
          <span className="unis">
            <Link href={route.path} className={uni ? undefined : "on"}>전체</Link>
            {caps.university_ids.map((u) => (
              <Link key={u} href={`${route.path}?university=${encodeURIComponent(u)}`} className={uni === u ? "on" : undefined}>{u}</Link>
            ))}
          </span>
        </section>

        <div className="mg-grid">
          <section className="mg-list" aria-labelledby="mg-list-h">
            <h2 id="mg-list-h">draft <span className="num">{list.items.length}</span></h2>
            {list.items.length === 0 ? (
              <p className="mg-empty">아직 만든 draft 가 없습니다.</p>
            ) : (
              <ul>
                {list.items.map((d) => (
                  <li key={d.draft_id} className={d.draft_id === draft?.draft_id ? "on" : undefined}>
                    <Link href={`${route.path}?draft=${encodeURIComponent(d.draft_id)}${uni ? `&university=${encodeURIComponent(uni)}` : ""}`}>
                      <b>{d.context.department} · {d.context.group}군</b>
                      <small>
                        {d.offering_id} · r{d.revision}
                      </small>
                      <span className={`st-${d.status}`}>{STATUS[d.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {editor && (
              <details className="mg-create" open={list.items.length === 0}>
                <summary>새 draft 만들기</summary>
                <p className="hint">서버에 승인된 입력 자료와 정책의 ID·버전을 적습니다. 숫자는 서버가 그 자료로 계산합니다.</p>
                <ActionForm hidden={{ op: "create", key: key() }} submit="draft 만들기">
                  <label>모집행 ID<input name="offering_id" required maxLength={128} placeholder="예: syn-g1-2027" /></label>
                  <label>입력 자료 ID<input name="input_id" required maxLength={128} /></label>
                  <label>입력 자료 버전<input name="input_version" required maxLength={128} /></label>
                  <label>정책 ID<input name="policy_id" required maxLength={128} /></label>
                  <label>정책 버전<input name="policy_version" required maxLength={128} /></label>
                </ActionForm>
              </details>
            )}
          </section>

          <section className="mg-detail" aria-label="draft 상세">
            {!draftId ? (
              <p className="mg-empty">왼쪽에서 draft 를 고르세요.</p>
            ) : !draft ? (
              <p className="mg-empty">draft 를 찾을 수 없습니다. 허용 범위 밖의 draft 도 같은 안내가 나옵니다.</p>
            ) : (
              <DraftView d={draft} editor={editor} approver={approver} newKey={key} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DraftView({ d, editor, approver, newKey }: { d: ForecastDraftDto; editor: boolean; approver: boolean; newKey: () => string }) {
  // 쓰기마다 revision 이 오른다. 다음 요청은 지금 revision 과 생성 때의 base_result_hash 로 묶는다
  const refFields = { draft_id: d.draft_id, expected_revision: String(d.revision), base_result_hash: d.base_result_hash, policy_version: d.policy_version };
  const c = d.context;
  const adjusted = d.adjustments.length > 0;
  return (
    <>
      <header className="mg-dh">
        <div>
          <h2>
            {c.department} <small>{[c.track, `${c.group}군`, c.campus].filter(Boolean).join(" · ")}</small>
          </h2>
          <p>
            {c.university_id} · {d.offering_id} · {c.academic_year}학년도
          </p>
          <p>
            {d.draft_id} · revision <b className="num">{d.revision}</b> · 정책 {d.policy_version} · 단위 {c.unit}
          </p>
        </div>
        <ol className="mg-flow" aria-label="진행 단계">
          {FLOW.map((s) => (
            <li key={s} className={FLOW.indexOf(s) <= FLOW.indexOf(d.status) ? "done" : undefined} aria-current={s === d.status ? "step" : undefined}>{STATUS[s]}</li>
          ))}
        </ol>
      </header>
      <p className="mg-hash">
        기본 산출 해시 <code>{d.base_result_hash}</code> · 만든 때 {seoulDateTime(d.created_at)} · 바뀐 때 {seoulDateTime(d.updated_at)}
      </p>

      <div className="mg-values">
        <ValuesCol title="기본 산출" r={d.base_result} />
        <ValuesCol title="채택값" r={d.result} note={adjusted ? "상담 조정 반영" : "기본과 같음"} />
      </div>

      {adjusted && (
        <section className="mg-sec">
          <h3>조정 이력</h3>
          <ul className="mg-log">
            {d.adjustments.map((a, i) => (
              <li key={i}>
                <span className="num">{seoulDateTime(a.at)}</span> <b>{TARGET[a.target]}</b> → {replacementText(a.replacement)} · {a.reason}
                <small> · 근거 {a.evidence_refs.join(", ")} · {a.actor}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mg-sec mg-receipts">
        <div>
          <h3>검증</h3>
          {d.validation ? (
            <p>
              {d.validation.status === "passed" ? "통과" : <b>실패 · {d.validation.reason_code}</b>} · r{d.validation.validated_revision}
              <br />
              영수증 <code>{d.validation.receipt_hash}</code>
            </p>
          ) : (
            <p className="na">아직 검증하지 않았습니다.</p>
          )}
        </div>
        <div>
          <h3>승인</h3>
          {d.approval ? (
            <p>
              r{d.approval.approved_revision} · {d.approval.reason}
              <br />
              영수증 <code>{d.approval.approval_hash}</code>
            </p>
          ) : (
            <p className="na">아직 승인하지 않았습니다.</p>
          )}
        </div>
      </section>

      <section className="mg-sec mg-actions">
        <h3>작업</h3>
        {d.status === "published" && <p className="na">발행된 draft 입니다. 바꾸려면 새 draft 를 만드세요.</p>}
        {editor && d.status !== "published" && (
          <details>
            <summary>값 조정(새 revision)</summary>
            <p className="hint">조정하면 이전 검증·승인은 이어지지 않습니다. 기본 산출과 이전 값은 서버에 남습니다. 단위는 {c.unit}로 보냅니다.</p>
            <ActionForm hidden={{ ...refFields, op: "adjust", key: newKey(), unit: c.unit }} submit="조정 저장">
              <label>
                대상
                <select name="target" defaultValue="forecast_70">
                  <option value="forecast_70">올해 70% 예상선</option>
                  <option value="acceptance_range">판단용 합격권</option>
                  <option value="category_ranges">도전·핵심·여유 구간</option>
                </select>
              </label>
              <label>70% 예상선 값<input name="value" inputMode="decimal" placeholder={d.result.forecast_70.value ?? ""} /></label>
              <div className="pair">
                <label>합격권 아래<input name="lower" inputMode="decimal" placeholder={d.result.acceptance_range.lower ?? ""} /></label>
                <label>합격권 위<input name="upper" inputMode="decimal" placeholder={d.result.acceptance_range.upper ?? ""} /></label>
              </div>
              <label>
                구간 목록(JSON)
                <textarea name="ranges" rows={3} placeholder={JSON.stringify(d.result.category_ranges)} />
              </label>
              <label>조정 이유<textarea name="reason" rows={2} required /></label>
              <label>근거 ID(쉼표로 구분, 서버에 승인된 것만)<input name="evidence_refs" required /></label>
            </ActionForm>
          </details>
        )}
        {editor && d.status === "draft" && <ActionForm hidden={{ ...refFields, op: "validate", key: newKey() }} submit="이 revision 검증" />}
        {approver && d.status === "validated" && d.validation && (
          <ActionForm hidden={{ ...refFields, op: "approve", key: newKey(), receipt: d.validation.receipt_hash }} submit="승인">
            <label>승인 이유<textarea name="reason" rows={2} required /></label>
          </ActionForm>
        )}
        {approver && d.status === "approved" && d.approval && (
          <ActionForm hidden={{ ...refFields, op: "publish", key: newKey(), receipt: d.approval.approval_hash }} submit="발행" />
        )}
        {!editor && !approver && <p className="na">이 draft 에 할 수 있는 작업이 없습니다.</p>}
      </section>

      {d.audit_events.length > 0 && (
        <section className="mg-sec">
          <h3>기록</h3>
          <ul className="mg-log">
            {d.audit_events.map((e, i) => (
              <li key={i}>
                <span className="num">{seoulDateTime(e.at)}</span> {ACTION[e.action] ?? e.action}
                <small> · {e.actor}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const CAT: Record<string, string> = { challenge: "도전", core: "핵심 검토", room: "여유 후보", outside: "추천 범위 밖" };
const TARGET: Record<ForecastTarget, string> = { forecast_70: "70% 예상선", acceptance_range: "판단용 합격권", category_ranges: "지원 구간" };
const ACTION: Record<string, string> = {
  "forecast.create": "만듦",
  "forecast.adjust": "조정",
  "forecast.validate": "검증",
  "forecast.approve": "승인",
  "forecast.publish": "발행",
};

function replacementText(v: ForecastReplacement) {
  if ("value" in v) return `${v.value}${v.unit}`;
  if ("lower" in v) return `${v.lower}~${v.upper}${v.unit}`;
  return v.ranges.map((r) => `${CAT[r.category] ?? r.category} [${r.lower}, ${r.upper})`).join(" · ");
}

function ValuesCol({ title, r, note }: { title: string; r: ForecastResultDto; note?: string }) {
  const f = r.forecast_70;
  const a = r.acceptance_range;
  return (
    <div className="mg-col">
      <h3>
        {title}
        {note && <small> · {note}</small>}
      </h3>
      <dl>
        <div>
          <dt>70% 예상선</dt>
          <dd className="num">{f.status === "ready" ? `${f.value}${f.unit ?? ""}` : <span className="na">보류 · {f.reason_code}</span>}</dd>
        </div>
        <div>
          <dt>판단용 합격권</dt>
          <dd className="num">{a.status === "ready" ? `${a.lower}~${a.upper}${a.unit ?? ""}` : <span className="na">보류 · {a.reason_code}</span>}</dd>
        </div>
        {r.category_ranges.map((c) => (
          <div key={c.category}>
            <dt>{CAT[c.category] ?? c.category}</dt>
            <dd className="num">[{c.lower}, {c.upper})</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Gate({ login = false }: { login?: boolean }) {
  return (
    <div className="wrap pg-body">
      <section className="gate" aria-labelledby="mg-gate">
        <div className="ic"><LockIcon size={20} /></div>
        <h2 id="mg-gate">{login ? "로그인하면 관리 화면을 열 수 있습니다" : "관리 권한이 없습니다"}</h2>
        <p>{login ? "에듀터치 계정으로 로그인하세요." : "이 화면은 서버에 등록된 관리 권한(작성·승인)과 허용 학교가 있는 사람만 씁니다. 이용권과는 관계가 없습니다."}</p>
        {login && <div className="acts"><a className="btn p" href={loginHref(MANAGEMENT_FORECASTS.path)}>에듀터치 로그인</a></div>}
      </section>
    </div>
  );
}
