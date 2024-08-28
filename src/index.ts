import { program } from 'commander';

import { getPackageInfo, generateCards } from './utils.js';

try {
  const { name, version, description } = await getPackageInfo();

  await program
    .name(name)
    .version(version)
    .description(description)
    .argument('<cardSheet>', 'Path to CSV containing cards')
    .action(generateCards)
    .parseAsync();
} catch (error) {
  console.error(error);
  process.exit(1);
}
