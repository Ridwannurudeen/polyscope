import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,

  async rewrites() {
    const apiUrl = process.env.POLYSCOPE_API_URL || "http://localhost:8020";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },

  // @polymarket/clob-client-v2 imports `node:crypto` (and a few other Node
  // built-ins) from its utilities module. That breaks the browser bundle
  // because webpack has no default mapping for the `node:` scheme. The
  // trade flow explicitly runs in the browser (user's wallet signs the
  // order) so we can't just externalize it server-side. Polyfill the
  // handful of Node built-ins that clob-client-v2 touches.
  webpack: (config, { isServer, webpack }) => {
    // Silence optional wallet connector/logger deps. PolyScope only
    // configures the injected connector; the other connector packages
    // are lazy optional imports that webpack still tries to resolve.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(pino-pretty|@react-native-async-storage\/async-storage|accounts|@base-org\/account|@coinbase\/wallet-sdk|@metamask\/connect-evm|porto|porto\/internal|@safe-global\/safe-apps-sdk|@safe-global\/safe-apps-provider|@walletconnect\/ethereum-provider)$/,
      }),
    );

    if (!isServer) {
      const NODE_PREFIX_MAP = {
        crypto: "crypto-browserify",
        stream: "stream-browserify",
        buffer: "buffer",
        process: "process/browser",
      };
      // NormalModuleReplacementPlugin fires BEFORE webpack's built-in
      // handling of the `node:` scheme, which is the only place we can
      // intercept `node:crypto` before it becomes an unresolvable external.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(.+)$/, (res) => {
          const mod = res.request.replace(/^node:/, "");
          res.request = NODE_PREFIX_MAP[mod] || mod;
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: "crypto-browserify",
        stream: "stream-browserify",
        buffer: "buffer",
        process: "process/browser",
      };
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: "process/browser",
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
