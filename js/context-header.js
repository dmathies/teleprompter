export function extractActLabel(text) {
    const match = String(text || "").match(
        /\bACT\s+(ONE|TWO|THREE|FOUR|FIVE|I{1,3}|IV|V|\d+)\b/i
    );
    return match ? ("Act " + match[1]) : null;
}

export function createContextHeader({
    headerAct,
    headerScene,
    headerPage,
    viewport,
    promptBlocks,
    referenceLineFraction = 0.35,
    onUpdate = null
}) {
    function referenceBlock() {
        const blocks = promptBlocks();
        if (!blocks.length) return null;

        const y =
            viewport.scrollTop +
            viewport.clientHeight * referenceLineFraction;

        let chosen = blocks[0];
        for (const block of blocks) {
            if (block.offsetTop <= y) chosen = block;
            else break;
        }
        return chosen;
    }

    function previousMatchingBlock(fromBlock, predicate) {
        const blocks = promptBlocks();
        let index = blocks.indexOf(fromBlock);
        if (index < 0) index = blocks.length - 1;

        for (let i = index; i >= 0; --i) {
            if (predicate(blocks[i])) return blocks[i];
        }
        return null;
    }

    function updateContextHeader() {
        const current = referenceBlock();
        if (!current) {
            if (headerAct) headerAct.textContent = "Act —";
            if (headerScene) headerScene.textContent = "Scene —";
            if (headerPage) headerPage.textContent = "Page —";
            if (onUpdate) onUpdate();
            return;
        }

        const scene = previousMatchingBlock(
            current,
            b => b.classList.contains("scene-heading")
        );

        let sceneText = scene ? scene.textContent.trim() : "—";
        if (headerScene) {
            headerScene.textContent =
                /^scene\b/i.test(sceneText) || /^prologue\b/i.test(sceneText)
                    ? sceneText
                    : ("Scene " + sceneText);
        }

        // Act/page metadata are optional. If future script HTML includes
        // data-act/data-page attributes they appear automatically.
        let act =
            current.dataset.act ||
            (scene && scene.dataset.act) ||
            null;

        if (!act) {
            const actBlock = previousMatchingBlock(
                current,
                b =>
                    b.classList.contains("act-heading") ||
                    !!b.dataset.act ||
                    !!extractActLabel(b.textContent)
            );
            if (actBlock) {
                act = actBlock.dataset.act || extractActLabel(actBlock.textContent);
            }
        }

        let page = current.dataset.page || null;
        if (!page) {
            const pageBlock = previousMatchingBlock(
                current,
                b => !!b.dataset.page
            );
            if (pageBlock) page = pageBlock.dataset.page;
        }

        if (headerAct) headerAct.textContent = act ? String(act) : "Act —";
        if (headerPage) headerPage.textContent = page ? ("Page " + page) : "Page —";
        if (onUpdate) onUpdate();
    }

    let contextUpdatePending = false;

    function scheduleContextUpdate() {
        if (contextUpdatePending) return;
        contextUpdatePending = true;
        requestAnimationFrame(() => {
            contextUpdatePending = false;
            updateContextHeader();
        });
    }

    return {
        referenceBlock,
        updateContextHeader,
        scheduleContextUpdate
    };
}
