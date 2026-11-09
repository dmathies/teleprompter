export function createScriptEditor({dialog, getScriptId, getScripts, getMode, getMasterKey,
    getPosition, stopPlayback, pauseFollowing, reloadScript, setStatus}) {
    const notice = document.getElementById('scriptUpdateNotice');
    const loadButton = document.getElementById('loadScriptUpdate');
    const updateStatus = document.getElementById('scriptUpdateStatus');
    let editingScript = null;
    let expectedRevision = null;
    let loadedRevision = null;
    let revisions = {};
    let opening = false;
    let updating = false;
    let acknowledgedUpdate = null;

    function updateNotice() {
        const revision = revisions[getScriptId()]?.revision;
        notice.hidden = !revision || revision === loadedRevision || revision === acknowledgedUpdate;
    }
    async function request(options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch('/scripts/script_editor_api.php' + (options.method ? '' : '?script=' + encodeURIComponent(getScriptId())), {
                cache: 'no-store', ...options, signal: controller.signal,
                headers: {'Content-Type': 'application/json', 'X-Teleprompter-Key': getMasterKey() || ''}
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Script editor request failed');
            return body;
        } finally { clearTimeout(timeout); }
    }
    async function open() {
        if (opening || dialog.open) return;
        if (getMode() !== 'master') { setStatus('PRM login required to edit scripts', 'warn'); return; }
        opening = true;
        stopPlayback();
        const script = getScriptId();
        const position = getPosition();
        try {
            const body = await request();
            if (getScriptId() !== script || getMode() !== 'master') return;
            editingScript = script; expectedRevision = body.revision;
            await dialog.show(body.blocks, position?.prompt, getScripts().find(item => item.id === script)?.name || script);
        } catch (error) { setStatus(error.message || 'Could not open script editor', 'error'); }
        finally { opening = false; }
    }
    dialog.addEventListener('editor-save', async event => {
        if (dialog.busy) return;
        if (getMode() !== 'master' || getScriptId() !== editingScript) {
            dialog.error = 'PRM control or selected script changed. Copy your draft before reopening the editor.'; return;
        }
        dialog.busy = true; dialog.error = '';
        try {
            const body = await request({method: 'POST', body: JSON.stringify({script: editingScript, expectedRevision,
                operations: event.detail.operations})});
            revisions[editingScript] = {revision: body.revision};
            const position = getPosition();
            // A successful save must not be submitted again if the subsequent reload fails.
            dialog.close(true);
            try {
                if (getScriptId() === editingScript) await reloadScript(editingScript, position);
                setStatus(body.notice || 'Script saved; check cues and annotations on edited text', body.notice ? 'warn' : 'ok');
            } catch (_) { setStatus('Script saved, but display refresh failed. Reload the page.', 'error'); }
        } catch (error) {
            dialog.error = error.name === 'AbortError'
                ? 'Save timed out. The server may have saved it. Copy your draft and reopen the editor to check before retrying.'
                : error.message;
        } finally { dialog.busy = false; }
    });
    loadButton.addEventListener('click', async () => {
        if (updating || dialog.open) return;
        updating = true; loadButton.disabled = true; updateStatus.textContent = '';
        const revision = revisions[getScriptId()]?.revision;
        pauseFollowing(); stopPlayback();
        try {
            await reloadScript(getScriptId());
            acknowledgedUpdate = revision;
            updateNotice();
        } catch (_) { updateStatus.textContent = 'Could not load changes. Try again.'; }
        finally { updating = false; loadButton.disabled = false; }
    });
    window.addEventListener('beforeunload', event => {
        if (!dialog.open || (!dialog.busy && !dialog.operations.length)) return;
        event.preventDefault(); event.returnValue = '';
    });
    return {
        open,
        scriptLoaded(revision) {
            loadedRevision = revision;
            acknowledgedUpdate = null;
            updateNotice();
        },
        handleRevisionEvent(event) {
            try {
                const body = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (!body || typeof body !== 'object') return;
                revisions = body.revisions || body;
                updateNotice();
            } catch (_) { /* malformed notifications cannot change the script */ }
        }
    };
}
