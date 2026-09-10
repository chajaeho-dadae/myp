// ============================================================
// Mist Chase - 게임 엔진 핵심 로직
// board.json 을 인자로 받아 순수 함수로 판정한다 (DB/네트워크 의존 없음)
// ============================================================

const TOTAL_TURNS = 20;
const REVEAL_TURNS = [3, 8, 13, 18];

/** board.json → { nodeId: [{ to, type }] } 형태의 인접 리스트로 변환 */
function buildAdjacency(board) {
  const adj = {};
  for (const node of board.nodes) adj[node.id] = [];

  for (const edge of board.edges) {
    adj[edge.from].push({ to: edge.to, type: edge.type });
    adj[edge.to].push({ to: edge.from, type: edge.type }); // 양방향
  }
  return adj;
}

/** 그림자는 일반 길 + 지하도 모두 이동 가능 */
function canShadowMove(adjacency, from, to) {
  const neighbors = adjacency[from] || [];
  return neighbors.some(n => n.to === to);
}

/** 형사는 지하도(shortcut) 이용 불가, 일반 길(normal)만 이동 가능 */
function canDetectiveMove(adjacency, from, to) {
  const neighbors = adjacency[from] || [];
  return neighbors.some(n => n.to === to && n.type === 'normal');
}

/**
 * 잡기 판정: 형사 말 중 하나라도 그림자와 같은 노드에 있으면 즉시 종료
 * @param {string} shadowNode
 * @param {{playerId: string, slot: number, node: string}[]} detectivePositions
 * @returns {{ caught: boolean, byDetective?: object }}
 */
function checkCapture(shadowNode, detectivePositions) {
  const caughtBy = detectivePositions.find(d => d.node === shadowNode);
  return caughtBy ? { caught: true, byDetective: caughtBy } : { caught: false };
}

/** 이 턴에 안개가 걷히는지 (그림자 이동 직후 호출) */
function shouldRevealClue(turnNumber) {
  return REVEAL_TURNS.includes(turnNumber);
}

/** 게임이 시간 초과로 끝났는지 (형사가 못 잡고 20턴 도달) */
function isGameOver(turnNumber) {
  return turnNumber >= TOTAL_TURNS;
}

/**
 * 그림자 이동 1턴 처리를 한 번에 묶은 헬퍼.
 * 실제 DB 반영은 호출부에서 이 결과를 보고 진행한다.
 */
function processShadowMove(board, gameState, toNode) {
  const adjacency = buildAdjacency(board);

  if (!canShadowMove(adjacency, gameState.shadowNode, toNode)) {
    throw new Error(`${gameState.shadowNode} 에서 ${toNode} 로 이동할 수 없습니다.`);
  }

  const nextTurn = gameState.currentTurn + 1;
  const capture = checkCapture(toNode, gameState.detectivePositions);
  const revealClue = shouldRevealClue(nextTurn);
  const gameOver = isGameOver(nextTurn);

  return {
    shadowNode: toNode,
    currentTurn: nextTurn,
    result: capture.caught ? 'caught' : gameOver ? 'escaped' : null,
    revealClue,
    caughtBy: capture.byDetective || null,
  };
}

/**
 * 형사 말 이동 처리. 이동 직후에도 잡기 판정을 한 번 더 수행한다
 * (형사가 먼저 그림자 위치로 들어오는 경우 대비 - 실제로는 위치가 비공개라 우연에 가깝다)
 */
function processDetectiveMove(board, gameState, playerId, toNode) {
  const adjacency = buildAdjacency(board);
  const current = gameState.detectivePositions.find(d => d.playerId === playerId);
  if (!current) throw new Error('해당 형사를 찾을 수 없습니다.');

  if (!canDetectiveMove(adjacency, current.node, toNode)) {
    throw new Error(`${current.node} 에서 ${toNode} 로 이동할 수 없습니다 (지하도는 형사 사용 불가).`);
  }

  const updatedPositions = gameState.detectivePositions.map(d =>
    d.playerId === playerId ? { ...d, node: toNode } : d
  );

  const capture = checkCapture(gameState.shadowNode, updatedPositions);

  return {
    detectivePositions: updatedPositions,
    result: capture.caught ? 'caught' : null,
    caughtBy: capture.byDetective || null,
  };
}

export {
  TOTAL_TURNS,
  REVEAL_TURNS,
  buildAdjacency,
  canShadowMove,
  canDetectiveMove,
  checkCapture,
  shouldRevealClue,
  isGameOver,
  processShadowMove,
  processDetectiveMove,
};
