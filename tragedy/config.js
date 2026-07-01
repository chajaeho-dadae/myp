// ============================================================================
// 화성 공유지의 비극 — Supabase 접속 설정
// student.html, teacher.html에서 공통으로 불러 씁니다.
// ============================================================================
const SUPABASE_URL  = 'https://sdhpzypjqmowhrhxvvsj.supabase.co';
const SUPABASE_ANON = 'sb_publishable_RRyqMtpm4qI0BZ9gdIjTvw_XOnJiaHc';

// supabase-js UMD 번들(CDN)이 index.html/student.html/teacher.html에서
// 먼저 로드된 뒤 이 파일이 실행됩니다.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// 서버 RPC 호출 공통 래퍼: 에러를 콘솔에 남기고 data만 돌려줍니다.
async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    console.error(`[rpc:${fn}]`, error);
    throw error;
  }
  return data;
}
