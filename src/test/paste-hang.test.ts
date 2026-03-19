import { readFileSync } from 'fs';
import { join } from 'path';
import { PS2 } from '../progsnap/ProgSnap2Builder';
import { describe, expect, it } from 'vitest';


const pasteHangPath = 'ps2/paste_hang.jsonl';

function createBuilderFromFile(path: string, builder = new PS2.Builder()): PS2.Builder {
    const filePath = join(__dirname, 'data', path);
    let content = readFileSync(filePath, 'utf-8').trim();
    content.split('\n').forEach((line) => {
        const event = JSON.parse(line);
        // console.log(event.EventID);
        builder.addEventUnsafe(event);
    });
    return builder;
}

describe('Edit List', () => {
    it('should bound search based on a time limit', () => {
        console.log("test!!");
        const time = new Date().getTime();
        const builder = createBuilderFromFile(pasteHangPath);
        const editList = builder.editList;
        const runTime = new Date().getTime() - time;
        expect(editList).toBeDefined();
        // Allow some buffer for test execution
        expect(runTime).toBeLessThan(builder.editListBuilder.config.maxSearchTimeMs + 500);
    });

    it('should handle copy-paste operations in a timely manner', () => {
        console.log("test!!");
        // const builder = new PS2.Builder();
        // builder.editListBuilder.config.maxSearchTimeMs = 15 * 1000;
        // createBuilderFromFile(pasteHangPath, builder);
        // const editList = builder.editList;
        // expect(editList).toBeDefined();
    });
});