const { utils } = require('ssh2');

const keyString = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAJiDePfMg3j3ZAAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAEBMPgdTgQS3Y8mfh4YpEQT/aCMuyzl+S1Wuy8s66jCgg1aH3/yQ33t8yf0sRtZvJdYU
Pfcy5nVn3ibj85T7UFj3AAAAFGthbGFpc2VsdmFtQGFib3NzLmluAQ==
-----END OPENSSH PRIVATE KEY-----`;

try {
    const parsed = utils.parseKey(keyString);
    console.log("SUCCESS: Key parsed!");
} catch (e) {
    console.log("ERROR: " + e.message);
}
