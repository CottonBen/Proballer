import express from 'express';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

console.log('Testing how express.static matches routes:\n');

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    console.log(`✓ setHeaders matched: ${path.basename(filePath)}`);
    res.setHeader('Cache-Control',
      /\.(html|js|css)$/.test(filePath) ? 'no-cache' : 'public, max-age=604800');
  },
}));

const page = (file) => (req, res) => {
  console.log(`  res.sendFile() called for ${file}`);
  res.sendFile(path.join(PUBLIC_DIR, file));
};

// Static path (no parameters)
app.get('/login', page('login.html'));

// Dynamic path (with parameters)
app.get('/coaches/:slug', page('coach-profile.html'));

const server = app.listen(3008, async () => {
  await new Promise(r => setTimeout(r, 100));
  
  const test = (pathname) => new Promise((resolve) => {
    console.log(`\nTest: GET ${pathname}`);
    http.get(`http://localhost:3008${pathname}`, (res) => {
      console.log(`  Response: Cache-Control = "${res.headers['cache-control']}"`);
      res.on('data', () => {});
      res.on('end', resolve);
    });
  });
  
  await test('/login');
  await test('/coaches/otto-ukkonen');
  
  console.log('\nConclusion:');
  console.log('- /login: setHeaders matched because express.static serves static files');
  console.log('- /coaches/:slug: setHeaders NOT matched because the route has a parameter');
  console.log('  so express.static doesn\'t handle it → res.sendFile() called without setHeaders');
  
  process.exit(0);
});
