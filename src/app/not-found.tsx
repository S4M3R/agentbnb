import type { Metadata } from "next";
import Link from "next/link";
import { Couchbot } from "@/components/brand/logo";
import { PageShell } from "@/components/shell/page-shell";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PageShell>
      <div className="flex flex-col items-center py-16 text-center sm:py-24">
        <Couchbot size={112} mood="sleepy" animated />
        <h1 className="mt-5 font-brand text-[34px] font-extrabold leading-tight tracking-[-0.04em] sm:text-[40px]">
          Nobody&apos;s home here
        </h1>
        <p className="mt-2 max-w-sm text-base text-muted">
          This page doesn&apos;t exist, or it moved. Tell me where you&apos;re headed and I&apos;ll find you somewhere
          else.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex h-12 items-center justify-center rounded-lg bg-rausch px-6 font-medium text-white transition-colors hover:bg-rausch-active"
        >
          Find a place
        </Link>
      </div>
    </PageShell>
  );
}
