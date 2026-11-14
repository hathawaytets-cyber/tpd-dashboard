import type { Metadata } from "next";
import { ReceiptLookup } from "@/components/ia/receipt-lookup";

export const metadata: Metadata = { title: "Complaint status", description: "Check the status of an Internal Affairs complaint with your case reference and tracking code." };

export default function ReportStatusPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 lg:py-20">
      <p className="text-xs font-semibold tracking-widest text-gold-ink uppercase">Internal Affairs Division</p>
      <h1 className="display-x mt-3 text-4xl font-bold tracking-tight">Complaint status</h1>
      <p className="mt-4 text-base leading-relaxed text-ink-2">Enter the case reference and tracking code you received when you filed. Investigations are confidential, so this page shows only whether your complaint is received, under review or closed.</p>
      <div className="mt-10">
        <ReceiptLookup />
      </div>
    </div>
  );
}
