import { APP_NAME } from '@rideloc/shared';
import { buildHealth } from './health';

console.log(`${APP_NAME} API bootstrap OK`, buildHealth());
