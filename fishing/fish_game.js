/**
 * ================================================================
 *  fish_game.js  —  낚시왕 공유 게임 로직 모듈
 *
 *  host.html / student.html 양쪽에서 공통으로 사용합니다.
 *
 *  포함 내용:
 *    1. 이벤트 카드 effect 계산 엔진
 *    2. 자원 계산 헬퍼
 *    3. 점수 계산 헬퍼
 *    4. 페이즈 이름·색상 매핑
 *    5. 포맷 유틸리티
 *    6. 연결 상태 관리 헬퍼
 *    7. 게임 상수
 * ================================================================
 */

'use strict';

// ================================================================
//  1. 게임 상수
// ================================================================
const FISH = {

  /** 최대 채취량 (슬라이더 max) */
  MAX_HARVEST: 10,

  /** 채취량 0의 최솟값 */
  MIN_HARVEST: 0,

  /** 페이즈 순서 */
  PHASES: ['lobby', 'negotiation', 'harvest', 'result', 'ended'],

  /** 페이즈 한국어 이름 */
  PHASE_NAMES: {
    lobby:       '대기 중',
    negotiation: '협상',
    harvest:     '채취',
    result:      '결과 공개',
    ended:       '게임 종료',
  },

  /** 페이즈 뱃지 색상 (CSS 클래스) */
  PHASE_COLORS: {
    lobby:       'badge-blue',
    negotiation: 'badge-purple',
    harvest:     'badge-yellow',
    result:      'badge-green',
    ended:       'badge-red',
  },

  /** 자원 위험도 임계값 (%) */
  RESOURCE_WARN:    30,   // 30% 이하 → 노란색
  RESOURCE_DANGER:  10,   // 10% 이하 → 빨간색
};


// ================================================================
//  2. 이벤트 effect 계산 엔진
//
//  각 함수는 순수 함수입니다 (DB 접근 없음).
//  host.html의 computeResult() 가 이 함수들을 조합해서 사용합니다.
// ================================================================
const FishEffect = {

  /**
   * 이벤트로 인한 자원 선보정 (채취 전)
   * @param {number} resource  현재 자원
   * @param {object} effect    fish_events.effect JSONB
   * @returns {number} 보정된 자원
   */
  applyResourcePre(resource, effect) {
    if (!effect) return resource;
    switch (effect.type) {
      case 'resource_pct':
        return Math.max(0, Math.round(resource * (1 + effect.value)));
      case 'resource_flat':
        return Math.max(0, resource + effect.value);
      case 'resource_pct_and_score_multi':
        return Math.max(0, Math.round(resource * (1 + effect.resource_pct)));
      default:
        return resource;
    }
  },

  /**
   * 자원 재생량 계산
   * @param {number} resource    채취 후 자원
   * @param {number} regenRate   기본 재생률 (0.15 등)
   * @param {object} effect
   * @returns {{ regen: number, resource: number }}
   */
  applyRegen(resource, regenRate, effect) {
    if (!effect) effect = {};
    if (effect.type === 'skip_regen' || resource <= 0) {
      return { regen: 0, resource };
    }
    const multi = (effect.type === 'regen_multi') ? effect.value : 1.0;
    const regen = Math.round(resource * regenRate * multi);
    return { regen, resource: resource + regen };
  },

  /**
   * 그룹 조건 보너스 자원 (E13)
   * @param {Array<{amount:number}>} harvests  전체 제출 목록
   * @param {object} effect
   * @returns {number} 추가 자원 (0 또는 bonus)
   */
  groupBonus(harvests, effect) {
    if (!effect || effect.type !== 'group_limit_bonus') return 0;
    const allUnder = harvests.every(h => h.amount <= effect.max_each);
    return allUnder ? effect.resource_bonus : 0;
  },

  /**
   * 지속 가능 채취 한계 (마리 단위)
   * @param {number} resource
   * @param {number} limitRatio        기본 한계 비율 (0.30)
   * @param {object} effect
   * @param {boolean} votePassed       E11 투표 통과 여부
   * @returns {number}
   */
  harvestLimit(resource, limitRatio, effect, votePassed) {
    let ratio = limitRatio;
    if (effect && effect.type === 'vote_limit_bonus' && votePassed) {
      ratio += effect.bonus_ratio;
    }
    return Math.round(resource * ratio);
  },

  /**
   * 점수 배율 가져오기
   * @param {object} effect
   * @returns {number}
   */
  scoreMultiplier(effect) {
    if (!effect) return 1;
    if (effect.type === 'score_multi') return effect.value;
    if (effect.type === 'resource_pct_and_score_multi') return effect.score_multi;
    return 1;
  },

  /**
   * 개인 점수 계산
   *
   * @param {object} harvest         { player_id, amount }
   * @param {Array}  allHarvests     전체 harvest 목록 (순위 계산용)
   * @param {object} effect          fish_events.effect
   * @param {object} roundRow        fish_rounds row (allowed_players 등)
   * @param {boolean} harvestBanned  E15 휴어기 발동 여부
   * @returns {number} 이번 라운드 점수
   */
  calcScore(harvest, allHarvests, effect, roundRow, harvestBanned) {
    if (!effect) effect = {};

    // 휴어기: 전원 0점
    if (harvestBanned) return 0;

    // E14: 면허 없는 플레이어 0점
    if (roundRow?.allowed_players?.length > 0 &&
        !roundRow.allowed_players.includes(harvest.player_id)) {
      return 0;
    }

    const sortedDesc = [...allHarvests].sort((a, b) => b.amount - a.amount);
    const sortedAsc  = [...allHarvests].sort((a, b) => a.amount - b.amount);
    const n          = allHarvests.length;

    // 기본 점수
    let score = harvest.amount * this.scoreMultiplier(effect);

    // 세금 (E12)
    if (effect.type === 'tax_per_unit') {
      score -= harvest.amount * effect.value;
    }

    // 전원 보너스 (E10)
    if (effect.type === 'bonus_all') {
      score += effect.value;
    }

    // 상위 N명 페널티 (E08)
    if (effect.type === 'penalty_top_n') {
      const topIds = sortedDesc.slice(0, effect.top_n).map(h => h.player_id);
      if (topIds.includes(harvest.player_id)) {
        score *= (1 - effect.penalty);
      }
    }

    // 상위 % 전액 소실 (E07)
    if (effect.type === 'penalty_top_pct') {
      const topCount = Math.ceil(n * effect.top_pct);
      const topIds   = sortedDesc.slice(0, topCount).map(h => h.player_id);
      if (topIds.includes(harvest.player_id)) score = 0;
    }

    // 하위 % 보너스 (E09)
    if (effect.type === 'bonus_bottom_pct') {
      const botCount = Math.ceil(n * effect.bottom_pct);
      const botIds   = sortedAsc.slice(0, botCount).map(h => h.player_id);
      if (botIds.includes(harvest.player_id)) {
        score += effect.bonus;
      }
    }

    return Math.max(0, Math.round(score * 100) / 100);
  },

  /**
   * 전체 라운드 결과 계산 (순수 함수 버전)
   *
   * host.html의 computeResult() 가 이 함수를 호출한 뒤
   * 반환값을 DB에 씁니다.
   *
   * @param {object} room        fish_rooms row
   * @param {object} roundRow    fish_rounds row
   * @param {Array}  harvests    fish_harvests rows (해당 라운드)
   * @param {Array}  players     fish_players rows (active)
   * @returns {{
   *   scores: Array<{player_id, score}>,
   *   totalHarvested: number,
   *   regenAmt: number,
   *   resourceAfter: number,
   *   isGameOver: boolean,
   * }}
   */
  computeRound(room, roundRow, harvests, players) {
    const effect  = roundRow.event_effect || {};
    const active  = players.filter(p => !p.is_host && p.is_active);

    // 1) 자원 선보정
    let resource = this.applyResourcePre(room.resource, effect);

    // 2) 그룹 보너스 체크 (E13)
    const groupRes = this.groupBonus(harvests, effect);

    // 3) 채취 합계
    let totalHarvested = 0;
    const harvestBanned = effect.type === 'host_can_ban_harvest' && room.event_applied;

    if (harvestBanned) {
      totalHarvested = 0;
    } else if (roundRow.allowed_players?.length > 0) {
      // E14: 허용된 플레이어만 집계
      totalHarvested = harvests
        .filter(h => roundRow.allowed_players.includes(h.player_id))
        .reduce((s, h) => s + h.amount, 0);
    } else {
      totalHarvested = harvests.reduce((s, h) => s + h.amount, 0);
    }

    // 4) 개인 점수
    const scores = harvests.map(h => ({
      player_id: h.player_id,
      score: this.calcScore(h, harvests, effect, roundRow, harvestBanned),
    }));

    // 5) 자원 감소
    resource = Math.max(0, resource - totalHarvested);

    // 6) 재생
    const regenResult = this.applyRegen(resource, room.regen_rate, effect);
    const regenAmt    = regenResult.regen;
    resource          = regenResult.resource + groupRes;

    return {
      scores,
      totalHarvested,
      regenAmt,
      resourceAfter: Math.max(0, resource),
      isGameOver: resource <= 0,
    };
  },
};


// ================================================================
//  3. 자원 상태 헬퍼
// ================================================================
const FishResource = {

  /**
   * 자원 비율 (0~1)
   */
  ratio(resource, resourceInit) {
    if (!resourceInit) return 0;
    return Math.min(1, resource / resourceInit);
  },

  /**
   * 자원 바 색상
   */
  barColor(pct) {
    if (pct > 0.5) return 'var(--green)';
    if (pct > 0.2) return 'var(--yellow)';
    return 'var(--red)';
  },

  /**
   * 자원 상태 텍스트
   */
  statusText(pct) {
    if (pct > 0.6) return '🟢 풍부';
    if (pct > 0.3) return '🟡 보통';
    if (pct > 0.1) return '🟠 위험';
    return '🔴 고갈 임박';
  },

  /**
   * 1인당 안전 채취량
   */
  safePerPlayer(resource, limitRatio, playerCount) {
    if (!playerCount) return 0;
    const limit = Math.round(resource * limitRatio);
    return Math.floor(limit / playerCount);
  },

  /**
   * 채취량의 위험 수준
   * @returns {'safe'|'warn'|'danger'}
   */
  harvestRisk(amount, safePerPlayer) {
    if (amount <= safePerPlayer) return 'safe';
    if (amount <= safePerPlayer * 1.5) return 'warn';
    return 'danger';
  },
};


// ================================================================
//  4. 포맷 유틸리티
// ================================================================
const FishFmt = {

  /** 숫자 → "N마리" */
  fish(n) { return (n ?? 0) + '마리'; },

  /** 숫자 → "+N pt" 또는 "-N pt" */
  score(n) {
    n = n ?? 0;
    return (n >= 0 ? '+' : '') + n + 'pt';
  },

  /** 초 → "MM:SS" */
  timer(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },

  /** TIMESTAMPTZ → "HH:MM" */
  time(isoStr) {
    return new Date(isoStr).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  },

  /** 순위 CSS 클래스 */
  rankClass(i) {
    return ['rank-1', 'rank-2', 'rank-3'][i] ?? '';
  },

  /** effect.type → 한국어 설명 */
  effectSummary(effect, eventName) {
    if (!effect) return eventName || '-';
    const t = effect.type;
    if (t === 'resource_pct')                return `자원 ${Math.round(effect.value*100)}%`;
    if (t === 'resource_flat')               return `자원 ${effect.value > 0 ? '+' : ''}${effect.value}마리`;
    if (t === 'resource_pct_and_score_multi')return `자원${Math.round(effect.resource_pct*100)}% / 점수×${effect.score_multi}`;
    if (t === 'regen_multi')                 return `재생률 ×${effect.value}`;
    if (t === 'skip_regen')                  return '재생 없음';
    if (t === 'score_multi')                 return `점수 ×${effect.value}`;
    if (t === 'penalty_top_pct')             return `상위${Math.round(effect.top_pct*100)}% 점수 0`;
    if (t === 'penalty_top_n')               return `상위${effect.top_n}인 -${Math.round(effect.penalty*100)}%`;
    if (t === 'bonus_bottom_pct')            return `하위${Math.round(effect.bottom_pct*100)}% +${effect.bonus}pt`;
    if (t === 'bonus_all')                   return `전원 +${effect.value}pt`;
    if (t === 'vote_limit_bonus')            return `투표: 한계 +${Math.round(effect.bonus_ratio*100)}%`;
    if (t === 'tax_per_unit')                return `1마리당 -${effect.value}pt 세금`;
    if (t === 'group_limit_bonus')           return `전원 ≤${effect.max_each} → 자원+${effect.resource_bonus}`;
    if (t === 'random_allowed_half')         return '절반만 채취 허용';
    if (t === 'host_can_ban_harvest')        return '진행자 휴어기 발동 가능';
    return eventName || t;
  },
};


// ================================================================
//  5. 연결 상태 관리 헬퍼
// ================================================================
const FishConn = {

  _heartbeatTimer: null,

  /**
   * 주기적으로 last_seen_at 갱신 (재접속 감지용)
   * @param {object} sb       Supabase client
   * @param {string} playerId
   * @param {number} intervalMs  기본 30초
   */
  startHeartbeat(sb, playerId, intervalMs = 30_000) {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      await sb.from('fish_players')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', playerId);
    }, intervalMs);
  },

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },

  /**
   * Supabase Realtime 채널 상태 → UI 텍스트
   */
  statusText(state) {
    switch (state) {
      case 'SUBSCRIBED':    return '● 연결됨';
      case 'CHANNEL_ERROR': return '● 연결 오류';
      case 'TIMED_OUT':     return '● 타임아웃';
      case 'CLOSED':        return '● 연결 끊김';
      default:              return '● 연결 중...';
    }
  },

  statusColor(state) {
    if (state === 'SUBSCRIBED')    return 'var(--green)';
    if (state === 'CHANNEL_ERROR') return 'var(--red)';
    return 'var(--yellow)';
  },
};


// ================================================================
//  6. 이벤트 카드 렌더 헬퍼
//     host.html / student.html 양쪽에서 동일한 함수로 카드 렌더링
// ================================================================
const FishEventCard = {

  /**
   * 이벤트 카드 HTML 조각 생성
   * @param {object} evt   fish_events row (icon, name, desc, effect)
   * @param {object} opts  { showEffect: bool }
   * @returns {string} HTML 문자열
   */
  html(evt, opts = {}) {
    if (!evt) return '';
    const effectSummary = opts.showEffect
      ? `<div style="margin-top:6px;font-size:11px;color:var(--orange);font-weight:600">
           효과: ${FishFmt.effectSummary(evt.effect, evt.name)}
         </div>`
      : '';
    return `
      <div style="font-size:28px;margin-bottom:4px">${evt.icon}</div>
      <div style="font-weight:700;font-size:14px;margin-bottom:4px">${FishEventCard._esc(evt.name)}</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6">${FishEventCard._esc(evt.desc)}</div>
      ${effectSummary}
    `;
  },

  _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },
};


// ================================================================
//  7. 라운드 히스토리 렌더 헬퍼
// ================================================================
const FishHistory = {

  /**
   * 히스토리 행 HTML 생성
   * @param {Array} rounds  fish_rounds rows
   * @param {Array} events  fish_events rows
   * @returns {string} HTML
   */
  html(rounds, events) {
    if (!rounds || !rounds.length) return '<div style="color:var(--text3);font-size:12px;text-align:center;padding:10px">아직 완료된 라운드가 없습니다.</div>';

    return [...rounds].reverse().map(r => {
      const evt = events.find(e => e.id === r.event_id);
      const icon = evt ? evt.icon : '❓';
      const resColor = (r.resource_after || 0) < 50 ? 'var(--red)' : 'var(--green)';
      return `
        <div class="history-row">
          <span class="r">R${r.round_num}</span>
          <span>${icon} ${FishEventCard._esc(r.event_name || '-')}</span>
          <span style="color:var(--orange);margin-left:auto">채취${r.total_harvested || 0}</span>
          <span style="color:${resColor}">잔${r.resource_after || 0}</span>
        </div>`;
    }).join('');
  },
};


// ================================================================
//  8. 토스트 (공통)
// ================================================================
function fishToast(msg, duration = 2500) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);'
      + 'background:#22272e;border:1px solid #30363d;color:#e6edf3;'
      + 'padding:10px 20px;border-radius:20px;font-size:12px;z-index:9999;'
      + 'opacity:0;transition:opacity .3s;pointer-events:none';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
}


// ================================================================
//  9. 전역 노출 (모듈 미사용 환경 대응)
// ================================================================
window.FISH         = FISH;
window.FishEffect   = FishEffect;
window.FishResource = FishResource;
window.FishFmt      = FishFmt;
window.FishConn     = FishConn;
window.FishEventCard= FishEventCard;
window.FishHistory  = FishHistory;
window.fishToast    = fishToast;
