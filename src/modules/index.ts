/**
 * @module modules/index
 * THE module list. To add a feature set: create src/modules/<name>/index.ts exporting a BotModule,
 * then add ONE line below. Order only affects the order shown in .help.
 * Docs: docs/04-MODULES.md
 */
import type { BotModule } from '../core/types.js';
import { generalModule } from './general/index.js';
import { groupAdminModule } from './groupAdmin/index.js';
import { protectionModule } from './protection/index.js';
import { warningsModule } from './warnings/index.js';
import { welcomeModule } from './welcome/index.js';
import { ownerModule } from './owner/index.js';
import { channelModule } from './channel/index.js';
import { arcadeModule } from './arcade/index.js';
/** import { bugModule } from './bug/index.js'; **/
export const allModules: BotModule[] = [
  generalModule,
  arcadeModule,
  groupAdminModule,
  protectionModule,
  warningsModule,
  welcomeModule,
  ownerModule,
  channelModule,
/**  bugModule, **/
];
