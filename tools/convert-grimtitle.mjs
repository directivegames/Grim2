import sharp from 'sharp';

await sharp('assets/UI/grimtitle.jpg').webp({ quality: 90 }).toFile('assets/UI/grimtitle.webp');
console.log('Created assets/UI/grimtitle.webp');
