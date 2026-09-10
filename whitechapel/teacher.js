import { supabase } from './supabaseClient.js';
import { renderBoard, renderTokens, highlightNodes } from './boardRenderer.js';
import { startNewGame } from './rotation.js';
import { buildAdjacency, canShadowMove, processShadowMove, REVEAL_TURNS, TOTAL_TURNS } from './gameEngine.js';

const FLAVOR_TEXTS = [
  '그림자가 스쳐 지나갔다는 소문이 돕니다.',
  '누군가 안개 속에서 발소리를 들었다고 합니다.',
  '가로등 아래 잠깐 그림자가 비쳤습니다.',
  '벽에 낯선 그림자가 드리워졌다는 목격담입니다.',
];

let board = null;
let sessionId = localStorage.getItem('mc_teacher_session_id');
let teacherToken = localStorage.getItem('mc_teacher_token');
let currentGame = null;
let gameState = null; // { shadowNode, currentTurn, detectivePositions }
let pendingMove = null;

const svgEl = document.getElementById('boardSvg');

async function init() {
  const res = await fetch('./board.json');
  board = await res.json();

  if (sessionId && teacherToken) {
    showLobby();
    subscribeToPlayers();
  } else {
    document.getElementById('createSessionBtn').addEventListener('click', createSession);
  }

  document.getElementById('startGameBtn').addEventListener('click', onStartGame);
  document.getElementById('confirmMoveBtn').addEventListener('click', onConfirmMove);
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 문자(0/O, 1/I) 제외
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function createSession() {
  teacherToken = crypto.randomUUID();
  const joinCode = generateJoinCode();

  const { data, error } = await supabase
    .from('mistchase_sessions')
    .insert({ teacher_token: teacherToken, join_code: joinCode, status: 'lobby' })
    .select()
    .single();

  if (error) return alert('세션 생성 실패: ' + error.message);

  sessionId = data.id;
  localStorage.setItem('mc_teacher_session_id', sessionId);
  localStorage.setItem('mc_teacher_token', teacherToken);
  localStorage.setItem('mc_teacher_join_code', joinCode);

  showLobby(joinCode);
  subscribeToPlayers();
}

function showLobby(joinCode) {
  document.getElementById('sessionInfo').style.display = 'block';
  document.getElementById('sessionCode').textContent = joinCode || localStorage.getItem('mc_teacher_join_code');
}

function subscribeToPlayers() {
  refreshPlayerList();
  supabase
    .channel(`mc_players_${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mistchase_players', filter: `session_id=eq.${sessionId}` },
      refreshPlayerList)
    .subscribe();
}

async function refreshPlayerList() {
  const { data } = await supabase
    .from('mistchase_players')
    .select('*')
    .eq('session_id', sessionId)
    .eq('connected', true);

  document.getElementById('playerCount').textContent = data.length;
  document.getElementById('playerList').innerHTML = data
    .map(p => `<li>${p.pseudonym} ${p.times_played > 0 ? `(참여 ${p.times_played}회)` : ''}</li>`)
    .join('');
}

async function onStartGame() {
  const { data: prevGames } = await supabase
    .from('mistchase_games')
    .select('game_number')
    .eq('session_id', sessionId)
    .order('game_number', { ascending: false })
    .limit(1);

  const gameNumber = prevGames && prevGames.length ? prevGames[0].game_number + 1 : 1;

  const { game, detectives } = await startNewGame(supabase, sessionId, gameNumber);
  currentGame = game;

  // 시작 위치: 안개거리 중심(MS3)에서 출발, 형사는 역 앞 노드에 분산 배치 (임시 규칙)
  const startNodes = ['ST1', 'ST2', 'ST3', 'ST4', 'ST5'];
  gameState = {
    shadowNode: 'MS3',
    currentTurn: 0,
    detectivePositions: detectives.map((d, i) => ({
      playerId: d.id,
      slot: d.slotNumber,
      node: startNodes[i] || 'ST6',
    })),
  };

  await Promise.all(
    gameState.detectivePositions.map(d =>
      supabase.from('mistchase_assignments')
        .update({ current_node: d.node })
        .eq('game_id', game.id)
        .eq('player_id', d.playerId)
    )
  );

  document.getElementById('lobbyView').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';

  renderBoard(svgEl, board, onNodeClick);
  updateGameView();
  subscribeToAssignments();
}

function subscribeToAssignments() {
  supabase
    .channel(`mc_assignments_${currentGame.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mistchase_assignments', filter: `game_id=eq.${currentGame.id}` },
      payload => {
        const updated = payload.new;
        gameState.detectivePositions = gameState.detectivePositions.map(d =>
          d.playerId === updated.player_id ? { ...d, node: updated.current_node } : d
        );
        updateGameView();
        checkForCapture();
      })
    .subscribe();
}

function checkForCapture() {
  const caught = gameState.detectivePositions.some(d => d.node === gameState.shadowNode);
  if (caught) endGame('caught');
}

function onNodeClick(nodeId) {
  const adjacency = buildAdjacency(board);
  if (!canShadowMove(adjacency, gameState.shadowNode, nodeId)) return;

  pendingMove = nodeId;
  highlightNodes(svgEl, [nodeId]);
  document.getElementById('confirmMoveBtn').disabled = false;
}

async function onConfirmMove() {
  if (!pendingMove) return;

  const result = processShadowMove(board, gameState, pendingMove);
  gameState.shadowNode = result.shadowNode;
  gameState.currentTurn = result.currentTurn;
  pendingMove = null;
  document.getElementById('confirmMoveBtn').disabled = true;

  await supabase.from('mistchase_games')
    .update({ current_turn: gameState.currentTurn })
    .eq('id', currentGame.id);

  if (result.revealClue) {
    const flavor = FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
    await supabase.from('mistchase_clues').insert({
      game_id: currentGame.id,
      turn_number: gameState.currentTurn,
      node_id: gameState.shadowNode,
      flavor_text: flavor,
    });
  }

  if (result.result === 'caught' || result.result === 'escaped') {
    endGame(result.result);
    return;
  }

  updateGameView();
}

async function endGame(result) {
  await supabase.from('mistchase_games')
    .update({ status: 'ended', result, ended_at: new Date().toISOString() })
    .eq('id', currentGame.id);

  alert(result === 'caught' ? '형사들이 그림자를 잡았습니다!' : '그림자가 끝까지 도망쳤습니다!');
  document.getElementById('gameView').style.display = 'none';
  document.getElementById('lobbyView').style.display = 'block';
}

function updateGameView() {
  document.getElementById('turnBadge').textContent = `턴 ${gameState.currentTurn} / ${TOTAL_TURNS}`;
  document.getElementById('currentNode').textContent = gameState.shadowNode;
  const next = REVEAL_TURNS.find(t => t > gameState.currentTurn);
  document.getElementById('nextReveal').textContent = next || '없음';

  const tokens = gameState.detectivePositions.map(d => ({ node: d.node, color: '#5dcaa5', label: `형사${d.slot}` }));
  tokens.push({ node: gameState.shadowNode, color: '#333', label: '그림자(비공개)' });
  renderTokens(svgEl, board, tokens);
}

init();
