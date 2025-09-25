// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Adiciona suporte a `.wasm` no bundler
config.resolver.assetExts.push("wasm");

module.exports = config;
