import { fork } from 'child_process';
import path from 'path';

import { getProjectRoot } from '../common.js';


export async function runSubProcess(script: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(getProjectRoot(), 'scripts', 'mcp', script), { silent: true });

    worker.on('message', (msg: string) => {
      worker.kill();
      resolve(msg);
    });

    worker.on('error', (error) => {
      console.error('Worker error:', error);
      worker.kill();
      reject(error);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });

    worker.send(params);
  });
}
