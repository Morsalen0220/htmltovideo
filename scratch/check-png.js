const fs = require('fs');

const buf = fs.readFileSync('scratch/test_10540ms.png');
console.log('Screenshot size in bytes:', buf.length);

// Let's inspect some pixel data or check with sharp / canvas / Jimp or pure node PNG check
// PNG signature is 8 bytes
console.log('Is valid PNG:', buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');
