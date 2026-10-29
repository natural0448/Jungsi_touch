/** REVIEW ONLY. Candidate: v2 output with fixed final public-error classification; v1 capture stays internal. */
const PHASES = new Set(["publication", "index_select", "catalog_read", "catalog_operation"]);
const FAILURES = new Set([
  "publication_unapproved",
  "index_unapproved",
  "schema_unapproved",
  "state_unapproved",
  "page_invalid",
  "identity_conflict",
  "operation_scope_unapproved",
  "runtime_role_unverified",
  "transport_unavailable",
  "security_guard_unavailable",
  "unclassified",
]);
const ID = /^[a-f0-9]{32}$/;
type Failure = Readonly<
  {
    event: "current_public_search_failure_v1";
    operation: "offerings.search";
    phase: string;
    failure: string;
  }
>;
type FinalErrorClass =
  | "security_policy_unavailable"
  | "operation_scope_not_approved"
  | "backend_dependency_unavailable"
  | "other";
type Correlated = Readonly<
  Omit<Failure, "event"> & {
    event: "current_public_search_failure_v2";
    request_id: string;
    final_error_class: FinalErrorClass;
  }
>;
export type CorrelationSink = (event: Correlated) => void | PromiseLike<void>;

const DIAGNOSTIC_READ_TIMEOUT_MS = 250;

async function smallErrorBody(response: Response): Promise<unknown> {
  const body = response.clone().body;
  if (!body) return null;
  const reader = body.getReader(), parts: Uint8Array[] = [];
  let size = 0, completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One overall deadline, not a fresh timeout for each chunk.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DIAGNOSTIC_READ_TIMEOUT_MS);
  });
  try {
    for (let i = 0; i < 16; i++) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part === null) return null;
      if (part.done) {
        completed = true;
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of parts) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        try {
          return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return null;
        }
      }
      size += part.value.byteLength;
      if (size > 2048) return null;
      parts.push(part.value);
    }
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!completed) {
      try {
        // A tee branch may wait for its sibling; do not await its cancellation.
        void reader.cancel().catch(() => {});
      } catch { /* Cancellation is best effort and cannot change the response. */ }
    }
    try {
      reader.releaseLock();
    } catch { /* Cleanup must not change the response or emit an event. */ }
  }
}

/** Input events are projected to an allowlisted shape. Each instance must belong to one request. */
export class SearchFailureCorrelation {
  private event?: Failure;
  private finished = false;
  constructor(private readonly sink?: CorrelationSink) {}

  capture = (value: unknown): void => {
    try {
      if (this.finished || this.event || !value || typeof value !== "object") return;
      const d = Object.getOwnPropertyDescriptors(value);
      if (
        Object.keys(d).length !== 4 || !d.event || !("value" in d.event) ||
        !d.operation || !("value" in d.operation) || !d.phase || !("value" in d.phase) ||
        !d.failure || !("value" in d.failure) ||
        d.event.value !== "current_public_search_failure_v1" ||
        d.operation.value !== "offerings.search" || typeof d.phase.value !== "string" ||
        typeof d.failure.value !== "string" || !PHASES.has(d.phase.value) ||
        !FAILURES.has(d.failure.value)
      ) return;
      this.event = Object.freeze({
        event: d.event.value,
        operation: d.operation.value,
        phase: d.phase.value,
        failure: d.failure.value,
      });
    } catch { /* Diagnostic input is never allowed to change business behavior. */ }
  };

  /** Called only with the server's own handler/safeFailure response, never request headers. */
  finish(response: Response | null): void {
    try {
      if (this.finished) return;
      this.finished = true;
      const event = this.event;
      if (!event || !this.sink || !response || response.status !== 503) return;
      const requestId = response.headers.get("X-Request-ID");
      if (!requestId || !ID.test(requestId)) return;
      const sink = this.sink;
      void smallErrorBody(response).then((body) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) return;
        const data = body as { status?: unknown; request_id?: unknown; error?: unknown };
        if (
          data.status !== "error" || data.request_id !== requestId ||
          !data.error || typeof data.error !== "object" || Array.isArray(data.error)
        ) return;
        const code = (data.error as { code?: unknown }).code;
        if (typeof code !== "string" || !/^[a-z][a-z0-9_]{1,79}$/.test(code)) return;
        const finalErrorClass: FinalErrorClass = code === "security_policy_unavailable" ||
            code === "operation_scope_not_approved" ||
            code === "backend_dependency_unavailable"
          ? code
          : "other";
        // The public code is reduced to a fixed enum, never copied from the body.
        const out: Correlated = Object.freeze({
          ...event,
          event: "current_public_search_failure_v2",
          request_id: requestId,
          final_error_class: finalErrorClass,
        });
        try {
          void Promise.resolve(sink(out)).catch(() => {});
        } catch { /* best effort */ }
      }).catch(() => {});
    } catch { /* No observable changes to response/error if diagnostics fail. */ }
  }
}
