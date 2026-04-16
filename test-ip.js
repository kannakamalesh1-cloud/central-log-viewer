const os = require('os');
const host = '192.168.1.42'; // from screenshot
let isLocal = false;
if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
  isLocal = true;
} else {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.address === host) isLocal = true;
    }
  }
}
console.log('Is host local?', isLocal);
