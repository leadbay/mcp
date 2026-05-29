module.exports = {
  appId: "ai.leadbay.mcp.installer",
  productName: "Leadbay MCP Installer",
  artifactName: "leadbay-mcp-installer-${os}-${arch}.${ext}",
  directories: {
    output: "dist-native",
  },
  files: [
    "dist/bin.js",
    "dist/installer-gui.js",
    "installer/electron-main.cjs",
    "package.json",
  ],
  extraMetadata: {
    main: "installer/electron-main.cjs",
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Utility",
  },
  deb: {
    maintainer: "Leadbay <support@leadbay.ai>",
    compression: "gz",
  },
  mac: {
    target: ["dmg"],
    category: "public.app-category.utilities",
  },
  win: {
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
  },
};
