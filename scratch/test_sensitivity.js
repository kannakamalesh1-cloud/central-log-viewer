const { get, run, initDB } = require('../src/lib/db');

async function test() {
    await initDB();
    console.log('Inserting "dev"...');
    try {
        await run('INSERT INTO users (email, passwordHash, role) VALUES (?, ?, ?)', ['dev', 'dummy', 'viewer']);
    } catch(e) {
        console.log('User dev already exists (expected)');
    }
    
    console.log('Querying for "dev":');
    const row1 = await get('SELECT * FROM users WHERE email = ?', ['dev']);
    console.log(row1 ? 'Found dev' : 'Not found');
    
    console.log('Querying for "DEV":');
    const row2 = await get('SELECT * FROM users WHERE email = ?', ['DEV']);
    console.log(row2 ? 'Found DEV' : 'Not found');
    
    console.log('Querying for "DEV" with COLLATE BINARY:');
    const row3 = await get('SELECT * FROM users WHERE email = ? COLLATE BINARY', ['DEV']);
    console.log(row3 ? 'Found DEV (BINARY)' : 'Not found (BINARY)');
}

test();
