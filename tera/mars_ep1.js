/* ================================================================
   MARS COLONY: EPISODE 1 — TERRAFORMING
   mars_ep1.js  |  공유 게임 로직
   host.html + student.html 양쪽에서 로드됩니다.
================================================================ */

'use strict';

/* ================================================================
   SUPABASE 연결
================================================================ */
const SUPABASE_URL = 'https://sdhpzypjqmowhrhxvvsj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RRyqMtpm4qI0BZ9gdIjTvw_XOnJiaHc';

const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ================================================================
   게임 상수
================================================================ */
const EP1 = {

  /* 기본 설정 */
  DEFAULT_ROUNDS:   15,
  MIN_ROUNDS:       10,
  MAX_ROUNDS:       20,
  MIN_PLAYERS:      5,
  MAX_PLAYERS:      35,

  /* 역할 정의 */
  ROLES: {
    oxygen:   { label: '산소팀',    emoji: '🌬', desc: '테라포밍 설비를 가동해 화성 대기에 산소를 공급합니다.', resource: 'oxygen',  base_prod: 3.0 },
    food:     { label: '식량팀',    emoji: '🌾', desc: '수경재배 시설에서 식량을 생산합니다.',                 resource: 'food',    base_prod: 3.0 },
    water:    { label: '수자원팀',  emoji: '💧', desc: '지하 얼음을 채굴해 식수를 확보합니다.',               resource: 'water',   base_prod: 3.0 },
    energy:   { label: '에너지팀',  emoji: '⚡', desc: '태양광 및 원자력 발전 시설을 운영합니다.',             resource: 'energy',  base_prod: 3.0 },
    mineral:  { label: '광물팀',    emoji: '🪨', desc: '화성 지표에서 희귀 광물을 채굴합니다.',               resource: 'mineral', base_prod: 2.5 },
    construction: { label: '건설팀', emoji: '🏗', desc: '다른 팀의 시설을 보강해 생산 효율을 높입니다.',      resource: null,      base_prod: 0   },
    medical:  { label: '의료팀',    emoji: '🛡', desc: '대원들의 건강을 관리해 팀 피로도를 회복시킵니다.',    resource: null,      base_prod: 0   },
  },

  /* 팀 행동 */
  ACTIONS: {
    full:        { label: '풀가동',    emoji: '🔥', desc: '생산량 100% · 피로도 +1',      prod_mult: 1.0, fatigue_delta: +1 },
    normal:      { label: '정상가동',  emoji: '⚙️', desc: '생산량 70% · 피로도 유지',     prod_mult: 0.7, fatigue_delta:  0 },
    maintenance: { label: '정기점검',  emoji: '🔧', desc: '생산량 0% · 피로도 -2 · 시설 유지', prod_mult: 0.0, fatigue_delta: -2 },
  },

  /* 피로도 → 생산량 보정 */
  FATIGUE_MULT: [
    { max: 3,  mult: 1.0 },
    { max: 6,  mult: 0.8 },
    { max: 9,  mult: 0.5 },
    { max: 10, mult: 0.0 },
  ],

  /* 시설 내구도 규칙 */
  FACILITY: {
    decay_per_round:     5,   // 점검 없이 풀가동 시 라운드당 HP 감소
    penalty_threshold:   3,   // no_maintenance 이상이면 페널티 발동
    penalty_mult:        0.5, // 페널티 시 생산량 배수
    repair_per_check:   20,   // 정기점검 1회당 HP 회복
  },

  /* 건설/의료 특수 행동 */
  SUPPORT: {
    construction_boost:  0.20, // 지원받은 팀 다음 라운드 생산량 +20%
    construction_targets_full: 2, // 풀가동 시 지원 가능 팀 수
    construction_targets_normal: 1,
    medical_fatigue_heal: 3,   // 의료 지원 시 피로도 -3
    medical_targets_full: 2,
    medical_targets_normal: 1,
  },

  /* 자원 소비 (라운드당 인원 1명 기준) */
  CONSUMPTION_PER_PLAYER: {
    oxygen:  1.0,
    food:    1.0,
    water:   1.0,
    energy:  0.8,
    mineral: 0.0, // 광물은 자동 소비 없음 (건설에만 사용)
  },

  /* 초기 재고 (인원 × 배수) */
  INIT_STOCK_MULT: {
    oxygen:  8,
    food:    8,
    water:   8,
    energy:  7,
    mineral: 6,
  },

  /* 자원별 위험 임계값 (재고가 이 이하면 경고) */
  WARNING_THRESHOLD: {
    oxygen:  15,
    food:    15,
    water:   15,
    energy:  12,
    mineral: 10,
  },

  /* ── 이벤트 풀 ──────────────────────────────────────────────── */
  EVENTS: {
    // ── 재해 ──
    E01: {
      name: '☀️ 태양폭풍',
      type: 'disaster',
      desc: '강력한 태양폭풍이 발생했습니다. 에너지팀 시설이 일시 손상되어 이번 라운드 에너지 생산량이 절반으로 줄었습니다.',
      effect: { target: 'energy', type: 'production_mult', value: 0.5, duration: 1 },
      weight: -15,
    },
    E02: {
      name: '🌪 모래폭풍',
      type: 'disaster',
      desc: '거대한 모래폭풍이 식민지를 덮쳤습니다. 산소팀과 식량팀 시설 외부가 손상되어 이번 라운드 생산량이 감소합니다.',
      effect: { target: ['oxygen', 'food'], type: 'production_mult', value: 0.6, duration: 1 },
      weight: -10,
    },
    E03: {
      name: '🥶 극한 혹한',
      type: 'disaster',
      desc: '예상치 못한 혹한이 닥쳤습니다. 난방에 에너지 소비가 증가해 이번 라운드 에너지 재고가 추가 감소합니다.',
      effect: { target: 'energy', type: 'extra_consumption', value: 10, duration: 1 },
      weight: -10,
    },
    E04: {
      name: '⚙️ 주요 장비 고장',
      type: 'disaster',
      desc: '핵심 설비에 예상치 못한 고장이 발생했습니다. 건설팀이 대응하지 않으면 전체 팀 생산량이 20% 감소합니다.',
      effect: { target: 'all', type: 'production_mult', value: 0.8, duration: 1, construction_can_negate: true },
      weight: -12,
    },
    E05: {
      name: '💧 수질 오염',
      type: 'disaster',
      desc: '지하수 오염이 감지되었습니다. 물 재고가 즉시 감소하고 수자원팀 생산량도 줄어듭니다.',
      effect: { target: 'water', type: 'stock_damage', value: 12, also: { type: 'production_mult', value: 0.7, duration: 1 } },
      weight: -8,
    },
    E06: {
      name: '💨 산소 누출',
      type: 'disaster',
      desc: '거주 돔에서 산소 누출이 발생했습니다. 산소 재고가 즉시 감소합니다.',
      effect: { target: 'oxygen', type: 'stock_damage', value: 15, duration: 1 },
      weight: -10,
    },
    E07: {
      name: '😤 집단 피로 누적',
      type: 'disaster',
      desc: '장기간 극한 환경 노출로 대원들의 피로가 급격히 쌓였습니다. 모든 팀의 피로도가 2 증가합니다.',
      effect: { target: 'all_teams', type: 'fatigue_add', value: 2, duration: 1 },
      weight: -5,
    },
    E08: {
      name: '🌾 식량 부족 위기',
      type: 'disaster',
      desc: '냉동 식량이 손상되었습니다. 이번 라운드 식량 소비가 증가합니다.',
      effect: { target: 'food', type: 'extra_consumption', value: 12, duration: 1 },
      weight: -10,
    },
    E09: {
      name: '🦠 집단 감염',
      type: 'disaster',
      desc: '알 수 없는 바이러스가 확산되었습니다. 의료팀이 대응하지 않으면 모든 팀 피로도가 3 증가합니다.',
      effect: { target: 'all_teams', type: 'fatigue_add', value: 3, duration: 1, medical_can_negate: true },
      weight: -8,
    },
    // ── 호재 ──
    E10: {
      name: '🚀 지구 보급선 도착',
      type: 'bonus',
      desc: '지구에서 긴급 보급선이 도착했습니다! 식량과 물이 대량으로 보충됩니다.',
      effect: { target: ['food', 'water'], type: 'stock_add', value: 20, duration: 1 },
      weight: +15,
    },
    E11: {
      name: '💡 기술 혁신 성공',
      type: 'bonus',
      desc: '연구팀의 기술 혁신으로 생산 효율이 크게 향상되었습니다. 무작위 1개 팀의 생산량이 2라운드간 50% 증가합니다.',
      effect: { target: 'random_team', type: 'production_mult', value: 1.5, duration: 2 },
      weight: +13,
    },
    E12: {
      name: '🪨 희귀 광물 발견',
      type: 'bonus',
      desc: '대규모 희귀 광물 매장지가 발견되었습니다! 광물 재고가 크게 증가합니다.',
      effect: { target: 'mineral', type: 'stock_add', value: 25, duration: 1 },
      weight: +10,
    },
    NONE: {
      name: '이벤트 없음',
      type: 'none',
      desc: '이번 라운드는 특별한 이벤트 없이 평온하게 진행됩니다.',
      effect: null,
      weight: 0,
    },
  },
};

/* ================================================================
   이벤트 시퀀스 생성기
   15라운드 기준 누적 효과 -50%p 목표
   구간별로 재해/호재 배분 후 구간 내에서 랜덤 배치
================================================================ */
function generateEventSequence(totalRounds) {

  /* 구간별 이벤트 배치 계획 */
  const plan = [
    // 초반 (R1~5): 재해 2, 호재 1
    { rounds: [1, Math.floor(totalRounds * 0.33)],
      disasters: ['E02', 'E07'],  // 약한 재해
      bonuses:   ['E12'] },
    // 중반 (R6~10): 재해 3, 호재 1
    { rounds: [Math.floor(totalRounds * 0.33) + 1, Math.floor(totalRounds * 0.67)],
      disasters: ['E01', 'E05', 'E08'],
      bonuses:   ['E10'] },
    // 후반 (R11~끝): 재해 4, 호재 1
    { rounds: [Math.floor(totalRounds * 0.67) + 1, totalRounds],
      disasters: ['E03', 'E04', 'E06', 'E09'],
      bonuses:   ['E11'] },
  ];

  /* 각 구간에 이벤트를 랜덤 배치 */
  const sequence = {};
  for (let r = 1; r <= totalRounds; r++) sequence[r] = 'NONE';

  plan.forEach(seg => {
    const [start, end] = seg.rounds;
    const available = [];
    for (let r = start; r <= end; r++) available.push(r);

    /* 이벤트가 들어갈 라운드를 랜덤 선택 */
    const toPlace = [...seg.disasters, ...seg.bonuses];
    const shuffled = available.sort(() => Math.random() - 0.5);
    toPlace.forEach((code, i) => {
      if (shuffled[i]) sequence[shuffled[i]] = code;
    });
  });

  return sequence;
}

/* ================================================================
   자원 계산 엔진
   매 라운드 종료 시 호출되어 자원 재고를 갱신
================================================================ */
function calcRoundResult({ players, teams, resources, votes, eventCode, roundNum }) {
  const N = players.filter(p => p.role_confirmed).length;
  const result = {
    produced:     { oxygen: 0, food: 0, water: 0, energy: 0, mineral: 0 },
    consumed:     { oxygen: 0, food: 0, water: 0, energy: 0, mineral: 0 },
    team_results: {},
    event_applied: null,
    new_resources: { ...resources },
    new_teams:    {},
    warnings:     [],
    is_victory:   false,
    is_defeat:    false,
  };

  /* ── 이벤트 효과 미리 파악 ── */
  const evt = EP1.EVENTS[eventCode] || EP1.EVENTS.NONE;
  result.event_applied = evt;
  let globalProdMult   = 1.0;
  let extraConsumption = { oxygen: 0, food: 0, water: 0, energy: 0, mineral: 0 };
  let stockDamage      = { oxygen: 0, food: 0, water: 0, energy: 0, mineral: 0 };
  let allFatigueAdd    = 0;
  let perTeamProdMult  = {};

  if (evt.effect) {
    const ef = evt.effect;
    switch (ef.type) {
      case 'production_mult':
        if (ef.target === 'all')         globalProdMult = ef.value;
        else if (ef.target === 'random_team') {
          const prods = Object.keys(EP1.ROLES).filter(r => EP1.ROLES[r].resource);
          const pick  = prods[Math.floor(Math.random() * prods.length)];
          perTeamProdMult[pick] = ef.value;
          result.event_applied._resolved_target = pick;
        } else if (Array.isArray(ef.target)) {
          ef.target.forEach(t => perTeamProdMult[t] = ef.value);
        } else {
          perTeamProdMult[ef.target] = ef.value;
        }
        break;
      case 'extra_consumption':
        if (extraConsumption[ef.target] !== undefined)
          extraConsumption[ef.target] += ef.value;
        break;
      case 'stock_damage':
        if (stockDamage[ef.target] !== undefined)
          stockDamage[ef.target] += ef.value;
        if (ef.also?.type === 'production_mult')
          perTeamProdMult[ef.target] = ef.also.value;
        break;
      case 'stock_add': {
        const targets = Array.isArray(ef.target) ? ef.target : [ef.target];
        targets.forEach(t => { result.new_resources[t] = (result.new_resources[t] || 0) + ef.value; });
        break;
      }
      case 'fatigue_add':
        allFatigueAdd = ef.value;
        break;
    }
  }

  /* ── 팀별 결과 계산 ── */
  teams.forEach(team => {
    const role  = team.role;
    const roleDef = EP1.ROLES[role];
    const teamVotes = votes.filter(v => v.role === role);

    /* 다수결 집계 */
    const tally = { full: 0, normal: 0, maintenance: 0 };
    teamVotes.forEach(v => { if (tally[v.action] !== undefined) tally[v.action]++; });
    const decided = Object.keys(tally).reduce((a, b) => tally[a] >= tally[b] ? a : b, 'normal');

    const actionDef = EP1.ACTIONS[decided];
    let newFatigue  = Math.max(0, Math.min(10, team.fatigue + actionDef.fatigue_delta + allFatigueAdd));
    let newFacilityHP = team.facility_hp;
    let newNoMaint  = team.no_maintenance;

    /* 정기점검 처리 */
    if (decided === 'maintenance') {
      newNoMaint  = 0;
      newFacilityHP = Math.min(100, newFacilityHP + EP1.FACILITY.repair_per_check);
    } else {
      newNoMaint++;
      if (decided === 'full')
        newFacilityHP = Math.max(0, newFacilityHP - EP1.FACILITY.decay_per_round);
    }

    /* 생산량 계산 */
    let prodAmount = 0;
    if (roleDef.resource) {
      /* 기본 생산량 = 팀원 수 × 1인 생산량 */
      const memberCount = players.filter(p => p.role === role && p.role_confirmed).length;
      let prod = memberCount * roleDef.base_prod;

      /* 행동 배수 */
      prod *= actionDef.prod_mult;

      /* 피로도 배수 */
      const fatigMult = EP1.FATIGUE_MULT.find(f => newFatigue <= f.max)?.mult ?? 0;
      prod *= fatigMult;

      /* 시설 내구도 패널티 */
      if (newNoMaint >= EP1.FACILITY.penalty_threshold) {
        prod *= EP1.FACILITY.penalty_mult;
        result.warnings.push(`${roleDef.label}: 정기점검 지연으로 생산량 50% 감소`);
      }

      /* 전역 이벤트 배수 */
      prod *= globalProdMult;

      /* 팀별 이벤트 배수 */
      if (perTeamProdMult[roleDef.resource])
        prod *= perTeamProdMult[roleDef.resource];

      /* 건설팀 보강 */
      if (team.boosted) prod *= (1 + EP1.SUPPORT.construction_boost);

      prodAmount = Math.max(0, Math.round(prod));
      result.produced[roleDef.resource] += prodAmount;
    }

    /* 의료팀 피로도 회복 */
    if (team.healed) newFatigue = Math.max(0, newFatigue - EP1.SUPPORT.medical_fatigue_heal);

    result.team_results[role] = {
      action: decided, tally, prod: prodAmount,
      fatigue_before: team.fatigue, fatigue_after: newFatigue,
      facility_hp: newFacilityHP, no_maintenance: newNoMaint,
    };

    result.new_teams[role] = {
      status: newFatigue >= 10 ? 'exhausted' : decided === 'maintenance' ? 'maintenance' : 'alive',
      fatigue: newFatigue,
      facility_hp: newFacilityHP,
      no_maintenance: newNoMaint,
      boosted: false,
      healed:  false,
    };
  });

  /* ── 소비량 계산 ── */
  Object.keys(EP1.CONSUMPTION_PER_PLAYER).forEach(res => {
    result.consumed[res] = Math.round(N * EP1.CONSUMPTION_PER_PLAYER[res] + extraConsumption[res]);
  });

  /* ── 재고 갱신 ── */
  ['oxygen', 'food', 'water', 'energy', 'mineral'].forEach(res => {
    result.new_resources[res] = Math.max(0,
      (result.new_resources[res] || 0)
      + result.produced[res]
      - result.consumed[res]
      - (stockDamage[res] || 0)
    );
  });

  /* ── 경고 체크 ── */
  Object.keys(EP1.WARNING_THRESHOLD).forEach(res => {
    if (result.new_resources[res] <= EP1.WARNING_THRESHOLD[res])
      result.warnings.push(`⚠️ ${res} 재고 위험 (${result.new_resources[res]} 남음)`);
  });

  /* ── 패배 조건: 자원 3종 이상 고갈 ── */
  const depleted = ['oxygen', 'food', 'water', 'energy'].filter(r => result.new_resources[r] <= 0);
  if (depleted.length >= 2) {
    result.is_defeat = true;
    result.warnings.push(`💥 ${depleted.join(', ')} 고갈로 식민지 붕괴!`);
  }

  return result;
}

/* ================================================================
   루룸 코드 생성 (4자리 영문+숫자)
================================================================ */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/* ================================================================
   Supabase DB 헬퍼
================================================================ */
const DB = {

  /* ── 룸 ── */
  async createRoom({ roundMax = 15, hostName = '선생님' } = {}) {
    const code = generateRoomCode();
    const { error } = await _supa.from('ep1_rooms').insert({
      id: code, round_max: roundMax, host_name: hostName,
    });
    if (error) throw error;
    return code;
  },

  async getRoom(roomId) {
    const { data, error } = await _supa.from('ep1_rooms').select('*').eq('id', roomId).single();
    if (error) throw error;
    return data;
  },

  async updateRoom(roomId, updates) {
    const { error } = await _supa.from('ep1_rooms').update(updates).eq('id', roomId);
    if (error) throw error;
  },

  /* ── 자원 ── */
  async initResources(roomId, playerCount) {
    const init = {};
    Object.entries(EP1.INIT_STOCK_MULT).forEach(([res, mult]) => {
      init[res] = Math.round(playerCount * mult);
      init[res + '_init'] = init[res];
    });
    const { error } = await _supa.from('ep1_resources').upsert({ room_id: roomId, ...init });
    if (error) throw error;
  },

  async getResources(roomId) {
    const { data, error } = await _supa.from('ep1_resources').select('*').eq('room_id', roomId).single();
    if (error) throw error;
    return data;
  },

  async updateResources(roomId, updates) {
    const { error } = await _supa.from('ep1_resources')
      .update({ ...updates, updated_at: Date.now() }).eq('room_id', roomId);
    if (error) throw error;
  },

  /* ── 팀 ── */
  async initTeams(roomId) {
    const rows = Object.keys(EP1.ROLES).map(role => ({ room_id: roomId, role }));
    const { error } = await _supa.from('ep1_teams').insert(rows);
    if (error) throw error;
  },

  async getTeams(roomId) {
    const { data, error } = await _supa.from('ep1_teams').select('*').eq('room_id', roomId);
    if (error) throw error;
    return data;
  },

  async updateTeam(roomId, role, updates) {
    const { error } = await _supa.from('ep1_teams').update(updates).eq('room_id', roomId).eq('role', role);
    if (error) throw error;
  },

  /* ── 플레이어 ── */
  async joinRoom(roomId, playerId, name) {
    // 이미 존재하는 플레이어인지 먼저 확인 (재입장 시 role/confirmed 보존)
    const { data: existing } = await _supa.from('ep1_players')
      .select('id, role, role_confirmed').eq('id', playerId).maybeSingle();

    if (existing) {
      // 이미 입장한 플레이어 — 이름만 갱신, 역할 정보는 절대 건드리지 않음
      const { error } = await _supa.from('ep1_players')
        .update({ name }).eq('id', playerId);
      if (error) throw error;
      return;
    }

    // 신규 플레이어만 role: null로 insert
    const { error } = await _supa.from('ep1_players').insert({
      id: playerId, room_id: roomId, name, role: null, role_confirmed: false,
    });
    if (error) throw error;
  },

  async getPlayers(roomId) {
    const { data, error } = await _supa.from('ep1_players').select('*').eq('room_id', roomId);
    if (error) throw error;
    return data;
  },

  async selectRole(playerId, role) {
    const { error } = await _supa.from('ep1_players')
      .update({ role, role_confirmed: false }).eq('id', playerId);
    if (error) throw error;
  },

  async confirmRole(playerId) {
    const { error } = await _supa.from('ep1_players')
      .update({ role_confirmed: true }).eq('id', playerId);
    if (error) throw error;
  },

  /* ── 투표 ── */
  async submitVote(roomId, round, playerId, role, action, targets = []) {
    const { error } = await _supa.from('ep1_team_votes').upsert({
      room_id: roomId, round, player_id: playerId, role, action,
      target_role_1: targets[0] || null,
      target_role_2: targets[1] || null,
    }, { onConflict: 'room_id,round,player_id' });
    if (error) throw error;
    /* 플레이어 제출 상태 업데이트 */
    await _supa.from('ep1_players').update({ vote_submitted: true }).eq('id', playerId);
  },

  async getVotes(roomId, round) {
    const { data, error } = await _supa.from('ep1_team_votes')
      .select('*').eq('room_id', roomId).eq('round', round);
    if (error) throw error;
    return data;
  },

  /* ── 이벤트 ── */
  async initEvents(roomId, roundMax) {
    const seq = generateEventSequence(roundMax);
    const rows = Object.entries(seq).map(([round, code]) => {
      const evt = EP1.EVENTS[code];
      return {
        room_id: roomId, round: parseInt(round),
        event_code: code, event_name: evt.name,
        event_type: evt.type, effect: evt.effect,
        description: evt.desc,
      };
    });
    const { error } = await _supa.from('ep1_events').insert(rows);
    if (error) throw error;
  },

  async getEvent(roomId, round) {
    const { data, error } = await _supa.from('ep1_events')
      .select('*').eq('room_id', roomId).eq('round', round).single();
    if (error) throw error;
    return data;
  },

  async getUpcomingEvents(roomId, fromRound, count = 3) {
    const { data, error } = await _supa.from('ep1_events')
      .select('*').eq('room_id', roomId)
      .gte('round', fromRound).order('round').limit(count);
    if (error) throw error;
    return data;
  },

  async triggerEvent(roomId, round) {
    const { error } = await _supa.from('ep1_events')
      .update({ triggered: true }).eq('room_id', roomId).eq('round', round);
    if (error) throw error;
  },

  /* ── 라운드 로그 ── */
  async saveRoundLog(roomId, round, logData) {
    const { error } = await _supa.from('ep1_round_log').upsert({
      room_id: roomId, round, ...logData,
    }, { onConflict: 'room_id,round' });
    if (error) throw error;
  },

  async getRoundLog(roomId) {
    const { data, error } = await _supa.from('ep1_round_log')
      .select('*').eq('room_id', roomId).order('round');
    if (error) throw error;
    return data;
  },

  /* ── 실시간 구독 ── */
  subscribeRoom(roomId, callbacks) {
    return _supa.channel(`ep1_room_${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ep1_rooms',      filter: `id=eq.${roomId}` },         callbacks.onRoom      || (() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ep1_resources',  filter: `room_id=eq.${roomId}` },    callbacks.onResources || (() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ep1_teams',      filter: `room_id=eq.${roomId}` },    callbacks.onTeams     || (() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ep1_players',    filter: `room_id=eq.${roomId}` },    callbacks.onPlayers   || (() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ep1_team_votes', filter: `room_id=eq.${roomId}` },    callbacks.onVotes     || (() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ep1_events',     filter: `room_id=eq.${roomId}` },    callbacks.onEvents    || (() => {}))
      .subscribe();
  },

  /* ── 게임 시작 (진행자) ── */
  async startGame(roomId) {
    const room    = await DB.getRoom(roomId);
    const players = await DB.getPlayers(roomId);
    const confirmed = players.filter(p => p.role_confirmed).length;

    await DB.initResources(roomId, confirmed);
    await DB.initTeams(roomId);
    await DB.initEvents(roomId, room.round_max);
    await DB.updateRoom(roomId, {
      status: 'playing', round_current: 1, phase: 'voting',
      player_count: confirmed, started_at: Date.now(),
    });
    /* 모든 플레이어 제출 상태 초기화 */
    await _supa.from('ep1_players').update({ vote_submitted: false }).eq('room_id', roomId);
  },

  /* ── 라운드 종료 (진행자) ── */
  async resolveRound(roomId) {
    const room      = await DB.getRoom(roomId);
    const round     = room.round_current;
    const players   = await DB.getPlayers(roomId);
    const teams     = await DB.getTeams(roomId);
    const votes     = await DB.getVotes(roomId, round);
    const resources = await DB.getResources(roomId);
    const eventRow  = await DB.getEvent(roomId, round);

    await DB.updateRoom(roomId, { phase: 'resolving' });

    /* 건설/의료 지원 대상 팀에 플래그 설정 */
    const constructionVote = votes.find(v => v.role === 'construction');
    const medicalVote      = votes.find(v => v.role === 'medical');

    if (constructionVote?.target_role_1)
      await DB.updateTeam(roomId, constructionVote.target_role_1, { boosted: true });
    if (constructionVote?.target_role_2)
      await DB.updateTeam(roomId, constructionVote.target_role_2, { boosted: true });
    if (medicalVote?.target_role_1)
      await DB.updateTeam(roomId, medicalVote.target_role_1, { healed: true });
    if (medicalVote?.target_role_2)
      await DB.updateTeam(roomId, medicalVote.target_role_2, { healed: true });

    /* 최신 팀 상태 재조회 (boosted/healed 반영) */
    const teamsUpdated = await DB.getTeams(roomId);

    /* 자원 계산 */
    const calc = calcRoundResult({
      players, teams: teamsUpdated, resources,
      votes, eventCode: eventRow.event_code, roundNum: round,
    });

    /* 이벤트 triggered 처리 */
    await DB.triggerEvent(roomId, round);

    /* 팀 상태 업데이트 */
    for (const [role, teamUpdate] of Object.entries(calc.new_teams)) {
      await DB.updateTeam(roomId, role, teamUpdate);
    }

    /* 자원 업데이트 */
    await DB.updateResources(roomId, calc.new_resources);

    /* 라운드 로그 저장 */
    const isFinal = round >= room.round_max || calc.is_defeat;
    await DB.saveRoundLog(roomId, round, {
      res_start:   resources,
      res_end:     calc.new_resources,
      produced:    calc.produced,
      consumed:    calc.consumed,
      team_actions: calc.team_results,
      event_code:  eventRow.event_code,
      event_effect: eventRow.effect,
      is_final:    isFinal,
      colony_survived: isFinal ? !calc.is_defeat : null,
    });

    /* 다음 라운드 or 종료 */
    if (isFinal) {
      await DB.updateRoom(roomId, {
        status: 'finished', phase: 'finished', finished_at: Date.now(),
      });
    } else {
      await _supa.from('ep1_players').update({ vote_submitted: false }).eq('room_id', roomId);
      await DB.updateRoom(roomId, {
        round_current: round + 1, phase: 'voting',
      });
    }

    return calc;
  },
};

/* ================================================================
   유틸리티
================================================================ */
const Utils = {

  /* 플레이어 ID (로컬 스토리지에 영속) */
  getPlayerId() {
    let id = localStorage.getItem('ep1_player_id');
    if (!id) {
      id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      localStorage.setItem('ep1_player_id', id);
    }
    return id;
  },

  getPlayerName() { return localStorage.getItem('ep1_player_name') || ''; },
  setPlayerName(name) { localStorage.setItem('ep1_player_name', name); },
  getRoomId() { return localStorage.getItem('ep1_room_id') || ''; },
  setRoomId(id) { localStorage.setItem('ep1_room_id', id); },

  /* 자원 이모지 */
  resEmoji(res) {
    return { oxygen: '🌬', food: '🌾', water: '💧', energy: '⚡', mineral: '🪨' }[res] || '?';
  },

  /* 피로도 색상 */
  fatigueColor(f) {
    if (f <= 3)  return '#3ddc84';
    if (f <= 6)  return '#ffc245';
    if (f <= 9)  return '#ff8c42';
    return '#ff5c6a';
  },

  /* 재고 위험도 */
  stockDanger(res, amount) {
    return amount <= EP1.WARNING_THRESHOLD[res];
  },

  /* 숫자 포맷 */
  fmt(n) { return Math.round(n).toLocaleString(); },

  /* 토스트 (전역) */
  toast(msg, duration = 2500) {
    let el = document.getElementById('ep1-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ep1-toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'background:#222738;border:1px solid #2e3448;color:#e8eaf0;padding:10px 20px;' +
        'border-radius:20px;font-size:12px;z-index:9999;opacity:0;transition:opacity .3s;' +
        'pointer-events:none;font-family:monospace;white-space:nowrap;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
  },
};
