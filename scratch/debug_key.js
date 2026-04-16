const b64 = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAJiDePfMg3j3ZAAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAEBMPgdTgQS3Y8mfh4YpEQT/aCMuyzl+S1Wuy8s66jCgg1aH3/yQ33t8yf0sRtZvJdYUPfcy5nVn3ibj85T7UFj3AAAAFGthbGFpc2VsdmFtQGFib3NzLmluAQ==";
const buf = Buffer.from(b64, 'base64');
console.log("Buffer length:", buf.length);

// Parse OpenSSH structure
let pos = 0;
function readString() {
    const len = buf.readUInt32BE(pos);
    pos += 4;
    const s = buf.slice(pos, pos + len).toString();
    pos += len;
    return s;
}

const magic = buf.slice(0, 15).toString();
pos = 15;
console.log("Magic:", magic);
const cipher = readString();
const kdf = readString();
const kdfopts = readString();
const num_keys = buf.readUInt32BE(pos); pos += 4;
console.log("Cipher:", cipher, "KDF:", kdf, "Num Keys:", num_keys);

// Read Public Key
const pubKeyBlobLen = buf.readUInt32BE(pos); pos += 4;
const pubKeyBlob = buf.slice(pos, pos + pubKeyBlobLen);
pos += pubKeyBlobLen;
console.log("Pubkey blob len:", pubKeyBlobLen);

// Read Private Key block
const privKeyBlockLen = buf.readUInt32BE(pos); pos += 4;
console.log("Privkey block len:", privKeyBlockLen);
const privKeyBlock = buf.slice(pos, pos + privKeyBlockLen);

const check1 = privKeyBlock.readUInt32BE(0);
const check2 = privKeyBlock.readUInt32BE(4);
console.log("Check1:", check1, "Check2:", check2);
if (check1 === check2) {
    console.log("Integrity PASSED in manual check!");
} else {
    console.log("Integrity FAILED in manual check!");
}
