export const ANNOTATION_ERASER_WIDTH_PX = 10;

/**
 * Manages the translucent eraser stroke canvas trail and segment collision detection.
 */
export class AnnotationEraser {
    constructor({
        eraserWidth = ANNOTATION_ERASER_WIDTH_PX,
        onEraseAnnotation = () => {},
        isAnnotationMode = () => false,
        getAnnotationTool = () => 'pen'
    } = {}) {
        this.eraserWidth = eraserWidth;
        this.onEraseAnnotation = onEraseAnnotation;
        this.isAnnotationMode = isAnnotationMode;
        this.getAnnotationTool = getAnnotationTool;

        this.canvas = null;
        this.ctx = null;
        this.lastPoint = null;
        this.deletedIds = new Set();
        this.active = false;
    }

    ensureCanvas() {
        if (this.canvas) return this.canvas;
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, {
            position: 'fixed',
            inset: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '1900'
        });
        document.body.appendChild(canvas);
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        return canvas;
    }

    resizeCanvas() {
        const canvas = this.ensureCanvas();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    clearTrail() {
        if (!this.canvas || !this.ctx) return;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.lastPoint = null;
    }

    annotationIdsNearPoint(clientX, clientY, radius = this.eraserWidth / 2) {
        const ids = new Set();
        const step = Math.max(3, radius * 0.7);
        const offsets = [
            [0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
            [step, step], [step, -step], [-step, step], [-step, -step]
        ];
        document.body.classList.add('annotation-erase');
        for (const [dx, dy] of offsets) {
            for (const el of document.elementsFromPoint(clientX + dx, clientY + dy)) {
                const shape = el && el.closest ? el.closest('[data-annotation-id]') : null;
                const id = shape && shape.dataset ? shape.dataset.annotationId : '';
                if (id) ids.add(id);
            }
        }
        if (!this.isAnnotationMode() && !this.active && this.getAnnotationTool() !== 'erase') {
            document.body.classList.remove('annotation-erase');
        }
        return ids;
    }

    eraseAlongSegment(x1, y1, x2, y2) {
        const dist = Math.hypot(x2 - x1, y2 - y1);
        const spacing = Math.max(2, this.eraserWidth * 0.35);
        const steps = Math.max(1, Math.ceil(dist / spacing));
        for (let i = 0; i <= steps; i++) {
            const t = steps ? i / steps : 0;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            for (const id of this.annotationIdsNearPoint(x, y, this.eraserWidth / 2)) {
                if (this.deletedIds.has(id)) continue;
                this.deletedIds.add(id);
                this.onEraseAnnotation(id);
            }
        }
    }

    startStroke(clientX, clientY) {
        this.resizeCanvas();
        this.clearTrail();
        this.deletedIds = new Set();
        this.lastPoint = { x: clientX, y: clientY };
        this.active = true;
        document.body.classList.add('annotation-erase');
        this.eraseAlongSegment(clientX, clientY, clientX, clientY);
    }

    moveStroke(clientX, clientY) {
        if (!this.lastPoint) return;
        const from = this.lastPoint;
        const to = { x: clientX, y: clientY };
        this.ctx.beginPath();
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(to.x, to.y);
        this.ctx.strokeStyle = 'rgba(255,255,255,.32)';
        this.ctx.lineWidth = this.eraserWidth;
        this.ctx.stroke();
        this.eraseAlongSegment(from.x, from.y, to.x, to.y);
        this.lastPoint = to;
    }

    endStroke() {
        const removedCount = this.deletedIds.size;
        this.active = false;
        this.deletedIds = new Set();
        setTimeout(() => this.clearTrail(), 120);
        if (!this.isAnnotationMode() && this.getAnnotationTool() !== 'erase') {
            document.body.classList.remove('annotation-erase');
        }
        return removedCount;
    }

    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
    }
}
