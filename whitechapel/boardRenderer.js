// ============================================================
// Mist Chase - 보드 렌더러
// board.json 데이터를 받아 SVG로 그리고, 노드 클릭 이벤트를 위임한다.
// ============================================================

/**
 * @param {SVGElement} svgEl - 미리 준비된 <svg> 엘리먼트
 * @param {object} board - board.json 파싱 결과
 * @param {(nodeId: string) => void} onNodeClick
 */
export function renderBoard(svgEl, board, onNodeClick) {
  svgEl.setAttribute('viewBox', `0 0 ${board.canvas.width} ${board.canvas.height}`);
  svgEl.innerHTML = '';

  const districtColor = Object.fromEntries(board.districts.map(d => [d.id, d.color]));

  // 엣지 먼저 그려서 노드 아래 깔리게
  for (const edge of board.edges) {
    const from = board.nodes.find(n => n.id === edge.from);
    const to = board.nodes.find(n => n.id === edge.to);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y);
    line.setAttribute('stroke', edge.type === 'shortcut' ? '#b48a3f' : '#555');
    line.setAttribute('stroke-width', edge.type === 'shortcut' ? '2' : '1');
    if (edge.type === 'shortcut') line.setAttribute('stroke-dasharray', '4,3');
    svgEl.appendChild(line);
  }

  for (const node of board.nodes) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-node-id', node.id);
    g.style.cursor = 'pointer';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', node.x);
    circle.setAttribute('cy', node.y);
    circle.setAttribute('r', 10);
    circle.setAttribute('fill', districtColor[node.district] || '#888');
    circle.setAttribute('stroke', '#222');
    circle.setAttribute('stroke-width', '1');
    g.appendChild(circle);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', node.x);
    label.setAttribute('y', node.y - 16);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', '#ccc');
    label.textContent = node.id;
    g.appendChild(label);

    g.addEventListener('click', () => onNodeClick(node.id));
    svgEl.appendChild(g);
  }
}

/** 특정 노드에 말(그림자/형사) 마커를 겹쳐 그린다 */
export function renderTokens(svgEl, board, tokens) {
  svgEl.querySelectorAll('.mc-token').forEach(el => el.remove());

  for (const token of tokens) {
    const node = board.nodes.find(n => n.id === token.node);
    if (!node) continue;

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('class', 'mc-token');
    marker.setAttribute('cx', node.x);
    marker.setAttribute('cy', node.y);
    marker.setAttribute('r', 6);
    marker.setAttribute('fill', token.color || '#fff');
    marker.setAttribute('stroke', '#000');
    marker.setAttribute('stroke-width', '1');
    svgEl.appendChild(marker);

    if (token.label) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', 'mc-token');
      t.setAttribute('x', node.x);
      t.setAttribute('y', node.y + 22);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '9');
      t.setAttribute('fill', '#fff');
      t.textContent = token.label;
      svgEl.appendChild(t);
    }
  }
}

/** 특정 노드 목록을 강조 표시 (이동 가능한 후보) */
export function highlightNodes(svgEl, nodeIds) {
  svgEl.querySelectorAll('[data-node-id]').forEach(g => {
    const active = nodeIds.includes(g.getAttribute('data-node-id'));
    g.querySelector('circle').setAttribute('stroke', active ? '#ffd76a' : '#222');
    g.querySelector('circle').setAttribute('stroke-width', active ? '3' : '1');
  });
}
