import { createInterface } from 'node:readline/promises';
import { gozarError } from './error-normalizer.mjs';

/** Generic CLI intake. Secret TTY input is never echoed; no descriptor chooses a provider branch. */
export async function promptInputRequirement(descriptor, { stdin = process.stdin, stderr = process.stderr } = {}) {
  stderr.write(`${descriptor.label}${descriptor.required ? ' (required)' : ''}\n`);
  if (descriptor.help) stderr.write(`${descriptor.help}\n`);
  if (descriptor.obtainUrl) stderr.write(`Obtain: ${descriptor.obtainUrl}\n`);
  stderr.write(descriptor.secret ? 'Secret (hidden): ' : 'Value: ');
  if (!descriptor.secret || !stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    const reader = createInterface({ input: stdin, terminal: false });
    try { return await reader.question(''); } finally { reader.close(); }
  }
  const wasRaw = stdin.isRaw;
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = (error, value) => {
      stdin.off('data', data); stdin.off('end', ended); stdin.off('error', failed);
      stdin.setRawMode(wasRaw); stdin.pause(); stderr.write('\n');
      error ? reject(error) : resolve(value);
    };
    const ended = () => finish(gozarError('invalid_input', 'Input ended before a value was submitted'));
    const failed = () => finish(gozarError('invalid_input', 'Input could not be read'));
    const data = bytes => {
      for (const character of bytes.toString('utf8')) {
        if (character === '\r' || character === '\n') { finish(null, text); return; }
        if (character === '\u0003') { finish(gozarError('invalid_input', 'Input cancelled')); return; }
        if (character === '\u007f' || character === '\b') text = text.slice(0, -1);
        else if (character >= ' ') text += character;
        if (Buffer.byteLength(text) > 65536) { finish(gozarError('invalid_input', 'Input is too long')); return; }
      }
    };
    stdin.setRawMode(true); stdin.on('data', data); stdin.once('end', ended); stdin.once('error', failed); stdin.resume();
  });
}
