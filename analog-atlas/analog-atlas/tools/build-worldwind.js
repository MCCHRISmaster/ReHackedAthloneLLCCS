// Minimal r.js-equivalent: names each AMD module by its path under src/, concatenates after almond, wraps as UMD.
const fs=require('fs'),path=require('path');
const root=process.argv[2], out=process.argv[3], src=path.join(root,'src');
const files=[];(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);fs.statSync(p).isDirectory()?walk(p):p.endsWith('.js')&&files.push(p);}})(src);
let body=fs.readFileSync(path.join(root,'tools/almond.js'),'utf8')+'\n';
let named=0, shims=0;
for(const f of files){
  const id=path.relative(src,f).replace(/\\/g,'/').replace(/\.js$/,'');
  let code=fs.readFileSync(f,'utf8');
  const m=code.match(/^(\s*)define\s*\(/m);
  if(m){ code=code.replace(/^(\s*)define\s*\(/m,(a,s)=>`${s}define(${JSON.stringify(id)}, `); named++; body+=code+'\n'; }
  else { body+=code+`\ndefine(${JSON.stringify(id)}, function(){});\n`; shims++; }
}
const ws=fs.readFileSync(path.join(root,'tools/wrap.start'),'utf8'), we=fs.readFileSync(path.join(root,'tools/wrap.end'),'utf8');
fs.writeFileSync(out, ws+body+we);
console.log({named,shims,bytes:fs.statSync(out).size});
