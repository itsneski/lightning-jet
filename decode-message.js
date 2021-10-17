var args = process.argv.slice(2);
if (!args[0]) return console.error('missing message');

let message = args[0];

const bufToHex = n => n.toString('hex');
const hexToUtf8 = n => Buffer.from(n, 'hex').toString('utf8');

console.log(hexToUtf8(bufToHex(message)));
