// ============================================================
// Mist Chase - Supabase 클라이언트
// TODO: Supabase 프로젝트 생성 후 아래 두 값을 교체하세요.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = 'https://sdhpzypjqmowhrhxvvsj.supabase.co';
const SUPABASE_ANON = 'sb_publishable_RRyqMtpm4qI0BZ9gdIjTvw_XOnJiaHc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
