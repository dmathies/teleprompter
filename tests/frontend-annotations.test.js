import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock minimal document and SVG elements for Node.js test environment
class MockSVGElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add: (...names) => names.forEach(n => this.classList._classes.add(n)),
      remove: (...names) => names.forEach(n => this.classList._classes.delete(n)),
      contains: (n) => this.classList._classes.has(n),
    };
    this.dataset = {};
    this.children = [];
    this.textContent = '';
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }

  getAttribute(k) {
    return this.attributes[k] ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  closest(selector) {
    if (selector === '[data-annotation-id]') {
      if (this.dataset.annotationId) return this;
    }
    return null;
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add: (...names) => names.forEach(n => this.classList._classes.add(n)),
      remove: (...names) => names.forEach(n => this.classList._classes.delete(n)),
      contains: (n) => this.classList._classes.has(n),
    };
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.clientWidth = 1000;
    this.clientHeight = 200;
  }

  setAttribute(k, v) {
    this[k] = v;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (selector === '.annotation-layer' && child.classList.contains('annotation-layer')) {
          found.push(child);
        }
        if (selector === '.prompt-with-annotations' && child.classList.contains('prompt-with-annotations')) {
          found.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  closest(selector) {
    if (selector === '[data-annotation-id]') {
      if (this.dataset.annotationId) return this;
    }
    return null;
  }
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          tagName: 'canvas',
          style: {},
          setAttribute() {},
          getContext() {
            return {
              setTransform() {},
              clearRect() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              stroke() {},
              lineCap: '',
              lineJoin: '',
              strokeStyle: '',
              lineWidth: 0,
            };
          },
          width: 0,
          height: 0,
          parentNode: null,
        };
      }
      return new MockElement(tag);
    },
    createElementNS(ns, tag) {
      return new MockSVGElement(tag);
    },
    body: new MockElement('body'),
    elementsFromPoint() {
      return [];
    }
  };
}

if (typeof globalThis.getComputedStyle === 'undefined') {
  globalThis.getComputedStyle = (el) => {
    return {
      fontSize: el?.style?.fontSize || '42px',
      lineHeight: el?.style?.lineHeight || '58.8px',
      paddingLeft: el?.style?.paddingLeft || '0px',
      paddingRight: el?.style?.paddingRight || '0px',
    };
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
  };
}

import { createAnnotationGeometry } from '../js/annotation-geometry.js';
import { AnnotationEraser } from '../js/annotation-eraser.js';

describe('Frontend Annotations & Drawing Geometry', () => {
  let content;
  let fontSizeInput;
  let marginConfig;
  let activeDepartment;
  let geomApi;

  beforeEach(() => {
    content = new MockElement('div');
    content.clientWidth = 1000;
    fontSizeInput = { value: '42' };
    marginConfig = { side: 'none', width: 0 };
    activeDepartment = 'LX';

    geomApi = createAnnotationGeometry({
      content,
      fontSizeInput,
      getDepartmentMargin: () => marginConfig,
      getActiveDepartment: () => activeDepartment,
      getDepartmentColor: () => '#ffd000',
    });
  });

  describe('createAnnotationGeometry scaling & metrics', () => {
    test('currentScriptFontPx derives from content style or fontSizeInput', () => {
      content.style.fontSize = '36px';
      assert.equal(geomApi.currentScriptFontPx(), 36);

      content.style.fontSize = 'invalid';
      fontSizeInput.value = '48';
      assert.equal(geomApi.currentScriptFontPx(), 48);
    });

    test('strokeWidth scales proportional to font size within bounds', () => {
      // Base: refFont 42, current font 42 -> scale 1.0 -> width = 3
      content.style.fontSize = '42px';
      assert.equal(geomApi.strokeWidth({ width: 3, fontPx: 42 }), 3);

      // Higher font size: current 84, ref 42 -> scale 2.0 -> width 3 * 2 = 6
      content.style.fontSize = '84px';
      assert.equal(geomApi.strokeWidth({ width: 3, fontPx: 42 }), 6);

      // Max scale clamp: scale max 2.5
      content.style.fontSize = '200px';
      assert.equal(geomApi.strokeWidth({ width: 3, fontPx: 42 }), 3 * 2.5);

      // Min scale clamp: scale min 0.65
      content.style.fontSize = '10px';
      assert.equal(geomApi.strokeWidth({ width: 3, fontPx: 42 }), 3 * 0.65);
    });

    test('horizontalGeometry accounts for department margin offsets', () => {
      const block = new MockElement('p');
      block.clientWidth = 1000;

      // No margin
      marginConfig = { side: 'none', width: 0 };
      const geomNone = geomApi.horizontalGeometry(block);
      assert.equal(geomNone.offset, 0);
      assert.equal(geomNone.width, 1000);

      // Left margin 20%
      marginConfig = { side: 'left', width: 20 };
      const geomLeft = geomApi.horizontalGeometry(block);
      // marginPx = 1000 * 0.2 = 200
      assert.equal(geomLeft.offset, 200);
      assert.equal(geomLeft.width, 800);

      // Right margin 30%
      marginConfig = { side: 'right', width: 30 };
      const geomRight = geomApi.horizontalGeometry(block);
      // offset is 0, width is reduced by margin
      assert.equal(geomRight.offset, 0);
      assert.equal(geomRight.width, 700);
    });

    test('pointToPx calculates coordinates for line-mode vs block-mode', () => {
      const geometry = { offset: 50, width: 800 };
      const blockHeight = 400;
      const lineHeight = 40;

      // Point at [0.5, 2.0] in default line-mode
      const [x1, y1] = geomApi.pointToPx([0.5, 2.0], geometry, blockHeight, lineHeight, {});
      assert.equal(x1, 50 + 0.5 * 800); // 450
      assert.equal(y1, 2.0 * 40);       // 80

      // Point at [0.25, 0.5] in block-mode
      const [x2, y2] = geomApi.pointToPx([0.25, 0.5], geometry, blockHeight, lineHeight, { coordMode: 'block' });
      assert.equal(x2, 50 + 0.25 * 800); // 250
      assert.equal(y2, 0.5 * 400);        // 200
    });
  });

  describe('buildShape shape generation', () => {
    test('builds standard stroke path', () => {
      const svg = new MockSVGElement('svg');
      const geometry = { offset: 0, width: 1000 };
      const ann = {
        id: 'ann-1',
        type: 'stroke',
        points: [[0, 0], [0.5, 1], [1, 2]],
        color: '#ff0000',
        width: 4,
      };

      const shape = geomApi.buildShape(svg, ann, geometry, 300, 50);
      assert.equal(shape.tagName, 'path');
      assert.equal(shape.getAttribute('stroke'), '#ff0000');
      assert.equal(shape.dataset.annotationId, 'ann-1');
      assert(shape.getAttribute('d').startsWith('M0.0 0.0 L500.0 50.0 L1000.0 100.0'));
      assert(shape.classList.contains('annotation-shape'));
    });

    test('builds pressure-sensitive stroke with line segments', () => {
      const svg = new MockSVGElement('svg');
      const geometry = { offset: 0, width: 1000 };
      const ann = {
        id: 'ann-pressure',
        type: 'stroke',
        points: [[0, 0], [0.5, 1], [1, 2]],
        pressures: [0.2, 0.8, 0.5],
        color: '#00ff00',
        width: 3,
      };

      const shape = geomApi.buildShape(svg, ann, geometry, 300, 50);
      assert.equal(shape.tagName, 'g');
      assert.equal(shape.children.length, 2); // 2 segments between 3 points
      assert.equal(shape.children[0].tagName, 'line');
      assert.equal(shape.children[0].dataset.annotationId, 'ann-pressure');
      assert.equal(shape.children[1].dataset.annotationId, 'ann-pressure');
    });

    test('builds arrow with shaft and arrowhead polygon', () => {
      const svg = new MockSVGElement('svg');
      const geometry = { offset: 0, width: 1000 };
      const ann = {
        id: 'ann-arrow',
        type: 'arrow',
        from: [0.1, 1],
        to: [0.9, 1],
        color: '#2f80ed',
        width: 3,
      };

      const shape = geomApi.buildShape(svg, ann, geometry, 300, 50);
      assert.equal(shape.tagName, 'g');
      assert.equal(shape.dataset.annotationId, 'ann-arrow');
      assert.equal(shape.children.length, 2);

      const [line, poly] = shape.children;
      assert.equal(line.tagName, 'line');
      assert.equal(poly.tagName, 'polygon');
      assert.equal(poly.getAttribute('fill'), '#2f80ed');
    });

    test('builds ellipse shape', () => {
      const svg = new MockSVGElement('svg');
      const geometry = { offset: 0, width: 1000 };
      const ann = {
        id: 'ann-ellipse',
        type: 'ellipse',
        from: [0.2, 1],
        to: [0.8, 3],
        color: '#a82424',
        width: 2,
      };

      const shape = geomApi.buildShape(svg, ann, geometry, 300, 50);
      assert.equal(shape.tagName, 'ellipse');
      assert.equal(shape.dataset.annotationId, 'ann-ellipse');
      // cx: (200 + 800)/2 = 500, cy: (50 + 150)/2 = 100
      assert.equal(shape.getAttribute('cx'), '500');
      assert.equal(shape.getAttribute('cy'), '100');
      assert.equal(shape.getAttribute('rx'), '300');
      assert.equal(shape.getAttribute('ry'), '50');
    });

    test('builds text element with scaled font size', () => {
      const svg = new MockSVGElement('svg');
      const geometry = { offset: 0, width: 1000 };
      const ann = {
        id: 'ann-text',
        type: 'text',
        at: [0.3, 2],
        text: 'Standby LX 4',
        color: '#ffd000',
        fontPx: 40,
      };

      const shape = geomApi.buildShape(svg, ann, geometry, 300, 50);
      assert.equal(shape.tagName, 'text');
      assert.equal(shape.textContent, 'Standby LX 4');
      assert.equal(shape.dataset.annotationId, 'ann-text');
      assert.equal(shape.getAttribute('x'), '300');
      assert.equal(shape.getAttribute('y'), '100');
      assert(shape.classList.contains('annotation-text'));
    });
  });

  describe('AnnotationEraser collision and trail lifecycle', () => {
    test('initializes with default settings and canvas management', () => {
      const erased = [];
      const eraser = new AnnotationEraser({
        eraserWidth: 12,
        onEraseAnnotation: (id) => erased.push(id),
      });

      assert.equal(eraser.eraserWidth, 12);
      assert.equal(eraser.active, false);

      const canvas = eraser.ensureCanvas();
      assert.ok(canvas);
      assert.equal(eraser.canvas, canvas);

      // destroy removes canvas
      eraser.destroy();
      assert.equal(eraser.canvas, null);
    });

    test('eraseAlongSegment detects and deduplicates target annotations', () => {
      const erased = [];
      const eraser = new AnnotationEraser({
        eraserWidth: 10,
        onEraseAnnotation: (id) => erased.push(id),
      });

      // Mock elementsFromPoint returning annotation targets
      const hitElement = new MockSVGElement('path');
      hitElement.dataset.annotationId = 'cue-note-99';

      globalThis.document.elementsFromPoint = (x, y) => {
        // Intersect near (100, 100)
        if (Math.abs(x - 100) <= 10 && Math.abs(y - 100) <= 10) {
          return [hitElement];
        }
        return [];
      };

      // Segment crossing through (100, 100)
      eraser.eraseAlongSegment(80, 100, 120, 100);

      assert.deepEqual(erased, ['cue-note-99']);

      // Repeated erase step doesn't fire callback twice for same ID in a stroke
      eraser.eraseAlongSegment(80, 100, 120, 100);
      assert.deepEqual(erased, ['cue-note-99']);

      eraser.destroy();
    });

    test('startStroke, moveStroke, and endStroke lifecycle', () => {
      const erased = [];
      const eraser = new AnnotationEraser({
        eraserWidth: 10,
        onEraseAnnotation: (id) => erased.push(id),
      });

      eraser.startStroke(50, 50);
      assert.equal(eraser.active, true);
      assert.deepEqual(eraser.lastPoint, { x: 50, y: 50 });

      eraser.moveStroke(60, 60);
      assert.deepEqual(eraser.lastPoint, { x: 60, y: 60 });

      const count = eraser.endStroke();
      assert.equal(eraser.active, false);
      assert.equal(count, 0);

      eraser.destroy();
    });
  });
});
