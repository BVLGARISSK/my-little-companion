import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('web-app/vendor',{recursive:true});
await build({stdin:{contents:"export {parseGIF,decompressFrames,decompressFrame} from 'gifuct-js';",resolveDir:process.cwd()},bundle:true,format:'esm',minify:true,outfile:'web-app/vendor/gifuct.js',legalComments:'eof'});
await copyFile('node_modules/gifuct-js/LICENSE','web-app/vendor/gifuct-LICENSE.txt');
await copyFile('node_modules/js-binary-schema-parser/LICENSE','web-app/vendor/schema-parser-LICENSE.txt');
console.log('Self-contained GIF decoder bundled.');
