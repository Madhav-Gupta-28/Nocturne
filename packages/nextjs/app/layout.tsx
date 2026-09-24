import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-hbar-ui/components/styles.css";
import type { Viewport } from "next";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
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
  themeColor: "#0A0C10",
};

/**
 * Three faces, one job each.
 *
 * A nocturne is a piece written for the night and played whether or not anyone
 * is listening, so the display face is a serif — the register of something
 * composed rather than shipped. Fraunces is drawn with an optical-size axis, so
 * at headline sizes it thins its hairlines instead of scaling a text weight up
 * and going muddy on a dark ground.
 *
 * Plex Sans and Plex Mono carry everything else. They were designed together,
 * so a measured number sitting inside a sentence does not look pasted in — and
 * most of the numbers on this site are measurements.
 */
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "600"],
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
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
        <ThemeProvider forcedTheme="dark" enableSystem={false}>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
