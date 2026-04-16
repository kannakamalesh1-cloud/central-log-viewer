
const os = require('os');

function sanitizeKey(key) {
    if (!key) return key;

    let clean = key.trim()
      .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
      .replace(/\r/g, '');

    const headerPattern = /BEGIN [A-Z ]+ PRIVATE KEY/;
    const footerPattern = /END [A-Z ]+ PRIVATE KEY/;

    const lines = clean.split('\n');
    let headerIdx = -1;
    let footerIdx = -1;

    for (let i = 0; i < lines.length; i++) {
       if (headerPattern.test(lines[i])) headerIdx = i;
       if (footerPattern.test(lines[i])) footerIdx = i;
    }

    if (headerIdx === -1 || footerIdx === -1) return key;

    let headerMatch = lines[headerIdx].match(headerPattern);
    let footerMatch = lines[footerIdx].match(footerPattern);
    let headerText = headerMatch ? headerMatch[0] : "BEGIN OPENSSH PRIVATE KEY";
    let footerText = footerMatch ? footerMatch[0] : "END OPENSSH PRIVATE KEY";

    const finalHeader = `-----${headerText}-----`;
    const finalFooter = `-----${footerText}-----`;

    const bodyText = lines.slice(headerIdx + 1, footerIdx)
      .join('')
      .replace(/\s+/g, '');

    let finalBody = bodyText;
    try {
        const buf = Buffer.from(bodyText, 'base64');
        if (buf.slice(0, 15).toString() === 'openssh-key-v1\0') {
            let pos = 15;
            const readLen = () => { if (pos + 4 > buf.length) return 0; const l = buf.readUInt32BE(pos); pos += 4; return l; };
            
            const cipherLen = readLen(); pos += cipherLen;
            const kdfLen = readLen(); pos += kdfLen;
            const kdfOptsLen = readLen(); pos += kdfOptsLen;
            pos += 4; // num_keys
            
            const pubLen = readLen(); pos += pubLen;
            const privBlockLen = readLen();
            
            if (privBlockLen >= 8 && pos + 8 <= buf.length) {
                const check1 = buf.slice(pos, pos + 4);
                const check2 = buf.slice(pos + 4, pos + 8);
                if (!check1.equals(check2)) {
                    console.log("HEALING DETECTED!");
                    check1.copy(buf, pos + 4);
                    finalBody = buf.toString('base64');
                } else {
                    console.log("Key is already healthy.");
                }
            }
        }
    } catch(e) { console.error(e); }

    const bodyLines = finalBody.match(/.{1,70}/g) || [];
    return [finalHeader, ...bodyLines, finalFooter].join('\n');
}

const userKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCA7N+stcI9bU5aZZz59OjbHE9wG7Xrq0XH1X/vMFkCKAAAAJgc2VkiHNlZ
IgAAAAtzc2gtZWQyNTUxOQAAACCA7N+stcI9bU5aZZz59OjbHE9wG7Xrq0XH1X/vMFkCKA
AAAEDIhMn2ouFQJnsGpwF+3OFAYYiJd2s8IijQW3e3oafaeYDs36y1wj1tTlplnPn06Nsc
T3AbteurRcfVf+8wWQIoAAAADmxvZy12aWV3ZXIta2V5AQIDBAUGBw==
-----END OPENSSH PRIVATE KEY-----`;

const result = sanitizeKey(userKey);
if (result === userKey) {
    console.log("Key was NOT modified.");
} else {
    console.log("Key WAS modified!");
    console.log("Modified Key:");
    console.log(result);
}
