const { SSHController } = require('./src/lib/ssh-client.js');
const ssh = new SSHController(null);
ssh.discoverLogSources({host: '192.168.1.42'}, 'nginx').then(console.log).catch(console.error);
