/**
 * visualizers.js — Enhanced Wait-For Graph SVG Renderer
 * Supports: cycle highlighting, victim labeling, green/red state feedback
 */

function renderWaitForGraph(graph, containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { cycleNodes = [], victim = null } = options;

  const nodes = new Set();
  const edges = [];

  Object.entries(graph).forEach(([from, targets]) => {
    nodes.add(from);
    targets.forEach(to => {
      nodes.add(to);
      edges.push({ from, to });
    });
  });

  // ── Empty state ───────────────────────────────────────────────────────────
  if (nodes.size === 0) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:180px;gap:10px;color:var(--accent2)">
        <div style="font-size:2rem">✅</div>
        <div style="font-weight:600;font-size:.9rem">No Deadlock Detected</div>
        <div style="font-size:.75rem;color:var(--muted)">Wait-For Graph is empty — system healthy</div>
      </div>`;
    return;
  }

  const nodeArr = [...nodes];
  const W = container.clientWidth || 500;
  const H = 200;
  const cx = W / 2, cy = H / 2;
  const r  = Math.min(W, H) * 0.30;
  const pos = {};

  nodeArr.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodeArr.length - Math.PI / 2;
    pos[node] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg   = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width',  W);
  svg.setAttribute('height', H);
  svg.style.display = 'block';

  // ── Defs: arrowheads ─────────────────────────────────────────────────────
  const defs = document.createElementNS(svgNS, 'defs');
  [
    { id: 'arrow-normal', color: '#8b949e' },
    { id: 'arrow-cycle',  color: '#f78166' },
  ].forEach(({ id, color }) => {
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('markerWidth',  '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', 'M0,0 L0,6 L8,3 z');
    p.setAttribute('fill', color);
    marker.appendChild(p);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  // ── Determine cycle edges ─────────────────────────────────────────────────
  const isCycleEdge = (from, to) => {
    if (cycleNodes.length < 2) return false;
    for (let i = 0; i < cycleNodes.length - 1; i++) {
      if (cycleNodes[i] === from && cycleNodes[i + 1] === to) return true;
    }
    return false;
  };

  // ── Draw edges ────────────────────────────────────────────────────────────
  edges.forEach(({ from, to }) => {
    const p1 = pos[from], p2 = pos[to];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const NODE_R = 22;
    const startX = p1.x + (dx / len) * NODE_R;
    const startY = p1.y + (dy / len) * NODE_R;
    const endX   = p2.x - (dx / len) * NODE_R;
    const endY   = p2.y - (dy / len) * NODE_R;

    const isRed  = isCycleEdge(from, to);
    const line   = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', startX); line.setAttribute('y1', startY);
    line.setAttribute('x2', endX);   line.setAttribute('y2', endY);
    line.setAttribute('stroke', isRed ? '#f78166' : '#8b949e');
    line.setAttribute('stroke-width', isRed ? '2.5' : '1.8');
    line.setAttribute('stroke-dasharray', isRed ? '0' : '4,2');
    line.setAttribute('marker-end', `url(#${isRed ? 'arrow-cycle' : 'arrow-normal'})`);
    // Animated dash for cycle edges
    if (isRed) {
      const anim = document.createElementNS(svgNS, 'animate');
      anim.setAttribute('attributeName', 'stroke-dashoffset');
      anim.setAttribute('from', '0'); anim.setAttribute('to', '-20');
      anim.setAttribute('dur', '1s'); anim.setAttribute('repeatCount', 'indefinite');
      line.appendChild(anim);
      line.setAttribute('stroke-dasharray', '6,3');
    }
    svg.appendChild(line);

    // Edge label showing "waits for"
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2 - 6;
    const lbl  = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('x', midX); lbl.setAttribute('y', midY);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', isRed ? '#f78166' : '#8b949e');
    lbl.setAttribute('font-size', '9');
    lbl.setAttribute('font-family', 'Inter, sans-serif');
    lbl.textContent = 'waits';
    svg.appendChild(lbl);
  });

  // ── Draw nodes ────────────────────────────────────────────────────────────
  nodeArr.forEach(node => {
    const { x, y } = pos[node];
    const isInCycle  = cycleNodes.includes(node);
    const isVictim   = node === victim;

    // Glow effect for cycle nodes
    if (isInCycle) {
      const glow = document.createElementNS(svgNS, 'circle');
      glow.setAttribute('cx', x); glow.setAttribute('cy', y); glow.setAttribute('r', 28);
      glow.setAttribute('fill', isVictim ? 'rgba(227,179,65,0.15)' : 'rgba(247,129,102,0.15)');
      glow.setAttribute('stroke', 'none');
      svg.appendChild(glow);
    }

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', 22);
    circle.setAttribute('fill', isVictim ? '#2a1f00' : isInCycle ? '#2a1000' : '#1e2530');
    circle.setAttribute('stroke', isVictim ? '#e3b341' : isInCycle ? '#f78166' : '#58a6ff');
    circle.setAttribute('stroke-width', isInCycle ? '2.5' : '1.8');
    svg.appendChild(circle);

    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', x); text.setAttribute('y', y + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', isVictim ? '#e3b341' : isInCycle ? '#f78166' : '#e6edf3');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-family', 'JetBrains Mono, monospace');
    text.setAttribute('font-weight', '700');
    text.textContent = node;
    svg.appendChild(text);

    // Victim label
    if (isVictim) {
      const vlbl = document.createElementNS(svgNS, 'text');
      vlbl.setAttribute('x', x); vlbl.setAttribute('y', y + 36);
      vlbl.setAttribute('text-anchor', 'middle');
      vlbl.setAttribute('fill', '#e3b341');
      vlbl.setAttribute('font-size', '9');
      vlbl.setAttribute('font-family', 'Inter, sans-serif');
      vlbl.setAttribute('font-weight', '600');
      vlbl.textContent = '⚡ VICTIM';
      svg.appendChild(vlbl);
    }
  });

  // ── Deadlock banner ───────────────────────────────────────────────────────
  if (cycleNodes.length > 0) {
    const banner = document.createElementNS(svgNS, 'text');
    banner.setAttribute('x', W / 2); banner.setAttribute('y', 14);
    banner.setAttribute('text-anchor', 'middle');
    banner.setAttribute('fill', '#f78166');
    banner.setAttribute('font-size', '11');
    banner.setAttribute('font-family', 'Inter, sans-serif');
    banner.setAttribute('font-weight', '700');
    banner.textContent = `🔴 DEADLOCK: ${cycleNodes.join(' → ')}`;
    if (victim) banner.textContent += `  |  ⚡ Victim: ${victim}`;
    svg.appendChild(banner);
  }

  container.innerHTML = '';
  container.appendChild(svg);
}
