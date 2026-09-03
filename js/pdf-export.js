import { contrastingTextColor } from "./utils.js";

export function createPdfExporter(deps) {
  const { exportStatus, exportDepartment, exportPanel, exportBackdrop, exportCues, exportAnnotations, exportStageDirections, exportOpenBtn, ALLOWED_DEPARTMENTS, CUE_API_ENDPOINT, ANNOTATION_API_ENDPOINT, SETTINGS_API_ENDPOINT, SCRIPT_GET_ENDPOINT, normalizeDepartmentMargin, departmentDefaultColor, getCurrentScriptId, getActiveDepartment, getAvailableScripts } = deps;

  function openExportPanel() {
        if (!getCurrentScriptId()) return;
        exportStatus.textContent = "";
        exportStatus.className = "";
        exportDepartment.value = getActiveDepartment() || "ALL";
        exportPanel.hidden = false;
        exportBackdrop.hidden = false;
      }

      function closeExportPanel() {
        exportPanel.hidden = true;
        exportBackdrop.hidden = true;
        exportStatus.textContent = "";
        exportStatus.className = "";
      }

      async function fetchExportDepartmentData(script, department) {
        const stamp = Date.now();
        const [cueResponse, annotationResponse, settingsResponse] = await Promise.all([
          fetch(CUE_API_ENDPOINT + "?action=get&script=" + encodeURIComponent(script) + "&dept=" + encodeURIComponent(department) + "&_=" + stamp, {cache:"no-store"}),
          fetch(ANNOTATION_API_ENDPOINT + "?action=get&script=" + encodeURIComponent(script) + "&dept=" + encodeURIComponent(department) + "&_=" + stamp, {cache:"no-store"}),
          fetch(SETTINGS_API_ENDPOINT + "?action=get&dept=" + encodeURIComponent(department) + "&_=" + stamp, {cache:"no-store"})
        ]);
        if (!cueResponse.ok || !annotationResponse.ok || !settingsResponse.ok) {
          throw new Error("Could not load " + department + " export data");
        }
        const [cueDoc, annotationDoc, settingsDoc] = await Promise.all([
          cueResponse.json(), annotationResponse.json(), settingsResponse.json()
        ]);
        return {
          department,
          cues: Array.isArray(cueDoc.cues) ? cueDoc.cues : [],
          annotations: Array.isArray(annotationDoc.annotations) ? annotationDoc.annotations : [],
          margin: normalizeDepartmentMargin(settingsDoc.annotationMargin)
        };
      }

      function exportEscapeHtml(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
      }

      function exportScriptName() {
        const item = getAvailableScripts().find(s => s.id === getCurrentScriptId());
        return item ? item.name : getCurrentScriptId();
      }

      function exportCueTextNodes(block) {
        const nodes = [];
        const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest('.print-cue-markers,.print-cue-end')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        while (walker.nextNode()) nodes.push(walker.currentNode);
        return nodes;
      }

      function exportWordEntries(block) {
        const entries = [];
        let index = 0;
        for (const node of exportCueTextNodes(block)) {
          const text = node.nodeValue || "";
          const re = /\S+/g;
          let match;
          while ((match = re.exec(text)) !== null) {
            entries.push({index:index++, node, start:match.index, end:match.index + match[0].length});
          }
        }
        return entries;
      }

      function exportWrapTrigger(block, cue, department) {
        const anchor = cue && cue.anchor;
        if (!anchor || anchor.type !== 'word') return;
        const targetIndex = Number(anchor.wordIndex);
        if (!Number.isInteger(targetIndex) || targetIndex < 0) return;
        const existing = block.querySelector('.print-trigger[data-word-index="' + CSS.escape(String(targetIndex)) + '"]');
        if (existing) return;
        const entry = exportWordEntries(block).find(e => e.index === targetIndex);
        if (!entry) return;
        const range = block.ownerDocument.createRange();
        range.setStart(entry.node, entry.start);
        range.setEnd(entry.node, entry.end);
        const span = block.ownerDocument.createElement('span');
        span.className = 'print-trigger';
        span.dataset.wordIndex = String(targetIndex);
        span.style.setProperty('--cue-color', cue.color || departmentDefaultColor(department));
        try { range.surroundContents(span); } catch (_) {}
      }

      function decorateExportCues(root, departmentDocs, includeCues) {
        if (!includeCues) return;
        for (const doc of departmentDocs) {
          for (const cue of doc.cues) {
            if (!cue || !cue.anchor || !cue.anchor.prompt) continue;
            const block = root.querySelector('[data-prompt-id="' + CSS.escape(cue.anchor.prompt) + '"]');
            if (!block) continue;
            block.classList.add('print-has-cue');
            let holder = block.querySelector(':scope > .print-cue-markers');
            if (!holder) {
              holder = root.ownerDocument.createElement('div');
              holder.className = 'print-cue-markers';
              block.insertBefore(holder, block.firstChild);
            }
            const color = cue.color || departmentDefaultColor(doc.department);
            const badge = root.ownerDocument.createElement('div');
            badge.className = 'print-cue-marker';
            badge.style.setProperty('--cue-color', color);
            badge.style.setProperty('--cue-text-color', contrastingTextColor(color));
            badge.innerHTML = '<strong>' + exportEscapeHtml(doc.department + ' ' + (cue.number || '')) + '</strong>' +
              (cue.description ? '<span>' + exportEscapeHtml(cue.description) + '</span>' : '');
            holder.appendChild(badge);
            exportWrapTrigger(block, cue, doc.department);

            if (cue.endAnchor && cue.endAnchor.prompt) {
              const endBlock = root.querySelector('[data-prompt-id="' + CSS.escape(cue.endAnchor.prompt) + '"]');
              if (endBlock) {
                const end = root.ownerDocument.createElement('div');
                end.className = 'print-cue-end';
                end.style.setProperty('--cue-color', color);
                end.textContent = 'END ' + doc.department + ' ' + (cue.number || '');
                endBlock.appendChild(end);
              }
            }
          }
        }
      }

      function exportRelevantStagePrompts(departmentDocs) {
        const prompts = new Set();
        for (const doc of departmentDocs) {
          for (const cue of doc.cues) {
            if (cue && cue.anchor && cue.anchor.prompt) prompts.add(cue.anchor.prompt);
            if (cue && cue.endAnchor && cue.endAnchor.prompt) prompts.add(cue.endAnchor.prompt);
          }
        }
        return prompts;
      }

      function exportApplyStageDirections(root, mode, departmentDocs) {
        const relevant = mode === 'relevant' ? exportRelevantStagePrompts(departmentDocs) : null;
        for (const block of root.querySelectorAll('.stage-direction,.stage-inline')) {
          const prompt = block.dataset.promptId || '';
          const show = mode === 'all' || (mode === 'relevant' && relevant.has(prompt));
          block.classList.toggle('print-stage-hidden', !show);
        }
      }

      function exportApplyAnnotationMargins(root, departmentDocs, includeAnnotations) {
        if (!includeAnnotations || !departmentDocs.length) return;
        let left = 0, right = 0;
        for (const doc of departmentDocs) {
          const margin = doc.margin || {side:'none', width:0};
          if (margin.side === 'left') left = Math.max(left, Number(margin.width) || 0);
          if (margin.side === 'right') right = Math.max(right, Number(margin.width) || 0);
        }
        if (!left && !right) return;
        for (const block of root.querySelectorAll('[data-prompt-id]')) {
          block.style.setProperty('--print-ann-left', left + '%');
          block.style.setProperty('--print-ann-right', right + '%');
        }
      }

      function exportSvgElement(doc, name, attrs = {}) {
        const el = doc.createElementNS('http://www.w3.org/2000/svg', name);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
        return el;
      }

      function renderExportAnnotations(root, departmentDocs) {
        const printDoc = root.ownerDocument;
        const pxPerPt = 96 / 72;
        const printFontPx = 11.5 * pxPerPt;
        for (const deptDoc of departmentDocs) {
          const margin = deptDoc.margin || {side:'none', width:0};
          const byPrompt = new Map();
          for (const ann of deptDoc.annotations) {
            if (!ann || !ann.prompt) continue;
            if (!byPrompt.has(ann.prompt)) byPrompt.set(ann.prompt, []);
            byPrompt.get(ann.prompt).push(ann);
          }
          for (const [prompt, anns] of byPrompt.entries()) {
            const block = root.querySelector('[data-prompt-id="' + CSS.escape(prompt) + '"]');
            if (!block || block.classList.contains('print-stage-hidden')) continue;
            const width = Math.max(1, block.clientWidth);
            const height = Math.max(1, block.clientHeight);
            const cs = printDoc.defaultView.getComputedStyle(block);
            const lineHeight = Math.max(1, parseFloat(cs.lineHeight) || printFontPx * 1.35);
            const marginPx = margin.side === 'none' ? 0 : width * Math.max(0, Math.min(40, Number(margin.width) || 0)) / 100;
            const areaOffset = margin.side === 'left' ? marginPx : 0;
            const areaWidth = Math.max(1, width - marginPx);
            const svg = exportSvgElement(printDoc, 'svg', {width:'100%', height:'100%'});
            svg.classList.add('print-annotation-layer');
            svg.dataset.department = deptDoc.department;

            const pointPx = (point, ann) => {
              const xUnit = Math.max(-2, Math.min(3, Number(point && point[0]) || 0));
              const yUnit = Math.max(-10, Math.min(50, Number(point && point[1]) || 0));
              const yScale = ann && ann.coordMode === 'block' ? height : lineHeight;
              return [areaOffset + xUnit * areaWidth, yUnit * yScale];
            };

            for (const ann of anns) {
              const color = /^#[0-9a-f]{6}$/i.test(ann.color || '') ? ann.color : departmentDefaultColor(deptDoc.department);
              const ref = Math.max(12, Number(ann.fontPx) || 42);
              const sw = Math.max(.55, (Number(ann.width) || 3) * Math.max(.35, Math.min(2.5, printFontPx / ref)));
              let shape = null;
              if (ann.type === 'stroke' && Array.isArray(ann.points) && ann.points.length >= 2) {
                const pts = ann.points.map(p => pointPx(p, ann));
                const pressures = Array.isArray(ann.pressures) ? ann.pressures : null;
                if (pressures && pressures.length === pts.length) {
                  const group = exportSvgElement(printDoc, 'g');
                  for (let i=1;i<pts.length;i++) {
                    const p = Math.max(.05, Math.min(1, Number(pressures[i]) || .5));
                    const prev = Math.max(.05, Math.min(1, Number(pressures[i-1]) || .5));
                    const pressureScale = .35 + ((p + prev) * .5) * 1.3;
                    group.appendChild(exportSvgElement(printDoc, 'line', {
                      x1:pts[i-1][0], y1:pts[i-1][1], x2:pts[i][0], y2:pts[i][1],
                      stroke:color, 'stroke-width':Math.max(.5, sw * pressureScale)
                    }));
                  }
                  shape = group;
                } else {
                  const d = pts.map((pt,i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ');
                  shape = exportSvgElement(printDoc, 'path', {d, stroke:color, 'stroke-width':sw, fill:'none'});
                }
              } else if (ann.type === 'arrow' && ann.from && ann.to) {
                const [x1,y1] = pointPx(ann.from, ann), [x2,y2] = pointPx(ann.to, ann);
                const group = exportSvgElement(printDoc, 'g');
                group.appendChild(exportSvgElement(printDoc, 'line', {x1,y1,x2,y2,stroke:color,'stroke-width':sw}));
                const angle = Math.atan2(y2-y1,x2-x1), size = Math.max(6, sw * 4.2);
                const a1=angle+Math.PI*.82, a2=angle-Math.PI*.82;
                group.appendChild(exportSvgElement(printDoc, 'polygon', {
                  points:`${x2},${y2} ${x2+Math.cos(a1)*size},${y2+Math.sin(a1)*size} ${x2+Math.cos(a2)*size},${y2+Math.sin(a2)*size}`,
                  fill:color, stroke:color, 'stroke-width':Math.max(.6,sw*.5)
                }));
                shape=group;
              } else if (ann.type === 'ellipse' && ann.from && ann.to) {
                const [x1,y1]=pointPx(ann.from,ann), [x2,y2]=pointPx(ann.to,ann);
                shape=exportSvgElement(printDoc,'ellipse',{cx:(x1+x2)/2,cy:(y1+y2)/2,rx:Math.max(1,Math.abs(x2-x1)/2),ry:Math.max(1,Math.abs(y2-y1)/2),stroke:color,'stroke-width':sw,fill:'none'});
              } else if (ann.type === 'text' && ann.at && ann.text) {
                const [x,y]=pointPx(ann.at,ann);
                shape=exportSvgElement(printDoc,'text',{x,y,'font-size':Math.max(8, printFontPx*.72),'dominant-baseline':'hanging',fill:color});
                shape.textContent=ann.text;
              }
              if (shape) svg.appendChild(shape);
            }
            if (svg.childNodes.length) block.appendChild(svg);
          }
        }
      }

      function addExportCueRangeSegments(root, departmentDocs) {
        const ordered = Array.from(root.querySelectorAll('[data-prompt-id]'));
        const index = new Map(ordered.map((b,i) => [b.dataset.promptId,i]));
        let rangeOrdinal = 0;
        for (const doc of departmentDocs) {
          for (const cue of doc.cues) {
            if (!cue || !cue.anchor || !cue.anchor.prompt || !cue.endAnchor || !cue.endAnchor.prompt) continue;
            const startIndex = index.get(cue.anchor.prompt), endIndex = index.get(cue.endAnchor.prompt);
            if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) continue;
            const color = cue.color || departmentDefaultColor(doc.department);
            const offset = (rangeOrdinal++ % 4) * 3;
            for (let i=startIndex;i<=endIndex;i++) {
              const block=ordered[i];
              if (!block || block.classList.contains('print-stage-hidden')) continue;
              const segment=root.ownerDocument.createElement('div');
              segment.className='print-cue-range';
              segment.style.setProperty('--cue-color',color);
              segment.style.left=offset+'px';
              if (i===startIndex) segment.style.top=(Math.max(0,Math.min(1,Number(cue.anchor.fraction)||0))*100)+'%';
              if (i===endIndex) segment.style.bottom=((1-Math.max(0,Math.min(1,Number(cue.endAnchor.fraction)||0)))*100)+'%';
              block.appendChild(segment);
            }
          }
        }
      }

      function exportPrintCss() {
        return `
          @page { size:A4 portrait; margin:0; }
          * { box-sizing:border-box; }
          html,body { margin:0; padding:0; background:#ddd; color:#111; font-family:Arial,sans-serif; }
          #printControls { position:sticky; top:0; z-index:1000; display:flex; align-items:center; gap:12px; padding:8px 12px; background:#222; color:white; font:14px Arial,sans-serif; }
          #printControls button { padding:6px 12px; font-size:14px; }
          #printControls .note { color:#ccc; }
          #printRoot { padding:8mm 0; }
          .print-sheet { position:relative; width:210mm; height:297mm; margin:0 auto 8mm; padding:12mm 14mm 15mm; background:white; overflow:hidden; break-after:page; page-break-after:always; box-shadow:0 2px 12px rgba(0,0,0,.25); }
          .print-sheet:last-child { break-after:auto; page-break-after:auto; }
          .print-page-body { height:270mm; overflow:hidden; font-size:11.5pt; line-height:1.35; }
          .print-footer { position:absolute; left:14mm; right:14mm; bottom:6mm; text-align:center; font:10pt Georgia,serif; color:#333; }
          .print-page-body > [data-prompt-id], #exportSource > [data-prompt-id] { position:relative; padding-left:var(--print-ann-left,0); padding-right:var(--print-ann-right,0); break-inside:avoid; page-break-inside:avoid; }
          .cue { margin:0 0 .55em; }
          .character,.lyrics-speaker { font-weight:700; }
          .lyrics-block { margin:.15em 0 .4em; }
          .lyrics-speaker { display:block; text-align:center; margin-bottom:.15em; }
          .lyrics { margin-left:.7em; }
          .act-heading { text-align:center; margin:1em 0 .7em; font-size:1.18em; }
          .scene-heading,.song-heading { text-align:center; margin:.8em 0 .5em; font-size:1.08em; }
          .stage-direction { color:#555; font-style:italic; font-size:.86em; line-height:1.25; margin:.3em 1.2em .5em; }
          .stage-inline { color:#555; font-style:italic; font-size:.9em; }
          .print-stage-hidden { display:none !important; }
          .two-column-lyrics { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:7mm; align-items:start; }
          .print-cue-markers { display:flex; flex-wrap:wrap; gap:2mm; margin:0 0 2mm; padding-left:3mm; }
          .print-cue-marker { display:flex; gap:2mm; align-items:baseline; padding:1.1mm 2mm; border-radius:1mm; background:var(--cue-color); color:var(--cue-text-color); font-size:8.5pt; line-height:1.15; }
          .print-cue-marker strong { white-space:nowrap; }
          .print-cue-end { margin:1.5mm 0 1mm 3mm; padding-left:2mm; border-left:2px solid var(--cue-color); color:#555; font:bold 8pt Arial,sans-serif; }
          .print-trigger { padding:0 .08em; background:color-mix(in srgb,var(--cue-color) 70%,transparent); border-left:2px solid var(--cue-color); box-decoration-break:clone; -webkit-box-decoration-break:clone; }
          .print-cue-range { position:absolute; top:0; bottom:0; width:2px; background:var(--cue-color); z-index:3; pointer-events:none; }
          .print-annotation-layer { position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; z-index:4; }
          .print-annotation-layer path,.print-annotation-layer line,.print-annotation-layer ellipse,.print-annotation-layer polygon { vector-effect:non-scaling-stroke; stroke-linecap:round; stroke-linejoin:round; }
          @media print {
            html,body { background:white; }
            #printControls { display:none !important; }
            #printRoot { padding:0; }
            .print-sheet { margin:0; box-shadow:none; }
          }
          @media screen and (max-width:850px) { .print-sheet { transform-origin:top center; } }
        `;
      }

      function createExportSheet(printDoc, sourcePage) {
        const sheet=printDoc.createElement('section');
        sheet.className='print-sheet';
        sheet.dataset.sourcePage=sourcePage || '';
        const body=printDoc.createElement('div');
        body.className='print-page-body';
        const footer=printDoc.createElement('div');
        footer.className='print-footer';
        footer.textContent=sourcePage || '—';
        sheet.append(body,footer);
        printDoc.getElementById('printRoot').appendChild(sheet);
        return body;
      }

      function paginateExportBlocks(printDoc, sourceRoot) {
        const blocks=Array.from(sourceRoot.querySelectorAll(':scope > [data-prompt-id]'));
        let sourcePage=null, body=null;
        for (const original of blocks) {
          if (original.classList.contains('print-stage-hidden')) continue;
          const blockPage=original.dataset.page || sourcePage || '—';
          if (!body || blockPage !== sourcePage) {
            sourcePage=blockPage;
            body=createExportSheet(printDoc,sourcePage);
          }
          body.appendChild(original);
          if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) {
            body.removeChild(original);
            body=createExportSheet(printDoc,sourcePage);
            body.appendChild(original);
          }
        }
      }

      async function buildPdfExport(printWindow) {
        const selected = exportDepartment.value;
        const departments = selected === 'ALL' ? ALLOWED_DEPARTMENTS.slice() : (selected === 'NONE' ? [] : [selected]);
        const includeCues = exportCues.checked && departments.length > 0;
        const includeAnnotations = exportAnnotations.checked && departments.length > 0;
        const stageMode = exportStageDirections.value;

        const scriptResponse = await fetch(SCRIPT_GET_ENDPOINT + '?id=' + encodeURIComponent(getCurrentScriptId()) + '&_=' + Date.now(), {cache:'no-store'});
        if (!scriptResponse.ok) throw new Error('Could not load script for export');
        const scriptHtml = await scriptResponse.text();
        const departmentDocs = await Promise.all(departments.map(d => fetchExportDepartmentData(getCurrentScriptId(),d)));

        const printDoc=printWindow.document;
        printDoc.open();
        printDoc.write('<!doctype html><html><head><meta charset="utf-8"><title>' + exportEscapeHtml(exportScriptName()) + ' - marked-up script</title><style>' + exportPrintCss() + '</style></head><body>' +
          '<div id="printControls"><button id="printNow">Print / Save PDF</button><span class="note">Original script page numbers are preserved. Disable browser headers/footers in the print dialog.</span></div><main id="printRoot"></main></body></html>');
        printDoc.close();

        const parser=new DOMParser();
        const parsed=parser.parseFromString('<div id="exportSource">' + scriptHtml + '</div>','text/html');
        const sourceRoot=printDoc.createElement('div');
        sourceRoot.id='exportSource';
        for (const child of Array.from(parsed.querySelector('#exportSource').children)) {
          if (child.matches('[data-prompt-id]')) sourceRoot.appendChild(printDoc.importNode(child,true));
        }
        sourceRoot.style.position='absolute';
        sourceRoot.style.left='-10000px';
        sourceRoot.style.top='0';
        sourceRoot.style.width='182mm';
        sourceRoot.style.fontSize='11.5pt';
        sourceRoot.style.lineHeight='1.35';
        printDoc.body.appendChild(sourceRoot);

        decorateExportCues(sourceRoot, departmentDocs, includeCues);
        exportApplyStageDirections(sourceRoot, stageMode, departmentDocs);
        exportApplyAnnotationMargins(sourceRoot, departmentDocs, includeAnnotations);
        paginateExportBlocks(printDoc, sourceRoot);
        sourceRoot.remove();

        // Decorations that depend on final block dimensions belong after pagination.
        const printRoot=printDoc.getElementById('printRoot');
        if (includeAnnotations) renderExportAnnotations(printRoot, departmentDocs);
        if (includeCues) addExportCueRangeSegments(printRoot, departmentDocs);

        const printNow=printDoc.getElementById('printNow');
        printNow.addEventListener('click', () => printWindow.print());
        printWindow.focus();
      }

      async function startPdfExport() {
        if (!getCurrentScriptId()) return;
        const printWindow=window.open('', '_blank');
        if (!printWindow) {
          exportStatus.textContent='Pop-up blocked. Allow pop-ups for this site and try again.';
          exportStatus.className='error';
          return;
        }
        printWindow.document.write('<!doctype html><title>Preparing PDF…</title><body style="font:16px Arial;padding:24px">Preparing marked-up script…</body>');
        printWindow.document.close();
        exportOpenBtn.disabled=true;
        exportStatus.textContent='Preparing print view…';
        exportStatus.className='';
        try {
          await buildPdfExport(printWindow);
          closeExportPanel();
        } catch (err) {
          try { printWindow.close(); } catch (_) {}
          exportStatus.textContent=err && err.message ? err.message : 'Could not prepare PDF export.';
          exportStatus.className='error';
        } finally {
          exportOpenBtn.disabled=false;
        }
      }

  return { openExportPanel, closeExportPanel, startPdfExport };
}
