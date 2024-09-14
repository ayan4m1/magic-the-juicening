import { program } from 'commander';

import { findOptimalLayout, generateCards, getPackageInfo } from './utils.js';

try {
  const { name, version, description } = await getPackageInfo();

  program.name(name).version(version).description(description);

  program
    .command('generate')
    .description('Generate card sheet images from CSV')
    .argument('<cardSheet>', 'Path to CSV containing cards')
    .action(generateCards);

  program
    .command('paperSize')
    .description('Find the optimal page layout for a given card set')
    .action(findOptimalLayout);

  await program.parseAsync();
} catch (error) {
  console.error(error);
  process.exit(1);
}
