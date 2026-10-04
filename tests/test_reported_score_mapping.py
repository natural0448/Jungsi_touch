"""Invented frequencies only; never an operating mapping or approval."""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from jungsi_touch.exam_pack import ExamPack
from jungsi_touch.percentile import PercentileError
from jungsi_touch.reported_score_mapping import derive_reported_score_pack, METHOD


class ReportedMappingTests(unittest.TestCase):
    def setUp(self):
        self.pack=synthetic_pack()
        self.source=dict(method=METHOD,review_status='verified_formula',academic_year=self.pack.academic_year,
            exam_id=self.pack.exam_id,source_pack_version=self.pack.pack_version,
            source=dict(source_id='SYNTHETIC-formula',sha256='1'*64,url='https://example.invalid/SYNTHETIC'))
    def derive(self,pack=None,source=None,version='SYNTHETIC-derived.v1'):
        return derive_reported_score_pack(pack or self.pack,pack_version=version,formula_source=source or self.source)
    def test_midrank_is_distinct_from_top_tail_and_uses_subject_denominator(self):
        p=self.derive()
        self.assertEqual([p.reported_score('국어',score)['percentile'] for score in (1,5,9)],[6,50,94])
        self.assertEqual(p.reported_score('가상탐구가',5)['percentile'],50)
        self.assertEqual(p.reported_score('국어',9)['grade'],1)
        self.assertNotEqual(str(p.reported_score('국어',9)['percentile']),p.subject_result('국어',9)['top_percent_inclusive'])
        self.assertNotIn('reported_scores',p._data['subjects']['영어'])
    def test_half_up_at_exact_half_uses_integer_arithmetic(self):
        data=deepcopy(self.pack._data);counts=[1,2,2,2,2,2,2,2,5]
        for subject in data['subjects'].values():
            subject['denominator']=20
            for grade,count in zip(subject['grades'],counts):
                grade.update(count=count,published_percent=str((Decimal(count)*5).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)))
            if subject['assessment']=='standard_score':
                subject['published_total']=20;cumulative=0
                for row,count in zip(subject['frequencies'],counts):
                    cumulative+=count;row.update(count=count,cumulative_count=cumulative,male_count=count)
        p=data['participants'];p.update(total=20,inquiry_total=20)
        p['by_subject']={k:20 for k in data['subjects']};p['choice_counts']={'국어':{'가상국어선택':20},'수학':{'가상수학선택':20}}
        p['inquiry_groups']['social_only']=20;p['two_inquiry_derived'].update(social_science=20,total=20)
        p['target_population'].update(count=20,count_lower_bound=20,count_upper_bound=20)
        derived=self.derive(ExamPack(data))
        self.assertEqual(derived.reported_score('국어',9)['percentile'],98)
        self.assertEqual(derived.reported_score('국어',1)['percentile'],13)
    def test_new_version_and_immutable_source_preservation(self):
        before=deepcopy(self.pack._data);p=self.derive()
        self.assertEqual(self.pack._data,before);self.assertEqual(p._data['parent_pack_version'],self.pack.pack_version)
        self.assertEqual(p._data['reported_mapping_derivation']['rounding'],'HALF_UP')
        self.source['source']['sha256']='2'*64
        self.assertEqual(p._data['reported_mapping_derivation']['source']['sha256'],'1'*64)
        with self.assertRaises(PercentileError):self.derive(version=self.pack.pack_version)
    def test_existing_mapping_keeps_source_but_conflict_cannot_be_overwritten(self):
        raw=deepcopy(self.pack._data)
        raw['subjects']['국어']['reported_scores']={'9':dict(percentile=94,grade=1,source_ref='SYNTHETIC:reported')}
        p=self.derive(ExamPack(raw));self.assertEqual(p.reported_score('국어',9)['source_ref'],'SYNTHETIC:reported')
        raw['subjects']['국어']['reported_scores']['9']['percentile']=93
        with self.assertRaises(PercentileError) as caught:self.derive(ExamPack(raw))
        self.assertEqual(caught.exception.code,'reported_mapping_conflict')
    def test_formula_review_and_same_exam_binding_are_required(self):
        for key,value in [('review_status','unverified'),('method','unknown'),('academic_year',2026),
                          ('exam_id','SYNTHETIC-other'),('source_pack_version','SYNTHETIC-other')]:
            source=deepcopy(self.source);source[key]=value
            with self.subTest(key=key),self.assertRaises(PercentileError):self.derive(source=source)
    def test_source_collision_or_invalid_hash_is_rejected(self):
        source=deepcopy(self.source);source['source']['source_id']='SYNTHETIC'
        with self.assertRaises(PercentileError) as caught:self.derive(source=source)
        self.assertEqual(caught.exception.code,'reported_formula_source_conflict')
        source=deepcopy(self.source);source['source']['sha256']='bad'
        with self.assertRaises(PercentileError):self.derive(source=source)


if __name__=='__main__':unittest.main()
