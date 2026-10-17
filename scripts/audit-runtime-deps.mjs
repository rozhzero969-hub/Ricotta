// OSV receives package names/versions only, never app data or credentials.
import fs from 'node:fs';
const lock=JSON.parse(fs.readFileSync(new URL('../deno.lock',import.meta.url)));
const queries=Object.keys(lock.npm).map(key=>{const i=key.lastIndexOf('@');return{package:{ecosystem:'npm',name:key.slice(0,i)},version:key.slice(i+1)};});
const response=await fetch('https://api.osv.dev/v1/querybatch',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({queries})});
if(!response.ok)throw Error('Dependency advisory service unavailable: '+response.status);
const data=await response.json();
if(!Array.isArray(data.results)||data.results.length!==queries.length)throw Error('Incomplete dependency advisory response');
const issues=data.results.flatMap((result,i)=>(result.vulns||[]).map(v=>`${queries[i].package.name}@${queries[i].version}: ${v.id}`));
if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}else console.log(`Runtime dependency audit PASS: ${queries.length} locked npm packages, no known advisories`);
