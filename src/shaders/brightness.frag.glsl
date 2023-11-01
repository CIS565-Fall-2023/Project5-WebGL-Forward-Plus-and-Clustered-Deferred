#version 100
#extension GL_EXT_draw_buffers: enable
precision highp float;

// Brightness Threshold Shader (GLSL)
uniform sampler2D u_texture;
varying vec2 v_uv;

void main() {
  vec4 color = texture2D(u_texture, v_uv);
  float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));  // Luminance
  gl_FragColor = (brightness > 0.5) ? color : vec4(1.0);

  // gl_FragColor = color;
}
