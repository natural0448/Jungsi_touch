"""같은 시험 공식 도수에서 성적표 지표를 정확 산출한다.

자체 총점/학교 누백은 입력으로 받지 않는다. 원본 팩을 수정하거나
발행 상태를 승격하지 않고, 명시한 새 버전의 파생 팩을 반환한다.
"""
from copy import deepcopy
from fractions import Fraction

from .exam_pack import ExamPack, _grade
from .percentile import PercentileError

METHOD = 'official_midrank_half_up/v1'


def derive_reported_score_pack(pack, *, pack_version, formula_source):
    """formula_source는 서버가 확인한 산식 원문 출처다.

    sources의 동일 ID/hash 충돌과 기존 성적표 매핑 불일치는 보류한다.
    공식 과목 도수·분모와 등급컷은 ExamPack의 기존 검증을 재사용한다.
    """
    def require(ok, code):
        if not ok: raise PercentileError(code, '성적표 파생 매핑의 출처·버전·공식 도수를 확인하세요.')
    require(isinstance(pack, ExamPack), 'invalid_exam_pack')
    require(isinstance(pack_version, str) and bool(pack_version.strip()) and pack_version != pack.pack_version,
            'derived_pack_version_required')
    require(isinstance(formula_source, dict) and formula_source.get('review_status') == 'verified_formula',
            'reported_formula_unverified')
    require(formula_source.get('method') == METHOD and
            formula_source.get('academic_year') == pack.academic_year and
            formula_source.get('exam_id') == pack.exam_id and
            formula_source.get('source_pack_version') == pack.pack_version,
            'reported_formula_context_mismatch')
    source=deepcopy(formula_source.get('source'))
    require(isinstance(source,dict) and all(isinstance(source.get(k),str) and bool(source[k]) for k in
            ('source_id','sha256','url')), 'reported_formula_source_missing')
    data=deepcopy(pack._data)
    matching=[s for s in data['sources'] if s['source_id']==source['source_id']]
    require(not matching or matching[0]==source, 'reported_formula_source_conflict')
    if not matching: data['sources'].append(source)
    for name,subject in data['subjects'].items():
        if subject['assessment']!='standard_score': continue
        mapping=subject.setdefault('reported_scores',{})
        n=subject['denominator']
        for row in subject['frequencies']:
            score=row['standard_score'];below=n-row['cumulative_count']
            exact=Fraction(100*(2*below+row['count']),2*n)
            percentile=(2*exact.numerator+exact.denominator)//(2*exact.denominator)
            grade=_grade(subject,score)
            prior=mapping.get(str(score),{})
            require(all(k not in prior or prior[k]==v for k,v in
                        [('percentile',percentile),('grade',grade)]), 'reported_mapping_conflict')
            # Keep an already verified mapping and its original source connection.
            item=deepcopy(prior) if prior else {'source_ref':source['source_id']+':midrank'}
            item.setdefault('percentile',percentile);item.setdefault('grade',grade)
            mapping[str(score)]=item
    data.update(pack_version=pack_version,parent_pack_version=pack.pack_version,
        reported_mapping_derivation=dict(method=METHOD,exam_id=pack.exam_id,academic_year=pack.academic_year,
            source_pack_version=pack.pack_version,source=source,rounding='HALF_UP',
            basis='same_exam_official_subject_frequencies_and_grade_boundaries'))
    return ExamPack(data)
