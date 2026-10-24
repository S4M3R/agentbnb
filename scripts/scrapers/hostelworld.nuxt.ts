// Parse Hostelworld's server-rendered `window.__NUXT__=(function(a,b,...){...;return {...}}(v1,v2,...))`
// payload WITHOUT evaluating it: a tiny parser for the JS literal subset Nuxt emits
// (object/array literals, strings, numbers, true/false/null, void 0, identifiers bound
// to the IIFE's parameters, and `x.key=value;` assignments before the return).

type Value = unknown;

class Parser {
  i = 0;
  constructor(
    private s: string,
    private scope: Map<string, Value> = new Map(),
  ) {}

  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(ch: string) {
    this.ws();
    if (this.s[this.i] !== ch) throw new Error(`expected ${ch} at ${this.i}: ${this.s.slice(this.i, this.i + 40)}`);
    this.i++;
  }
  ident() {
    this.ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 64));
    if (!m) throw new Error(`expected identifier at ${this.i}: ${this.s.slice(this.i, this.i + 40)}`);
    this.i += m[0].length;
    return m[0];
  }
  string() {
    const q = this.s[this.i++];
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      if (e === "u") {
        if (this.s[this.i] === "{") {
          const end = this.s.indexOf("}", this.i);
          out += String.fromCodePoint(Number.parseInt(this.s.slice(this.i + 1, end), 16));
          this.i = end + 1;
        } else {
          out += String.fromCharCode(Number.parseInt(this.s.slice(this.i, this.i + 4), 16));
          this.i += 4;
        }
      } else if (e === "x") {
        out += String.fromCharCode(Number.parseInt(this.s.slice(this.i, this.i + 2), 16));
        this.i += 2;
      } else if (e === "\n") {
        /* line continuation */
      } else out += ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[e] ?? e;
    }
    throw new Error("unterminated string");
  }
  value(): Value {
    const c = this.peek();
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string();
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(this.s.slice(this.i, this.i + 40));
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    const id = this.ident();
    if (id === "true") return true;
    if (id === "false") return false;
    if (id === "null") return null;
    if (id === "void") {
      this.value();
      return undefined;
    }
    if (id === "new") {
      // new Set([...]) / new Map([...]) / new Date(...): keep the plain argument.
      const ctor = this.ident();
      this.eat("(");
      const arg = this.peek() === ")" ? undefined : this.value();
      this.eat(")");
      return ctor === "Date" ? String(arg) : arg;
    }
    if (id === "Array" && this.peek() === "(") {
      this.eat("(");
      const n = this.value() as number;
      this.eat(")");
      return new Array(n).fill(undefined);
    }
    if (id === "Object" && this.s.startsWith(".create(null)", this.i)) {
      this.i += ".create(null)".length;
      return {};
    }
    if (!this.scope.has(id)) throw new Error(`unknown identifier ${id} at ${this.i}`);
    return this.scope.get(id);
  }
  object() {
    this.eat("{");
    const o: Record<string, Value> = {};
    while (this.peek() !== "}") {
      const c = this.peek();
      const key = c === '"' || c === "'" ? this.string() : /\d/.test(c) ? String(this.value()) : this.ident();
      this.eat(":");
      o[key] = this.value();
      if (this.peek() === ",") this.i++;
    }
    this.eat("}");
    return o;
  }
  array() {
    this.eat("[");
    const a: Value[] = [];
    while (this.peek() !== "]") {
      a.push(this.value());
      if (this.peek() === ",") this.i++;
    }
    this.eat("]");
    return a;
  }
}

/** Extract and parse `window.__NUXT__` from a Hostelworld HTML page. */
export function parseNuxt(html: string): Record<string, unknown> | null {
  const start = html.indexOf("window.__NUXT__=(function(");
  if (start === -1) return null;
  const end = html.indexOf("</script>", start);
  const src = html.slice(start + "window.__NUXT__=".length, end).replace(/;\s*$/, "");

  const paramsStart = src.indexOf("(function(") + "(function(".length;
  const paramsEnd = src.indexOf(")", paramsStart);
  const params = src.slice(paramsStart, paramsEnd).split(",").map((p) => p.trim());

  // Arguments: the trailing `(v1,v2,...))`. Find the body's end by parsing the body
  // with placeholder scope first is impossible, so locate args from the end instead:
  // walk the args list with the parser starting at the matching "}(".
  const bodyStart = src.indexOf("{", paramsEnd);
  const argsStart = findBodyEnd(src, bodyStart) + 1; // index of "(" after "}"
  const argParser = new Parser(src);
  argParser.i = argsStart;
  argParser.eat("(");
  const args: Value[] = [];
  while (argParser.peek() !== ")") {
    args.push(argParser.value());
    if (argParser.peek() === ",") argParser.i++;
  }
  const scope = new Map<string, Value>(params.map((p, idx) => [p, args[idx]]));

  // Body: `x.a=1;y.b.c=2;...;return {...}`
  const body = new Parser(src.slice(bodyStart + 1, argsStart - 1), scope);
  for (;;) {
    body.ws();
    if (body["s"].startsWith("return", body.i)) {
      body.i += "return".length;
      return body.value() as Record<string, unknown>;
    }
    // assignment: ident(.key|["key"])* = value ;
    let target = scope.get(body.ident()) as Record<string, Value>;
    const path: string[] = [];
    for (;;) {
      const c = body.peek();
      if (c === ".") {
        body.i++;
        path.push(body.ident());
      } else if (c === "[") {
        body.i++;
        path.push(String(body.value()));
        body.eat("]");
      } else break;
    }
    body.eat("=");
    const v = body.value();
    for (const k of path.slice(0, -1)) target = target[k] as Record<string, Value>;
    target[path.at(-1)!] = v;
    if (body.peek() === ";") body.i++;
  }
}

/** Index of the "}" that closes the function body opened at `open`, skipping strings. */
function findBodyEnd(s: string, open: number) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced function body");
}
