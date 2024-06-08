// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'main.js',
  output: {
    file: 'WorkerTimers.js',
    format: 'iife',
    name: 'WorkerTimers'
  },
  plugins: [resolve(), commonjs()]
};