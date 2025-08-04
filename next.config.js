// next.config.js
const webpack = require("webpack");

module.exports = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        xmlhttprequest: require.resolve("xmlhttprequest"),
      };
    }

    return config;
  },
};
