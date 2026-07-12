module.exports = {
  require: ['tsx', 'test/suppress-colyseus-noise.cjs'],
  exit: true,
  timeout: 180000,
  parallel: true,
  jobs: 8,
};
