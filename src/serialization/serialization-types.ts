interface Devaluable<T> {
  toPOJO(): any;
}

type DevaluableConstructor<T> = {
  fromPOJO(obj: any): T;
};