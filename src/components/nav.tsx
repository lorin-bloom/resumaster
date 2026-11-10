"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "New application"],
  ["/applications", "History"],
  ["/bank", "Career bank"],
  ["/memory", "Memory & settings"],
  ["/setup", "Setup"],
  ["/demo", "Demo"],
] as const;

export function Nav({ publicDemo }: { publicDemo: boolean }) {
  const path = usePathname();
  const links = publicDemo ? LINKS.filter(([h]) => h === "/demo") : LINKS;
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={publicDemo ? "/demo" : "/"} className="text-[15px] font-semibold tracking-tight">
          Resu<span className="text-accent">master</span>
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {links.map(([href, label]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={`rounded-md px-2.5 py-1 ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
