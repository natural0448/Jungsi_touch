"""KICE appendix PDF adapter. Read-only sources; exclusive new-version outputs.

This adapter covers the inspected 2027 September layout. A changed future layout
must pass the same checks or get a new adapter; it is never accepted silently.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

def key(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text or ''))

def number(text):
    if not isinstance(text, str) or not re.fullmatch(r'[\d,]+', text.strip()):
        raise ValueError(f'Expected published integer, got {text!r}')
    return int(text.replace(',', ''))

def provenance(path, source_id):
    return {'source_id': source_id, 'file_name': path.name, 'local_path': str(path.resolve()),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'kind': 'official_pdf'}

def extract(path):
    with pdfplumber.open(path) as pdf:
        return [{'page': i+1, 'text': p.extract_text(), 'tables': p.extract_tables()}
                for i,p in enumerate(pdf.pages)]

def parse_participants(pages, exam):
    tables = pages[0]['tables']
    headline = tables[0]
    if key(headline[0][-2]) != f"{exam['academic_year']}학년도":
        raise ValueError('Participant academic year column mismatch')
    # Explicitly bind to the final period column, not the preceding CSAT column.
    period={'september_mock':'9월모의평가','june_mock':'6월모의평가','csat':'수능'}[exam['exam_type']]
    if key(headline[1][-1]) != period:
        raise ValueError('Participant period column is not the requested exam')
    result = {'total':number(headline[-1][-1]), 'by_subject':{}, 'choice_counts':{},
              'inquiry_groups':{}, 'source_ref':'appendix1:pdf-page-1'}
    section = None
    for row in tables[1][3:]:
        section = row[0] or section
        if section in ('국어','수학'):
            if row[1]=='계': result['by_subject'][key(section)]=number(row[-2])
            else:
                labels = row[1].split('\n'); counts = row[-2].split('\n')
                if len(labels)!=len(counts): raise ValueError('Choice row mismatch')
                result['choice_counts'][key(section)]={key(k):number(v) for k,v in zip(labels,counts)}
        elif section in ('영어','한국사'):
            result['by_subject'][key(section)]=number(row[-2])
        elif section=='탐구':
            if row[1]=='계': result['inquiry_total']=number(row[-2])
            else:
                values=list(map(number,row[-2].split('\n')))
                if len(values)!=4: raise ValueError('Inquiry category schema changed')
                result['inquiry_groups']=dict(zip(['social_only','science_only','mixed_social_science','vocational'], values))
        elif section=='제2외국어/한문': result['second_language_total']=number(row[-2])
    for page in pages[1:]:
        for table in page['tables']:
            for row in table[3:]:
                if row[0] and key(row[0])!='응시자수':
                    subject=key(row[0])
                    if subject in result['by_subject']: raise ValueError('Duplicate participant subject')
                    result['by_subject'][subject]=number(row[-2])
    if sum(result['inquiry_groups'].values())!=result['inquiry_total']:
        raise ValueError('Inquiry group total mismatch')
    return result

def parse_grades(pages, source_id, assessment):
    result={}
    for page in pages:
        for table in page['tables']:
            active=[]
            for row in table:
                if row[0]=='등급':
                    active=[]
                    for col in range(1,len(row),3):
                        if row[col]:
                            name=row[col]; sid=key(name)
                            if sid in result: raise ValueError(f'Duplicate grade subject: {sid}')
                            result[sid]={'label':name,'assessment':assessment,'grades':[]}
                            active.append((col,sid))
                elif row[0] in [str(g) for g in range(1,10)]:
                    grade=int(row[0])
                    for col,sid in active:
                        raw=key(row[col]); bound=number(raw.replace('미만',''))
                        if (grade==9) != raw.endswith('미만'): raise ValueError('Grade 9 boundary changed')
                        result[sid]['grades'].append({'grade':grade,'lower_score':None if grade==9 else bound,
                            'upper_exclusive':bound if grade==9 else None,
                            'count':number(row[col+1]),'published_percent':row[col+2],
                            'source_ref':f'{source_id}:pdf-page-{page["page"]}'})
    return result

def parse_frequencies(pages):
    result={}
    for page in pages:
        for table in page['tables']:
            if len(table[0])%5: raise ValueError('Frequency table width changed')
            for col in range(0,len(table[0]),5):
                sid=key(table[0][col])
                if not sid: raise ValueError('Missing frequency subject heading')
                item=result.setdefault(sid,{'frequencies':[],'published_total':None})
                for row in table[2:]:
                    value=row[col]
                    if value in (None,''): continue
                    if value=='계':
                        if item['published_total'] is not None: raise ValueError('Duplicate frequency total')
                        item['published_total']=number(row[col+3]); continue
                    score=number(value)
                    item['frequencies'].append({'standard_score':score,'male_count':number(row[col+1]),
                        'female_count':number(row[col+2]),'count':number(row[col+3]),
                        'cumulative_count':number(row[col+4]),'source_ref':f'appendix4:pdf-page-{page["page"]}'})
    return result

SOCIAL=set(map(key,['생활과 윤리','윤리와 사상','한국지리','세계지리','동아시아사','세계사','경제','정치와 법','사회·문화']))
SCIENCE=set(map(key,['물리학Ⅰ','화학Ⅰ','생명과학Ⅰ','지구과학Ⅰ','물리학Ⅱ','화학Ⅱ','생명과학Ⅱ','지구과학Ⅱ']))
VOCATIONAL=set(map(key,['성공적인 직업생활','농업 기초 기술','공업 일반','상업 경제','수산·해운 산업 기초','인간 발달']))

def build(paths, exam, pack_version):
    pages={n:extract(p) for n,p in paths.items()}
    # Appendix headings omit exam identity; binding rests on the provided set and filenames.
    for n,path in paths.items():
        if str(exam['academic_year']) not in path.name or ('9월' not in path.name if exam['exam_type']=='september_mock' else False):
            raise ValueError('Source filename does not match the requested exam')
    participants=parse_participants(pages[1],exam)
    subjects=parse_grades(pages[2],'appendix2','standard_score')
    absolute=parse_grades(pages[3],'appendix3','absolute_grade')
    if set(subjects)&set(absolute): raise ValueError('Subject assessment conflict')
    subjects.update(absolute)
    frequencies=parse_frequencies(pages[4])
    if set(frequencies)!={s for s,v in subjects.items() if v['assessment']=='standard_score'}:
        raise ValueError('Grade and distribution subject sets differ')
    for sid,item in subjects.items():
        item['denominator']=participants['by_subject'][sid]
        item['category']='social' if sid in SOCIAL else 'science' if sid in SCIENCE else 'vocational' if sid in VOCATIONAL else 'korean' if sid=='국어' else 'math' if sid=='수학' else 'absolute'
        if sid in frequencies:item.update(frequencies[sid])
    if set(subjects)!=set(participants['by_subject']): raise ValueError('Participant coverage differs')
    sums={cat:sum(v['denominator'] for v in subjects.values() if v['category']==cat) for cat in ['social','science','vocational']}
    # Max two subjects in each inquiry domain. These are derived counts, not the
    # intersection with Korean and Math. They must never become the total denominator.
    satam_unique=sum(participants['inquiry_groups'][g] for g in ['social_only','science_only','mixed_social_science'])
    two_satam=sums['social']+sums['science']-satam_unique
    two_job=sums['vocational']-participants['inquiry_groups']['vocational']
    n_two=two_satam+two_job
    n=participants['total'];nk=participants['by_subject']['국어'];nm=participants['by_subject']['수학']
    participants['two_inquiry_derived']={'social_science':two_satam,'vocational':two_job,'total':n_two,
        'method':'과목별 응시 인원 합 - 해당 탐구 영역 응시 인원. 각 영역에서 1개 또는 2개 응시 조건.'}
    participants['target_population']={'population_id':'all_examinees_with_korean_math_two_inquiry_scores',
        'count':None,'status':'joint_participation_not_published',
        'count_lower_bound':max(0,nk+nm+n_two-2*n),'count_upper_bound':min(nk,nm,n_two),
        'bounds_meaning':'영역 응시 집합의 수학적 교집합 범위. 추정 인원/신뢰구간이 아님.'}
    pack={'format':'jungsi.exam-pack/v1','exam':exam,'pack_version':pack_version,
        'sources':[provenance(paths[n],f'appendix{n}') for n in sorted(paths)],
        'participants':participants,'subjects':subjects,
        'total_curve_status':'calibration_required',
        'notes':['도수는 남자+여자가 아닌 공식 계를 사용한다. 성별 미표기 응시자가 포함된다.',
                 '주변분포만으로 국수탐2 결합 총점 분포는 정해지지 않는다.',
                 '공식 과목 분포의 검증과 자체 총점 곡선 승인은 별도다.']}
    from jungsi_touch.exam_pack import ExamPack
    validation=ExamPack(pack).validation_summary()
    for src in pack['sources']:
        if hashlib.sha256(Path(src['local_path']).read_bytes()).hexdigest()!=src['sha256']:
            raise ValueError('Source changed during extraction')
    return pack,validation,pages

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in range(1,5):p.add_argument(f'--appendix{n}',type=Path,required=True)
    p.add_argument('--exam-id',required=True);p.add_argument('--academic-year',type=int,required=True)
    p.add_argument('--exam-type',choices=['september_mock','june_mock','csat'],required=True)
    p.add_argument('--label',required=True);p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--pack-version',required=True)
    args=p.parse_args(); paths={n:getattr(args,f'appendix{n}') for n in range(1,5)}
    outputs=[args.output_dir/name for name in ['exam_pack.json','import_validation.json','source_tables.json']]
    if any(x.exists() for x in outputs):raise FileExistsError('Choose a new output version; existing files are preserved')
    exam={'exam_id':args.exam_id,'academic_year':args.academic_year,'exam_type':args.exam_type,
          'label':args.label,'exam_date':None,'exam_date_status':'not_bound_from_these_appendices'}
    pack,validation,pages=build(paths,exam,args.pack_version)
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for path,value in zip(outputs,[pack,validation,pages]):
        with path.open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2)
    print(json.dumps(validation,ensure_ascii=False))

if __name__=='__main__':main()
