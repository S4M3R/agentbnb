// Passwords the person generates in their own browser (the "Generate a secure password" button on
// the login forms), and the Keychain note that marks them. Browser-safe: no server imports.
//
// A generated password is made with crypto.getRandomValues on the device and only leaves it through
// the Keychain save action, encrypted at rest like any password. The agent's own sign-ups keep using
// the server generator in src/lib/keychain.ts.

// Letters and digits that can't be confused with each other (no 0/O/o, 1/l/I), and symbols almost
// every site accepts (no quotes, backslashes, spaces, angle brackets or &).
export const PASSWORD_SETS = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnpqrstuvwxyz",
  digits: "23456789",
  symbols: "!#$%*+-=?@_",
} as const;

/** A uniform random integer in [0, max), without modulo bias. */
function randomBelow(max: number) {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/**
 * A strong random password: `length` characters (20 by default) with at least one upper, lower,
 * digit and (unless `symbols: false`, for sites that only take letters and digits) symbol.
 */
export function generateSecurePassword({ length = 20, symbols = true }: { length?: number; symbols?: boolean } = {}) {
  const sets = [PASSWORD_SETS.upper, PASSWORD_SETS.lower, PASSWORD_SETS.digits, ...(symbols ? [PASSWORD_SETS.symbols] : [])];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomBelow(s.length)]);
  while (chars.length < Math.max(length, sets.length)) chars.push(all[randomBelow(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// The Keychain has no column for "generated": the entry's (non-secret) notes start with this.
export const GENERATED_NOTE = "Generated password";
const SEPARATOR = " · ";

/** A Keychain entry's notes, split into the "generated" mark and what the person wrote. */
export function splitNotes(notes: string | null | undefined): { generated: boolean; text: string | null } {
  const n = notes?.trim() ?? "";
  if (n === GENERATED_NOTE) return { generated: true, text: null };
  if (n.startsWith(GENERATED_NOTE + SEPARATOR)) return { generated: true, text: n.slice(GENERATED_NOTE.length + SEPARATOR.length).trim() || null };
  return { generated: false, text: n || null };
}

/** The notes to store for an entry: the person's text, marked when the password was generated. */
export function joinNotes(text: string | null | undefined, generated: boolean) {
  const t = text?.trim() || null;
  if (!generated) return t;
  return t ? `${GENERATED_NOTE}${SEPARATOR}${t}` : GENERATED_NOTE;
}
