import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const envContent = await readFile(resolve(process.cwd(), '.env'), 'utf8');
const env = Object.fromEntries(
  envContent.split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
  headers: { Authorization: `Bearer ${env.LLM_API_KEY}` }
});
const d = await res.json();
const ids = d.data.map(m => m.id);
const deepseek = ids.filter(id => id.toLowerCase().includes('deepseek'));
const nemotron = ids.filter(id => id.toLowerCase().includes('nemotron'));
const llama = ids.filter(id => id.toLowerCase().includes('llama'));

console.log('DeepSeek:', deepseek);
console.log('Nemotron count:', nemotron.length, 'sample:', nemotron.slice(0, 4));
console.log('Llama count:', llama.length, 'sample:', llama.slice(0, 4));
