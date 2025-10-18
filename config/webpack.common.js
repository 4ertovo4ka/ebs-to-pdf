"use strict";
const { Compilation, sources } = require('webpack');
const SizePlugin = require("size-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { PDFObjectCode } = require('./pdfobject-inline.js');
const PATHS = require("./paths");

class PDFObjectInlinePlugin {
  constructor() {
    this.pdfObjectCode = PDFObjectCode;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('PDFObjectInlinePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'PDFObjectInlinePlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        (assets) => {
          for (const [name, asset] of Object.entries(assets)) {
            if (name.endsWith('.js')) {
              let content = asset.source();

              console.log(`Processing: ${name}`);

              // Используем JSON-строку напрямую
              const regex = /(var\s+[a-zA-Z_$][\w$]*\s*=\s*)"https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdfobject\/2\.1\.1\/pdfobject\.min\.js"(\s*,)/g;

              const newContent = content.replace(regex, `$1${this.pdfObjectCode}$2`);

              if (newContent !== content) {
                console.log(`✅ PDFObject URL replaced in ${name}`);
                compilation.updateAsset(
                  name,
                  new sources.RawSource(newContent)
                );
              } else {
                console.log(`❌ PDFObject URL not found in ${name}`);
              }
            }
          }
        }
      );
    });
  }
}

const common = {
  output: {
    path: PATHS.build,
    filename: "[name].js",
  },
  devtool: "source-map",
  stats: {
    all: false,
    errors: true,
    builtAt: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
      {
        test: /\.(png|jpe?g|gif)$/i,
        use: [
          {
            loader: "file-loader",
            options: {
              outputPath: "images",
              name: "[name].[ext]",
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new SizePlugin(),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "**/*",
          context: "public",
        },
        {
          from: "./public/pdf-assembler.html",
          to: "pdf-assembler.html",
        },
      ],
    }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
    }),
    new PDFObjectInlinePlugin(),
  ],
};

module.exports = common;
