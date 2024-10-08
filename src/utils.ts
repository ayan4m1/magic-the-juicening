import gm, { State } from 'gm';
import Papa from 'papaparse';
import { existsSync } from 'fs';
import puppeteer, { CDPSession, Page } from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFile } from 'fs/promises';
import packageJsonModule from '@npmcli/package-json';
import type { PackageJson } from '@npmcli/package-json';
import delay from 'delay';
import chunk from 'lodash.chunk';

const rarityMap = {
  R: 'https://i.imgur.com/3dvWenR.png',
  U: 'https://i.imgur.com/FMyNUww.png',
  C: 'https://i.imgur.com/CGciVRr.png'
};

const frameMap = {
  White: 1,
  Blue: 2,
  Black: 3,
  Red: 4,
  Green: 5,
  Multi: 6,
  Artifact: 7,
  Land: 8,
  Eldrazi: 9,
  Vehicle: 10
};

const framePowerToughnessMap = {
  White: 11,
  Blue: 12,
  Black: 13,
  Red: 14,
  Green: 15,
  Multi: 16,
  Artifact: 17,
  Colorless: 18
};

type CardInfo = {
  '#': number;
  Name: string;
  Rarity: string;
  Color: string;
  Cost?: string;
  Type: string;
  Text?: string;
  Power?: number;
  Toughness?: number;
  Flavor?: string;
  'Split #': string;
  'Fuse #': string;
};

type DownloadProgressEvent = {
  guid: string;
  receivedBytes?: number;
  totalBytes?: number;
  state: string;
};

const getInstallDirectory = (): string =>
  dirname(fileURLToPath(import.meta.url));

const getPackageJsonPath = (): string => resolve(getInstallDirectory(), '..');

export const getPackageInfo = async (): Promise<PackageJson> =>
  (await packageJsonModule.load(getPackageJsonPath()))?.content;

const downloadCompleted = (client: CDPSession): Promise<void> =>
  new Promise((resolve, reject) => {
    const tracker = (event: DownloadProgressEvent) => {
      if (event.state === 'completed') {
        client.off('Browser.downloadProgress', tracker);
        resolve();
      } else if (event.state === 'canceled') {
        client.off('Browser.downloadProgress', tracker);
        reject();
      }
    };

    client.on('Browser.downloadProgress', tracker);
  });

const fixFontIssue = async (page: Page) => {
  await page.click('#creator-menu-tabs h3:nth-child(2)');
  await page.waitForSelector('#text-editor', {
    visible: true
  });
  await page.click('#text-options h4:nth-child(2)');
  await page.type('#text-editor', 'Test');
};

const clearTextField = async (page: Page, selector: string) => {
  await page.focus(selector);
  await page.keyboard.down('ControlLeft');
  await page.keyboard.press('A');
  await page.keyboard.up('ControlLeft');
  await page.keyboard.press('Delete');
};

const setCardText = async (
  page: Page,
  card: CardInfo,
  splitIdx: number = 0
) => {
  // enter mana cost if specified
  if (card.Cost) {
    await page.click(`#text-options h4:nth-child(${splitIdx * 4 + 1})`);
    await page.type('#text-editor', card.Cost);
  }

  // enter card title
  await page.click(`#text-options h4:nth-child(${splitIdx * 4 + 2})`);
  await clearTextField(page, '#text-editor');
  await page.type('#text-editor', card.Name);

  // enter card type
  await page.click(`#text-options h4:nth-child(${splitIdx * 4 + 3})`);
  await page.type('#text-editor', card.Type);

  // enter rules text if specified
  if (card.Text) {
    await page.click(`#text-options h4:nth-child(${splitIdx * 4 + 4})`);
    const unescapedRules = card.Text.replaceAll('\\n', '\n');

    let cardRules = unescapedRules;

    if (card.Flavor) {
      cardRules += `{flavor}${card.Flavor}`;
    }

    await page.type('#text-editor', cardRules);
  }

  // enter power/toughness if specified
  if (splitIdx === 0 && card.Power !== null && card.Toughness !== null) {
    await page.click('#text-options h4:nth-child(5)');
    await page.type('#text-editor', `${card.Power}/${card.Toughness}`);
  }
};

const setFrame = async (page: Page, card: CardInfo) => {
  await page.evaluate('setRoundedCorners(false);');

  if (card.Color.includes('/')) {
    const colors = card.Color.split('/');
    const leftColor = frameMap[colors[0]],
      rightColor = frameMap[colors[1]];

    if (!leftColor || !rightColor) {
      return;
    }

    await page.click(`#frame-picker .frame-option:nth-child(${leftColor})`);
    await page.click('#addToFull');

    if (rightColor) {
      await page.click(`#frame-picker .frame-option:nth-child(${rightColor})`);
      await page.click('#addToRightHalf');
    }
  } else {
    const color = frameMap[card.Color];

    if (!color) {
      return;
    }

    await page.click(`#frame-picker .frame-option:nth-child(${color})`);
    await page.click('#addToFull');
  }

  if (card.Power !== null && card.Toughness !== null) {
    console.log(`Adding power/toughness of ${card.Power}/${card.Toughness}`);

    const color = card.Color.includes('/')
      ? framePowerToughnessMap.Colorless
      : framePowerToughnessMap[card.Color];

    await page.click(`#frame-picker .frame-option:nth-child(${color})`);
    await page.click('#addToFull');
  }
};

const setCollectorInfo = async (page: Page, card: CardInfo) => {
  // select collector tab
  await page.click('#creator-menu-tabs h3:nth-child(6)');
  await page.waitForSelector('#info-artist', {
    visible: true
  });

  await clearTextField(page, '#info-artist');
  await page.type('#info-artist', 'MTJ');
  await clearTextField(page, '#info-number');
  await page.type('#info-number', card['#'].toString());
  await clearTextField(page, '#info-rarity');
  await page.type('#info-rarity', card.Rarity);
};

const writeImage = (gm: State, filename: string): Promise<void> =>
  new Promise((resolve, reject) => {
    gm.write(filename, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

export const generateCards = async (cardSheet: string) => {
  try {
    if (!existsSync(cardSheet)) {
      throw new Error(`Path ${cardSheet} does not exist!`);
    }

    const sheetText = await readFile(cardSheet, 'utf-8');
    const sheet = Papa.parse(sheetText, {
      dynamicTyping: true,
      skipEmptyLines: true,
      header: true
    });

    if (sheet.errors.length) {
      console.dir(sheet.errors);
      throw new Error('Failed to parse CSV!');
    }

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    const cardDir = resolve(getInstallDirectory(), '..', 'cards');
    const client = await browser.target().createCDPSession();

    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: cardDir,
      eventsEnabled: true
    });

    await Promise.race([
      page.goto('http://localhost:4242'),
      page.waitForNavigation({
        waitUntil: 'networkidle0'
      })
    ]);

    const cards = sheet.data as unknown as CardInfo[];
    const imagePaths = [];
    const splitCards = [];
    const fuseCards = [];

    for (const card of cards) {
      if (
        existsSync(
          join(getInstallDirectory(), '..', 'cards', `${card.Name}.png`)
        )
      ) {
        imagePaths.push(join(cardDir, `${card.Name}.png`));
        continue;
      }

      if (
        !card.Name ||
        !card.Color ||
        !card.Type ||
        splitCards.includes(card['#']) ||
        fuseCards.includes(card['#'])
      ) {
        continue;
      }

      console.log(`Generating ${card.Name}, ${card.Color ?? 'a'} ${card.Type}`);

      // entering "Test" as card name fixes font not loading correctly
      await fixFontIssue(page);

      // set frame art
      await page.click('#creator-menu-tabs h3:nth-child(1)');
      await page.waitForSelector('#frame-picker .frame-option', {
        visible: true
      });

      let bottomCard: CardInfo = null;

      // frame tab is selected
      if (card['Split #']) {
        const matching = cards.filter(
          (crd) => crd['Split #'] === card['Split #'] && crd['#'] !== card['#']
        );

        if (matching.length !== 1) {
          console.error(`Unable to find split matching # ${card['Split #']}`);
          continue;
        }

        [bottomCard] = matching;
        splitCards.push(bottomCard['#']);

        const topColorIndex = frameMap[card.Color];
        const bottomColorIndex = frameMap[bottomCard.Color];

        if (!topColorIndex || !bottomColorIndex) {
          console.error(
            `Failed to parse colors ${card.Color} for ${card.Name}`
          );
          continue;
        }

        await page.select('#selectFramePack', 'Split');
        await page.waitForSelector('#frame-picker .frame-option:nth-child(8)', {
          visible: true
        });

        await page.click('.notification-container h3');
        await page.waitForSelector('.notification-container', {
          hidden: true
        });

        await page.click(
          `#frame-picker .frame-option:nth-child(${topColorIndex})`
        );
        // top mask
        await page.click('#mask-picker .mask-option:nth-child(2)');
        await page.click('#addToFull');
        await delay(100);
        await page.click(
          `#frame-picker .frame-option:nth-child(${bottomColorIndex})`
        );
        // bottom mask
        await page.click('#mask-picker .mask-option:nth-child(3)');
        await page.click('#addToFull');
        await delay(100);
      } else if (card['Fuse #']) {
        const matching = cards.filter(
          (crd) => crd['Fuse #'] === card['Fuse #'] && crd['#'] !== card['#']
        );

        if (matching.length !== 1) {
          console.error(`Unable to find fuse matching # ${card['Fuse #']}`);
          continue;
        }

        [bottomCard] = matching;
        fuseCards.push(bottomCard['#']);

        const topColorIndex = frameMap[card.Color];
        const bottomColorIndex = frameMap[bottomCard.Color];

        if (!topColorIndex || !bottomColorIndex) {
          console.error(
            `Failed to parse colors ${card.Color} for ${card.Name}`
          );
          continue;
        }

        await page.select('#selectFramePack', 'Split');
        await page.waitForSelector('#frame-picker .frame-option:nth-child(8)', {
          visible: true
        });

        await page.waitForSelector('.notification-container h3', {
          visible: true
        });
        await page.click('.notification-container h3');
        await page.waitForSelector('.notification-container', {
          hidden: true
        });

        await page.click(
          `#frame-picker .frame-option:nth-child(${topColorIndex})`
        );
        // top mask
        await page.click('#mask-picker .mask-option:nth-child(2)');
        await page.click('#addToFull');
        await delay(100);
        await page.click(
          `#frame-picker .frame-option:nth-child(${bottomColorIndex})`
        );
        // bottom mask
        await page.click('#mask-picker .mask-option:nth-child(3)');
        await page.click('#addToFull');
        await delay(100);
      } else {
        await setFrame(page, card);
      }

      // select text tab
      await page.click('#creator-menu-tabs h3:nth-child(2)');
      await page.waitForSelector('#text-editor', {
        visible: true
      });

      console.log('Filling in card details');

      if (bottomCard) {
        await page.waitForSelector('#text-options h4:nth-child(6)', {
          visible: true
        });

        await setCardText(page, card);
        await setCardText(page, bottomCard, 1);
      } else {
        await setCardText(page, card);
      }

      // set art if present
      const artPath = resolve(
        getInstallDirectory(),
        '..',
        'art',
        `${card['#']}.png`
      );

      if (existsSync(artPath)) {
        console.log('Setting art for card');

        await page.click('#creator-menu-tabs h3:nth-child(3)');
        await page.waitForSelector('#creator-menu-art input[type="file"]', {
          visible: true
        });

        await page.$eval(
          '#creator-menu-art input[type="file"]',
          (elem) => (elem.value = '')
        );

        const [chooser] = await Promise.all([
          page.waitForFileChooser(),
          page.click('#creator-menu-art input[type="file"]')
        ]);

        await chooser.accept([artPath]);
        await page.click(
          '#creator-menu-art div:nth-child(2) button[class="input"]'
        );
      }

      console.log(`Setting set symbol to ${card.Rarity}`);

      // select set symbol tab
      if (!bottomCard) {
        await page.click('#creator-menu-tabs h3:nth-child(4)');
        await page.waitForSelector('#creator-menu-setSymbol', {
          visible: true
        });

        const rarityUrl = rarityMap[card.Rarity.substring(0, 1).toUpperCase()];

        if (!rarityUrl) {
          console.error(`Invalid rarity ${card.Rarity} for ${card.Name}`);
          continue;
        }

        await page.type('#creator-menu-setSymbol input[type="url"]', rarityUrl);
        await page.keyboard.press('Enter');

        // wait for rarity image to load
        await delay(1000);
      }

      await setCollectorInfo(page, card);

      console.log('Downloading card');

      await Promise.all([page.click('h3.download'), downloadCompleted(client)]);

      imagePaths.push(join(cardDir, `${card.Name}.png`));

      await page.reload({
        waitUntil: 'networkidle0'
      });
    }

    await page.close();
    await browser.close();

    console.log('Generating montage images...');

    let i = 0;
    const imageChunks = chunk(imagePaths, 20);

    const dpi = 600;
    const targetSize = [2.5, 3.5];
    const bleedPixels = Math.ceil(dpi * 0.125);
    const [targetWidthPixels, targetHeightPixels] = [
      Math.ceil(dpi * targetSize[0]),
      Math.ceil(dpi * targetSize[1])
    ];

    const totalPageWidth = Math.ceil(4 * (targetWidthPixels + bleedPixels * 2));
    const totalPageHeight = Math.ceil(
      5 * (targetHeightPixels + bleedPixels * 2)
    );

    for (const [startChunk, ...chunks] of imageChunks) {
      let chain = gm(startChunk)
        .resize(totalPageWidth, totalPageHeight)
        .background('#000000');

      for (const chunk of chunks) {
        chain = chain.montage(chunk);
      }

      chain = chain.tile('4x5').geometry(`+${bleedPixels}+${bleedPixels}`);

      const imagePath = join(cardDir, '..', `page-${i++}.png`);

      await writeImage(chain, imagePath);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

export const findOptimalLayout = () => {
  const cards = 50;
  const copiesPerCard = 15;
  const totalCards = cards * copiesPerCard;
  const paperSizes = [
    [12, 18],
    [13, 19],
    [18, 12],
    [19, 13]
  ];
  const cardSize = [2.5, 3.5];
  // const cardSize = [2.834, 3.622];
  const cardBleed = 0.125;
  const bledCardSize = [
    cardSize[0] + cardBleed * 2,
    cardSize[1] + cardBleed * 2
  ];

  console.log('Finding optimal page layout for cards...');

  let bestGrid = [0, 0];
  let bestPaperSize = [0, 0];
  for (const paperSize of paperSizes) {
    const [width, height] = paperSize;
    const maxCols = Math.floor(width / bledCardSize[0]);
    const maxRows = Math.floor(height / bledCardSize[1]);

    if (maxCols * maxRows > bestGrid[0] * bestGrid[1]) {
      bestGrid = [maxCols, maxRows];
      bestPaperSize = paperSize;
    }
  }

  console.log(`Optimal grid is ${bestGrid[0]}x${bestGrid[1]}`);
  console.log(
    `${bestGrid[0] * bledCardSize[0]}x${bestGrid[1] * bledCardSize[1]}" on ${bestPaperSize[0]}x${bestPaperSize[1]}" paper`
  );
  console.log(`${copiesPerCard} copies of ${cards} cards = ${totalCards}`);
  console.log(
    `${Math.ceil(totalCards / (bestGrid[0] * bestGrid[1]))} sheets @ ${bestGrid[0] * bestGrid[1]} cards per sheet`
  );
};
