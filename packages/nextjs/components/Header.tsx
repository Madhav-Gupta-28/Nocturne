"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";

/**
 * The header, kept to the three things a visitor needs.
 *
 * A header on a page like this is a tax: every element in it is paid for out of
 * the attention the opening is trying to hold. So there is a mark and three
 * links, and that is all.
 *
 * There is deliberately no wallet here. Most people who open this are reading
 * a template, not using a product — a connect button and a balance readout on
 * every page makes it look like a dapp asking for something rather than a
 * template offering something. The wallet lives where it is actually needed:
 * on the contracts console, and inline beside the one form that writes.
 *
 * It floats over the sky rather than sitting on a bar, and only grows a ground
 * and a hairline once the page has scrolled under it — at rest there is nothing
 * between the stars and the headline.
 */

type HeaderMenuLink = { label: string; href: string };

/** Three places to go. Every one of them is a page, not an anchor. */
const menuLinks: HeaderMenuLink[] = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "Contracts", href: "/debug" },
];

/**
 * The mark: the cadence diagram at 18 pixels.
 *
 * Five strokes whose gaps close from left to right — the one behaviour that
 * separates this from every fixed-interval scheduler, drawn small enough to sit
 * in a box next to a wordmark. It is the only piece of iconography on the site
 * and it means something, which is the whole bar an icon has to clear.
 */
const Mark = () => (
  <svg width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden className="shrink-0">
    {[0, 6.5, 11.5, 15, 17.5, 19.5, 21].map((x, i) => (
      <rect
        key={x}
        x={x}
        y={i > 3 ? 1 : 0}
        width="1.4"
        height={i > 3 ? 12 : 14}
        fill="currentColor"
        opacity={0.45 + i * 0.09}
      />
    ))}
  </svg>
);

const Wordmark = () => (
  <Link
    href="/"
    className="group flex shrink-0 items-center gap-2.5 border border-paper px-3 py-2 text-paper transition-colors hover:border-signal hover:text-signal"
  >
    <Mark />
    <span className="display text-[15px] leading-none tracking-[0.06em]">Nocturne</span>
  </Link>
);

const HeaderMenuLinks = ({ onNavigate }: { onNavigate?: () => void }) => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href }) => {
        // `/#proof` lives on the home page, so it is current when we are there.
        const isActive = href.startsWith("/#") ? pathname === "/" : pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              className={`${
                isActive ? "text-paper" : "text-paper-dim hover:text-paper"
              } eyebrow wipe block whitespace-nowrap py-2 transition-colors`}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </>
  );
};

export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  // The header is transparent over the opening and opaque over content. Read
  // once on mount as well, because a reload halfway down a page starts scrolled.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-500 ${
        scrolled ? "border-b border-line bg-ink/85 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="shell relative flex h-[4.5rem] items-center justify-between gap-4">
        <Wordmark />

        {/*
          Absolutely centred rather than laid out between the two, so the links
          sit on the page's axis regardless of how wide the wallet pill grows
          once an address and a balance appear in it.
        */}
        <nav
          className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex"
          aria-label="Main"
        >
          <ul className="pointer-events-auto m-0 flex list-none items-center gap-9 p-0">
            <HeaderMenuLinks />
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <details className="dropdown dropdown-end lg:hidden" ref={burgerMenuRef}>
            <summary className="flex h-9 w-9 cursor-pointer items-center justify-center border border-line text-paper-dim transition-colors hover:text-paper [&::-webkit-details-marker]:hidden [[open]>&]:text-paper">
              <Bars3Icon className="h-4 w-4 [[open]_&]:hidden" />
              <XMarkIcon className="hidden h-4 w-4 [[open]_&]:block" />
              <span className="sr-only">Menu</span>
            </summary>
            <ul className="dropdown-content mt-3 flex w-56 list-none flex-col gap-1 border border-line bg-ink-raised p-4 shadow-2xl">
              <HeaderMenuLinks onNavigate={() => burgerMenuRef?.current?.removeAttribute("open")} />
            </ul>
          </details>
        </div>
      </div>
    </header>
  );
};
