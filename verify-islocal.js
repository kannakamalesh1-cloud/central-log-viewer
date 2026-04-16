const { SSHController } = require('./src/lib/ssh-client.js');
const host = '192.168.1.42'; // The IP from user screenshot
console.log(`Checking if ${host} is local...`);
const isLocal = SSHController.isLocal(host);
console.log(`Is local: ${isLocal}`);

// Double check against OS interfaces manually in this script too
const os = require('os');
const interfaces = os.networkInterfaces();
let foundManually = false;
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.address === host) foundManually = true;
  }
}
console.log(`Found manually in interfaces: ${foundManually}`);

if (isLocal === foundManually) {
    console.log("Verification SUCCESS: SSHController.isLocal matches OS network interfaces.");
} else {
    console.log("Verification FAILURE: SSHController.isLocal result differs.");
}
