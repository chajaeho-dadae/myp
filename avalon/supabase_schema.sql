-- =============================================
-- 레지스탕스 아발론 온라인 - Supabase 스키마
-- Supabase SQL Editor에 전체 복사 후 실행
-- =============================================

-- 1. 게임 방 테이블
CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,          -- 6자리 참가 코드
  host_id     TEXT NOT NULL,                 -- 진행자 session ID
  host_name   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'waiting', -- waiting | role_assign | discussion | vote | mission | assassination | finished
  phase       INTEGER NOT NULL DEFAULT 0,    -- 현재 라운드 (1~5)
  leader_idx  INTEGER NOT NULL DEFAULT 0,    -- 현재 대장 index
  vote_round  INTEGER NOT NULL DEFAULT 0,    -- 연속 부결 횟수 (0~4)
  good_wins   INTEGER NOT NULL DEFAULT 0,
  evil_wins   INTEGER NOT NULL DEFAULT 0,
  quest_log   JSONB NOT NULL DEFAULT '[]',   -- 각 퀘스트 결과 기록
  settings    JSONB NOT NULL DEFAULT '{}',   -- 역할 설정 (merlin, percival 등)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 플레이어 테이블
CREATE TABLE IF NOT EXISTS players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,                 -- 브라우저 세션 ID
  name        TEXT NOT NULL,
  role        TEXT,                          -- merlin | percival | loyal | assassin | mordred | morgana | oberon
  team        TEXT,                          -- good | evil
  seat        INTEGER,                       -- 자리 번호 (0-based)
  is_host     BOOLEAN DEFAULT FALSE,
  is_online   BOOLEAN DEFAULT TRUE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, session_id),
  UNIQUE(room_id, name)
);

-- 3. 투표 테이블 (원정대 구성 투표)
CREATE TABLE IF NOT EXISTS votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  phase       INTEGER NOT NULL,
  vote_round  INTEGER NOT NULL DEFAULT 0,
  voter_id    TEXT NOT NULL,                 -- session_id
  approve     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, phase, vote_round, voter_id)
);

-- 4. 미션 카드 테이블
CREATE TABLE IF NOT EXISTS mission_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  phase       INTEGER NOT NULL,
  player_id   TEXT NOT NULL,                 -- session_id
  success     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, phase, player_id)
);

-- 5. 원정대 멤버 테이블
CREATE TABLE IF NOT EXISTS quest_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  phase       INTEGER NOT NULL,
  vote_round  INTEGER NOT NULL DEFAULT 0,
  player_id   TEXT NOT NULL,                 -- session_id
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, phase, vote_round, player_id)
);

-- 6. 채팅 테이블
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  content     TEXT NOT NULL,
  type        TEXT DEFAULT 'chat',           -- chat | system
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Row Level Security (RLS) - 모두 허용 (심플 설정)
-- =============================================
ALTER TABLE rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE players        ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_cards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE quest_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;

-- anon 역할에 전체 허용 (간단한 게임용)
CREATE POLICY "allow_all_rooms"         ON rooms         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_players"       ON players       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_votes"         ON votes         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_mission_cards" ON mission_cards FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_quest_members" ON quest_members FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_messages"      ON messages      FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================
-- Realtime 활성화 (Supabase Dashboard > Database > Replication에서도 설정)
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE mission_cards;
ALTER PUBLICATION supabase_realtime ADD TABLE quest_members;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
