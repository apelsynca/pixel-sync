module.exports = {
  packagerConfig: { asar: true, executableName: 'PixelEditor', ignore: [/^\/(src|tests|scripts|docs|\.github)(\/|$)/, /^\/PLAN\.md$/, /^\/node_modules\//] },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'PixelEditor', authors: 'Pixel Editor contributors', description: 'Pixel art editor with local MCP' } }, { name: '@electron-forge/maker-zip', platforms: ['win32', 'linux'] }],
};
