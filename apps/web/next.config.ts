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
