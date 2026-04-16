const http = require('http');

const data = JSON.stringify({ email: 'admin@local.com', password: 'admin123' });

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  let cookie = res.headers['set-cookie'];
  if (!cookie) return console.log('no cookie');
  
  const tokenCookie = cookie[0].split(';')[0];
  
  const req2 = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/servers/4/sources?type=docker',
    method: 'GET',
    headers: { 'Cookie': tokenCookie }
  }, res2 => {
    let body = '';
    res2.on('data', d => body += d);
    res2.on('end', () => console.log('API RESPONSE:', body));
  });
  req2.end();
});
req.write(data);
req.end();
