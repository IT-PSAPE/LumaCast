import type { ChromaKeyFilter, SourceCrop, SourceTransform } from '../shared/desktop-api';

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_uv;
uniform vec4 u_rect;
uniform vec4 u_uvRect;
uniform vec2 u_outputSize;
varying vec2 v_uv;
void main() {
  vec2 pixel = u_rect.xy + a_position * u_rect.zw;
  vec2 clip = vec2(pixel.x / u_outputSize.x * 2.0 - 1.0, 1.0 - pixel.y / u_outputSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = u_uvRect.xy + a_uv * u_uvRect.zw;
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec3 u_keyColor;
uniform float u_similarity;
uniform float u_smoothness;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_texture, v_uv);
  float distanceFromKey = length(color.rgb - u_keyColor);
  float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, distanceFromKey);
  gl_FragColor = vec4(color.rgb, color.a * alpha);
}`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Chroma key shader could not be created.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Chroma key shader could not be compiled.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export class ChromaKeyProcessor {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly buffer: WebGLBuffer;
  private readonly positionLocation: number;
  private readonly uvLocation: number;
  private readonly textureLocation: WebGLUniformLocation;
  private readonly rectLocation: WebGLUniformLocation;
  private readonly uvRectLocation: WebGLUniformLocation;
  private readonly outputSizeLocation: WebGLUniformLocation;
  private readonly keyColorLocation: WebGLUniformLocation;
  private readonly similarityLocation: WebGLUniformLocation;
  private readonly smoothnessLocation: WebGLUniformLocation;
  private readonly outputWidth: number;
  private readonly outputHeight: number;

  constructor(width: number, height: number, renderScale = 1) {
    const scale = Math.max(0.1, Math.min(1, renderScale));
    this.outputWidth = width;
    this.outputHeight = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is unavailable for chroma key processing.');
    this.gl = gl;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('Chroma key program could not be created.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? 'Chroma key program could not be linked.';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    this.program = program;
    const texture = gl.createTexture();
    const buffer = gl.createBuffer();
    if (!texture || !buffer) throw new Error('Chroma key resources could not be created.');
    this.texture = texture;
    this.buffer = buffer;
    this.positionLocation = gl.getAttribLocation(program, 'a_position');
    this.uvLocation = gl.getAttribLocation(program, 'a_uv');
    const rectLocation = gl.getUniformLocation(program, 'u_rect');
    const uvRectLocation = gl.getUniformLocation(program, 'u_uvRect');
    const outputSizeLocation = gl.getUniformLocation(program, 'u_outputSize');
    const textureLocation = gl.getUniformLocation(program, 'u_texture');
    const keyColorLocation = gl.getUniformLocation(program, 'u_keyColor');
    const similarityLocation = gl.getUniformLocation(program, 'u_similarity');
    const smoothnessLocation = gl.getUniformLocation(program, 'u_smoothness');
    if (this.positionLocation < 0 || this.uvLocation < 0 || !rectLocation || !uvRectLocation || !outputSizeLocation || !textureLocation || !keyColorLocation || !similarityLocation || !smoothnessLocation) {
      throw new Error('Chroma key shader is missing a required input.');
    }
    this.rectLocation = rectLocation;
    this.uvRectLocation = uvRectLocation;
    this.outputSizeLocation = outputSizeLocation;
    this.textureLocation = textureLocation;
    this.keyColorLocation = keyColorLocation;
    this.similarityLocation = similarityLocation;
    this.smoothnessLocation = smoothnessLocation;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      0, 1, 0, 1,
      1, 1, 1, 1,
    ]), gl.STATIC_DRAW);
  }

  render(source: TexImageSource, transform: SourceTransform, filter: ChromaKeyFilter, crop: SourceCrop, sourceWidth: number, sourceHeight: number): HTMLCanvasElement {
    const gl = this.gl;
    const color = filter.keyColor.match(/[0-9a-f]{2}/gi)?.map((part) => parseInt(part, 16) / 255) ?? [0, 1, 0];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.uvLocation);
    gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform1i(this.textureLocation, 0);
    gl.uniform4f(this.rectLocation, transform.x, transform.y, transform.width, transform.height);
    gl.uniform4f(this.uvRectLocation, crop.left / sourceWidth, crop.top / sourceHeight, (sourceWidth - crop.left - crop.right) / sourceWidth, (sourceHeight - crop.top - crop.bottom) / sourceHeight);
    gl.uniform2f(this.outputSizeLocation, this.outputWidth, this.outputHeight);
    gl.uniform3f(this.keyColorLocation, color[0] ?? 0, color[1] ?? 1, color[2] ?? 0);
    gl.uniform1f(this.similarityLocation, filter.similarity / 100 * 0.9);
    gl.uniform1f(this.smoothnessLocation, Math.max(0.002, filter.smoothness / 100 * 0.5));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();
    return this.canvas;
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
