import { PlayerToggleController } from '../src/content/player-toggle';

export default defineUnlistedScript(() => {
  new PlayerToggleController(document).start();
});
