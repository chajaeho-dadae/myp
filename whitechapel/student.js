import { supabase } from './supabaseClient.js';
import { renderBoard, renderTokens, highlightNodes } from './boardRenderer.js';
import { buildAdjacency, canDetectiveMove, TOTAL_TURNS } from './gameEngine.js';

let board = null;
let sessionId = null;
let player = null; // { id, pseudonym, session_token, ... }
let currentGame = null;
let myAssignment = null; // { role, slot_number, current_node }
let allAssignments = [];
let clues = [];
let pendingMove = null;

const svgEl = document.getElementById('boardSvg');

async function init() {
  const res = await fetch('./board.json');
  board = await res.json();

  const savedToken = localStorage.getItem('mc_student_session_token');
  if (savedToken) {
    const resumed = await resumePlayer(savedToken);
    if (resumed) return enterWaitingOrGame();
  }

  document.getElementById('joinBtn').addEventListener('click', onJoin);
}

async function resumePlayer(token) {
  const { data, error } = await supabase
    .from('mistchase_players')
    .select('*')
    .eq('session_token', token)
    .maybeSingle();

  if (error || !data) return false;

  player = data;
  sessionId = data.session_id;
  await supabase.from('mistchase_players').update({ connected: true, last_seen_at: new Date().toISOString() }).eq('id', player.id);
  return true;
}

async function onJoin() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  const pseudonym = document.getElementById('pseudonymInput').value.trim();
  if (!code || !pseudonym) return alert('참가 코드와 별명을 모두 입력하세요.');

  const { data: session, error: sessionError } = await supabase
    .from('mistchase_sessions')
    .select('*')
    .eq('join_code', code)
    .maybeSingle();

  if (sessionError || !session) return alert('참가 코드를 찾을 수 없습니다.');

  const sessionToken = crypto.randomUUID();
  const { data: newPlayer, error: playerError } = await supabase
    .from('mistchase_players')
    .insert({ session_id: session.id, pseudonym, session_token: sessionToken })
    .select()
    .single();

  if (playerError) return alert('입장 실패: ' + playerError.message);

  localStorage.setItem('mc_student_session_token', sessionToken);
  player = newPlayer;
  sessionId = session.id;

  enterWaitingOrGame();
}

async function enterWaitingOrGame() {
  document.getElementById('joinView').style.display = 'none';

  const { data: activeGame } = await supabase
    .from('mistchase_games')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .order('game_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeGame) {
    currentGame = activeGame;
    await loadAssignment();
    startGameView();
  } else {
    showWaiting();
  }

  subscribeToNewGames();
}

function showWaiting() {
  document.getElementById('waitingView').style.display = 'block';
  document.getElementById('gameView').style.display = 'none';
}

function subscribeToNewGames() {
  supabase
    .channel(`mc_games_${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mistchase_games', filter: `session_id=eq.${sessionId}` },
      async payload => {
        if (payload.new.status === 'active') {
          currentGame = payload.new;
          await loadAssignment();
          startGameView();
        } else if (payload.new.status === 'ended' && currentGame && payload.new.id === currentGame.id) {
          currentGame = null;
          alert(payload.new.result === 'caught' ? '형사들이 그림자를 잡았습니다!' : '그림자가 도망쳤습니다!');
          showWaiting();
        } else if (payload.new.current_turn !== undefined && currentGame && payload.new.id === currentGame.id) {
          currentGame = payload.new;
          document.getElementById('turnBadge').textContent = `턴 ${currentGame.current_turn} / ${TOTAL_TURNS}`;
        }
      })
    .subscribe();
}

async function loadAssignment() {
  const { data } = await supabase
    .from('mistchase_assignments')
    .select('*')
    .eq('game_id', currentGame.id);

  allAssignments = data;
  myAssignment = data.find(a => a.player_id === player.id);

  const { data: clueData } = await supabase
    .from('mistchase_clues')
    .select('*')
    .eq('game_id', currentGame.id)
    .order('turn_number');
  clues = clueData || [];
}

function startGameView() {
  document.getElementById('waitingView').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';
  document.getElementById('turnBadge').textContent = `턴 ${currentGame.current_turn} / ${TOTAL_TURNS}`;

  const isDetective = myAssignment.role === 'detective';
  document.getElementById('roleBadge').textContent = isDetective ? `형사 ${myAssignment.slot_number}번` : '관전 중';
  document.getElementById('moveControls').style.display = isDetective ? 'block' : 'none';

  renderBoard(svgEl, board, onNodeClick);
  renderClues();
  updateTokens();
  if (isDetective) renderMoveButtons();

  subscribeToAssignments();
  subscribeToClues();
}

function subscribeToAssignments() {
  supabase
    .channel(`mc_student_assignments_${currentGame.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mistchase_assignments', filter: `game_id=eq.${currentGame.id}` },
      payload => {
        allAssignments = allAssignments.map(a => a.id === payload.new.id ? payload.new : a);
        if (payload.new.player_id === player.id) myAssignment = payload.new;
        updateTokens();
        if (myAssignment.role === 'detective') renderMoveButtons();
      })
    .subscribe();
}

function subscribeToClues() {
  supabase
    .channel(`mc_clues_${currentGame.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mistchase_clues', filter: `game_id=eq.${currentGame.id}` },
      payload => {
        clues = [...clues, payload.new];
        renderClues();
        updateTokens();
      })
    .subscribe();
}

function onNodeClick(nodeId) {
  if (myAssignment.role !== 'detective') return;
  const adjacency = buildAdjacency(board);
  if (!canDetectiveMove(adjacency, myAssignment.current_node, nodeId)) return;

  pendingMove = nodeId;
  highlightNodes(svgEl, [nodeId]);
  document.getElementById('confirmMoveBtn').disabled = false;
}

function renderMoveButtons() {
  document.getElementById('myNode').textContent = myAssignment.current_node;
  const adjacency = buildAdjacency(board);
  const options = (adjacency[myAssignment.current_node] || []).filter(n => n.type === 'normal');

  const container = document.getElementById('moveButtons');
  container.innerHTML = '';
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'mc-btn';
    btn.textContent = `${opt.to} 로 이동`;
    btn.addEventListener('click', () => onNodeClick(opt.to));
    container.appendChild(btn);
  }
}

document.getElementById('confirmMoveBtn').addEventListener('click', async () => {
  if (!pendingMove) return;

  await supabase
    .from('mistchase_assignments')
    .update({ current_node: pendingMove })
    .eq('id', myAssignment.id);

  myAssignment = { ...myAssignment, current_node: pendingMove };
  pendingMove = null;
  document.getElementById('confirmMoveBtn').disabled = true;
  renderMoveButtons();
  updateTokens();
});

function updateTokens() {
  const tokens = allAssignments
    .filter(a => a.role === 'detective' && a.current_node)
    .map(a => ({ node: a.current_node, color: '#5dcaa5', label: `형사${a.slot_number}` }));

  const lastClue = clues[clues.length - 1];
  if (lastClue) tokens.push({ node: lastClue.node_id, color: '#b4544a', label: '목격 위치' });

  renderTokens(svgEl, board, tokens);
}

function renderClues() {
  document.getElementById('clueList').innerHTML = clues
    .map(c => `<li><span>${c.turn_number}턴</span><span>${c.flavor_text || c.node_id}</span></li>`)
    .join('') || '<li>아직 공개된 클루가 없습니다.</li>';
}

init();
