import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: (config, { dev }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // @coinbase/cdp-sdk declares the @x402/* packages as OPTIONAL peer
    // dependencies and then imports them statically. npm correctly does not
    // install an optional peer nobody asked for, but webpack still tries to
    // resolve the import and fails the production build outright:
    //
    //   Module not found: Can't resolve '@x402/evm/upto/client'
    //
    // Nothing here reaches that code — it arrives through
    // RainbowKit -> wagmi connectors -> @base-org/account -> cdp-sdk, and this
    // app talks to Hedera, not to Base Account. Resolving the absent packages
    // to an empty module lets the bundle build without pulling in four
    // dependencies the app will never call.
    //
    // Upstream bug, not a Nocturne one; a stock scaffold hits it too.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/extensions": false,
      "@x402/svm": false,
    };
    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

module.exports = nextConfig;
