// ============================================================
// Mist Chase - 형사 로테이션 로직
// "아직 형사를 안 해본 학생"을 우선으로 공평하게 추첨한다.
// ============================================================

const DETECTIVE_COUNT = 5; // 원작 기준 4~5명, 필요시 조정

/**
 * 새 판을 시작할 때 호출한다.
 * 1) 접속 중인 학생 중 played_this_cycle = false 인 학생을 우선 추첨
 * 2) 부족하면 played_this_cycle = true 인 학생으로 채움
 * 3) 선발된 학생은 played_this_cycle = true, times_played += 1 로 갱신
 * 4) 전원이 played_this_cycle = true 가 되면 사이클 리셋 후 cycle_number 증가
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} sessionId
 * @returns {Promise<{ detectives: object[], spectators: object[] }>}
 */
async function selectDetectivesForNewGame(supabase, sessionId) {
  const { data: players, error } = await supabase
    .from('mistchase_players')
    .select('*')
    .eq('session_id', sessionId)
    .eq('connected', true);

  if (error) throw error;
  if (!players || players.length === 0) {
    throw new Error('접속 중인 학생이 없습니다.');
  }

  const notPlayedYet = shuffle(players.filter(p => !p.played_this_cycle));
  const alreadyPlayed = shuffle(players.filter(p => p.played_this_cycle));

  const neededCount = Math.min(DETECTIVE_COUNT, players.length);

  let detectives = notPlayedYet.slice(0, neededCount);

  // 아직 안 해본 학생만으로 인원이 부족하면 이미 해본 학생으로 보충
  if (detectives.length < neededCount) {
    const shortfall = neededCount - detectives.length;
    detectives = detectives.concat(alreadyPlayed.slice(0, shortfall));
  }

  const detectiveIds = new Set(detectives.map(d => d.id));
  const spectators = players.filter(p => !detectiveIds.has(p.id));

  // 선발된 학생들 상태 갱신
  await Promise.all(
    detectives.map((d, idx) =>
      supabase
        .from('mistchase_players')
        .update({
          played_this_cycle: true,
          times_played: d.times_played + 1,
        })
        .eq('id', d.id)
    )
  );

  // 사이클 완료 여부 확인 (선발 후 기준으로 전원 played_this_cycle = true 인지)
  const { data: refreshed, error: refreshError } = await supabase
    .from('mistchase_players')
    .select('played_this_cycle')
    .eq('session_id', sessionId)
    .eq('connected', true);

  if (refreshError) throw refreshError;

  const cycleComplete = refreshed.every(p => p.played_this_cycle);

  if (cycleComplete) {
    await supabase
      .from('mistchase_players')
      .update({ played_this_cycle: false })
      .eq('session_id', sessionId);

    const { data: session, error: sessionError } = await supabase
      .from('mistchase_sessions')
      .select('cycle_number')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;

    await supabase
      .from('mistchase_sessions')
      .update({ cycle_number: session.cycle_number + 1 })
      .eq('id', sessionId);
  }

  return {
    detectives: detectives.map((d, idx) => ({ ...d, slotNumber: idx + 1 })),
    spectators,
  };
}

/** 새 게임(판) 레코드 생성 + 배정(assignments) 기록까지 한 번에 처리 */
async function startNewGame(supabase, sessionId, gameNumber) {
  const { detectives, spectators } = await selectDetectivesForNewGame(supabase, sessionId);

  const { data: game, error: gameError } = await supabase
    .from('mistchase_games')
    .insert({
      session_id: sessionId,
      game_number: gameNumber,
      status: 'active',
      current_turn: 0,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (gameError) throw gameError;

  const assignmentRows = [
    ...detectives.map(d => ({
      game_id: game.id,
      player_id: d.id,
      role: 'detective',
      slot_number: d.slotNumber,
      current_node: null, // 시작 노드는 별도 초기 배치 로직에서 지정
    })),
    ...spectators.map(s => ({
      game_id: game.id,
      player_id: s.id,
      role: 'spectator',
      slot_number: null,
      current_node: null,
    })),
  ];

  const { error: assignError } = await supabase
    .from('mistchase_assignments')
    .insert(assignmentRows);

  if (assignError) throw assignError;

  return { game, detectives, spectators };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { selectDetectivesForNewGame, startNewGame, DETECTIVE_COUNT };
