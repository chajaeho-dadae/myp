-- ============================================================
-- Mist Chase (안개 속의 것 추적 게임) - Supabase Schema
-- prefix: mistchase_
-- ============================================================

-- 1. 교실 세션 (하나의 수업 = 하나의 세션)
create table mistchase_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_token text not null unique,        -- 교사 클라이언트 식별용 비공개 토큰
  join_code text not null unique,            -- 학생이 입력하는 짧은 참가 코드 (예: 4자리)
  status text not null default 'lobby',      -- lobby | playing | ended
  cycle_number int not null default 1,       -- 전원 1회씩 형사 경험 완료 시 +1
  created_at timestamptz not null default now()
);

-- 2. 참가 학생 (세션에 접속한 학생들)
create table mistchase_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references mistchase_sessions(id) on delete cascade,
  pseudonym text not null,
  session_token text not null unique,        -- localStorage 재접속용
  times_played int not null default 0,       -- 누적 형사 참여 횟수
  played_this_cycle boolean not null default false,
  connected boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_mistchase_players_session on mistchase_players(session_id);

-- 3. 세션 내 "한 판" (게임 라운드)
create table mistchase_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references mistchase_sessions(id) on delete cascade,
  game_number int not null,                  -- 세션 내 몇 번째 판인지
  status text not null default 'waiting',    -- waiting | active | ended
  current_turn int not null default 0,       -- 0~20
  result text,                               -- caught | escaped | null(진행중)
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_mistchase_games_session on mistchase_games(session_id);

-- 4. 판별 역할/말 배치 (형사 슬롯, 위치는 공개 정보이므로 여기 저장)
create table mistchase_assignments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references mistchase_games(id) on delete cascade,
  player_id uuid not null references mistchase_players(id) on delete cascade,
  role text not null,                        -- detective | spectator
  slot_number int,                           -- 형사 1~5, 관전자는 null
  current_node text,                         -- 형사 말의 현재 노드 (공개 정보)
  created_at timestamptz not null default now(),
  unique(game_id, player_id)
);

create index idx_mistchase_assignments_game on mistchase_assignments(game_id);

-- 5. 안개가 걷힌 순간의 클루 기록 (그림자 위치 공개 이력)
create table mistchase_clues (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references mistchase_games(id) on delete cascade,
  turn_number int not null,                  -- 3, 8, 13, 18 등
  node_id text not null,                     -- 공개된 그림자의 위치
  flavor_text text,                          -- 연출용 목격담 텍스트
  revealed_at timestamptz not null default now()
);

create index idx_mistchase_clues_game on mistchase_clues(game_id);

-- ============================================================
-- RLS: 학급 규모의 신뢰 기반 환경이므로 anon key로 단순 개방.
-- (그림자의 실제 이동 경로는 애초에 이 스키마에 존재하지 않음 - 교사 클라이언트 로컬에만 보관)
-- ============================================================
alter table mistchase_sessions enable row level security;
alter table mistchase_players enable row level security;
alter table mistchase_games enable row level security;
alter table mistchase_assignments enable row level security;
alter table mistchase_clues enable row level security;

create policy "public read/write sessions" on mistchase_sessions for all using (true) with check (true);
create policy "public read/write players" on mistchase_players for all using (true) with check (true);
create policy "public read/write games" on mistchase_games for all using (true) with check (true);
create policy "public read/write assignments" on mistchase_assignments for all using (true) with check (true);
create policy "public read/write clues" on mistchase_clues for all using (true) with check (true);
