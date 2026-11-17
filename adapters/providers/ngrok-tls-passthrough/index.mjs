import { createNgrokStreamAdapter } from '../_shared/ngrok-stream.mjs';
export const createNgrokTlsAdapter = options => createNgrokStreamAdapter(new URL('./definition.json', import.meta.url), options);
export default createNgrokTlsAdapter();
