import { assert, equal } from "./fixture.ts";
import { SyntheticReferenceBytes } from "./synthetic_school_reference.ts";
import { PinnedSchoolReferenceSource } from "../../supabase/functions/_shared/jungsi/infrastructure/school_reference_source.ts";
import { SchoolReferenceScoringService } from "../../supabase/functions/_shared/jungsi/application/school_reference_scoring.ts";
import {
  ATTENDANCE_AREAS,
  referenceAttendance,
} from "../../supabase/functions/_shared/jungsi/application/reference_attendance.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
async function setup(required: boolean) {
  const b = new SyntheticReferenceBytes();
  if (required) (b.body.domain as NativeObject).required_attendance = [...ATTENDANCE_AREAS];
  await b.seal();
  const source = new PinnedSchoolReferenceSource(b), input = b.input();
  const profile = {
    profile_id: input.profileVersion,
    owner_id: "synthetic-owner",
    confirmed: true,
    created_at: "synthetic",
    scores: { exam_id: input.examId, pack_version: input.packVersion },
  };
  const form: NativeObject = {
    profile_id: profile.profile_id,
    exam_id: input.examId,
    pack_version: input.packVersion,
    ...Object.fromEntries(ATTENDANCE_AREAS.map((k) => [k, true])),
  };
  return { b, input, profile, form, service: new SchoolReferenceScoringService(source) };
}
Deno.test("selected rule requires each explicitly confirmed area for reference only", async () => {
  const f = await setup(true);
  equal(
    (await f.service.calculate(f.b.university.offering, f.input)).reasonCode,
    "reference_attendance_confirmation_required",
  );
  for (const area of ATTENDANCE_AREAS) {
    for (const value of [false, null, undefined]) {
      const form = { ...f.form, [area]: value };
      if (value === undefined) delete form[area];
      const confirmation = referenceAttendance(form, f.profile);
      const result = await f.service.calculate(f.b.university.offering, {
        ...f.input,
        attendanceConfirmation: confirmation,
      });
      equal(result.status, "pending");
      equal(result.reasonCode, "reference_attendance_confirmation_required");
      equal(result.convertedScore, null);
    }
  }
  const claim = referenceAttendance(f.form, f.profile);
  assert(claim && claim.kind === "self_reported");
  equal(
    (await f.service.calculate(f.b.university.offering, {
      ...f.input,
      attendanceConfirmation: claim,
    })).status,
    "reference_calculated",
  );
});
Deno.test("confirmation cannot transfer across profile, exam or selected pack", async () => {
  const f = await setup(true), claim = referenceAttendance(f.form, f.profile);
  assert(claim);
  for (
    const altered of [{ ...claim, profileId: "other" }, { ...claim, examId: "other" }, {
      ...claim,
      packVersion: "other",
    }]
  ) {
    equal(
      (await f.service.calculate(f.b.university.offering, {
        ...f.input,
        attendanceConfirmation: altered,
      })).reasonCode,
      "reference_attendance_confirmation_required",
    );
  }
  equal(referenceAttendance({ ...f.form, profile_id: "other" }, f.profile), null);
  equal(referenceAttendance({ ...f.form, exam_id: "other" }, f.profile), null);
  equal(referenceAttendance({ ...f.form, pack_version: "other" }, f.profile), null);
});
Deno.test("legacy rules without required attendance retain previous behavior", async () => {
  const f = await setup(false);
  equal(
    (await f.service.calculate(f.b.university.offering, f.input)).status,
    "reference_calculated",
  );
});
Deno.test("untrusted or malformed attendance data never enables calculation", async () => {
  const f = await setup(true);
  for (const bad of [{ ...f.form, korean: "true" }, { ...f.form, extra: true }, "true"]) {
    let denied = false;
    try {
      referenceAttendance(bad, f.profile);
    } catch {
      denied = true;
    }
    assert(denied);
  }
  const invalid = new SyntheticReferenceBytes();
  (invalid.body.domain as NativeObject).required_attendance = ["not_an_area"];
  await invalid.seal();
  const result = await new SchoolReferenceScoringService(new PinnedSchoolReferenceSource(invalid))
    .calculate(invalid.university.offering, invalid.input());
  equal(result.status, "pending");
  equal(result.reasonCode, "reference_package_invalid");
});
