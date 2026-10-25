"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import type { LoginAskOutput } from "@/lib/agent/login-tools";
import { APPLICATIONS_CHANGED } from "./application-cards";
import { kickRuns } from "./applications/ui";
import { saveChatLogin } from "./me/keychain/actions";
import { Field, INPUT, PasswordField, RequestCard, SecretNote, useLoginPrefill } from "./me/keychain/forms";

// The askForLogin tool in the chat: a secure card asking for the person's login on a site. "Save and
// continue" encrypts it into the Keychain through a server action (and hands applications waiting
// for that login back to the browser agent); only { saved, site, login } goes back to the model.
// The password lives in this component's state until then, and nowhere else: not in the tool output,
// the chat's messages or the saved chat history.

export type LoginAskInput = { site: string; siteName: string; reason?: string };

export function LoginAsk({
  input,
  done,
  disabled = false,
  onDone,
}: {
  input: LoginAskInput;
  done?: LoginAskOutput;
  disabled?: boolean;
  onDone?: (output: LoginAskOutput) => void;
}) {
  const interactive = !done && !disabled;
  if (!interactive) return <LoginAskDone input={input} done={done} />;
  return <LoginAskForm input={input} onDone={(output) => onDone?.(output)} />;
}

function LoginAskForm({ input, onDone }: { input: LoginAskInput; onDone: (output: LoginAskOutput) => void }) {
  const id = useId();
  const [login, setLogin] = useLoginPrefill(input.site);
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await saveChatLogin({ site: input.site, login, password, generated });
      if (!r.ok) return setError({ field: r.field, message: r.error });
      setPassword("");
      setGenerated(false);
      if (r.resumed.length) {
        kickRuns(r.resumed); // the waiting applications sign in with it now
        window.dispatchEvent(new Event(APPLICATIONS_CHANGED));
      }
      // The password stays out of this on purpose.
      onDone({ saved: true, site: r.site, login: r.login });
    });
  }

  return (
    <RequestCard site={input.site} title={`Log in to ${input.siteName}`} message={input.reason || null}>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid gap-3">
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
          <Field label="Password" htmlFor={`${id}-password`}>
            <PasswordField
              id={`${id}-password`}
              value={password}
              generated={generated}
              invalid={error?.field === "password"}
              onChange={(value, gen) => {
                setPassword(value);
                setGenerated(gen);
              }}
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-error">
            {error.message}
          </p>
        )}
        <SecretNote />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-hairline-soft pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] font-semibold">
            <button
              type="button"
              disabled={pending}
              onClick={() => onDone({ saved: false, site: input.site, choice: "browser" })}
              className="text-ink underline underline-offset-2 disabled:opacity-40"
            >
              Log in myself in the browser
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDone({ saved: false, site: input.site, choice: "not_now" })}
              className="text-muted underline underline-offset-2 disabled:opacity-40"
            >
              Not now
            </button>
          </div>
          <Button type="submit" size="sm" disabled={pending || !login.trim() || !password}>
            {pending ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </form>
    </RequestCard>
  );
}

/** What's left of the card once answered (or in an older turn): no fields, nothing secret. */
function LoginAskDone({ input, done }: { input: LoginAskInput; done?: LoginAskOutput }) {
  const label = !done
    ? `Asked for your ${input.siteName} login`
    : done.saved
      ? `${input.siteName} login saved · ${done.login}`
      : done.choice === "browser"
        ? `You'll log in to ${input.siteName} in the browser`
        : `${input.siteName} login: not now`;
  return (
    <div className="inline-flex max-w-full items-center gap-2 self-start rounded-full border border-hairline px-3 py-1.5 text-sm font-medium text-ink">
      <SiteIcon site={input.site} size={16} />
      <span className="truncate">{label}</span>
      {done?.saved && <CheckIcon size={15} strokeWidth={2.6} className="shrink-0 text-success" />}
    </div>
  );
}
