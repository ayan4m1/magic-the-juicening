# Magic: the Juicening

## About

This is a generator for a custom set of playing cards. It relies on [Card Conjurer](https://github.com/Investigamer/cardconjurer) to do the heavy lifting.

## Usage

First, make sure you have Card Conjurer running and available at `http://localhost:4242/`. Follow [their documentation](https://github.com/Investigamer/cardconjurer?tab=readme-ov-file#start-with-docker-httplocalhost4242) if you are unfamiliar with running Dockerized applications.

The next thing you need is a CSV containing the card information. Use the following as column headers:

`#	Name	Rarity	Color	Cost	Type	Text	Power	Toughness	Flavor`

Colors:

- White
- Black
- Red
- Green
- Blue
- Multi
- Artifact
- Land
- Eldrazi
- Vehicle

If you want a dual color card (i.e. one color on the left half of the frame, another on the right) use the following format: `White/Black`.

Once you have your CSV, run the following in this directory:

> npm i
> npm start -- path/to/card.csv

This will take several minutes and produce card images in the `./cards` directory.

To add art to the card images, simply drop a file called `<cardnum>.png` in the `./art` directory. It will be composited in at runtime.
