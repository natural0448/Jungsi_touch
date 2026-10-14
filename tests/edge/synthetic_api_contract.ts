/** Public route structure only; business results in router tests are invented. */
import type { ApiRoutePolicy } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";
export function syntheticApiPolicies(): ApiRoutePolicy[] {
  return [
    {
      "id": "history.search",
      "method": "GET",
      "path": "/api/v1/admission-history",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "recruitment.read",
      "method": "GET",
      "path": "/api/v1/offerings/{offering_id}/recruitment",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "score-profile.create",
      "method": "POST",
      "path": "/api/v1/score-profiles",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "overall.analyze",
      "method": "POST",
      "path": "/api/v1/overall-reports",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "report.read",
      "method": "GET",
      "path": "/api/v1/reports/{report_id}",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": true,
      "confirmed_score_profile": false,
    },
    {
      "id": "offerings.search",
      "method": "GET",
      "path": "/api/v1/offerings/search",
      "member_tiers": [
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "offering.read",
      "method": "GET",
      "path": "/api/v1/offerings/{offering_id}",
      "member_tiers": [
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "university.analyze",
      "method": "POST",
      "path": "/api/v1/reports/{report_id}/university-results",
      "member_tiers": [
        "paid",
      ],
      "report_owner": true,
      "confirmed_score_profile": true,
    },
    {
      "id": "candidates.build",
      "method": "POST",
      "path": "/api/v1/reports/{report_id}/candidates",
      "member_tiers": [
        "paid",
      ],
      "report_owner": true,
      "confirmed_score_profile": true,
    },
    {
      "id": "shortlist.update",
      "method": "PUT",
      "path": "/api/v1/reports/{report_id}/shortlist/{offering_id}",
      "member_tiers": [
        "paid",
      ],
      "report_owner": true,
      "confirmed_score_profile": false,
    },
    {
      "id": "report.export",
      "method": "GET",
      "path": "/api/v1/reports/{report_id}/print",
      "member_tiers": [
        "paid",
      ],
      "report_owner": true,
      "confirmed_score_profile": true,
    },
    {
      "id": "statistics.read",
      "method": "GET",
      "path": "/api/v1/reports/{report_id}/offerings/{offering_id}/live-statistics",
      "member_tiers": [
        "paid",
      ],
      "report_owner": true,
      "confirmed_score_profile": true,
    },
    {
      "id": "session.read",
      "method": "GET",
      "path": "/api/v1/me",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.capabilities",
      "method": "GET",
      "path": "/api/v1/forecast-capabilities",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.list",
      "method": "GET",
      "path": "/api/v1/forecast-drafts",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.create",
      "method": "POST",
      "path": "/api/v1/offerings/{offering_id}/forecast-drafts",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.read",
      "method": "GET",
      "path": "/api/v1/forecast-drafts/{draft_id}",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.adjust",
      "method": "POST",
      "path": "/api/v1/forecast-drafts/{draft_id}/adjustments",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.validate",
      "method": "POST",
      "path": "/api/v1/forecast-drafts/{draft_id}/validations",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.approve",
      "method": "POST",
      "path": "/api/v1/forecast-drafts/{draft_id}/approvals",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.publish",
      "method": "POST",
      "path": "/api/v1/forecast-drafts/{draft_id}/publications",
      "member_tiers": [
        "standard",
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
    {
      "id": "forecast.published.read",
      "method": "GET",
      "path": "/api/v1/offerings/{offering_id}/forecast",
      "member_tiers": [
        "paid",
      ],
      "report_owner": false,
      "confirmed_score_profile": false,
    },
  ];
}
