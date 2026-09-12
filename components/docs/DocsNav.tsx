"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Documentation navigation.
 *
 * Grouped rather than listed flat: a reader arriving to evaluate the business does not want to
 * read the execution internals, and vice versa. The groups say which is which without anyone
 * having to open pages to find out.
 *
 * On mobile it is a horizontal scroller pinned under the header rather than a sticky column,
 * because a sticky rail on a phone eats the space the prose needs.
 */

export const DOC_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "Start",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/how-it-works", label: "How it works" }
    ]
  },
  {
    label: "The product",
    items: [
      { href: "/docs/auto-trading", label: "Auto-trading" },
      { href: "/docs/discord-sources", label: "Discord sources" },
      { href: "/docs/kol-strategies", label: "KOL strategies" },
      { href: "/docs/portfolio", label: "Portfolio" }
    ]
  },
  {
    label: "Trust",
    items: [
      { href: "/docs/risk-controls", label: "Risk controls" },
      { href: "/docs/custody", label: "Custody and keys" },
      { href: "/docs/measurement", label: "Measurement" }
    ]
  },
  {
    label: "Business",
    items: [
      { href: "/docs/fees", label: "Fees and revenue" },
      { href: "/docs/creators", label: "Creators and affiliates" },
      { href: "/docs/roadmap", label: "Roadmap" }
    ]
  }
];

export default function DocsNav() {
  const path = usePathname();

  return (
    /**
     * min-w-0 is load-bearing, not tidying.
     *
     * A grid item defaults to min-width:auto, so the track sizes to its widest content. The
     * chip rail below is `w-max` — intrinsically as wide as every chip laid flat, measured at
     * 1393px — which stretched this column to 1393 and took `main` and every paragraph in it
     * along, since both share the single mobile column. The prose was then clipped at the
     * viewport edge mid-sentence.
     *
     * It survived the responsive audit because .degen-home clips overflow rather than
     * scrolling it, so documentElement.scrollWidth stayed exactly 375 while text was being
     * cut off. The audit now measures element rects too; see verify-responsive-surfaces.
     */
    <nav aria-label="Documentation" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
      {/* Mobile: one horizontal rail. Every destination stays reachable with a thumb without
          a menu to open first. */}
      <div className="-mx-4 overflow-x-auto px-4 lg:hidden">
        <ul className="flex w-max gap-1.5 pb-1">
          {DOC_GROUPS.flatMap((group) => group.items).map((item) => {
            const active = path === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-3.5 t-meta transition-colors duration-150 ${
                    active
                      ? "border-gold-400 bg-[color:rgb(var(--gold-400-rgb)/0.10)] font-medium text-ink"
                      : "border-edge text-dim"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Desktop: grouped column. */}
      <div className="hidden lg:block">
        {DOC_GROUPS.map((group) => (
          <div key={group.label} className="mb-7">
            <p className="ui-label px-2">{group.label}</p>
            <ul className="mt-2 grid gap-0.5">
              {group.items.map((item) => {
                const active = path === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex min-h-9 items-center rounded-md px-2 t-meta transition-colors duration-150 ${
                        active ? "font-medium text-ink" : "text-dim hover:text-ink"
                      }`}
                    >
                      {/* The marker is a rule, not a background: a filled pill at this size
                          competes with the gold spent on the one action in the header. */}
                      {active && (
                        <span aria-hidden="true" className="absolute inset-y-1.5 -left-2 w-[2px] rounded-full bg-gold-400" />
                      )}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
