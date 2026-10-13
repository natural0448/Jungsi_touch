import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
    에듀터치 도메인의 /jeongsi/* 를 이 앱이 받는다(service_spec technology 제안, PR #5).
    같은 도메인이어야 에듀터치 로그인 세션을 같이 쓴다. 바꾸면 Workers Routes 도 같이 바꾼다.
  */
  basePath: "/jeongsi",
  turbopack: { root: appRoot },
  /*
    서버 액션(성적 저장·담기·관리 작업)의 Origin 허용 목록.
    에듀터치 본체가 /jeongsi/* 를 이 워커로 대신 넘기는 동안(JEONGSI_PREVIEW_ORIGIN)에는
    브라우저 Origin(본체 주소)과 이 앱의 Host(워커 주소)가 달라 Next 가 POST 를 거부한다 → 500.
    에듀터치 정식 도메인(edutouch.co.kr)이 빠져 있어 저장이 500 으로 실패했다(2026-10-13 추가).
    실도메인으로 Workers Routes 를 붙이면 본체·워커 주소 항목은 지운다.
  */
  experimental: {
    /*
      화면 스타일(약 60KB)을 별도 파일 대신 HTML 안에 넣는다. 본체 프록시를 거쳐 정적 파일을 따로 받는 구조라
      네트워크가 불안하면 CSS 요청만 실패해 꾸밈 없는 화면이 보였다(2026-10-13). 운영 빌드에만 적용된다.
    */
    inlineCss: true,
    serverActions: {
      allowedOrigins: ["edutouch.co.kr", "www.edutouch.co.kr", "edutouch-web.edutouch-web.workers.dev", "jeongsi-touch.edutouch-web.workers.dev", "localhost:3003", "127.0.0.1:3003"],
    },
  },
  // 예전 시안 앱(에듀터치 jeongsi/)의 주소로 들어온 사람을 새 화면으로 보낸다(같은 jeongsi-touch 워커를 교체함)
  async redirects() {
    return [
      { source: "/score", destination: "/reports/me", permanent: false },
      { source: "/report", destination: "/reports/me", permanent: false },
      { source: "/results", destination: "/admissions/results", permanent: false },
      { source: "/find", destination: "/admissions/favorable", permanent: false },
      { source: "/schools", destination: "/admissions/possibilities", permanent: false },
    ];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
