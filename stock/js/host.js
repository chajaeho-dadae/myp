// ================================================================
// 🎛️ host.js — 진행자 화면 로직
// ================================================================

// ================================================================
// 🌐 전역 상태
// ================================================================
const Host = {
  roomId:       null,
  hostId:       null,
  room:         null,
  stocks:       [],
  players:      [],
  holdings:     [],
  editStocks:   [...DEFAULT_STOCKS],  // 게임 시작 전 편집용 복사본
  processing:   false,                // 라운드 처리 중 여부 (중복 클릭 방지)
  subs:         [],                   // Realtime 구독 목록
};


// ================================================================
// 🚀 초기화
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 새로고침 복원
  const saved = sessionLoad('host');
  if (saved?.roomId) {
    Host.roomId = saved.roomId;
    Host.hostId = saved.hostId;
    await restoreHost();
    return;
  }
  showScreen('screen-setup');
});


// ================================================================
// 🏠 방 생성
// ================================================================
async function hostCreateRoom() {
  const totalRounds  = parseInt(document.getElementById('h-total-rounds').value) || 5;
  const initialCash  = parseInt(document.getElementById('h-initial-cash').value) || 1000000;

  if (totalRounds < 1 || totalRounds > 20) {
    return showToast('⚠️ 라운드는 1~20 사이로 설정하세요.');
  }
  if (initialCash < 10000) {
    return showToast('⚠️ 초기 자금은 10,000원 이상이어야 합니다.');
  }

  try {
    const roomId = generateRoomCode();
    const hostId = 'host_' + Date.now();

    await dbCreateRoom(roomId, hostId, totalRounds, initialCash);

    Host.roomId = roomId;
    Host.hostId = hostId;
    sessionSave('host', { roomId, hostId });

    showScreen('screen-stock-edit');
    renderStockEditor();
    document.getElementById('h-room-code-display').textContent = roomId;

  } catch (e) {
    showToast('❌ 방 생성 실패: ' + e.message);
  }
}


// ================================================================
// ✏️ 종목 편집 화면
// ================================================================
function renderStockEditor() {
  const tbody = document.getElementById('h-stock-tbody');
  tbody.innerHTML = '';

  Host.editStocks.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tbl-input" value="${s.name}"
        onchange="Host.editStocks[${i}].name = this.value"></td>
      <td><input class="tbl-input" value="${s.ticker}"
        onchange="Host.editStocks[${i}].ticker = this.value"></td>
      <td><input class="tbl-input number" type="number" value="${s.price}"
        onchange="Host.editStocks[${i}].price = parseInt(this.value)||0"></td>
      <td><button class="btn btn-sm btn-danger"
        onclick="hostRemoveStock(${i})">🗑</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function hostAddStock() {
  Host.editStocks.push({ name: '새 종목', ticker: 'new' + Date.now(), price: 100000 });
  renderStockEditor();
}

function hostRemoveStock(i) {
  if (Host.editStocks.length <= 1) return showToast('⚠️ 종목은 최소 1개 이상이어야 합니다.');
  Host.editStocks.splice(i, 1);
  renderStockEditor();
}

function hostResetStocks() {
  Host.editStocks = [...DEFAULT_STOCKS];
  renderStockEditor();
  showToast('🔄 기본 종목으로 초기화했습니다.');
}


// ================================================================
// 🎮 게임 시작
// ================================================================
async function hostStartGame() {
  // 유효성 검사
  const names   = Host.editStocks.map(s => s.name.trim());
  const tickers = Host.editStocks.map(s => s.ticker.trim());

  if (names.some(n => !n))   return showToast('⚠️ 종목명을 모두 입력하세요.');
  if (tickers.some(t => !t)) return showToast('⚠️ 티커를 모두 입력하세요.');
  if (new Set(tickers).size !== tickers.length)
    return showToast('⚠️ 티커가 중복되었습니다.');
  if