// ============================================================================
// 탐사 드론 매장량 스캐너 게이지
// 정확한 수치가 아니라 "오차 범위가 있는 추정치"라는 것을 시각적으로 강조합니다.
// ============================================================================
function confidenceLabel(margin) {
  if (margin <= 0.14) return '신뢰도 높음';
  if (margin <= 0.24) return '신뢰도 보통';
  return '신뢰도 낮음';
}

function renderScanner(el, { estimate, low, high, margin, capacity }) {
  const cx = 160, cy = 160, r = 130;
  const ticks = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 2 * Math.PI;
    const x1 = cx + Math.cos(a) * (r - 6), y1 = cy + Math.sin(a) * (r - 6);
    const x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
    ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--line)" stroke-width="2"/>`);
  }
  // 자원 비율에 따른 진행 아크 (참고용, 대략적인 시각 효과일 뿐 정확한 수치 아님)
  const ratio = capacity ? Math.max(0, Math.min(1, estimate / capacity)) : 0.5;
  const arcColor = ratio < 0.2 ? 'var(--alert)' : (ratio < 0.45 ? 'var(--rust-bright)' : 'var(--stable)');
  const circumference = 2 * Math.PI * (r - 18);
  const dash = circumference * ratio;

  el.innerHTML = `
    <div class="scanner">
      <svg viewBox="0 0 320 320">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="1"/>
        ${ticks.join('')}
        <circle cx="${cx}" cy="${cy}" r="${r - 18}" fill="none" stroke="var(--panel-raised)" stroke-width="6"/>
        <circle cx="${cx}" cy="${cy}" r="${r - 18}" fill="none" stroke="${arcColor}" stroke-width="6"
          stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"
          transform="rotate(-90 ${cx} ${cy})" opacity="0.85"/>
        <g class="sweep" opacity="0.5">
          <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 4}" stroke="var(--rust-bright)" stroke-width="2"/>
        </g>
      </svg>
      <div class="readout">
        <div class="val">≈ ${Math.round(estimate)}</div>
        <div class="range">추정 범위 ${Math.round(low)} ~ ${Math.round(high)}</div>
        <div class="label">${confidenceLabel(margin)} · 드론 스캔 오차 ±${Math.round(margin * 100)}%</div>
      </div>
    </div>
  `;
}
