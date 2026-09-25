import { Act, Figure } from "./_components/Act";
import { FuelDiagram } from "./_components/FuelDiagram";
import { GateDiagram } from "./_components/GateDiagram";
import { LoopDiagram } from "./_components/LoopDiagram";
import { SwapDiagram } from "./_components/SwapDiagram";
import type { NextPage } from "next";

export const metadata = { title: "How it works" };

const SRC = "https://github.com/Madhav-Gupta-28/Nocturne/blob/main/packages/hardhat/contracts";

/**
 * Four pictures, and as little prose as each one can survive on.
 *
 * The mechanism is four things: it books itself, it runs any strategy, it
 * refuses bad prices, and it pays its own way. Each is a drawing with a
 * one-line claim above it and one sentence below, and each links to the file
 * that implements it. The deployed addresses live on the contracts page, not
 * here.
 */
const HowItWorks: NextPage = () => (
  <div className="flex w-full grow flex-col pb-28">
    <div className="shell">
      <header className="glowfield pt-16 pb-4 sm:pt-24">
        <h1 className="display mb-0 text-[clamp(2.2rem,6.4vw,5.5rem)]">
          <span className="display-lit">How it works,</span> <span className="marker">in four pictures.</span>
        </h1>
        <p className="mb-0 mt-10 max-w-2xl text-lg leading-relaxed text-paper-dim">
          It books itself. It runs any strategy. It refuses bad prices. It pays its own way.
        </p>
      </header>

      <Act
        n="01"
        title="It books the next run first."
        lede="Every run schedules the next one before it does anything else."
        takeaway="A failed run costs one run. The chain carries on."
        source={{ label: "NocturneVault.sol", href: `${SRC}/NocturneVault.sol` }}
      >
        <Figure>
          <LoopDiagram />
        </Figure>
      </Act>

      <Act
        n="02"
        title="One vault. Any strategy."
        lede="Pick a strategy. The vault stays the same."
        takeaway="The strategy decides when to run next: every six hours when calm, every minute near the floor."
        source={{ label: "INocturneStrategy.sol", href: `${SRC}/interfaces/INocturneStrategy.sol` }}
      >
        <Figure>
          <SwapDiagram />
        </Figure>
      </Act>

      <Act
        n="03"
        title="It refuses bad prices."
        lede="SaucerSwap and Chainlink have to agree within 2%, or nothing trades."
        takeaway="On 11 July 2026 one bad oracle price took $9.05M out of Bonzo Lend."
        source={{ label: "PriceGuard.sol", href: `${SRC}/lib/PriceGuard.sol` }}
      >
        <Figure>
          <GateDiagram />
        </Figure>
      </Act>

      <Act
        n="04"
        title="It pays its own way."
        lede="Every run is paid for from the vault's own balance."
        takeaway="Hedera holds back 3.27 ℏ to start a run and charges about 1.63. Our first vault died with 2.76 ℏ still in it."
        source={{ label: "Six silent failures", href: "/docs/landmines" }}
      >
        <Figure>
          <FuelDiagram />
        </Figure>
      </Act>
    </div>
  </div>
);

export default HowItWorks;
