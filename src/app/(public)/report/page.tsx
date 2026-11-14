import type { Metadata } from "next";
import Link from "next/link";
import { ComplaintForm } from "@/components/ia/complaint-form";

export const metadata: Metadata = {
  title: "Report an officer",
  description: "File a complaint about a Tampa Police Department roleplay officer with Internal Affairs. No sign-in needed; anonymous reports accepted.",
};

export default function ReportPage() {
  return (
    <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
      <p className="text-xs font-semibold tracking-widest text-gold-ink uppercase">Internal Affairs Division</p>
      <h1 className="display-x mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Report an officer</h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-2">
        Anyone can file a complaint about a TPD officer&rsquo;s conduct, including members of the public and TPD members. You do not need to join the Discord or sign in, and you can stay anonymous.
      </p>
      <p className="mt-3 text-sm text-muted">
        Already filed one?{" "}
        <Link href="/report/status" className="font-semibold text-gold-ink hover:underline">
          Check the status
        </Link>
        .
      </p>
      <div className="mt-12">
        <ComplaintForm />
      </div>
    </div>
  );
}
