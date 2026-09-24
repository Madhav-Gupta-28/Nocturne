"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";

/**
 * The header, kept to the four things a visitor actually needs.
 *
 * A header on a page like this is a tax: every element in it is paid for out of
 * the attention the opening is trying to hold. So there is a wordmark, the
 * three places worth going, the two scaffold tools a reviewer will look for,
 * and a wallet. No logo lockup, no tagline, no chrome.
 *
 * It floats over the sky rather than sitting on a bar, and only grows a ground
 * and a hairline once the page has scrolled under it — at rest there is nothing
 * between the stars and the headline.
 */

type HeaderMenuLink = { label: string; href: string };

/** The site's own pages first, then the scaffold's tools. */
export const menuLinks: HeaderMenuLink[] = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "Debug", href: "/debug" },
  { label: "Explorer", href: "/blockexplorer" },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              className={`${
                isActive ? "text-paper" : "text-paper-dim hover:text-paper"
              } eyebrow block whitespace-nowrap px-3 py-2 transition-colors`}
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
      className={`sticky top-0 z-20 transition-colors duration-300 ${
        scrolled ? "border-b border-line bg-ink/80 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-5 sm:px-8">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          {/*
            The mark is the product: a point of light that keeps going on its
            own. It is the same dot the hero uses for a live chain, which is the
            only visual pun on the site and the only one it needs.
          */}
          <span className="alive block h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
          <span className="display text-xl leading-none tracking-[0.02em]">Nocturne</span>
        </Link>

        <nav className="ml-auto hidden lg:block" aria-label="Main">
          <ul className="m-0 flex list-none items-center gap-1 p-0">
            <HeaderMenuLinks />
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <RainbowKitCustomConnectButton />

          <details className="dropdown dropdown-end lg:hidden" ref={burgerMenuRef}>
            <summary className="btn btn-ghost btn-sm px-2 hover:bg-transparent" aria-label="Menu">
              <Bars3Icon className="h-5 w-5" />
            </summary>
            <ul
              className="menu dropdown-content mt-3 w-48 gap-1 border border-line bg-ink-raised p-2 shadow-lg"
              onClick={() => burgerMenuRef?.current?.removeAttribute("open")}
            >
              <HeaderMenuLinks />
            </ul>
          </details>
        </div>
      </div>
    </header>
  );
};
