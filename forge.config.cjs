const icon = `${__dirname}/assets/icons/pixelsync.ico`;

module.exports = {
  packagerConfig: { asar: true, executableName: 'PixelSync', icon, ignore: [/^\/(src|tests|scripts|docs|examples|\.github)(\/|$)/, /^\/PLAN\.md$/, /^\/node_modules\//, /^\/assets\/icons\/(?!(?:pixelsync-(?:256|512)\.png)$)[^/]+$/] },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'PixelSync', authors: 'PixelSync contributors', description: 'Pixel art editor with local MCP', setupIcon: icon } }, { name: '@electron-forge/maker-zip', platforms: ['win32', 'linux'] }],
};
