import { sshTrialAdapter } from './ssh-setup.mjs';

export default sshTrialAdapter({
  definition: new URL('./definition.json', import.meta.url),
  relay: 'localhost.run',
});
