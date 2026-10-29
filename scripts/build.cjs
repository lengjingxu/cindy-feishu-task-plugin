const esbuild = require('esbuild');
(async () => {
  await esbuild.build({entryPoints:['src/qr.cjs'],outfile:'plugin/qr.js',bundle:true,platform:'browser',target:'es2022',minify:true});
  await esbuild.build({entryPoints:['src/main.cjs'],outfile:'plugin/main.js',bundle:true,platform:'browser',target:'es2022'});
  await esbuild.build({entryPoints:['src/worker.cjs'],outfile:'plugin/node/worker.cjs',bundle:true,platform:'node',target:'node22',external:['bufferutil','utf-8-validate'],legalComments:'eof'});
  await esbuild.build({entryPoints:['src/listener-child.cjs'],outfile:'plugin/node/listener.cjs',bundle:true,platform:'node',target:'node22',
    define:{'process.env.WS_NO_BUFFER_UTIL':'"1"','process.env.WS_NO_UTF_8_VALIDATE':'"1"'},minifySyntax:true,legalComments:'eof'});
})();
