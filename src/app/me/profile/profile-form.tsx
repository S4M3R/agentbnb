"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CheckIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { uploadPhoto } from "../../photo-upload";
import { ProfileAbout, ProfileCard } from "../../people/profile-card";
import { PROFILE_CHANGED } from "@/components/shell/nav";
import { saveProfile } from "./actions";

type Initial = {
  id: string;
  name: string;
  avatarUrl: string | null;
  bio: string;
  homeCity: string;
  languages: string[];
  verified: boolean;
  memberSince: string;
} | null;

type Fields = { name: string; avatarUrl: string | null; bio: string; homeCity: string; languages: string[] };

const BIO_MAX = 1000;
const COMMON_LANGUAGES = ["English", "Spanish", "French", "Portuguese", "German", "Italian"];

const INPUT =
  "w-full rounded-lg border bg-canvas px-3.5 text-[16px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--color-ink)]";

export function ProfileForm({ initial }: { initial: Initial }) {
  const [id, setId] = useState(initial?.id ?? null);
  const [fields, setFields] = useState<Fields>({
    name: initial?.name ?? "",
    avatarUrl: initial?.avatarUrl ?? null,
    bio: initial?.bio ?? "",
    homeCity: initial?.homeCity ?? "",
    languages: initial?.languages ?? [],
  });
  const [saved, setSaved] = useState(JSON.stringify(fields));
  const [langDraft, setLangDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(fields) !== saved || langDraft.trim() !== "";
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setJustSaved(false);
    if (error?.field === key) setError(null);
  };

  function addLanguages(text: string) {
    const next = [...fields.languages];
    for (const raw of text.split(",")) {
      const l = raw.trim();
      if (!l || next.some((x) => x.toLowerCase() === l.toLowerCase())) continue;
      next.push(l.charAt(0).toUpperCase() + l.slice(1));
    }
    set("languages", next.slice(0, 10));
    setLangDraft("");
  }

  function onLangKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addLanguages(langDraft);
    } else if (e.key === "Backspace" && !langDraft && fields.languages.length) {
      set("languages", fields.languages.slice(0, -1));
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadPhoto(file, "avatars");
      set("avatarUrl", url);
    } catch {
      setError({ field: "avatarUrl", message: "Couldn't upload that photo. Try a JPEG or PNG." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    // A language still in the box counts too.
    const languages = langDraft.trim() ? [...fields.languages, ...langDraft.split(",")] : fields.languages;
    const submitted = { ...fields, languages };
    startTransition(async () => {
      const result = await saveProfile(submitted);
      if (!result.ok) {
        setError({ field: result.field, message: result.error });
        return;
      }
      setId(result.id);
      window.dispatchEvent(new Event(PROFILE_CHANGED));
      if (langDraft.trim()) addLanguages(langDraft);
      setSaved(JSON.stringify({ ...fields, languages: dedupe(languages) }));
      setError(null);
      setJustSaved(true);
    });
  }

  const preview = {
    name: fields.name.trim() || "You",
    avatarUrl: fields.avatarUrl,
    bio: fields.bio.trim() || null,
    homeCity: fields.homeCity.trim() || null,
    languages: fields.languages,
    verified: initial?.verified ?? false,
    memberSince: initial?.memberSince ?? new Date().toISOString(),
  };
  const suggestions = COMMON_LANGUAGES.filter((l) => !fields.languages.some((x) => x.toLowerCase() === l.toLowerCase()));

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
      <form
        className="min-w-0 space-y-7"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Photo" error={error?.field === "avatarUrl" ? error.message : undefined}>
          <div className="flex items-center gap-5">
            <Avatar name={fields.name || "?"} src={fields.avatarUrl} size={88} className={uploading ? "opacity-50" : ""} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : fields.avatarUrl ? "Change photo" : "Upload a photo"}
              </Button>
              {fields.avatarUrl && !uploading && (
                <Button variant="ghost" size="sm" onClick={() => set("avatarUrl", null)}>
                  Remove
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              hidden
              onChange={(e) => onPhoto(e.currentTarget.files?.[0])}
            />
          </div>
          <p className="mt-2 text-[13px] text-muted">A clear photo of your face helps hosts say yes.</p>
        </Field>

        <Field label="Name" htmlFor="profile-name" error={error?.field === "name" ? error.message : undefined}>
          <input
            id="profile-name"
            value={fields.name}
            onChange={(e) => set("name", e.currentTarget.value)}
            placeholder="What hosts should call you"
            maxLength={80}
            autoComplete="given-name"
            aria-invalid={error?.field === "name"}
            className={`${INPUT} h-14 ${error?.field === "name" ? "border-error" : "border-hairline"}`}
          />
        </Field>

        <Field label="Where you live" htmlFor="profile-city" error={error?.field === "homeCity" ? error.message : undefined}>
          <input
            id="profile-city"
            value={fields.homeCity}
            onChange={(e) => set("homeCity", e.currentTarget.value)}
            placeholder="e.g. Buenos Aires, Argentina"
            maxLength={120}
            autoComplete="address-level2"
            className={`${INPUT} h-14 ${error?.field === "homeCity" ? "border-error" : "border-hairline"}`}
          />
        </Field>

        <Field
          label="Languages you speak"
          htmlFor="profile-languages"
          error={error?.field === "languages" ? error.message : undefined}
        >
          <div
            className={`flex min-h-14 flex-wrap items-center gap-2 rounded-lg border bg-canvas px-2.5 py-2 transition-[border-color,box-shadow] focus-within:border-ink focus-within:shadow-[inset_0_0_0_1px_var(--color-ink)] ${error?.field === "languages" ? "border-error" : "border-hairline"}`}
          >
            {fields.languages.map((l) => (
              <span key={l} className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-strong pl-3 pr-1 text-sm font-medium">
                {l}
                <button
                  type="button"
                  onClick={() => set("languages", fields.languages.filter((x) => x !== l))}
                  aria-label={`Remove ${l}`}
                  className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-hairline"
                >
                  <CloseIcon size={12} strokeWidth={2.6} />
                </button>
              </span>
            ))}
            <input
              id="profile-languages"
              value={langDraft}
              onChange={(e) => setLangDraft(e.currentTarget.value)}
              onKeyDown={onLangKey}
              onBlur={() => langDraft.trim() && addLanguages(langDraft)}
              placeholder={fields.languages.length ? "Add another" : "Type a language and press Enter"}
              disabled={fields.languages.length >= 10}
              maxLength={40}
              className="h-9 min-w-[10rem] flex-1 bg-transparent px-1 text-[16px] outline-none placeholder:text-muted"
            />
          </div>
          {suggestions.length > 0 && fields.languages.length < 10 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => addLanguages(l)}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-hairline px-3 text-[13px] font-medium transition-colors hover:border-ink"
                >
                  <PlusIcon size={12} strokeWidth={2.6} />
                  {l}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="About you" htmlFor="profile-bio" error={error?.field === "bio" ? error.message : undefined}>
          <textarea
            id="profile-bio"
            value={fields.bio}
            onChange={(e) => set("bio", e.currentTarget.value)}
            placeholder="Who you are, what you do, why you travel, and what you're like as a guest or host."
            rows={6}
            maxLength={BIO_MAX}
            className={`${INPUT} resize-y py-3 leading-relaxed ${error?.field === "bio" ? "border-error" : "border-hairline"}`}
          />
          <p className="mt-1.5 text-right text-[12px] tabular-nums text-muted">
            {fields.bio.length} / {BIO_MAX}
          </p>
        </Field>

        {error && !error.field && (
          <p role="alert" className="text-[14px] text-error">
            {error.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
          <Button type="submit" disabled={pending || uploading || (!dirty && !!id)}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
          {id && (
            <Link
              href={`/people/${id}`}
              className="inline-flex h-12 items-center rounded-lg px-4 text-base font-medium underline underline-offset-2 transition-colors hover:bg-surface-strong"
            >
              View public profile
            </Link>
          )}
          <span aria-live="polite" className="text-[14px] font-medium text-success">
            {justSaved && !dirty && (
              <span className="inline-flex items-center gap-1.5">
                <CheckIcon size={16} strokeWidth={2.6} />
                Saved
              </span>
            )}
          </span>
        </div>
      </form>

      <section aria-label="Preview" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Preview</p>
          {id && (
            <Link href={`/people/${id}`} className="text-[14px] font-semibold underline underline-offset-2">
              View public profile
            </Link>
          )}
        </div>
        <div className="space-y-8 rounded-[20px] bg-surface-soft p-5 sm:p-7">
          <ProfileCard profile={preview} />
          <ProfileAbout profile={preview} heading="h2" emptyBio="Your bio shows up here." />
        </div>
      </section>
    </div>
  );
}

function dedupe(list: string[]) {
  const seen = new Set<string>();
  return list
    .map((l) => l.trim())
    .filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1));
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  const Label = htmlFor ? "label" : "p";
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-2 block text-[15px] font-semibold">
        {label}
      </Label>
      {children}
      {error && (
        <p role="alert" className="mt-1.5 text-[13px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}
