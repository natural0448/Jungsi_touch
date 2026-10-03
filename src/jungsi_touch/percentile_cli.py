"""검증된 총점별 도수 JSON으로 학생의 상위 누적백분위를 계산한다."""
import argparse
import json
from pathlib import Path
import sys

from .percentile import PercentileError, StandardScores, load_distribution_json


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--distribution", required=True, type=Path, help="총점별 도수 분포 JSON")
    parser.add_argument("--academic-year", required=True, type=int)
    parser.add_argument("--scores", required=True, nargs=4, type=int, metavar=("KOREAN", "MATH", "INQUIRY1", "INQUIRY2"))
    parser.add_argument("--tie-policy", choices=("include_equal", "exclude_equal"), default="include_equal")
    parser.add_argument("--allow-unapproved", action="store_true", help="내부 검산에서만 가상/참고 분포 계산 허용")
    args = parser.parse_args(argv)
    try:
        distribution = load_distribution_json(args.distribution.read_text(encoding="utf-8-sig"))
        profile = StandardScores(args.academic_year, *args.scores)
        result = distribution.calculate(profile, tie_policy=args.tie_policy, require_approved=not args.allow_unapproved)
    except PercentileError as exc:
        print(json.dumps({"error": exc.code, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    except (OSError, UnicodeError) as exc:
        print(json.dumps({"error": "distribution_read_error", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())