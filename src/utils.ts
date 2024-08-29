import Papa from 'papaparse';
import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
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
};

const getInstallDirectory = (): string =>
  dirname(fileURLToPath(import.meta.url));

const getPackageJsonPath = (): string => resolve(getInstallDirectory(), '..');

export const getPackageInfo = async (): Promise<PackageJson> =>
  (await packageJsonModule.load(getPackageJsonPath()))?.content;

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
      downloadPath: resolve(getInstallDirectory(), '..', 'cards'),
      eventsEnabled: true
    });

    await Promise.race([
      page.goto('http://localhost:4242'),
      page.waitForNavigation({
        waitUntil: 'networkidle0'
      })
    ]);

    const cards = sheet.data as unknown as CardInfo[];

    for (const card of cards) {
      if (!card.Name || !card.Color || !card.Type) {
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

      // frame tab is selected
      if (card.Color.includes('/')) {
        console.log(`Constructing dual color (${card.Color}) frame`);

        // extract each color
        const colors = card.Color.split('/');
        const leftColorIndex = frameMap[colors[0]];
        const rightColorIndex = frameMap[colors[1]];

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

        await page.click(
          `#frame-picker .frame-option:nth-child(${colorIndex})`
        );
        await page.click('#addToFull');

        if (card.Power !== null && card.Toughness !== null) {
          console.log('Adding power/toughness');
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

      // enter mana cost if specified
      if (card.Cost) {
        await page.click('#text-options h4:nth-child(1)');
        await page.type('#text-editor', card.Cost);
      }

      // enter card title
      await page.click('#text-options h4:nth-child(2)');
      await page.focus('#text-editor');
      await page.keyboard.down('ControlLeft');
      await page.keyboard.press('A');
      await page.keyboard.up('ControlLeft');
      await page.keyboard.press('Delete');
      await page.type('#text-editor', card.Name);

      // enter card type
      await page.click('#text-options h4:nth-child(3)');
      await page.type('#text-editor', card.Type);

      // enter rules text if specified
      if (card.Text) {
        await page.click('#text-options h4:nth-child(4)');
        await page.type('#text-editor', card.Text.replaceAll('\\n', '\n'));
      }

      // enter power/toughness if specified
      if (card.Power !== null && card.Toughness !== null) {
        await page.click('#text-options h4:nth-child(5)');
        await page.type('#text-editor', `${card.Power}/${card.Toughness}`);
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
        await page.click('#creator-menu-tabs h3:nth-child(6)');
        await page.waitForSelector('#info-artist', {
          visible: true
        });
        await page.type('#info-artist', 'MTJ');
      }

      console.log(`Setting set symbol to ${card.Rarity}`);

      // select set symbol tab
      await page.click('#creator-menu-tabs h3:nth-child(4)');
      await page.waitForSelector('#creator-menu-setSymbol', {
        visible: true
      });

      await page.type(
        '#creator-menu-setSymbol input[type="url"]',
        rarityMap[card.Rarity]
      );
      await page.keyboard.press('Enter');

      await delay(2000);

      console.log('Downloading card');

      await page.click('h3.download');

      await delay(2000);

      await page.reload();
    }

    await page.close();
    await browser.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
