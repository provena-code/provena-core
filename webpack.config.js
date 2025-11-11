//@ts-check

'use strict';

const path = require('path');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

// TODO: This only builds the CLI app.
// If I ever want to distribute this as a standalone library
// that isn't build by the consumer's build system, I'll need to add
// another config here.

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  entry: './src/cli/App.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'App.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  mode: 'production',
};

module.exports = [extensionConfig];