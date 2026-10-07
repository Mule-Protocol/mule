import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Keep the previous complete JSON if a worker or the job dies during a write. */
export function atomicJson(path, value) {
  const temporary=path+'.tmp-'+process.pid;
  const descriptor=openSync(temporary,'w',0o644);
  try { writeFileSync(descriptor,JSON.stringify(value,null,2)+'\n');fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  renameSync(temporary,path);
  if(process.platform!=='win32') {
    const directory=openSync(dirname(path),'r');
    try{fsyncSync(directory);}finally{closeSync(directory);}
  }
}
