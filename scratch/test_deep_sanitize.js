function deepSanitize(keyB64) {
    try {
        const buf = Buffer.from(keyB64, 'base64');
        if (buf.slice(0, 15).toString() !== 'openssh-key-v1\0') return keyB64;
        
        // Find the private key block
        let pos = 15;
        function readLen() { const l = buf.readUInt32BE(pos); pos += 4; return l; }
        
        readLen(); // cipher
        readLen(); // kdf
        readLen(); // kdfopts
        pos += 4;  // num_keys
        
        const pubLen = readLen();
        pos += pubLen; // skip public key
        
        const privBlockLenPos = pos;
        const privLen = readLen();
        
        // The first 8 bytes of the private block are the checkints
        console.log("Found private block at", pos, "length", privLen);
        const check1 = buf.slice(pos, pos + 4);
        const check2 = buf.slice(pos + 4, pos + 8);
        
        if (!check1.equals(check2)) {
            console.log("Fixing mismatched checkints...");
            check1.copy(buf, pos + 4); // Force check2 to match check1
            return buf.toString('base64');
        }
    } catch (e) {
        console.log("Deep sanitize error:", e.message);
    }
    return keyB64;
}

const corrupted = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAJiDePfMg3j3ZAAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAEBMPgdTgQS3Y8mfh4YpEQT/aCMuyzl+S1Wuy8s66jCgg1aH3/yQ33t8yf0sRtZvJdYUPfcy5nVn3ibj85T7UFj3AAAAFGthbGFpc2VsdmFtQGFib3NzLmluAQ==";
const fixed = deepSanitize(corrupted);

const { utils } = require('ssh2');
try {
    const header = "-----BEGIN OPENSSH PRIVATE KEY-----\n";
    const footer = "\n-----END OPENSSH PRIVATE KEY-----";
    utils.parseKey(header + fixed + footer);
    console.log("STILL WORKS? YES!");
} catch (e) {
    console.log("STILL WORKS? NO: " + e.message);
}
