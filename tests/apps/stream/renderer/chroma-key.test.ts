import { describe, expect, it, vi } from 'vitest';
import { ChromaKeyProcessor } from '../../../../apps/stream/renderer/chroma-key';

describe('ChromaKeyProcessor rotation', () => {
  it('sends the source angle to the shader in radians', () => {
    const gl = {
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      LINK_STATUS: 0x8b82,
      COMPILE_STATUS: 0x8b81,
      TEXTURE_2D: 0x0de1,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      CLAMP_TO_EDGE: 0x812f,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      LINEAR: 0x2601,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
      FLOAT: 0x1406,
      TEXTURE0: 0x84c0,
      UNPACK_FLIP_Y_WEBGL: 0x9240,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      COLOR_BUFFER_BIT: 0x4000,
      TRIANGLE_STRIP: 0x0005,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      getShaderInfoLog: vi.fn(() => ''),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      getProgramInfoLog: vi.fn(() => ''),
      deleteProgram: vi.fn(),
      createTexture: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      getAttribLocation: vi.fn(() => 0),
      getUniformLocation: vi.fn((_program, name: string) => ({ name })),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      viewport: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      useProgram: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      activeTexture: vi.fn(),
      pixelStorei: vi.fn(),
      texImage2D: vi.fn(),
      uniform1i: vi.fn(),
      uniform1f: vi.fn(),
      uniform2f: vi.fn(),
      uniform3f: vi.fn(),
      uniform4f: vi.fn(),
      drawArrays: vi.fn(),
      flush: vi.fn(),
      deleteTexture: vi.fn(),
      deleteBuffer: vi.fn(),
      getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
      return contextId === 'webgl' ? gl as unknown as WebGLRenderingContext : null;
    } as typeof HTMLCanvasElement.prototype.getContext);

    const processor = new ChromaKeyProcessor(1920, 1080);
    processor.render({} as TexImageSource, {
      x: 10, y: 20, width: 640, height: 360, rotation: -45,
    }, {
      enabled: true, keyColor: '#00ff00', similarity: 40, smoothness: 10,
    }, { top: 0, right: 0, bottom: 0, left: 0 }, 640, 360);

    expect(gl.uniform1f).toHaveBeenCalledWith({ name: 'u_rotation' }, -Math.PI / 4);
    processor.dispose();
  });
});
