import { readFileSync } from 'fs';
import { join } from 'path';
import { PS2 } from '../progsnap/ProgSnap2Builder';
import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../serialization/serialization-types';
import { EditList } from '../edits/EditList';

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

function expectEqualWith<T>(a: T, b: T, property: (x: T) => any): void {
    expect(property(a)).toEqual(property(b));
}

describe('Edit List', () => {
    it('should serialize/deserialize identically', () => {
        testFilePaths.forEach((path) => {
            const builder = createBuilderFromFile(path);
            const editList = builder.editList;
            const serialized = serialize(editList);
            expect(typeof serialized).toBe('string');
            const deserialized = deserialize<EditList>(serialized);

            expect(deserialized).toBeInstanceOf(EditList);

            expectEqualWith(deserialized, editList, x => x.toPlainText());
            expectEqualWith(deserialized, editList, x => x.getEdits().length);
            expectEqualWith(deserialized, editList, x => x.getHeadChildren().length);
            expectEqualWith(deserialized, editList, x => x.getHeadChildren()[0].getOutEdges().length);
        });
    });

    // TODO: Test that parents are correctly re-added
});