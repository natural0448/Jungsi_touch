import { BookLoading } from "@/components/book-loading";

// 경로 전환 직후(회원 이름을 읽기 전) 대기 화면. 본문 대기는 page.tsx 가 이름을 넣어 다시 그린다
export default function Loading() {
  return <BookLoading name="회원" kind="favorable" />;
}
