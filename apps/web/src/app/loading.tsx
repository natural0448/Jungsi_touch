import { LoadingNotice } from "@/components/loading-notice";

/** 페이지별 안내가 없는 화면의 기본 안내 */
export default function Loading() {
  return <LoadingNotice title="화면을 불러오고 있습니다" desc="잠시만 기다려 주세요." />;
}
