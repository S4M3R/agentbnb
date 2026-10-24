import type { CheckState } from "@/lib/checks";

type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

/** A check as it arrives over the wire (dates are strings). */
export type CheckJson = Jsonify<CheckState>;

export function toJson(check: CheckState | null): CheckJson | null {
  return check ? JSON.parse(JSON.stringify(check)) : null;
}
