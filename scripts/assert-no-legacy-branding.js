#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = process.cwd();
const PNG_SIGNATURE = "89504e470d0a1a0a";
const failures = [];

function fail(message) {
  failures.push(message);
}

function readExpoConfig() {
  const expoCli = path.join(ROOT, "node_modules", "expo", "bin", "cli");
  try {
    const raw = execFileSync(process.execPath, [
      expoCli,
      "config",
      "--type",
      "public",
      "--json",
    ], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  } catch (error) {
    fail(`Unable to resolve Expo public config: ${error.message}`);
    return null;
  }
}

function expect(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label} expected ${expected}, got ${actual}`);
  }
}

function parsePng(file) {
  const buffer = fs.readFileSync(path.join(ROOT, file));
  if (buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error(`${file} is not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`${file} uses unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  let source = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const row = raw.subarray(source, source + stride);
    source += stride;
    const outStart = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[outStart + x - channels] : 0;
      const up = y > 0 ? pixels[outStart + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[outStart + x - stride - channels] : 0;
      let value;

      if (filter === 0) {
        value = row[x];
      } else if (filter === 1) {
        value = row[x] + left;
      } else if (filter === 2) {
        value = row[x] + up;
      } else if (filter === 3) {
        value = row[x] + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = row[x] + predictor;
      } else {
        throw new Error(`${file} has unsupported PNG filter ${filter}`);
      }

      pixels[outStart + x] = value & 255;
    }
  }

  function pixelAt(x, y) {
    const i = y * stride + x * channels;
    return {
      r: pixels[i],
      g: pixels[i + 1],
      b: pixels[i + 2],
      a: colorType === 6 ? pixels[i + 3] : 255,
    };
  }

  function countWhere(predicate) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (predicate(pixelAt(x, y))) count += 1;
      }
    }
    return count;
  }

  return { file, width, height, bitDepth, colorType, pixelAt, countWhere };
}

function corners(image) {
  return [
    image.pixelAt(0, 0),
    image.pixelAt(image.width - 1, 0),
    image.pixelAt(0, image.height - 1),
    image.pixelAt(image.width - 1, image.height - 1),
  ];
}

function isWhite(pixel) {
  return pixel.r === 255 && pixel.g === 255 && pixel.b === 255 && pixel.a === 255;
}

function checkPenguinAsset(file, options) {
  let image;
  try {
    image = parsePng(file);
  } catch (error) {
    fail(error.message);
    return;
  }

  expect(`${file} width`, image.width, options.size);
  expect(`${file} height`, image.height, options.size);
  if (options.colorType !== undefined) {
    expect(`${file} PNG colorType`, image.colorType, options.colorType);
  }

  const imageCorners = corners(image);
  if (options.whiteCorners && !imageCorners.every(isWhite)) {
    fail(`${file} must have pure white corners, not cream or orange`);
  }
  if (options.transparentCorners && !imageCorners.every((pixel) => pixel.a === 0)) {
    fail(`${file} must have transparent corners`);
  }

  const blackPixels = image.countWhere((pixel) =>
    pixel.a > 0 && pixel.r < 70 && pixel.g < 70 && pixel.b < 70
  );
  const orangePixels = image.countWhere((pixel) =>
    pixel.a > 0 && pixel.r > 210 && pixel.g >= 80 && pixel.g <= 180 && pixel.b < 80
  );
  const bluePixels = image.countWhere((pixel) =>
    pixel.a > 0 && pixel.b > pixel.r + 35 && pixel.b > pixel.g + 15
  );

  if (options.requirePenguin && blackPixels < options.minBlackPixels) {
    fail(`${file} does not look like the approved black penguin asset`);
  }
  if (options.requireBowtie && orangePixels < options.minOrangePixels) {
    fail(`${file} does not include enough orange bowtie/beak/feet pixels`);
  }
  if (orangePixels > options.maxOrangePixels) {
    fail(`${file} has too many orange pixels; it may have a full orange tile background`);
  }
  if (bluePixels > options.maxBluePixels) {
    fail(`${file} has too many blue pixels; it may be the old scarf asset`);
  }
}

const config = readExpoConfig();
if (config) {
  const splashPlugin = (config.plugins || []).find((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-splash-screen"
  );
  const splashConfig = splashPlugin && splashPlugin[1];
  const configText = JSON.stringify(config).toLowerCase();

  for (const bad of [
    "scarf",
    "scroff",
    "icon-1024-cream",
    "icon-1024-orange",
    "app-icon-cream",
    "app-icon-orange",
  ]) {
    if (configText.includes(bad)) {
      fail(`Expo public config contains disallowed legacy branding reference: ${bad}`);
    }
  }

  expect("expo.icon", config.icon, "./assets/images/twofer-icon-1024.png");
  expect("expo.ios.icon", config.ios && config.ios.icon, "./assets/images/twofer-icon-1024.png");
  expect("expo.android.icon", config.android && config.android.icon, "./assets/images/twofer-icon-1024.png");
  expect("expo.android.adaptiveIcon.backgroundColor", config.android && config.android.adaptiveIcon && config.android.adaptiveIcon.backgroundColor, "#FFFFFF");
  expect("expo.android.adaptiveIcon.foregroundImage", config.android && config.android.adaptiveIcon && config.android.adaptiveIcon.foregroundImage, "./assets/images/twofer-adaptive-icon-foreground-1024.png");
  expect("expo.android.adaptiveIcon.monochromeImage", config.android && config.android.adaptiveIcon && config.android.adaptiveIcon.monochromeImage, "./assets/images/twofer-adaptive-icon-monochrome-1024.png");
  expect("expo-splash-screen.image", splashConfig && splashConfig.image, "./assets/images/twofer-splash-1024.png");
  expect("expo-splash-screen.backgroundColor", splashConfig && splashConfig.backgroundColor, "#FFFFFF");
  expect("expo-splash-screen.dark.backgroundColor", splashConfig && splashConfig.dark && splashConfig.dark.backgroundColor, "#FFFFFF");
}

checkPenguinAsset("assets/images/twofer-icon-1024.png", {
  size: 1024,
  colorType: 2,
  whiteCorners: true,
  requirePenguin: true,
  requireBowtie: true,
  minBlackPixels: 100000,
  minOrangePixels: 10000,
  maxOrangePixels: 160000,
  maxBluePixels: 1500,
});

checkPenguinAsset("assets/images/twofer-adaptive-icon-foreground-1024.png", {
  size: 1024,
  colorType: 6,
  transparentCorners: true,
  requirePenguin: true,
  requireBowtie: true,
  minBlackPixels: 50000,
  minOrangePixels: 5000,
  maxOrangePixels: 90000,
  maxBluePixels: 1500,
});

checkPenguinAsset("assets/images/twofer-splash-1024.png", {
  size: 1024,
  colorType: 6,
  transparentCorners: true,
  requirePenguin: true,
  requireBowtie: true,
  minBlackPixels: 50000,
  minOrangePixels: 5000,
  maxOrangePixels: 90000,
  maxBluePixels: 1500,
});

checkPenguinAsset("assets/images/twofer-mark-512.png", {
  size: 512,
  colorType: 6,
  transparentCorners: true,
  requirePenguin: true,
  requireBowtie: true,
  minBlackPixels: 10000,
  minOrangePixels: 1000,
  maxOrangePixels: 30000,
  maxBluePixels: 500,
});

checkPenguinAsset("assets/images/favicon.png", {
  size: 512,
  colorType: 6,
  transparentCorners: true,
  requirePenguin: true,
  requireBowtie: true,
  minBlackPixels: 10000,
  minOrangePixels: 1000,
  maxOrangePixels: 30000,
  maxBluePixels: 500,
});

if (failures.length > 0) {
  console.error("Brand asset assertion failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("Brand assets resolve to the approved penguin-with-orange-bowtie set.");
