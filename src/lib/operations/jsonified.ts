/** Fields JSON omits from objects (array slots and top-level void become null). */
type JsonOmitted = undefined | symbol | ((...args: never[]) => unknown);

type JsonObject<T> = {
  [K in keyof T as K extends symbol ? never :
    Extract<T[K], JsonOmitted> extends never ? K : never]: Jsonified<T[K]>
} & {
  [K in keyof T as K extends symbol ? never :
    T[K] extends JsonOmitted ? never :
    Extract<T[K], JsonOmitted> extends never ? never : K]?: Jsonified<Exclude<T[K], JsonOmitted>>
};

/** The recursive JSON representation returned on every operation path. */
export type Jsonified<T> =
  T extends Date ? string :
  T extends JsonOmitted | void ? null :
  T extends readonly unknown[] ? { [K in keyof T]: Jsonified<T[K]> } :
  T extends object ? JsonObject<T> : T;
