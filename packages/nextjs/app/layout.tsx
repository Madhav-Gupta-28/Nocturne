import { Anton, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-hbar-ui/components/styles.css";
import type { Viewport } from "next";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { Starfield } from "~~/components/Starfield";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Nocturne",
  description: "Recurring on-chain jobs on Hedera, without a keeper.",
});

/**
 * Without this, every phone lays the page out at about 980px and scales it
 * down, so the headline runs off the right edge and the body text is clipped.
 * The App Router does not emit the viewport tag on its own — it has to be
 * exported, and the scaffold does not export it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07080c",
};

/**
 * Three faces, one job each.
 *
 * The display face is a poster grotesque set in caps: narrow enough that a
 * declarative sentence can run the width of a laptop at 150px without wrapping,
 * and heavy enough to hold a dark ground without its hairlines disappearing
 * into it. It is the only thing on this site that is allowed to be loud.
 *
 * Instrument Sans carries the prose. It has a tall x-height and open counters,
 * which is what a paragraph of explanation needs at 18px on black — the usual
 * grotesques close up and turn grey. Its name is a coincidence and a good one.
 *
 * JetBrains Mono carries every label, every measurement and every address. Most
 * of the numbers on this site were measured off a chain and a proportional face
 * would let them drift as they tick.
 */
const display = Anton({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: "400",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

/**
 * Night is the only theme.
 *
 * The product is what happens while nobody is watching, so a light mode would
 * be arguing with the name on every page. `forcedTheme` keeps the scaffold's
 * inherited surfaces — the wallet modal, the debug page, the block explorer —
 * on the same palette rather than leaving them to guess.
 */
const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {/*
          The sky is mounted once, at the root, so it does not restart on a
          navigation. Every page on this site is the same night.
        */}
        <Starfield />
        {/*
          Texture, over everything. A flat black field has no surface; grain
          gives the ground a material and the vignette gives it a shape. Both
          are inert to the pointer and both sit above the content, which is the
          only way a grain reads as film rather than as a pattern behind glass.
        */}
        <div className="vignette" aria-hidden />
        <div className="grain" aria-hidden />
        <ThemeProvider forcedTheme="dark" enableSystem={false}>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
