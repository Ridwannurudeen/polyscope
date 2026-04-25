/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  // @polymarket/clob-client-v2 imports `node:crypto` (and a few other Node
  // built-ins) from its utilities module. That breaks the browser bundle
  // because webpack has no default mapping for the `node:` scheme. The
  // trade flow explicitly runs in the browser (user's wallet signs the
  // order) so we can't just externalize it server-side. Polyfill the
  // handful of Node built-ins that clob-client-v2 touches.
  webpack: (config, { isServer, webpack }) => {
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
      // Silence optional deps pulled in by @metamask/sdk and pino /
      // walletconnect logger. The libraries gracefully degrade when these
      // can't be required; webpack only complains because it tries to
      // resolve every static import path. IgnorePlugin makes them missing
      // at bundle time, matching what the libraries already expect.
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^(pino-pretty|@react-native-async-storage\/async-storage)$/,
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
