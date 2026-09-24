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
};

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider enableSystem>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
