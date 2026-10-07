import { workerData } from 'node:worker_threads';

const ownerPid = workerData.ownerPid;
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || ownerPid === process.pid) process.exit(1);
const checkOwner = () => {
  try { process.kill(ownerPid, 0); }
  catch (error) {
    // Permission errors do not establish that the owner has exited.
    if (error.code === 'ESRCH') process.kill(process.pid, 'SIGKILL');
  }
};
checkOwner();
setInterval(checkOwner, 100);
