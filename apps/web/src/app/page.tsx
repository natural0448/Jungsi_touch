import { redirect } from "next/navigation";
import { ROOT_REDIRECT } from "@/lib/routes";

/** 루트 / 는 경로 계약의 redirects 를 따른다(지금은 /admissions/results) */
export default function Page() {
  redirect(ROOT_REDIRECT);
}
