/* Population geometry shared by rendering, picking, dragging and selection. */
(() => {
  'use strict';
  const root3 = Math.sqrt(3);
  // Odd rows are offset to the right. Fit regular hexagons without stretching
  // them, leaving the unused canvas area outside the selectable map.
  function layout(width, height, viewWidth, viewHeight) {
    const columns = width + (height > 1 ? 0.5 : 0);
    const rows = 1.5 * height + 0.5;
    const radius = Math.min(viewWidth / (root3 * columns), viewHeight / rows);
    const dx = root3 * radius;
    return {radius, dx, left: (viewWidth - dx * columns) / 2,
      top: (viewHeight - radius * rows) / 2};
  }
  function center(id, width, geometry) {
    const row = Math.floor(id / width);
    return {x: geometry.left + geometry.dx * (id % width + 0.5 + (row % 2) / 2),
      y: geometry.top + geometry.radius * (1 + 1.5 * row)};
  }
  function path(context, x, y, radius) {
    const halfWidth = root3 * radius / 2;
    context.beginPath();
    context.moveTo(x, y - radius);
    context.lineTo(x + halfWidth, y - radius / 2);
    context.lineTo(x + halfWidth, y + radius / 2);
    context.lineTo(x, y + radius);
    context.lineTo(x - halfWidth, y + radius / 2);
    context.lineTo(x - halfWidth, y - radius / 2);
    context.closePath();
  }
  function cellAt(canvas, clientX, clientY) {
    const width = Number(canvas.dataset.gridWidth), height = Number(canvas.dataset.gridHeight);
    if (!width || !height) return -1;
    const bounds = canvas.getBoundingClientRect();
    const x = clientX - bounds.left, y = clientY - bounds.top;
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return -1;
    if (canvas.dataset.cellShape === 'circle') {
      return circleAt(canvas.avidaCircles || [], x * width / bounds.width,
        y * height / bounds.height, width, height);
    }
    if (canvas.dataset.cellShape !== 'hex') {
      return Math.floor(x * width / bounds.width) + Math.floor(y * height / bounds.height) * width;
    }
    const g = layout(width, height, bounds.width, bounds.height);
    const rowGuess = Math.round(((y - g.top) / g.radius - 1) / 1.5);
    // Only the nearest three rows can contain the pointer, including triangular tips.
    for (let row = Math.max(0, rowGuess - 1); row <= Math.min(height - 1, rowGuess + 1); ++row) {
      const col = Math.round((x - g.left) / g.dx - 0.5 - (row % 2) / 2);
      if (col < 0 || col >= width) continue;
      const c = center(row * width + col, width, g);
      const ax = Math.abs(x - c.x), ay = Math.abs(y - c.y);
      if (ax <= g.dx / 2 && ay <= g.radius && ay + ax / root3 <= g.radius) {
        return row * width + col;
      }
    }
    return -1;
  }
  function render(canvas, colors, width, height) {
    const context = canvas.getContext('2d');
    const g = layout(width, height, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = Math.min(g.radius / 5, window.devicePixelRatio || 1);
    context.strokeStyle = 'rgba(4,17,25,0.5)';
    for (let id = 0; id < colors.length; ++id) {
      const c = center(id, width, g), word = colors[id];
      path(context, c.x, c.y, g.radius);
      context.fillStyle = `rgb(${word & 255},${(word >>> 8) & 255},${(word >>> 16) & 255})`;
      context.fill(); context.stroke();
    }
  }
  function highlight(canvas, element, id, width, height) {
    if (canvas.dataset.cellShape === 'circle') {
      highlightCircle(canvas, element, id, width, height);
      return;
    }
    const g = layout(width, height, canvas.clientWidth, canvas.clientHeight);
    const c = center(id, width, g);
    Object.assign(element.style, {
      display: 'block', left: `${100 * (c.x - g.dx / 2) / canvas.clientWidth}%`,
      top: `${100 * (c.y - g.radius) / canvas.clientHeight}%`,
      width: `${100 * g.dx / canvas.clientWidth}%`,
      height: `${200 * g.radius / canvas.clientHeight}%`, border: '0',
      background: 'transparent', boxShadow: 'none'
    });
    element.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="overflow:visible"><polygon points="50,0 100,25 100,75 50,100 0,75 0,25" fill="none" stroke="white" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }
  // Arrow up/down use NW/SE. Shift selects NE/SW, exposing all six directions.
  function move(id, width, height, key, shift = false) {
    const x = id % width, y = Math.floor(id / width);
    const east = (x + 1) % width, west = (x + width - 1) % width;
    const north = (y + height - 1) % height, south = (y + 1) % height;
    const northRight = y % 2 || (y === 0 && height % 2);
    if (key === 'ArrowLeft') return west + y * width;
    if (key === 'ArrowRight') return east + y * width;
    if (key === 'ArrowUp') return (shift ? (northRight ? east : x) : (northRight ? x : west)) + north * width;
    if (key === 'ArrowDown') return (shift ? (y % 2 ? x : west) : (y % 2 ? east : x)) + south * width;
    return key === 'Home' ? 0 : key === 'End' ? width * height - 1 : null;
  }

  function pointAt(canvas, clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width;
    const y = (clientY - bounds.top) / bounds.height;
    return x >= 0 && y >= 0 && x < 1 && y < 1
      ? {x: x * Number(canvas.dataset.gridWidth), y: y * Number(canvas.dataset.gridHeight)} : null;
  }
  // Each record contains location ID, x, y, radius, and organism identity.
  function circleAt(circles, x, y, width, height) {
    for (let i = circles.length - 5; i >= 0; i -= 5) {
      let dx = Math.abs(x - circles[i + 1]), dy = Math.abs(y - circles[i + 2]);
      dx = Math.min(dx, width - dx); dy = Math.min(dy, height - dy);
      if (dx * dx + dy * dy <= circles[i + 3] ** 2) return circles[i];
    }
    return -1;
  }
  function images(x, y, radius, width, height, draw) {
    draw(x, y);
    const wrapX = x < radius ? x + width : x + radius > width ? x - width : null;
    const wrapY = y < radius ? y + height : y + radius > height ? y - height : null;
    if (wrapX !== null) draw(wrapX, y);
    if (wrapY !== null) draw(x, wrapY);
    if (wrapX !== null && wrapY !== null) draw(wrapX, wrapY);
  }
  function renderCircles(canvas, circles, colors, width, height, background = 0xff2e1e0c) {
    const context = canvas.getContext('2d');
    canvas.avidaCircles = circles;
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    context.fillStyle = `rgb(${background & 255},${(background >>> 8) & 255},${(background >>> 16) & 255})`;
    context.fillRect(0, 0, width, height);
    context.lineWidth = Math.min(width / canvas.width, height / canvas.height);
    context.strokeStyle = 'rgba(4,17,25,0.5)';
    let radius = 0, lastWord = -1;
    const draw = (x, y) => {
      context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI);
      context.fill(); context.stroke();
    };
    for (let i = 0; i < circles.length; i += 5) {
      const word = colors[circles[i]];
      if (word !== lastWord) {
        context.fillStyle = `rgb(${word & 255},${(word >>> 8) & 255},${(word >>> 16) & 255})`;
        lastWord = word;
      }
      radius = circles[i + 3];
      images(circles[i + 1], circles[i + 2], radius, width, height, draw);
    }
    context.resetTransform();
  }
  function highlightCircle(canvas, element, id, width, height) {
    const circles = canvas.avidaCircles || [];
    let offset = -1;
    for (let i = 0; i < circles.length; i += 5) if (circles[i] === id) { offset = i; break; }
    if (offset < 0) { element.style.display = 'none'; return; }
    Object.assign(element.style, {display: 'block', left: '0', top: '0', width: '100%',
      height: '100%', border: '0', background: 'transparent', boxShadow: 'none'});
    let content = '';
    const radius = circles[offset + 3];
    images(circles[offset + 1], circles[offset + 2], radius, width, height, (x, y) => {
      content += `<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="white" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    });
    element.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${content}</svg>`;
  }
  function moveCircle(canvas, current, key) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return null;
    const circles = canvas.avidaCircles || [];
    if (!circles.length) return null;
    let index = -1;
    for (let i = 0; i < circles.length; i += 5) if (circles[i] === current) index = i / 5;
    const count = circles.length / 5;
    if (key === 'Home') index = 0;
    else if (key === 'End') index = count - 1;
    else index = (index + (key === 'ArrowLeft' || key === 'ArrowUp' ? count - 1 : 1)) % count;
    return circles[index * 5];
  }

  window.avidaPopulationGeometry = {layout, center, cellAt, render, highlight, move,
    pointAt, circleAt, renderCircles, moveCircle};
})();
