const THREE = {
  WebGLRenderer: jest.fn().mockImplementation(() => ({
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    render: jest.fn(),
    dispose: jest.fn(),
    domElement: document.createElement('canvas')
  })),
  Scene: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn(),
    background: null,
    traverse: jest.fn(),
    children: []
  })),
  PerspectiveCamera: jest.fn().mockImplementation(() => ({
    position: { set: jest.fn() },
    lookAt: jest.fn(),
    updateProjectionMatrix: jest.fn(),
    aspect: 1
  })),
  Group: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn(),
    traverse: jest.fn()
  })),
  Mesh: jest.fn().mockImplementation(() => ({
    position: { 
      set: jest.fn(),
      copy: jest.fn().mockReturnThis(),
      x: 0,
      y: 0,
      z: 0
    },
    userData: {},
    geometry: { dispose: jest.fn() },
    material: { dispose: jest.fn() },
    name: '',
    add: jest.fn(),
    remove: jest.fn(),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { setScalar: jest.fn() },
    lookAt: jest.fn(),
    rotateX: jest.fn()
  })),
  LineSegments: jest.fn().mockImplementation(() => ({
    position: { set: jest.fn() },
    geometry: { dispose: jest.fn() },
    material: { dispose: jest.fn() }
  })),
  BufferGeometry: jest.fn().mockImplementation(() => ({
    setAttribute: jest.fn(),
    dispose: jest.fn()
  })),
  Float32BufferAttribute: jest.fn(),
  LineBasicMaterial: jest.fn().mockImplementation(() => ({
    dispose: jest.fn()
  })),
  MeshBasicMaterial: jest.fn().mockImplementation(() => ({
    dispose: jest.fn(),
    clone: jest.fn().mockImplementation(() => ({
      dispose: jest.fn(),
      color: new (jest.fn())
    }))
  })),
  MeshPhongMaterial: jest.fn().mockImplementation(() => ({
    dispose: jest.fn(),
    clone: jest.fn().mockImplementation(() => ({
      dispose: jest.fn()
    }))
  })),
  SphereGeometry: jest.fn().mockImplementation(() => ({
    dispose: jest.fn()
  })),
  AmbientLight: jest.fn().mockImplementation(() => ({
    position: { set: jest.fn() }
  })),
  DirectionalLight: jest.fn().mockImplementation(() => ({
    position: { set: jest.fn() }
  })),
  Color: jest.fn().mockImplementation(() => ({})),
  Raycaster: jest.fn().mockImplementation(() => ({
    setFromCamera: jest.fn(),
    intersectObjects: jest.fn(() => [])
  })),
  Vector2: jest.fn().mockImplementation(() => ({
    x: 0,
    y: 0,
    set: jest.fn()
  })),
  Vector3: jest.fn().mockImplementation(() => ({
    x: 0,
    y: 0,
    z: 0,
    set: jest.fn(),
    addVectors: jest.fn().mockReturnThis(),
    multiplyScalar: jest.fn().mockReturnThis(),
    copy: jest.fn().mockReturnThis(),
    distanceTo: jest.fn().mockReturnValue(1)
  })),
  Clock: jest.fn().mockImplementation(() => ({
    getDelta: jest.fn().mockReturnValue(0.016),
    getElapsedTime: jest.fn().mockReturnValue(1)
  })),
  Sprite: jest.fn().mockImplementation(() => ({
    position: { set: jest.fn() },
    scale: { set: jest.fn() },
    material: { dispose: jest.fn() }
  })),
  SpriteMaterial: jest.fn().mockImplementation(() => ({
    dispose: jest.fn(),
    map: null
  })),
  CanvasTexture: jest.fn().mockImplementation(() => ({
    dispose: jest.fn()
  })),
  TorusGeometry: jest.fn().mockImplementation(() => ({
    dispose: jest.fn()
  })),
  CylinderGeometry: jest.fn().mockImplementation(() => ({
    dispose: jest.fn()
  })),
  AnimationMixer: jest.fn().mockImplementation(() => ({
    update: jest.fn()
  })),
  BackSide: 1
};

module.exports = THREE;