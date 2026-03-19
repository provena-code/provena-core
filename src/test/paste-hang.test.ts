import { readFileSync } from 'fs';
import { join } from 'path';
import { PS2 } from '../progsnap/ProgSnap2Builder';
import { expect, it } from 'vitest';


const pasteHangPath = 'ps2/paste_hang.jsonl';

function createEditListFromFile(path: string) {
    const filePath = join(__dirname, 'data', path);
    let content = readFileSync(filePath, 'utf-8').trim();
    const builder = new PS2.Builder();
    content.split('\n').forEach((line) => {
        const event = JSON.parse(line);
        builder.addEventUnsafe(event);
    });
    return builder.editList;
}

describe('Edit List', () => {
    it('should handle copy-paste operations without hanging', { timeout: 4000 }, async () => {
        // await new Promise(resolve => setTimeout(resolve, 3000));
        // const time = new Date().getTime();
        const editList = createEditListFromFile(pasteHangPath);
        // The problem is EditList.searchHistory
        expect(editList).toBeDefined();
    });
});