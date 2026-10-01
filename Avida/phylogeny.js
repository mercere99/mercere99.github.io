/* Read-only phylogeny explorer. Topology is copied once when entering the paused Analyze view;
 * selecting a node asks C++ for its genome/traits without exporting a tracking snapshot. */
(function (root) {
  'use strict';
  const NONE = null;
  const colors = { living: '#65d7c5', ancestor: '#8095aa', root: '#c5a3ff',
    mrca: '#f5c56e', selected: '#ffffff', path: '#f5c56e', edge: '#3d5b70' };

  function buildModel(data) {
    const nodes = new Map(data.records.map(([id, parent, birth, death, depth, genome, maintained]) =>
      [id, { id, parent, birth, death, depth, genome, maintained, children: [], descendants: 0 }]));
    const roots = [];
    for (const node of nodes.values()) {
      if (node.parent === NONE) roots.push(node);
      else nodes.get(node.parent)?.children.push(node);
    }
    const byID = (a, b) => a.id - b.id;
    roots.sort(byID);
    for (const node of nodes.values()) node.children.sort(byID);
    const order = [], stack = [...roots].reverse();
    while (stack.length) {
      const node = stack.pop();
      order.push(node);
      for (let i = node.children.length - 1; i >= 0; --i) stack.push(node.children[i]);
    }
    for (let i = order.length - 1; i >= 0; --i) {
      const node = order[i];
      node.descendants = Number(node.death === NONE);
      for (const child of node.children) node.descendants += child.descendants;
    }
    return { ...data, nodes, roots, order,
      living: order.filter(n => n.death === NONE).length,
      genomes: new Set(order.map(n => n.genome)).size };
  }

  function lineage(model, id) {
    const result = new Set();
    for (let node = model.nodes.get(id); node; node = model.nodes.get(node.parent)) result.add(node.id);
    return result;
  }

  function layout(model, { compact = true, selected = NONE, isolated = false, axis = 'depth' } = {}) {
    const path = lineage(model, selected);
    const order = isolated ? model.order.filter(n => path.has(n.id)) : model.order;
    const included = new Set(order.map(n => n.id));
    const positions = new Map();
    let tip = 0;
    // Deterministic DFS ordering keeps related leaves adjacent, including separate injected roots.
    for (const node of order) {
      if (!node.children.some(child => included.has(child.id))) positions.set(node.id, tip++);
    }
    for (let i = order.length - 1; i >= 0; --i) {
      const node = order[i];
      if (positions.has(node.id)) continue;
      const children = node.children.filter(child => included.has(child.id));
      positions.set(node.id, (positions.get(children[0].id) + positions.get(children.at(-1).id)) / 2);
    }
    const nearest = new Map(), visible = [];
    for (const node of order) {
      const parent = nearest.get(node.parent) ?? NONE;
      const show = !compact || node.parent === NONE || node.death === NONE
        || node.children.length !== 1 || node.id === selected || node.id === model.mrca;
      nearest.set(node.id, show ? node.id : parent);
      if (show) visible.push({ node, parent, x: node[axis], y: positions.get(node.id),
        skipped: parent === NONE ? 0 : node.depth - model.nodes.get(parent).depth - 1 });
    }
    let min = Infinity, max = -Infinity;
    for (const item of visible) { min = Math.min(min, item.x); max = Math.max(max, item.x); }
    return { visible, path, tips: tip, count: order.length, min: visible.length ? min : 0,
      max: visible.length ? max : 0 };
  }

  let active = null;
  function unmount() {
    if (active) active.dispose();
    active = null;
  }

  function mount(data, inspect) {
    unmount();
    const host = document.getElementById('phylogeny_view');
    if (!host) return;
    const model = buildModel(data), canvas = host.querySelector('#phylogeny_canvas');
    const ctx = canvas.getContext('2d'), tooltip = host.querySelector('#phylogeny_tooltip');
    const $ = id => host.querySelector('#phylogeny_' + id);
    const controller = new AbortController();
    const on = (target, event, handler, options = {}) =>
      target.addEventListener(event, handler, { ...options, signal: controller.signal });
    let selected = NONE, isolated = false, graph, width = 800, height = 520;
    let scale = 1, panX = 0, panY = 0, drag = null, frame = 0, points = [];
    let message = '';
    const count = value => value.toLocaleString();
    const summary = [
      ['Update', model.update], ['Living', model.living],
      ['Retained ancestors', model.nodes.size - model.living], ['Shared genomes', model.genomes],
      ['Injected roots', model.roots.length], ['Population MRCA', model.mrca === NONE ? 'None' : `#${model.mrca}`]
    ];
    for (const [label, value] of summary) {
      const card = document.createElement('div'), name = document.createElement('span'), num = document.createElement('strong');
      name.textContent = label; num.textContent = typeof value === 'number' ? count(value) : value;
      card.append(name, num); $('summary').append(card);
    }
    host.dataset.records = model.nodes.size;
    host.dataset.living = model.living;
    $('mrca').disabled = model.mrca === NONE;
    let newestLiving = NONE;
    for (const node of model.order) {
      if (node.death === NONE && (newestLiving === NONE || node.id > newestLiving)) newestLiving = node.id;
    }
    $('living').disabled = newestLiving === NONE;

    function updateStatus() {
      $('parent').disabled = selected === NONE || model.nodes.get(selected).parent === NONE;
      $('lineage').disabled = selected === NONE;
      $('lineage').setAttribute('aria-pressed', String(isolated));
      host.dataset.selected = selected === NONE ? '' : selected;
      host.dataset.visible = graph.visible.length;
      host.dataset.isolated = String(isolated);
      const omitted = graph.count - graph.visible.length;
      $('status').textContent = message || (model.nodes.size
        ? `${count(graph.visible.length)} of ${count(graph.count)} records shown${omitted ? ` · ${count(omitted)} ancestors compressed` : ''}`
          + (isolated ? ' · Selected lineage only' : '')
          + (model.complete ? ' · Final state at run completion' : ' · Population paused')
        : 'No retained ancestry yet. Step or run a population in Population mode to begin.');
    }
    function rebuild(fit = false) {
      graph = layout(model, { compact: $('detail').value === 'compact', selected, isolated, axis: $('axis').value });
      if (fit) { scale = 1; panX = panY = 0; }
      updateStatus(); schedule();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
    function base(item) {
      return { x: graph.max === graph.min ? width / 2
        : 50 + (item.x - graph.min) / (graph.max - graph.min) * (width - 100),
        y: graph.tips === 1 ? height / 2 : 48 + item.y / (graph.tips - 1) * (height - 100) };
    }
    function screen(item) {
      const p = base(item);
      return { x: p.x * scale + panX, y: p.y * scale + panY };
    }
    function draw() {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0b1c29'; ctx.fillRect(0, 0, width, height);
      ctx.font = '12px system-ui';
      if (!graph.visible.length) {
        ctx.fillStyle = '#a9bdcb'; ctx.textAlign = 'center';
        ctx.fillText('No organisms are currently maintained.', width / 2, height / 2);
        points = []; return;
      }
      const positioned = new Map(graph.visible.map(item => [item.node.id, { ...item, ...screen(item) }]));
      ctx.save(); ctx.beginPath(); ctx.rect(0, 30, width, height - 60); ctx.clip();
      for (const highlight of [false, true]) {
        for (const item of positioned.values()) {
          const parent = positioned.get(item.parent);
          if (!parent || (graph.path.has(item.node.id) && graph.path.has(parent.node.id)) !== highlight) continue;
          if (Math.max(parent.x, item.x) < 0 || Math.min(parent.x, item.x) > width
            || Math.max(parent.y, item.y) < 30 || Math.min(parent.y, item.y) > height - 30) continue;
          ctx.strokeStyle = highlight ? colors.path : colors.edge;
          ctx.lineWidth = highlight ? 2.5 : 1.2;
          ctx.setLineDash(item.skipped ? [5, 4] : []);
          const mid = (parent.x + item.x) / 2;
          ctx.beginPath(); ctx.moveTo(parent.x, parent.y);
          ctx.bezierCurveTo(mid, parent.y, mid, item.y, item.x, item.y); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      points = [];
      const crowded = graph.visible.length > height / 8 * scale;
      // Draw selected nodes last so they remain visible in dense regions.
      for (const isSelected of [false, true]) for (const item of positioned.values()) {
        const { node, x, y } = item;
        if ((node.id === selected) !== isSelected || x < -10 || x > width + 10 || y < 30 || y > height - 30) continue;
        points.push(item);
        const radius = isSelected ? 6 : (crowded ? 2.5 : 4);
        ctx.fillStyle = node.death === NONE ? colors.living : colors.ancestor;
        ctx.beginPath();
        if (node.parent === NONE) {
          ctx.moveTo(x, y - radius - 1); ctx.lineTo(x + radius + 1, y);
          ctx.lineTo(x, y + radius + 1); ctx.lineTo(x - radius - 1, y); ctx.closePath();
          ctx.fillStyle = colors.root;
        } else ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
        if (node.id === model.mrca || isSelected) {
          ctx.strokeStyle = isSelected ? colors.selected : colors.mrca; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, radius + 3, 0, 2 * Math.PI); ctx.stroke();
        }
      }
      // Thin labels by screen-space occupancy, not record count: a single long lineage can
      // have few nodes but closely spaced IDs. Always reserve room for the selected label.
      const labelCells = new Set();
      for (const priority of [true, false]) for (const item of points) {
        const isSelected = item.node.id === selected;
        if (isSelected !== priority || (crowded && !isSelected)) continue;
        const text = `#${item.node.id}`, length = ctx.measureText(text).width;
        const left = Math.max(4, Math.min(item.x + 10, width - length - 4)), top = item.y - 21;
        const cells = [];
        for (let x = Math.floor(left / 32); x <= Math.floor((left + length + 6) / 32); ++x) {
          for (let y = Math.floor(top / 16); y <= Math.floor((top + 14) / 16); ++y) cells.push(`${x}:${y}`);
        }
        if (!isSelected && cells.some(key => labelCells.has(key))) continue;
        cells.forEach(key => labelCells.add(key));
        ctx.fillStyle = isSelected ? '#fff' : '#b9cedb'; ctx.textAlign = 'left';
        ctx.fillText(text, left, top + 13);
      }
      ctx.restore();
      ctx.fillStyle = '#0b1c29'; ctx.fillRect(0, height - 30, width, 30);
      ctx.fillStyle = '#a9bdcb'; ctx.textAlign = 'center';
      ctx.fillText($('axis').value === 'depth' ? 'Lineage generation →' : 'Birth update →', width / 2, height - 8);
      if (graph.max === graph.min) {
        ctx.fillText(count(graph.min), width / 2 * scale + panX, 20);
        return;
      }
      for (let i = 0; i <= 4; ++i) {
        const x = 50 + i / 4 * (width - 100);
        const value = graph.min + ((x - panX) / scale - 50) / (width - 100) * Math.max(1, graph.max - graph.min);
        if (value < graph.min - .01 || value > graph.max + .01) continue;
        ctx.fillText(Number(value.toFixed(1)).toLocaleString(), x, 20);
        ctx.strokeStyle = '#1d3646'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 27); ctx.lineTo(x, 33); ctx.stroke();
      }
    }
    function resize() {
      width = Math.max(200, canvas.clientWidth); height = Math.max(300, canvas.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      schedule();
    }
    function zoom(factor, x = width / 2, y = height / 2) {
      const next = Math.max(.5, Math.min(512, scale * factor));
      panX = x - (x - panX) * next / scale; panY = y - (y - panY) * next / scale;
      scale = next; schedule();
    }
    function select(id, center = false) {
      if (!model.nodes.has(id)) {
        message = `Organism #${id} is not maintained in this phylogeny.`; updateStatus(); return;
      }
      selected = id; message = ''; $('id').value = String(id);
      rebuild(isolated);
      if (center) {
        const item = graph.visible.find(n => n.node.id === id), point = base(item);
        panX = width / 2 - point.x * scale; panY = height / 2 - point.y * scale;
      }
      inspect(id); schedule();
    }
    function point(event) {
      const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    function nearest(p) {
      let best = null, distance = 144;
      for (const item of points) {
        const d = (p.x - item.x) ** 2 + (p.y - item.y) ** 2;
        if (d <= distance) { distance = d; best = item; }
      }
      return best;
    }
    on($('axis'), 'change', () => { message = ''; rebuild(true); });
    on($('detail'), 'change', () => { message = ''; rebuild(); });
    on($('fit'), 'click', () => { message = ''; rebuild(true); });
    on($('all'), 'click', () => { isolated = false; message = ''; rebuild(true); });
    on($('zoom_in'), 'click', () => zoom(1.6));
    on($('zoom_out'), 'click', () => zoom(1 / 1.6));
    on($('mrca'), 'click', () => select(model.mrca, true));
    on($('living'), 'click', () => select(newestLiving, true));
    on($('parent'), 'click', () => select(model.nodes.get(selected).parent, true));
    on($('lineage'), 'click', () => { isolated = !isolated; message = ''; rebuild(true); });
    on($('search'), 'submit', event => {
      event.preventDefault();
      const value = $('id').value.trim();
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        message = 'Enter a non-negative whole organism ID.'; updateStatus(); return;
      }
      select(Number(value), true);
    });
    on(canvas, 'wheel', event => {
      event.preventDefault(); const p = point(event); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .008), p.x, p.y);
    }, { passive: false });
    on(canvas, 'pointerdown', event => {
      if (event.button !== 0) return;
      canvas.focus(); canvas.setPointerCapture(event.pointerId);
      drag = { ...point(event), panX, panY, moved: false }; tooltip.hidden = true;
    });
    on(canvas, 'pointermove', event => {
      const p = point(event);
      if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        drag.moved ||= Math.hypot(dx, dy) > 4;
        if (drag.moved) { panX = drag.panX + dx; panY = drag.panY + dy; schedule(); }
        return;
      }
      const hit = nearest(p); tooltip.hidden = !hit;
      if (hit) {
        tooltip.textContent = `#${hit.node.id} · ${hit.node.death === NONE ? 'Living' : 'Ancestor'} · Generation ${hit.node.depth}`
          + ` · ${hit.node.descendants} living in subtree` + (hit.skipped ? ` · ${hit.skipped} ancestors compressed before this node` : '');
        tooltip.style.left = `${Math.max(0, Math.min(p.x + 12, width - 260))}px`;
        tooltip.style.top = `${Math.max(0, p.y - 55)}px`;
      }
    });
    on(canvas, 'pointerup', event => {
      if (drag && !drag.moved) { const hit = nearest(point(event)); if (hit) select(hit.node.id); }
      drag = null;
    });
    on(canvas, 'pointercancel', () => { drag = null; });
    on(canvas, 'pointerleave', () => { tooltip.hidden = true; });
    on(canvas, 'keydown', event => {
      if (event.key === '+' || event.key === '=') zoom(1.6);
      else if (event.key === '-') zoom(1 / 1.6);
      else if (event.key === 'Home') rebuild(true);
      else if (event.key.startsWith('Arrow') && graph.visible.length) {
        const node = model.nodes.get(selected);
        if (event.key === 'ArrowLeft' && node?.parent !== NONE && node) select(node.parent, true);
        else if (event.key === 'ArrowRight' && node?.children.length) select(node.children[0].id, true);
        else {
          const index = graph.visible.findIndex(n => n.node.id === selected);
          const offset = event.key === 'ArrowUp' ? -1 : 1;
          select(graph.visible[(index + offset + graph.visible.length) % graph.visible.length].node.id, true);
        }
      } else return;
      event.preventDefault();
    });
    rebuild(true);
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    active = { dispose() { observer.disconnect(); controller.abort(); if (frame) cancelAnimationFrame(frame); } };
  }

  const api = { buildModel, lineage, layout, mount, unmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.avidaPhylogeny = api;
})(globalThis);
