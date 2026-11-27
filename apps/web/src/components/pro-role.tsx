"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
  전문가용 탭에 '기관 관리'를 보일지(기관 관리자만, 2026-11-13 최종관리자 결정).
  탭은 머리글(루트 레이아웃)에 있고 역할은 전문가용 레이아웃이 알기 때문에, 전문가용 레이아웃이 이 표시를 남기고 탭이 읽는다.
  표시는 화면 모양만 바꾼다 — 기관 관리 화면 자체가 서버에서 역할을 다시 확인한다.
*/
let admin = false;
const subs = new Set<() => void>();
const set = (v: boolean) => {
  if (admin === v) return;
  admin = v;
  subs.forEach((f) => f());
};

export function ProRoleMark({ isAdmin }: { isAdmin: boolean }) {
  useEffect(() => {
    set(isAdmin);
    return () => set(false);
  }, [isAdmin]);
  return null;
}

export function useProAdmin(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => admin,
    () => false,
  );
}
