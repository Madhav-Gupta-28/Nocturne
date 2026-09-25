"use client";

import { useEffect, useMemo, useState } from "react";
import { PaginationButton, SearchBar, TransactionsTable } from "./_components";
import type { NextPage } from "next";
import { Block, Transaction, TransactionReceipt } from "viem";
import { hardhat } from "viem/chains";
import { useFetchBlocks } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { notification } from "~~/utils/scaffold-hbar";
import { useAllContracts } from "~~/utils/scaffold-hbar/contractsData";

/** The testnet evidence, one click each. */
const EXPLORE = [
  {
    label: "The factory",
    what: "Every vault it has built",
    path: "contract/0xc0f202Ac01475AFBD07e09643d56bdacC9294B78",
  },
  { label: "On duty now", what: "The DAI depeg guard, running", path: "contract/0.0.10710268" },
  { label: "It refused", what: "WHBAR, sources 22x apart", path: "transaction/1790319391.014683746" },
  { label: "It sold", what: "1 DAI for 1.001757 USDC", path: "transaction/1790319308.034520104" },
  {
    label: "It rebalanced",
    what: "0.5 DAI for 0.500878 USDC, back to 50/50",
    path: "transaction/1790351600.061675104",
  },
  {
    label: "It kept time",
    what: "The Heartbeat counter, beaten by vaults",
    path: "contract/0x8b63C92F7d906862922D060C7Ffc294d8a43ec0b",
  },
];

const BlockExplorer: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const { blocks, transactionReceipts, currentPage, totalBlocks, setCurrentPage, error } =
    useFetchBlocks(isLocalNetwork);
  const allContracts = useAllContracts();
  const [hasError, setHasError] = useState(false);

  const contractAddresses = useMemo(
    () => new Set(Object.values(allContracts).map(c => c.address.toLowerCase())),
    [allContracts],
  );

  const filteredBlocks = useMemo(() => {
    if (contractAddresses.size === 0) return blocks;

    return blocks
      .map(block => ({
        ...block,
        transactions: (block.transactions as Transaction[]).filter(tx => {
          if (typeof tx === "string") return false;
          const toMatch = tx.to && contractAddresses.has(tx.to.toLowerCase());
          const receipt: TransactionReceipt | undefined = transactionReceipts[tx.hash];
          const deployMatch = receipt?.contractAddress && contractAddresses.has(receipt.contractAddress.toLowerCase());
          return toMatch || deployMatch;
        }),
      }))
      .filter(block => block.transactions.length > 0) as Block[];
  }, [blocks, transactionReceipts, contractAddresses]);

  useEffect(() => {
    if (targetNetwork.id === hardhat.id && error) {
      setHasError(true);
    }
  }, [targetNetwork.id, error]);

  useEffect(() => {
    if (hasError) {
      notification.error(
        <>
          <p className="font-bold mt-0 mb-1">Cannot connect to local provider</p>
          <p className="m-0">
            - Did you forget to run{" "}
            <code className="italic bg-base-300 text-base font-bold">npm run hardhat:chain</code> ?
          </p>
          <p className="mt-1 break-normal">
            - Or you can change <code className="italic bg-base-300 text-base font-bold">targetNetwork</code> in{" "}
            <code className="italic bg-base-300 text-base font-bold">scaffold.config.ts</code>
          </p>
        </>,
      );
    }
  }, [hasError]);

  const hasContracts = contractAddresses.size > 0;
  const hasTransactions = filteredBlocks.some(block => block.transactions.length > 0);

  /*
    Off a local chain this explorer has nothing to show, and HashScan already
    does the job properly. So rather than an error, point at the things on it
    worth looking at.
  */
  if (!isLocalNetwork) {
    const scan = targetNetwork.blockExplorers?.default.url ?? "https://hashscan.io/testnet";
    return (
      <div className="shell w-full pb-28 pt-16 sm:pt-24">
        <h1 className="display display-lit m-0 text-[clamp(2.2rem,6vw,4.5rem)]">
          On {targetNetwork.name}, <span className="marker">use HashScan.</span>
        </h1>
        <p className="mb-0 mt-8 max-w-xl text-lg leading-relaxed text-paper-dim">
          This explorer is for a local chain. Everything Nocturne has done on testnet is on HashScan.
        </p>
        <ul className="m-0 mt-12 grid list-none grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line p-0 sm:grid-cols-2">
          {EXPLORE.map(e => (
            <li key={e.label}>
              <a
                href={`${scan}/${e.path}`}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full flex-col bg-ink-raised/80 px-6 py-5 transition-colors hover:bg-signal-glow/40"
              >
                <span className="eyebrow">{e.label}</span>
                <span className="mt-2 text-paper transition-colors group-hover:text-signal">{e.what} ↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="container mx-auto my-10">
      <SearchBar />
      {hasContracts && !hasTransactions && blocks.length > 0 && (
        <div className="flex justify-center p-8">
          <p className="text-lg text-base-content/70">
            No transactions involving your contracts found in the latest blocks.
          </p>
        </div>
      )}
      {!hasContracts && (
        <div className="flex justify-center p-8">
          <p className="text-lg text-base-content/70">
            No contracts registered. Deploy a contract or add entries to{" "}
            <code className="italic bg-base-300 text-base font-bold">externalContracts.ts</code>.
          </p>
        </div>
      )}
      <TransactionsTable blocks={filteredBlocks} transactionReceipts={transactionReceipts} />
      <PaginationButton currentPage={currentPage} totalItems={Number(totalBlocks)} setCurrentPage={setCurrentPage} />
    </div>
  );
};

export default BlockExplorer;
