import { createInterface } from 'node:readline';
import { compileDraft, parseStrictJSON } from '../layout.mjs';
for await (const line of createInterface({ input:process.stdin })) {
  try { console.log(JSON.stringify({ok:true,result:compileDraft(parseStrictJSON(line))})); }
  catch(error) { console.log(JSON.stringify({ok:false,error:error.message})); }
}
