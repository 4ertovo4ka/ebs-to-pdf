'use strict';

const { merge } = require('webpack-merge');
const TerserPlugin = require('terser-webpack-plugin');
const common = require('./webpack.common.js');
const PATHS = require('./paths');

const isProduction = process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'build';

const config = merge(common, {
  entry: {
    popup: PATHS.src + '/popup.js',
    contentScript: PATHS.src + '/contentScript.js',
    background: PATHS.src + '/background.js',
    pdfAssembler: PATHS.src + '/pdf-assembler.js',
  },
  mode: isProduction ? 'production' : 'development',
  optimization: {
    minimize: isProduction,
    minimizer: isProduction ? [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ] : [],
  },
});

module.exports = config;