import Papa from 'papaparse';
import { existsSync } from 'fs';
import puppeteer, { Page } from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFile } from 'fs/promises';
import packageJsonModule from '@npmcli/package-json';
import type { PackageJson } from '@npmcli/package-json';
import delay from 'delay';

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
};

const getInstallDirectory = (): string =>
  dirname(fileURLToPath(import.meta.url));

const getPackageJsonPath = (): string => resolve(getInstallDirectory(), '..');

export const getPackageInfo = async (): Promise<PackageJson> =>
  (await packageJsonModule.load(getPackageJsonPath()))?.content;

const clearTextField = async (page: Page, selector: string): Promise<void> => {
  await page.focus(selector);
  await page.keyboard.down('ControlLeft');
  await page.keyboard.press('A');
  await page.keyboard.up('ControlLeft');
  await page.keyboard.press('Delete');
};

const enterCardText = async (
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
    await page.type('#text-editor', card.Text.replaceAll('\\n', '\n'));
  }
};

export const generateCards = async (cardSheet: string): Promise<void> => {
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

    const client = await browser.target().createCDPSession();

    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: resolve(getInstallDirectory(), '..', 'cards')
    });

    await Promise.race([
      page.goto('http://localhost:4242'),
      page.waitForNavigation({
        waitUntil: 'networkidle0'
      })
    ]);

    const cards = sheet.data as unknown as CardInfo[];
    const splitCards = [];

    for (const card of cards) {
      if (
        !card.Name ||
        !card.Color ||
        !card.Type ||
        splitCards.includes(card['#'])
      ) {
        continue;
      }

      console.log(`Generating ${card.Name}, ${card.Color ?? 'a'} ${card.Type}`);

      await page.click('#creator-menu-tabs h3:nth-child(2)');
      await page.waitForSelector('#text-editor', {
        visible: true
      });

      await page.click('#text-options h4:nth-child(2)');
      await page.type('#text-editor', 'Test');

      await page.click('#creator-menu-tabs h3:nth-child(1)');
      await page.waitForSelector('#frame-picker .frame-option', {
        visible: true
      });

      let splitBottomCard: CardInfo = null;

      // frame tab is selected
      if (card['Split #']) {
        const matching = cards.filter(
          (crd) => crd['Split #'] === card['Split #'] && crd['#'] !== card['#']
        );

        if (matching.length !== 1) {
          console.error(`Unable to find split matching # ${card['Split #']}`);
          continue;
        }

        [splitBottomCard] = matching;
        splitCards.push(splitBottomCard['#']);

        const topColorIndex = frameMap[card.Color];
        const bottomColorIndex = frameMap[splitBottomCard.Color];

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
      } else if (card.Color.includes('/')) {
        console.log(`Constructing dual color (${card.Color}) frame`);

        // extract each color
        const colors = card.Color.split('/');
        const leftColorIndex = frameMap[colors[0]];
        const rightColorIndex = frameMap[colors[1]];

        if (!leftColorIndex || !rightColorIndex) {
          console.error(
            `Failed to parse colors ${card.Color} for ${card.Name}`
          );
          continue;
        }

        await page.click(
          `#frame-picker .frame-option:nth-child(${leftColorIndex})`
        );
        await page.click('#addToFull');
        await page.click(
          `#frame-picker .frame-option:nth-child(${rightColorIndex})`
        );
        await page.click('#addToRightHalf');

        if (card.Power !== null && card.Toughness !== null) {
          console.log('Adding power/toughness');
          await page.click(
            `#frame-picker .frame-option:nth-child(${framePowerToughnessMap.Colorless})`
          );
          await page.click('#addToFull');
        }
      } else {
        console.log(`Constructing ${card.Color} frame`);

        const colorIndex = frameMap[card.Color];

        if (!colorIndex) {
          console.error(`Failed to parse color ${card.Color} for ${card.Name}`);
          continue;
        }

        await page.click(
          `#frame-picker .frame-option:nth-child(${colorIndex})`
        );
        await page.click('#addToFull');

        if (card.Power !== null && card.Toughness !== null) {
          console.log(
            `Adding power/toughness of ${card.Power}/${card.Toughness}`
          );

          const powerToughnessIndex = framePowerToughnessMap[card.Color];

          await page.click(
            `#frame-picker .frame-option:nth-child(${powerToughnessIndex})`
          );
          await page.click('#addToFull');
        }
      }

      // select text tab
      await page.click('#creator-menu-tabs h3:nth-child(2)');
      await page.waitForSelector('#text-editor', {
        visible: true
      });

      console.log('Filling in card details');

      if (card['Split #']) {
        await page.waitForSelector('#text-options h4:nth-child(6)', {
          visible: true
        });

        await enterCardText(page, card);
        await enterCardText(page, splitBottomCard, 1);
      } else {
        await enterCardText(page, card);

        // enter power/toughness if specified
        if (card.Power !== null && card.Toughness !== null) {
          await page.click('#text-options h4:nth-child(5)');
          await page.type('#text-editor', `${card.Power}/${card.Toughness}`);
        }
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
      if (!splitBottomCard) {
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
      }

      // wait for rarity image to load
      // todo: waitForResponse
      await delay(1000);

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

      console.log('Downloading card');

      await page.click('h3.download');

      await delay(1000);

      await page.reload();
    }

    await page.close();
    await browser.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
