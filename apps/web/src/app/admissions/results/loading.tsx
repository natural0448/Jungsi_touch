import { LoadingNotice } from "@/components/loading-notice";

export default function Loading() {
  return <LoadingNotice title="대학 발표 입시결과를 불러오고 있습니다" desc="대학이 발표한 지난 3개 학년도 결과와 올해 모집 정보를 확인하는 중입니다. 20초 정도 걸릴 수 있습니다." />;
}
