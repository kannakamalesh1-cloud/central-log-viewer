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

  if (headerIdx === -1 || footerIdx === -1) return "FAIL: No headers";

  let headerMatch = lines[headerIdx].match(headerPattern);
  let footerMatch = lines[footerIdx].match(footerPattern);
  let headerText = headerMatch ? headerMatch[0] : "";
  let footerText = footerMatch ? footerMatch[0] : "";

  const finalHeader = `-----${headerText}-----`;
  const finalFooter = `-----${footerText}-----`;

  const bodyContent = lines.slice(headerIdx + 1, footerIdx)
    .map(line => line.replace(/\s+/g, ''))
    .filter(line => line.length > 0);

  return [finalHeader, ...bodyContent, finalFooter].join('\n');
}

const input = ` 
---BEGIN OPENSSH PRIVATE KEY---
 
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW QyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9wAAAJiDePfMg3j3 ZAAAAAtzc2gtZWQyNTUxOQAAACBWh9/8kN97fMnzrEbWbyXWFD33MuZ1Z94m4/OU+1BY9w AAAEBMPgdTgQS3Y8mfh4YpEQT/aCMuyzl+S1Wuy8s66jCgg1aH3/yQ33t8yf0sRtZvJdYU
Pfcy5nVn3ibj85T7UFj3AAAAFGthbGFpc2VsdmFtQGFib3NzLmluAQ==
 
----END OPENSSH PRIVATE KEY----`;

console.log("--- RESULT ---");
console.log(sanitizeKey(input));
console.log("--- END ---");
