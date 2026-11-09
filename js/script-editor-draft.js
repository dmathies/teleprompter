// The draft contains text fields, never decorated live-script markup.
export function scriptEditorOperations(blocks, originals) {
    const operations = [];
    const originalById = new Map(originals.map(block => [block.id, block]));
    for (const [index, block] of blocks.entries()) {
        const original = originalById.get(block.id);
        if (original) {
            const fields = {};
            for (const field of block.fields) {
                if (field.value !== original.fields.find(item => item.key === field.key)?.value) fields[field.key] = field.value;
            }
            if (Object.keys(fields).length) operations.push({action: 'update', target: block.id, fields});
            if (block.kind !== original.kind) operations.push({action: 'change-type', target: block.id, kind: block.kind});
        } else {
            const before = blocks.find(item => originalById.has(item.id));
            operations.push({action: 'insert', key: block.id, kind: block.kind,
                target: index ? blocks[index - 1].id : before.id, side: index ? 'after' : 'before',
                speaker: block.fields.find(field => field.key === 'speaker')?.value || '',
                text: block.fields.find(field => field.key === 'text')?.value || ''});
        }
    }
    return operations;
}

export function newScriptEditorBlock(id, kind, reference) {
    return {id, kind, page: reference.page, act: reference.act, scene: reference.scene,
        fields: [
            ...(['dialogue', 'lyrics'].includes(kind) ? [{key: 'speaker', label: kind === 'lyrics' ? 'Singer' : 'Character (include colon if needed)', value: ''}] : []),
            {key: 'text', label: kind === 'lyrics' ? 'Lyrics (one line per sung line)' : 'Text', value: ''}
        ]};
}
