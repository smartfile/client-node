const fs = require('fs');
const { BasicClient, FileSystem } = require('./lib');


process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';


const rest = new BasicClient({
    baseUrl: 'https://test.dev.smartfile.com/',
    username: 'administrator',
    password: 'password',
});
const sffs = new FileSystem(rest);

const rs = fs.createReadStream('test.js');
const ws = sffs.createWriteStream('/test.js');

rs.pipe(ws);
