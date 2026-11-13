"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { PUBLIC_NAV } from "@/lib/public-nav";

export function PublicMobileMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-2 text-on-dark-muted hover:bg-white/8 hover:text-on-dark"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="public-menu"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <nav id="public-menu" aria-label="Main" className="absolute inset-x-0 top-16 animate-fade-in border-b border-dark-line bg-obsidian shadow-lg">
          <ul className="flex flex-col p-2">
            {PUBLIC_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-3 text-base text-on-dark hover:bg-white/6">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/report" onClick={() => setOpen(false)} className="block rounded-md px-3 py-3 text-base text-on-dark hover:bg-white/6">
                Report an officer
              </Link>
            </li>
            <li className="mt-1 border-t border-dark-line pt-1">
              <Link href="/hq" onClick={() => setOpen(false)} className="block rounded-md px-3 py-3 text-base font-semibold text-gold hover:bg-white/6">
                Member portal
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
