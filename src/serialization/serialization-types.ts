import * as devalue from 'devalue';
import { EditNode, Span } from '../shared/edit-data';
import { EditList } from '../edits/EditList';

export interface Devaluable {
  toPOJO(): any;
}

type DevaluableConstructor<T extends Devaluable> = {
  new (...args: any[]): T;
  fromPOJO(data: any): T;
};

// TODO: Could make this a class we can create different instances of
// but honestly that feels unnecessary since we can just put all of them
// in one and it doesn't hurt anything.
const classes: DevaluableConstructor<any>[] = [];
function registerSerializable<T extends Devaluable>(cls: DevaluableConstructor<T>) {
  classes.push(cls);
}
registerSerializable(EditList);
registerSerializable(EditNode);
registerSerializable(Span);

const reducers = Object.fromEntries(
  classes.map(cls => [
    cls.name,
    (val: any) => val instanceof cls ? val.toPOJO() : undefined
  ])
);

const revivers = Object.fromEntries(
  classes.map(cls => [
    cls.name,
    (data: any) => cls.fromPOJO(data)
  ])
);

export function serialize(obj: any): string {
    const value = devalue.stringify(obj, reducers);
    if (typeof value !== 'string') {
        return JSON.stringify(value);
    }
    return value;
}

export function deserialize<T>(str: string): T {
  return devalue.parse(str, revivers);
}
