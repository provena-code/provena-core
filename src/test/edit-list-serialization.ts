import { readFileSync } from 'fs';
import { join } from 'path';
import { PS2 } from '../progsnap/ProgSnap2Builder';
import { describe, expect, it } from 'vitest';

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

const testFilePaths = [
    'ps2/basic_file_edits.jsonl',
]

describe('Edit List', () => {
    it('should serialize/deserialize identically', () => {
        // testFilePaths.forEach((path) => {
        //     const builder = createBuilderFromFile(path);
        //     const editList = builder.editList;
        //     const serialized = editList.serialize();
        //     expect(serialized).toBeInstanceOf
        //     const deserialized = EditList.deserialize(serialized);

        // });
    });
});