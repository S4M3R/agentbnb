"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import type { NeedsUserAsk } from "@/lib/access";
import { splitNotes } from "@/lib/password";
import { faviconFor } from "@/lib/source-logos";
import { timeAgo } from "../../applications/status";
import {
  deleteLogin,
  forgetBrowserSession,
  revealPassword,
  saveLogin,
  saveSignUpEmail,
  setAllowSignUp,
  type Result,
} from "./actions";
import { EmailRequest, Field, INPUT, LoginRequest, PasswordField } from "./forms";

type Entry = {
  id: string;
  site: string;
  sourceId: string | null;
  name: string;
  login: string;
  createdBy: "person" | "agent";
  status: "active" | "unverified" | "failed";
  notes: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
};
type Session = { sourceId: string; name: string; externalUsername: string | null; connectedAt: string | null };
type Site = { id: string; name: string; url: string | null };
export type PendingAsk = { applicationId: string; title: string; message: string | null; ask: NeedsUserAsk };

const STATUS: Record<Entry["status"], { label: string; cls: string }> = {
  active: { label: "Works", cls: "bg-success-soft text-success" },
  unverified: { label: "Not verified yet", cls: "bg-amber-soft text-amber" },
  failed: { label: "Didn't work last time", cls: "bg-rausch-soft text-rausch-deep" },
};

export function KeychainManager({
  entries,
  sessions,
  sites,
  allowSignUp,
  email,
  pending,
}: {
  entries: Entry[];
  sessions: Session[];
  sites: Site[];
  allowSignUp: boolean;
  email: string | null;
  pending: PendingAsk[];
}) {
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; entry: Entry } | null>(null);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-12">
      {pending.length > 0 && (
        <Section title="Your agent is waiting for you">
          <div className="flex flex-col gap-4">
            {pending.map((p) => (
              <div key={p.applicationId}>
                <p className="mb-2 text-[13px] text-muted">
                  For your application to{" "}
                  <Link href={`/applications/${p.applicationId}`} className="font-semibold text-ink underline underline-offset-2">
                    {p.title}
                  </Link>
                </p>
                {p.ask.kind === "email" ? (
                  <EmailRequest
                    applicationId={p.applicationId}
                    site={p.ask.site ?? null}
                    siteName={p.ask.siteName ?? siteName(p.ask.site ?? "")}
                    message={p.message}
                  />
                ) : (
                  <LoginRequest
                    applicationId={p.applicationId}
                    site={p.ask.site ?? null}
                    siteName={p.ask.siteName ?? siteName(p.ask.site ?? "")}
                    message={p.message}
                  />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Logins"
        action={
          <Button variant="secondary" size="sm" onClick={() => setDialog({ mode: "add" })}>
            <PlusIcon size={16} strokeWidth={2.4} />
            Add a login
          </Button>
        }
      >
        {entries.length ? (
          <ul className="divide-y divide-hairline-soft rounded-[14px] border border-hairline">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} onEdit={() => setDialog({ mode: "edit", entry: e })} />
            ))}
          </ul>
        ) : (
          <div className="rounded-[14px] border border-dashed border-hairline px-6 py-10 text-center">
            <p className="text-[15px] font-semibold">No logins yet</p>
            <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-muted">
              Add the sites you already have accounts on. Your agent also saves the accounts it creates for you here.
            </p>
          </div>
        )}
      </Section>

      {sessions.length > 0 && (
        <Section
          title="Signed in (browser session)"
          lead="Sites where you logged in yourself in your agent's browser. It stays signed in there without a saved password."
        >
          <ul className="divide-y divide-hairline-soft rounded-[14px] border border-hairline">
            {sessions.map((s) => (
              <SessionRow key={s.sourceId} session={s} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Settings">
        <div className="divide-y divide-hairline-soft rounded-[14px] border border-hairline">
          <SignUpSetting initial={allowSignUp} />
          <EmailSetting email={email} />
        </div>
      </Section>

      <SecurityNote />

      {dialog && (
        <LoginDialog
          key={dialog.mode === "edit" ? dialog.entry.id : "add"}
          entry={dialog.mode === "edit" ? dialog.entry : null}
          sites={sites}
          taken={new Set(entries.map((e) => e.site))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Section({ title, lead, action, children }: { title: string; lead?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
          {lead && <p className="mt-1 text-[14px] leading-relaxed text-muted">{lead}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The site's favicon in a soft square, or its first letter for sites we have no icon for. */
function SiteBadge({ site, name, size = 44 }: { site: string; name: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-surface-strong text-[15px] font-semibold uppercase text-body"
      style={{ width: size, height: size }}
    >
      {faviconFor(site) ? <SiteIcon site={site} size={Math.round(size * 0.5)} /> : name.slice(0, 1)}
    </span>
  );
}

function EntryRow({ entry, onEdit }: { entry: Entry; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // "Works" only once the agent actually signed in with it.
  const status = entry.status === "active" && !entry.lastUsedAt ? null : STATUS[entry.status];
  const notes = splitNotes(entry.notes);

  // A revealed password hides itself again after 30 seconds.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
    });

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <SiteBadge site={entry.site} name={entry.name} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[16px] font-semibold">{entry.name}</span>
            {status && (
              <span className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-bold ${status.cls}`}>
                {status.label}
              </span>
            )}
            {notes.generated && (
              <span className="inline-flex h-[22px] items-center rounded-full bg-surface-strong px-2 text-[11px] font-bold text-ink">
                Generated
              </span>
            )}
          </div>
          <div className="truncate text-[14px] text-body">{entry.login}</div>
          <div className="text-[13px] text-muted">
            {entry.createdBy === "agent" ? "Created by your agent" : "Saved by you"} ·{" "}
            {entry.lastUsedAt ? `Last used ${timeAgo(entry.lastUsedAt)}` : "Not used yet"}
          </div>
          {notes.text && <div className="mt-0.5 truncate text-[13px] text-muted">{notes.text}</div>}
          {revealed && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-surface-strong px-2 py-1 font-mono text-[13px] tracking-wide text-ink">{revealed}</code>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(revealed).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                }
                className="text-[13px] font-semibold underline underline-offset-2"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => setRevealed(null)} className="text-[13px] font-semibold text-muted underline underline-offset-2">
                Hide
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-1 text-[13px] text-error">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 pl-[60px] sm:pl-0">
        {entry.createdBy === "agent" && !revealed && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await revealPassword(entry.id);
                if (r.ok) setRevealed(r.password);
                else setError(r.error);
              })
            }
          >
            Reveal
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit} disabled={pending}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete your ${entry.name} login from the Keychain?`)) run(() => deleteLogin(entry.id));
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

function SessionRow({ session }: { session: Session }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <SiteBadge site={session.sourceId} name={session.name} />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{session.name}</div>
          <div className="text-[13px] text-muted">
            {session.externalUsername ? `${session.externalUsername} · ` : ""}Signed in (browser session)
            {session.connectedAt ? ` · since ${timeAgo(session.connectedAt)}` : ""}
          </div>
          {error && <p className="mt-1 text-[13px] text-error">{error}</p>}
        </div>
      </div>
      <div className="pl-[60px] sm:pl-0">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Forget your ${session.name} session? Your agent will need to sign in again next time.`)) return;
            start(async () => {
              const r = await forgetBrowserSession(session.sourceId);
              if (!r.ok) setError(r.error);
            });
          }}
        >
          {pending ? "Forgetting…" : "Forget"}
        </Button>
      </div>
    </li>
  );
}

function SignUpSetting({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="flex items-start gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="text-[16px] font-semibold">
          Let my agent create accounts for me when a site needs one
        </p>
        <p id={`${id}-hint`} className="mt-0.5 text-[14px] leading-relaxed text-muted">
          It signs up for free accounts with your name and email, saves the login here, and agrees to the site&apos;s terms
          for a free account. It never pays or starts a membership.
        </p>
        {error && <p className="mt-1 text-[13px] text-error">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        disabled={pending}
        onClick={() => {
          const next = !on;
          setOn(next);
          setError(null);
          start(async () => {
            const r = await setAllowSignUp(next);
            if (!r.ok) {
              setOn(!next);
              setError(r.error);
            }
          });
        }}
        className={`relative mt-1 h-8 w-12 shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-ink" : "bg-border-strong"}`}
      >
        <span
          className={`absolute left-1 top-1 flex size-6 items-center justify-center rounded-full bg-canvas shadow-sm transition-transform duration-200 ${on ? "translate-x-4" : ""}`}
        >
          {on && <CheckIcon size={12} strokeWidth={3} className="text-ink" />}
        </span>
      </button>
    </div>
  );
}

function EmailSetting({ email }: { email: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold">Email for new accounts</p>
          <p className="mt-0.5 truncate text-[14px] text-muted">{email ?? "Not added yet. Your agent needs one to sign you up."}</p>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="underline underline-offset-2">
            {email ? "Edit" : "Add"}
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await saveSignUpEmail(value);
              if (!r.ok) return setError(r.error);
              setEditing(false);
            });
          }}
        >
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`${id}-email`} className="sr-only">
              Email
            </label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              className={`${INPUT} ${error ? "border-error" : "border-hairline"}`}
              autoFocus
            />
          </div>
          <Button type="submit" size="sm" className="h-12" disabled={pending || !value.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" size="sm" className="h-12" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {error && <p className="w-full text-[13px] text-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

function SecurityNote() {
  return (
    <section className="flex gap-4 rounded-[14px] bg-surface-soft p-5 sm:p-6">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-canvas text-ink">
        <ShieldIcon size={20} />
      </span>
      <div className="min-w-0 text-[14px] leading-relaxed text-body">
        <h2 className="text-[16px] font-semibold text-ink">How your passwords are protected</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Passwords are encrypted (AES-256-GCM) before they&apos;re stored, with a key kept apart from the database.</li>
          <li>The AI model never sees them. Your agent fills them straight into the site&apos;s login form in its browser.</li>
          <li>They&apos;re write-only: you can replace one, but not read it back. Only passwords your agent created can be revealed, so you can log in yourself.</li>
          <li>Your agent only signs in when a site actually needs it, and never pays or starts a membership for you.</li>
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add / edit
// ---------------------------------------------------------------------------

const OTHER = "__other";

function LoginDialog({
  entry,
  sites,
  taken,
  onClose,
}: {
  entry: Entry | null;
  sites: Site[];
  taken: Set<string>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [site, setSite] = useState<string | null>(entry?.site ?? null);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [login, setLogin] = useState(entry?.login ?? "");
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [notes, setNotes] = useState(splitNotes(entry?.notes).text ?? "");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  // Unmounting removes it from the top layer; closing in a cleanup would fire onClose (and, in
  // Strict Mode's double effect, dismiss the dialog as soon as it opened).
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((s) => !q || s.name.toLowerCase().includes(q) || s.id.includes(q));
  }, [sites, query]);

  const picked = site && site !== OTHER ? (sites.find((s) => s.id === site) ?? { id: site, name: entry?.name ?? site, url: null }) : null;
  const ready = !!(picked || (site === OTHER && url.trim()));

  function submit() {
    setError(null);
    start(async () => {
      const r = await saveLogin({ site: site === OTHER ? url : site!, login, password, notes, generated });
      if (!r.ok) return setError({ field: r.field, message: r.error });
      onClose();
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={`${id}-title`}
      className="m-auto max-h-[min(720px,calc(100dvh-2rem))] w-[min(568px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-canvas p-0 text-ink shadow-float backdrop:bg-black/50"
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="relative flex h-16 shrink-0 items-center justify-center border-b border-hairline-soft px-14">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute left-3 flex size-10 items-center justify-center rounded-full transition-colors hover:bg-surface-strong"
          >
            <CloseIcon size={16} strokeWidth={2.4} />
          </button>
          <h2 id={`${id}-title`} className="text-[16px] font-semibold">
            {entry ? `Edit ${entry.name} login` : "Add a login"}
          </h2>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) submit();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {!entry && (
              <fieldset className="mb-6">
                <legend className="mb-2 text-[13px] font-semibold">Site</legend>
                {picked ? (
                  <div className="flex items-center gap-3 rounded-lg border border-hairline px-3 py-2.5">
                    <SiteBadge site={picked.id} name={picked.name} size={32} />
                    <span className="flex-1 truncate font-semibold">{picked.name}</span>
                    <button type="button" onClick={() => setSite(null)} className="text-[14px] font-semibold underline underline-offset-2">
                      Change
                    </button>
                  </div>
                ) : site === OTHER ? (
                  <div>
                    <Field label="Website address" htmlFor={`${id}-url`} hint="Any site, e.g. example.com">
                      <input
                        id={`${id}-url`}
                        value={url}
                        onChange={(e) => setUrl(e.currentTarget.value)}
                        placeholder="example.com"
                        inputMode="url"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoFocus
                        className={`${INPUT} ${error?.field === "site" ? "border-error" : "border-hairline"}`}
                      />
                    </Field>
                    <button type="button" onClick={() => setSite(null)} className="mt-2 text-[14px] font-semibold underline underline-offset-2">
                      Pick from the list instead
                    </button>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-hairline">
                    <div className="flex items-center gap-2 border-b border-hairline-soft px-3">
                      <SearchIcon size={16} className="shrink-0 text-muted" />
                      <label htmlFor={`${id}-q`} className="sr-only">
                        Search sites
                      </label>
                      <input
                        id={`${id}-q`}
                        value={query}
                        onChange={(e) => setQuery(e.currentTarget.value)}
                        placeholder="Search sites"
                        autoFocus
                        className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
                      />
                    </div>
                    <ul className="max-h-64 overflow-y-auto py-1">
                      {shown.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setSite(s.id)}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left text-[15px] transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px]"
                          >
                            <SiteBadge site={s.id} name={s.name} size={28} />
                            <span className="flex-1 truncate">{s.name}</span>
                            {taken.has(s.id) && <span className="text-[12px] text-muted">Saved</span>}
                          </button>
                        </li>
                      ))}
                      <li>
                        <button
                          type="button"
                          onClick={() => setSite(OTHER)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left text-[15px] font-semibold transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px]"
                        >
                          <span className="flex size-7 items-center justify-center rounded-lg bg-surface-strong">
                            <PlusIcon size={14} strokeWidth={2.4} />
                          </span>
                          Other website
                        </button>
                      </li>
                    </ul>
                  </div>
                )}
              </fieldset>
            )}

            {(entry || ready) && (
              <div className="flex flex-col gap-4">
                <Field label="Email or username" htmlFor={`${id}-login`}>
                  <input
                    id={`${id}-login`}
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={login}
                    onChange={(e) => setLogin(e.currentTarget.value)}
                    className={`${INPUT} ${error?.field === "login" ? "border-error" : "border-hairline"}`}
                  />
                </Field>
                <Field
                  label={entry ? "New password" : "Password"}
                  htmlFor={`${id}-password`}
                  hint={entry ? "Leave blank to keep the saved one. Saved passwords can't be shown." : undefined}
                >
                  <PasswordField
                    id={`${id}-password`}
                    autoComplete={entry ? "new-password" : "current-password"}
                    value={password}
                    generated={generated}
                    invalid={error?.field === "password"}
                    onChange={(value, gen) => {
                      setPassword(value);
                      setGenerated(gen);
                    }}
                  />
                </Field>
                <Field label="Notes (optional)" htmlFor={`${id}-notes`} hint="Not secret. For example, the username if you log in with your email.">
                  <input
                    id={`${id}-notes`}
                    value={notes}
                    onChange={(e) => setNotes(e.currentTarget.value)}
                    maxLength={500}
                    className={`${INPUT} border-hairline`}
                  />
                </Field>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-4 text-[13px] text-error">
                {error.message}
              </p>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline-soft px-6 py-4">
            <button type="button" onClick={onClose} className="text-[15px] font-semibold underline underline-offset-2">
              Cancel
            </button>
            <Button type="submit" disabled={pending || !ready || !login.trim() || (!entry && !password)}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </footer>
        </form>
      </div>
    </dialog>
  );
}
