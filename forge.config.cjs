module.exports = {
  packagerConfig: { asar: true, executableName: 'PixelSync', ignore: [/^\/(src|tests|scripts|docs|examples|\.github)(\/|$)/, /^\/PLAN\.md$/, /^\/node_modules\//] },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'PixelSync', authors: 'PixelSync contributors', description: 'Pixel art editor with local MCP' } }, { name: '@electron-forge/maker-zip', platforms: ['win32', 'linux'] }],
};
