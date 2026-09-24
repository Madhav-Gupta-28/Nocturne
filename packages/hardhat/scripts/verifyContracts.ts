/**
 * Verifies deployed contracts on Sourcify, which is what HashScan reads.
 *
 * `npx hardhat verify` does not work here, and the reason is worth knowing
 * before reaching for it: Sourcify retired its v1 API, `hardhat-verify@2.1.3`
 * (the version the scaffold pins alongside hardhat 2.22.19) still calls it, and
 * the 404 comes back as an HTML page. The error it surfaces —
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — points at nothing
 * useful, so it reads like a network blip rather than a dead endpoint.
 *
 * Upgrading `hardhat-verify` is not free either: the versions that speak v2 want
 * `hardhat@^2.26.0`, and the pin at 2.22.19 is the scaffold's own, chosen
 * against the Hedera plugin set. So this talks to the v2 API directly, using the
 * standard JSON input the compiler already wrote into `artifacts/build-info`.
 *
 *   npx hardhat run scripts/verifyContracts.ts --network hederaTestnet
 *
 * Verification needs no private key. It publishes source that anyone can then
 * check against the deployed bytecode — which is the whole point of putting a
 * contract on a public chain and then asking people to trust it.
 */

import * as fs from "fs";
import * as path from "path";
import { deployments, network } from "hardhat";

const SOURCIFY = "https://sourcify.dev/server";

/** Deployments to verify, by the name `hardhat-deploy` recorded them under. */
const CONTRACTS = [
  "Heartbeat",
  "HeartbeatStrategy",
  "ProtectiveExitStrategy",
  "DriftRebalanceStrategy",
  "NocturneFactory",
  "PriceLens",
];

/**
 * Vaults, which have no deployment record because the factory made them.
 *
 * Worth verifying even though they are per-user: a vault's page on HashScan is
 * where the executions are, so it is the page anyone checking the liveness claim
 * actually lands on. Unverified, it shows bytecode and a list of transfers, and
 * the reader has no way to see that `executeScheduled` is not owner-gated.
 *
 * Pass more with `VAULTS=0xabc,0xdef npx hardhat run ...`.
 */
const VAULTS = (process.env.VAULTS ?? "").split(",").filter(Boolean);

type BuildInfo = {
  solcLongVersion: string;
  input: { language: string; sources: Record<string, { content: string }>; settings: unknown };
};

/**
 * Finds the compilation unit that produced a contract's current bytecode.
 *
 * Read from the contract's own `.dbg.json`, which names exactly one build-info,
 * rather than by searching `artifacts/build-info` for a file that mentions the
 * source. Searching looks equivalent and is not: repeated compiles leave several
 * build-info files, more than one can contain the same source, and picking the
 * wrong one produces a "recompiled bytecode length doesn't match" that points at
 * nothing. Hardhat already recorded the answer, so use it.
 *
 * Deliberately independent of `deployments/`, so a vault the factory created can
 * be verified with the same code as a contract a deploy script placed.
 */
function findSource(name: string): { sourceName: string; buildInfo: BuildInfo } {
  const artifacts = path.join(__dirname, "../artifacts/contracts");

  const dbg = locate(artifacts, `${name}.dbg.json`);
  if (!dbg) throw new Error(`no artifact for ${name} — run \`npm run hardhat:compile\` first`);

  const { buildInfo: relative } = JSON.parse(fs.readFileSync(dbg, "utf8")) as { buildInfo: string };
  const buildInfo = JSON.parse(fs.readFileSync(path.resolve(path.dirname(dbg), relative), "utf8")) as BuildInfo;

  const sourceName = Object.keys(buildInfo.input.sources).find(
    s => s === `contracts/${name}.sol` || s.endsWith(`/${name}.sol`),
  );
  if (!sourceName) throw new Error(`${name} is not in its own build-info, which should be impossible`);

  return { sourceName, buildInfo };
}

/** First file with this name anywhere under `dir`. */
function locate(dir: string, filename: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = locate(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return undefined;
}

async function alreadyVerified(chainId: string, address: string): Promise<boolean> {
  const res = await fetch(`${SOURCIFY}/v2/contract/${chainId}/${address}`);
  if (!res.ok) return false;
  const body = (await res.json()) as { match: string | null };
  return body.match !== null;
}

async function verify(name: string, address: string, chainId: string): Promise<"verified" | "already" | "failed"> {
  if (await alreadyVerified(chainId, address)) return "already";

  const { sourceName, buildInfo } = findSource(name);

  const res = await fetch(`${SOURCIFY}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: `${sourceName}:${name}`,
    }),
  });

  const body = (await res.json()) as { verificationId?: string; customCode?: string; message?: string };

  // Already-verified comes back as an error code rather than a success, so it
  // has to be read here as well as in the pre-check above: another run of this
  // script can land between the two.
  if (body.customCode === "already_verified") return "already";
  if (!body.verificationId) {
    console.log(`  ${name}: ${body.message ?? JSON.stringify(body)}`);
    return "failed";
  }

  // Verification is queued, so poll the job rather than assuming it took.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const job = await fetch(`${SOURCIFY}/v2/verify/${body.verificationId}`);
    const state = (await job.json()) as {
      isJobCompleted?: boolean;
      contract?: { match: string | null };
      error?: { message?: string };
    };

    if (!state.isJobCompleted) continue;
    if (state.contract?.match) return "verified";

    const message = state.error?.message ?? "no match";
    console.log(`  ${name}: ${message}`);
    // A length mismatch on a vault is usually not a problem with this script:
    // vaults deployed by an older factory were compiled from source that has
    // since changed, and no longer correspond to anything in the repository.
    if (name === "NocturneVault" && /bytecode length/.test(message)) {
      console.log(`  ${name}: likely deployed by an earlier factory — only vaults from the current one can match`);
    }
    return "failed";
  }

  console.log(`  ${name}: timed out waiting for the verification job`);
  return "failed";
}

async function main() {
  const chainId = String(network.config.chainId);
  const explorer = chainId === "295" ? "mainnet" : "testnet";
  console.log(`verifying on chain ${chainId} (${network.name})\n`);

  const targets: { name: string; address: string }[] = [];
  for (const name of CONTRACTS) targets.push({ name, address: (await deployments.get(name)).address });
  for (const address of VAULTS) targets.push({ name: "NocturneVault", address: address.trim() });

  for (const { name, address } of targets) {
    const result = await verify(name, address, chainId);
    const mark = result === "failed" ? "x" : "ok";
    console.log(`[${mark}] ${name.padEnd(24)} ${address}  ${result}`);
    console.log(`     https://hashscan.io/${explorer}/contract/${address}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
