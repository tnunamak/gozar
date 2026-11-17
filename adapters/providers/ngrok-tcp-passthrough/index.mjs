import { createNgrokStreamAdapter } from '../_shared/ngrok-stream.mjs';
export const createNgrokTcpAdapter = options => createNgrokStreamAdapter(new URL('./definition.json', import.meta.url), options);
export default createNgrokTcpAdapter();
