# 🔍 머더 미스터리 — 교실용 추리 게임 엔진

## 시작 전 필수 설정 (10분)

### 1단계: Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com) 접속 → Google 계정 로그인
2. **"프로젝트 만들기"** 클릭 → 프로젝트 이름 입력 (예: `murder-mystery-class`)
3. Google 애널리틱스는 **비활성화** 후 프로젝트 생성

### 2단계: Realtime Database 활성화
1. 왼쪽 메뉴 **"빌드" → "Realtime Database"** 클릭
2. **"데이터베이스 만들기"** → 위치: 미국(기본값) → **"테스트 모드로 시작"** 선택
   - ⚠️ 테스트 모드는 30일 후 만료됩니다. 이후 규칙에서 `read/write: true` 재설정 필요

### 3단계: 웹 앱 등록 및 설정값 복사
1. Firebase 프로젝트 홈 → **"앱 추가" → 웹(</> 아이콘)** 클릭
2. 앱 닉네임 입력 → **"앱 등록"**
3. 화면에 표시되는 `firebaseConfig` 객체를 복사

### 4단계: index.html 수정
`index.html` 파일에서 아래 부분을 찾아 복사한 값으로 교체:

```javascript
const firebaseConfig = {
  apiKey: "여기에 붙여넣기",
  authDomain: "여기에 붙여넣기",
  databaseURL: "여기에 붙여넣기",   // ← 반드시 포함되어야 함
  projectId: "여기에 붙여넣기",
  storageBucket: "여기에 붙여넣기",
  messagingSenderId: "여기에 붙여넣기",
  appId: "여기에 붙여넣기"
};
```

> **주의:** `databaseURL`이 없는 경우, Firebase Console → Realtime Database → 상단 URL을 직접 복사해서 추가하세요.

교사 비밀번호도 이 줄에서 변경 가능:
```javascript
const TEACHER_PASSWORD = "teacher1234";  // ← 원하는 비밀번호로 변경
```

---

## GitHub Pages 배포

```bash
# 1. GitHub에서 새 repository 생성 (예: murder-mystery)
# 2. index.html 파일 업로드
# 3. Settings → Pages → Branch: main, folder: / (root) → Save
# 배포 완료 후 주소: https://[깃허브ID].github.io/murder-mystery/
```

---

## 수업 진행 방법

### 교사 순서
1. 사이트 접속 → **"교사 입장"** → 비밀번호 입력
2. 방 이름 + 이름 입력 → **"방 만들기"**
3. 화면의 **방 코드** 또는 **초대 링크**를 학생들에게 공유
4. 학생 전원 입장 확인 후 시나리오/범인 수 선택 → **"게임 시작"**
5. 게임 중 **"다음 단계 ▶"** 버튼으로 진행 단계 조절
6. 토론 완료 후 **"게임 종료 / 범인 공개"** 클릭

### 학생 순서
1. 링크 접속 또는 사이트에서 **"학생 입장"** → 방 코드 + 이름 입력
2. 대기 화면에서 선생님 시작 대기
3. 게임 시작 후: 자신의 역할 카드 + 배경 스토리 확인
4. **범인으로 지정된 경우:** 빨간 경고 카드와 범인 지침이 표시됨
5. 단계별 안내에 따라 토론 진행

---

## 커스텀 시나리오 만들기

게임 로비에서 시나리오 선택 메뉴의 **"✏️ 직접 만들기"** 를 선택하면:
- 배경 스토리 입력
- 이미지 URL 추가
- 역할 이름/아이콘/설명 자유 설정
- 진행 단계 추가 및 시간 설정
- 범인 전용 힌트 및 종료 시 해설 입력

---

## 기본 제공 시나리오

| 시나리오 | 장르 | 역할 수 | 단계 수 |
|----------|------|---------|---------|
| 🏫 학교의 비밀 | 학원 미스터리 | 6명 | 5단계 |
| 🏚️ 폐건물의 밤 | 공포 미스터리 | 7명 | 4단계 |
| ✏️ 직접 만들기 | 커스텀 | 자유 | 자유 |

### 코드에서 시나리오 추가하기
`index.html`의 `scenarios` 배열에 항목을 추가하면 됩니다:

```javascript
{
  id: "my_scenario",           // 고유 ID
  title: "🎭 나의 시나리오",
  genre: "장르명",
  thumbnail: "이미지URL",
  background: `여기에 배경 스토리를 입력하세요.`,
  phases: [
    { title: "1단계 이름", description: "학생 안내 텍스트", duration: 180 }
  ],
  roles: [
    { id: "role1", name: "역할이름", icon: "🧑", description: "역할 설명" }
  ],
  culpritRole: {
    name: "범인 역할명",
    icon: "🦹",
    hint: "범인에게만 보이는 지침",
    reveal: "종료 시 공개되는 해설"
  }
}
```
