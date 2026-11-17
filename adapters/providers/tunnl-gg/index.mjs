import { sshTrialAdapter } from '../localhost-run/ssh-setup.mjs';

export default sshTrialAdapter({
  definition: new URL('./definition.json', import.meta.url),
  relay: 'tunnl.gg',
  keyBound: true,
  warning: 'A browser may show a tunnl.gg warning page. Continue only after checking the address, then confirm that the expected app loads.',
});
