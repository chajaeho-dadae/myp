/* ================================================================
 *  스파이게임 (웹 멀티플레이) - 핵심 게임 엔진
 *  host.html / student.html 이 공통으로 <script src="mafia_game.js">
 *  로 불러와서 사용합니다.
 *
 *  원칙:
 *    - 모든 판정(탈락, 투표 집계, 승리조건)은 클라이언트 카운트를
 *      신뢰하지 않고 매번 DB를 다시 읽어서(재조회) 계산합니다.
 *    - 클라이언트는 상태를 "그리기"만 하고, 상태 변경은 반드시
 *      이 파일의 함수를 통해 Supabase에 씁니다.
 * ================================================================ */

// ================================================================
//  0. Supabase 클라이언트 초기화
// ================================================================
const SUPABASE_URL  = 'https://sdhpzypjqmowhrhxvvsj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RRyqMtpm4qI0BZ9gdIjTvw_XOnJiaHc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ================================================================
//  1. 상수
// ================================================================

// 특수역할 제외 우선순위 (앞에서부터 제외됨: 건달 → 테러리스트 → ... → 의사)
const SPECIAL_ROLES_PRIORITY = [
  'thug', 'terrorist', 'witch', 'politician', 'medium', 'police', 'doctor'
];

const ROLE_LABEL_KO = {
  mafia: '스파이', citizen: '시민', police: '경찰', doctor: '의사',
  terrorist: '테러리스트', medium: '영매사', politician: '정치인',
  witch: '마녀', thug: '건달',
};


// ================================================================
//  2. 유틸리티
// ================================================================

/** 배열을 무작위로 섞음 (Fisher-Yates) */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 스파이 팀 여부 (건달이 전향했으면 스파이 팀으로 계산) */
function isMafiaTeam(player) {
  return player.role === 'mafia' || player.thug_final_decision === 'mafia';
}

/** 4자리 숫자 방 코드 생성 */
function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** 행동 목록에서 target_player_id 다수결 계산 (동률이면 먼저 나온 값 채택) */
function majorityTarget(actions) {
  const tally = {};
  actions.forEach(a => {
    if (!a.target_player_id) return;
    tally[a.target_player_id] = (tally[a.target_player_id] || 0) + 1;
  });
  let best = null, bestCount = 0;
  for (const [id, count] of Object.entries(tally)) {
    if (count > bestCount) { best = id; bestCount = count; }
  }
  return best;
}


// ================================================================
//  3. 참가자 수(N) 기준 역할 기본값 자동계산
//     (7명 미달 시 시작불가 / 스파이 수 구간 계산 /
//      특수역할 7종 시도 후 초과시 우선순위대로 제외)
// ================================================================
function computeRoleDefaults(N) {
  if (N < 7) return { startable: false, reason: '최소 7명이 필요합니다.' };

  const mafiaCount = (N <= 14) ? 1 : (N <= 20) ? 2 : 3;

  const activeSpecials = [...SPECIAL_ROLES_PRIORITY];
  while (mafiaCount + activeSpecials.length > N) {
    activeSpecials.shift(); // 우선순위 맨 앞(건달부터) 제외
  }

  const civilianCount = N - mafiaCount - activeSpecials.length;

  return { startable: true, mafiaCount, activeSpecials, civilianCount };
}

/** 계산된 기본값을 mafia_role_settings 에 저장 (진행자가 이후 수동조정 가능) */
async function saveRoleDefaults(room_id, N) {
  const result = computeRoleDefaults(N);
  if (!result.startable) return result;

  const { mafiaCount, activeSpecials, civilianCount } = result;
  const settings = {
    room_id,
    mafia_count:        mafiaCount,
    police_enabled:      activeSpecials.includes('police'),
    doctor_enabled:       activeSpecials.includes('doctor'),
    medium_enabled:       activeSpecials.includes('medium'),
    politician_enabled:   activeSpecials.includes('politician'),
    witch_enabled:        activeSpecials.includes('witch'),
    thug_enabled:         activeSpecials.includes('thug'),
    terrorist_enabled:    activeSpecials.includes('terrorist'),
  };

  const { error } = await sb
    .from('mafia_role_settings')
    .upsert(settings, { onConflict: 'room_id' });

  return { startable: true, ...settings, civilianCount, error };
}


// ================================================================
//  4. 방 생성 / 입장
// ================================================================
async function createRoom() {
  const room_code = generateRoomCode();
  const { data, error } = await sb
    .from('mafia_rooms')
    .insert({ room_code })
    .select()
    .single();
  return { room: data, error };
}

async function joinRoom(room_code, nickname) {
  const { data: room, error: roomErr } = await sb
    .from('mafia_rooms')
    .select('*')
    .eq('room_code', room_code)
    .single();

  if (roomErr || !room) return { error: '방을 찾을 수 없습니다.' };
  if (room.phase !== 'lobby') return { error: '이미 게임이 시작되었습니다.' };

  const { data: player, error: playerErr } = await sb
    .from('mafia_players')
    .insert({ room_id: room.id, nickname })
    .select()
    .single();

  return { room, player, error: playerErr };
}


// ================================================================
//  5. 역할 배정 (게임 시작)
// ================================================================
async function assignRolesAndStart(room_id) {
  const { data: players } = await sb
    .from('mafia_players').select('*').eq('room_id', room_id);
  const { data: settings } = await sb
    .from('mafia_role_settings').select('*').eq('room_id', room_id).single();

  if (!players || !settings) return { error: 'players/settings 조회 실패' };

  const deck = [];
  for (let i = 0; i < settings.mafia_count; i++) deck.push('mafia');
  if (settings.police_enabled)     deck.push('police');
  if (settings.doctor_enabled)     deck.push('doctor');
  if (settings.medium_enabled)     deck.push('medium');
  if (settings.politician_enabled) deck.push('politician');
  if (settings.witch_enabled)      deck.push('witch');
  if (settings.thug_enabled)       deck.push('thug');
  if (settings.terrorist_enabled)  deck.push('terrorist');
  while (deck.length < players.length) deck.push('citizen');

  const shuffledDeck = shuffle(deck);

  await Promise.all(players.map((p, i) =>
    sb.from('mafia_players').update({ role: shuffledDeck[i] }).eq('id', p.id)
  ));

  await sb.from('mafia_rooms')
    .update({ phase: 'role_reveal', round: 0 }).eq('id', room_id);

  return { error: null };
}


// ================================================================
//  6. 밤 페이즈
// ================================================================
async function startNightPhase(room_id) {
  const { data: room } = await sb
    .from('mafia_rooms').select('round').eq('id', room_id).single();
  const nextRound = (room?.round || 0) + 1;

  await sb.from('mafia_rooms')
    .update({ round: nextRound, phase: 'night' }).eq('id', room_id);

  return nextRound;
}

/**
 * 학생이 밤 행동을 제출할 때 호출.
 * action_type: 'police_investigate' | 'doctor_protect' | 'mafia_kill_vote' |
 *              'witch_kill' | 'medium_investigate' | 'terrorist_chain_target'
 * 건달 전향(thug_convert_decision)은 이 함수를 쓰지 않고
 * submitThugDecision() 을 따로 사용합니다 (한 번 정하면 고정이라 처리 방식이 달라서).
 */
async function submitNightAction(room_id, round, actor_id, action_type, target_id) {
  const { error } = await sb.from('mafia_night_actions').upsert(
    { room_id, round, actor_player_id: actor_id, action_type, target_player_id: target_id },
    { onConflict: 'room_id,round,actor_player_id,action_type' }
  );
  return { error };
}

/** 건달 전향 결정 (한 번 저장되면 이후 재작성 차단) */
async function submitThugDecision(actor_id, decision /* 'mafia' | 'citizen' */) {
  const { data: existing } = await sb
    .from('mafia_players').select('thug_final_decision').eq('id', actor_id).single();

  if (existing?.thug_final_decision) {
    return { error: '이미 결정되었습니다. 변경할 수 없습니다.' };
  }
  const { error } = await sb
    .from('mafia_players').update({ thug_final_decision: decision }).eq('id', actor_id);
  return { error };
}

/** 생존 스파이가 정확히 1명인지 확인 (건달 전향 UI를 띄울지 판단하는 용도) */
async function checkThugTriggerCondition(room_id) {
  const { data: players } = await sb
    .from('mafia_players').select('*').eq('room_id', room_id).eq('is_alive', true);

  const aliveMafiaCount = players.filter(isMafiaTeam).length;
  const thug = players.find(p => p.role === 'thug' && !p.thug_final_decision);

  return { shouldPrompt: aliveMafiaCount === 1 && !!thug, thug };
}

async function killPlayer(room_id, round, player_id, cause) {
  await sb.from('mafia_players').update({ is_alive: false }).eq('id', player_id);
  await sb.from('mafia_death_log').insert({ room_id, round, player_id, cause });
}

/**
 * 밤이 끝나면 호출 — 모든 밤 행동을 재조회해서 탈락자 판정.
 * 판정 후 즉시 낮으로 넘어가지 않고 'night_result' 에서 멈춥니다.
 * 진행자가 탈락자 명단을 화면에 보여주고 확인한 뒤 startDayDiscussion() 을
 * 직접 호출해야 낮으로 넘어갑니다 (교사가 진행 속도를 조절할 수 있도록).
 */
async function resolveNight(room_id) {
  const { data: room } = await sb
    .from('mafia_rooms').select('round').eq('id', room_id).single();
  const round = room.round;

  const { data: actions } = await sb
    .from('mafia_night_actions').select('*').eq('room_id', room_id).eq('round', round);

  const doctorTarget = actions.find(a => a.action_type === 'doctor_protect')?.target_player_id;
  const witchTarget  = actions.find(a => a.action_type === 'witch_kill')?.target_player_id;
  const mafiaTarget  = majorityTarget(actions.filter(a => a.action_type === 'mafia_kill_vote'));

  const victims = new Set();
  if (mafiaTarget && mafiaTarget !== doctorTarget) victims.add(mafiaTarget);
  if (witchTarget && witchTarget !== doctorTarget) victims.add(witchTarget);

  for (const id of victims) {
    await killPlayer(room_id, round, id, 'night_kill');
  }

  const winner = await checkWinCondition(room_id);
  if (winner) {
    await sb.from('mafia_rooms').update({ phase: 'ended', winner }).eq('id', room_id);
  } else {
    await sb.from('mafia_rooms').update({ phase: 'night_result' }).eq('id', room_id);
  }

  return { winner, victimIds: [...victims] };
}

/**
 * 경찰/영매사 조사 결과는 별도로 저장하지 않고 조회 시 계산합니다.
 * police: target 이 스파이 팀인지 여부만 반환
 * medium: target(탈락자)의 실제 역할을 그대로 반환
 */
async function getInvestigationResult(kind, target_player_id) {
  const { data: target } = await sb
    .from('mafia_players').select('*').eq('id', target_player_id).single();
  if (!target) return null;

  if (kind === 'police') return { isMafiaTeam: isMafiaTeam(target) };
  if (kind === 'medium')  return { role: target.role, label: ROLE_LABEL_KO[target.role] };
  return null;
}


// ================================================================
//  7. 낮 페이즈
// ================================================================
async function startDayDiscussion(room_id) {
  await sb.from('mafia_rooms').update({ phase: 'day_discussion' }).eq('id', room_id);
}

async function startDayVote(room_id) {
  await sb.from('mafia_rooms').update({ phase: 'day_vote' }).eq('id', room_id);
}

/** weight: 기본 1, 정치인이 "2표 행사" 선언한 경우에만 2 */
async function submitVote(room_id, round, voteAttempt, voter_id, target_id, weight = 1) {
  const { error } = await sb.from('mafia_day_votes').upsert(
    { room_id, round, vote_attempt: voteAttempt, voter_player_id: voter_id,
      target_player_id: target_id, weight },
    { onConflict: 'room_id,round,vote_attempt,voter_player_id' }
  );
  return { error };
}

/**
 * 투표 마감 후 호출.
 * 반환값의 phase 를 보고 호출부(host.html)가 다음 화면을 결정:
 *   'revote'      → 동률, topTargets 만 후보로 재투표 UI 노출
 *   'day_result'  → 처형 결과 표시. 진행자가 확인 후 startNightPhase() 를
 *                   직접 호출해야 다음 밤으로 넘어감 (자동 진행 안 함)
 *   'ended'       → 게임 종료
 */
async function resolveDayVote(room_id, voteAttempt = 1) {
  const { data: room } = await sb
    .from('mafia_rooms').select('round').eq('id', room_id).single();
  const round = room.round;

  const { data: votes } = await sb
    .from('mafia_day_votes').select('*')
    .eq('room_id', room_id).eq('round', round).eq('vote_attempt', voteAttempt);

  const tally = {};
  votes.forEach(v => {
    if (!v.target_player_id) return; // 기권
    tally[v.target_player_id] = (tally[v.target_player_id] || 0) + v.weight;
  });

  const counts = Object.values(tally);
  const maxVotes = counts.length ? Math.max(...counts) : 0;
  const topTargets = Object.entries(tally).filter(([, c]) => c === maxVotes).map(([id]) => id);

  // 전원 기권, 또는 득표 자체가 없는 경우 → 처형 없음
  if (topTargets.length === 0) {
    await sb.from('mafia_rooms').update({ phase: 'day_result' }).eq('id', room_id);
    return { phase: 'day_result', executedId: null, immunized: false, chainKilledId: null };
  }

  // 동률 처리
  if (topTargets.length > 1) {
    if (voteAttempt === 1) {
      await sb.from('mafia_rooms')
        .update({ phase: 'day_vote_revote', revote_candidates: topTargets }).eq('id', room_id);
      return { phase: 'revote', topTargets };
    }
    // 재투표도 동률 → 그날은 처형 없음
    await sb.from('mafia_rooms').update({ phase: 'day_result' }).eq('id', room_id);
    return { phase: 'day_result', executedId: null, immunized: false, chainKilledId: null };
  }

  const targetId = topTargets[0];
  const { data: target } = await sb
    .from('mafia_players').select('*').eq('id', targetId).single();

  let immunized = false;
  let executedId = null;
  let chainKilledId = null;

  if (target.role === 'politician' && !target.politician_ability_used) {
    // 면책 발동: 처형 무효, 능력 소모
    await sb.from('mafia_players')
      .update({ politician_ability_used: true }).eq('id', targetId);
    await sb.from('mafia_events')
      .insert({ room_id, round, event_type: 'politician_immunity', player_id: targetId });
    immunized = true;

  } else if (target.role === 'terrorist') {
    await killPlayer(room_id, round, targetId, 'execution');
    executedId = targetId;

    const { data: chain } = await sb
      .from('mafia_night_actions').select('target_player_id')
      .eq('room_id', room_id).eq('round', round)
      .eq('action_type', 'terrorist_chain_target').eq('actor_player_id', targetId)
      .maybeSingle();

    if (chain?.target_player_id) {
      await killPlayer(room_id, round, chain.target_player_id, 'terrorist_chain');
      chainKilledId = chain.target_player_id;
    }

  } else {
    await killPlayer(room_id, round, targetId, 'execution');
    executedId = targetId;
  }

  const winner = await checkWinCondition(room_id);
  if (winner) {
    await sb.from('mafia_rooms').update({ phase: 'ended', winner }).eq('id', room_id);
    return { phase: 'ended', winner };
  }

  await sb.from('mafia_rooms').update({ phase: 'day_result' }).eq('id', room_id);
  return { phase: 'day_result', executedId, immunized, chainKilledId };
}


// ================================================================
//  8. 승리 조건
// ================================================================
async function checkWinCondition(room_id) {
  const { data: players } = await sb
    .from('mafia_players').select('role,thug_final_decision,is_alive')
    .eq('room_id', room_id).eq('is_alive', true);

  const aliveMafia  = players.filter(isMafiaTeam).length;
  const aliveOthers = players.length - aliveMafia;

  if (aliveMafia === 0) return 'citizen';
  if (aliveMafia >= aliveOthers) return 'mafia';
  return null;
}


// ================================================================
//  9. 유령 클릭 연출 (DB 저장 없이 Realtime Broadcast로만 처리)
// ================================================================
function getRoomBroadcastChannel(room_code) {
  return sb.channel(`mafia_ghost_${room_code}`);
}

/**
 * 탈락자가 대상을 골라 화면을 클릭했을 때(또는 진행자가 장난을 걸 때) 호출.
 * xPct/yPct: 보내는 쪽 화면 뷰포트 기준 클릭 위치 백분율(0~100).
 *   지정하지 않으면(null) 받는 쪽 화면에서 무작위 위치에 유령이 나타납니다.
 */
function broadcastGhost(channel, target_player_id, clicked_by_nickname, xPct = null, yPct = null) {
  channel.send({
    type: 'broadcast',
    event: 'ghost',
    payload: { target_player_id, clicked_by: clicked_by_nickname, xPct, yPct },
  });
}

/** target_player_id 가 자신이면 유령 애니메이션을 재생하도록 student.html 에서 사용 */
function listenForGhost(channel, myPlayerId, onGhost) {
  channel.on('broadcast', { event: 'ghost' }, ({ payload }) => {
    if (payload.target_player_id === myPlayerId) onGhost(payload);
  });
}


// ================================================================
//  10. Realtime 구독 헬퍼 (host.html / student.html 공용)
// ================================================================
function subscribeRoom(room_id, onChange) {
  return sb
    .channel(`mafia_room_watch_${room_id}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'mafia_rooms', filter: `id=eq.${room_id}` },
      onChange)
    .subscribe();
}

function subscribePlayers(room_id, onChange) {
  return sb
    .channel(`mafia_players_watch_${room_id}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'mafia_players', filter: `room_id=eq.${room_id}` },
      onChange)
    .subscribe();
}

function subscribeDayVotes(room_id, onChange) {
  return sb
    .channel(`mafia_votes_watch_${room_id}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'mafia_day_votes', filter: `room_id=eq.${room_id}` },
      onChange)
    .subscribe();
}

/** 이름까지 함께 붙여서 공개투표 현황을 가져옴 (host.html 실시간 현황판용) */
async function getVoteBoard(room_id, round, voteAttempt) {
  const { data } = await sb
    .from('mafia_day_votes')
    .select('*, voter:voter_player_id(nickname), target:target_player_id(nickname)')
    .eq('room_id', room_id).eq('round', round).eq('vote_attempt', voteAttempt);
  return data || [];
}

/** 특정 라운드의 밤 탈락자 id 목록 (새로고침 후에도 복원 가능) */
async function getNightResultInfo(room_id, round) {
  const { data } = await sb.from('mafia_death_log')
    .select('player_id').eq('room_id', room_id).eq('round', round).eq('cause', 'night_kill');
  return { victimIds: (data || []).map(d => d.player_id) };
}

/** 특정 라운드의 낮 처형 결과 (새로고침 후에도 복원 가능) */
async function getDayResultInfo(room_id, round) {
  const { data: deaths } = await sb.from('mafia_death_log')
    .select('player_id,cause').eq('room_id', room_id).eq('round', round)
    .in('cause', ['execution', 'terrorist_chain']);
  const { data: events } = await sb.from('mafia_events')
    .select('player_id').eq('room_id', room_id).eq('round', round)
    .eq('event_type', 'politician_immunity');

  const executed = (deaths || []).find(d => d.cause === 'execution');
  const chained  = (deaths || []).find(d => d.cause === 'terrorist_chain');

  return {
    executedId: executed?.player_id || null,
    chainKilledId: chained?.player_id || null,
    immunized: (events || []).length > 0,
    immunizedId: events?.[0]?.player_id || null,
  };
}

function subscribeDeathLog(room_id, onChange) {
  return sb
    .channel(`mafia_deathlog_watch_${room_id}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mafia_death_log', filter: `room_id=eq.${room_id}` },
      onChange)
    .subscribe();
}
