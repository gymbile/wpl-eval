// Short-plan corpus: split blacklist-only (v0.5-methodology) vs all-rules.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve(process.cwd(), "results");
const BLACKLIST_KINDS = new Set(["exercise","intensity","food","session_start","required_missing"]);
const files = readdirSync(dir).filter((f) => f.includes("+v0.6-shortplans__") && f.endsWith(".json"));
function isBlacklistUnsafe(r){ return (r.violations??[]).some(v=>BLACKLIST_KINDS.has(v.kind)); }
function isStructuralUnsafe(r){ return (r.violations??[]).some(v=>!BLACKLIST_KINDS.has(v.kind)); }
for (const phase of ["single","multi"]){
  let aBl=0,aAll=0,bBl=0,bAll=0,aN=0,bN=0;
  for (const f of files){
    if (!f.includes(`__${phase}.`)) continue;
    const r = JSON.parse(readFileSync(resolve(dir,f),"utf8"));
    if (r.error) continue;
    const lane = f.includes("__A__")?"A":"B";
    if (lane==="A"){ aN++; if(isBlacklistUnsafe(r))aBl++; if((r.safety_violations??0)>0)aAll++; }
    else { bN++; if(isBlacklistUnsafe(r))bBl++; if((r.safety_violations??0)>0)bAll++; }
  }
  console.log(`\n=== short-plan ${phase}-turn ===`);
  console.log(`  Lane A: blacklist-unsafe ${aBl}/${aN}, all-rules-unsafe ${aAll}/${aN}`);
  console.log(`  Lane B: blacklist-unsafe ${bBl}/${bN}, all-rules-unsafe ${bAll}/${bN}`);
}
