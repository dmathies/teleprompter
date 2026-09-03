const ANNOTATION_X_MIN = -2;
const ANNOTATION_X_MAX = 3;
const ANNOTATION_Y_MIN = -10;
const ANNOTATION_Y_MAX = 50;

export function createAnnotationGeometry({content, fontSizeInput, getDepartmentMargin, getActiveDepartment, getDepartmentColor}) {
  function currentScriptFontPx() {
    const px = parseFloat(getComputedStyle(content).fontSize);
    return Number.isFinite(px) ? px : (parseFloat(fontSizeInput.value) || 42);
  }

  function strokeWidth(ann) {
    const ref = Math.max(12, Number(ann.fontPx) || 42);
    const scale = Math.max(.65, Math.min(2.5, currentScriptFontPx() / ref));
    return Math.max(.75, Math.min(18, (Number(ann.width) || 3) * scale));
  }

  function svgElement(name, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function lineHeightPx(block) {
    if (!block) return Math.max(1, currentScriptFontPx() * 1.4);
    const style = getComputedStyle(block);
    const parsed = parseFloat(style.lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const font = parseFloat(style.fontSize);
    return Math.max(1, (Number.isFinite(font) ? font : currentScriptFontPx()) * 1.4);
  }

  function horizontalGeometry(block) {
    const margin = getDepartmentMargin();
    const contentStyle = getComputedStyle(content);
    const contentWidth = Math.max(1, content.clientWidth - (parseFloat(contentStyle.paddingLeft) || 0) - (parseFloat(contentStyle.paddingRight) || 0));
    const marginPx = getActiveDepartment() && margin.side !== 'none' ? contentWidth * margin.width / 100 : 0;
    return {offset: margin.side === 'left' ? marginPx : 0, width: Math.max(1, block.clientWidth - marginPx)};
  }

  function normalizePoint(x, y) {
    return [
      Math.max(ANNOTATION_X_MIN, Math.min(ANNOTATION_X_MAX, Number(x) || 0)),
      Math.max(ANNOTATION_Y_MIN, Math.min(ANNOTATION_Y_MAX, Number(y) || 0))
    ];
  }

  function pointToPx(point, geometry, blockHeight, lineHeight, ann) {
    const xUnit = Math.max(ANNOTATION_X_MIN, Math.min(ANNOTATION_X_MAX, Number(point[0]) || 0));
    const x = geometry.offset + xUnit * geometry.width;
    const yUnit = Math.max(ANNOTATION_Y_MIN, Math.min(ANNOTATION_Y_MAX, Number(point[1]) || 0));
    const yScale = ann && ann.coordMode === 'block' ? blockHeight : lineHeight;
    return [x, yUnit * yScale];
  }

  function clearLayers() {
    for (const layer of content.querySelectorAll('.annotation-layer')) layer.remove();
    for (const block of content.querySelectorAll('.prompt-with-annotations')) {
      block.classList.remove('prompt-with-annotations');
    }
  }

  function buildShape(svg, ann, geometry, height, lineHeight) {
    const color = /^#[0-9a-f]{6}$/i.test(ann.color || '') ? ann.color : getDepartmentColor();
    const sw = strokeWidth(ann);
    let shape = null;
    if (ann.type === 'stroke' && Array.isArray(ann.points) && ann.points.length >= 2) {
      const pts = ann.points.map(p => pointToPx(p, geometry, height, lineHeight, ann));
      const pressures = Array.isArray(ann.pressures) ? ann.pressures : null;
      if (pressures && pressures.length === pts.length) {
        const group = svgElement('g');
        for (let i = 1; i < pts.length; i++) {
          const p = Math.max(.05, Math.min(1, Number(pressures[i]) || .5));
          const prev = Math.max(.05, Math.min(1, Number(pressures[i-1]) || .5));
          const pressureScale = .35 + ((p + prev) * .5) * 1.3;
          const seg = svgElement('line', {x1:pts[i-1][0], y1:pts[i-1][1], x2:pts[i][0], y2:pts[i][1], stroke:color, 'stroke-width':Math.max(.6, sw * pressureScale)});
          seg.classList.add('annotation-shape'); seg.dataset.annotationId = ann.id || ''; group.appendChild(seg);
        }
        shape = group;
      } else {
        const d = pts.map((p,i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        shape = svgElement('path', {d, stroke:color, 'stroke-width':sw, fill:'none'});
      }
    } else if (ann.type === 'arrow' && ann.from && ann.to) {
      const [x1,y1] = pointToPx(ann.from, geometry, height, lineHeight, ann);
      const [x2,y2] = pointToPx(ann.to, geometry, height, lineHeight, ann);
      const group = svgElement('g');
      const line = svgElement('line', {x1,y1,x2,y2,stroke:color,'stroke-width':sw});
      line.classList.add('annotation-shape'); line.dataset.annotationId = ann.id || ''; group.appendChild(line);
      const angle = Math.atan2(y2-y1, x2-x1), size = Math.max(8, sw * 4.2);
      const a1 = angle + Math.PI * .82, a2 = angle - Math.PI * .82;
      const poly = svgElement('polygon', {points:`${x2},${y2} ${x2+Math.cos(a1)*size},${y2+Math.sin(a1)*size} ${x2+Math.cos(a2)*size},${y2+Math.sin(a2)*size}`, fill:color, stroke:color, 'stroke-width':Math.max(1,sw*.5)});
      poly.classList.add('annotation-shape'); poly.dataset.annotationId = ann.id || ''; group.appendChild(poly); group.dataset.annotationId = ann.id || ''; return group;
    } else if (ann.type === 'ellipse' && ann.from && ann.to) {
      const [x1,y1] = pointToPx(ann.from, geometry, height, lineHeight, ann);
      const [x2,y2] = pointToPx(ann.to, geometry, height, lineHeight, ann);
      shape = svgElement('ellipse', {cx:(x1+x2)/2, cy:(y1+y2)/2, rx:Math.max(1,Math.abs(x2-x1)/2), ry:Math.max(1,Math.abs(y2-y1)/2), stroke:color, 'stroke-width':sw, fill:'none'});
    } else if (ann.type === 'text' && ann.at && ann.text) {
      const [x,y] = pointToPx(ann.at, geometry, height, lineHeight, ann);
      const refFont = Math.max(12, Number(ann.fontPx) || 42);
      const textScale = Math.max(.65, Math.min(2.5, currentScriptFontPx() / refFont));
      shape = svgElement('text', {x, y, 'font-size':Math.max(12, refFont * .55 * textScale), 'dominant-baseline':'hanging'});
      shape.classList.add('annotation-text'); shape.style.fill = color; shape.style.color = color; shape.textContent = ann.text;
    }
    if (shape) {
      if (ann.type !== 'text') shape.classList.add('annotation-shape');
      shape.dataset.annotationId = ann.id || '';
    }
    return shape;
  }

  return {currentScriptFontPx, strokeWidth, svgElement, lineHeightPx, horizontalGeometry, normalizePoint, pointToPx, buildShape, clearLayers};
}
