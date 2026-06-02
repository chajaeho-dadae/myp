# 🔍 머더 미스터리 — 교실용 추리 게임 엔진

## 시작 전 필수 설정 (10분)

### 1단계: Supabase 프로젝트 생성
1. [supabase.com](https://supabase.com) 접속 → 무료 계정 생성
2. **"New project"** 클릭 → 프로젝트 이름, 비밀번호 입력 → 리전: Northeast Asia (도쿄) 권장

### 2단계: 테이블 생성
Supabase 대시보드 → **SQL Editor** → 아래 SQL 실행:

```sql
create table rooms (
  id text primary key,
  name text,
  teacher_name text,
  status text default 'waiting',
  created_at timestamptz default now(),
  players jsonb default '{}',
  scenario_id text,
  culprit_ids jsonb,
  assignments jsonb,
  current_phase int default 0,
  custom_scenario jsonb
);

-- Realtime 활성화
alter publication supabase_realtime add table rooms;

-- 익명 접근 허용 (Row Level Security)
alter table rooms enable row level security;
create policy "allow all" on rooms for all using (true) with check (true);
```

### 3단계: API 키 복사
Supabase 대시보드 → **Settings → API**
- **Project URL** → `SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON`

### 4단계: index.html 수정
파일 상단의 두 줄을 교체:

```javascript
const SUPABASE_URL  = "https://여기에붙여넣기.supabase.co";
const SUPABASE_ANON = "여기에anon키붙여넣기";
```

교사 비밀번호도 변경 가능:
```javascript
const TEACHER_PASSWORD = "teacher1234";
```

---

## GitHub Pages 배포

1. GitHub에서 새 repository 생성 (예: `murder-mystery`)
2. `index.html` 업로드
3. **Settings → Pages → Branch: main → Save**
4. 배포 주소: `https://[깃허브ID].github.io/murder-mystery/`

---

## 수업 진행 방법

### 교사 순서
1. 사이트 접속 → **교사 입장** → 비밀번호 입력
2. 방 이름 + 이름 입력 → **방 만들기**
3. **방 코드** 또는 **초대 링크**를 학생에게 공유
4. 학생 전원 입장 확인 → 시나리오/범인 수 선택 → **게임 시작**
5. **다음 단계 ▶** 버튼으로 진행
6. 토론 완료 후 **게임 종료 / 범인 공개**

### 학생 순서
1. 링크 접속 또는 **학생 입장** → 방 코드 + 이름 입력
2. 대기 화면에서 선생님 시작 대기
3. 역할 카드 + 배경 스토리 확인
4. 범인인 경우: 빨간 카드와 범인 지침 표시
5. 단계별 안내에 따라 토론

---

## 기본 시나리오

| 시나리오 | 장르 | 역할 수 | 단계 수 |
|----------|------|---------|---------|
| 🏫 학교의 비밀 | 학원 미스터리 | 6명 | 5단계 |
| 🏚️ 폐건물의 밤 | 공포 미스터리 | 7명 | 4단계 |
| ✏️ 직접 만들기 | 커스텀 | 자유 | 자유 |

### 코드에서 시나리오 추가
`scenarios` 배열에 항목 추가:

```javascript
{
  id: "my_scenario",
  title: "🎭 나의 시나리오",
  genre: "장르명",
  thumbnail: "이미지URL",
  background: `배경 스토리`,
  phases: [
    { title: "1단계", description: "안내 텍스트", duration: 180 }
  ],
  roles: [
    { id: "role1", name: "역할이름", icon: "🧑", description: "역할 설명" }
  ],
  culpritRole: {
    name: "범인 역할명", icon: "🦹",
    hint: "범인 전용 지침",
    reveal: "종료 시 공개 해설"
  }
}
```
