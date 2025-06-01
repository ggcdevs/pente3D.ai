const OrbitControls = jest.fn().mockImplementation(() => ({
  enableDamping: false,
  dampingFactor: 0,
  screenSpacePanning: false,
  minDistance: 0,
  maxDistance: Infinity,
  maxPolarAngle: Math.PI,
  minPolarAngle: 0,
  update: jest.fn(),
  dispose: jest.fn(),
  addEventListener: jest.fn()
}));

module.exports = { OrbitControls };