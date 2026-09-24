"use client";

import { useEffect, useMemo } from "react";
import { ContractPicker } from "./ContractPicker";
import { ContractUI } from "./ContractUI";
import { CONTRACT_NOTES } from "./contracts";
import "@scaffold-hbar-ui/debug-contracts/styles.css";
import { useSessionStorage } from "usehooks-ts";
import deployedContracts from "~~/contracts/deployedContracts";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { ContractName } from "~~/utils/scaffold-hbar/contract";
import { useAllContracts } from "~~/utils/scaffold-hbar/contractsData";

const selectedContractStorageKey = "scaffoldEth2.selectedContract";

/**
 * Every deployed contract, explained and then callable.
 *
 * The read/write machinery underneath is the scaffold's own `Contract`
 * component, deliberately. It is the part of this page that demonstrates the
 * template actually sits inside Scaffold-HBAR rather than around it, and it
 * already handles ABI decoding, argument forms and transaction state properly.
 *
 * What is added is the context it has no way to know: which contracts these
 * are, why each one exists, and what to call first. Ordered so the factory
 * comes first — it is the entry point, and an alphabetical list opens on
 * DriftRebalanceStrategy, which is the least useful place to begin.
 */

/** Reading order: the way somebody would meet these if you explained them. */
const ORDER = [
  "NocturneFactory",
  "Heartbeat",
  "HeartbeatStrategy",
  "ProtectiveExitStrategy",
  "DriftRebalanceStrategy",
  "PriceLens",
];

export function DebugContracts() {
  const contractsData = useAllContracts();
  const { targetNetwork } = useTargetNetwork();

  const contractNames = useMemo(() => {
    const present = Object.keys(contractsData);
    const known = ORDER.filter(name => present.includes(name));
    // Anything deployed that this file has not heard of still shows up. A
    // template is going to grow contracts it does not know the names of.
    const rest = present.filter(name => !ORDER.includes(name)).sort();
    return [...known, ...rest] as ContractName[];
  }, [contractsData]);

  const addresses = useMemo(() => {
    const chain = (deployedContracts as Record<number, Record<string, { address: string }>>)[targetNetwork.id] ?? {};
    return Object.fromEntries(Object.entries(chain).map(([name, c]) => [name, c.address]));
  }, [targetNetwork.id]);

  const [selectedContract, setSelectedContract] = useSessionStorage<ContractName>(
    selectedContractStorageKey,
    contractNames[0],
    { initializeWithValue: false },
  );

  useEffect(() => {
    if (!contractNames.includes(selectedContract)) {
      setSelectedContract(contractNames[0]);
    }
  }, [contractNames, selectedContract, setSelectedContract]);

  if (!contractNames.length) {
    return (
      <p className="border border-line bg-ink-raised p-8 text-paper-dim">
        No contracts found on {targetNetwork.name}. Deploy them with{" "}
        <code className="text-paper">npm run hardhat:deploy -- --network hederaTestnet</code>.
      </p>
    );
  }

  const note = CONTRACT_NOTES[String(selectedContract)];

  return (
    <>
      <ContractPicker
        names={contractNames.map(String)}
        selected={String(selectedContract)}
        onSelect={name => setSelectedContract(name as ContractName)}
        addresses={addresses}
      />

      {note?.tryThis ? (
        <p className="mt-6 mb-0 text-sm text-paper-faint">
          Start with <code className="text-signal">{note.tryThis.call}</code> — {note.tryThis.proves}
        </p>
      ) : null}

      {/*
        The scaffold's own contract UI. Re-dressed by the `debug-shell` rules in
        globals.css rather than forked: the markup belongs to the package, and
        forking it to change corner radii would mean maintaining a copy of
        somebody else's component forever.
      */}
      <div className="debug-shell mt-8">
        {contractNames.map(
          contractName =>
            contractName === selectedContract && <ContractUI key={String(contractName)} contractName={contractName} />,
        )}
      </div>
    </>
  );
}
